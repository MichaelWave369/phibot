import { randomUUID } from "node:crypto";
import type { PhiBotAdapter } from "../adapters/dry-run.js";
import { evaluateAuthority } from "./authority.js";
import type { Ledger } from "./ledger.js";
import type {
  BotInput,
  LedgerReceipt,
  PhiBotManifest,
  RunResult,
  StageResult,
  VesselStage,
} from "./types.js";

function summarizeProviderUsage(stages: StageResult[]): Record<string, unknown> | undefined {
  const traces = stages.flatMap((stage) => (stage.provider ? [stage.provider] : []));
  if (traces.length === 0) return undefined;

  return {
    providerTotals: {
      calls: traces.length,
      fallbackCalls: traces.filter((item) => item.fallback).length,
      latencyMs: traces.reduce((sum, item) => sum + item.latencyMs, 0),
      inputTokens: traces.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
      outputTokens: traces.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
      totalTokens: traces.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0),
      providers: [...new Set(traces.map((item) => item.provider))],
      models: [...new Set(traces.map((item) => item.model))],
    },
  };
}

export class PhiBotRuntime {
  constructor(
    private readonly manifest: PhiBotManifest,
    private readonly adapter: PhiBotAdapter,
    private readonly ledger: Ledger,
  ) {}

  async run(input: BotInput): Promise<RunResult> {
    const runId = randomUUID();
    const stages: StageResult[] = [];
    const receipts: LedgerReceipt[] = [];

    const record = async (
      stage: VesselStage,
      status: LedgerReceipt["status"],
      summary: string,
      confidence?: number,
      metadata?: Record<string, unknown>,
    ): Promise<void> => {
      const receipt: LedgerReceipt = {
        schema: "phibot.receipt.v1",
        runId,
        botId: this.manifest.id,
        botVersion: this.manifest.version,
        stage,
        timestamp: new Date().toISOString(),
        status,
        summary,
        ...(confidence === undefined ? {} : { confidence }),
        ...(metadata === undefined ? {} : { metadata }),
      };
      receipts.push(receipt);
      await this.ledger.append(receipt);
    };

    const executeStage = async (
      stage: Exclude<VesselStage, "ledger">,
      fn: () => Promise<StageResult>,
    ): Promise<StageResult> => {
      const result = await fn();
      if (result.stage !== stage) {
        throw new Error(`Adapter contract violation: expected ${stage}, got ${result.stage}`);
      }
      stages.push(result);
      await record(
        stage,
        "ok",
        result.summary,
        result.confidence,
        result.provider ? { provider: result.provider } : undefined,
      );
      return result;
    };

    await executeStage("observe", () => this.adapter.observe(this.manifest, input));
    await executeStage("interpret", () =>
      this.adapter.interpret(this.manifest, input, stages),
    );
    const proposal = await executeStage("propose", () =>
      this.adapter.propose(this.manifest, input, stages),
    );

    if (proposal.confidence < this.manifest.escalation.confidenceBelow) {
      await record(
        "ledger",
        "escalate",
        `Confidence below threshold; escalate to ${this.manifest.escalation.target}.`,
        proposal.confidence,
        {
          threshold: this.manifest.escalation.confidenceBelow,
          ...(summarizeProviderUsage(stages) ?? {}),
        },
      );
      return {
        runId,
        botId: this.manifest.id,
        status: "escalated",
        stages,
        receipts,
      };
    }

    const verified = await executeStage("verify", () =>
      this.adapter.verify(this.manifest, input, stages),
    );
    const authority = evaluateAuthority(this.manifest, verified);

    if (!authority.allowed) {
      await record(
        "ledger",
        authority.gated ? "escalate" : "blocked",
        authority.reason,
        verified.confidence,
        {
          realityGate: authority.gated,
          ...(summarizeProviderUsage(stages) ?? {}),
        },
      );
      return {
        runId,
        botId: this.manifest.id,
        status: authority.gated ? "escalated" : "blocked",
        stages,
        receipts,
      };
    }

    await record(
      "ledger",
      "ok",
      "Run completed inside declared authority.",
      undefined,
      summarizeProviderUsage(stages),
    );
    return {
      runId,
      botId: this.manifest.id,
      status: "completed",
      stages,
      receipts,
    };
  }
}
