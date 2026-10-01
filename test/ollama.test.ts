import assert from "node:assert/strict";
import test from "node:test";
import type { PhiBotManifest } from "../src/core/types.js";
import { OllamaProvider } from "../src/providers/ollama.js";

const manifest: PhiBotManifest = {
  id: "local-testbot",
  name: "Local TestBot",
  version: "0.2.0",
  role: "test",
  description: "ollama fixture",
  model: { provider: "ollama", name: "qwen3:4b" },
  memory: { scope: "task", maxDepth: 1 },
  capabilities: ["repo.read"],
  authority: { read: true, propose: true, write: false, deploy: false },
  escalation: { target: "vessie", confidenceBelow: 0.5 }
};

test("maps Ollama chat response into provider completion metrics", async () => {
  const fakeFetch: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(request.model, "qwen3:4b");
    assert.equal(request.stream, false);
    assert.equal(request.format, "json");

    return new Response(
      JSON.stringify({
        model: "qwen3:4b",
        message: {
          role: "assistant",
          content: JSON.stringify({
            summary: "Repository boundary observed.",
            confidence: 0.91,
          }),
        },
        prompt_eval_count: 12,
        eval_count: 5,
        total_duration: 12_500_000,
        load_duration: 2_000_000,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const provider = new OllamaProvider("qwen3:4b", {
    baseUrl: "http://ollama.test",
    fetchImpl: fakeFetch,
  });

  const result = await provider.complete({
    stage: "observe",
    manifest,
    input: { task: "inspect repository" },
    prior: [],
  });

  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "qwen3:4b");
  assert.equal(result.metrics.inputTokens, 12);
  assert.equal(result.metrics.outputTokens, 5);
  assert.equal(result.metrics.totalTokens, 17);
  assert.equal(result.metrics.providerDurationMs, 12.5);
  assert.equal(result.metrics.loadDurationMs, 2);
});
