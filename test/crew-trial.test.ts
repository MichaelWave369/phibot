import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PhiProvider, ProviderRequest } from "../src/providers/types.js";
import type { CrewReadinessView } from "../src/qualification/crew-readiness.js";
import {
  runCrewTrial, requireReadiness, verifyCrewTrial, listCrewTrials,
} from "../src/crew-trial.js";

const model = "qwen3:4b";
const moment = new Date("2026-11-06T18:00:00Z");
const readView: CrewReadinessView = {
  schema: "phibot.crew.readiness-view.v1",
  classification: "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED",
  maxAgeMs: 3600000,
  records: [{
    model, ollamaPort: 11434, checkedAt: moment.toISOString(),
    status: "RECENT_PROBE_PASS_SELF_REPORT",
    inferenceLatencyMs: 2000, inferenceAttempts: 1, digest: "a".repeat(64),
  }],
};
const readiness = async () => readView;
async function withDir(fn: (dir:string)=>Promise<void>) {
  const dir=await mkdtemp(join(tmpdir(),"phibot-trial-"));
  try { await fn(dir); }
  finally { await rm(dir,{recursive:true,force:true}); }
}
function mockProvider(inspect: (req: ProviderRequest, i:number)=>void, invalidAt=-1): PhiProvider {
  let index=0;
  return {
    id:"ollama",model,
    async complete(req){
      const at=index++;
      inspect(req,at);
      return {
        provider:"ollama",model,fallback:false,
        content:JSON.stringify(at===invalidAt
          ? {summary:"wrong",confidence:0.5,action:{authority:"write"}}
          : {summary:"Synthetic "+req.manifest.role+" advisory",confidence:0.7}),
        metrics:{latencyMs:12,attempts:1},
      };
    },
  };
}
test("one manual trial runs exactly Scout, Patch, Skeptic, all zero-authority",async()=>{
  await withDir(async dir=>{
    const observed:string[]=[];
    const provider=mockProvider((req,i)=>{
      observed.push(req.manifest.role);
      assert.equal(req.stage,["observe","propose","verify"][i]);
      assert.deepEqual(req.manifest.capabilities,[]);
      assert.deepEqual(req.manifest.authority,{
        read:false,propose:false,write:false,deploy:false,
      });
      assert.deepEqual(req.prior,[]);
      assert.equal(req.input.task.includes("Fictional README"),true);
      if(i>0)assert.equal(req.input.task.includes("Synthetic synthetic_"),true);
    });
    const {record,path}=await runCrewTrial({
      model,dir,now:()=>moment,readiness,providerFactory:()=>provider,
    });
    assert.deepEqual(observed,["synthetic_scout","synthetic_patch","synthetic_skeptic"]);
    assert.equal(record.status,"ADVISORY_UNVERIFIED");
    assert.equal(record.authority,"NO_TOOLS_NO_WRITES_NO_GRANTS");
    assert.deepEqual(record.steps.map(s=>s.role),["scout","patch","skeptic"]);
    assert.doesNotThrow(()=>verifyCrewTrial(record));
    assert.deepEqual(JSON.parse(await readFile(path,"utf8")),record);
    assert.equal((await listCrewTrials(dir)).length,1);
  });
});
test("no recent exact-model and port probe means no model call or receipt",async()=>{
  await withDir(async dir=>{
    for(const altered of [
      {...readView,records:[]},
      {...readView,records:[{...readView.records[0],ollamaPort:2222}]},
      {...readView,records:[{...readView.records[0],status:"STALE_PROBE"}]},
      {...readView,records:[{...readView.records[0],status:"FAILED_PROBE"}]},
    ] as CrewReadinessView[]){
      await assert.rejects(runCrewTrial({
        model,dir,now:()=>moment,readiness:async()=>altered,
        providerFactory:()=>{throw Error("UNEXPECTED_INFERENCE");},
      }),/CREW_READINESS_REQUIRED/);
    }
    assert.deepEqual(await listCrewTrials(dir),[]);
    assert.throws(()=>requireReadiness({...readView,classification:"UNTRUSTED"} as unknown as CrewReadinessView,model,11434),
      /CREW_READINESS_INVALID/);
  });
});
test("schema-breaking Patch output fails and prevents Skeptic call",async()=>{
  await withDir(async dir=>{
    const stages:string[]=[];
    const provider=mockProvider(req=>stages.push(req.manifest.id),1);
    const {record}=await runCrewTrial({
      model,dir,now:()=>moment,readiness,providerFactory:()=>provider,
    });
    assert.equal(record.status,"FAILED_NO_APPROVAL");
    assert.deepEqual(stages,["crew-scout","crew-patch"]);
    assert.equal(record.steps.length,1);
    assert.equal((await listCrewTrials(dir))[0]?.status,"FAILED_NO_APPROVAL");
  });
});
test("provider model substitution or hidden fallback stops pipeline",async()=>{
  await withDir(async dir=>{
    for(const field of ["model","fallback"]){
      const provider:PhiProvider={
        id:"ollama",model,
        async complete(){
          return {
            provider:"ollama",model:field==="model"?"other:7b":model,
            fallback:field==="fallback",metrics:{latencyMs:1},
            content:'{"summary":"OK","confidence":0.8}',
          };
        },
      };
      const {record}=await runCrewTrial({
        model,dir,now:()=>moment,readiness,providerFactory:()=>provider,
      });
      assert.equal(record.status,"FAILED_NO_APPROVAL");
      assert.equal(record.steps.length,0);
    }
  });
});
test("tampered local receipt fails closed; extra authority field refused",async()=>{
  await withDir(async dir=>{
    const provider=mockProvider(()=>{});
    const {record,path}=await runCrewTrial({
      model,dir,now:()=>moment,readiness,providerFactory:()=>provider,
    });
    assert.throws(()=>verifyCrewTrial({...record,authority:"WRITE_GRANTED"} as unknown as typeof record));
    assert.throws(()=>verifyCrewTrial({...record,digest:"0".repeat(64)}),
      /CREW_RECEIPT_HASH_MISMATCH/);
    assert.throws(()=>verifyCrewTrial({...record,capability:"repo.write"} as unknown as typeof record),
      /CREW_RECEIPT_SCHEMA_INVALID/);
    await writeFile(path,JSON.stringify({...record,model:"other:7b"}),"utf8");
    await assert.rejects(listCrewTrials(dir),/CREW_RECEIPT_HASH_MISMATCH/);
  });
});
test("invalid model, port and time budget are refused before inference",async()=>{
  await withDir(async dir=>{
    for(const args of [
      {model:"contains spaces",port:11434,timeoutMs:45000},
      {model,port:0,timeoutMs:45000},
      {model,port:11434,timeoutMs:1000},
      {model,port:11434,timeoutMs:100000},
    ]){
      await assert.rejects(runCrewTrial({
        ...args,dir,readiness,
        providerFactory:()=>{throw Error("UNEXPECTED_PROVIDER");},
      }),/CREW_ARGUMENTS_INVALID/);
    }
  });
});
