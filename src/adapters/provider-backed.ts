import type { PhiBotAdapter } from "./dry-run.js";
import type {
  AuthorityClass,
  BotInput,
  PhiBotManifest,
  ProviderTrace,
  ProposedAction,
  StageResult,
  VesselStage,
} from "../core/types.js";
import type { PhiProvider, ProviderCompletion } from "../providers/types.js";

type ExecutableStage = Exclude<VesselStage, "ledger">;

interface ProviderPayload {
  summary: string;
  confidence: number;
  action?: ProposedAction;
}

const AUTHORITY_CLASSES = new Set<AuthorityClass>([
  "read",
  "propose",
  "write",
  "deploy",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProviderPayload(content: string): ProviderPayload {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Provider contract violation: response is not valid JSON.");
  }

  if (!isRecord(value)) {
    throw new Error("Provider contract violation: response must be an object.");
  }
  if (typeof value.summary !== "string" || value.summary.trim() === "") {
    throw new Error("Provider contract violation: summary must be a non-empty string.");
  }
  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new Error("Provider contract violation: confidence must be between 0 and 1.");
  }

  let action: ProposedAction | undefined;
  if (value.action !== undefined && value.action !== null) {
    if (
      !isRecord(value.action) ||
      typeof value.action.capability !== "string" ||
      typeof value.action.external !== "boolean" ||
      typeof value.action.description !== "string"
    ) {
      throw new Error("Provider contract violation: action has an invalid shape.");
    }

    let authority: AuthorityClass | undefined;
    if (value.action.authority !== undefined) {
      if (
        typeof value.action.authority !== "string" ||
        !AUTHORITY_CLASSES.has(value.action.authority as AuthorityClass)
      ) {
        throw new Error("Provider contract violation: action.authority is invalid.");
      }
      authority = value.action.authority as AuthorityClass;
    }

    action = {
      capability: value.action.capability,
      external: value.action.external,
      description: value.action.description,
      ...(authority === undefined ? {} : { authority }),
      ...(value.action.input === undefined ? {} : { input: value.action.input }),
    };
  }

  return {
    summary: value.summary,
    confidence: value.confidence,
    ...(action === undefined ? {} : { action }),
  };
}

function trace(completion: ProviderCompletion): ProviderTrace {
  return {
    provider: completion.provider,
    model: completion.model,
    fallback: completion.fallback,
    latencyMs: completion.metrics.latencyMs,
    ...(completion.metrics.inputTokens === undefined
      ? {}
      : { inputTokens: completion.metrics.inputTokens }),
    ...(completion.metrics.outputTokens === undefined
      ? {}
      : { outputTokens: completion.metrics.outputTokens }),
    ...(completion.metrics.totalTokens === undefined
      ? {}
      : { totalTokens: completion.metrics.totalTokens }),
    ...(completion.metrics.providerDurationMs === undefined
      ? {}
      : { providerDurationMs: completion.metrics.providerDurationMs }),
    ...(completion.metrics.loadDurationMs === undefined
      ? {}
      : { loadDurationMs: completion.metrics.loadDurationMs }),
    ...(completion.fallbackReason === undefined
      ? {}
      : { fallbackReason: completion.fallbackReason }),
  };
}

export class ProviderBackedAdapter implements PhiBotAdapter {
  constructor(private readonly provider: PhiProvider) {}

  private async execute(
    stage: ExecutableStage,
    manifest: PhiBotManifest,
    input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult> {
    const completion = await this.provider.complete({
      stage,
      manifest,
      input,
      prior,
    });
    const payload = parseProviderPayload(completion.content);

    return {
      stage,
      summary: payload.summary,
      confidence: payload.confidence,
      ...(payload.action === undefined ? {} : { action: payload.action }),
      provider: trace(completion),
    };
  }

  observe(manifest: PhiBotManifest, input: BotInput): Promise<StageResult> {
    return this.execute("observe", manifest, input, []);
  }

  interpret(
    manifest: PhiBotManifest,
    input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult> {
    return this.execute("interpret", manifest, input, prior);
  }

  propose(
    manifest: PhiBotManifest,
    input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult> {
    return this.execute("propose", manifest, input, prior);
  }

  verify(
    manifest: PhiBotManifest,
    input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult> {
    return this.execute("verify", manifest, input, prior);
  }
}

export { parseProviderPayload };
