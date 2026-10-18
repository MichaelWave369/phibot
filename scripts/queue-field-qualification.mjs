#!/usr/bin/env node
/**
 * PHIBOT-28: operator-triggered local evidence qualification.
 *
 * Reads the existing PHIBOT-25 queue files and event journal. It NEVER makes
 * a network request, runs a model or target code, or grants write authority.
 * Hashes correlate local self-reported bytes; they are not signatures.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { QUEUE_HOME, inspectQueue, queuePolicy } from "./work-queue.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const HEX64 = /^[a-f0-9]{64}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const STATES = new Set([
  "ENQUEUED", "LEASED", "OBSERVED", "RETRY_QUEUED",
  "STALE_LEASE_RECOVERED", "ATTEMPTS_EXHAUSTED",
]);
const CHECK_STATES = new Set([
  "CHECKS_FAILED", "CHECKS_PENDING", "CHECKS_MISSING",
  "CHECKS_PASS_REVIEW_ONLY", "CHECK_DATA_INVALID", "CHECK_DATA_TRUNCATED",
  "BASE_BEHIND_OR_UNKNOWN", "MERGEABILITY_NOT_CONFIRMED", "UNKNOWN",
]);
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_JOB_BYTES = 16000;
const MAX_RECEIPT_BYTES = 12000;
const OUTSTANDING = [
  "EXTERNAL_GITHUB_OBSERVATION_RECHECK",
  "REAL_CI_INSPECTION_FIELD_QUALIFICATION",
  "INTERRUPTED_LEASE_RECOVERY_FIELD_QUALIFICATION",
  "LOCAL_MODEL_REPAIR_FIELD_QUALIFICATION",
  "HUMAN_GATED_WRITE_FIELD_QUALIFICATION",
];
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
const iso = x => typeof x === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x));

async function readBounded(file, max) {
  const info = await stat(file);
  if (!info.isFile() || info.size > max || info.size < 1)
    throw new Error("FIELD_SOURCE_SIZE_OR_TYPE_INVALID");
  const bytes = await readFile(file);
  if (bytes.byteLength > max || bytes.byteLength < 1)
    throw new Error("FIELD_SOURCE_SIZE_OR_TYPE_INVALID");
  return bytes.toString("utf8");
}
async function noActiveWorker(dir) {
  try {
    await stat(join(dir, "worker.lock"));
    throw new Error("FIELD_WORKER_LOCK_PRESENT");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
function qualifiedEvidence(job, evidence) {
  if (!isObj(evidence) || !HEX64.test(evidence.digest || "") ||
      evidence.mode !== "OBSERVATION_ONLY")
    throw new Error("FIELD_EVIDENCE_CONTRACT_INVALID");
  if (job.capability === "repo.steward.discover") {
    if (Object.keys(evidence).sort().join(",") !== "digest,issues,mode,tasks" ||
        !Number.isSafeInteger(evidence.tasks) || evidence.tasks < 0 ||
        evidence.tasks > 100000 ||
        !Number.isSafeInteger(evidence.issues) || evidence.issues < 0 ||
        evidence.issues > 100000)
      throw new Error("FIELD_DISCOVERY_EVIDENCE_INVALID");
    return { digest: evidence.digest, tasks: evidence.tasks, issues: evidence.issues,
      mode: "OBSERVATION_ONLY" };
  }
  if (job.capability === "repo.steward.inspect") {
    if (Object.keys(evidence).sort().join(",") !== "checkStatus,digest,headSha,mode" ||
        !(evidence.headSha === null ||
          (typeof evidence.headSha === "string" && HEX40.test(evidence.headSha))) ||
        !CHECK_STATES.has(evidence.checkStatus))
      throw new Error("FIELD_INSPECTION_EVIDENCE_INVALID");
    return { digest: evidence.digest, headSha: evidence.headSha,
      checkStatus: evidence.checkStatus, mode: "OBSERVATION_ONLY" };
  }
  throw new Error("FIELD_CAPABILITY_UNSUPPORTED");
}

function readEventChain(body, job, expectedEvidence) {
  if (!body.endsWith("\n")) throw new Error("FIELD_JOURNAL_NOT_COMPLETE");
  const lines = body.slice(0, -1).split("\n");
  if (lines.length > 25000) throw new Error("FIELD_JOURNAL_TOO_LONG");
  const records = [];
  let chainBytes = "";
  for (const line of lines) {
    if (!line || line.length > 4500) throw new Error("FIELD_JOURNAL_LINE_INVALID");
    let e;
    try { e = JSON.parse(line); }
    catch { throw new Error("FIELD_JOURNAL_LINE_INVALID"); }
    if (!isObj(e) || e.schema !== "phibot.queue.event.v1" ||
        !STATES.has(e.event) || !HEX64.test(e.id || "") ||
        !iso(e.timestamp))
      throw new Error("FIELD_JOURNAL_EVENT_INVALID");
    if (e.id !== job.id) continue;
    records.push(e);
    chainBytes += line + "\n";
    if (records.length > 12) throw new Error("FIELD_JOB_EVENT_LIMIT_EXCEEDED");
  }
  if (!records.length) throw new Error("FIELD_JOB_EVENTS_MISSING");

  let stage = "new", attempts = 0, first = null, last = null;
  const transitions = [];
  for (const e of records) {
    const tick = Date.parse(e.timestamp);
    if (last !== null && tick < last) throw new Error("FIELD_EVENT_TIME_REVERSED");
    last = tick;
    transitions.push({ type: e.event, at: e.timestamp });
    if (stage === "new" && e.event === "ENQUEUED" &&
        e.capability === job.capability) {
      first = e.timestamp;
      stage = "queued";
    } else if (stage === "queued" && e.event === "LEASED" &&
               e.attempts === attempts + 1 && attempts < 2) {
      attempts++;
      stage = "leased";
    } else if (stage === "leased" && e.event === "RETRY_QUEUED" &&
               e.attempts === attempts && attempts < 2) {
      stage = "queued";
    } else if (stage === "leased" && e.event === "STALE_LEASE_RECOVERED" &&
               e.attempts === attempts && attempts < 2) {
      stage = "queued";
    } else if (stage === "leased" && e.event === "OBSERVED" &&
               e.attempts === attempts &&
               e.outcome === "OBSERVED_NO_PROMOTION" &&
               JSON.stringify(e.evidence) === JSON.stringify(expectedEvidence)) {
      stage = "observed";
    } else {
      throw new Error("FIELD_EVENT_SEQUENCE_INVALID");
    }
  }
  if (stage !== "observed" || job.attempts !== attempts ||
      job.lastOutcome !== "OBSERVED_NO_PROMOTION")
    throw new Error("FIELD_JOB_EVENTS_DISAGREE");
  return { first, last: records.at(-1).timestamp, attempts,
    events: transitions, eventChainDigest: sha256(chainBytes) };
}

export async function buildFieldReport({ policy, dir = QUEUE_HOME, jobId } = {}) {
  if (!policy) throw new Error("FIELD_EXPLICIT_REPO_ALLOWLIST_REQUIRED");
  if (jobId !== undefined && !HEX64.test(jobId))
    throw new Error("FIELD_JOB_ID_INVALID");
  await noActiveWorker(dir);
  const listing = await inspectQueue(policy, dir);
  const completed = listing.jobs.filter(j => j.state === "completed");
  let job;
  if (jobId) job = listing.jobs.find(j => j.id === jobId);
  else if (completed.length === 1) job = completed[0];
  else throw new Error("FIELD_SELECT_EXACT_JOB_ID");
  if (!job || job.state !== "completed" || job.attempts < 1 ||
      job.attempts > 2 || job.lastOutcome !== "OBSERVED_NO_PROMOTION")
    throw new Error("FIELD_COMPLETED_READ_REQUIRED");

  const jobBody = await readBounded(join(dir, "jobs", job.id + ".json"), MAX_JOB_BYTES);
  let raw;
  try { raw = JSON.parse(jobBody); }
  catch { throw new Error("FIELD_JOB_FILE_INVALID"); }
  if (!isObj(raw) || raw.id !== job.id ||
      raw.schema !== "phibot.queue.job.v1" || raw.lease !== null ||
      raw.state !== "completed" || raw.attempts !== job.attempts ||
      raw.lastOutcome !== job.lastOutcome ||
      JSON.stringify(raw.evidence) !== JSON.stringify(job.evidence))
    throw new Error("FIELD_JOB_FILE_MISMATCH");

  const evidence = qualifiedEvidence(job, job.evidence);
  const journalBody = await readBounded(join(dir, "events.ndjson"), MAX_LEDGER_BYTES);
  const chain = readEventChain(journalBody, job, evidence);
  // The worker's state is checked again before materializing a qualification.
  await noActiveWorker(dir);
  if (sha256(await readBounded(join(dir, "jobs", job.id + ".json"), MAX_JOB_BYTES)) !== sha256(jobBody) ||
      sha256(await readBounded(join(dir, "events.ndjson"), MAX_LEDGER_BYTES)) !== sha256(journalBody))
    throw new Error("FIELD_SOURCES_CHANGED_DURING_READ");

  return {
    schema: "phibot.queue.field-qualification.v1",
    classification: "LOCAL_SELF_REPORTED_READ_OBSERVED",
    issuedAt: new Date().toISOString(),
    subject: {
      jobId: job.id, repository: job.repository, capability: job.capability,
      ...(job.prNumber ? { prNumber: job.prNumber } : {}),
      attempts: job.attempts,
      firstEnqueuedAt: chain.first, observedAt: chain.last,
    },
    localEvidence: {
      jobFileDigest: sha256(jobBody),
      selectedEventChainDigest: chain.eventChainDigest,
      observation: evidence,
      transitions: chain.events,
    },
    executionContext: {
      platform: process.platform, arch: process.arch,
      nodeMajor: Number(process.versions.node.split(".")[0]),
      origin: "LOCAL_QUEUE_FILES_SELF_REPORT",
      source: "PHIBOT-25_EXISTING_READ_ONLY_TOOL_QUEUE",
      remoteWritesVerified: false,
      independentRemoteVerification: false,
    },
    remainingQualificationGates: OUTSTANDING,
  };
}

function receiptDigest(doc) {
  return sha256(JSON.stringify(doc));
}
function receiptFile(dir, id) {
  return join(dir, "qualification", id + ".json");
}
export async function verifyFieldReceipt({ dir = QUEUE_HOME, jobId } = {}) {
  if (!HEX64.test(jobId || "")) throw new Error("FIELD_JOB_ID_INVALID");
  const file = receiptFile(dir, jobId);
  const body = await readBounded(file, MAX_RECEIPT_BYTES);
  let parsed;
  try { parsed = JSON.parse(body); }
  catch { throw new Error("FIELD_RECEIPT_INVALID"); }
  if (!isObj(parsed) ||
      parsed.schema !== "phibot.queue.field-qualification.v1" ||
      parsed.classification !== "LOCAL_SELF_REPORTED_READ_OBSERVED" ||
      parsed.subject?.jobId !== jobId ||
      !HEX64.test(parsed.receiptDigest || ""))
    throw new Error("FIELD_RECEIPT_INVALID");
  const { receiptDigest: existing, ...unsigned } = parsed;
  if (receiptDigest(unsigned) !== existing)
    throw new Error("FIELD_RECEIPT_DIGEST_MISMATCH");
  return { status: "LOCAL_RECEIPT_SELF_HASH_MATCHES",
    qualification: "LOCAL_SELF_REPORT_NOT_INDEPENDENT_ATTESTATION",
    jobId, digest: existing, file: relative(process.cwd(), file) };
}

export async function saveFieldReceipt({ policy, dir = QUEUE_HOME, jobId } = {}) {
  const report = await buildFieldReport({ policy, dir, jobId });
  const id = report.subject.jobId;
  const digest = receiptDigest(report);
  const file = receiptFile(dir, id);
  await mkdir(join(dir, "qualification"), { recursive: true, mode: 0o700 });
  const body = JSON.stringify({ ...report, receiptDigest: digest }, null, 2) + "\n";
  if (Buffer.byteLength(body, "utf8") > MAX_RECEIPT_BYTES)
    throw new Error("FIELD_RECEIPT_TOO_LARGE");
  try {
    await writeFile(file, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const prior = await verifyFieldReceipt({ dir, jobId: id });
    return { ...prior, status: "FIELD_RECEIPT_ALREADY_EXISTS_NO_OVERWRITE" };
  }
  // The saved bytes must match the in-memory record.
  await verifyFieldReceipt({ dir, jobId: id });
  return { status: "FIELD_RECEIPT_SAVED_LOCAL_SELF_REPORT",
    jobId: id, digest, file: relative(process.cwd(), file),
    observation: report.localEvidence.observation,
    remainingQualificationGates: report.remainingQualificationGates };
}

export async function main(argv = process.argv.slice(2)) {
  const [action = "create", flag, value] = argv;
  if (!["create", "verify"].includes(action) ||
      (argv.length !== 1 && !(argv.length === 3 && flag === "--job")) ||
      (argv.length === 3 && !HEX64.test(value || "")) ||
      (action === "verify" && argv.length !== 3))
    throw new Error("Usage: npm run queue:qualify [-- create [--job 64hex] | verify --job 64hex]");
  const output = action === "create"
    ? await saveFieldReceipt({ policy: queuePolicy(), jobId: value })
    : await verifyFieldReceipt({ jobId: value });
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write("PhiBot local field qualification refused: " +
      (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  });
}
