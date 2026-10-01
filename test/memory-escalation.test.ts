import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { NbgMemoryPods } from "../src/memory/pods.js";
import { MemoryMemoryStore } from "../src/memory/store.js";

const manifest: PhiBotManifest = {
  id: "escalationbot",
  name: "EscalationBot",
  version: "0.5.0",
  role: "memory_test",
  description: "escalation packet fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 4 },
  capabilities: [],
  authority: {
    read: true,
    propose: true,
    write: false,
    deploy: false,
  },
  escalation: { target: "vessie", confidenceBelow: 0.5 },
};

test("builds bounded provenance-preserving Vessie packet", async () => {
  const ledger = new MemoryLedger();
  const pods = new NbgMemoryPods({
    store: new MemoryMemoryStore(),
    ledger,
    policy: { escalationLimit: 2 },
  });

  const first = await pods.rememberTask(manifest, "task-e", {
    content: "first important fact",
    tags: ["fact"],
    salience: 1,
    confidence: 0.95,
    source: { kind: "tool", ref: "repo.read" },
  });
  await pods.rememberTask(manifest, "task-e", {
    content: "second important fact",
    tags: ["fact"],
    salience: 0.9,
    confidence: 0.9,
    source: { kind: "provider", ref: "ollama" },
    parents: [first.memoryId],
  });
  await pods.rememberTask(manifest, "task-e", {
    content: "third lower fact",
    tags: ["fact"],
    salience: 0.2,
    confidence: 0.5,
    source: { kind: "system" },
  });

  const packet = await pods.createEscalationPacket(
    manifest,
    "task-e",
    "run-escalate",
  );

  assert.equal(packet.target, "vessie");
  assert.equal(packet.records.length, 2);
  assert.equal(packet.records[0]?.content, "first important fact");
  assert.equal(
    packet.records[1]?.provenance.parents.includes(first.memoryId),
    true,
  );

  const receipt = ledger.receipts.at(-1);
  assert.equal(receipt?.stage, "memory");
  assert.equal(receipt?.status, "escalate");
  assert.equal(
    (receipt?.metadata?.memory as Record<string, unknown>)?.recordCount,
    2,
  );
});
