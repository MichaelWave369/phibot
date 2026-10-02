import type { AcceptanceProviderMode } from "../acceptance/types.js";
import type {
  QualificationPreflight,
  QualificationPreflightCheck,
} from "./types.js";

export interface QualificationDoctorOptions {
  mode?: AcceptanceProviderMode;
  ollamaHost?: string;
  requiredModel?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  inferenceTimeoutMs?: number;
  now?: () => number;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: unknown;
    model?: unknown;
  }>;
}

function nodeMajor(): number {
  const major = Number(process.versions.node.split(".")[0]);
  return Number.isFinite(major) ? major : 0;
}

function normalizeHost(value: string): string {
  return value.replace(/\/$/, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function check(
  name: string,
  passed: boolean,
  detail: string,
): QualificationPreflightCheck {
  return {
    name,
    status: passed ? "pass" : "fail",
    detail,
  };
}

export async function runQualificationDoctor(
  options: QualificationDoctorOptions = {},
): Promise<QualificationPreflight> {
  const mode = options.mode ?? "ollama";
  const now = options.now ?? Date.now;
  const checks: QualificationPreflightCheck[] = [];
  const availableModels: string[] = [];

  const major = nodeMajor();
  checks.push(
    check(
      "node.version",
      major >= 22,
      `Node ${process.version}; required major >= 22.`,
    ),
  );

  if (mode === "deterministic") {
    return {
      schema: "phibot.qualification.preflight.v1",
      checkedAt: new Date(now()).toISOString(),
      providerMode: mode,
      availableModels,
      checks,
      passed: checks.every((item) => item.status === "pass"),
    };
  }

  const host = normalizeHost(
    options.ollamaHost ??
      process.env.OLLAMA_HOST ??
      "http://127.0.0.1:11434",
  );
  const requiredModel = options.requiredModel ?? "qwen3:4b";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const inferenceTimeoutMs = options.inferenceTimeoutMs ?? 60_000;
  let ollamaVersion: string | undefined;
  let inferenceLatencyMs: number | undefined;

  try {
    const versionBody = (await fetchJson(
      fetchImpl,
      `${host}/api/version`,
      timeoutMs,
    )) as { version?: unknown };
    ollamaVersion =
      typeof versionBody.version === "string"
        ? versionBody.version
        : undefined;

    checks.push(
      check(
        "ollama.reachable",
        true,
        `Ollama reachable at ${host}${ollamaVersion ? `; version ${ollamaVersion}` : ""}.`,
      ),
    );
  } catch (error: unknown) {
    checks.push(
      check(
        "ollama.reachable",
        false,
        `Ollama unavailable at ${host}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  if (checks.at(-1)?.status === "pass") {
    try {
      const tags = (await fetchJson(
        fetchImpl,
        `${host}/api/tags`,
        timeoutMs,
      )) as OllamaTagsResponse;

      for (const model of tags.models ?? []) {
        if (typeof model.name === "string") availableModels.push(model.name);
        else if (typeof model.model === "string") {
          availableModels.push(model.model);
        }
      }

      const normalized = uniqueSorted(availableModels);
      availableModels.length = 0;
      availableModels.push(...normalized);

      const hasModel = availableModels.includes(requiredModel);
      checks.push(
        check(
          "ollama.model",
          hasModel,
          hasModel
            ? `Required model present: ${requiredModel}.`
            : `Required model missing: ${requiredModel}. Available: ${availableModels.join(", ") || "(none)"}.`,
        ),
      );
    } catch (error: unknown) {
      checks.push(
        check(
          "ollama.model",
          false,
          `Unable to inspect Ollama models: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  } else {
    checks.push(
      check(
        "ollama.model",
        false,
        `Model check skipped because Ollama is unreachable; required ${requiredModel}.`,
      ),
    );
  }

  const modelReady =
    checks.find((item) => item.name === "ollama.model")?.status === "pass";

  if (modelReady) {
    const started = Date.now();
    try {
      const body = (await fetchJson(
        fetchImpl,
        `${host}/api/chat`,
        inferenceTimeoutMs,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: requiredModel,
            stream: false,
            format: "json",
            think: false,
            keep_alive: "10m",
            messages: [
              {
                role: "user",
                content:
                  'Return exactly this JSON object and nothing else: {"ok":true}',
              },
            ],
            options: {
              temperature: 0,
              num_predict: 32,
            },
          }),
        },
      )) as {
        message?: { content?: unknown };
      };

      inferenceLatencyMs = Date.now() - started;
      const content =
        typeof body.message?.content === "string"
          ? body.message.content
          : "";
      let valid = false;

      try {
        const parsed = JSON.parse(content) as { ok?: unknown };
        valid = parsed.ok === true;
      } catch {
        valid = false;
      }

      checks.push(
        check(
          "ollama.inference",
          valid,
          valid
            ? `Model completed bounded no-think JSON probe in ${inferenceLatencyMs}ms.`
            : "Model responded, but bounded JSON probe did not satisfy the contract.",
        ),
      );
    } catch (error: unknown) {
      inferenceLatencyMs = Date.now() - started;
      checks.push(
        check(
          "ollama.inference",
          false,
          `Model inference probe failed after ${inferenceLatencyMs}ms: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  } else {
    checks.push(
      check(
        "ollama.inference",
        false,
        "Inference probe skipped because the required model is not ready.",
      ),
    );
  }

  return {
    schema: "phibot.qualification.preflight.v1",
    checkedAt: new Date(now()).toISOString(),
    providerMode: mode,
    ollamaHost: host,
    requiredModel,
    ...(ollamaVersion === undefined ? {} : { ollamaVersion }),
    ...(inferenceLatencyMs === undefined
      ? {}
      : { inferenceLatencyMs }),
    availableModels,
    checks,
    passed: checks.every((item) => item.status === "pass"),
  };
}
