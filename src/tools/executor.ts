import { randomUUID } from "node:crypto";
import { evaluateManifestAuthority } from "../core/authority.js";
import type { Ledger } from "../core/ledger.js";
import type { LedgerReceipt, PhiBotManifest } from "../core/types.js";
import { ToolCapabilityRegistry } from "./registry.js";
import { ToolSandbox } from "./sandbox.js";
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutorOptions,
} from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ToolExecutor {
  private readonly sandbox: ToolSandbox;

  constructor(
    private readonly registry: ToolCapabilityRegistry,
    private readonly ledger: Ledger,
    options: ToolExecutorOptions = {},
  ) {
    this.sandbox = new ToolSandbox({
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  async execute(
    manifest: PhiBotManifest,
    request: ToolExecutionRequest,
    runId = randomUUID(),
  ): Promise<ToolExecutionResult> {
    const capability = this.registry.get(request.capability);

    const record = async (
      status: LedgerReceipt["status"],
      summary: string,
      metadata: Record<string, unknown>,
    ): Promise<LedgerReceipt> => {
      const receipt: LedgerReceipt = {
        schema: "phibot.receipt.v1",
        runId,
        botId: manifest.id,
        botVersion: manifest.version,
        stage: "tool",
        timestamp: new Date().toISOString(),
        status,
        summary,
        metadata,
      };
      await this.ledger.append(receipt);
      return receipt;
    };

    if (!manifest.capabilities.includes(request.capability)) {
      const error = `Capability not declared by bot: ${request.capability}`;
      const receipt = await record("blocked", error, {
        tool: {
          capability: request.capability,
          reason: "undeclared_capability",
        },
      });
      return {
        status: "denied",
        capability: request.capability,
        error,
        receipt,
      };
    }

    if (!capability) {
      const error = `Capability is not registered: ${request.capability}`;
      const receipt = await record("blocked", error, {
        tool: {
          capability: request.capability,
          reason: "unknown_capability",
        },
      });
      return {
        status: "denied",
        capability: request.capability,
        error,
        receipt,
      };
    }

    const authority = evaluateManifestAuthority(manifest, capability.actionClass);

    if (!authority.allowed) {
      const receipt = await record(
        authority.gated ? "escalate" : "blocked",
        authority.reason,
        {
          tool: {
            capability: capability.id,
            actionClass: capability.actionClass,
            external: capability.external,
            reason: authority.gated ? "reality_gate_required" : "authority_denied",
          },
        },
      );
      return {
        status: authority.gated ? "gated" : "denied",
        capability: capability.id,
        error: authority.reason,
        receipt,
      };
    }

    try {
      const { output, durationMs } = await this.sandbox.run(
        capability,
        {
          botId: manifest.id,
          runId,
        },
        request.input,
      );

      const receipt = await record(
        "ok",
        `Executed capability: ${capability.id}`,
        {
          tool: {
            capability: capability.id,
            actionClass: capability.actionClass,
            external: capability.external,
            durationMs,
          },
        },
      );

      return {
        status: "executed",
        capability: capability.id,
        output,
        receipt,
      };
    } catch (error: unknown) {
      const message = errorMessage(error);
      const receipt = await record(
        "blocked",
        `Capability execution failed: ${capability.id}`,
        {
          tool: {
            capability: capability.id,
            actionClass: capability.actionClass,
            external: capability.external,
            reason: "execution_failed",
            error: message,
          },
        },
      );

      return {
        status: "failed",
        capability: capability.id,
        error: message,
        receipt,
      };
    }
  }
}
