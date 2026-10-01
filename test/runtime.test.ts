import assert from "node:assert/strict";
import test from "node:test";
import { DryRunAdapter } from "../src/adapters/dry-run.js";
import { MemoryLedger } from "../src/core/ledger.js";
import { PhiBotRuntime } from "../src/core/runtime.js";
import type { PhiBotManifest } from "../src/core/types.js";

const manifest: PhiBotManifest = {
  id: "scoutbot",
  name: "ScoutBot",
  version: "0.1.0",
  role: "research_scout",
  description: "test fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 2 },
  capabilities: ["repo.read"],
  authority: { read: true, propose: true, write: false, deploy: false },
  escalation: { target: "vessie", confidenceBelow: 0.7 }
};

test("completes a dry-run and writes one receipt per stage", async () => {
  const ledger = new MemoryLedger();
  const runtime = new PhiBotRuntime(manifest, new DryRunAdapter(), ledger);

  const result = await runtime.run({ task: "inspect repository" });

  assert.equal(result.status, "completed");
  assert.deepEqual(
    result.stages.map((stage) => stage.stage),
    ["observe", "interpret", "propose", "verify"],
  );
  assert.equal(result.receipts.at(-1)?.stage, "ledger");
  assert.equal(ledger.receipts.length, 5);
});
