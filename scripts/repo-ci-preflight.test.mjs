import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enqueue, inspectQueue } from "./work-queue.mjs";
import { parsePreflightArgs, preflightCI, runPreflight } from "./repo-ci-preflight.mjs";

const repository = "MichaelWave369/Demo";
const policy = { owner: "MichaelWave369", repos: [repository] };
const input = { repository, prNumber: 9, requiredChecks: ["test"] };
const env = { PHIBOT_REPO_ALLOWLIST: repository, PHIBOT_OWNER: "MichaelWave369",
  PHIBOT_GITHUB_TOKEN: "unit-test-read-token" };
const sha = "1".repeat(40);

function fixtures(overrides={}) {
  const data = {
    meta: { full_name: repository, owner: {login: "MichaelWave369"},
      default_branch: "main", archived: false, disabled:false, fork:false },
    pr: {state:"open",draft:true,title:"PhiBot candidate: fix docs",
      body:"Autonomous local-model candidate for #5\n\nTarget file: docs/ROADMAP.md\n",
      base:{ref:"main",repo:{full_name:repository}},
      head:{ref:"phibot/issue-5",sha,repo:{full_name:repository}},
      mergeable:true },
    issue: {state:"open",number:5,labels:[{name:"phibot-ready"}],
      body:"Target file: docs/ROADMAP.md\n"},
    checks: {total_count:1,check_runs:[{
      id:55,name:"test",status:"completed",conclusion:"failure",
    }]},
    statuses: {total_count:0,statuses:[]},
    compare: {behind_by:0},
    ...overrides,
  };
  const calls=[];
  const gh=async (method,path) => {
    calls.push([method,path]);
    assert.equal(method,"GET");
    if (path === "/repos/" + repository) return data.meta;
    if (path === "/repos/" + repository + "/pulls/9") return data.pr;
    if (path === "/repos/" + repository + "/issues/5") return data.issue;
    if (path.endsWith("/check-runs?per_page=100")) return data.checks;
    if (path.endsWith("/status?per_page=100")) return data.statuses;
    if (path.includes("/compare/")) return data.compare;
    throw new Error("Unexpected mocked endpoint " + path);
  };
  return {gh,data,calls};
}
const args=(...extra)=>["--repo",repository,"--pr","9","--checks","test",...extra];

test("parse exact read-only CLI flags and refuse malformed inputs",()=>{
  assert.deepEqual(parsePreflightArgs(args()),{...input,enqueue:false});
  assert.deepEqual(parsePreflightArgs(args("--enqueue")),{...input,enqueue:true});
  assert.throws(()=>parsePreflightArgs(args("--unknown")),/ARGUMENT_INVALID/);
  assert.throws(()=>parsePreflightArgs(args("--pr","10")),/ARGUMENT_INVALID/);
  assert.throws(()=>parsePreflightArgs(["--repo",repository,"--pr","0","--checks","test"]),/ARGUMENT_INVALID/);
  assert.throws(()=>parsePreflightArgs(["--pr","9","--checks","test"]),/ARGUMENT_INVALID/);
  assert.throws(()=>parsePreflightArgs(args("--enqueue","--enqueue")),/ARGUMENT_INVALID/);
});

test("genuine eligible draft with failed check is preflight ready, but still review only",async()=>{
  const {gh,calls}=fixtures();
  const result=await preflightCI({gh,input,policy});
  assert.equal(result.status,"READY_FOR_READ_ONLY_INSPECT_QUEUE");
  assert.equal(result.mode,"READ_ONLY_NO_PROMOTION");
  assert.equal(result.headSha,sha);
  assert.equal(result.issueNumber,5);
  assert.equal(result.target,"docs/ROADMAP.md");
  assert.equal(result.checkStatus,"CHECKS_FAILED");
  assert.deepEqual(result.observedCheckNames,["test"]);
  assert.ok(calls.every(([method])=>method==="GET"));
  assert.ok(calls.length>=7);
  assert.ok(!JSON.stringify(result).includes("unit-test-read-token"));
});

test("normal public PR, merged PR, non-draft or cross-repository ref are not eligible",async()=>{
  for (const pr of [
    {state:"closed"}, {draft:false}, {title:"General project improvement"},
    {head:{ref:"feature/test",sha,repo:{full_name:repository}}},
    {base:{ref:"main",repo:{full_name:"Other/Project"}}},
    {head:{ref:"phibot/issue-5",sha:"aabb",repo:{full_name:repository}}},
    {body:"Autonomous local-model candidate for #5\nTarget file: ../secrets.txt\n"},
  ]) {
    const original=fixtures().data.pr;
    const {gh,calls}=fixtures({pr:{...original,...pr}});
    const result=await preflightCI({gh,input,policy});
    assert.equal(result.status,"PR_NOT_ELIGIBLE_PHIBOT_DRAFT");
    assert.equal(calls.length,2);
  }
});

test("missing/changed issue authority refuses, without reading CI",async()=>{
  const original=fixtures().data.issue;
  for (const changed of [
    {state:"closed"},{labels:[]},{body:"Target file: src/main.ts\n"},
  ]) {
    const {gh,calls}=fixtures({issue:{...original,...changed}});
    const result=await preflightCI({gh,input,policy});
    assert.equal(result.status,"ISSUE_AUTHORIZATION_NOT_PRESENT");
    assert.equal(calls.length,3);
  }
});

test("required check names must exist in complete reported check set",async()=>{
  const {gh}=fixtures({checks:{total_count:0,check_runs:[]}});
  const result=await preflightCI({gh,input,policy});
  assert.equal(result.status,"REQUIRED_CHECKS_MISSING");
  assert.deepEqual(result.missingChecks,["test"]);
  const trunc=fixtures({checks:{total_count:200,check_runs:[]}});
  assert.equal((await preflightCI({gh:trunc.gh,input,policy})).status,"CHECK_DATA_UNQUALIFIED");
});

test("stale base, unknown mergeability and wrong repo identity never look ready",async()=>{
  assert.equal((await preflightCI({gh:fixtures({compare:{behind_by:1}}).gh,input,policy})).status,
    "PR_BASE_BEHIND_OR_UNVERIFIED");
  assert.equal((await preflightCI({gh:fixtures({pr:{
    ...fixtures().data.pr,mergeable:null }}).gh,input,policy})).status,
    "PR_MERGEABILITY_NOT_CONFIRMED");
  assert.equal((await preflightCI({gh:fixtures({meta:{
    ...fixtures().data.meta,owner:{login:"SomeoneElse"}}}).gh,input,policy})).status,
    "REPOSITORY_IDENTITY_INVALID");
});

test("preflight never enqueues by default, even with confirmed failed checks",async()=>{
  let records=0;
  const result=await runPreflight({argv:args(),env,gh:fixtures().gh,
    record:async()=>{records++;throw Error("UNEXPECTED_QUEUEING");}});
  assert.equal(result.status,"READY_FOR_READ_ONLY_INSPECT_QUEUE");
  assert.equal(result.localEnqueue,"NOT_REQUESTED_OR_NOT_ELIGIBLE");
  assert.equal(records,0);
});

test("explicit --enqueue creates just one durable local read job and deduplicates",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"phi-ci-preflight-"));
  try {
    const opts={argv:args("--enqueue"),env,gh:fixtures().gh,dir};
    const first=await runPreflight(opts);
    assert.equal(first.localEnqueue,"ENQUEUED_READ_ONLY");
    assert.match(first.queuedJobId,/^[a-f0-9]{64}$/);
    assert.equal(first.postQueueWarning,"RECHECK_LIVE_SHA_ON_RUN_ONCE");
    const again=await runPreflight(opts);
    assert.equal(again.localEnqueue,"ALREADY_QUEUED_NO_OVERWRITE");
    const inv=await inspectQueue(policy,dir);
    assert.equal(inv.total,1);
    assert.equal(inv.jobs[0].capability,"repo.steward.inspect");
    assert.equal(inv.jobs[0].prNumber,9);
    const journal=await readFile(join(dir,"events.ndjson"),"utf8");
    assert.ok(!journal.includes(sha)); // remote SHA never published in enqueue event
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("ineligible PR never enqueues, even with explicit --enqueue",async()=>{
  let calls=0;
  const invalid=fixtures({pr:{...fixtures().data.pr,draft:false}});
  const result=await runPreflight({argv:args("--enqueue"),env,gh:invalid.gh,
    record:async()=>{calls++;return null;}});
  assert.equal(result.status,"PR_NOT_ELIGIBLE_PHIBOT_DRAFT");
  assert.equal(result.localEnqueue,"NOT_REQUESTED_OR_NOT_ELIGIBLE");
  assert.equal(calls,0);
});

test("caller cannot bypass owner/repo allowlist or inject arbitrary capability",async()=>{
  const reader=fixtures();
  await assert.rejects(runPreflight({argv:args(),env:{
    PHIBOT_OWNER:"MichaelWave369",
    PHIBOT_REPO_ALLOWLIST:"MichaelWave369/Other"},gh:reader.gh}),/QUEUE_REPOSITORY_NOT_ALLOWED/);
  await assert.rejects(runPreflight({argv:args("--checks","other"),env,gh:reader.gh}),/ARGUMENT_INVALID/);
  await assert.rejects(runPreflight({argv:args().map(x=>x==="test"?"test,":x),env,gh:reader.gh}),
    /QUEUE_CHECK_POLICY_INVALID/);
  assert.equal(reader.calls.length,0);
});
