/**
 * PHIBOT-15: An entirely offline, operator-mediated and authority-free receipt
 * projection for a future Vessie view. A digest is integrity, NOT signatures,
 * independent attestation, source truth, permission, or agent registration.
 *
 * Never read arbitrary files: one immediate scout-* child of the local, private
 * .phibot/scout-qualification root, with exactly two ordinary non-symlink files.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const DOMAIN = "PHIBOT-SCOUT-LOCAL-QUALIFICATION-V1\0";
const RECEIPT_KEYS = [
  "schema","result","qualified_at","execution_mode","source_mission_id",
  "source_run_id","source_commit","source_status_sha256","source_observed_at",
  "source_expires_at","source_disposition","model_provider","local_model",
  "local_reasoning_stages","local_runtime_stages","public_read_requests",
  "logical_model_calls","physical_model_attempts_not_independently_attested",
  "tools_executed","output_contains_model_prose","public_source_authenticated",
  "phibot_agent_identity_authenticated","phios_isolation_qualified",
  "operator_approval_or_capability_granted","nbg_memory_admitted",
  "remote_agent_deployed","evidence_class",
] as const;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const MODEL=/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,79}$/;
const RUN=/^[1-9][0-9]{0,18}$/;
const FULL_Z=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const SOURCE_DATE=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const TTL=8*60*60*1000;

export interface ScoutVessieHandoff {
  schema:"phibot.scout-vessie-handoff.v0.1";
  evidence_class:"LOCAL_SELF_REPORTED_FORMAT_AND_DIGEST_ONLY";
  mode:"MANUAL_OPERATOR_COPY_ONLY";
  qualification_result:"PASS_LOCAL_SCOUT_SHADOW";
  source_run_id:string;
  source_mission_id:"phibot.scout.public-repo-health.v1";
  local_model:string;
  qualified_at:string;
  source_expires_at:string;
  review_freshness:"CURRENT_WITHIN_SOURCE_WINDOW"|"HISTORICAL_EXPIRED_OR_NOT_YET_CURRENT";
  receipt_digest_sha256:string;
  integrity:"DOMAIN_SEPARATED_DIGEST_MATCH";
  public_source_authenticated:false;
  identity_authenticated:false;
  signer_authenticated:false;
  independent_execution_attested:false;
  reality_gate_granted:false;
  tool_calls_authorized:false;
  memory_admitted:false;
  agent_spawned:false;
  phios_isolation_qualified:false;
  vessie_connected:false;
  routing_influence:"NONE";
}
function guard(value:unknown,code:string):asserts value {
  if(!value)throw new Error("PHIBOT_HANDOFF_"+code);
}
function obj(value:unknown):value is Record<string,unknown>{
  return value!==null && typeof value==="object" && !Array.isArray(value);
}
function keys(value:unknown, expected:readonly string[]):boolean{
  return obj(value) && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}
function iso(value:unknown, pattern:RegExp):number {
  guard(typeof value==="string" && pattern.test(value),"TIME_FORMAT");
  const result=Date.parse(value);
  guard(Number.isFinite(result),"TIME_FORMAT");
  return result;
}
/** The hash can be recalculated by anyone who alters the file. */
export function projectScoutHandoff(
  bytes:Buffer,
  digestFileText:string,
  nowMs=Date.now(),
):ScoutVessieHandoff {
  guard(Number.isSafeInteger(nowMs) && nowMs>0,"CLOCK");
  guard(bytes.length>0 && bytes.length<=8192,"RECEIPT_SIZE");
  guard(/^[a-f0-9]{64}  qualification\.json\n$/.test(digestFileText),"DIGEST_FILE");
  const expected=digestFileText.slice(0,64);
  const computed=createHash("sha256").update(DOMAIN).update(bytes).digest("hex");
  guard(timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(computed,"hex")),"DIGEST_MISMATCH");
  let raw:unknown;
  try {raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as unknown;}
  catch {throw new Error("PHIBOT_HANDOFF_RECEIPT_JSON");}
  guard(keys(raw,RECEIPT_KEYS),"RECEIPT_FIELDS");
  const r=raw as Record<string,unknown>;
  // Reject hidden whitespace, extra fields, alternate serializations,
  // or JSON values other than the originally emitted metadata shape.
  guard(bytes.equals(Buffer.from(JSON.stringify(r,null,2)+"\n","utf8")),"RECEIPT_CANONICAL");
  guard(r.schema==="phibot.scout-local-qualification.v0.1" &&
    r.result==="PASS_LOCAL_SCOUT_SHADOW" &&
    r.execution_mode==="OPERATOR_EXPLICIT_LOCAL_ONLY" &&
    r.source_mission_id==="phibot.scout.public-repo-health.v1" &&
    r.source_disposition==="OBSERVED_OK_UNVERIFIED_PUBLIC" &&
    r.model_provider==="ollama" &&
    r.local_reasoning_stages===1 && r.local_runtime_stages===4 &&
    r.public_read_requests===4 && r.logical_model_calls===1 &&
    r.physical_model_attempts_not_independently_attested===true &&
    r.tools_executed===0 && r.output_contains_model_prose===false &&
    r.public_source_authenticated===false &&
    r.phibot_agent_identity_authenticated===false &&
    r.phios_isolation_qualified===false &&
    r.operator_approval_or_capability_granted===false &&
    r.nbg_memory_admitted===false && r.remote_agent_deployed===false &&
    r.evidence_class==="OPERATOR_LOCAL_SELF_REPORTED_WITH_VALIDATED_FORMAT",
    "RECEIPT_SCOPE");
  guard(typeof r.source_run_id==="string" && RUN.test(r.source_run_id) &&
    Number.isSafeInteger(Number(r.source_run_id)) &&
    typeof r.local_model==="string" && MODEL.test(r.local_model) &&
    typeof r.source_commit==="string" && SHA40.test(r.source_commit) &&
    typeof r.source_status_sha256==="string" && SHA64.test(r.source_status_sha256),
    "RECEIPT_IDENTIFIERS");
  const qualified=iso(r.qualified_at,FULL_Z);
  const observed=iso(r.source_observed_at,SOURCE_DATE);
  const expires=iso(r.source_expires_at,SOURCE_DATE);
  guard(expires-observed===TTL && qualified >= observed-300000 &&
    qualified<=expires && qualified<=nowMs+300000,"RECEIPT_TIMELINE");
  return Object.freeze({
    schema:"phibot.scout-vessie-handoff.v0.1",
    evidence_class:"LOCAL_SELF_REPORTED_FORMAT_AND_DIGEST_ONLY",
    mode:"MANUAL_OPERATOR_COPY_ONLY",
    qualification_result:"PASS_LOCAL_SCOUT_SHADOW",
    source_run_id:r.source_run_id,
    source_mission_id:"phibot.scout.public-repo-health.v1",
    local_model:r.local_model,
    qualified_at:r.qualified_at,
    source_expires_at:r.source_expires_at,
    review_freshness:nowMs>=qualified && nowMs<=expires ?
      "CURRENT_WITHIN_SOURCE_WINDOW":"HISTORICAL_EXPIRED_OR_NOT_YET_CURRENT",
    receipt_digest_sha256:computed,
    integrity:"DOMAIN_SEPARATED_DIGEST_MATCH",
    public_source_authenticated:false,
    identity_authenticated:false,
    signer_authenticated:false,
    independent_execution_attested:false,
    reality_gate_granted:false,
    tool_calls_authorized:false,
    memory_admitted:false,
    agent_spawned:false,
    phios_isolation_qualified:false,
    vessie_connected:false,
    routing_influence:"NONE",
  });
}

/**
 * Read only a chosen immediate child of the private qualification root.
 * No network, mutation, discovery, memory-pod read, or arbitrary file paths.
 */
export async function readLocalScoutHandoff(
  chosenDir:string,
  rootDir=".phibot/scout-qualification",
  nowMs=Date.now(),
):Promise<ScoutVessieHandoff>{
  const root=resolve(rootDir),chosen=resolve(chosenDir);
  guard(dirname(chosen)===root && /^scout-[a-zA-Z0-9_-]{4,40}$/.test(basename(chosen)),
    "PATH_SCOPE");
  const rootStat=await lstat(root);
  const childStat=await lstat(chosen);
  guard(rootStat.isDirectory() && !rootStat.isSymbolicLink() &&
    childStat.isDirectory() && !childStat.isSymbolicLink(),"DIRECTORY_TYPE");
  guard(await realpath(root)===root && await realpath(chosen)===chosen,
    "DIRECTORY_LINK");
  const names=(await readdir(chosen)).sort();
  guard(names.length===2 && names[0]==="qualification.json" &&
    names[1]==="qualification.sha256","DIRECTORY_CONTENTS");
  const p=join(chosen,"qualification.json"),d=join(chosen,"qualification.sha256");
  const [ps,ds]=await Promise.all([lstat(p),lstat(d)]);
  guard(ps.isFile() && !ps.isSymbolicLink() && ps.size>0 && ps.size<=8192 &&
    ds.isFile() && !ds.isSymbolicLink() && ds.size===85,"FILE_SCOPE");
  const [receiptBytes,digestBytes]=await Promise.all([readFile(p),readFile(d)]);
  guard(receiptBytes.length<=8192 && digestBytes.length===85,"FILE_SIZE");
  return projectScoutHandoff(receiptBytes,digestBytes.toString("utf8"),nowMs);
}
