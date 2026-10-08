/**
 * PHIBOT-09: operator-invoked retrieval of the fixed public Scout receipt.
 *
 * Acquires a consistent public Git commit snapshot, verifies file blob IDs,
 * invokes the PHIBOT-08 offline review, correlates GitHub run metadata,
 * and returns only redacted no-authority evidence. NOT a running PhiBot.
 */
import { createHash } from "node:crypto";
import { CLOUD_REPO, inspectCloudMission } from "./mission-evidence.js";
import type { CloudMissionReview } from "./mission-evidence.js";

export const PUBLIC_API = "https://api.github.com/repos/" + CLOUD_REPO;
const SOURCE_FILES = ["docs/status.json", "docs/phibot_mission.json"] as const;
const GIT_SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[1-9][0-9]{0,18}$/;
const ACCEPTED_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const MAX_RESPONSE = 100_000;
const MAX_MISSION = 16_000;
const MAX_STATUS = 30_000;
const TIME_SLACK = 5 * 60 * 1000;

type Obj = Record<string, unknown>;
export type PublicGet = (url: string) => Promise<Uint8Array>;
export interface CloudScoutPublicReview {
  schema: "phibot.cloud-mission-public-review.v0.1";
  acquisition_kind: "OPERATOR_INITIATED_PUBLIC_GITHUB_GET";
  snapshot_revision: string;
  source_status_git_blob: string;
  mission_git_blob: string;
  review: CloudMissionReview;
  github_run_metadata_correlated: true;
  independent_prior_source_pin_verified: false;
  operator_identity_authenticated: false;
  measurement_truth_authenticated: false;
  source_authorship_authenticated: false;
  scheduled_fetch_enabled: false;
  agent_runtime_executed: false;
  model_calls_executed: false;
  authority_granted: false;
  action_executed: false;
  memory_admitted: false;
  bot_spawned: false;
}

function reject(yes: unknown, code: string): asserts yes {
  if (!yes) throw new Error("PHIBOT_PUBLIC_" + code);
}
function object(x: unknown): x is Obj {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function json(bytes: Uint8Array, cap: number): Obj {
  reject(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= cap, "SIZE");
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch { throw new Error("PHIBOT_PUBLIC_JSON"); }
  reject(object(parsed), "SHAPE");
  return parsed;
}
function encode(value: string): Uint8Array {
  return Buffer.from(value, "utf8");
}
function gitBlobSha(raw: Uint8Array): string {
  return createHash("sha1").update("blob " + raw.length + "\0")
    .update(raw).digest("hex");
}
function apiEndpoint(url: string): boolean {
  if (url === PUBLIC_API + "/branches/main") return true;
  if (/^https:\/\/api\.github\.com\/repos\/MichaelWave369\/FieldCloudWorker\/actions\/runs\/[1-9][0-9]{0,18}$/.test(url)) return true;
  if (url.startsWith(PUBLIC_API + "/contents/")) {
    const prefix = PUBLIC_API + "/contents/";
    const [path, commit] = url.slice(prefix.length).split("?ref=");
    return SOURCE_FILES.some(p => p === path) && typeof commit === "string" && GIT_SHA.test(commit) &&
      url === prefix + path + "?ref=" + commit;
  }
  return false;
}
/** Exactly one public no-auth GET, with no redirect and streaming size cap. */
export async function publicGitHubGet(url: string): Promise<Uint8Array> {
  reject(apiEndpoint(url), "URL_NOT_ALLOWED");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "PhiBot-PH09-ReadOnly",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch { throw new Error("PHIBOT_PUBLIC_TRANSPORT"); }
  reject(response.status === 200 && response.ok, "HTTP");
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  reject(contentType === "application/json" || contentType === "application/vnd.github+json", "CONTENT_TYPE");
  const sizeText = response.headers.get("content-length");
  if (sizeText !== null) {
    const n = Number(sizeText);
    reject(Number.isSafeInteger(n) && n > 0 && n <= MAX_RESPONSE, "RESPONSE_LENGTH");
  }
  reject(response.body !== null, "RESPONSE_BODY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reject(value instanceof Uint8Array, "CHUNK");
      size += value.length;
      reject(size <= MAX_RESPONSE, "RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  reject(size > 0, "RESPONSE_EMPTY");
  return Buffer.concat(chunks, size);
}
async function load(url: string, get: PublicGet): Promise<Obj> {
  reject(apiEndpoint(url), "URL_NOT_ALLOWED");
  return json(await get(url), MAX_RESPONSE);
}
async function fileAt(path: typeof SOURCE_FILES[number], commit: string, get: PublicGet):
  Promise<{ bytes: Uint8Array; sha: string }> {
  const envelope = await load(PUBLIC_API + "/contents/" + path + "?ref=" + commit, get);
  reject(envelope.type === "file" && envelope.path === path &&
    envelope.name === path.split("/").at(-1) && envelope.encoding === "base64", "FILE_IDENTITY");
  const raw = envelope.content;
  const maximum = path === SOURCE_FILES[0] ? MAX_STATUS : MAX_MISSION;
  reject(typeof raw === "string" && raw.length > 0 && raw.length <= maximum * 2 + 100, "BASE64_LENGTH");
  const clean = raw.replace(/\s/g, "");
  reject(/^[A-Za-z0-9+/]*={0,2}$/.test(clean) && clean.length % 4 === 0, "BASE64_FORMAT");
  const bytes = Buffer.from(clean, "base64");
  reject(bytes.length > 0 && bytes.length <= maximum &&
    bytes.toString("base64") === clean &&
    typeof envelope.size === "number" &&
    Number.isSafeInteger(envelope.size) && envelope.size === bytes.length, "FILE_SIZE");
  const blobSha = gitBlobSha(bytes);
  reject(typeof envelope.sha === "string" && GIT_SHA.test(envelope.sha) &&
    blobSha === envelope.sha, "GIT_BLOB_SHA");
  return { bytes, sha: blobSha };
}
function stamp(value: unknown): number {
  reject(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value), "TIME_FORMAT");
  const ms = Date.parse(value);
  reject(Number.isFinite(ms), "TIME_INVALID");
  return ms;
}

export async function inspectPublishedCloudScout(
  get: PublicGet = publicGitHubGet, nowMs = Date.now()
): Promise<CloudScoutPublicReview> {
  reject(Number.isSafeInteger(nowMs) && nowMs > 0, "CLOCK");
  // One exact commit for both source files, never mixing moving main reads.
  const branch = await load(PUBLIC_API + "/branches/main", get);
  reject(branch.name === "main" && object(branch.commit) &&
    typeof branch.commit.sha === "string" && GIT_SHA.test(branch.commit.sha), "BRANCH");
  const commit = branch.commit.sha;
  const status = await fileAt(SOURCE_FILES[0], commit, get);
  const mission = await fileAt(SOURCE_FILES[1], commit, get);
  const missionData = json(mission.bytes, MAX_MISSION);
  const offline = inspectCloudMission(missionData, status.bytes, nowMs);

  const runId = offline.run_id;
  reject(RUN_ID.test(runId) && Number.isSafeInteger(Number(runId)), "RUN_ID");
  const metadata = await load(PUBLIC_API + "/actions/runs/" + runId, get);
  reject(object(metadata.repository) && metadata.repository.full_name === CLOUD_REPO &&
    metadata.id === Number(runId) &&
    metadata.name === "FieldCloudWorker Observation Pilot" &&
    metadata.path === ".github/workflows/worker.yml" &&
    metadata.head_branch === "main" &&
    typeof metadata.event === "string" && ACCEPTED_EVENTS.has(metadata.event), "RUN_IDENTITY");
  // GitHub Actions records the pre-publication commit, not the newer Pages
  // commit. The seven-character SHA prefix is fixed in the source status.
  const statusData = json(status.bytes, MAX_STATUS);
  reject(typeof statusData.sha === "string" && /^[0-9a-f]{7}$/.test(statusData.sha) &&
    typeof metadata.head_sha === "string" && GIT_SHA.test(metadata.head_sha) &&
    metadata.head_sha.startsWith(statusData.sha) &&
    metadata.event === statusData.trigger, "RUN_COMMIT_EVENT");
  reject(metadata.status === "completed" &&
    metadata.conclusion === (statusData.overall === "ok" ? "success" : "failure") &&
    metadata.html_url === offline.run_url, "RUN_CONCLUSION");
  const started = stamp(metadata.created_at), updated = stamp(metadata.updated_at);
  const observed = stamp(offline.observed_at);
  reject(started <= updated && started - TIME_SLACK <= observed &&
    observed <= updated + TIME_SLACK, "RUN_CLOCK");

  return Object.freeze({
    schema: "phibot.cloud-mission-public-review.v0.1",
    acquisition_kind: "OPERATOR_INITIATED_PUBLIC_GITHUB_GET",
    snapshot_revision: commit,
    source_status_git_blob: status.sha,
    mission_git_blob: mission.sha,
    review: offline,
    github_run_metadata_correlated: true,
    independent_prior_source_pin_verified: false,
    operator_identity_authenticated: false,
    measurement_truth_authenticated: false,
    source_authorship_authenticated: false,
    scheduled_fetch_enabled: false,
    agent_runtime_executed: false,
    model_calls_executed: false,
    authority_granted: false,
    action_executed: false,
    memory_admitted: false,
    bot_spawned: false,
  });
}
