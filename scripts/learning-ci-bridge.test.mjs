import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseCIBridgeArgs, runCIBridge
} from "./learning-ci-bridge.mjs";
import { listFailures, proposeLesson, replayLesson } from "./learning-gate.mjs";

const repo = "MichaelWave369/Demo";
const shaA = "1".repeat(40);
const shaB = "2".repeat(40);
const env = { PHIBOT_OWNER: "MichaelWave369", PHIBOT_REPO_ALLOWLIST: repo,
  PHIBOT_GITHUB_TOKEN: "UNIT_TEST_TOKEN_NEVER_PRINT" };
const args = (sha = shaA, ...extra) => [
  "--repo", repo, "--pr", "9", "--check", "test", "--sha", sha, ...extra
];
function fixture({ sha = shaA, draft = true, checkResult = "failure",
  behind = 0, issueOpen = true, changeSecond = false,
  omitCheck = false, duplicateStatus = false } = {}) {
  const paths = [];
  let prReads = 0;
  const gh = async (method, path) => {
    paths.push({ method, path });
    assert.equal(method, "GET");
    const prefix = "/repos/" + repo;
    if (path === prefix) return {
      full_name: repo, owner: { login: "MichaelWave369" },
      default_branch: "main", archived: false, disabled: false, fork: false
    };
    if (path === prefix + "/pulls/9") {
      prReads++;
      const currentSha = changeSecond && prReads > 2 ? shaB : sha;
      return {
        state: "open", draft, mergeable: true, title: "PhiBot candidate: fix",
        body: "Autonomous local-model candidate for #5\n\nTarget file: docs/ROADMAP.md\n",
        base: { ref: "main", repo: { full_name: repo } },
        head: { ref: "phibot/issue-5", sha: currentSha, repo: { full_name: repo } }
      };
    }
    if (path === prefix + "/issues/5") return {
      state: issueOpen ? "open" : "closed",
      labels: [{ name: "phibot-ready" }],
      body: "Target file: docs/ROADMAP.md\n"
    };
    if (path.endsWith("/check-runs?per_page=100")) return {
      total_count: omitCheck ? 0 : 1, check_runs: omitCheck ? [] : [
        { id: 55, name: "test", status: "completed", conclusion: checkResult }
      ]
    };
    if (path.endsWith("/status?per_page=100")) return {
      total_count: duplicateStatus ? 1 : 0,
      statuses: duplicateStatus ? [{ context: "test", state: "failure" }] : []
    };
    if (path.includes("/compare/")) return { behind_by: behind };
    throw new Error("unexpected fixture read");
  };
  return { gh, paths };
}
async function isolated(fn) {
  const root = await mkdtemp(join(tmpdir(), "learning-ci-r2-"));
  try { await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("exact arguments reject missing, duplicate, invalid check, SHA and extra flags", () => {
  assert.deepEqual(parseCIBridgeArgs(args()), {
    repository: repo, prNumber: 9, checkName: "test",
    expectedSha: shaA, capture: false
  });
  assert.equal(parseCIBridgeArgs(args(shaA, "--capture")).capture, true);
  for (const bad of [
    args(shaA, "--capture", "--capture"), args(shaA, "--write"),
    args("badsha"), args(shaA, "--sha", shaA),
    args(shaA).slice(0, -2),
    args(shaA).map(x => x === "test" ? "something; dangerous" : x)
  ]) assert.throws(() => parseCIBridgeArgs(bad), /LG_CI_ARGS_INVALID/);
});

test("preview uses only GET, pinning real checks without writing a capsule", async () => {
  await isolated(async root => {
    const x = fixture();
    let saveCalls = 0;
    const result = await runCIBridge({
      argv: args(), env, gh: x.gh, root,
      save: async () => { saveCalls++; throw Error("SHOULD_NOT_SAVE"); }
    });
    assert.equal(result.status, "REVIEW_ONLY_PREVIEW");
    assert.equal(result.source_sha, shaA);
    assert.equal(result.observation.failure_class, "FAILED_GATE");
    assert.equal(result.observation.observed_code, "CHECKS_FAILED");
    assert.equal(result.observation.run_id, "ci-pr9-" + shaA);
    assert.equal(result.grants, 0);
    assert.equal(result.remote_writes, 0);
    assert.equal(result.retry_enforcement, false);
    assert.equal(saveCalls, 0);
    assert.ok(x.paths.length >= 18);
    assert.ok(x.paths.every(c => c.method === "GET"));
    assert.ok(!JSON.stringify(result).includes("UNIT_TEST_TOKEN"));
    assert.equal((await listFailures(root)).total, 0);
  });
});

test("explicit capture stores R1-tier capsule and replays only as advisory", async () => {
  await isolated(async root => {
    const first = await runCIBridge({
      argv: args(shaA, "--capture"), env, gh: fixture().gh, root
    });
    assert.equal(first.status, "LOCAL_FAILURE_CAPSULE_SAVED");
    assert.equal(first.capsule_mode, "LOCAL_SELF_REPORT");
    assert.equal(first.save_status, "CREATED");
    assert.equal((await listFailures(root)).total, 1);
    const second = await runCIBridge({
      argv: args(shaB, "--capture"), env, gh: fixture({sha:shaB}).gh, root
    });
    assert.equal(second.status, "LOCAL_FAILURE_CAPSULE_SAVED");
    assert.equal(second.signature, first.signature);
    assert.notEqual(second.capsule_id, first.capsule_id);
    assert.equal((await listFailures(root)).signatures[0].distinct_runs, 2);
    const proposal = await proposeLesson(first.signature, root);
    const replay = await replayLesson(proposal.proposal_id,
      (await runCIBridge({argv:args(shaA),env,gh:fixture().gh})).observation,root);
    assert.equal(replay.status, "MATCH_STOP_RETRY_ADVISORY");
    assert.equal(replay.enforced, false);
    const content = await readFile(join(root, "capsules", first.capsule_id + ".json"),"utf8");
    assert.ok(!content.includes("UNIT_TEST_TOKEN"));
    assert.ok(!content.includes("Target file"));
  });
});

test("same remote commit and check re-capture does not pretend to be two runs", async () => {
  await isolated(async root => {
    const first = await runCIBridge({argv:args(shaA,"--capture"),env,gh:fixture().gh,root});
    const second = await runCIBridge({argv:args(shaA,"--capture"),env,gh:fixture().gh,root});
    assert.equal(second.save_status, "EXISTS_IDENTICAL");
    await assert.rejects(proposeLesson(first.signature,root),/LG_NEEDS_TWO_DISTINCT_RUNS/);
  });
});

test("stale pinned SHA, moved PR, revoked issue and unapproved PR refuse without saving", async () => {
  for (const x of [
    { f:fixture({sha:shaB}), a:args(shaA) },
    { f:fixture({changeSecond:true}), a:args(shaA) },
    { f:fixture({draft:false}), a:args(shaA) },
    { f:fixture({issueOpen:false}), a:args(shaA) },
    { f:fixture({behind:1}), a:args(shaA) }
  ]) {
    await isolated(async root => {
      let saved = 0;
      await assert.rejects(runCIBridge({
        argv:[...x.a,"--capture"],env,gh:x.f.gh,root,
        save:async()=>{saved++;return {};}
      }),/LG_CI_PREFLIGHT_REFUSED_OR_SHA_CHANGED|LG_CI_REMOTE_STATE_CHANGED/);
      assert.equal(saved,0);
      assert.equal((await listFailures(root)).total,0);
    });
  }
});

test("passing, missing, ambiguous, and unsupported commit-status checks refuse", async () => {
  for (const data of [
    {checkResult:"success"}, {omitCheck:true},
    {duplicateStatus:true}, {checkResult:"neutral"}
  ]) {
    await isolated(async root => {
      let saved=0;
      await assert.rejects(runCIBridge({
        argv:args(shaA,"--capture"),env,gh:fixture(data).gh,root,
        save:async()=>{saved++;return {};}
      }),/LG_CI_/);
      assert.equal(saved,0);
      assert.equal((await listFailures(root)).total,0);
    });
  }
});

test("explicit allowlist and token gate run before any remote read", async () => {
  const mock=fixture();
  await assert.rejects(runCIBridge({
    argv:args(), env:{...env,PHIBOT_REPO_ALLOWLIST:"MichaelWave369/Other"},
    gh:mock.gh
  }),/QUEUE_REPOSITORY_NOT_ALLOWED/);
  assert.equal(mock.paths.length,0);
  await assert.rejects(runCIBridge({
    argv:args(), env:{ PHIBOT_OWNER:"MichaelWave369",PHIBOT_REPO_ALLOWLIST:repo }
  }),/LG_CI_READ_ONLY_TOKEN_REQUIRED/);
});

test("source check fingerprint distinguishes names and never claims signed attestation", async () => {
  const one=await runCIBridge({argv:args(),env,gh:fixture().gh});
  const alt=fixture();
  const reader=async (method,path,...rest)=>{
    if(path.endsWith("/check-runs?per_page=100"))
      return {total_count:1,check_runs:[{id:55,name:"lint",status:"completed",conclusion:"failure"}]};
    return alt.gh(method,path,...rest);
  };
  const argsLint=[...args()];
  argsLint[5]="lint";
  const two=await runCIBridge({argv:argsLint,env,gh:reader});
  assert.notEqual(one.observation.check_id,two.observation.check_id);
  assert.notEqual(one.observation.evidence_sha256,two.observation.evidence_sha256);
  assert.match(two.source,/NOT_INDEPENDENT_ATTESTATION/);
});
