import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRemoteCIArgs, observeRemoteCI, runRemoteCI,
  listRemoteCI, verifyRemoteCIReceipt,
} from "./crew-remote-ci.mjs";

const remoteRepo="MichaelWave369/phibot";
const draftId="11111111-2222-4333-8444-555555555555";
const commit="b".repeat(40);
const parent="a".repeat(40);
const branch="phibot/docs-guide";
const base="/repos/"+remoteRepo;
const runId=501;
const local={
  status:"LOCAL_COMMIT_HASH_VERIFIED_REMOTE_CI_UNKNOWN",
  branch,commit,parent,target:"docs/guide.md",sha256:"c".repeat(64),
};
const env={
  PHIBOT_CREW_REPO_ALLOWLIST:"/tmp/phi-local-test",
  PHIBOT_CREW_REMOTE_REPO_ALLOWLIST:remoteRepo,
  PHIBOT_GITHUB_TOKEN:"unittest-READ-ONLY-test-token",
};
const responseRun={
  id:runId,run_attempt:1,name:"CI",
  path:".github/workflows/ci.yml",head_sha:commit,
  head_branch:branch,head_repository:{full_name:remoteRepo},
  repository:{full_name:remoteRepo},
  event:"pull_request",status:"completed",conclusion:"success",
};
const workflowJobs={total_count:1,jobs:[{
  id:3001,name:"test",run_id:runId,status:"completed",conclusion:"success",
}]};
function mockGitHub({
  remoteSha=commit,finalRemoteSha=remoteSha,
  runs=[responseRun],runDetail,job=workflowJobs,
  metadata,afterCalls,
}={}){
  const calls=[];
  let branches=0;
  const remote=async (method,path,data)=>{
    calls.push({method,path,data});
    assert.equal(method,"GET");
    assert.equal(data,undefined);
    if(path===base) return metadata ?? {
      full_name:remoteRepo,owner:{login:"MichaelWave369"},
      archived:false,disabled:false,fork:false,
    };
    if(path===base+"/branches/"+encodeURIComponent(branch)){
      branches++;
      return {name:branch,commit:{sha:branches===1?remoteSha:finalRemoteSha}};
    }
    if(path===base+"/actions/runs?head_sha="+commit+"&per_page=100&page=1")
      return {total_count:runs.length,workflow_runs:runs};
    if(path===base+"/actions/runs/"+runId+"/jobs?per_page=100")
      return job;
    if(path===base+"/actions/runs/"+runId)
      return runDetail??runs.find(x=>x.id===runId);
    throw Error("UNEXPECTED_REMOTE_READ "+path);
  };
  return {remote,calls};
}
const opts=(gh,verifyLocal=async()=>local)=>({
  draftId,repoDir:"/tmp/phi-local-test",remoteRepo,
  allowedRoots:["/tmp/phi-local-test"],gh,verifyLocal,
  clock:()=>new Date("2026-11-06T23:00:00Z"),
});
test("exact-commit successful CI is evidence only, not approval, and persisted locally",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"phibot-43-"));
  try{
    const {remote,calls}=mockGitHub();
    const result=await runRemoteCI({
      argv:["--draft",draftId,"--repo",temp,"--remote",remoteRepo],
      env:{...env,PHIBOT_CREW_REPO_ALLOWLIST:temp},
      gh:remote,verifyLocal:async()=>local,
    });
    assert.equal(result.observation.status,"CI_PASS_EVIDENCE_ONLY");
    assert.equal(result.observation.exactSha,commit);
    assert.equal(result.observation.run.id,runId);
    assert.equal(result.observation.job.name,"test");
    assert.equal(result.observation.remoteWrites,0);
    assert.equal(result.observation.gitPushes,0);
    assert.equal(result.observation.mergeAuthorized,false);
    assert.equal(result.observation.mode,"READ_ONLY_REMOTE_NO_MERGE_AUTHORITY");
    assert.ok(calls.length>=6);
    assert.ok(calls.every(c=>c.method==="GET" && c.data===undefined));
    assert.ok(!JSON.stringify(result).includes(env.PHIBOT_GITHUB_TOKEN));
    assert.deepEqual((await listRemoteCI(temp))[0].observation,result.observation);
    assert.equal(verifyRemoteCIReceipt(
      JSON.parse(await readFile(result.path,"utf8"))
    ).digest,result.receiptDigest);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test("remote branch mismatch does not even inspect GitHub CI",async()=>{
  const {remote,calls}=mockGitHub({remoteSha:"f".repeat(40)});
  const report=await observeRemoteCI(opts(remote));
  assert.equal(report.status,"REMOTE_BRANCH_NOT_AT_LOCAL_COMMIT");
  assert.equal(report.run,null);
  assert.deepEqual(calls.map(c=>c.path),[
    base,base+"/branches/"+encodeURIComponent(branch),
  ]);
});
test("no workflow for exact SHA is missing, never success",async()=>{
  const {remote}=mockGitHub({runs:[]});
  const report=await observeRemoteCI(opts(remote));
  assert.equal(report.status,"CI_NOT_OBSERVED");
  assert.equal(report.mergeAuthorized,false);
});
test("queued or in-progress run is pending and has no implied success",async()=>{
  const pending={...responseRun,status:"in_progress",conclusion:null};
  const {remote}=mockGitHub({runs:[pending]});
  const report=await observeRemoteCI(opts(remote));
  assert.equal(report.status,"CI_PENDING");
  assert.equal(report.job,null);
});
test("latest completed failure takes precedence over an earlier success on the same SHA",async()=>{
  const newest={...responseRun,conclusion:"failure",id:runId+1};
  const first={...responseRun,id:runId};
  const {remote}=mockGitHub({runs:[first,newest]});
  // The mock has one known job route for 501; override to exercise 502.
  const reader=async (method,path,data)=>{
    if(path===base+"/actions/runs/"+(runId+1)+"/jobs?per_page=100")
      return {total_count:1,jobs:[{id:3002,name:"test",run_id:runId+1,status:"completed",conclusion:"failure"}]};
    if(path===base+"/actions/runs/"+(runId+1)) return newest;
    return remote(method,path,data);
  };
  const report=await observeRemoteCI(opts(reader));
  assert.equal(report.status,"CI_FAILED");
  assert.equal(report.run.id,runId+1);
});
test("wrong job, duplicate jobs or incomplete pages are unqualified",async()=>{
  for(const job of [
    {total_count:1,jobs:[{...workflowJobs.jobs[0],name:"lint"}]},
    {total_count:2,jobs:[workflowJobs.jobs[0],{...workflowJobs.jobs[0],id:3002,name:"build"}]},
    {total_count:2,jobs:[workflowJobs.jobs[0]]},
    {total_count:1,jobs:[{...workflowJobs.jobs[0],run_id:7777}]},
  ]){
    const {remote}=mockGitHub({job});
    const output=await observeRemoteCI(opts(remote));
    assert.equal(output.status,"CI_EVIDENCE_UNQUALIFIED");
  }
});
test("changed run or changed remote branch cannot produce green evidence",async()=>{
  const altered={...responseRun,run_attempt:2};
  const {remote}=mockGitHub({runDetail:altered});
  assert.equal((await observeRemoteCI(opts(remote))).status,"CI_CHANGED_DURING_OBSERVATION");
  const branchDrift=mockGitHub({finalRemoteSha:"d".repeat(40)});
  assert.equal((await observeRemoteCI(opts(branchDrift.remote))).status,
    "CI_CHANGED_DURING_OBSERVATION");
});
test("workflow path, branch, head repo, or commit mismatch cannot be promoted",async()=>{
  const alterations=[
    {path:".github/workflows/unrelated.yml"},
    {head_sha:"e".repeat(40)},
    {head_branch:"main"},
    {head_repository:{full_name:"Other/Fork"}},
    {event:"workflow_dispatch"},
    {name:"MALICIOUS_SIMULATION"},
  ];
  for(const change of alterations){
    const {remote}=mockGitHub({runs:[{...responseRun,...change}]});
    const result=await observeRemoteCI(opts(remote));
    assert.equal(result.status,"CI_NOT_OBSERVED");
  }
});
test("truncated remote run inventory and bad repo identity fail closed",async()=>{
  const broken=mockGitHub();
  const reader=async (method,path,data)=>{
    if(path.includes("/actions/runs?"))
      return {total_count:101,workflow_runs:[responseRun]};
    return broken.remote(method,path,data);
  };
  await assert.rejects(observeRemoteCI(opts(reader)),/CREW_CI_REMOTE_RUN_LIST_INCOMPLETE/);
  const spoof=mockGitHub({metadata:{
    full_name:remoteRepo,owner:{login:"Attacker"},archived:false,
    disabled:false,fork:false,
  }});
  await assert.rejects(observeRemoteCI(opts(spoof.remote)),
    /CREW_CI_REMOTE_REPOSITORY_IDENTITY_INVALID/);
});
test("invalid CLI, missing allowlist and missing local verification refuse before network",async()=>{
  assert.throws(()=>parseRemoteCIArgs(["--draft",draftId,"--repo",".","--remote","../other"]),
    /CREW_CI_ARGS_INVALID/);
  assert.throws(()=>parseRemoteCIArgs(["--draft",draftId,"--repo",".","--remote",remoteRepo,"--merge","true"]),
    /CREW_CI_ARGS_INVALID/);
  let calls=0;
  const blocked=async()=>{calls++;throw Error("NO_REMOTE_REQUEST_EXPECTED");};
  await assert.rejects(runRemoteCI({
    argv:["--draft",draftId,"--repo",".","--remote",remoteRepo],
    env:{...env,PHIBOT_CREW_REMOTE_REPO_ALLOWLIST:"Other/Repo"},
    gh:blocked,verifyLocal:async()=>local,
  }),/CREW_CI_EXPLICIT_LOCAL_AND_REMOTE_ALLOWLIST_REQUIRED/);
  await assert.rejects(observeRemoteCI(opts(blocked,async()=>({
    ...local,status:"FORGED_CI_PASSED",
  }))),/CREW_CI_LOCAL_COMMIT_VERIFICATION_REQUIRED/);
  assert.equal(calls,0);
});
test("local receipt tampering or forged merge authority fails verification",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"phibot-43-tamper-"));
  try{
    const remote=mockGitHub();
    const saved=await runRemoteCI({
      argv:["--draft",draftId,"--repo",temp,"--remote",remoteRepo],
      env:{...env,PHIBOT_CREW_REPO_ALLOWLIST:temp},
      gh:remote.remote,verifyLocal:async()=>local,
    });
    assert.throws(()=>verifyRemoteCIReceipt({
      ...saved,
      mergeAuthorized:true,
    }),/CREW_CI_RECEIPT_SCHEMA_INVALID/);
    assert.throws(()=>verifyRemoteCIReceipt({
      ...((await listRemoteCI(temp))[0]),
      observation:{...saved.observation,mergeAuthorized:true},
    }),/CREW_CI_RECEIPT_OBSERVATION_INVALID/);
    const original=JSON.parse(await readFile(saved.path,"utf8"));
    await writeFile(saved.path,JSON.stringify({
      ...original,observation:{...original.observation,status:"CI_FAILED"}
    }));
    await assert.rejects(listRemoteCI(temp),/CREW_CI_RECEIPT_OBSERVATION_DIGEST_MISMATCH/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
