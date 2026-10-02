import type {
  BotInput,
  PhiBotManifest,
  StageResult,
  VesselStage,
} from "../core/types.js";

export interface ProviderRequest {
  stage: Exclude<VesselStage, "ledger">;
  manifest: PhiBotManifest;
  input: BotInput;
  prior: StageResult[];
}

export interface ProviderMetrics {
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  providerDurationMs?: number;
  loadDurationMs?: number;
  attempts?: number;
  retryReason?: string;
}

export interface ProviderCompletion {
  provider: string;
  model: string;
  content: string;
  fallback: boolean;
  metrics: ProviderMetrics;
  fallbackReason?: string;
}

export interface PhiProvider {
  readonly id: string;
  readonly model: string;
  complete(request: ProviderRequest): Promise<ProviderCompletion>;
}

export type ProviderFactory = (model: string) => PhiProvider;
