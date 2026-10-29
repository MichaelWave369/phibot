import type { MarketObservation } from "./observation.js";

/** Structural subset of the experimental PocketBrain Tiny browser SDK v0.1. */
export interface TinySdkClient {
  getStatus(): { ready: boolean; phase: string; model: string | null; device?: string | null; dtype?: string | null };
  generate(
    prompt: string,
    options: { mode: "baseline"; maxNewTokens: number },
  ): Promise<{
    text: string;
    receipt: { schema: string; model?: string; backend?: string; dtype?: string; mode?: string };
  }>;
}

export type TinyAdvisory =
  | Readonly<{ status: "skipped"; botId: string; reason: "quiet" | "not-ready" }>
  | Readonly<{ status: "rejected"; botId: string; reason: "generation-failed" | "invalid-receipt" }>
  | Readonly<{
      status: "advisory";
      botId: string;
      text: string;
      model: string | null;
      receiptSchema: "POCKETBRAIN_TINY_RUN_V2";
      provenance: "unverified-model-output";
      sdkReportedBackend: "webgpu" | "wasm" | null;
      sdkReportedModel: string | null;
      sdkReportedDtype: string | null;
    }>;

export interface TinyBotSession {
  readonly botId: string;
  /** Never authorizes an action, mutates the observation, or sends a network request itself. */
  advise(observation: Readonly<MarketObservation>): Promise<TinyAdvisory>;
}

/**
 * A shared inference engine with per-bot request isolation.
 * The host owns consent, client.load(), disposal, and any optional memory.
 * This module neither loads weights nor silently falls back to a hosted model.
 */
export class PocketBrainTinyFleet {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly client: TinySdkClient) {}

  forBot(botId: string): TinyBotSession {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(botId)) {
      throw new Error("Invalid PhiBot identity.");
    }
    return Object.freeze({
      botId,
      advise: (observation: Readonly<MarketObservation>) =>
        this.enqueue(() => this.advise(botId, observation)),
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    // SDK v0.1 rejects overlapping generations. Failures must not poison the queue.
    const result = this.tail.then(work, work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async advise(botId: string, observation: Readonly<MarketObservation>): Promise<TinyAdvisory> {
    if (observation.status !== "alert") {
      return Object.freeze({ status: "skipped" as const, botId, reason: "quiet" as const });
    }
    if (!this.client.getStatus().ready) {
      return Object.freeze({ status: "skipped" as const, botId, reason: "not-ready" as const });
    }
    // Only scalar validated fields enter the prompt. Neither external news nor URL text
    // is fed to this experimental model. The model cannot create factual evidence.
    const prompt = [
      "You are a read-only PhiBot assistant. Give a brief non-causal observation.",
      "Never recommend a trade or claim to know why the price moved.",
      "Source verification is not available. Do not invent reasons or news.",
      "Bot: " + botId,
      "Symbol: " + observation.symbol,
      "Price: " + observation.price,
      "Reference: " + observation.referencePrice,
      "Move percentage: " + observation.movePct.toFixed(4),
      "Quote time UTC: " + observation.sourceTime,
      "Use only the synthetic 100-to-104 fixture. A strict format checker will hold other text.",
      "If you can, reply exactly: The synthetic BTC-USD fixture moved from 100 to 104 (+4%). The cause is unknown.",
    ].join("\n");
    try {
      const response = await this.client.generate(prompt, { mode: "baseline", maxNewTokens: 64 });
      if (
        response.receipt?.schema !== "POCKETBRAIN_TINY_RUN_V2" ||
        typeof response.text !== "string" ||
        response.text.trim() === ""
      ) {
        return Object.freeze({ status: "rejected" as const, botId, reason: "invalid-receipt" as const });
      }
      return Object.freeze({
        status: "advisory" as const,
        botId,
        text: response.text.slice(0, 800),
        model: this.client.getStatus().model,
        receiptSchema: "POCKETBRAIN_TINY_RUN_V2" as const,
        provenance: "unverified-model-output" as const,
        sdkReportedBackend: response.receipt.backend === "webgpu" || response.receipt.backend === "wasm"
          ? response.receipt.backend : null,
        sdkReportedModel: typeof response.receipt.model === "string"
          ? response.receipt.model.slice(0, 120) : null,
        sdkReportedDtype: typeof response.receipt.dtype === "string"
          ? response.receipt.dtype.slice(0, 30) : null,
      });
    } catch {
      return Object.freeze({ status: "rejected" as const, botId, reason: "generation-failed" as const });
    }
  }
}
