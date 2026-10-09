import type {
  ProviderCompletion,
  ProviderMetrics,
  ProviderRequest,
  PhiProvider,
} from "./types.js";

export interface OllamaProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  think?: boolean | string | null;
  keepAlive?: string | number;
  numPredict?: number;
  repeatRecovery?: boolean;
  /** Action-free schema, used only by the local Scout shadow pilot. */
  responseMode?: "stage" | "advisory-only";
}

interface AttemptProfile {
  temperature: number;
  repeatPenalty?: number;
  repeatLastN?: number;
}

class OllamaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(
      `Ollama request failed with HTTP ${status}${detail ? `: ${detail}` : ""}`,
    );
    this.name = "OllamaHttpError";
  }
}

const STAGE_FORMAT = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 600,
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    action: {
      type: "object",
      additionalProperties: false,
      properties: {
        capability: { type: "string", minLength: 1 },
        external: { type: "boolean" },
        description: { type: "string", minLength: 1, maxLength: 400 },
        authority: {
          type: "string",
          enum: ["read", "propose", "write", "deploy"],
        },
        input: {},
      },
      required: ["capability", "external", "description"],
    },
  },
  required: ["summary", "confidence"],
} as const;

export const ADVISORY_ONLY_FORMAT = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 240 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["summary", "confidence"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nsToMs(value: unknown): number | undefined {
  const number = asNumber(value);
  return number === undefined ? undefined : number / 1_000_000;
}

function isRepeatLimitError(error: unknown): error is OllamaHttpError {
  return (
    error instanceof OllamaHttpError &&
    error.status === 500 &&
    error.detail.toLowerCase().includes("token repeat limit reached")
  );
}

function buildMessages(
  request: ProviderRequest,
  responseMode: "stage" | "advisory-only" = "stage",
): Array<{ role: "system" | "user"; content: string }> {
  const system = responseMode === "advisory-only" ? [
    "You are a local, read-only Scout evidence interpreter, not an execution agent.",
    "Your ONLY response is a JSON object with exactly two fields: summary (string) and confidence (number).",
    "Never include an action field, tool call, instruction, command, capability, or request for authorization.",
    "Describe the evidence as unverified public observation, never authenticated proof.",
    "Write plain advisory prose no longer than 240 characters, with no newlines.",
    "Do not emit chain-of-thought.",
  ].join(" ") : [
    "You are the bounded execution brain for a governed PhiBot.",
    "Return one concise object matching the supplied JSON schema.",
    "Summary must be brief and operational.",
    "Only include action when a concrete capability should be proposed.",
    "Never invent capabilities or authority.",
    "Do not emit chain-of-thought.",
  ].join(" ");

  const user = JSON.stringify({
    stage: request.stage,
    bot: {
      id: request.manifest.id,
      role: request.manifest.role,
      description: request.manifest.description,
    },
    task: request.input.task,
    context: request.input.context ?? {},
    capabilities: request.manifest.capabilities,
    authority: request.manifest.authority,
    prior: request.prior.map((item) => ({
      stage: item.stage,
      summary: item.summary,
      confidence: item.confidence,
      ...(item.action ? { action: item.action } : {}),
    })),
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export class OllamaProvider implements PhiProvider {
  readonly id = "ollama";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly think: boolean | string | null;
  private readonly keepAlive: string | number;
  private readonly numPredict: number;
  private readonly repeatRecovery: boolean;
  private readonly responseMode: "stage" | "advisory-only";

  constructor(model: string, options: OllamaProviderOptions = {}) {
    this.model = model;
    this.baseUrl = (
      options.baseUrl ??
      process.env.OLLAMA_HOST ??
      "http://127.0.0.1:11434"
    ).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.think = options.think ?? false;
    this.keepAlive = options.keepAlive ?? "10m";
    this.numPredict = options.numPredict ?? 160;
    this.repeatRecovery = options.repeatRecovery ?? true;
    this.responseMode = options.responseMode ?? "stage";
    if (this.responseMode !== "stage" && this.responseMode !== "advisory-only") {
      throw new Error("Unknown Ollama response mode.");
    }

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("Ollama timeoutMs must be a positive integer.");
    }
    if (!Number.isInteger(this.numPredict) || this.numPredict < 1) {
      throw new Error("Ollama numPredict must be a positive integer.");
    }
  }

  private async attempt(
    request: ProviderRequest,
    profile: AttemptProfile,
  ): Promise<{ body: Record<string, unknown>; latencyMs: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: this.responseMode === "advisory-only" ? ADVISORY_ONLY_FORMAT : STAGE_FORMAT,
          think: this.think,
          keep_alive: this.keepAlive,
          messages: buildMessages(request, this.responseMode),
          options: {
            temperature: profile.temperature,
            num_predict: this.numPredict,
            ...(profile.repeatPenalty === undefined
              ? {}
              : { repeat_penalty: profile.repeatPenalty }),
            ...(profile.repeatLastN === undefined
              ? {}
              : { repeat_last_n: profile.repeatLastN }),
          },
        }),
      });

      const latencyMs = Date.now() - started;

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new OllamaHttpError(response.status, detail);
      }

      const body = (await response.json()) as unknown;
      if (!isRecord(body)) {
        throw new Error("Ollama returned an invalid chat response.");
      }

      return { body, latencyMs };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Ollama request timed out after ${this.timeoutMs}ms.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const totalStarted = Date.now();
    let attempts = 1;
    let retryReason: string | undefined;
    let result: { body: Record<string, unknown>; latencyMs: number };

    try {
      result = await this.attempt(request, {
        temperature: 0,
      });
    } catch (error: unknown) {
      if (!this.repeatRecovery || !isRepeatLimitError(error)) {
        throw error;
      }

      attempts = 2;
      retryReason = "token_repeat_limit";
      result = await this.attempt(request, {
        temperature: 0.2,
        repeatPenalty: 1.1,
        repeatLastN: 64,
      });
    }

    const body = result.body;
    if (
      !isRecord(body.message) ||
      typeof body.message.content !== "string"
    ) {
      throw new Error("Ollama returned an invalid chat response.");
    }

    const inputTokens = asNumber(body.prompt_eval_count);
    const outputTokens = asNumber(body.eval_count);
    const totalTokens =
      inputTokens === undefined && outputTokens === undefined
        ? undefined
        : (inputTokens ?? 0) + (outputTokens ?? 0);

    const providerDurationMs = nsToMs(body.total_duration);
    const loadDurationMs = nsToMs(body.load_duration);

    const metrics: ProviderMetrics = {
      latencyMs: Date.now() - totalStarted,
      attempts,
      ...(retryReason === undefined ? {} : { retryReason }),
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
      ...(providerDurationMs === undefined
        ? {}
        : { providerDurationMs }),
      ...(loadDurationMs === undefined ? {} : { loadDurationMs }),
    };

    return {
      provider: this.id,
      model: typeof body.model === "string" ? body.model : this.model,
      content: body.message.content,
      fallback: false,
      metrics,
    };
  }
}

export { STAGE_FORMAT };
