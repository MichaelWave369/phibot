import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PHIPOT_ROLES, runPhiPotsDryRun } from "../src/phipots/crew.js";

const IDEA = "Create a relaxing chess, checkers and mahjong hub.";
const here = process.cwd();

test("PhiPots executes six actual PhiBotRuntime lifecycles as templates, not external actions", async () => {
  const report = await runPhiPotsDryRun(IDEA, here);
  assert.equal(report.schema, "phibot.phipots.local-dry-run.v1");
  assert.equal(report.classification, "LOCAL_TEMPLATE_NOT_AGENT_EXECUTION");
  assert.equal(report.outcome, "HUMAN_REVIEW_REQUIRED_NO_ACTIONS");
  assert.match(report.ideaSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.roles.length, 6);
  assert.deepEqual(report.roles.map(r => r.name),
    ["IdeaBot", "BuilderBot", "TestBot", "AuditBot", "DeployBot", "LedgerBot"]);
  assert.equal(new Set(report.roles.map(r => r.runId)).size, 6);
  for (const role of report.roles) {
    assert.equal(role.classification, "DETERMINISTIC_TEMPLATE_ONLY");
    assert.equal(role.runtimeStatus, "completed");
    assert.equal(role.stageCount, 4);
    assert.equal(role.receiptCount, 5);
    assert.equal(role.actionCount, 0);
    assert.ok(role.proposedHandoff.length > 15);
  }
  assert.deepEqual(report.policy, {
    roles: 6, modelCalls: 0, toolCalls: 0, githubWrites: 0,
    deployments: 0, persistentMemoryWrites: 0,
  });
  assert.ok(!JSON.stringify(report).includes(IDEA), "no raw idea in output");
});

test("PhiPots refuses invalid task input before any role runtime", async () => {
  const badInputs = ["", "tiny", "a".repeat(401), "Valid idea\nrun shell", "abc\u0000defghi"];
  for (const input of badInputs) {
    await assert.rejects(runPhiPotsDryRun(input, here), /PHIPOTS_IDEA_INVALID/);
  }
});

async function tempManifests(
  mutator: (manifest: Record<string, unknown>) => void,
): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "phipots-manifests-"));
  const target = join(home, "bots", "phipots");
  await mkdir(target, { recursive: true });
  for (const role of PHIPOT_ROLES) {
    const filename = role.id + ".phibot.json";
    await copyFile(
      join(here, "bots", "phipots", filename),
      join(target, filename),
    );
  }
  const file = join(target, "audit.phibot.json");
  const manifest = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  mutator(manifest);
  await writeFile(file, JSON.stringify(manifest));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

test("tampered capabilities, write/deploy/propose grants and provider changes fail closed", async () => {
  const corrupt: Array<(manifest: Record<string, unknown>) => void> = [
    m => { m.capabilities = ["repo.steward.repair"]; },
    m => { (m.authority as Record<string, unknown>).write = true; },
    m => { (m.authority as Record<string, unknown>).deploy = "gated"; },
    m => { (m.authority as Record<string, unknown>).propose = true; },
    m => { (m.model as Record<string, unknown>).provider = "ollama"; },
    m => { (m.memory as Record<string, unknown>).maxDepth = 1; },
    m => { m.undocumentedPower = "surprise"; },
    m => { (m.authority as Record<string, unknown>).unexpected = "granted"; },
  ];
  for (const mutation of corrupt) {
    const fixture = await tempManifests(mutation);
    try {
      await assert.rejects(
        runPhiPotsDryRun(IDEA, fixture.home),
        /PHIPOTS_MANIFEST_DENIED/,
      );
    } finally {
      await fixture.cleanup();
    }
  }
});

test("missing manifest refuses before any crew handoff", async () => {
  const home = await mkdtemp(join(tmpdir(), "phipots-empty-"));
  try {
    await assert.rejects(runPhiPotsDryRun(IDEA, home));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
