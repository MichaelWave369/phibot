import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyR3, proposeR3 } from "./learning-review-r3.mjs";
import {
  validateReviewPacket, validateFixtures, readReviewPacket,
  makeSyntheticObservation, scoreRegressions, evaluateR4, exportR4
} from "./learning-regression-r4.mjs";

const repo = "MichaelWave369/Demo";
const shaA = "1".repeat(40), shaB = "2".repeat(40);
const date = Date.parse("2026-10-29T12:00:00.000Z");
const fixturePath = fileURLToPath(new URL("../fixtures/learning-r4-regression.v1.json",import.meta.url));
const env = { PHIBOT_OWNER: "MichaelWave369", PHIBOT_REPO_ALLOWLIST: repo,
  PHIBOT_GITHUB_TOKEN: "NOT_A_REAL_TOKEN_R4" };
const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");

function observed(sha) {
  return {
    repo, run_id:"ci-pr9-" + sha, source_sha:sha,
    layer:"LOOP", failure_class:"FAILED_GATE",
    task_kind:"repo.steward.inspect",
    check_id:"CI_" + hash("test").slice(0,24).toUpperCase(),
    expected_code:"CHECKS_PASS_REVIEW_ONLY",
    observed_code:"CHECKS_FAILED",
    evidence_sha256:hash({ sha, tag:"independent-fixture" })
  };
}
function mockR3(sha, id) {
  const endpoint="/repos/"+repo;
  const calls=[];
  const gh=async (method,path,data) => {
    calls.push([method,path]);
    assert.equal(method,"GET"); assert.equal(data,undefined);
    if(path===endpoint+"/commits/"+sha+"/check-runs?per_page=100")
      return { total_count:1,check_runs:[
        { id,name:"test",status:"completed",conclusion:"failure"}] };
    if(path===endpoint+"/check-runs/"+id)
      return {id,name:"test",head_sha:sha,status:"completed",conclusion:"failure",
        check_suite:{head_sha:sha}};
    if(path===endpoint+"/pulls/9")
      return {state:"open",draft:true,head:{sha,repo:{full_name:repo}},
        base:{repo:{full_name:repo}}};
    throw Error("unexpected mock call");
  };
  const bridge=async()=>({
    schema:"phibot.learning.ci.bridge.v1",status:"REVIEW_ONLY_PREVIEW",
    repo,pr:9,check:"test",source_sha:sha,
    source:"RECHECKED_GITHUB_API_READ_NOT_INDEPENDENT_ATTESTATION",
    grants:0,remote_writes:0,retry_enforcement:false,
    evidence_sha256:observed(sha).evidence_sha256,observation:observed(sha)
  });
  return {gh,bridge,calls};
}
async function temp(fn) {
  const dir=await mkdtemp(join(tmpdir(),"phi-r4-"));
  try { await fn(dir); } finally { await rm(dir,{recursive:true,force:true}); }
}
async function setup(dir) {
  const all=[];
  for(const [sha,id] of [[shaA,77],[shaB,78]]) {
    const fixture=mockR3(sha,id);
    const audit=await verifyR3({
      argv:["--repo",repo,"--pr","9","--check","test","--sha",sha,"--save"],
      env, gh:fixture.gh, bridge:fixture.bridge, now:()=>date, root:dir
    });
    assert.equal(audit.status,"LOCAL_UNSIGNED_AUDIT_SAVED");
    assert.ok(fixture.calls.every(([method])=>method==="GET"));
    all.push(audit.audit_id);
  }
  const packet=await proposeR3(all[0],all[1],{root:dir,now:()=>date});
  return {packet:packet.proposal_id,audits:all};
}

test("R4 fixture contract demands all eight independent counterfactual categories",async()=>{
  const v=JSON.parse(await readFile(fixturePath,"utf8"));
  validateFixtures(v);
  assert.equal(v.cases.length,8);
  assert.throws(()=>validateFixtures({...v,cases:v.cases.slice(0,7)}),
    /LG_R4_FIXTURE_CONTRACT_INVALID/);
  assert.throws(()=>validateFixtures({...v,cases:[
    {...v.cases[0],expected_stop:false},...v.cases.slice(1)
  ]}),/LG_R4_FIXTURE_CASE_INVALID/);
  assert.throws(()=>validateFixtures({...v,cases:[
    {...v.cases[0],unexpected_grant:true},...v.cases.slice(1)
  ]}),/LG_R4_INVALID_KEYS/);
  assert.throws(()=>validateFixtures({...v,cases:[
    v.cases[0],v.cases[0],...v.cases.slice(2)
  ]}),/LG_R4_FIXTURE_CASE_INVALID/);
});

test("R4 synthetic counterfactuals classify positive and negative examples",()=>{
  const sample=observed(shaA), target=hash({schema:"test"});
  const cases=JSON.parse(requireFixture()).cases;
  const actual=cases.map((v,i)=>{
    const o=makeSyntheticObservation(sample,v.scenario,i);
    assert.notEqual(o.run_id,sample.run_id);
    return v.scenario==="OTHER_REPOSITORY" ? o.repo!==repo :
      v.scenario==="OTHER_CHECK" ? o.check_id!==sample.check_id : true;
  });
  assert.ok(actual.every(Boolean));
  assert.equal(typeof target,"string");
});

function requireFixture() {
  return JSON.stringify({cases:[
    {scenario:"SAME_SIGNATURE_NEW_RUN"}, {scenario:"SAME_SIGNATURE_NEW_SHA"},
    {scenario:"SAME_SIGNATURE_NEW_EVIDENCE"}, {scenario:"OTHER_REPOSITORY"},
    {scenario:"OTHER_CHECK"}, {scenario:"OTHER_FAILURE_CODE"},
    {scenario:"OTHER_LAYER"}, {scenario:"OTHER_TASK_KIND"}]});
}

test("R4 evaluates 3 true matches, 5 true exclusions, and no synthetic false positives",async()=>{
  await temp(async root=>{
    const {packet}=await setup(root);
    const result=await evaluateR4(packet,fixturePath,{root,now:()=>date});
    assert.equal(result.status,"SYNTHETIC_REGRESSION_PASS");
    assert.deepEqual(result.metrics,{
      tested:8,true_positive:3,true_negative:5,false_positive:0,false_negative:0,
      synthetic_false_positive_rate:0,synthetic_false_negative_rate:0
    });
    assert.equal(result.cases.every(x=>x.pass),true);
    assert.equal(result.live_false_positive_rate,null);
    assert.equal(result.live_replay_verified,false);
    assert.equal(result.approved,false);
    assert.equal(result.enforced,false);
    assert.equal(result.grants,0);
    assert.equal(result.policy_writes,0);
    await assert.rejects(readdir(join(root,"r4")),{code:"ENOENT"});
  });
});

test("bad classifiers reveal synthetic false positives and false negatives",async()=>{
  await temp(async root=>{
    const {packet}=await setup(root);
    const fp=await evaluateR4(packet,fixturePath,{root,now:()=>date,
      predict:()=>true});
    assert.equal(fp.status,"REGRESSION_BLOCKED");
    assert.equal(fp.metrics.false_positive,5);
    assert.equal(fp.metrics.synthetic_false_positive_rate,1);
    const fn=await evaluateR4(packet,fixturePath,{root,now:()=>date,
      predict:()=>false});
    assert.equal(fn.status,"REGRESSION_BLOCKED");
    assert.equal(fn.metrics.false_negative,3);
    assert.equal(fn.metrics.synthetic_false_negative_rate,1);
    await assert.rejects(exportR4(packet,fixturePath,{root,now:()=>date,
      predict:()=>true}),/LG_R4_REGRESSION_NOT_QUALIFIED/);
    await assert.rejects(readdir(join(root,"r4")),{code:"ENOENT"});
  });
});

test("explicit R4 handoff exports an immutable unsigned non-executable review request",async()=>{
  await temp(async root=>{
    const {packet}=await setup(root);
    const e=await exportR4(packet,fixturePath,{root,now:()=>date});
    assert.equal(e.status,"OFFLINE_HANDOFF_FOR_HUMAN_REVIEW");
    assert.equal(e.save_status,"CREATED");
    assert.equal(e.approved,false);
    assert.equal(e.executable,false);
    const file=join(root,"r4","handoffs",e.handoff_id+".json");
    const data=JSON.parse(await readFile(file,"utf8"));
    assert.equal(data.origin,"PHIBOT_R4_OFFLINE_REVIEW");
    assert.equal(data.destination,"PHIOS_REALITY_GATE_FUTURE_REVIEW_INBOX");
    assert.equal(data.mode,"UNTRUSTED_HUMAN_REVIEW_REQUEST_ONLY");
    assert.equal(data.authority.grants,0);
    assert.equal(data.authority.policy_writes,0);
    assert.equal(data.authority.merge,false);
    assert.equal(data.authority.deploy,false);
    assert.equal(data.authority.executable,false);
    assert.equal(data.requested_action,"REVIEW_STOP_RETRY_ADVISORY_ONLY");
    assert.ok(data.required_before_any_promotion.includes("SIGNED_REALITY_GATE_GRANT"));
    assert.ok(!JSON.stringify(data).includes(env.PHIBOT_GITHUB_TOKEN));
    const again=await exportR4(packet,fixturePath,{root,now:()=>date});
    assert.equal(again.save_status,"EXISTS_IDENTICAL");
    assert.equal(again.handoff_id,e.handoff_id);
    data.authority.executable=true;
    await writeFile(file,JSON.stringify(data));
    await assert.rejects(exportR4(packet,fixturePath,{root,now:()=>date}),
      /LG_R4_HANDOFF_TAMPER_OR_COLLISION/);
  });
});

test("R3 audit and proposal tampering fail before regression evaluation",async()=>{
  await temp(async root=>{
    const {packet,audits}=await setup(root);
    const proposalPath=join(root,"r3","review-proposals",packet+".json");
    const original=await readFile(proposalPath,"utf8");
    await writeFile(proposalPath,original.replace("false","true"));
    await assert.rejects(evaluateR4(packet,fixturePath,{root,now:()=>date}),
      /LG_R4_PROPOSAL_INTEGRITY_INVALID/);
    await writeFile(proposalPath,original);
    const auditPath=join(root,"r3","audits",audits[0]+".json");
    const prior=JSON.parse(await readFile(auditPath,"utf8"));
    prior.proof.conclusion="success";
    await writeFile(auditPath,JSON.stringify(prior));
    await assert.rejects(evaluateR4(packet,fixturePath,{root,now:()=>date}));
  });
});

test("R4 refuses expired or future audits and missing support",async()=>{
  await temp(async root=>{
    const {packet,audits}=await setup(root);
    await assert.rejects(evaluateR4(packet,fixturePath,{
      root,now:()=>date+15*86400000}),/LG_R4_AUDIT_STALE_OR_FUTURE/);
    await assert.rejects(evaluateR4(packet,fixturePath,{
      root,now:()=>date-1}),/LG_R4_AUDIT_STALE_OR_FUTURE/);
    await rm(join(root,"r3","audits",audits[0]+".json"));
    await assert.rejects(evaluateR4(packet,fixturePath,{root,now:()=>date}));
  });
});

test("fixture editing or oversized/unexpected files are refused before export",async()=>{
  await temp(async root=>{
    const {packet}=await setup(root);
    const bad=join(root,"bad.json");
    const f=JSON.parse(await readFile(fixturePath,"utf8"));
    f.cases[3].expected_stop=true;
    await writeFile(bad,JSON.stringify(f));
    await assert.rejects(exportR4(packet,bad,{root,now:()=>date}),
      /LG_R4_FIXTURE_CASE_INVALID/);
    await writeFile(bad,"A".repeat(8193));
    await assert.rejects(evaluateR4(packet,bad,{root,now:()=>date}),
      /LG_R4_SOURCE_SIZE_OR_TYPE_INVALID/);
    await assert.rejects(readdir(join(root,"r4")),{code:"ENOENT"});
  });
});
