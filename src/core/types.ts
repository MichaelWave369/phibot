export type AuthorityMode = boolean | "gated";

export type VesselStage =
  | "observe"
  | "interpret"
  | "propose"
  | "verify"
  | "ledger";

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
  authority: {
    read: AuthorityMode;
    propose: AuthorityMode;
    write: AuthorityMode;
    deploy: AuthorityMode;
  };
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

export interface StageResult {
  stage: Exclude<VesselStage, "ledger">;
  summary: string;
  confidence: number;
  action?: {
    capability: string;
    external: boolean;
    description: string;
  };
  provider?: ProviderTrace;
}

export interface LedgerReceipt {
  schema: "phibot.receipt.v1";
  runId: string;
  botId: string;
  botVersion: string;
  stage: VesselStage;
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
