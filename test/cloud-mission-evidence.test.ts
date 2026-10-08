import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CLOUD_MISSION_ID, CLOUD_AGENT_REF, CLOUD_MISSION_SCHEMA,
  inspectCloudMission,
} from "../src/cloud/mission-evidence.js";

const domain = Buffer.from("PHIBOT-CLOUD-OBSERVATION-V1\0", "utf8");
const baseTime = Date.parse("2026-10-08T21:20:00Z");
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "["+v.map(canonical).join(",")+"]";
  if (v !== null && typeof v === "object") {
    const obj = v as Record<string,unknown>;
    return "{"+Object.keys(obj).sort().map(k=>JSON.stringify(k)+":"+canonical(obj[k])).join(",")+"}";
  }
  return JSON.stringify(v);
}
function hash(v: Uint8Array | string): string {return createHash("sha256").update(v).digest("hex");}
function fixture(failed=false) {
  const status={
    schema:"fielddeck.cloud-observation.v1",
    receipt_kind:"observation_not_authorization",
    run_at:"2026-10-08T21:10:46+00:00",run_id:"37844903712",trigger:"push",
    sha:"8e81ffe",
    run_url:"https://github.com/MichaelWave369/FieldCloudWorker/actions/runs/37844903712",
    overall:failed?"error":"ok",
    results:[
      {task:"heartbeat",kind:"observation",status:"ok",duration_s:0,output:{signal:"alive"}},
      {task:"repo_layout",kind:"observation",status:"ok",duration_s:0,output:{required_files:3,present_files:3}},
      failed?{task:"github_repo_metrics",kind:"observation",status:"error",error_code:"RuntimeError",duration_s:0.2}:
        {task:"github_repo_metrics",kind:"observation",status:"ok",duration_s:0.2,
         output:{repository:"MichaelWave369/FieldCloudWorker",stars:2,open_issues_and_prs:1}}
    ]
  };
  const raw=Buffer.from(JSON.stringify(status,null,2)+"\n");
  const mission: Record<string,unknown>={
    schema:CLOUD_MISSION_SCHEMA,
    mission_id:CLOUD_MISSION_ID,
    agent_identity_ref:CLOUD_AGENT_REF,
    source_repository:"MichaelWave369/FieldCloudWorker",
    source_status_sha256:hash(raw),
    task_id:"github_repo_metrics",
    execution_class:"DELEGATED_FIXED_OBSERVER_NOT_PHIBOT_RUNTIME",
    run_id:status.run_id,run_sha:status.sha,run_url:status.run_url,
    observed_at:status.run_at,expires_at:"2026-10-09T05:10:46+00:00",
    outcome:failed?"OBSERVED_ERROR":"OBSERVED_OK",
    budget:{max_observations:1,model_calls:0,network_writes:0},
    epistemic:"UNVERIFIED_PUBLIC",
    worker_observation_executed:true,
    phibot_runtime_executed:false,model_inference_executed:false,
    authority_granted:false,network_write_executed:false,memory_admitted:false,
  };
  mission.receipt_sha256=createHash("sha256").update(domain).update(canonical(mission)).digest("hex");
  return {raw,mission};
}
test("cloud Scout pass becomes strictly review-only and redacted",()=>{
  const {raw,mission}=fixture();
  const r=inspectCloudMission(mission,raw,baseTime);
  assert.equal(r.disposition,"OBSERVED_OK_UNVERIFIED_PUBLIC");
  assert.equal(r.agent_identity_ref,CLOUD_AGENT_REF);
  assert.equal(r.integrity_hash_matched,true);
  assert.equal(r.provenance_authenticated,false);
  assert.equal(r.agent_identity_authenticated,false);
  assert.equal(r.independent_run_metadata_checked,false);
  assert.equal(r.authority_granted,false);
  assert.equal(r.spawn_authorized,false);
  assert.equal(r.memory_admitted,false);
  assert.equal(r.routing_influence,"NONE");
  assert.ok(!JSON.stringify(r).includes("stars"));
});
test("failed observation remains failed and error text omitted",()=>{
  const {raw,mission}=fixture(true);
  const review=inspectCloudMission(mission,raw,baseTime);
  assert.equal(review.disposition,"OBSERVED_ERROR_UNVERIFIED_PUBLIC");
  assert.ok(!JSON.stringify(review).includes("RuntimeError"));
});
test("expires after eight hours, cannot be green forever",()=>{
  const {raw,mission}=fixture();
  const review=inspectCloudMission(mission,raw,baseTime+9*60*60*1000);
  assert.equal(review.disposition,"STALE_UNVERIFIED_PUBLIC");
});
test("altered source bytes, mismatched run or task rejected",()=>{
  const {raw,mission}=fixture();
  assert.throws(()=>inspectCloudMission(mission,Buffer.concat([raw,Buffer.from(" ")]),baseTime),/SOURCE_HASH/);
  const wrong={...mission,run_id:"78"};
  assert.throws(()=>inspectCloudMission(wrong,raw,baseTime),/RUN_URL/);
});
test("model, writes, grants or runtime-claim field mutations rejected",()=>{
  const {raw,mission}=fixture();
  for(const changed of [
    {...mission,authority_granted:true},
    {...mission,phibot_runtime_executed:true},
    {...mission,model_inference_executed:true},
    {...mission,budget:{max_observations:1,model_calls:1,network_writes:0}},
    {...mission,budget:{max_observations:1,model_calls:0,network_writes:1}},
  ])assert.throws(()=>inspectCloudMission(changed,raw,baseTime));
});
test("forged identity, task, extra fields and hash rejected",()=>{
  const {raw,mission}=fixture();
  for(const changed of [
    {...mission,agent_identity_ref:"private-operator"},
    {...mission,task_id:"shell_exec"},
    {...mission,operator_signoff:true},
    {...mission,receipt_sha256:"f".repeat(64)},
  ])assert.throws(()=>inspectCloudMission(changed,raw,baseTime));
});
test("rehashed but wrong declared task result still rejected against source",()=>{
  const {raw,mission}=fixture();
  const forged={...mission,outcome:"OBSERVED_ERROR"};
  delete forged.receipt_sha256;
  forged.receipt_sha256=createHash("sha256").update(domain).update(canonical(forged)).digest("hex");
  assert.throws(()=>inspectCloudMission(forged,raw,baseTime),/TASK_OUTCOME/);
});
test("future timestamp, malformed JSON and unqualified local run rejected",()=>{
  const {raw,mission}=fixture();
  assert.throws(()=>inspectCloudMission(mission,raw,baseTime-3600000),/FUTURE_OBSERVATION/);
  assert.throws(()=>inspectCloudMission(mission,Buffer.from("bad"),baseTime),/SOURCE_HASH/);
  assert.throws(()=>inspectCloudMission({...mission,run_id:"local"},raw,baseTime));
});
