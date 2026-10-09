#!/usr/bin/env node
/**
 * Manual local-only export of a single qualified Scout receipt.
 * No Vessie API/connection, no file mutation, no model calls or cloud requests.
 */
import {readLocalScoutHandoff} from "./qualification/scout-handoff.js";

async function main():Promise<void>{
  const args=process.argv.slice(2);
  if(args.length===1 && args[0]==="--help"){
    console.log("Usage: npm run scout:handoff -- --receipt .phibot/scout-qualification/scout-XXXXX --ack-local-self-report");
    return;
  }
  const at=args.indexOf("--receipt");
  if(args.length!==3 || at<0 || at===2 ||
     args.filter(v=>v==="--receipt").length!==1 ||
     args.filter(v=>v==="--ack-local-self-report").length!==1 ||
     !args[at+1] || args[at+1]?.startsWith("--"))
    throw new Error("PHIBOT_HANDOFF_ARGUMENTS");
  const review=await readLocalScoutHandoff(args[at+1]!);
  console.log(JSON.stringify(review,null,2));
}
main().catch((error:unknown)=>{
  const msg=error instanceof Error?error.message:"";
  const code=/^PHIBOT_HANDOFF_[A-Z0-9_]{2,60}$/.test(msg)?
    msg:"PHIBOT_HANDOFF_READ_REFUSED";
  console.error(code);
  process.exitCode=2;
});
