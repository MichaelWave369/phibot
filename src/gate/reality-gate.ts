import { randomUUID } from "node:crypto";
import type { Ledger } from "../core/ledger.js";
import type {
  AuthorityClass,
  LedgerReceipt,
  PhiBotManifest,
} from "../core/types.js";
import { digestInput, signGrant, verifyGrantSignature } from "./crypto.js";
import { MemoryReplayStore, type ReplayStore } from "./replay.js";
import type {
  GateDecision,
  GateDecisionInput,
  GateRequest,
  GateVerificationContext,
  GateVerificationResult,
  RealityGrant,
} from "./types.js";

export interface RealityGateOptions {
  secret: string;
  ledger: Ledger;
  defaultTtlMs?: number;
  maxTtlMs?: number;
  replayStore?: ReplayStore;
  now?: () => number;
}

export interface CreateGateRequestInput {
  manifest: PhiBotManifest;
  runId: string;
  capability: string;
  actionClass: AuthorityClass;
  input: unknown;
}

function optionalReason(reason: string | undefined): { reason?: string } {
  return reason === undefined || reason.trim() === ""
    ? {}
    : { reason: reason.trim() };
}

export class RealityGate {
  private readonly secret: string;
  private readonly ledger: Ledger;
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;
  private readonly replayStore: ReplayStore;
  private readonly now: () => number;

  constructor(options: RealityGateOptions) {
    if (options.secret.length < 16) {
      throw new Error("Reality Gate secret must be at least 16 characters.");
    }

    this.secret = options.secret;
    this.ledger = options.ledger;
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000;
    this.maxTtlMs = options.maxTtlMs ?? 300_000;
    this.replayStore = options.replayStore ?? new MemoryReplayStore();
    this.now = options.now ?? Date.now;

    if (this.defaultTtlMs < 1 || this.defaultTtlMs > this.maxTtlMs) {
      throw new Error("Reality Gate TTL configuration is invalid.");
    }
  }

  private async record(
    runId: string,
    botId: string,
    botVersion: string,
    status: LedgerReceipt["status"],
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<LedgerReceipt> {
    const receipt: LedgerReceipt = {
      schema: "phibot.receipt.v1",
      runId,
      botId,
      botVersion,
      stage: "gate",
      timestamp: new Date(this.now()).toISOString(),
      status,
      summary,
      metadata,
    };
    await this.ledger.append(receipt);
    return receipt;
  }

  async createRequest(input: CreateGateRequestInput): Promise<GateRequest> {
    const request: GateRequest = {
      schema: "phibot.gate.request.v1",
      requestId: randomUUID(),
      runId: input.runId,
      botId: input.manifest.id,
      botVersion: input.manifest.version,
      capability: input.capability,
      actionClass: input.actionClass,
      inputDigest: digestInput(input.input),
      createdAt: new Date(this.now()).toISOString(),
    };

    await this.record(
      request.runId,
      request.botId,
      request.botVersion,
      "escalate",
      `Reality Gate request created for ${request.capability}.`,
      {
        gate: {
          event: "request",
          requestId: request.requestId,
          capability: request.capability,
          actionClass: request.actionClass,
          inputDigest: request.inputDigest,
        },
      },
    );

    return request;
  }

  async decide(
    request: GateRequest,
    input: GateDecisionInput,
  ): Promise<GateDecision> {
    const decidedAt = new Date(this.now()).toISOString();
    const base = {
      schema: "phibot.gate.decision.v1" as const,
      decisionId: randomUUID(),
      requestId: request.requestId,
      outcome: input.outcome,
      decidedAt,
      ...optionalReason(input.reason),
    };

    if (input.outcome === "deny") {
      const decision: GateDecision = base;
      await this.record(
        request.runId,
        request.botId,
        request.botVersion,
        "blocked",
        `Reality Gate denied ${request.capability}.`,
        {
          gate: {
            event: "decision",
            decisionId: decision.decisionId,
            requestId: request.requestId,
            outcome: decision.outcome,
            ...(decision.reason === undefined ? {} : { reason: decision.reason }),
          },
        },
      );
      return decision;
    }

    const requestedTtl = input.ttlMs ?? this.defaultTtlMs;
    if (!Number.isInteger(requestedTtl) || requestedTtl < 1) {
      throw new Error("Grant TTL must be a positive integer.");
    }

    if (requestedTtl > this.maxTtlMs) {
      throw new Error(
        `Grant TTL exceeds Reality Gate maximum of ${this.maxTtlMs}ms.`,
      );
    }

    if (input.outcome === "narrow" && requestedTtl >= this.defaultTtlMs) {
      throw new Error(
        "A narrowed grant must use a TTL shorter than the default grant TTL.",
      );
    }

    const issuedAtMs = this.now();
    const unsigned = {
      schema: "phibot.gate.grant.v1" as const,
      grantId: randomUUID(),
      requestId: request.requestId,
      runId: request.runId,
      botId: request.botId,
      capability: request.capability,
      actionClass: request.actionClass,
      inputDigest: request.inputDigest,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + requestedTtl).toISOString(),
      maxUses: 1 as const,
      decision: input.outcome,
    };

    const grant: RealityGrant = {
      ...unsigned,
      signature: signGrant(unsigned, this.secret),
    };

    const decision: GateDecision = {
      ...base,
      grant,
    };

    await this.record(
      request.runId,
      request.botId,
      request.botVersion,
      "ok",
      `Reality Gate issued ${input.outcome} grant for ${request.capability}.`,
      {
        gate: {
          event: "decision",
          decisionId: decision.decisionId,
          requestId: request.requestId,
          outcome: decision.outcome,
          grantId: grant.grantId,
          expiresAt: grant.expiresAt,
          maxUses: grant.maxUses,
          inputDigest: grant.inputDigest,
          ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        },
      },
    );

    return decision;
  }

  async verifyAndConsume(
    grant: RealityGrant,
    context: GateVerificationContext,
    botVersion: string,
  ): Promise<GateVerificationResult> {
    const fail = async (reason: string): Promise<GateVerificationResult> => {
      await this.record(
        context.runId,
        context.botId,
        botVersion,
        "blocked",
        `Reality Gate rejected grant for ${context.capability}: ${reason}`,
        {
          gate: {
            event: "verify",
            grantId: grant.grantId,
            requestId: grant.requestId,
            capability: context.capability,
            result: "rejected",
            reason,
          },
        },
      );
      return {
        valid: false,
        reason,
        grantId: grant.grantId,
        requestId: grant.requestId,
      };
    };

    if (grant.schema !== "phibot.gate.grant.v1") {
      return fail("invalid grant schema");
    }
    if (!verifyGrantSignature(grant, this.secret)) {
      return fail("invalid signature");
    }
    if (Date.parse(grant.expiresAt) <= this.now()) {
      return fail("grant expired");
    }
    if (grant.runId !== context.runId) {
      return fail("run ID mismatch");
    }
    if (grant.botId !== context.botId) {
      return fail("bot ID mismatch");
    }
    if (grant.capability !== context.capability) {
      return fail("capability mismatch");
    }
    if (grant.actionClass !== context.actionClass) {
      return fail("authority class mismatch");
    }
    if (grant.inputDigest !== digestInput(context.input)) {
      return fail("tool input does not match approved digest");
    }

    const consumed = await this.replayStore.consume(grant.grantId);
    if (!consumed) {
      return fail("grant replay detected");
    }

    await this.record(
      context.runId,
      context.botId,
      botVersion,
      "ok",
      `Reality Gate accepted grant for ${context.capability}.`,
      {
        gate: {
          event: "verify",
          grantId: grant.grantId,
          requestId: grant.requestId,
          capability: context.capability,
          result: "accepted",
          consumedUse: 1,
          maxUses: grant.maxUses,
        },
      },
    );

    return {
      valid: true,
      reason: "grant accepted",
      grantId: grant.grantId,
      requestId: grant.requestId,
    };
  }
}
