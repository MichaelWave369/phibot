export type AuthorityMode = boolean | "gated";

export type AuthorityClass = "read" | "propose" | "write" | "deploy";

export type VesselStage =
  | "observe"
  | "interpret"
  | "propose"
  | "verify"
  | "ledger";

export type ReceiptStage = VesselStage | "tool" | "gate" | "memory";

export interface PhiBotManifest {
  id: string;
  name: string;
  version: string;
  role: string;
  description: string;
  model: {
    provider: string;
    name: string;
  };
  memory: {
    scope: string;
    maxDepth: number;
  };
  capabilities: string[];
  authority: Record<AuthorityClass, AuthorityMode>;
  escalation: {
    target: string;
    confidenceBelow: number;
  };
}

export interface BotInput {
  task: string;
  context?: Record<string, unknown>;
}

export interface ProviderTrace {
  provider: string;
  model: string;
  fallback: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  providerDurationMs?: number;
  loadDurationMs?: number;
  fallbackReason?: string;
}

export interface ProposedAction {
  capability: string;
  external: boolean;
  description: string;
  authority?: AuthorityClass;
  input?: unknown;
}

export interface StageResult {
  stage: Exclude<VesselStage, "ledger">;
  summary: string;
  confidence: number;
  action?: ProposedAction;
  provider?: ProviderTrace;
}

export interface LedgerReceipt {
  schema: "phibot.receipt.v1";
  runId: string;
  botId: string;
  botVersion: string;
  stage: ReceiptStage;
  timestamp: string;
  status: "ok" | "blocked" | "escalate";
  summary: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface RunResult {
  runId: string;
  botId: string;
  status: "completed" | "blocked" | "escalated";
  stages: StageResult[];
  receipts: LedgerReceipt[];
}
