import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "../src/core/manifest.js";

test("validates a minimal manifest", () => {
  const manifest = validateManifest({
    id: "testbot",
    name: "TestBot",
    version: "0.1.0",
    role: "test",
    description: "test bot",
    model: { provider: "dry-run", name: "deterministic" },
    memory: { scope: "task", maxDepth: 1 },
    capabilities: ["repo.read"],
    authority: { read: true, propose: true, write: false, deploy: false },
    escalation: { target: "vessie", confidenceBelow: 0.5 }
  });

  assert.equal(manifest.id, "testbot");
});

test("rejects invalid confidence thresholds", () => {
  assert.throws(() =>
    validateManifest({
      id: "testbot",
      name: "TestBot",
      version: "0.1.0",
      role: "test",
      description: "test bot",
      model: { provider: "dry-run", name: "deterministic" },
      memory: { scope: "task", maxDepth: 1 },
      capabilities: [],
      authority: { read: true, propose: true, write: false, deploy: false },
      escalation: { target: "vessie", confidenceBelow: 2 }
    }),
  );
});
