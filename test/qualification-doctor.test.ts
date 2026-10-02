import assert from "node:assert/strict";
import test from "node:test";
import { runQualificationDoctor } from "../src/qualification/doctor.js";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("deterministic doctor requires only supported Node runtime", async () => {
  let calls = 0;
  const preflight = await runQualificationDoctor({
    mode: "deterministic",
    fetchImpl: (async () => {
      calls += 1;
      throw new Error("must not fetch");
    }) as typeof fetch,
  });

  assert.equal(preflight.passed, true);
  assert.equal(calls, 0);
  assert.equal(preflight.checks[0]?.name, "node.version");
});

test("Ollama doctor uses representative PhiBot provider contract", async () => {
  let inferenceBody: Record<string, unknown> | undefined;

  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/api/version")) {
      return response({ version: "0.35.0" });
    }

    if (url.endsWith("/api/tags")) {
      return response({
        models: [
          { name: "qwen3:4b" },
          { name: "gemma3:12b" },
        ],
      });
    }

    if (url.endsWith("/api/chat")) {
      inferenceBody = JSON.parse(
        String(init?.body),
      ) as Record<string, unknown>;
      return response({
        model: "qwen3:4b",
        message: {
          role: "assistant",
          content: '{"summary":"bounded probe ok","confidence":0.95}',
        },
        prompt_eval_count: 60,
        eval_count: 12,
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const preflight = await runQualificationDoctor({
    mode: "ollama",
    fetchImpl,
  });

  assert.equal(preflight.passed, true);
  assert.equal(preflight.ollamaVersion, "0.35.0");
  assert.equal(preflight.inferenceAttempts, 1);

  const messages = inferenceBody?.messages as Array<{
    role: string;
    content: string;
  }>;
  assert.equal(
    messages[1]?.content.includes("qualification-probe"),
    true,
  );
  assert.equal(typeof inferenceBody?.format, "object");
});

test("Ollama doctor reports repeat-limit recovery", async () => {
  let chatCalls = 0;

  const fetchImpl = (async (
    input: string | URL | Request,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/api/version")) {
      return response({ version: "0.35.0" });
    }

    if (url.endsWith("/api/tags")) {
      return response({
        models: [{ name: "qwen3:4b" }],
      });
    }

    if (url.endsWith("/api/chat")) {
      chatCalls += 1;
      if (chatCalls === 1) {
        return new Response(
          '{"error":"prediction aborted, token repeat limit reached"}',
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return response({
        model: "qwen3:4b",
        message: {
          role: "assistant",
          content: '{"summary":"recovered","confidence":0.8}',
        },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const preflight = await runQualificationDoctor({
    mode: "ollama",
    fetchImpl,
  });

  assert.equal(preflight.passed, true);
  assert.equal(preflight.inferenceAttempts, 2);
  assert.equal(
    preflight.inferenceRetryReason,
    "token_repeat_limit",
  );
});

test("Ollama doctor fails cleanly when required model is absent", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/api/version")) {
      return response({ version: "0.35.0" });
    }

    if (url.endsWith("/api/tags")) {
      return response({
        models: [{ name: "gemma3:12b" }],
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const preflight = await runQualificationDoctor({
    mode: "ollama",
    fetchImpl,
    requiredModel: "qwen3:4b",
  });

  assert.equal(preflight.passed, false);
  assert.equal(
    preflight.checks.find((item) => item.name === "ollama.model")?.status,
    "fail",
  );
  assert.equal(
    preflight.checks.find((item) => item.name === "ollama.inference")?.status,
    "fail",
  );
});
