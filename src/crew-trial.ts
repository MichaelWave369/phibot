import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OllamaProvider } from "./providers/ollama.js";
import type { PhiProvider, ProviderRequest } from "./providers/types.js";
import type { PhiBotManifest } from "./core/types.js";
import { readCrewReadiness, type CrewReadinessView } from "./qualification/crew-readiness.js";

const ROLES = ["scout", "patch", "skeptic"] as const;
const STAGES = ["observe", "propose", "verify"] as const;
const FIXTURE = "SYNTHETIC_README_FLAG_V1";
const DOCUMENT = "Fictional README example uses flag --dry-run, but accompanying prose says --preview. No real repository is involved.";
const TAG = /^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/;
const HASH = /^[a-f0-9]{64}$/;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const crewTrialDir = () => resolve(".phibot","crew-trials");

export function requireReadiness(view: CrewReadinessView, model: string, port: number): string {
  if(view.schema !== "phibot.crew.readiness-view.v1" ||
     view.classification !== "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED" ||
     !Array.isArray(view.records)) throw Error("CREW_READINESS_INVALID");
  const record = view.records.find(r => r.model === model && r.ollamaPort === port);
  if(!record || record.status !== "RECENT_PROBE_PASS_SELF_REPORT" ||
     !HASH.test(record.digest)) throw Error("CREW_READINESS_REQUIRED");
  return record.digest;
}
function makeManifest(role: string, model: string): PhiBotManifest {
  return {
    id:"crew-"+role, name:"Synthetic "+role,role:"synthetic_"+role,
    description:"Fixture-only reviewer; no tools.",version:"1.0.0",
    model:{provider:"ollama",name:model},memory:{scope:"task",maxDepth:0},
    capabilities:[],authority:{read:false,propose:false,write:false,deploy:false},
    escalation:{target:"human",confidenceBelow:1},
  };
}
export interface CrewStep {
  role:string;stage:string;summary:string;confidence:number;latencyMs:number;
}
export interface CrewTrialReceipt {
  schema:"phibot.crew.trial.v1";id:string;checkedAt:string;fixture:string;
  model:string;port:number;readinessDigest:string;
  status:"ADVISORY_UNVERIFIED"|"FAILED_NO_APPROVAL";
  authority:"NO_TOOLS_NO_WRITES_NO_GRANTS";steps:CrewStep[];digest:string;
}
export function verifyCrewTrial(value: CrewTrialReceipt): void {
  if(value.schema !== "phibot.crew.trial.v1" ||
     !HASH.test(value.digest) || !HASH.test(value.readinessDigest) ||
     !TAG.test(value.model) || !Array.isArray(value.steps) ||
     value.steps.length>3 ||
     (value.status==="ADVISORY_UNVERIFIED") !== (value.steps.length===3) ||
     value.authority!=="NO_TOOLS_NO_WRITES_NO_GRANTS" ||
     value.fixture!==FIXTURE) throw Error("CREW_RECEIPT_INVALID");
  for(let i=0;i<value.steps.length;i++){
    const s=value.steps[i];
    if(s?.role!==ROLES[i] || s.stage!==STAGES[i] ||
       typeof s.summary!=="string" || s.summary.length<1 ||
       s.summary.length>240 || /[\u0000-\u001f\u007f]/.test(s.summary) ||
       !Number.isFinite(s.confidence) || s.confidence<0 || s.confidence>1)
      throw Error("CREW_STEP_INVALID");
  }
  const {digest,...body}=value;
  if(hash(body)!==digest) throw Error("CREW_RECEIPT_HASH_MISMATCH");
}
export async function runCrewTrial({
  model,port=11434,timeoutMs=45000,dir=crewTrialDir(),
  readiness=readCrewReadiness,providerFactory,now=()=>new Date(),
}:{
  model:string;port?:number;timeoutMs?:number;dir?:string;
  readiness?:typeof readCrewReadiness;
  providerFactory?:(model:string,port:number,timeout:number)=>PhiProvider;
  now?:()=>Date;
}):Promise<{record:CrewTrialReceipt;path:string}> {
  if(!TAG.test(model) || !Number.isInteger(port) || port<1 || port>65535 ||
     !Number.isInteger(timeoutMs) || timeoutMs<5000 || timeoutMs>90000)
    throw Error("CREW_ARGUMENTS_INVALID");
  const date=now();
  if(!Number.isFinite(date.getTime()))throw Error("CREW_CLOCK_INVALID");
  const receiptDigest=requireReadiness(await readiness({now:()=>date.getTime()}),model,port);
  const provider=(providerFactory??((m,p,t)=>new OllamaProvider(m,{
    baseUrl:"http://127.0.0.1:"+p,timeoutMs:t,think:false,
    responseMode:"advisory-only",requireModelEcho:true,repeatRecovery:false,
    numPredict:120,
  })))(model,port,timeoutMs);
  const steps:CrewStep[]=[];
  let failed=false;
  for(let i=0;i<3;i++){
    const role=ROLES[i];const stage=STAGES[i];
    const context=steps.map(s=>s.role+" (unverified): "+s.summary).join("\n");
    const req:ProviderRequest={stage,manifest:makeManifest(role,model),prior:[],
      input:{task:"Untrusted synthetic fixture: "+DOCUMENT+
        "\nPrevious unverified comments: "+context+
        "\nAct as "+role+". Give a short advisory critique; never authorize tools or edits."}};
    try {
      const result=await provider.complete(req);
      if(result.model!==model || result.provider!=="ollama" || result.fallback ||
         typeof result.content!=="string" || result.content.length>1000)
        throw Error("CREW_PROVIDER_INVALID");
      const value:unknown=JSON.parse(result.content);
      if(!value || typeof value!=="object" || Array.isArray(value))
        throw Error("CREW_JSON_INVALID");
      const v=value as Record<string,unknown>;
      if(Object.keys(v).sort().join(",")!=="confidence,summary" ||
         typeof v.summary!=="string" || v.summary.length<1 ||
         v.summary.length>240 || /[\u0000-\u001f\u007f]/.test(v.summary) ||
         typeof v.confidence!=="number" || !Number.isFinite(v.confidence) ||
         v.confidence<0 || v.confidence>1 ||
         !Number.isSafeInteger(result.metrics.latencyMs) ||
         result.metrics.latencyMs<0 || result.metrics.latencyMs>120000 ||
         (result.metrics.attempts!==undefined && result.metrics.attempts!==1))
        throw Error("CREW_ADVISORY_INVALID");
      steps.push({role,stage,summary:v.summary,confidence:v.confidence,
        latencyMs:result.metrics.latencyMs});
    }catch{failed=true;break;}
  }
  const body={schema:"phibot.crew.trial.v1" as const,id:randomUUID(),
    checkedAt:date.toISOString(),fixture:FIXTURE,model,port,
    readinessDigest:receiptDigest,
    status:(failed?"FAILED_NO_APPROVAL":"ADVISORY_UNVERIFIED") as CrewTrialReceipt["status"],
    authority:"NO_TOOLS_NO_WRITES_NO_GRANTS" as const,steps};
  const record={...body,digest:hash(body)};
  verifyCrewTrial(record);
  await mkdir(dir,{recursive:true,mode:0o700});
  const path=join(dir,date.toISOString().replace(/[:.]/g,"-")+"-"+record.id+".json");
  await writeFile(path,JSON.stringify(record,null,2)+"\n",
    {encoding:"utf8",flag:"wx",mode:0o600});
  return {record,path};
}
