import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderRequest } from "../src/providers/types.js";
import { OllamaProvider } from "../src/providers/ollama.js";

const request: ProviderRequest = {
  stage: "observe",
  manifest: {
    id: "ollama-test",
    name: "Ollama Test",
    version: "1",
    role: "test",
    description: "provider fixture",
    model: { provider: "ollama", name: "qwen3:4b" },
    memory: { scope: "task", maxDepth: 2 },
    capabilities: ["repo.read"],
    authority: {
      read: true,
      propose: true,
      write: false,
      deploy: false,
    },
    escalation: {
      target: "vessie",
      confidenceBelow: 0.5,
    },
  },
  input: { task: "inspect" },
  prior: [],
};

test("Ollama governed contract disables thinking and bounds generation", async () => {
  let body: Record<string, unknown> | undefined;

  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: "qwen3:4b",
        message: {
          role: "assistant",
          content: '{"summary":"ok","confidence":0.9}',
        },
        prompt_eval_count: 20,
        eval_count: 8,
        total_duration: 10_000_000,
        load_duration: 1_000_000,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const provider = new OllamaProvider("qwen3:4b", {
    fetchImpl,
  });
  const completion = await provider.complete(request);

  assert.equal(completion.provider, "ollama");
  assert.equal(body?.think, false);
  assert.equal(body?.keep_alive, "10m");

  const options = body?.options as Record<string, unknown>;
  assert.equal(options.temperature, 0);
  assert.equal(options.num_predict, 256);
});
