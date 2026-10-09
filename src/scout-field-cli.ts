#!/usr/bin/env node
/**
 * PHIBOT-12 single operator command.
 * Four public read-only GitHub GETs plus one logical local Ollama stage.
 * No agent scheduling, registration, tools, grants or memory promotion.
 */
import { inspectPublishedCloudScout } from "./cloud/public-acquisition.js";
import { runLocalScoutShadow } from "./cloud/shadow-scout.js";
import { OllamaProvider } from "./providers/ollama.js";
import { qualifyLocalScout, saveScoutFieldPass } from "./qualification/scout-field.js";
import { diagnoseScoutFieldFailure } from "./qualification/scout-diagnostics.js";
import type { ScoutFieldPhase } from "./qualification/scout-diagnostics.js";

let phase: ScoutFieldPhase = "ARGUMENTS";

async function main(): Promise<void> {
  const args=process.argv.slice(2);
  const usage="Usage: npm run scout:field -- --ack-unverified-public [--model qwen3:4b]";
  if(args.length===1 && args[0]==="--help") {console.log(usage);return;}
  if(args.filter(x=>x==="--ack-unverified-public").length!==1)
    throw new Error("PHIBOT_SCOUT_FIELD_ACK_REQUIRED");
  const options=args.filter(x=>x!=="--ack-unverified-public");
  let model="qwen3:4b";
  if(options.length) {
    if(options.length!==2 || options[0]!=="--model" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,79}$/.test(options[1]??""))
      throw new Error("PHIBOT_SCOUT_FIELD_INVALID_MODEL");
    model=options[1]!;
  }
  if(Number(process.versions.node.split(".")[0])<22)
    throw new Error("PHIBOT_SCOUT_FIELD_NODE22");
  // The existing reader has four allowlisted, public GETs and no credentials.
  phase="PUBLIC_READ";
  const source=await inspectPublishedCloudScout();
  if(source.review.disposition!=="OBSERVED_OK_UNVERIFIED_PUBLIC")
    throw new Error("PHIBOT_SCOUT_FIELD_NOT_FRESH");
  // Localhost only, no remote provider, no fallback.
  const modelProvider=new OllamaProvider(model,{
    baseUrl:"http://127.0.0.1:11434",
    timeoutMs:60_000,think:false,keepAlive:"10m",
    numPredict:160,repeatRecovery:true,responseMode:"advisory-only",
  });
  phase="LOCAL_OLLAMA";
  const shadow=await runLocalScoutShadow(source,modelProvider);
  phase="QUALIFICATION";
  const receipt=qualifyLocalScout(source,shadow);
  phase="LOCAL_SAVE";
  const output=await saveScoutFieldPass(receipt);
  // Never print the Ollama prose or raw GitHub payload in qualification mode.
  console.log(JSON.stringify({
    status:receipt.result,
    local_model:receipt.local_model,
    source_run_id:receipt.source_run_id,
    local_reasoning_stages:receipt.local_reasoning_stages,
    authority_granted:false,
    saved_at:output.directory,
    receipt_sha256:output.sha256,
  },null,2));
}
main().catch((error:unknown)=>{
  console.error(JSON.stringify(diagnoseScoutFieldFailure(error,phase),null,2));
  process.exitCode=2;
});
