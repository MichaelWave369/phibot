export { DryRunAdapter } from "./adapters/dry-run.js";
export type { PhiBotAdapter } from "./adapters/dry-run.js";
export { ProviderBackedAdapter, parseProviderPayload } from "./adapters/provider-backed.js";
export { evaluateAuthority } from "./core/authority.js";
export { FileLedger, MemoryLedger } from "./core/ledger.js";
export type { Ledger } from "./core/ledger.js";
export { loadManifest, validateManifest } from "./core/manifest.js";
export { PhiBotRuntime } from "./core/runtime.js";
export { DryRunProvider } from "./providers/dry-run.js";
export { FallbackProvider } from "./providers/fallback.js";
export { OllamaProvider } from "./providers/ollama.js";
export type { OllamaProviderOptions } from "./providers/ollama.js";
export {
  ProviderRegistry,
  createDefaultProviderRegistry,
} from "./providers/registry.js";
export type {
  DefaultProviderRegistryOptions,
  ProviderResolutionOptions,
} from "./providers/registry.js";
export type {
  PhiProvider,
  ProviderCompletion,
  ProviderFactory,
  ProviderMetrics,
  ProviderRequest,
} from "./providers/types.js";
export type {
  AuthorityMode,
  BotInput,
  LedgerReceipt,
  PhiBotManifest,
  ProviderTrace,
  RunResult,
  StageResult,
  VesselStage,
} from "./core/types.js";
