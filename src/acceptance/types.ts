export type AcceptanceProviderMode = "deterministic" | "ollama";

export interface AcceptanceChecks {
  spawnRegistered: boolean;
  leastAuthority: boolean;
  memoryPromoted: boolean;
  handoffDelivered: boolean;
  providerCompleted: boolean;
  gateRequired: boolean;
  grantExecutedOnce: boolean;
  grantReplayRejected: boolean;
  budgetTracked: boolean;
  receiptChainPresent: boolean;
  spawnDissolved: boolean;
}

export interface AcceptanceReport {
  schema: "phibot.acceptance.report.v1";
  mode: AcceptanceProviderMode;
  startedAt: string;
  finishedAt: string;
  stateDir: string;
  spawnedBotId: string;
  helperBotId: string;
  serviceRunId: string;
  runtimeRunId: string;
  commonLineGroupId: string;
  handoffMessageId: string;
  memoryPacketId: string;
  gateRequestId: string;
  gateGrantId: string;
  providerIds: string[];
  providerModels: string[];
  providerTokens: number;
  toolCalls: number;
  receiptStages: string[];
  checks: AcceptanceChecks;
  passed: boolean;
}

export interface AcceptanceOptions {
  stateDir: string;
  mode?: AcceptanceProviderMode;
  ollamaHost?: string;
  secret?: string;
  now?: () => number;
}
