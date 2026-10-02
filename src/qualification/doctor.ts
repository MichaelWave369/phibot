import { parseProviderPayload } from "../adapters/provider-backed.js";
import type { AcceptanceProviderMode } from "../acceptance/types.js";
import { OllamaProvider } from "../providers/ollama.js";
import type { ProviderRequest } from "../providers/types.js";
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
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
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

function providerProbeRequest(model: string): ProviderRequest {
  return {
    stage: "observe",
    manifest: {
      id: "qualification-probe",
      name: "Qualification Probe",
      version: "1.0.0",
      role: "qualification_probe",
      description:
        "Bounded representative probe for the PhiBot governed provider contract.",
      model: { provider: "ollama", name: model },
      memory: { scope: "task", maxDepth: 2 },
      capabilities: ["repo.read", "repo.patch", "tests.run"],
      authority: {
        read: true,
        propose: true,
        write: "gated",
        deploy: false,
      },
      escalation: {
        target: "vessie",
        confidenceBelow: 0.7,
      },
    },
    input: {
      task:
        "Inspect a bounded README repair fixture and summarize the safest next action.",
      context: {
        taskId: "qualification-probe",
        memoryPacketId: "probe-packet",
      },
    },
    prior: [],
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
  let inferenceAttempts: number | undefined;
  let inferenceRetryReason: string | undefined;

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
    const provider = new OllamaProvider(requiredModel, {
      baseUrl: host,
      timeoutMs: inferenceTimeoutMs,
      fetchImpl,
      think: false,
      keepAlive: "10m",
      numPredict: 160,
      repeatRecovery: true,
    });

    try {
      const completion = await provider.complete(
        providerProbeRequest(requiredModel),
      );
      parseProviderPayload(completion.content);
      inferenceLatencyMs = completion.metrics.latencyMs;
      inferenceAttempts = completion.metrics.attempts ?? 1;
      inferenceRetryReason = completion.metrics.retryReason;

      checks.push(
        check(
          "ollama.inference",
          true,
          `Representative governed provider probe completed in ${inferenceLatencyMs}ms over ${inferenceAttempts} attempt(s)${inferenceRetryReason ? `; recovered from ${inferenceRetryReason}` : ""}.`,
        ),
      );
    } catch (error: unknown) {
      checks.push(
        check(
          "ollama.inference",
          false,
          `Representative governed provider probe failed: ${error instanceof Error ? error.message : String(error)}`,
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
    ...(inferenceAttempts === undefined
      ? {}
      : { inferenceAttempts }),
    ...(inferenceRetryReason === undefined
      ? {}
      : { inferenceRetryReason }),
    availableModels,
    checks,
    passed: checks.every((item) => item.status === "pass"),
  };
}
