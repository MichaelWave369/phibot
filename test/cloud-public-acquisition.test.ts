import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CLOUD_REPO, CLOUD_MISSION_ID, CLOUD_AGENT_REF, CLOUD_MISSION_SCHEMA } from "../src/cloud/mission-evidence.js";
import {
  PUBLIC_API, inspectPublishedCloudScout, publicGitHubGet,
} from "../src/cloud/public-acquisition.js";

const NOW = Date.parse("2026-10-08T22:20:00Z");
const REVISION = "c".repeat(40);
const RUN_ID = "37851619515";
const RUN_SHA = "4935d95";
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
function blob(path: string, bytes: Uint8Array) {
  return { name: path.split("/").at(-1), path, type: "file", encoding: "base64",
    size: bytes.length, sha: createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex"),
    content: Buffer.from(bytes).toString("base64") };
}
function fixture() {
  const status = {
    schema: "fielddeck.cloud-observation.v1", receipt_kind: "observation_not_authorization",
    run_at: "2026-10-08T22:09:12+00:00", run_id: RUN_ID, trigger: "push",
    sha: RUN_SHA, run_url: "https://github.com/" + CLOUD_REPO + "/actions/runs/" + RUN_ID,
    overall: "ok",
    results: [
      { task:"heartbeat",kind:"observation",status:"ok",duration_s:0,output:{signal:"alive"}},
      { task:"repo_layout",kind:"observation",status:"ok",duration_s:0,output:{required_files:3,present_files:3}},
      { task:"github_repo_metrics",kind:"observation",status:"ok",duration_s:0.466,
        output:{repository:CLOUD_REPO,stars:0,open_issues_and_prs:0}},
    ],
  };
  const statusBytes = Buffer.from(JSON.stringify(status,null,2)+"\n");
  const mission: Record<string, unknown> = {
    schema: CLOUD_MISSION_SCHEMA, mission_id: CLOUD_MISSION_ID,
    agent_identity_ref: CLOUD_AGENT_REF, source_repository: CLOUD_REPO,
    source_status_sha256: hash(statusBytes), task_id: "github_repo_metrics",
    execution_class: "DELEGATED_FIXED_OBSERVER_NOT_PHIBOT_RUNTIME",
    run_id: RUN_ID, run_sha: RUN_SHA, run_url: status.run_url,
    observed_at: status.run_at, expires_at: "2026-10-09T06:09:12+00:00",
    outcome: "OBSERVED_OK",
    budget: {max_observations:1,model_calls:0,network_writes:0},
    epistemic: "UNVERIFIED_PUBLIC",worker_observation_executed:true,
    phibot_runtime_executed:false,model_inference_executed:false,
    authority_granted:false,network_write_executed:false,memory_admitted:false,
  };
  mission.receipt_sha256 = createHash("sha256")
    .update(Buffer.from("PHIBOT-CLOUD-OBSERVATION-V1\0")).update(canonical(mission)).digest("hex");
  const missionBytes = Buffer.from(JSON.stringify(mission,null,2)+"\n");
  const run = {
    id:Number(RUN_ID),repository:{full_name:CLOUD_REPO},
    name:"FieldCloudWorker Observation Pilot",path:".github/workflows/worker.yml",
    head_branch:"main",event:"push",head_sha:RUN_SHA+"4".repeat(33),
    status:"completed",conclusion:"success",html_url:status.run_url,
    created_at:"2026-10-08T22:09:05Z",updated_at:"2026-10-08T22:09:36Z",
  };
  const paths = [
    PUBLIC_API + "/branches/main",
    PUBLIC_API + "/contents/docs/status.json?ref=" + REVISION,
    PUBLIC_API + "/contents/docs/phibot_mission.json?ref=" + REVISION,
    PUBLIC_API + "/actions/runs/" + RUN_ID,
  ];
  const data = new Map<string, unknown>([
    [paths[0]!, {name:"main",commit:{sha:REVISION}}],
    [paths[1]!, blob("docs/status.json", statusBytes)],
    [paths[2]!, blob("docs/phibot_mission.json", missionBytes)],
    [paths[3]!, run],
  ]);
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    if (!data.has(url)) throw new Error("TEST_DISALLOWED_URL");
    return Buffer.from(JSON.stringify(data.get(url)));
  };
  return { data, paths, calls, get, status, mission, run };
}
test("four fixed requests, pinned same commit, no autonomous capabilities",async()=>{
  const f=fixture();
  const receipt=await inspectPublishedCloudScout(f.get,NOW);
  assert.deepEqual(f.calls,f.paths);
  assert.equal(receipt.review.disposition,"OBSERVED_OK_UNVERIFIED_PUBLIC");
  assert.equal(receipt.github_run_metadata_correlated,true);
  assert.equal(receipt.independent_prior_source_pin_verified,false);
  assert.equal(receipt.authority_granted,false);
  assert.equal(receipt.bot_spawned,false);
  assert.equal(receipt.action_executed,false);
  assert.equal(receipt.memory_admitted,false);
  assert.equal(receipt.agent_runtime_executed,false);
  assert.equal(receipt.review.agent_identity_authenticated,false);
  assert.ok(!JSON.stringify(receipt).includes('"stars"'));
});
test("public loader rejects user-controlled URLs before network",async()=>{
  await assert.rejects(()=>publicGitHubGet("https://evil.test/secret"),/URL_NOT_ALLOWED/);
  await assert.rejects(()=>publicGitHubGet(PUBLIC_API+"/actions/workflows/worker.yml/dispatches"),/URL_NOT_ALLOWED/);
  await assert.rejects(()=>publicGitHubGet(PUBLIC_API+"/contents/private.env?ref="+REVISION),/URL_NOT_ALLOWED/);
});
test("replaced Git blob or file identity fails closed",async()=>{
  const f=fixture();(f.data.get(f.paths[1]!) as Record<string,unknown>).sha="f".repeat(40);
  await assert.rejects(()=>inspectPublishedCloudScout(f.get,NOW),/GIT_BLOB_SHA/);
  const g=fixture();(g.data.get(g.paths[2]!) as Record<string,unknown>).path="docs/evil.json";
  await assert.rejects(()=>inspectPublishedCloudScout(g.get,NOW),/FILE_IDENTITY/);
});
test("wrong main ref, metadata identity, run commit or outcome rejected",async()=>{
  const a=fixture();(a.data.get(a.paths[0]!) as Record<string,unknown>).name="feature";
  await assert.rejects(()=>inspectPublishedCloudScout(a.get,NOW),/BRANCH/);
  const b=fixture();b.run.head_sha="f".repeat(40);
  await assert.rejects(()=>inspectPublishedCloudScout(b.get,NOW),/RUN_COMMIT_EVENT/);
  const c=fixture();b.run.repository.full_name="hijacked/repo";
  await assert.rejects(()=>inspectPublishedCloudScout(b.get,NOW),/RUN_IDENTITY/);
  const d=fixture();d.run.conclusion="failure";
  await assert.rejects(()=>inspectPublishedCloudScout(d.get,NOW),/RUN_CONCLUSION/);
  const e=fixture();e.run.path=".github/workflows/evil.yml";
  await assert.rejects(()=>inspectPublishedCloudScout(e.get,NOW),/RUN_IDENTITY/);
});
test("altered mission, wrong expiry, added authority, or poisoned task cannot pass",async()=>{
  const a=fixture();
  const bad=Buffer.from(JSON.stringify({...a.mission,authority_granted:true}));
  a.data.set(a.paths[2]!,blob("docs/phibot_mission.json",bad));
  await assert.rejects(()=>inspectPublishedCloudScout(a.get,NOW),/PHIBOT_CLOUD_/);
  const b=fixture();
  b.status.results[2]!.task="execute_shell";
  b.data.set(b.paths[1]!,blob("docs/status.json",Buffer.from(JSON.stringify(b.status))));
  await assert.rejects(()=>inspectPublishedCloudScout(b.get,NOW),/PHIBOT_CLOUD_/);
});
test("stale source clearly marked stale, never healthy",async()=>{
  const f=fixture();
  const receipt=await inspectPublishedCloudScout(f.get,NOW+9*60*60*1000);
  assert.equal(receipt.review.disposition,"STALE_UNVERIFIED_PUBLIC");
});
test("source-only repo snapshot does not authenticate PhiBot or prove measurement truth",async()=>{
  const f=fixture();const r=await inspectPublishedCloudScout(f.get,NOW);
  assert.equal(r.operator_identity_authenticated,false);
  assert.equal(r.measurement_truth_authenticated,false);
  assert.equal(r.source_authorship_authenticated,false);
  assert.equal(r.review.provenance_authenticated,false);
  assert.equal(r.review.independent_run_metadata_checked,false);
});
