/**
 * PHIBOT-12: operator-only local Scout field qualification evidence.
 * Build only a no-authority metadata receipt after a fresh public read and
 * one successful local PhiBot shadow inference. Never retain model prose.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CloudScoutPublicReview } from "../cloud/public-acquisition.js";
import type { ShadowScoutReport } from "../cloud/shadow-scout.js";

const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,79}$/;
const RUN = /^[1-9][0-9]{0,18}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const TTL = 8 * 60 * 60 * 1000;
const DOMAIN = "PHIBOT-SCOUT-LOCAL-QUALIFICATION-V1\0";

export interface ScoutFieldPassReceipt {
  schema: "phibot.scout-local-qualification.v0.1";
  result: "PASS_LOCAL_SCOUT_SHADOW";
  qualified_at: string;
  execution_mode: "OPERATOR_EXPLICIT_LOCAL_ONLY";
  source_mission_id: "phibot.scout.public-repo-health.v1";
  source_run_id: string;
  source_commit: string;
  source_status_sha256: string;
  source_observed_at: string;
  source_expires_at: string;
  source_disposition: "OBSERVED_OK_UNVERIFIED_PUBLIC";
  model_provider: "ollama";
  local_model: string;
  local_reasoning_stages: 1;
  local_runtime_stages: 4;
  public_read_requests: 4;
  logical_model_calls: 1;
  physical_model_attempts_not_independently_attested: true;
  tools_executed: 0;
  output_contains_model_prose: false;
  public_source_authenticated: false;
  phibot_agent_identity_authenticated: false;
  phios_isolation_qualified: false;
  operator_approval_or_capability_granted: false;
  nbg_memory_admitted: false;
  remote_agent_deployed: false;
  // Not a signed provenance or independent attestation.
  evidence_class: "OPERATOR_LOCAL_SELF_REPORTED_WITH_VALIDATED_FORMAT";
}
function refuse(yes: unknown, code: string): asserts yes {
  if (!yes) throw new Error("PHIBOT_SCOUT_FIELD_" + code);
}
function obj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactly(value: unknown, names: readonly string[]): boolean {
  return obj(value) && Object.keys(value).sort().join("|") === [...names].sort().join("|");
}
const SOURCE_KEYS = [
  "schema","acquisition_kind","snapshot_revision","source_status_git_blob","mission_git_blob",
  "review","github_run_metadata_correlated","independent_prior_source_pin_verified",
  "operator_identity_authenticated","measurement_truth_authenticated","source_authorship_authenticated",
  "scheduled_fetch_enabled","agent_runtime_executed","model_calls_executed","authority_granted",
  "action_executed","memory_admitted","bot_spawned"
] as const;
const REVIEW_KEYS = [
  "schema","mission_id","agent_identity_ref","disposition","task_id","run_id","run_url",
  "observed_at","expires_at","source_status_sha256","integrity_hash_matched",
  "provenance_authenticated","agent_identity_authenticated","bot_runtime_executed",
  "independent_run_metadata_checked","source_epistemic","authority_granted",
  "action_executed","memory_admitted","spawn_authorized","routing_influence"
] as const;
const SHADOW_KEYS = [
  "schema","mode","agent_identity","source_mission_id","source_run_id","source_epistemic",
  "input_disposition","status","advisory_summary","model_provider","model_name","model_calls",
  "model_input_class","network_reads","provider_fallback","runtime_stages","tool_calls",
  "cloud_model_calls","memory_admitted","actions_executed","bot_spawned",
  "source_authenticated","identity_authenticated","authority_granted","phios_isolation_qualified"
] as const;
function allFalse(value: Record<string, unknown>, names: readonly string[]): boolean {
  return names.every(key => value[key] === false);
}
function parseTime(value: unknown): number {
  refuse(typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value), "STAMP");
  const t = Date.parse(value);
  refuse(Number.isFinite(t), "STAMP");
  return t;
}
export function qualifyLocalScout(
  source: CloudScoutPublicReview,
  shadow: ShadowScoutReport,
  nowMs = Date.now()
): ScoutFieldPassReceipt {
  refuse(Number.isSafeInteger(nowMs) && nowMs > 0, "CLOCK");
  refuse(exactly(source, SOURCE_KEYS), "PUBLIC_SHAPE");
  refuse(source.schema === "phibot.cloud-mission-public-review.v0.1" &&
    source.acquisition_kind === "OPERATOR_INITIATED_PUBLIC_GITHUB_GET" &&
    source.github_run_metadata_correlated === true &&
    SHA40.test(source.snapshot_revision) &&
    SHA40.test(source.source_status_git_blob) &&
    SHA40.test(source.mission_git_blob), "PUBLIC_SOURCE");
  refuse(allFalse(source as unknown as Record<string, unknown>, [
    "independent_prior_source_pin_verified","operator_identity_authenticated",
    "measurement_truth_authenticated","source_authorship_authenticated","scheduled_fetch_enabled",
    "agent_runtime_executed","model_calls_executed","authority_granted","action_executed",
    "memory_admitted","bot_spawned"
  ]), "PUBLIC_AUTHORITY");
  const review = source.review;
  refuse(exactly(review, REVIEW_KEYS), "REVIEW_SHAPE");
  refuse(review.schema === "phibot.cloud-mission-review.v0.1" &&
    review.mission_id === "phibot.scout.public-repo-health.v1" &&
    review.agent_identity_ref === "phibot.scout.cloud-review.v1" &&
    review.disposition === "OBSERVED_OK_UNVERIFIED_PUBLIC" &&
    review.task_id === "github_repo_metrics" &&
    review.source_epistemic === "UNVERIFIED_PUBLIC" &&
    review.routing_influence === "NONE" &&
    review.integrity_hash_matched === true &&
    RUN.test(review.run_id) && Number.isSafeInteger(Number(review.run_id)) &&
    review.run_url === "https://github.com/MichaelWave369/FieldCloudWorker/actions/runs/" + review.run_id &&
    SHA64.test(review.source_status_sha256), "REVIEW_SOURCE");
  refuse(allFalse(review as unknown as Record<string, unknown>, [
    "provenance_authenticated","agent_identity_authenticated","bot_runtime_executed",
    "independent_run_metadata_checked","authority_granted","action_executed",
    "memory_admitted","spawn_authorized"
  ]), "REVIEW_AUTHORITY");
  const observed = parseTime(review.observed_at), expires = parseTime(review.expires_at);
  refuse(expires - observed === TTL && nowMs >= observed - 5 * 60_000 &&
    nowMs <= expires, "EXPIRED");

  refuse(exactly(shadow, SHADOW_KEYS), "SHADOW_SHAPE");
  refuse(shadow.schema === "phibot.local-scout-shadow.v0.1" &&
    shadow.mode === "OPERATOR_MANUAL_LOCAL_SHADOW" &&
    shadow.agent_identity === "local-scout-shadow" &&
    shadow.source_mission_id === review.mission_id &&
    shadow.source_run_id === review.run_id &&
    shadow.source_epistemic === "UNVERIFIED_PUBLIC" &&
    shadow.input_disposition === "OBSERVED_OK_UNVERIFIED_PUBLIC" &&
    shadow.status === "completed" &&
    shadow.model_provider === "ollama" &&
    MODEL.test(shadow.model_name) &&
    shadow.model_calls === 1 &&
    shadow.model_input_class === "ENUMS_ONLY_NO_RAW_SOURCE" &&
    shadow.network_reads === 4 &&
    shadow.provider_fallback === false &&
    shadow.runtime_stages === 4 &&
    shadow.tool_calls === 0 &&
    shadow.cloud_model_calls === 0, "SHADOW_SCOPE");
  refuse(allFalse(shadow as unknown as Record<string, unknown>, [
    "memory_admitted","actions_executed","bot_spawned","source_authenticated",
    "identity_authenticated","authority_granted","phios_isolation_qualified"
  ]), "SHADOW_AUTHORITY");
  refuse(typeof shadow.advisory_summary === "string" &&
    shadow.advisory_summary.trim().length > 0 &&
    shadow.advisory_summary.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(shadow.advisory_summary), "MODEL_OUTPUT");
  return Object.freeze({
    schema: "phibot.scout-local-qualification.v0.1",
    result: "PASS_LOCAL_SCOUT_SHADOW",
    qualified_at: new Date(nowMs).toISOString(),
    execution_mode: "OPERATOR_EXPLICIT_LOCAL_ONLY",
    source_mission_id: "phibot.scout.public-repo-health.v1",
    source_run_id: review.run_id,
    source_commit: source.snapshot_revision,
    source_status_sha256: review.source_status_sha256,
    source_observed_at: review.observed_at,
    source_expires_at: review.expires_at,
    source_disposition: "OBSERVED_OK_UNVERIFIED_PUBLIC",
    model_provider: "ollama",
    local_model: shadow.model_name,
    local_reasoning_stages: 1,
    local_runtime_stages: 4,
    public_read_requests: 4,
    logical_model_calls: 1,
    physical_model_attempts_not_independently_attested: true,
    tools_executed: 0,
    output_contains_model_prose: false,
    public_source_authenticated: false,
    phibot_agent_identity_authenticated: false,
    phios_isolation_qualified: false,
    operator_approval_or_capability_granted: false,
    nbg_memory_admitted: false,
    remote_agent_deployed: false,
    evidence_class: "OPERATOR_LOCAL_SELF_REPORTED_WITH_VALIDATED_FORMAT",
  });
}
/** Persist only validated metadata, never raw model text or public task output. */
export async function saveScoutFieldPass(
  receipt: ScoutFieldPassReceipt, rootDir = ".phibot/scout-qualification"
): Promise<{ directory: string; sha256: string }> {
  refuse(exactly(receipt, [
    "schema","result","qualified_at","execution_mode","source_mission_id","source_run_id",
    "source_commit","source_status_sha256","source_observed_at","source_expires_at",
    "source_disposition","model_provider","local_model","local_reasoning_stages",
    "local_runtime_stages","public_read_requests","logical_model_calls",
    "physical_model_attempts_not_independently_attested","tools_executed",
    "output_contains_model_prose","public_source_authenticated",
    "phibot_agent_identity_authenticated","phios_isolation_qualified",
    "operator_approval_or_capability_granted","nbg_memory_admitted","remote_agent_deployed",
    "evidence_class"
  ]) &&
    receipt.schema === "phibot.scout-local-qualification.v0.1" &&
    receipt.result === "PASS_LOCAL_SCOUT_SHADOW" &&
    receipt.execution_mode === "OPERATOR_EXPLICIT_LOCAL_ONLY" &&
    receipt.source_mission_id === "phibot.scout.public-repo-health.v1" &&
    RUN.test(receipt.source_run_id) &&
    SHA40.test(receipt.source_commit) && SHA64.test(receipt.source_status_sha256) &&
    receipt.source_disposition === "OBSERVED_OK_UNVERIFIED_PUBLIC" &&
    receipt.model_provider === "ollama" && MODEL.test(receipt.local_model) &&
    receipt.local_reasoning_stages === 1 &&
    receipt.local_runtime_stages === 4 &&
    receipt.public_read_requests === 4 &&
    receipt.logical_model_calls === 1 &&
    receipt.physical_model_attempts_not_independently_attested === true &&
    receipt.tools_executed === 0 &&
    receipt.output_contains_model_prose === false &&
    receipt.public_source_authenticated === false &&
    receipt.phibot_agent_identity_authenticated === false &&
    receipt.phios_isolation_qualified === false &&
    receipt.operator_approval_or_capability_granted === false &&
    receipt.nbg_memory_admitted === false &&
    receipt.remote_agent_deployed === false &&
    receipt.evidence_class === "OPERATOR_LOCAL_SELF_REPORTED_WITH_VALIDATED_FORMAT" &&
    Number.isFinite(Date.parse(receipt.qualified_at)) &&
    Number.isFinite(Date.parse(receipt.source_observed_at)) &&
    Number.isFinite(Date.parse(receipt.source_expires_at)), "SAVE_SCOPE");
  const directoryRoot = resolve(rootDir);
  await mkdir(directoryRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(directoryRoot, "scout-"));
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n", "utf8");
  const sha256 = createHash("sha256").update(DOMAIN).update(bytes).digest("hex");
  await writeFile(join(directory,"qualification.json"),bytes,{flag:"wx",mode:0o600});
  await writeFile(join(directory,"qualification.sha256"),sha256+"  qualification.json\n",{flag:"wx",mode:0o600});
  return {directory,sha256};
}
