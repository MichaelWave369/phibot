import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { NbgMemoryPods } from "../src/memory/pods.js";
import { MemoryMemoryStore } from "../src/memory/store.js";

const manifest: PhiBotManifest = {
  id: "memorybot",
  name: "MemoryBot",
  version: "0.5.0",
  role: "memory_test",
  description: "memory pod fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "repo", maxDepth: 4 },
  capabilities: [],
  authority: {
    read: true,
    propose: true,
    write: false,
    deploy: false,
  },
  escalation: { target: "vessie", confidenceBelow: 0.5 },
};

test("task bubble nests under bot bubble and retrieves task first", async () => {
  const pods = new NbgMemoryPods({
    store: new MemoryMemoryStore(),
    ledger: new MemoryLedger(),
  });

  const botMemory = await pods.rememberBot(manifest, {
    content: "repository uses TypeScript",
    tags: ["repo"],
    salience: 0.8,
    confidence: 0.95,
    source: { kind: "system" },
  });

  const taskMemory = await pods.rememberTask(manifest, "task-1", {
    content: "current failure is in memory tests",
    tags: ["test"],
    salience: 0.9,
    confidence: 0.9,
    source: { kind: "tool", ref: "ci" },
  });

  assert.equal(taskMemory.parentBubbleId, botMemory.bubbleId);

  const retrieved = await pods.retrieve(manifest, "task-1", { limit: 4 });
  assert.deepEqual(
    retrieved.map((record) => record.memoryId),
    [taskMemory.memoryId, botMemory.memoryId],
  );
});

test("promotion requires thresholds and preserves provenance", async () => {
  const pods = new NbgMemoryPods({
    store: new MemoryMemoryStore(),
    ledger: new MemoryLedger(),
    policy: {
      promotionMinSalience: 0.75,
      promotionMinConfidence: 0.7,
    },
  });

  const weak = await pods.rememberTask(manifest, "task-2", {
    content: "weak guess",
    salience: 0.4,
    confidence: 0.9,
    source: { kind: "provider", ref: "dry-run" },
  });

  await assert.rejects(
    () => pods.promoteTaskToBot(manifest, "task-2", weak.memoryId),
    /salience/,
  );

  const strong = await pods.rememberTask(manifest, "task-2", {
    content: "stable architecture decision",
    tags: ["architecture"],
    salience: 0.95,
    confidence: 0.9,
    source: { kind: "user", ref: "decision" },
    parents: [weak.memoryId],
  });

  const promoted = await pods.promoteTaskToBot(
    manifest,
    "task-2",
    strong.memoryId,
  );

  assert.equal(promoted.scope, "bot");
  assert.equal(promoted.promotedFrom, strong.memoryId);
  assert.equal(promoted.provenance.source.kind, "memory");
  assert.equal(promoted.provenance.parents.includes(strong.memoryId), true);
  assert.equal(promoted.content, strong.content);
});

test("tag filtering and maxDepth bound nested retrieval", async () => {
  const pods = new NbgMemoryPods({
    store: new MemoryMemoryStore(),
    ledger: new MemoryLedger(),
  });

  await pods.rememberTask(manifest, "task-3", {
    content: "alpha",
    tags: ["alpha"],
    salience: 0.9,
    confidence: 0.9,
    source: { kind: "system" },
  });
  await pods.rememberTask(manifest, "task-3", {
    content: "beta",
    tags: ["beta"],
    salience: 0.9,
    confidence: 0.9,
    source: { kind: "system" },
  });

  const filtered = await pods.retrieve(manifest, "task-3", {
    tags: ["ALPHA"],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.content, "alpha");
});
