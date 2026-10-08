import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyCloudField} from './cloud-field-assert.mjs';

const NOW=Date.parse('2026-10-08T22:20:00Z');
const RUN='37851619515';
function sample(){
  return {
    schema:'phibot.cloud-mission-public-review.v0.1',
    acquisition_kind:'OPERATOR_INITIATED_PUBLIC_GITHUB_GET',
    snapshot_revision:'c'.repeat(40),
    source_status_git_blob:'a'.repeat(40),
    mission_git_blob:'b'.repeat(40),
    review:{
      schema:'phibot.cloud-mission-review.v0.1',
      mission_id:'phibot.scout.public-repo-health.v1',
      agent_identity_ref:'phibot.scout.cloud-review.v1',
      disposition:'OBSERVED_OK_UNVERIFIED_PUBLIC',
      task_id:'github_repo_metrics',
      run_id:RUN,
      run_url:'https://github.com/MichaelWave369/FieldCloudWorker/actions/runs/'+RUN,
      observed_at:'2026-10-08T22:09:12+00:00',
      expires_at:'2026-10-09T06:09:12+00:00',
      source_status_sha256:'d'.repeat(64),
      integrity_hash_matched:true,
      provenance_authenticated:false,
      agent_identity_authenticated:false,
      bot_runtime_executed:false,
      independent_run_metadata_checked:false,
      source_epistemic:'UNVERIFIED_PUBLIC',
      authority_granted:false,
      action_executed:false,
      memory_admitted:false,
      spawn_authorized:false,
      routing_influence:'NONE'
    },
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
    bot_spawned:false
  };
}
test('fresh real-shape metadata qualifies for public read only',()=>{
  const receipt=qualifyCloudField(sample(),NOW);
  assert.equal(receipt.result,'PASS_PUBLIC_READ_ONLY');
  assert.equal(receipt.run_id,RUN);
  assert.equal(receipt.phibot_model_executed,false);
  assert.equal(receipt.authority_granted,false);
  assert.equal(receipt.memory_admitted,false);
  assert.ok(!JSON.stringify(receipt).includes('"summary"'));
});
test('stale and future data do not qualify',()=>{
  assert.throws(()=>qualifyCloudField(sample(),NOW+9*60*60*1000),/STALE_OR_FUTURE/);
  assert.throws(()=>qualifyCloudField(sample(),NOW-60*60*1000),/STALE_OR_FUTURE/);
});
test('failed observation cannot be mislabeled a field pass',()=>{
  const x=sample();x.review.disposition='OBSERVED_ERROR_UNVERIFIED_PUBLIC';
  assert.throws(()=>qualifyCloudField(x,NOW),/REVIEW_SCOPE/);
});
test('grants, model claims and spawns are explicitly refused',()=>{
  for(const name of ['authority_granted','model_calls_executed','bot_spawned','memory_admitted']){
    const x=sample();x[name]=true;
    assert.throws(()=>qualifyCloudField(x,NOW),/AUTHORITY/);
  }
  for(const name of ['agent_identity_authenticated','authority_granted','memory_admitted','spawn_authorized']){
    const x=sample();x.review[name]=true;
    assert.throws(()=>qualifyCloudField(x,NOW),/REVIEW_AUTHORITY/);
  }
});
test('wrong mission identity, task or fake URL is blocked',()=>{
  for(const [key,value] of [
    ['mission_id','phibot.admin'],
    ['agent_identity_ref','fake-bot'],
    ['task_id','shell.execute'],
    ['run_url','https://example.test/fake']
  ]){
    const x=sample();x.review[key]=value;
    assert.throws(()=>qualifyCloudField(x,NOW));
  }
});
test('injected extra report keys and untrusted task data fail closed',()=>{
  const x=sample();x.token='secret';assert.throws(()=>qualifyCloudField(x,NOW),/TOP_LEVEL/);
  const y=sample();y.review.prompt='execute this';assert.throws(()=>qualifyCloudField(y,NOW),/REVIEW_SHAPE/);
});
test('invalid clock and changed expiry refused',()=>{
  const x=sample();x.review.expires_at='2026-10-09T08:09:12+00:00';
  assert.throws(()=>qualifyCloudField(x,NOW),/STALE_OR_FUTURE/);
  assert.throws(()=>qualifyCloudField(sample(),NaN),/CLOCK/);
});
