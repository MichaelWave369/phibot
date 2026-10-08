/**
 * PHIBOT-08: inspect an untrusted, fixed CloudWorker Scout observation.
 * No network, filesystem access, inference, bot registration, tool calls,
 * memory admission, or grant creation.
 */
import { createHash } from "node:crypto";

export const CLOUD_MISSION_SCHEMA = "phibot.cloud-mission-observation.v0.1";
export const CLOUD_REPO = "MichaelWave369/FieldCloudWorker";
export const CLOUD_MISSION_ID = "phibot.scout.public-repo-health.v1";
export const CLOUD_AGENT_REF = "phibot.scout.cloud-review.v1";
const DOMAIN = Buffer.from("PHIBOT-CLOUD-OBSERVATION-V1\0", "utf8");
const AGE_MS = 8 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA7 = /^[a-f0-9]{7}$/;
const RUN_ID = /^[1-9][0-9]{0,18}$/;
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const TASKS = new Set(["heartbeat", "repo_layout", "github_repo_metrics"]);

type Dict = Record<string, unknown>;
export type CloudMissionDisposition =
  "OBSERVED_OK_UNVERIFIED_PUBLIC" | "OBSERVED_ERROR_UNVERIFIED_PUBLIC" | "STALE_UNVERIFIED_PUBLIC";
export interface CloudMissionReview {
  schema: "phibot.cloud-mission-review.v0.1";
  mission_id: typeof CLOUD_MISSION_ID;
  agent_identity_ref: typeof CLOUD_AGENT_REF;
  disposition: CloudMissionDisposition;
  task_id: "github_repo_metrics";
  run_id: string;
  run_url: string;
  observed_at: string;
  expires_at: string;
  source_status_sha256: string;
  integrity_hash_matched: true;
  provenance_authenticated: false;
  agent_identity_authenticated: false;
  bot_runtime_executed: false;
  independent_run_metadata_checked: false;
  source_epistemic: "UNVERIFIED_PUBLIC";
  authority_granted: false;
  action_executed: false;
  memory_admitted: false;
  spawn_authorized: false;
  routing_influence: "NONE";
}

function refuse(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error("PHIBOT_CLOUD_" + code);
}
function isObject(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exactKeys(v: unknown, keys: readonly string[]): v is Dict {
  return isObject(v) && Object.keys(v).sort().join("|") === [...keys].sort().join("|");
}
function asString(v: unknown, code: string, max = 200): string {
  refuse(typeof v === "string" && v.length > 0 && v.length <= max, code);
  return v;
}
function time(v: unknown, code: string): number {
  const s = asString(v, code);
  refuse(STAMP.test(s), code);
  const ms = Date.parse(s);
  refuse(Number.isFinite(ms), code);
  return ms;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (isObject(value)) return "{" + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
function noGrants(value: Dict): void {
  refuse(value.worker_observation_executed === true &&
    value.phibot_runtime_executed === false &&
    value.model_inference_executed === false &&
    value.authority_granted === false &&
    value.network_write_executed === false &&
    value.memory_admitted === false, "AUTHORITY_FIELDS");
}

export function inspectCloudMission(
  suppliedMission: unknown, sourceStatusBytes: Uint8Array, nowMs = Date.now()
): CloudMissionReview {
  refuse(sourceStatusBytes instanceof Uint8Array && sourceStatusBytes.byteLength > 0 &&
    sourceStatusBytes.byteLength <= 30000, "SOURCE_BYTES");
  refuse(Number.isSafeInteger(nowMs) && nowMs > 0, "CLOCK");
  refuse(exactKeys(suppliedMission, [
    "schema", "mission_id", "agent_identity_ref", "source_repository",
    "source_status_sha256", "task_id", "execution_class", "run_id", "run_sha",
    "run_url", "observed_at", "expires_at", "outcome", "budget", "epistemic",
    "worker_observation_executed", "phibot_runtime_executed", "model_inference_executed",
    "authority_granted", "network_write_executed", "memory_admitted", "receipt_sha256",
  ]), "FIELDS");
  const mission = suppliedMission as Dict;
  refuse(mission.schema === CLOUD_MISSION_SCHEMA &&
    mission.mission_id === CLOUD_MISSION_ID &&
    mission.agent_identity_ref === CLOUD_AGENT_REF &&
    mission.source_repository === CLOUD_REPO &&
    mission.task_id === "github_repo_metrics" &&
    mission.execution_class === "DELEGATED_FIXED_OBSERVER_NOT_PHIBOT_RUNTIME" &&
    mission.epistemic === "UNVERIFIED_PUBLIC", "SCOPE");
  const runId = asString(mission.run_id, "RUN_ID");
  refuse(RUN_ID.test(runId) && Number.isSafeInteger(Number(runId)), "RUN_ID");
  const runSha = asString(mission.run_sha, "RUN_SHA");
  refuse(SHA7.test(runSha), "RUN_SHA");
  const runUrl = "https://github.com/" + CLOUD_REPO + "/actions/runs/" + runId;
  refuse(mission.run_url === runUrl, "RUN_URL");
  const sourceHash = asString(mission.source_status_sha256, "SOURCE_HASH");
  refuse(SHA256.test(sourceHash) && sha256(sourceStatusBytes) === sourceHash, "SOURCE_HASH");
  const observedAt = time(mission.observed_at, "OBSERVED_AT");
  const expiresAt = time(mission.expires_at, "EXPIRES_AT");
  refuse(expiresAt - observedAt === AGE_MS, "EXPIRY");
  refuse(observedAt <= nowMs + 300000, "FUTURE_OBSERVATION");
  refuse(mission.outcome === "OBSERVED_OK" || mission.outcome === "OBSERVED_ERROR", "OUTCOME");
  refuse(exactKeys(mission.budget, ["max_observations", "model_calls", "network_writes"]), "BUDGET");
  const budget = mission.budget as Dict;
  refuse(budget.max_observations === 1 && budget.model_calls === 0 &&
    budget.network_writes === 0, "BUDGET");
  noGrants(mission);
  const receiptHash = asString(mission.receipt_sha256, "INTEGRITY");
  refuse(SHA256.test(receiptHash), "INTEGRITY");
  const unsigned: Dict = { ...mission };
  delete unsigned.receipt_sha256;
  const actualHash = createHash("sha256")
    .update(DOMAIN).update(canonical(unsigned), "utf8").digest("hex");
  refuse(receiptHash === actualHash, "INTEGRITY");

  let status: unknown;
  try { status = JSON.parse(Buffer.from(sourceStatusBytes).toString("utf8")); }
  catch { throw new Error("PHIBOT_CLOUD_BAD_SOURCE_JSON"); }
  refuse(exactKeys(status, ["schema","receipt_kind","run_at","run_id","trigger","sha","run_url","overall","results"]), "SOURCE_SHAPE");
  const source = status as Dict;
  refuse(source.schema === "fielddeck.cloud-observation.v1" &&
    source.receipt_kind === "observation_not_authorization" &&
    source.run_id === runId && source.sha === runSha &&
    source.run_url === runUrl && source.run_at === mission.observed_at &&
    ["push", "schedule", "workflow_dispatch"].includes(String(source.trigger)), "SOURCE_MISMATCH");
  refuse(Array.isArray(source.results) && source.results.length === 3, "TASK_COUNT");
  const seen = new Set<string>();
  let foundStatus: unknown;
  for (const value of source.results as unknown[]) {
    refuse(isObject(value) && TASKS.has(String(value.task)) &&
      value.kind === "observation" && (value.status === "ok" || value.status === "error"), "TASK_SHAPE");
    const name = value.task as string;
    refuse(!seen.has(name), "TASK_DUPLICATE");
    seen.add(name);
    if (name === "github_repo_metrics") foundStatus = value.status;
  }
  refuse(seen.size === 3 && foundStatus !== undefined &&
    mission.outcome === (foundStatus === "ok" ? "OBSERVED_OK" : "OBSERVED_ERROR"), "TASK_OUTCOME");

  const disposition: CloudMissionDisposition =
    nowMs > expiresAt ? "STALE_UNVERIFIED_PUBLIC" :
    foundStatus === "ok" ? "OBSERVED_OK_UNVERIFIED_PUBLIC" :
    "OBSERVED_ERROR_UNVERIFIED_PUBLIC";

  return Object.freeze({
    schema: "phibot.cloud-mission-review.v0.1",
    mission_id: CLOUD_MISSION_ID,
    agent_identity_ref: CLOUD_AGENT_REF,
    disposition, task_id: "github_repo_metrics",
    run_id: runId, run_url: runUrl,
    observed_at: asString(mission.observed_at, "OBSERVED_AT"),
    expires_at: asString(mission.expires_at, "EXPIRES_AT"),
    source_status_sha256: sourceHash,
    integrity_hash_matched: true,
    provenance_authenticated: false,
    agent_identity_authenticated: false,
    bot_runtime_executed: false,
    independent_run_metadata_checked: false,
    source_epistemic: "UNVERIFIED_PUBLIC",
    authority_granted: false,
    action_executed: false,
    memory_admitted: false,
    spawn_authorized: false,
    routing_influence: "NONE",
  });
}
