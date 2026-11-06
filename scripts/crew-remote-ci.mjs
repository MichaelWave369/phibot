#!/usr/bin/env node
/**
 * PHIBOT-43. Read-only remote GitHub Actions observation for one PHIBOT-42
 * verified local commit. Never push, create PR, grant, merge or deploy.
 *
 * GitHub metadata is a remote API observation, NOT independent attestation
 * of test quality, trusted source, branch protection or merge permission.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubClient } from "./repo-steward.mjs";
import { verifyLocalDocCommit } from "../dist/src/crew-local-doc-commit.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^phibot\/docs-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WORKFLOW = "CI";
const WORKFLOW_PATH = ".github/workflows/ci.yml";
const JOB = "test";
const SOURCE = "GITHUB_API_READ_NOT_INDEPENDENT_ATTESTATION";
const MODE = "READ_ONLY_REMOTE_NO_MERGE_AUTHORITY";
const STATUSES = new Set([
  "CI_PASS_EVIDENCE_ONLY", "CI_FAILED", "CI_PENDING", "CI_NOT_OBSERVED",
  "REMOTE_BRANCH_NOT_AT_LOCAL_COMMIT", "CI_EVIDENCE_UNQUALIFIED",
  "CI_CHANGED_DURING_OBSERVATION",
]);
const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
const fields = (x, names) =>
  obj(x) && Object.keys(x).sort().join(",") === [...names].sort().join(",");
const sha256 = x => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const fail = code => { throw Error("CREW_CI_" + code); };

export function parseRemoteCIArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) fail("ARGS_INVALID");
  const params = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i+1];
    if (!["--draft", "--repo", "--remote"].includes(flag) ||
        typeof value !== "string" || !value.trim() || value.length > 250 ||
        Object.hasOwn(params, flag)) fail("ARGS_INVALID");
    params[flag] = value;
  }
  const draftId = params["--draft"], repoDir = params["--repo"];
  const remoteRepo = params["--remote"];
  if (!UUID.test(draftId || "") || !repoDir || !REPO.test(remoteRepo || ""))
    fail("ARGS_INVALID");
  return { draftId, repoDir, remoteRepo };
}
function policy(env, remoteRepo) {
  const roots = env.PHIBOT_CREW_REPO_ALLOWLIST?.split(";").map(x=>x.trim()).filter(Boolean) ?? [];
  const allowed = env.PHIBOT_CREW_REMOTE_REPO_ALLOWLIST?.split(";").map(x=>x.trim()).filter(Boolean) ?? [];
  if (!roots.length || roots.length > 12 || !allowed.length || allowed.length > 12 ||
      allowed.some(x => !REPO.test(x)) || !allowed.includes(remoteRepo))
    fail("EXPLICIT_LOCAL_AND_REMOTE_ALLOWLIST_REQUIRED");
  return roots;
}
function validLocal(x) {
  if (!obj(x) || x.status !== "LOCAL_COMMIT_HASH_VERIFIED_REMOTE_CI_UNKNOWN" ||
      !SHA.test(x.commit || "") || !SHA.test(x.parent || "") ||
      !BRANCH.test(x.branch || "") || !HEX64.test(x.sha256 || "") ||
      !/^(?:README\.md|docs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)$/.test(x.target || ""))
    fail("LOCAL_COMMIT_VERIFICATION_REQUIRED");
  return x;
}
function readOnly(gh, repository) {
  const base = "/repos/" + repository;
  const paths = [
    new RegExp("^" + base.replace(/[.*+?^()|[\]{}]/g,"\\$&") + "$"),
    new RegExp("^" + base.replace(/[.*+?^()|[\]{}]/g,"\\$&") + "/branches/"),
    new RegExp("^" + base.replace(/[.*+?^()|[\]{}]/g,"\\$&") + "/actions/runs(?:\\?|/)")
  ];
  return async (method, path) => {
    if (method !== "GET" || typeof path !== "string" ||
        path.length > 450 || !paths.some(x => x.test(path)))
      fail("GITHUB_READ_ONLY_BOUNDARY");
    return gh("GET", path);
  };
}
function branchIdentity(value, branch) {
  return obj(value) && value.name === branch &&
    obj(value.commit) && SHA.test(value.commit.sha || "") ?
    value.commit.sha : null;
}
function validRun(r, repo, local) {
  return obj(r) && Number.isSafeInteger(r.id) && r.id > 0 &&
    Number.isSafeInteger(r.run_attempt) && r.run_attempt >= 1 &&
    r.name === WORKFLOW && r.path === WORKFLOW_PATH &&
    r.head_sha === local.commit && r.head_branch === local.branch &&
    r.head_repository?.full_name === repo && r.repository?.full_name === repo &&
    ["pull_request", "push"].includes(r.event) &&
    ["queued", "in_progress", "completed", "requested", "waiting", "pending"].includes(r.status) &&
    (r.conclusion === null || typeof r.conclusion === "string");
}
function sameRun(a, b) {
  const members = [
    "id", "run_attempt", "name", "path", "head_sha", "head_branch",
    "event", "status", "conclusion",
  ];
  return members.every(k => a[k] === b[k]) &&
    a.head_repository?.full_name === b.head_repository?.full_name &&
    a.repository?.full_name === b.repository?.full_name;
}
function jobEvidence(response, runId) {
  if (!obj(response) || !Number.isInteger(response.total_count) ||
      !Array.isArray(response.jobs) ||
      response.jobs.length > 100 ||
      response.total_count !== response.jobs.length ||
      response.total_count !== 1) return null;
  const job = response.jobs[0];
  if (!obj(job) || job.name !== JOB ||
      !Number.isSafeInteger(job.id) || job.id < 1 ||
      job.run_id !== runId ||
      !["queued", "in_progress", "completed", "waiting", "pending"].includes(job.status) ||
      (job.conclusion !== null && typeof job.conclusion !== "string"))
    return null;
  return { id:job.id, name:JOB, status:job.status, conclusion:job.conclusion };
}
function report(local, remoteRepo, status, run=null, job=null, checkedAt = new Date().toISOString()) {
  return {
    schema: "phibot.crew.remote-ci-evidence.v1",
    checkedAt, source:SOURCE, mode:MODE,
    remoteRepo, branch:local.branch, exactSha:local.commit,
    parentSha:local.parent, target:local.target,
    localFileSha256:local.sha256,
    workflow:WORKFLOW, workflowPath:WORKFLOW_PATH, requiredJob:JOB,
    status,
    run:run === null ? null : {
      id:run.id, attempt:run.run_attempt, event:run.event,
      status:run.status, conclusion:run.conclusion,
    },
    job,
    remoteWrites:0, gitPushes:0, mergeAuthorized:false,
  };
}
export function verifyRemoteCIReceipt(value) {
  if (!fields(value, ["schema", "id", "observation", "observationDigest", "digest"]))
    fail("RECEIPT_SCHEMA_INVALID");
  if (!UUID.test(value.id) || !HEX64.test(value.observationDigest) ||
      !HEX64.test(value.digest)) fail("RECEIPT_INVALID");
  const v=value.observation;
  if (!fields(v, [
    "schema", "checkedAt", "source", "mode", "remoteRepo", "branch", "exactSha",
    "parentSha", "target", "localFileSha256", "workflow", "workflowPath",
    "requiredJob", "status", "run", "job", "remoteWrites", "gitPushes",
    "mergeAuthorized",
  ]) || v.schema!=="phibot.crew.remote-ci-evidence.v1" ||
      !Number.isFinite(Date.parse(v.checkedAt)) ||
      v.source!==SOURCE || v.mode!==MODE ||
      !REPO.test(v.remoteRepo) || !BRANCH.test(v.branch) ||
      !SHA.test(v.exactSha) || !SHA.test(v.parentSha) ||
      !HEX64.test(v.localFileSha256) ||
      !/^(?:README\.md|docs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)$/.test(v.target) ||
      v.workflow!==WORKFLOW || v.workflowPath!==WORKFLOW_PATH ||
      v.requiredJob!==JOB || !STATUSES.has(v.status) ||
      v.remoteWrites!==0 || v.gitPushes!==0 || v.mergeAuthorized!==false)
    fail("RECEIPT_OBSERVATION_INVALID");
  if (v.run !== null && (!fields(v.run, ["id", "attempt", "event", "status", "conclusion"]) ||
      !Number.isSafeInteger(v.run.id) || v.run.id < 1 ||
      !Number.isSafeInteger(v.run.attempt) || v.run.attempt < 1 ||
      !["push", "pull_request"].includes(v.run.event) ||
      !["queued", "in_progress", "completed", "requested", "waiting", "pending"].includes(v.run.status) ||
      (v.run.conclusion !== null && typeof v.run.conclusion !== "string")))
    fail("RECEIPT_RUN_INVALID");
  if (v.job !== null && (!fields(v.job, ["id", "name", "status", "conclusion"]) ||
      !Number.isSafeInteger(v.job.id) || v.job.id < 1 || v.job.name!==JOB ||
      !["queued", "in_progress", "completed", "waiting", "pending"].includes(v.job.status) ||
      (v.job.conclusion !== null && typeof v.job.conclusion !== "string")))
    fail("RECEIPT_JOB_INVALID");
  if (v.status==="CI_PASS_EVIDENCE_ONLY" &&
      (!v.run || !v.job || v.run.status!=="completed" ||
       v.run.conclusion!=="success" || v.job.status!=="completed" ||
       v.job.conclusion!=="success"))
    fail("RECEIPT_FALSE_PASS_INVALID");
  if (sha256(v)!==value.observationDigest) fail("RECEIPT_OBSERVATION_DIGEST_MISMATCH");
  const {digest, ...body}=value;
  if (sha256(body)!==digest) fail("RECEIPT_DIGEST_MISMATCH");
  return structuredClone(value);
}

export async function observeRemoteCI({
  draftId, repoDir, remoteRepo, allowedRoots, gh,
  verifyLocal=verifyLocalDocCommit, clock=()=>new Date(),
}) {
  if (!UUID.test(draftId || "") || !REPO.test(remoteRepo || "") ||
      !Array.isArray(allowedRoots) || allowedRoots.length===0 || allowedRoots.length>12)
    fail("OBSERVE_ARGS_INVALID");
  if (typeof gh!=="function") fail("GITHUB_READER_REQUIRED");
  const local=validLocal(await verifyLocal({draftId,repoDir,allowedRoots}));
  const at=clock();
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail("CLOCK_INVALID");
  const checkedAt=at.toISOString();
  const get=readOnly(gh,remoteRepo);
  const base="/repos/"+remoteRepo;
  const meta=await get("GET",base);
  if (!obj(meta) || meta.full_name!==remoteRepo ||
      meta.owner?.login!==remoteRepo.split("/")[0] ||
      meta.archived!==false || meta.disabled!==false || meta.fork!==false)
    fail("REMOTE_REPOSITORY_IDENTITY_INVALID");
  const branchPath=base+"/branches/"+encodeURIComponent(local.branch);
  const first=await get("GET",branchPath);
  const firstSha=branchIdentity(first,local.branch);
  if (!firstSha) fail("REMOTE_BRANCH_DATA_INVALID");
  if (firstSha!==local.commit)
    return report(local,remoteRepo,"REMOTE_BRANCH_NOT_AT_LOCAL_COMMIT",null,null,checkedAt);

  const runs=await get("GET",base+"/actions/runs?head_sha="+local.commit+"&per_page=100&page=1");
  if (!obj(runs) || !Number.isInteger(runs.total_count) ||
      !Array.isArray(runs.workflow_runs) ||
      runs.total_count!==runs.workflow_runs.length || runs.total_count>100)
    fail("REMOTE_RUN_LIST_INCOMPLETE");
  const candidates=runs.workflow_runs.filter(r => validRun(r,remoteRepo,local));
  if (candidates.length>50 || new Set(candidates.map(r=>r.id)).size!==candidates.length)
    fail("REMOTE_RUNS_AMBIGUOUS");
  const latest=[...candidates].sort((a,b)=>b.id-a.id)[0] ?? null;
  let job=null, status="CI_NOT_OBSERVED";
  if (latest) {
    if (latest.status !== "completed") status="CI_PENDING";
    else {
      const jobs=await get("GET",base+"/actions/runs/"+latest.id+"/jobs?per_page=100");
      job=jobEvidence(jobs,latest.id);
      status=!job?"CI_EVIDENCE_UNQUALIFIED":
        latest.conclusion==="success" && job.status==="completed" &&
        job.conclusion==="success"?"CI_PASS_EVIDENCE_ONLY":
        latest.conclusion==="failure" || job.conclusion==="failure"?"CI_FAILED":
        latest.conclusion===null || job.status!=="completed"?"CI_PENDING":
        "CI_EVIDENCE_UNQUALIFIED";
    }
    const refreshed=await get("GET",base+"/actions/runs/"+latest.id);
    if (!validRun(refreshed,remoteRepo,local) || !sameRun(latest,refreshed))
      status="CI_CHANGED_DURING_OBSERVATION";
  }
  const again=await get("GET",branchPath);
  if (branchIdentity(again,local.branch)!==local.commit)
    status="CI_CHANGED_DURING_OBSERVATION";
  return report(local,remoteRepo,status,latest,job,checkedAt);
}
export async function persistRemoteCI(observation, root, id=randomUUID()) {
  if (!UUID.test(id)) fail("RECEIPT_ID_INVALID");
  const candidate={
    schema:"phibot.crew.remote-ci-receipt.v1", id,
    observation, observationDigest:sha256(observation),
  };
  const receipt=verifyRemoteCIReceipt({...candidate,digest:sha256(candidate)});
  const canonical=await realpath(resolve(root));
  const state=join(canonical,".phibot");
  await mkdir(state,{recursive:true,mode:0o700});
  if (await realpath(state)!==state) fail("STATE_SYMLINK_REFUSED");
  const dir=join(state,"crew-remote-ci");
  await mkdir(dir,{recursive:true,mode:0o700});
  if (await realpath(dir)!==dir) fail("RECEIPT_DIR_SYMLINK_REFUSED");
  const path=join(dir,id+".json");
  await writeFile(path,JSON.stringify(receipt,null,2)+"\n",
    {encoding:"utf8",flag:"wx",mode:0o600});
  return {receipt,path};
}
export async function listRemoteCI(root) {
  const canonical=await realpath(resolve(root));
  const dir=join(canonical,".phibot","crew-remote-ci");
  let names;
  try {names=await readdir(dir);}
  catch(error){if (error?.code==="ENOENT")return [];throw error;}
  if(names.length>100 || names.some(x=>!UUID.test(x.slice(0,-5)) || !x.endsWith(".json")))
    fail("RECEIPT_INVENTORY_INVALID");
  const all=[];
  for(const name of names.sort()){
    const path=join(dir,name);
    const s=await stat(path);
    if(!s.isFile() || s.size>8192)fail("RECEIPT_OVERSIZE_OR_NOT_FILE");
    const v=verifyRemoteCIReceipt(JSON.parse(await readFile(path,"utf8")));
    if(name!==v.id+".json")fail("RECEIPT_FILENAME_MISMATCH");
    all.push(v);
  }
  return all.reverse();
}
export async function runRemoteCI({
  argv, env=process.env, gh, verifyLocal=verifyLocalDocCommit,
  persist=persistRemoteCI, clock,
}) {
  const args=parseRemoteCIArgs(argv);
  const allowedRoots=policy(env,args.remoteRepo);
  const token=env.PHIBOT_GITHUB_TOKEN || env.GH_TOKEN;
  if (!gh && (typeof token!=="string" || token.length<8))
    fail("READ_ONLY_GITHUB_TOKEN_REQUIRED");
  const observation=await observeRemoteCI({
    ...args,allowedRoots,gh:gh??githubClient(token),verifyLocal,
    ...(clock?{clock}:{}),
  });
  const root=await realpath(resolve(args.repoDir));
  const {receipt,path}=await persist(observation,root);
  return {observation,receiptDigest:receipt.digest,path};
}
export async function main(argv=process.argv.slice(2)) {
  if(argv.length===1 && argv[0]==="list"){
    const roots=policy(process.env,process.env.PHIBOT_CREW_REMOTE_REPO_ALLOWLIST?.split(";")[0]||"");
    const base=await realpath(resolve("."));
    const allowed=await Promise.all(roots.map(x=>realpath(resolve(x))));
    if(!allowed.includes(base))fail("REPO_NOT_ALLOWLISTED");
    const items=await listRemoteCI(base);
    return {
      classification:SOURCE,mode:MODE,
      records:items.map(v=>({id:v.id,at:v.observation.checkedAt,
        repository:v.observation.remoteRepo,sha:v.observation.exactSha,
        status:v.observation.status,digest:v.digest})),
    };
  }
  return runRemoteCI({argv});
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().then(x=>process.stdout.write(JSON.stringify(x,null,2)+"\n"))
    .catch(error=>{
      const code=typeof error?.message==="string" && /^CREW_CI_[A-Z0-9_]+$/.test(error.message)
        ?error.message:"CREW_CI_READ_OR_LOCAL_VERIFICATION_REFUSED";
      process.stderr.write("PhiBot CI observation refused: "+code+"\n");
      process.exitCode=1;
    });
}
