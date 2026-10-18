import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCheckEvidence, parseVerificationPolicy,
  candidateIssueNumber, verifyCandidates
} from "./repo-steward-verify.mjs";

const SHA = "b".repeat(40);
const OWNER = "MichaelWave369";
const REPO = OWNER + "/Demo";

const policy = { owner: OWNER, repos: [REPO], required: ["test"], token: "fake-test-token" };
const goodPR = {
  number: 12, state: "open", draft: true, title: "PhiBot candidate: update docs",
  html_url: "https://github.com/" + REPO + "/pull/12",
  body: "Autonomous local-model candidate for #7\n\nTarget file: README.md\n",
  base: { ref: "main", repo: { full_name: REPO } },
  head: { ref: "phibot/issue-7", sha: SHA, repo: { full_name: REPO } },
  mergeable: true
};
const success = { total_count: 1,
  check_runs: [{ id: 110, name: "test", status: "completed", conclusion: "success" }] };
const emptyStatuses = { total_count: 0, statuses: [] };

test("check evidence fails closed on missing check policy or check data", () => {
  assert.equal(classifyCheckEvidence(success, emptyStatuses, []).status, "CHECK_POLICY_MISSING");
  assert.equal(classifyCheckEvidence({}, emptyStatuses, ["test"]).status, "CHECK_DATA_INVALID");
  assert.equal(classifyCheckEvidence({ total_count: 120, check_runs: [] }, emptyStatuses, ["test"]).status, "CHECK_DATA_TRUNCATED");
  assert.equal(classifyCheckEvidence(success, emptyStatuses, ["test", "security"]).status, "CHECKS_MISSING");
});

test("a single passing check is insufficient if ANY current check fails or waits", () => {
  assert.equal(classifyCheckEvidence(success, emptyStatuses, ["test"]).status, "CHECKS_PASS_REVIEW_ONLY");
  const failed = { total_count: 2, check_runs: [
    ...success.check_runs,
    { id: 111, name: "security", status: "completed", conclusion: "failure" }
  ] };
  assert.equal(classifyCheckEvidence(failed, emptyStatuses, ["test"]).status, "CHECKS_FAILED");
  const waiting = { total_count: 2, check_runs: [
    ...success.check_runs,
    { id: 111, name: "deploy-scan", status: "queued", conclusion: null }
  ] };
  assert.equal(classifyCheckEvidence(waiting, emptyStatuses, ["test"]).status, "CHECKS_PENDING");
  const oldFailure = { total_count: 2, check_runs: [
    { id: 100, name: "test", status: "completed", conclusion: "failure" },
    { id: 101, name: "test", status: "completed", conclusion: "success" }
  ] };
  assert.equal(classifyCheckEvidence(oldFailure, emptyStatuses, ["test"]).status, "CHECKS_PASS_REVIEW_ONLY");
});

test("commit status contexts may satisfy named checks but must all be successful", () => {
  const statuses = { total_count: 2, statuses: [
    { context: "lint", state: "success" },
    { context: "external/audit", state: "failure" }
  ] };
  assert.equal(classifyCheckEvidence({ total_count: 0, check_runs: [] }, statuses, ["lint"]).status, "CHECKS_FAILED");
  assert.equal(classifyCheckEvidence({ total_count: 0, check_runs: [] },
    { total_count: 1, statuses: [{ context: "lint", state: "success" }] }, ["lint"]).status,
    "CHECKS_PASS_REVIEW_ONLY");
});

test("verification policy refuses missing token, missing required check, cross-owner repositories", () => {
  assert.throws(() => parseVerificationPolicy({ PHIBOT_OWNER: OWNER, PHIBOT_REPO_ALLOWLIST: REPO, PHIBOT_REQUIRED_CHECKS: "test" }), /token/);
  assert.throws(() => parseVerificationPolicy({ PHIBOT_OWNER: OWNER, PHIBOT_REPO_ALLOWLIST: REPO, PHIBOT_GITHUB_TOKEN: "test" }), /PHIBOT_REQUIRED_CHECKS/);
  assert.throws(() => parseVerificationPolicy({
    PHIBOT_OWNER: OWNER, PHIBOT_REPO_ALLOWLIST: "OtherOwner/Secret",
    PHIBOT_GITHUB_TOKEN: "test", PHIBOT_REQUIRED_CHECKS: "test"
  }), /owner-scoped/);
  assert.deepEqual(parseVerificationPolicy({
    PHIBOT_OWNER: OWNER, PHIBOT_REPO_ALLOWLIST: REPO, PHIBOT_GITHUB_TOKEN: "test",
    PHIBOT_REQUIRED_CHECKS: "test,lint"
  }).required, ["test", "lint"]);
});

test("only exact branch/source PR identity is considered a PhiBot draft", () => {
  assert.deepEqual(candidateIssueNumber(goodPR, REPO, "main"), { number: 7, target: "README.md" });
  assert.equal(candidateIssueNumber({ ...goodPR, draft: false }, REPO, "main"), null);
  assert.equal(candidateIssueNumber({ ...goodPR, head: { ...goodPR.head,
    repo: { full_name: OWNER + "/Other" } } }, REPO, "main"), null);
  assert.equal(candidateIssueNumber({ ...goodPR, body: "Unrelated work\nTarget file: README.md" }, REPO, "main"), null);
  assert.equal(candidateIssueNumber({ ...goodPR,
    head: { ...goodPR.head, ref: "feature/unreviewed" } }, REPO, "main"), null);
});

test("mocked candidate remains read-only and reports passing CI as review-only", async () => {
  const requests = [];
  const gh = async (method, url) => {
    requests.push([method, url]);
    assert.equal(method, "GET");
    if (url === "/repos/" + REPO) return { full_name: REPO, owner: { login: OWNER }, default_branch: "main" };
    if (url.endsWith("/pulls?state=open&per_page=100")) return [goodPR];
    if (url.endsWith("/issues/7")) return { state: "open", labels: [{ name: "phibot-ready" }],
      body: "Target file: README.md" };
    if (url.endsWith("/check-runs?per_page=100")) return success;
    if (url.endsWith("/status?per_page=100")) return emptyStatuses;
    if (url.includes("/compare/")) return { behind_by: 0 };
    if (url.endsWith("/pulls/12")) return goodPR;
    throw new Error("Unexpected read " + url);
  };
  const result = await verifyCandidates(gh, policy);
  assert.equal(result.mode, "READ_ONLY_NO_PROMOTION");
  assert.equal(result.repositories[0].candidates[0].status, "CHECKS_PASS_REVIEW_ONLY");
  assert.ok(requests.every(([m]) => m === "GET"));
});

test("stale base and revoked issue authorization block favorable CI evidence", async () => {
  const make = (revoked, behind) => async (method, url) => {
    if (url === "/repos/" + REPO) return { full_name: REPO, owner: { login: OWNER }, default_branch: "main" };
    if (url.endsWith("/pulls?state=open&per_page=100")) return [goodPR];
    if (url.endsWith("/issues/7")) return { state: "open", labels: revoked ? [] : [{ name: "phibot-ready" }],
      body: "Target file: README.md" };
    if (url.endsWith("/check-runs?per_page=100")) return success;
    if (url.endsWith("/status?per_page=100")) return emptyStatuses;
    if (url.includes("/compare/")) return { behind_by: behind };
    if (url.endsWith("/pulls/12")) return goodPR;
    throw new Error(url);
  };
  const revoked = await verifyCandidates(make(true, 0), policy);
  assert.equal(revoked.repositories[0].candidates[0].status, "ISSUE_AUTHORIZATION_REVOKED");
  const stale = await verifyCandidates(make(false, 2), policy);
  assert.equal(stale.repositories[0].candidates[0].status, "BASE_BEHIND_OR_UNVERIFIED");
});
