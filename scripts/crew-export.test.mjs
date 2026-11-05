import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile,rm,stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueue,runQueue } from "./work-queue.mjs";
import { buildCrewExport,saveCrewExport,main,CREW_SCHEMA } from "./crew-export.mjs";

const repository="MichaelWave369/Demo";
const policy={owner:"MichaelWave369",repos:[repository]};
const job={capability:"repo.steward.discover",input:{repository}};
async function temp(fn){
 const dir=await mkdtemp(join(tmpdir(),"crew-export-test-"));
 try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

test("manual export projects real local queue records with no raw payload",async()=>{
 await temp(async dir=>{
  await enqueue(job,policy,dir);
  await runQueue({dir,policy,execute:async()=>({
   status:"executed",
   output:{tasks:[{text:"PRIVATE SOURCE TEXT MUST NEVER EXPORT"}],issues:[]}
  })});
  const doc=await buildCrewExport({dir,policy,now:()=>new Date("2026-11-05T01:00:00.000Z")});
  assert.equal(doc.schema,CREW_SCHEMA);
  assert.equal(doc.classification,"LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED");
  assert.equal(doc.counts.total,1);
  assert.equal(doc.counts.completed,1);
  assert.equal(doc.counts.leased,0);
  assert.equal(doc.jobs[0].state,"completed");
  assert.equal(doc.jobs[0].outcome,"OBSERVED_NO_PROMOTION");
  assert.equal(doc.scope.runtimeWorkersVerified,false);
  assert.equal(doc.scope.grantsIssued,false);
  assert.ok(!JSON.stringify(doc).includes("PRIVATE SOURCE TEXT"));
  assert.ok(!JSON.stringify(doc).includes("evidence"));
  assert.ok(!JSON.stringify(doc).includes("requiredChecks"));
 });
});

test("manual export remains empty when no queue jobs exist",async()=>{
 await temp(async dir=>{
  const doc=await buildCrewExport({dir,policy});
  assert.equal(doc.counts.total,0);
  assert.deepEqual(doc.jobs,[]);
  assert.equal(doc.scope.completeFleetClaim,false);
 });
});

test("export requires manual disclosure flag and valid allowlist",async()=>{
 await assert.rejects(main([],{}),/Usage:/);
 await assert.rejects(main(["--unsafe"],{}),/Usage:/);
 await assert.rejects(main(["--ack-repository-disclosure"],{}),/ALLOWLIST/);
});

test("export is exclusive local-only JSON, not silent GitHub deployment",async()=>{
 await temp(async dir=>{
  await enqueue(job,policy,dir);
  const outputDir=join(dir,"crew-exports");
  const report=await saveCrewExport({dir,policy,outputDir});
  assert.match(report.file,/crew-.*\.json$/);
  const body=await readFile(report.file,"utf8");
  const parsed=JSON.parse(body);
  assert.equal(parsed.counts.queued,1);
  assert.equal(parsed.scope.operatorDisclosureRequired,true);
  assert.equal(parsed.jobs[0].repository,repository);
  if(process.platform!=="win32")
    assert.equal((await stat(report.file)).mode & 0o777,0o600);
 });
});

test("tampered persisted queue is rejected before export",async()=>{
 await temp(async dir=>{
  await enqueue(job,policy,dir);
  await assert.rejects(buildCrewExport({dir,policy:
   {owner:"MichaelWave369",repos:["MichaelWave369/Other"]}}),/QUEUE_REPOSITORY_NOT_ALLOWED/);
  await assert.rejects(buildCrewExport({dir,policy,now:()=>new Date(NaN)}),/CLOCK_INVALID/);
 });
});
