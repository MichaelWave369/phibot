import { randomUUID } from "node:crypto";
import { evaluateManifestAuthority } from "../core/authority.js";
import type { Ledger } from "../core/ledger.js";
import type { LedgerReceipt, PhiBotManifest } from "../core/types.js";
import type { RealityGate } from "../gate/reality-gate.js";
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
    private readonly realityGate?: RealityGate,
  ) {
    this.sandbox = new ToolSandbox({
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  async execute(
    manifest: PhiBotManifest,
    request: ToolExecutionRequest,
    runId: string = randomUUID(),
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
    let gateGrantId: string | undefined;
    let gateRequestId: string | undefined;

    if (!authority.allowed) {
      if (!authority.gated) {
        const receipt = await record("blocked", authority.reason, {
          tool: {
            capability: capability.id,
            actionClass: capability.actionClass,
            external: capability.external,
            reason: "authority_denied",
          },
        });
        return {
          status: "denied",
          capability: capability.id,
          error: authority.reason,
          receipt,
        };
      }

      if (!this.realityGate) {
        const receipt = await record("escalate", authority.reason, {
          tool: {
            capability: capability.id,
            actionClass: capability.actionClass,
            external: capability.external,
            reason: "reality_gate_not_configured",
          },
        });
        return {
          status: "gated",
          capability: capability.id,
          error: authority.reason,
          receipt,
        };
      }

      if (!request.grant) {
        const gateRequest = await this.realityGate.createRequest({
          manifest,
          runId,
          capability: capability.id,
          actionClass: capability.actionClass,
          input: request.input,
        });
        const receipt = await record(
          "escalate",
          `Reality Gate approval required for ${capability.id}.`,
          {
            tool: {
              capability: capability.id,
              actionClass: capability.actionClass,
              external: capability.external,
              reason: "reality_gate_required",
              gateRequestId: gateRequest.requestId,
              inputDigest: gateRequest.inputDigest,
            },
          },
        );
        return {
          status: "gated",
          capability: capability.id,
          error: authority.reason,
          gateRequest,
          receipt,
        };
      }

      const verification = await this.realityGate.verifyAndConsume(
        request.grant,
        {
          runId,
          botId: manifest.id,
          capability: capability.id,
          actionClass: capability.actionClass,
          input: request.input,
        },
        manifest.version,
      );

      if (!verification.valid) {
        const receipt = await record(
          "blocked",
          `Reality Gate grant rejected for ${capability.id}.`,
          {
            tool: {
              capability: capability.id,
              actionClass: capability.actionClass,
              external: capability.external,
              reason: "grant_rejected",
              grantId: verification.grantId,
              gateRequestId: verification.requestId,
              detail: verification.reason,
            },
          },
        );
        return {
          status: "denied",
          capability: capability.id,
          error: verification.reason,
          receipt,
        };
      }

      gateGrantId = verification.grantId;
      gateRequestId = verification.requestId;
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
            ...(gateGrantId === undefined ? {} : { gateGrantId }),
            ...(gateRequestId === undefined ? {} : { gateRequestId }),
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
            ...(gateGrantId === undefined ? {} : { gateGrantId }),
            ...(gateRequestId === undefined ? {} : { gateRequestId }),
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
