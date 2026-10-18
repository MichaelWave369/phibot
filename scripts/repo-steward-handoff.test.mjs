import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeHandoff, listHandoffs } from "./repo-steward-handoff.mjs";

const OWNER = "MichaelWave369", REPO = OWNER + "/Test";
const policy = { owner: OWNER, repos: [REPO] };
const proposal = {
  repository: REPO, prNumber: 14, issueNumber: 3,
  target: "src/calc.ts", expectedHeadSha: "a".repeat(40),
  expectedBlobSha: "b".repeat(40),
  replacement: "export const calc = () => 2;\n",
  summary: "Fix the calculation to return the expected value."
};
const review = { risk: "LOW", reason: "The change is constrained to the failed calculation." };

test("local handoff writes a full exact gated proposal, never a GitHub request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "phi-handoff-test-"));
  try {
    const output = await storeHandoff({ proposal, review, policy }, dir);
    assert.equal(output.status, "QUEUED_FOR_HUMAN_GATE_REVIEW");
    assert.match(output.proposalDigest, /^[a-f0-9]{64}$/);
    const saved = JSON.parse(await readFile(output.file, "utf8"));
    assert.deepEqual(saved, proposal);
    assert.deepEqual(Object.keys(saved).sort(), Object.keys(proposal).sort());
    const inventory = await listHandoffs(policy, dir);
    assert.equal(inventory.status, "LOCAL_INVENTORY_ONLY");
    assert.equal(inventory.handoffs.length, 1);
    assert.equal(inventory.handoffs[0].status, "AWAITING_HUMAN_REVIEW");
    assert.equal(inventory.handoffs[0].digest, output.proposalDigest);
    assert.ok(!JSON.stringify(inventory).includes(proposal.replacement));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("one PR and failing head SHA gets one immutable queue entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "phi-handoff-test-"));
  try {
    const one = await storeHandoff({ proposal, review, policy }, dir);
    const changed = { ...proposal, replacement: "export const calc = () => 99;\n" };
    const two = await storeHandoff({ proposal: changed, review, policy }, dir);
    assert.equal(two.status, "HANDOFF_ALREADY_EXISTS_NO_OVERWRITE");
    assert.equal(JSON.parse(await readFile(one.file, "utf8")).replacement, proposal.replacement);
    assert.equal((await listHandoffs(policy, dir)).handoffs.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("model approval cannot bypass governed input validation and repository scope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "phi-handoff-test-"));
  try {
    for (const bad of [
      { ...proposal, repository: "OtherOwner/Test" },
      { ...proposal, target: "src/auth/session.ts" },
      { ...proposal, target: "test/../../.github/workflows/ci.yml" },
      { ...proposal, summary: "short" },
      { ...proposal, unexpected: "run" }
    ]) {
      await assert.rejects(storeHandoff({ proposal: bad, review, policy }, dir), /denied/);
    }
    await assert.rejects(storeHandoff({
      proposal, review: { ...review, risk: "HIGH" }, policy
    }, dir), /LOW-risk/);
    assert.equal((await listHandoffs(policy, dir)).handoffs.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("local inventory identifies tampered proposal without showing untrusted replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "phi-handoff-test-"));
  try {
    const saved = await storeHandoff({ proposal, review, policy }, dir);
    const altered = { ...proposal, issueNumber: 999, target: "../secrets.ts" };
    await writeFile(saved.file, JSON.stringify(altered));
    const output = await listHandoffs(policy, dir);
    assert.equal(output.handoffs[0].status, "INVALID_LOCAL_HANDOFF");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("empty local handoff directory reports no work", async () => {
  const dir = join(tmpdir(), "non-existent-phi-hand-off-test-"+process.pid);
  const result = await listHandoffs(policy, dir);
  assert.deepEqual(result, { status: "EMPTY", handoffs: [] });
});
