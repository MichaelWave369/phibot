import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedChange, parseReview, parseRepairModels,
  selectRepairable, failureHints, repairOne
} from "./repo-steward-repair.mjs";

const OWNER = "MichaelWave369", REPO = OWNER + "/Demo", SHA = "b".repeat(40);
const CONTENT = "export function calc() {\n  return 1;\n}\n";
const PATCH = "export function calc() {\n  return 2;\n}\n";
const policy = { owner: OWNER, repos: [REPO], token: "test-only",
  required: ["unit-test"] };
const validPr = {
  number: 12, state: "open", draft: true, mergeable: true,
  title: "PhiBot candidate: repair calc",
  body: "Autonomous local-model candidate for #7\n\nTarget file: src/calc.ts\n",
  base: { ref: "main", repo: { full_name: REPO } },
  head: { ref: "phibot/issue-7", sha: SHA, repo: { full_name: REPO } }
};
const failedCheck = { id: 28, name: "unit-test", status: "completed",
  conclusion: "failure", output: { summary: "Expected 2 but got 1" } };
const checks = { total_count: 1, check_runs: [failedCheck] };
const statuses = { total_count: 0, statuses: [] };
const issue = { number: 7, state: "open", title: "repair calc",
  body: "Target file: src/calc.ts\nPlease return 2",
  labels: [{ name: "phibot-ready" }] };

function mockGithub(overrides = {}) {
  const calls = [];
  const gh = async (method, path, data) => {
    calls.push({ method, path, data });
    const prefix = "/repos/" + REPO;
    if (path === prefix) return { full_name: REPO, default_branch: "main", owner: { login: OWNER } };
    if (path.endsWith("/pulls?state=open&per_page=100")) return [validPr];
    if (path.endsWith("/pulls/12")) return overrides.newHead
      ? { ...validPr, head: { ...validPr.head, sha: "a".repeat(40) } } : validPr;
    if (path.endsWith("/issues/7")) return overrides.revoked
      ? { ...issue, labels: [] } : issue;
    if (path.endsWith("/check-runs?per_page=100")) return checks;
    if (path.endsWith("/status?per_page=100")) return statuses;
    if (path.includes("/compare/")) return { behind_by: overrides.behind ?? 0 };
    if (path.endsWith("/pulls/12/files?per_page=100")) return overrides.extraFile
      ? [{ filename: "src/calc.ts", status: "modified" },
          { filename: "src/backdoor.ts", status: "added" }]
      : [{ filename: "src/calc.ts", status: "modified" }];
    if (path.endsWith("/pulls/12/commits?per_page=100")) return overrides.repaired
      ? [{ commit: { message: "phibot: repair-once pr#12 - previous attempt" } }]
      : [{ commit: { message: "phibot: candidate fix for issue #7" } }];
    if (path.includes("/contents/src/calc.ts?ref=")) return {
      type: "file", encoding: "base64", sha: "c".repeat(40),
      content: Buffer.from(CONTENT).toString("base64") };
    if (path.endsWith("/git/ref/heads/phibot/issue-7")) return {
      object: { sha: overrides.branchChanged ? "d".repeat(40) : SHA } };
    if (method === "PUT" && path.endsWith("/contents/src/calc.ts"))
      return { commit: { sha: "e".repeat(40) } };
    throw new Error("Unexpected mock GitHub call: " + method + " " + path);
  };
  return { gh, calls };
}

test("bounded code candidate refuses secrets, massive rewrites and no-ops", () => {
  assert.equal(boundedChange(CONTENT, PATCH), true);
  assert.equal(boundedChange(CONTENT, CONTENT), false);
  assert.equal(boundedChange(CONTENT, "-----BEGIN PRIVATE KEY-----"), false);
  assert.equal(boundedChange("a\n".repeat(120), "b\n".repeat(120)), false);
  assert.equal(boundedChange("x", "z".repeat(3000)), false);
});

test("SkepticBot refuses malformed, non-low or non-independent approval payloads", () => {
  assert.throws(() => parseReview({ approve: true, risk: "LOW", reason: "short" }), /schema/);
  assert.throws(() => parseReview({ approve: true, risk: "LOW", reason: "Justified low risk.",
    action: "merge" }), /schema/);
  assert.deepEqual(parseReview({ approve: false, risk: "HIGH",
    reason: "The change alters API behavior." }),
  { approve: false, risk: "HIGH", reason: "The change alters API behavior." });
  assert.throws(() => parseRepairModels({
    PHIBOT_MODEL: "same:1", PHIBOT_REVIEW_MODEL: "same:1"
  }), /distinct/);
  assert.throws(() => parseRepairModels({
    PHIBOT_OLLAMA_URL: "https://evil.example", PHIBOT_MODEL: "coder", PHIBOT_REVIEW_MODEL: "reviewer"
  }), /loopback/);
});

test("candidate selection requires an explicitly failed and SHA-bound draft", () => {
  assert.equal(selectRepairable({ repositories: [{ repository: REPO, candidates: [
    { pr: 12, status: "CHECKS_PASS_REVIEW_ONLY", checkStatus: "CHECKS_PASS_REVIEW_ONLY", headSha: SHA }
  ] }] }), null);
  assert.equal(selectRepairable({ repositories: [{ repository: REPO, candidates: [
    { pr: 12, status: "CHECKS_FAILED", checkStatus: "CHECKS_FAILED", headSha: SHA }
  ] }] }).number, 12);
  assert.equal(selectRepairable({ repositories: [{ repository: REPO, candidates: [
    { pr: 12, status: "BASE_BEHIND_OR_UNVERIFIED", checkStatus: "CHECKS_FAILED", headSha: SHA }
  ] }] }), null);
});

test("failure summaries are bounded evidence and never executable commands", () => {
  const hints = failureHints({ check_runs: [
    { ...failedCheck, output: { summary: "a".repeat(2000) } },
    { ...failedCheck, name: "other" }
  ] }, statuses);
  assert.equal(hints.length, 2);
  assert.equal(hints[0].summary.length, 700);
  assert.equal(hints[1].check, "other");
});

const accepts = async () => ({ summary: "Fix the incorrect result.", replacement: PATCH });
const skepticAccepts = async () => ({
  approve: true, risk: "LOW", reason: "Minimal arithmetic correction supported by failed test."
});

test("default dry-run inspects failed CI, uses two reviewers, makes no GitHub writes", async () => {
  const { gh, calls } = mockGithub();
  let authored = 0, reviewed = 0, claims = 0;
  const result = await repairOne(gh, policy, {
    patch: async ctx => { authored++; assert.equal(ctx.failedChecks[0].check, "unit-test"); return accepts(); },
    skeptic: async ctx => { reviewed++; assert.equal(ctx.replacement, PATCH); return skepticAccepts(); },
    claim: async () => { claims++; }
  });
  assert.equal(result.status, "DRY_RUN_REVIEW_ACCEPTED_NO_WRITE");
  assert.equal(authored, 1);
  assert.equal(reviewed, 1);
  assert.equal(claims, 0);
  assert.ok(calls.every(x => x.method === "GET"));
});

test("skeptic rejection makes no GitHub writes", async () => {
  const { gh, calls } = mockGithub();
  const result = await repairOne(gh, policy, {
    patch: accepts, skeptic: async () => ({
      approve: false, risk: "HIGH", reason: "No evidence supporting the proposed replacement."
    })
  });
  assert.equal(result.status, "SKEPTIC_REFUSED");
  assert.ok(calls.every(x => x.method === "GET"));
});

test("multi-file and previously-repaired PRs refuse further attempts", async () => {
  for (const override of [{ extraFile: true }, { repaired: true }]) {
    const { gh, calls } = mockGithub(override);
    await assert.rejects(repairOne(gh, policy, {
      patch: accepts, skeptic: skepticAccepts
    }), /NOT_SINGLE_FILE_CANDIDATE|REPAIR_ALREADY_ATTEMPTED/);
    assert.ok(calls.every(x => x.method === "GET"));
  }
});

test("explicit repair mode cannot push without opt-in", async () => {
  const saved = process.env.PHIBOT_ENABLE_REPAIR_WRITES;
  delete process.env.PHIBOT_ENABLE_REPAIR_WRITES;
  const { gh, calls } = mockGithub();
  try {
    await assert.rejects(repairOne(gh, policy, {
      dryRun: false, patch: accepts, skeptic: skepticAccepts,
      claim: async () => { throw new Error("should not run"); }
    }), /PHIBOT_ENABLE_REPAIR_WRITES/);
    assert.ok(calls.every(x => x.method === "GET"));
  } finally {
    if (saved === undefined) delete process.env.PHIBOT_ENABLE_REPAIR_WRITES;
    else process.env.PHIBOT_ENABLE_REPAIR_WRITES = saved;
  }
});

test("branch change between review and write aborts without consuming retry", async () => {
  const saved = process.env.PHIBOT_ENABLE_REPAIR_WRITES;
  process.env.PHIBOT_ENABLE_REPAIR_WRITES = "1";
  const { gh, calls } = mockGithub({ branchChanged: true });
  let claims = 0;
  try {
    await assert.rejects(repairOne(gh, policy, {
      dryRun: false, patch: accepts, skeptic: skepticAccepts,
      claim: async () => { claims++; }
    }), /BRANCH_CHANGED_BEFORE_WRITE/);
    assert.equal(claims, 0);
    assert.ok(calls.every(x => x.method === "GET"));
  } finally {
    if (saved === undefined) delete process.env.PHIBOT_ENABLE_REPAIR_WRITES;
    else process.env.PHIBOT_ENABLE_REPAIR_WRITES = saved;
  }
});

test("one successful opt-in repair writes only the approved PR's existing file", async () => {
  const saved = process.env.PHIBOT_ENABLE_REPAIR_WRITES;
  process.env.PHIBOT_ENABLE_REPAIR_WRITES = "1";
  const { gh, calls } = mockGithub();
  let claims = 0;
  try {
    const output = await repairOne(gh, policy, {
      dryRun: false, patch: accepts, skeptic: skepticAccepts,
      claim: async () => { claims++; }
    });
    assert.equal(output.status, "ONE_REPAIR_COMMIT_PUSHED_CI_UNVERIFIED");
    assert.equal(claims, 1);
    const writes = calls.filter(c => c.method !== "GET");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, "PUT");
    assert.equal(writes[0].path, "/repos/" + REPO + "/contents/src/calc.ts");
    assert.equal(writes[0].data.branch, "phibot/issue-7");
    assert.ok(writes[0].data.message.startsWith("phibot: repair-once pr#12"));
  } finally {
    if (saved === undefined) delete process.env.PHIBOT_ENABLE_REPAIR_WRITES;
    else process.env.PHIBOT_ENABLE_REPAIR_WRITES = saved;
  }
});
