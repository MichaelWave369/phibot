import assert from "node:assert/strict";
import test from "node:test";
import type { PhiBotManifest } from "../src/core/types.js";
import { DryRunProvider } from "../src/providers/dry-run.js";
import { ProviderRegistry } from "../src/providers/registry.js";

const manifest: PhiBotManifest = {
  id: "testbot",
  name: "TestBot",
  version: "0.2.0",
  role: "test",
  description: "provider registry fixture",
  model: { provider: "boom", name: "failure-model" },
  memory: { scope: "task", maxDepth: 1 },
  capabilities: ["repo.read"],
  authority: { read: true, propose: true, write: false, deploy: false },
  escalation: { target: "vessie", confidenceBelow: 0.5 }
};

test("falls back to deterministic provider when primary throws", async () => {
  const registry = new ProviderRegistry()
    .register("boom", (model) => ({
      id: "boom",
      model,
      async complete() {
        throw new Error("provider unavailable");
      },
    }))
    .register("dry-run", () => new DryRunProvider());

  const provider = registry.create("boom", "failure-model", {
    fallbackProvider: "dry-run",
  });

  const result = await provider.complete({
    stage: "observe",
    manifest,
    input: { task: "inspect repository" },
    prior: [],
  });

  assert.equal(result.provider, "dry-run");
  assert.equal(result.fallback, true);
  assert.match(result.fallbackReason ?? "", /provider unavailable/);
});

test("rejects unknown providers instead of silently changing the manifest", () => {
  const registry = new ProviderRegistry().register("dry-run", () => new DryRunProvider());
  assert.throws(() => registry.create("does-not-exist", "x"), /Unknown provider/);
});
