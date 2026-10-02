import type { PhiBotManifest } from "../core/types.js";

export type ServiceLifecycle = "stopped" | "running";
export type BotServiceState = "idle" | "running" | "disabled" | "error";

export interface RegisteredBot {
  manifest: PhiBotManifest;
  registeredAt: string;
  updatedAt: string;
  state: BotServiceState;
  activeRuns: number;
}

export interface ResourceBudgetConfig {
  maxConcurrentRuns: number;
  maxRunsPerWindow: number;
  windowMs: number;
  maxProviderTokensPerRun: number;
  maxToolCallsPerRun: number;
}

export interface RunBudgetUsage {
  runId: string;
  botId: string;
  startedAt: string;
  providerTokens: number;
  toolCalls: number;
}

export type PhiBotServiceEventType =
  | "service.started"
  | "service.stopped"
  | "bot.registered"
  | "bot.unregistered"
  | "bot.state"
  | "run.started"
  | "run.finished"
  | "budget.blocked"
  | "budget.updated";

export interface PhiBotServiceEvent {
  schema: "phibot.service.event.v1";
  eventId: string;
  type: PhiBotServiceEventType;
  timestamp: string;
  botId?: string;
  runId?: string;
  detail?: Record<string, unknown>;
}

export interface PhiBotServiceSnapshot {
  schema: "phibot.service.snapshot.v1";
  lifecycle: ServiceLifecycle;
  startedAt?: string;
  stateDir: string;
  bots: RegisteredBot[];
  activeRuns: RunBudgetUsage[];
  budgets: ResourceBudgetConfig;
  eventCount: number;
}

export interface PhiBotServiceOptions {
  stateDir?: string;
  budgets?: Partial<ResourceBudgetConfig>;
  now?: () => number;
}

export interface PhiBotServiceHttpOptions {
  host?: string;
  port?: number;
}
