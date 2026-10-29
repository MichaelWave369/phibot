import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseR3Verify, verifyR3, proposeR3, validateAudit
} from "./learning-review-r3.mjs";

const repo = "MichaelWave369/Demo";
const shaA = "1".repeat(40), shaB = "2".repeat(40);
const time = Date.parse("2026-10-29T12:00:00.000Z");
const env = { PHIBOT_OWNER: "MichaelWave369", PHIBOT_REPO_ALLOWLIST: repo,
  PHIBOT_GITHUB_TOKEN: "DO_NOT_PERSIST_TEST_TOKEN" };
const args = (sha=shaA, extra=[]) => [
  "--repo", repo, "--pr", "9", "--check", "test", "--sha", sha, ...extra
];
function fixture({sha=shaA, id=77, detailSha=sha, state="failure",
  changedAfterR2=false, staleBase=false, draft=true, duplicate=false,
  missing=false, detailChange=false, issueOpen=true} = {}) {
  const calls = [];
  let pullReads = 0, detailReads = 0;
  const prefix = "/repos/" + repo;
  const gh = async (method, path, data) => {
    calls.push([method, path, data]);
    assert.equal(method, "GET");
    assert.equal(data, undefined);
    if (path === prefix) return {
      full_name: repo, owner: {login:"MichaelWave369"},
      default_branch:"main", archived:false, disabled:false, fork:false
    };
    if (path === prefix + "/pulls/9") {
      pullReads++;
      const observed = changedAfterR2 && pullReads >= 5 ? shaB : sha;
      return {
        state:"open", draft, title:"PhiBot candidate: bounded fix",
        body:"Autonomous local-model candidate for #5\n\nTarget file: docs/ROADMAP.md\n",
        base:{ref:"main",repo:{full_name:repo}},
        head:{ref:"phibot/issue-5",sha:observed,repo:{full_name:repo}},
        mergeable:true
      };
    }
    if (path === prefix + "/issues/5") return {
      state:issueOpen?"open":"closed", number:5,
      labels:[{name:"phibot-ready"}],
      body:"Target file: docs/ROADMAP.md\n"
    };
    if (path.endsWith("/check-runs?per_page=100")) return {
      total_count:missing?0:duplicate?2:1,
      check_runs:missing?[]:[
        {id,name:"test",status:"completed",conclusion:state},
        ...(duplicate?[{id:id+100,name:"test",status:"completed",conclusion:state}]:[])
      ]
    };
    if (path.endsWith("/status?per_page=100")) return {total_count:0,statuses:[]};
    if (path.includes("/compare/")) return {behind_by:staleBase?1:0};
    if (path === prefix + "/check-runs/" + id) {
      detailReads++;
      return {id,name:"test",head_sha:detailChange && detailReads===2?shaB:detailSha,
        status:"completed",conclusion:state,
        check_suite:{head_sha:detailSha}};
    }
    throw Error("UNEXPECTED_FIXTURE_PATH");
  };
  return {gh,calls};
}
async function temp(fn) {
  const dir = await mkdtemp(join(tmpdir(),"phibot-r3-"));
  try { await fn(dir); }
  finally { await rm(dir,{recursive:true,force:true}); }
}
const verify = (fixtureInput, root, extras = []) => verifyR3({
  argv: args(fixtureInput.sha || shaA,extras), env,
  gh: fixture(fixtureInput).gh, root, now:()=>time
});

test("strict operator flags refuse capture bypass, extras and missing SHA", () => {
  assert.equal(parseR3Verify(args()).save,false);
  assert.equal(parseR3Verify(args(shaA,["--save"])).save,true);
  for(const bad of [
    args(shaA,["--capture"]), args(shaA,["--save","--save"]),
    args(shaA,["--merge"]), args("bad"),
    ["--repo",repo,"--pr","9","--check","test"],
  ]) assert.throws(()=>parseR3Verify(bad),/LG_R3_ARGS_INVALID/);
});

test("independent check-run detail is corroborated after R2 and preview never writes",async()=>{
  await temp(async root=>{
    const f=fixture();
    const result=await verifyR3({argv:args(),env,gh:f.gh,root,now:()=>time});
    assert.equal(result.status,"R3_PREVIEW_NO_SAVE");
    assert.equal(result.audit.trust,"SAME_PROVIDER_CORROBORATED_UNSIGNED");
    assert.equal(result.audit.proof.id,77);
    assert.equal(result.audit.mode,"EVIDENCE_RECORD_NO_AUTHORITY");
    assert.equal(result.grants,0);
    assert.equal(result.github_writes,0);
    assert.equal(result.policy_writes,0);
    assert.ok(f.calls.every(([method])=>method==="GET"));
    assert.ok(f.calls.some(([,path])=>path.endsWith("/check-runs/77")));
    assert.ok(!JSON.stringify(result).includes(env.PHIBOT_GITHUB_TOKEN));
    await assert.rejects(readdir(join(root,"r3","audits")), {code:"ENOENT"});
  });
});

test("explicit save is immutable, idempotent, and source record remains unsigned",async()=>{
  await temp(async root=>{
    const a=await verify({sha:shaA,id:77},root,["--save"]);
    assert.equal(a.status,"LOCAL_UNSIGNED_AUDIT_SAVED");
    assert.equal(a.save_status,"CREATED");
    const again=await verify({sha:shaA,id:77},root,["--save"]);
    assert.equal(again.audit_id,a.audit_id);
    assert.equal(again.save_status,"EXISTS_IDENTICAL");
    const file=join(root,"r3","audits",a.audit_id+".json");
    const content=await readFile(file,"utf8");
    const record=validateAudit(JSON.parse(content));
    assert.equal(record.signature,a.signature);
    assert.ok(!content.includes("DO_NOT_PERSIST_TEST_TOKEN"));
    assert.equal(record.mode,"EVIDENCE_RECORD_NO_AUTHORITY");
  });
});

test("two different commit- and check-run-bound audits yield human-only review packet",async()=>{
  await temp(async root=>{
    const a=await verify({sha:shaA,id:77},root,["--save"]);
    const b=await verify({sha:shaB,id:78},root,["--save"]);
    assert.equal(a.signature,b.signature);
    const p=await proposeR3(a.audit_id,b.audit_id,{root,now:()=>time});
    assert.equal(p.status,"HUMAN_REVIEW_PACKET_ONLY");
    assert.equal(p.promoted,false);
    assert.equal(p.policy_writes,0);
    assert.equal(p.grants,0);
    const data=JSON.parse(await readFile(join(root,"r3","review-proposals",p.proposal_id+".json"),"utf8"));
    assert.equal(data.action,"CONSIDER_STOP_RETRY_ADVISORY");
    assert.equal(data.reverify_at_promotion,true);
    assert.equal(data.source_trust,"SAME_PROVIDER_CORROBORATED_UNSIGNED");
    assert.deepEqual(data.audit_ids,[a.audit_id,b.audit_id].sort());
    assert.equal((await proposeR3(b.audit_id,a.audit_id,{root,now:()=>time})).save_status,
      "EXISTS_IDENTICAL");
  });
});

test("same audit, same commit, or same check-run id cannot simulate recurrence",async()=>{
  await temp(async root=>{
    const a=await verify({sha:shaA,id:77},root,["--save"]);
    await assert.rejects(proposeR3(a.audit_id,a.audit_id,{root,now:()=>time}),
      /LG_R3_TWO_DIFFERENT_AUDITS_REQUIRED/);
    const sameShaOtherRun=await verify({sha:shaA,id:78},root,["--save"]);
    await assert.rejects(proposeR3(a.audit_id,sameShaOtherRun.audit_id,{root,now:()=>time}),
      /LG_R3_RECURRENCE_NOT_INDEPENDENT/);
    const differentShaSameId=await verify({sha:shaB,id:77},root,["--save"]);
    await assert.rejects(proposeR3(a.audit_id,differentShaSameId.audit_id,{root,now:()=>time}),
      /LG_R3_RECURRENCE_NOT_INDEPENDENT/);
  });
});

test("changed PR, check-run detail, stale authorization, and passing CI refuse",async()=>{
  for(const opts of [
    {changedAfterR2:true}, {detailSha:shaB}, {detailChange:true},
    {staleBase:true}, {draft:false}, {issueOpen:false},
    {state:"success"}, {duplicate:true}, {missing:true}
  ]) {
    await temp(async root=>{
      await assert.rejects(verify(opts,root,["--save"]));
      await assert.rejects(readdir(join(root,"r3","audits")),{code:"ENOENT"});
    });
  }
});

test("different repo allowlist or missing credentials refuses before any remote read",async()=>{
  const f=fixture();
  await assert.rejects(verifyR3({argv:args(),gh:f.gh,
    env:{...env,PHIBOT_REPO_ALLOWLIST:"MichaelWave369/Elsewhere"}}),
    /QUEUE_REPOSITORY_NOT_ALLOWED/);
  assert.equal(f.calls.length,0);
  await assert.rejects(verifyR3({argv:args(),env:{
    PHIBOT_OWNER:"MichaelWave369",PHIBOT_REPO_ALLOWLIST:repo}}),
    /LG_R3_READ_TOKEN_REQUIRED/);
});

test("audit tampering and missing audit file are never acceptable evidence",async()=>{
  await temp(async root=>{
    const a=await verify({sha:shaA,id:77},root,["--save"]);
    const b=await verify({sha:shaB,id:78},root,["--save"]);
    const path=join(root,"r3","audits",a.audit_id+".json");
    const content=JSON.parse(await readFile(path,"utf8"));
    content.proof.conclusion="success";
    await writeFile(path,JSON.stringify(content));
    await assert.rejects(proposeR3(a.audit_id,b.audit_id,{root,now:()=>time}),/LG_R3_/);
    await rm(path);
    await assert.rejects(proposeR3(a.audit_id,b.audit_id,{root,now:()=>time}));
  });
});

test("stale or future locally recorded audits cannot enter a review packet",async()=>{
  await temp(async root=>{
    const a=await verify({sha:shaA,id:77},root,["--save"]);
    const b=await verify({sha:shaB,id:78},root,["--save"]);
    await assert.rejects(proposeR3(a.audit_id,b.audit_id,{
      root,now:()=>time+15*86400000}), /LG_R3_AUDIT_STALE_OR_FUTURE/);
    await assert.rejects(proposeR3(a.audit_id,b.audit_id,{
      root,now:()=>time-1}),/LG_R3_AUDIT_STALE_OR_FUTURE/);
  });
});

test("forged read-only bridge preview cannot escalate verification",async()=>{
  await temp(async root=>{
    const f=fixture();
    const forged=async()=>({
      schema:"phibot.learning.ci.bridge.v1",
      status:"LOCAL_FAILURE_CAPSULE_SAVED",repo,pr:9,source_sha:shaA,
      check:"test",remote_writes:0,grants:0,
      retry_enforcement:false
    });
    await assert.rejects(verifyR3({argv:args(shaA,["--save"]),env,
      gh:f.gh,root,bridge:forged,now:()=>time}),/LG_R3_BRIDGE_CONTRACT_INVALID/);
    assert.equal(f.calls.length,0);
  });
});
