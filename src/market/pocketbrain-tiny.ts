import type { MarketObservation } from "./observation.js";
import { dynamicChallengePrompt, type DynamicChallengeCase } from "./dynamic-challenge.js";
import { adaptivePrompt, type AdaptiveStrategy } from "./adaptive-challenge.js";
import type { CapabilityProbe } from "./capability-ladder.js";

/** Structural subset of the experimental PocketBrain Tiny browser SDK v0.1. */
export interface TinySdkClient {
  getStatus(): { ready: boolean; phase: string; model: string | null; device?: string | null; dtype?: string | null };
  generate(
    prompt: string,
    options: { mode: "baseline" | "guarded"; maxNewTokens: number },
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
      hostCaptureClipped?: boolean;
    }>;

export interface TinyBotSession {
  readonly botId: string;
  /** Never authorizes an action, mutates the observation, or sends a network request itself. */
  advise(observation: Readonly<MarketObservation>): Promise<TinyAdvisory>;
  challenge(test: DynamicChallengeCase): Promise<TinyAdvisory>;
  adaptive(test: DynamicChallengeCase, strategy: AdaptiveStrategy): Promise<TinyAdvisory>;
  capability(probe: CapabilityProbe): Promise<TinyAdvisory>;
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
      challenge: (test: DynamicChallengeCase) =>
        this.enqueue(() => this.challenge(botId, test)),
      adaptive: (test: DynamicChallengeCase, strategy: AdaptiveStrategy) =>
        this.enqueue(() => this.adaptive(botId, test, strategy)),
      capability: (probe: CapabilityProbe) =>
        this.enqueue(() => this.capability(botId, probe)),
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
  /** Distinct seeded synthetic cases, no example response or expected move in prompt. */
  private async challenge(botId: string, test: DynamicChallengeCase): Promise<TinyAdvisory> {
    if (test.botId !== botId || test.observation.status !== "alert" ||
        test.observation.provenance !== "source-claimed-unverified" ||
        !/^SIM-[A-F]$/.test(test.observation.symbol) ||
        !test.observation.sourceUrl.startsWith("https://synthetic.example/fixture/")) {
      return Object.freeze({ status: "rejected" as const, botId, reason: "invalid-receipt" as const });
    }
    if (!this.client.getStatus().ready) {
      return Object.freeze({ status: "skipped" as const, botId, reason: "not-ready" as const });
    }
    try {
      const response = await this.client.generate(
        dynamicChallengePrompt(test), { mode: "baseline", maxNewTokens: 96 },
      );
      if (response.receipt?.schema !== "POCKETBRAIN_TINY_RUN_V2" ||
          typeof response.text !== "string" || response.text.trim() === "") {
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

  /** At most one generation per caller-invoked strategy; the host enforces the two-attempt cap. */
  private async adaptive(
    botId: string, test: DynamicChallengeCase, strategy: AdaptiveStrategy,
  ): Promise<TinyAdvisory> {
    if (test.botId !== botId || test.observation.status !== "alert" ||
        test.observation.provenance !== "source-claimed-unverified" ||
        !/^SIM-[A-F]$/.test(test.observation.symbol) ||
        test.observation.sourceUrl !==
          "https://synthetic.example/fixture/" + test.observation.symbol) {
      return Object.freeze({ status: "rejected" as const, botId, reason: "invalid-receipt" as const });
    }
    if (!this.client.getStatus().ready) {
      return Object.freeze({ status: "skipped" as const, botId, reason: "not-ready" as const });
    }
    try {
      const mode = strategy === "percent-only-guarded" ? "guarded" as const : "baseline" as const;
      const raw = await this.client.generate(
        adaptivePrompt(test, strategy), { mode, maxNewTokens: 48 },
      );
      if (raw.receipt?.schema !== "POCKETBRAIN_TINY_RUN_V2" ||
          typeof raw.text !== "string" || raw.text.trim() === "") {
        return Object.freeze({ status: "rejected" as const, botId, reason: "invalid-receipt" as const });
      }
      return Object.freeze({
        status: "advisory" as const,
        botId,
        text: raw.text.slice(0, 800),
        hostCaptureClipped: raw.text.length > 800,
        model: this.client.getStatus().model,
        receiptSchema: "POCKETBRAIN_TINY_RUN_V2" as const,
        provenance: "unverified-model-output" as const,
        sdkReportedBackend: raw.receipt.backend === "webgpu" || raw.receipt.backend === "wasm"
          ? raw.receipt.backend : null,
        sdkReportedModel: typeof raw.receipt.model === "string"
          ? raw.receipt.model.slice(0, 120) : null,
        sdkReportedDtype: typeof raw.receipt.dtype === "string"
          ? raw.receipt.dtype.slice(0, 30) : null,
      });
    } catch {
      return Object.freeze({ status: "rejected" as const, botId, reason: "generation-failed" as const });
    }
  }

  /** Stateless capability probe, no automatic fallbacks or authoritative interpretation. */
  private async capability(botId: string, probe: CapabilityProbe): Promise<TinyAdvisory> {
    if (probe.botId !== botId || !/^case-[12]$/.test(probe.caseId) ||
        !/^SIM-[A-F]$/.test(probe.input.symbol) ||
        !Number.isInteger(probe.expectedValue) ||
        typeof probe.prompt !== "string" || !probe.prompt.trim() ||
        probe.prompt.length > 400) {
      return Object.freeze({ status: "rejected" as const, botId, reason: "invalid-receipt" as const });
    }
    if (!this.client.getStatus().ready) {
      return Object.freeze({ status: "skipped" as const, botId, reason: "not-ready" as const });
    }
    try {
      const generated = await this.client.generate(
        probe.prompt, { mode: "baseline", maxNewTokens: 48 },
      );
      if (generated.receipt?.schema !== "POCKETBRAIN_TINY_RUN_V2" ||
          typeof generated.text !== "string" || generated.text.trim() === "") {
        return Object.freeze({ status: "rejected" as const, botId, reason: "invalid-receipt" as const });
      }
      return Object.freeze({
        status: "advisory" as const, botId,
        text: generated.text.slice(0, 800),
        hostCaptureClipped: generated.text.length > 800,
        model: this.client.getStatus().model,
        receiptSchema: "POCKETBRAIN_TINY_RUN_V2" as const,
        provenance: "unverified-model-output" as const,
        sdkReportedBackend: generated.receipt.backend === "webgpu" || generated.receipt.backend === "wasm"
          ? generated.receipt.backend : null,
        sdkReportedModel: typeof generated.receipt.model === "string"
          ? generated.receipt.model.slice(0, 120) : null,
        sdkReportedDtype: typeof generated.receipt.dtype === "string"
          ? generated.receipt.dtype.slice(0, 30) : null,
      });
    } catch {
      return Object.freeze({ status: "rejected" as const, botId, reason: "generation-failed" as const });
    }
  }

}
