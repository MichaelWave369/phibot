#!/usr/bin/env node
/**
 * PHIBOT-33 / R35: manual, privacy-acknowledged local queue evidence export.
 * No listener, network access, scheduler, model call, agent enrollment, grants,
 * GitHub mutation or permission promotion.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { QUEUE_HOME, inspectQueue, queuePolicy } from "./work-queue.mjs";

export const CREW_SCHEMA = "phibot.queue-crew-export.v1";
const CAPABILITIES = new Set(["repo.steward.discover", "repo.steward.inspect"]);
const STATES = new Set(["queued","leased","completed","exhausted"]);
const OUTCOMES = new Set([
  "OBSERVED_NO_PROMOTION","STALE_LEASE_RECOVERED","TOOL_DENIED",
  "TOOL_GATED","TOOL_FAILED","EXECUTION_EXCEPTION"
]);
const MAX_JOBS = 100;
const MAX_BYTES = 100000;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);

function validateObservedJob(job, policy) {
  if (!isObj(job)||!HEX64.test(job.id||"")||!CAPABILITIES.has(job.capability)||
      typeof job.repository!=="string"||!policy.repos.includes(job.repository)||
      !new RegExp("^"+policy.owner+"/[a-zA-Z0-9_.-]{1,100}$","i").test(job.repository)||
      !STATES.has(job.state)||!Number.isInteger(job.attempts)||
      job.attempts<0||job.attempts>2||
      typeof job.updatedAt!=="string"||!ISO.test(job.updatedAt)||
      !Number.isFinite(Date.parse(job.updatedAt)))
    throw new Error("CREW_QUEUE_RECORD_INVALID");
  return Object.freeze({
    id:job.id,repository:job.repository,
    capability:job.capability,state:job.state,
    attempts:job.attempts,updatedAt:job.updatedAt,
    outcome:OUTCOMES.has(job.lastOutcome)?job.lastOutcome:null
  });
}

export async function buildCrewExport({
  policy,dir=QUEUE_HOME,now=()=>new Date()
}={}) {
  if(!policy||!Array.isArray(policy.repos)||!policy.owner)
    throw new Error("CREW_EXPLICIT_POLICY_REQUIRED");
  const at=now();
  if(!(at instanceof Date)||!Number.isFinite(at.getTime()))
    throw new Error("CREW_CLOCK_INVALID");
  const inspected=await inspectQueue(policy,dir);
  if(!Array.isArray(inspected.jobs)||inspected.jobs.length>MAX_JOBS||
     inspected.jobs.length!==inspected.total)
    throw new Error("CREW_QUEUE_UNBOUNDED");
  const jobs=inspected.jobs.map(job=>validateObservedJob(job,policy));
  const ids=new Set(jobs.map(x=>x.id));
  if(ids.size!==jobs.length)throw new Error("CREW_QUEUE_DUPLICATE");
  const counts=Object.fromEntries([...STATES].map(s=>[s,jobs.filter(j=>j.state===s).length]));
  return {
    schema:CREW_SCHEMA,producer:"MichaelWave369/phibot",
    classification:"LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED",
    generatedAt:at.toISOString(),
    scope:{
      origin:"LOCAL_PERSISTED_READ_ONLY_QUEUE",
      runtimeWorkersVerified:false,modelRunsVerified:false,
      remoteWritesVerified:false,grantsIssued:false,
      completeFleetClaim:false,operatorDisclosureRequired:true
    },
    counts:{total:jobs.length,...counts},
    jobs
  };
}

export async function saveCrewExport({
  policy,dir=QUEUE_HOME,outputDir=join(dir,"crew-exports"),now=()=>new Date()
}={}) {
  const snapshot=await buildCrewExport({policy,dir,now});
  const body=JSON.stringify(snapshot,null,2)+"\n";
  if(Buffer.byteLength(body,"utf8")>MAX_BYTES)
    throw new Error("CREW_EXPORT_TOO_LARGE");
  await mkdir(outputDir,{recursive:true,mode:0o700});
  const safeStamp=snapshot.generatedAt.replace(/[:.]/g,"-");
  const file=resolve(outputDir,"crew-"+safeStamp+"-"+randomUUID()+".json");
  await writeFile(file,body,{flag:"wx",mode:0o600,encoding:"utf8"});
  return {status:"CREW_EXPORT_SAVED_LOCAL_REVIEW_ONLY",file,
    jobs:snapshot.counts.total,
    classification:snapshot.classification};
}

export async function main(argv=process.argv.slice(2),env=process.env) {
  if(argv.length!==1||argv[0]!=="--ack-repository-disclosure")
    throw new Error("Usage: npm run crew:export -- --ack-repository-disclosure");
  const result=await saveCrewExport({policy:queuePolicy(env)});
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{
    process.stderr.write("PhiBot crew export refused: "+
      (error instanceof Error?error.message:"unknown")+"\n");
    process.exitCode=1;
  });
}
