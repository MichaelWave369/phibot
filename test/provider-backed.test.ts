import assert from "node:assert/strict";
import test from "node:test";
import { ProviderBackedAdapter, parseProviderPayload } from "../src/adapters/provider-backed.js";
import type { PhiBotManifest } from "../src/core/types.js";
import type { PhiProvider } from "../src/providers/types.js";

const manifest: PhiBotManifest = {
  id: "provider-testbot",
  name: "Provider TestBot",
  version: "0.2.0",
  role: "test",
  description: "provider adapter fixture",
  model: { provider: "fixture", name: "fixture-model" },
  memory: { scope: "task", maxDepth: 1 },
  capabilities: ["repo.read"],
  authority: { read: true, propose: true, write: false, deploy: false },
  escalation: { target: "vessie", confidenceBelow: 0.5 }
};

test("validates structured provider payloads", () => {
  assert.deepEqual(
    parseProviderPayload('{"summary":"ok","confidence":0.75}'),
    { summary: "ok", confidence: 0.75 },
  );
  assert.throws(
    () => parseProviderPayload('{"summary":"bad","confidence":4}'),
    /confidence/,
  );
});

test("attaches provider trace to stage result", async () => {
  const provider: PhiProvider = {
    id: "fixture",
    model: "fixture-model",
    async complete(request) {
      return {
        provider: "fixture",
        model: "fixture-model",
        content: JSON.stringify({
          summary: `handled ${request.stage}`,
          confidence: 0.9,
        }),
        fallback: false,
        metrics: {
          latencyMs: 7,
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      };
    },
  };

  const adapter = new ProviderBackedAdapter(provider);
  const result = await adapter.observe(manifest, { task: "inspect" });

  assert.equal(result.stage, "observe");
  assert.equal(result.provider?.provider, "fixture");
  assert.equal(result.provider?.totalTokens, 5);
});
