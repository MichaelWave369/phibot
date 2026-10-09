#!/usr/bin/env node
/**
 * Manual local Scout reasoning pilot, not a service, scheduler or cloud agent.
 * Only public source metadata is sent to localhost Ollama as enums.
 */
import {inspectPublishedCloudScout} from "./cloud/public-acquisition.js";
import {runLocalScoutShadow} from "./cloud/shadow-scout.js";
import {OllamaProvider} from "./providers/ollama.js";

async function main() {
  const args=process.argv.slice(2);
  const usage="Usage: npm run scout:shadow -- --ack-unverified-public [--model qwen3:4b]";
  if(args.includes("--help")) { console.log(usage); return; }
  if(!args.includes("--ack-unverified-public")) throw Error("Operator acknowledgement required. "+usage);
  const options=args.filter(x=>x!=="--ack-unverified-public");
  let model="qwen3:4b";
  if(options.length) {
    if(options.length!==2 || options[0]!=="--model" ||
       !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,79}$/.test(options[1]??""))
      throw Error("Unsupported CLI arguments. "+usage);
    model=options[1]!;
  }
  const evidence=await inspectPublishedCloudScout();
  if(evidence.review.disposition!=="OBSERVED_OK_UNVERIFIED_PUBLIC")
    throw Error("Cloud Scout evidence is not fresh/healthy; no model was called.");
  // Override OLLAMA_HOST explicitly: no remote provider hosts or credential relay.
  const provider=new OllamaProvider(model,{
    baseUrl:"http://127.0.0.1:11434",timeoutMs:60_000,
    think:false,numPredict:160,keepAlive:"10m",repeatRecovery:true,responseMode:"advisory-only",
  });
  const result=await runLocalScoutShadow(evidence,provider);
  console.log(JSON.stringify(result,null,2));
}
main().catch((err:unknown)=>{
  console.error(err instanceof Error && err.message.startsWith("PHIBOT_SHADOW_")?
    err.message:"PHIBOT_SHADOW_PILOT_REFUSED");
  process.exitCode=2;
});
