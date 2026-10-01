export { DryRunAdapter } from "./adapters/dry-run.js";
export type { PhiBotAdapter } from "./adapters/dry-run.js";
export { ProviderBackedAdapter, parseProviderPayload } from "./adapters/provider-backed.js";
export {
  evaluateAuthority,
  evaluateAuthorityMode,
  evaluateManifestAuthority,
} from "./core/authority.js";
export { FileLedger, MemoryLedger } from "./core/ledger.js";
export type { Ledger } from "./core/ledger.js";
export { loadManifest, validateManifest } from "./core/manifest.js";
export { PhiBotRuntime } from "./core/runtime.js";
export {
  canonicalize,
  digestInput,
  signGrant,
  verifyGrantSignature,
} from "./gate/crypto.js";
export { MemoryReplayStore } from "./gate/replay.js";
export type { ReplayStore } from "./gate/replay.js";
export { RealityGate } from "./gate/reality-gate.js";
export type {
  CreateGateRequestInput,
  RealityGateOptions,
} from "./gate/reality-gate.js";
export type {
  GateDecision,
  GateDecisionInput,
  GateDecisionOutcome,
  GateRequest,
  GateVerificationContext,
  GateVerificationResult,
  RealityGrant,
} from "./gate/types.js";
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
export {
  addCapability,
  createBuiltinToolRegistry,
  echoCapability,
} from "./tools/builtins.js";
export { ToolExecutor } from "./tools/executor.js";
export { ToolCapabilityRegistry } from "./tools/registry.js";
export { ToolSandbox } from "./tools/sandbox.js";
export type {
  AnyToolCapability,
  ToolCapability,
  ToolExecutionContext,
  ToolExecutionEnvelope,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutorOptions,
} from "./tools/types.js";
export type {
  AuthorityClass,
  AuthorityMode,
  BotInput,
  LedgerReceipt,
  PhiBotManifest,
  ProposedAction,
  ProviderTrace,
  ReceiptStage,
  RunResult,
  StageResult,
  VesselStage,
} from "./core/types.js";
