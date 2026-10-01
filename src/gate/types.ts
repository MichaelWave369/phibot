import type { AuthorityClass } from "../core/types.js";

export interface GateRequest {
  schema: "phibot.gate.request.v1";
  requestId: string;
  runId: string;
  botId: string;
  botVersion: string;
  capability: string;
  actionClass: AuthorityClass;
  inputDigest: string;
  createdAt: string;
}

export type GateDecisionOutcome = "approve" | "deny" | "narrow";

export interface GateDecisionInput {
  outcome: GateDecisionOutcome;
  reason?: string;
  ttlMs?: number;
}

export interface RealityGrant {
  schema: "phibot.gate.grant.v1";
  grantId: string;
  requestId: string;
  runId: string;
  botId: string;
  capability: string;
  actionClass: AuthorityClass;
  inputDigest: string;
  issuedAt: string;
  expiresAt: string;
  maxUses: 1;
  decision: "approve" | "narrow";
  signature: string;
}

export interface GateDecision {
  schema: "phibot.gate.decision.v1";
  decisionId: string;
  requestId: string;
  outcome: GateDecisionOutcome;
  reason?: string;
  decidedAt: string;
  grant?: RealityGrant;
}

export interface GateVerificationContext {
  runId: string;
  botId: string;
  capability: string;
  actionClass: AuthorityClass;
  input: unknown;
}

export interface GateVerificationResult {
  valid: boolean;
  reason: string;
  grantId: string;
  requestId: string;
}
