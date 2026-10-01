import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { RealityGate } from "../src/gate/reality-gate.js";

const manifest: PhiBotManifest = {
  id: "patchbot",
  name: "PatchBot",
  version: "0.4.0",
  role: "code_repair",
  description: "gate fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "repo", maxDepth: 1 },
  capabilities: ["repo.patch"],
  authority: {
    read: true,
    propose: true,
    write: "gated",
    deploy: false,
  },
  escalation: { target: "vessie", confidenceBelow: 0.5 },
};

test("approve creates a valid one-use exact-input grant", async () => {
  let now = Date.parse("2026-10-01T00:00:00.000Z");
  const ledger = new MemoryLedger();
  const gate = new RealityGate({
    secret: "0123456789abcdef",
    ledger,
    now: () => now,
  });

  const input = { path: "README.md", patch: "hello" };
  const request = await gate.createRequest({
    manifest,
    runId: "run-1",
    capability: "repo.patch",
    actionClass: "write",
    input,
  });
  const decision = await gate.decide(request, { outcome: "approve" });

  assert.ok(decision.grant);

  const first = await gate.verifyAndConsume(
    decision.grant,
    {
      runId: "run-1",
      botId: manifest.id,
      capability: "repo.patch",
      actionClass: "write",
      input,
    },
    manifest.version,
  );
  assert.equal(first.valid, true);

  const replay = await gate.verifyAndConsume(
    decision.grant,
    {
      runId: "run-1",
      botId: manifest.id,
      capability: "repo.patch",
      actionClass: "write",
      input,
    },
    manifest.version,
  );
  assert.equal(replay.valid, false);
  assert.match(replay.reason, /replay/);

  assert.equal(
    ledger.receipts.filter((receipt) => receipt.stage === "gate").length,
    4,
  );

  now += 1;
});

test("grant rejects altered input", async () => {
  const gate = new RealityGate({
    secret: "0123456789abcdef",
    ledger: new MemoryLedger(),
  });

  const request = await gate.createRequest({
    manifest,
    runId: "run-input",
    capability: "repo.patch",
    actionClass: "write",
    input: { patch: "approved" },
  });
  const decision = await gate.decide(request, { outcome: "approve" });
  assert.ok(decision.grant);

  const result = await gate.verifyAndConsume(
    decision.grant,
    {
      runId: "run-input",
      botId: manifest.id,
      capability: "repo.patch",
      actionClass: "write",
      input: { patch: "different" },
    },
    manifest.version,
  );

  assert.equal(result.valid, false);
  assert.match(result.reason, /input/);
});

test("deny issues no grant and narrow requires shorter TTL", async () => {
  const gate = new RealityGate({
    secret: "0123456789abcdef",
    ledger: new MemoryLedger(),
    defaultTtlMs: 60_000,
  });

  const request = await gate.createRequest({
    manifest,
    runId: "run-decision",
    capability: "repo.patch",
    actionClass: "write",
    input: { patch: "x" },
  });

  const denied = await gate.decide(request, {
    outcome: "deny",
    reason: "not reviewed",
  });
  assert.equal(denied.grant, undefined);

  await assert.rejects(
    () => gate.decide(request, { outcome: "narrow", ttlMs: 60_000 }),
    /shorter/,
  );

  const narrowed = await gate.decide(request, {
    outcome: "narrow",
    ttlMs: 5_000,
  });
  assert.equal(narrowed.grant?.decision, "narrow");
});

test("expired grant is rejected", async () => {
  let now = 1_000_000;
  const gate = new RealityGate({
    secret: "0123456789abcdef",
    ledger: new MemoryLedger(),
    defaultTtlMs: 10,
    maxTtlMs: 100,
    now: () => now,
  });

  const request = await gate.createRequest({
    manifest,
    runId: "run-expired",
    capability: "repo.patch",
    actionClass: "write",
    input: { patch: "x" },
  });
  const decision = await gate.decide(request, { outcome: "approve" });
  assert.ok(decision.grant);

  now += 11;

  const result = await gate.verifyAndConsume(
    decision.grant,
    {
      runId: "run-expired",
      botId: manifest.id,
      capability: "repo.patch",
      actionClass: "write",
      input: { patch: "x" },
    },
    manifest.version,
  );

  assert.equal(result.valid, false);
  assert.match(result.reason, /expired/);
});
