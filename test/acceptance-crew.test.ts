import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAcceptanceScenario } from "../src/acceptance/scenario.js";

test("full governed crew lifecycle passes deterministic acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-acceptance-test-"));

  try {
    const report = await runAcceptanceScenario({
      stateDir: root,
      mode: "deterministic",
    });

    assert.equal(report.passed, true);
    assert.equal(report.checks.spawnRegistered, true);
    assert.equal(report.checks.leastAuthority, true);
    assert.equal(report.checks.memoryPromoted, true);
    assert.equal(report.checks.handoffDelivered, true);
    assert.equal(report.checks.providerCompleted, true);
    assert.equal(report.checks.gateRequired, true);
    assert.equal(report.checks.grantExecutedOnce, true);
    assert.equal(report.checks.grantReplayRejected, true);
    assert.equal(report.checks.budgetTracked, true);
    assert.equal(report.checks.receiptChainPresent, true);
    assert.equal(report.checks.spawnDissolved, true);
    assert.deepEqual(report.providerIds, ["dry-run"]);
    assert.equal(report.toolCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
