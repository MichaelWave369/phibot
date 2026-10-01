import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { NbgMemoryPods } from "../src/memory/pods.js";
import { MemoryMemoryStore } from "../src/memory/store.js";

const manifest: PhiBotManifest = {
  id: "compactbot",
  name: "CompactBot",
  version: "0.5.0",
  role: "memory_test",
  description: "compaction fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 8 },
  capabilities: [],
  authority: {
    read: true,
    propose: true,
    write: false,
    deploy: false,
  },
  escalation: { target: "vessie", confidenceBelow: 0.5 },
};

test("compaction removes expired, duplicate, and overflow records", async () => {
  let now = 1_000_000;
  const store = new MemoryMemoryStore();
  const pods = new NbgMemoryPods({
    store,
    ledger: new MemoryLedger(),
    now: () => now,
    policy: {
      taskTtlMs: 100,
      maxTaskRecords: 2,
    },
  });

  await pods.rememberTask(manifest, "task-c", {
    content: "expired",
    source: { kind: "system" },
    expiresInMs: 1,
  });

  now += 2;

  await pods.rememberTask(manifest, "task-c", {
    content: "duplicate",
    salience: 0.4,
    confidence: 0.4,
    source: { kind: "system" },
  });
  await pods.rememberTask(manifest, "task-c", {
    content: "duplicate",
    salience: 0.9,
    confidence: 0.9,
    source: { kind: "system" },
  });
  await pods.rememberTask(manifest, "task-c", {
    content: "keep high",
    salience: 1,
    confidence: 1,
    source: { kind: "system" },
  });
  await pods.rememberTask(manifest, "task-c", {
    content: "overflow low",
    salience: 0.1,
    confidence: 0.1,
    source: { kind: "system" },
  });

  const result = await pods.compact(manifest);

  assert.equal(result.expiredRemoved, 1);
  assert.equal(result.duplicateRemoved, 1);
  assert.equal(result.overflowRemoved, 1);
  assert.equal(result.remaining, 2);

  const remaining = await store.listByBot(manifest.id);
  assert.equal(
    remaining.some((record) => record.content === "overflow low"),
    false,
  );
});
