export { DryRunAdapter } from "./adapters/dry-run.js";
export type { PhiBotAdapter } from "./adapters/dry-run.js";
export { ProviderBackedAdapter, parseProviderPayload } from "./adapters/provider-backed.js";
export {
  CommonLine,
  DEFAULT_GROUP_TTL_MS,
  MAX_GROUP_TTL_MS,
} from "./commonline/commonline.js";
export type { CommonLineOptions } from "./commonline/commonline.js";
export {
  MemoryCommonLineGroupStore,
} from "./commonline/groups.js";
export type { CommonLineGroupStore } from "./commonline/groups.js";
export {
  MemoryCommonLineTransport,
} from "./commonline/transport.js";
export type { CommonLineTransport } from "./commonline/transport.js";
export type {
  CommonLineAddress,
  CommonLineCoordinatorInput,
  CommonLineEnvelope,
  CommonLineGroup,
  CommonLineGroupSendInput,
  CommonLineHandoffInput,
  CommonLineMessageKind,
  CommonLinePayload,
  CommonLineSendInput,
  CommonLineSender,
  CreateGroupInput,
} from "./commonline/types.js";
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
export {
  DEFAULT_POLICY,
  NbgMemoryPods,
  botBubbleId,
  taskBubbleId,
} from "./memory/pods.js";
export type { NbgMemoryPodsOptions } from "./memory/pods.js";
export { MemoryMemoryStore } from "./memory/store.js";
export type { MemoryStore } from "./memory/store.js";
export type {
  MemoryCompactionResult,
  MemoryEscalationPacket,
  MemoryEscalationRecord,
  MemoryPolicy,
  MemoryProvenance,
  MemoryRecord,
  MemoryRetrieveOptions,
  MemoryScope,
  MemorySource,
  MemorySourceKind,
  MemoryWriteInput,
} from "./memory/types.js";
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
