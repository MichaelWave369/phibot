#!/usr/bin/env node
/**
 * PHIBOT-10: manual field qualification of PHIBOT-09's public read summary.
 * Safe to use in a GitHub Actions log: never print raw GitHub data, task output,
 * provider text, credential content, or misleading agent execution claims.
 * A PASS certifies a public GET/consistency check, not source truth or identity.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ALLOWED_REPO='MichaelWave369/FieldCloudWorker';
const BASE='https://github.com/'+ALLOWED_REPO+'/actions/runs/';
const MISSION='phibot.scout.public-repo-health.v1';
const AGENT='phibot.scout.cloud-review.v1';
const MAX_BYTES=12_000;
const AGE=8*60*60*1000;

function fail(ok,code) {
  if(!ok)throw new Error('PHIBOT_FIELD_'+code);
}
function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function exact(v,fields){return object(v)&&Object.keys(v).sort().join('|')===[...fields].sort().join('|');}
function falseFlags(v,fields){return fields.every(key=>v[key]===false);}
function time(v,code) {
  fail(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v),code);
  const n=Date.parse(v);fail(Number.isFinite(n),code);return n;
}
export function qualifyCloudField(summary,now=Date.now()) {
  fail(Number.isSafeInteger(now)&&now>0,'CLOCK');
  fail(exact(summary,[
    'schema','acquisition_kind','snapshot_revision','source_status_git_blob',
    'mission_git_blob','review','github_run_metadata_correlated',
    'independent_prior_source_pin_verified','operator_identity_authenticated',
    'measurement_truth_authenticated','source_authorship_authenticated',
    'scheduled_fetch_enabled','agent_runtime_executed','model_calls_executed',
    'authority_granted','action_executed','memory_admitted','bot_spawned'
  ]),'TOP_LEVEL');
  fail(summary.schema==='phibot.cloud-mission-public-review.v0.1'&&
    summary.acquisition_kind==='OPERATOR_INITIATED_PUBLIC_GITHUB_GET','KIND');
  fail(/^[a-f0-9]{40}$/.test(summary.snapshot_revision)&&
    /^[a-f0-9]{40}$/.test(summary.source_status_git_blob)&&
    /^[a-f0-9]{40}$/.test(summary.mission_git_blob),'BLOBS');
  fail(summary.github_run_metadata_correlated===true&&
    falseFlags(summary,[
      'independent_prior_source_pin_verified','operator_identity_authenticated',
      'measurement_truth_authenticated','source_authorship_authenticated',
      'scheduled_fetch_enabled','agent_runtime_executed','model_calls_executed',
      'authority_granted','action_executed','memory_admitted','bot_spawned'
    ]),'AUTHORITY');
  const r=summary.review;
  fail(exact(r,[
    'schema','mission_id','agent_identity_ref','disposition','task_id','run_id',
    'run_url','observed_at','expires_at','source_status_sha256',
    'integrity_hash_matched','provenance_authenticated','agent_identity_authenticated',
    'bot_runtime_executed','independent_run_metadata_checked','source_epistemic',
    'authority_granted','action_executed','memory_admitted','spawn_authorized','routing_influence'
  ]),'REVIEW_SHAPE');
  fail(r.schema==='phibot.cloud-mission-review.v0.1'&&
    r.mission_id===MISSION&&r.agent_identity_ref===AGENT&&
    r.task_id==='github_repo_metrics'&&
    r.disposition==='OBSERVED_OK_UNVERIFIED_PUBLIC'&&
    r.source_epistemic==='UNVERIFIED_PUBLIC'&&
    r.routing_influence==='NONE','REVIEW_SCOPE');
  fail(typeof r.run_id==='string'&&/^[1-9][0-9]{0,18}$/.test(r.run_id)&&
    Number.isSafeInteger(Number(r.run_id))&&r.run_url===BASE+r.run_id,'RUN_URL');
  fail(typeof r.source_status_sha256==='string'&&/^[a-f0-9]{64}$/.test(r.source_status_sha256),'SOURCE_DIGEST');
  fail(r.integrity_hash_matched===true&&
    falseFlags(r,[
      'provenance_authenticated','agent_identity_authenticated',
      'bot_runtime_executed','independent_run_metadata_checked',
      'authority_granted','action_executed','memory_admitted','spawn_authorized'
    ]),'REVIEW_AUTHORITY');
  const observed=time(r.observed_at,'OBSERVED_TIME');
  const expires=time(r.expires_at,'EXPIRY_TIME');
  fail(expires-observed===AGE&&observed<=now+300_000&&now<=expires,'STALE_OR_FUTURE');

  return Object.freeze({
    schema:'phibot.cloud-field-qualification.v0.1',
    result:'PASS_PUBLIC_READ_ONLY',
    run_id:r.run_id,
    snapshot_sha_prefix:summary.snapshot_revision.slice(0,12),
    evidence_disposition:r.disposition,
    source_identity_authenticated:false,
    measurement_truth_authenticated:false,
    phibot_model_executed:false,
    bot_spawned:false,
    authority_granted:false,
    action_executed:false,
    memory_admitted:false
  });
}

async function main() {
  const args=process.argv.slice(2);
  fail(args.length===1,'USAGE');
  const bytes=await readFile(args[0]);
  fail(bytes.length>0&&bytes.length<=MAX_BYTES,'REPORT_SIZE');
  let report;
  try {report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw new Error('PHIBOT_FIELD_JSON');}
  const qualified=qualifyCloudField(report);
  const receipt={...qualified,report_sha256:createHash('sha256').update(bytes).digest('hex')};
  console.log(JSON.stringify(receipt,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error('PHIBOT_CLOUD_FIELD_REFUSED');process.exitCode=2;});
}
