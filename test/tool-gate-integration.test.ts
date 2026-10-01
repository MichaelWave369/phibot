import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { RealityGate } from "../src/gate/reality-gate.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolCapabilityRegistry } from "../src/tools/registry.js";

const manifest: PhiBotManifest = {
  id: "patchbot",
  name: "PatchBot",
  version: "0.4.0",
  role: "code_repair",
  description: "tool gate integration fixture",
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

test("gated tool requires grant, executes once, then rejects replay", async () => {
  let executions = 0;
  const registry = new ToolCapabilityRegistry().register({
    id: "repo.patch",
    description: "fixture patch",
    actionClass: "write",
    external: true,
    validate(input: unknown) {
      return input as { patch: string };
    },
    async execute(input) {
      executions += 1;
      return { applied: input.patch };
    },
  });

  const ledger = new MemoryLedger();
  const gate = new RealityGate({
    secret: "0123456789abcdef",
    ledger,
  });
  const executor = new ToolExecutor(registry, ledger, {}, gate);
  const input = { patch: "bounded-change" };

  const gated = await executor.execute(
    manifest,
    { capability: "repo.patch", input },
    "run-gated",
  );

  assert.equal(gated.status, "gated");
  assert.ok(gated.gateRequest);
  assert.equal(executions, 0);

  const decision = await gate.decide(gated.gateRequest, {
    outcome: "approve",
  });
  assert.ok(decision.grant);

  const executed = await executor.execute(
    manifest,
    {
      capability: "repo.patch",
      input,
      grant: decision.grant,
    },
    "run-gated",
  );

  assert.equal(executed.status, "executed");
  assert.equal(executions, 1);

  const replayed = await executor.execute(
    manifest,
    {
      capability: "repo.patch",
      input,
      grant: decision.grant,
    },
    "run-gated",
  );

  assert.equal(replayed.status, "denied");
  assert.equal(executions, 1);
  assert.match(replayed.error ?? "", /replay/);

  const gateEvents = ledger.receipts.filter(
    (receipt) => receipt.stage === "gate",
  );
  assert.equal(gateEvents.length >= 4, true);
});
