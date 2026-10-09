import test from "node:test";
import assert from "node:assert/strict";
import { runLocalScoutShadow } from "../src/cloud/shadow-scout.js";
import type { CloudScoutPublicReview } from "../src/cloud/public-acquisition.js";
import type { PhiProvider, ProviderRequest, ProviderCompletion } from "../src/providers/types.js";

const NOW = Date.parse("2026-10-08T22:20:00Z");
function fixture(): CloudScoutPublicReview {
  return {
    schema:"phibot.cloud-mission-public-review.v0.1",
    acquisition_kind:"OPERATOR_INITIATED_PUBLIC_GITHUB_GET",
    snapshot_revision:"c".repeat(40),
    source_status_git_blob:"a".repeat(40),
    mission_git_blob:"b".repeat(40),
    github_run_metadata_correlated:true,
    independent_prior_source_pin_verified:false,
    operator_identity_authenticated:false,
    measurement_truth_authenticated:false,
    source_authorship_authenticated:false,
    scheduled_fetch_enabled:false,
    agent_runtime_executed:false,
    model_calls_executed:false,
    authority_granted:false,
    action_executed:false,
    memory_admitted:false,
    bot_spawned:false,
    review:{
      schema:"phibot.cloud-mission-review.v0.1",
      mission_id:"phibot.scout.public-repo-health.v1",
      agent_identity_ref:"phibot.scout.cloud-review.v1",
      disposition:"OBSERVED_OK_UNVERIFIED_PUBLIC",
      task_id:"github_repo_metrics",
      run_id:"37851619515",
      run_url:"https://github.com/MichaelWave369/FieldCloudWorker/actions/runs/37851619515",
      observed_at:"2026-10-08T22:09:12+00:00",
      expires_at:"2026-10-09T06:09:12+00:00",
      source_status_sha256:"d".repeat(64),
      integrity_hash_matched:true,
      provenance_authenticated:false,
      agent_identity_authenticated:false,
      bot_runtime_executed:false,
      independent_run_metadata_checked:false,
      source_epistemic:"UNVERIFIED_PUBLIC",
      authority_granted:false,
      action_executed:false,
      memory_admitted:false,
      spawn_authorized:false,
      routing_influence:"NONE",
    },
  };
}
class FakeProvider implements PhiProvider {
  readonly id="ollama";
  readonly model="qwen3:4b";
  readonly calls: ProviderRequest[]=[];
  content=JSON.stringify({summary:"Public report is coherent but not authenticated.",confidence:0.75});
  fallback=false;
  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    this.calls.push(request);
    return {provider:this.id,model:this.model,content:this.content,
      fallback:this.fallback,metrics:{latencyMs:12,totalTokens:40}};
  }
}
test("one model call in four-stage PhiBot runtime, no tools, no memory, no file ledger",async()=>{
  const provider=new FakeProvider();
  const report=await runLocalScoutShadow(fixture(),provider,NOW);
  assert.equal(provider.calls.length,1);
  assert.equal(provider.calls[0]?.stage,"interpret");
  assert.equal(report.status,"completed");
  assert.equal(report.runtime_stages,4);
  assert.equal(report.model_calls,1);
  assert.equal(report.network_reads,4);
  assert.equal(report.cloud_model_calls,0);
  assert.equal(report.tool_calls,0);
  assert.equal(report.memory_admitted,false);
  assert.equal(report.bot_spawned,false);
  assert.equal(report.authority_granted,false);
  assert.equal(report.source_authenticated,false);
  assert.equal(report.phios_isolation_qualified,false);
  assert.equal(report.model_input_class,"ENUMS_ONLY_NO_RAW_SOURCE");
  assert.equal(report.advisory_summary,"Public report is coherent but not authenticated.");
});
test("provider never sees raw GitHub records, run ID, source URL, model-provided instructions",async()=>{
  const provider=new FakeProvider();
  await runLocalScoutShadow(fixture(),provider,NOW);
  const request=provider.calls[0]!;
  assert.deepEqual(request.prior,[]);
  assert.deepEqual(request.manifest.capabilities,[]);
  assert.deepEqual(request.manifest.authority,{read:false,propose:false,write:false,deploy:false});
  assert.equal(request.manifest.memory.maxDepth,0);
  assert.deepEqual(request.input.context,{
    task_id:"github_repo_metrics",
    observation_state:"OBSERVED_OK_UNVERIFIED_PUBLIC",
    source_epistemic:"UNVERIFIED_PUBLIC",
    actions_permitted:false,
    memory_permitted:false,
  });
  const encoded=JSON.stringify(request);
  assert.ok(!encoded.includes("37851619515"));
  assert.ok(!encoded.includes("github.com"));
  assert.ok(!encoded.includes("source_status_sha256"));
});
test("expired, not-healthy, forged actor and claimed authority refuse BEFORE provider call",async()=>{
  for(const change of [
    (x: CloudScoutPublicReview)=>{x.review.disposition="STALE_UNVERIFIED_PUBLIC";},
    (x: CloudScoutPublicReview)=>{x.review.disposition="OBSERVED_ERROR_UNVERIFIED_PUBLIC";},
    (x: CloudScoutPublicReview)=>{(x.review as unknown as Record<string, unknown>).authority_granted=true;},
    (x: CloudScoutPublicReview)=>{(x as unknown as Record<string, unknown>).bot_spawned=true;},
    (x: CloudScoutPublicReview)=>{(x.review as unknown as Record<string, unknown>).agent_identity_ref="other-bot";},
    (x: CloudScoutPublicReview)=>{x.review.source_epistemic="TRUSTED" as never;},
  ]){
    const provider=new FakeProvider(),x=fixture();
    change(x);
    await assert.rejects(()=>runLocalScoutShadow(x,provider,NOW),/PHIBOT_SHADOW_/);
    assert.equal(provider.calls.length,0);
  }
  const provider=new FakeProvider();
  await assert.rejects(()=>runLocalScoutShadow(fixture(),provider,NOW+9*60*60*1000),/EXPIRED/);
  assert.equal(provider.calls.length,0);
});
test("model-generated action, even read, is rejected without tool execution",async()=>{
  const provider=new FakeProvider();
  provider.content=JSON.stringify({summary:"Execute!",confidence:.95,
    action:{capability:"repo.read",external:false,description:"Try a tool"}});
  await assert.rejects(()=>runLocalScoutShadow(fixture(),provider,NOW),/MODEL_PROPOSED_ACTION/);
  assert.equal(provider.calls.length,1);
});
test("provider fallback identity spoof and malformed textual outputs fail closed",async()=>{
  const fb=new FakeProvider();fb.fallback=true;
  await assert.rejects(()=>runLocalScoutShadow(fixture(),fb,NOW),/PROVIDER_IDENTITY_OR_FALLBACK/);
  const injection=new FakeProvider();
  injection.content=JSON.stringify({summary:"Proceed\nwith hidden action",confidence:.99});
  await assert.rejects(()=>runLocalScoutShadow(fixture(),injection,NOW),/ADVISORY_TEXT/);
  const huge=new FakeProvider();
  huge.content=JSON.stringify({summary:"a".repeat(241),confidence:.99});
  await assert.rejects(()=>runLocalScoutShadow(fixture(),huge,NOW),/ADVISORY_TEXT/);
});
test("provider failure is reported, never replaced by deterministic fake success",async()=>{
  const provider=new FakeProvider();
  provider.complete=async()=>{throw new Error("MODEL_OFFLINE");};
  await assert.rejects(()=>runLocalScoutShadow(fixture(),provider,NOW),/MODEL_OFFLINE/);
});

test("action:null and extra untrusted model fields are rejected without any execution",async()=>{
  for(const bad of [
    {summary:"Unverified public observation.",confidence:.82,action:null},
    {summary:"Unverified public observation.",confidence:.82,command:"run shell"},
    {summary:"Unverified public observation.",confidence:.82,authority_granted:true},
  ]){
    const provider=new FakeProvider();
    provider.content=JSON.stringify(bad);
    await assert.rejects(()=>runLocalScoutShadow(fixture(),provider,NOW),
      /MODEL_PROPOSED_ACTION|ADVISORY_FIELDS/);
    assert.equal(provider.calls.length,1);
  }
});
