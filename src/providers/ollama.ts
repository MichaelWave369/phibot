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
}

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

function buildMessages(
  request: ProviderRequest,
): Array<{ role: "system" | "user"; content: string }> {
  const system = [
    "You are the execution brain for a governed PhiBot.",
    "Return exactly one JSON object and no markdown.",
    '{"summary": string, "confidence": number between 0 and 1} are required.',
    'Optional action: {"capability": string, "external": boolean, "description": string, "authority"?: "read"|"propose"|"write"|"deploy", "input"?: any}.',
    "Be concise. Do not emit chain-of-thought or hidden reasoning.",
    "Never invent capabilities. If uncertain, lower confidence instead of pretending.",
    "The runtime and tool registry are authoritative for permissions and action classes.",
    "An action is a proposal only; runtime authority checks happen after your response.",
  ].join(" ");

  const user = JSON.stringify({
    stage: request.stage,
    bot: {
      id: request.manifest.id,
      name: request.manifest.name,
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
    this.numPredict = options.numPredict ?? 256;

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("Ollama timeoutMs must be a positive integer.");
    }
    if (!Number.isInteger(this.numPredict) || this.numPredict < 1) {
      throw new Error("Ollama numPredict must be a positive integer.");
    }
  }

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
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
          format: "json",
          think: this.think,
          keep_alive: this.keepAlive,
          messages: buildMessages(request),
          options: {
            temperature: 0,
            num_predict: this.numPredict,
          },
        }),
      });

      const latencyMs = Date.now() - started;

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Ollama request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }

      const body = (await response.json()) as unknown;
      if (
        !isRecord(body) ||
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
        latencyMs,
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
}
