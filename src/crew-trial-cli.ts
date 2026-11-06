#!/usr/bin/env node
/**
 * PHIBOT-37 local manual synthetic team trial.
 * CLI is the sole trigger; never scheduled or exposed over HTTP.
 */
import { listCrewTrials, runCrewTrial } from "./crew-trial.js";

function parseArgs(argv:string[]): {model:string;port:number;timeoutMs:number} {
  const values:Record<string,string>={};
  if(argv.length<2 || argv.length>6 || argv.length%2!==0)
    throw Error("Usage: npm run crew:trial -- --model <local-tag> [--port 11434] [--timeout-ms 45000]");
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i];const value=argv[i+1];
    if(!key || !value || !["--model","--port","--timeout-ms"].includes(key) ||
       values[key]!==undefined)throw Error("CREW_CLI_ARGUMENTS_INVALID");
    values[key]=value;
  }
  const model=values["--model"];
  const rawPort=values["--port"]??"11434";
  const rawTimeout=values["--timeout-ms"]??"45000";
  if(!model || !/^[0-9]{1,5}$/.test(rawPort) ||
     !/^[0-9]{4,5}$/.test(rawTimeout))
    throw Error("CREW_CLI_ARGUMENTS_INVALID");
  return {model,port:Number(rawPort),timeoutMs:Number(rawTimeout)};
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length===1 && args[0]==="list"){
    const records=await listCrewTrials();
    console.log(JSON.stringify({
      classification:"LOCAL_SYNTHETIC_SELF_REPORT_NOT_ATTESTED",
      records:records.map(r=>({
        trialId:r.id,checkedAt:r.checkedAt,model:r.model,
        status:r.status,digest:r.digest,roles:r.steps.map(s=>s.role),
      })),
    },null,2));
    return;
  }
  if(args[0]!=="run")throw Error("CREW_CLI_COMMAND_INVALID");
  const {model,port,timeoutMs}=parseArgs(args.slice(1));
  console.log("PHIBOT-37: manual synthetic advisory only. No tools, grants, edits, or approvals.");
  const {record,path}=await runCrewTrial({model,port,timeoutMs});
  console.log(JSON.stringify({record,path},null,2));
  if(record.status!=="ADVISORY_UNVERIFIED")process.exitCode=2;
}
main().catch(error=>{
  console.error("Crew trial refused: "+(error instanceof Error?error.message:"unknown"));
  process.exitCode=1;
});
