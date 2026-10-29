#!/usr/bin/env node
/**
 * PHIBOT-32 | Learning Gate R3: separate GitHub check-run corroboration and
 * immutable local human-review proposals. No promotion or policy write path.
 * "Independent" means different bounded verifier code, NOT another provider.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCIBridge, parseCIBridgeArgs } from "./learning-ci-bridge.mjs";
import { githubClient } from "./repo-steward.mjs";
import { validateObservation, failureSignature, LEARNING_HOME } from "./learning-gate.mjs";
import { queuePolicy, validateQueueRequest } from "./work-queue.mjs";

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_AGE_MS = 14 * 86400000;
const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const deny = c => { throw new Error("LG_R3_" + c); };
const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
function exact(value, names) {
  if (!obj(value) || Object.keys(value).sort().join("|") !== names.slice().sort().join("|"))
    deny("SHAPE_INVALID");
}
function safeReader(reader, repo) {
  return (method, path, data, optional) => {
    const prefix = "/repos/" + repo;
    if (method !== "GET" || data !== undefined || typeof path !== "string" ||
        !(path === prefix || path.startsWith(prefix + "/"))) deny("REMOTE_AUTHORITY_DENIED");
    return reader(method, path, undefined, optional);
  };
}
const home = root => resolve(root, "r3");
const auditFile = (root, id) => join(home(root), "audits", id + ".json");
const reviewFile = (root, id) => join(home(root), "review-proposals", id + ".json");
async function readSmall(path) {
  const s = await lstat(path);
  if (!s.isFile() || s.size < 2 || s.size > 4096) deny("RECORD_SIZE_OR_TYPE_INVALID");
  const bytes = await readFile(path);
  if (bytes.length > 4096) deny("RECORD_SIZE_CHANGED");
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { deny("RECORD_JSON_INVALID"); }
}
async function immutable(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, JSON.stringify(value, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    return "CREATED";
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
    const existing = await readSmall(path);
    if (JSON.stringify(existing) !== JSON.stringify(value))
      deny("IMMUTABLE_RECORD_MISMATCH");
    return "EXISTS_IDENTICAL";
  }
}

export function parseR3Verify(argv = []) {
  const ix = argv.indexOf("--save");
  if (argv.filter(v => v === "--save").length > 1) deny("ARGS_INVALID");
  const filtered = argv.filter(v => v !== "--save");
  let parsed;
  try { parsed = parseCIBridgeArgs(filtered); }
  catch { deny("ARGS_INVALID"); }
  if (parsed.capture) deny("ARGS_INVALID");
  return { ...parsed, save: ix !== -1 };
}
function checkBridge(reply, args) {
  if (!obj(reply) || reply.status !== "REVIEW_ONLY_PREVIEW" ||
      reply.schema !== "phibot.learning.ci.bridge.v1" ||
      reply.source !== "RECHECKED_GITHUB_API_READ_NOT_INDEPENDENT_ATTESTATION" ||
      reply.repo !== args.repository || reply.pr !== args.prNumber ||
      reply.check !== args.checkName || reply.source_sha !== args.expectedSha ||
      reply.grants !== 0 || reply.remote_writes !== 0 || reply.retry_enforcement !== false ||
      !HEX64.test(reply.evidence_sha256 || ""))
    deny("BRIDGE_CONTRACT_INVALID");
  const observation = validateObservation(reply.observation);
  const expectedCheck = "CI_" + hash(args.checkName).slice(0, 24).toUpperCase();
  if (observation.repo !== args.repository ||
      observation.source_sha !== args.expectedSha ||
      observation.run_id !== "ci-pr" + args.prNumber + "-" + args.expectedSha ||
      observation.layer !== "LOOP" || observation.failure_class !== "FAILED_GATE" ||
      observation.task_kind !== "repo.steward.inspect" ||
      observation.check_id !== expectedCheck ||
      observation.expected_code !== "CHECKS_PASS_REVIEW_ONLY" ||
      observation.observed_code !== "CHECKS_FAILED" ||
      observation.evidence_sha256 !== reply.evidence_sha256)
    deny("BRIDGE_OBSERVATION_MISMATCH");
  return observation;
}
function proofFrom(detail, args, id) {
  if (!obj(detail) || detail.id !== id ||
      detail.name !== args.checkName || detail.head_sha !== args.expectedSha ||
      detail.status !== "completed" || detail.conclusion !== "failure" ||
      (detail.check_suite?.head_sha !== undefined &&
       detail.check_suite.head_sha !== args.expectedSha))
    deny("CHECK_RUN_DETAIL_MISMATCH");
  return { id, name: args.checkName, head_sha: args.expectedSha,
    status: "completed", conclusion: "failure" };
}
export async function corroborateCheck(reader, args) {
  const prefix = "/repos/" + args.repository;
  const endpoint = prefix + "/commits/" + args.expectedSha + "/check-runs?per_page=100";
  const listing = await reader("GET", endpoint);
  if (!obj(listing) || !Number.isSafeInteger(listing.total_count) ||
      !Array.isArray(listing.check_runs) || listing.total_count !== listing.check_runs.length ||
      listing.total_count > 100) deny("CHECK_LIST_INCOMPLETE");
  const matches = listing.check_runs.filter(x => x?.name === args.checkName);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) ||
      matches[0].id < 1 || matches[0].status !== "completed" ||
      matches[0].conclusion !== "failure") deny("EXACT_FAILED_CHECK_REQUIRED");
  const id = matches[0].id;
  const detail = await reader("GET", prefix + "/check-runs/" + id);
  const proof = proofFrom(detail, args, id);
  const fresh = await reader("GET", prefix + "/pulls/" + args.prNumber);
  if (fresh?.state !== "open" || fresh?.draft !== true ||
      fresh?.head?.sha !== args.expectedSha ||
      fresh?.head?.repo?.full_name !== args.repository ||
      fresh?.base?.repo?.full_name !== args.repository)
    deny("PR_HEAD_CHANGED");
  const checkAgain = await reader("GET", prefix + "/check-runs/" + id);
  if (JSON.stringify(proofFrom(checkAgain, args, id)) !== JSON.stringify(proof))
    deny("CHECK_CHANGED");
  return proof;
}
function makeAudit({ args, observation, proof, seenAt }) {
  const payload = {
    schema: "phibot.learning.review.audit.v1",
    trust: "SAME_PROVIDER_CORROBORATED_UNSIGNED",
    mode: "EVIDENCE_RECORD_NO_AUTHORITY",
    repo: args.repository, pr: args.prNumber,
    source_sha: args.expectedSha, check_name: args.checkName,
    observed_at: seenAt, observation, proof,
    signature: failureSignature(observation)
  };
  return { ...payload, id: hash(payload) };
}
export function validateAudit(record) {
  exact(record, ["schema", "trust", "mode", "repo", "pr", "source_sha",
    "check_name", "observed_at", "observation", "proof", "signature", "id"]);
  if (record.schema !== "phibot.learning.review.audit.v1" ||
      record.trust !== "SAME_PROVIDER_CORROBORATED_UNSIGNED" ||
      record.mode !== "EVIDENCE_RECORD_NO_AUTHORITY" ||
      !Number.isSafeInteger(record.pr) || record.pr < 1 ||
      typeof record.observed_at !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.observed_at) ||
      !Number.isFinite(Date.parse(record.observed_at)))
    deny("AUDIT_METADATA_INVALID");
  const args = { repository: record.repo, prNumber: record.pr,
    expectedSha: record.source_sha, checkName: record.check_name };
  const observation = checkBridge({
    status: "REVIEW_ONLY_PREVIEW", schema: "phibot.learning.ci.bridge.v1",
    source: "RECHECKED_GITHUB_API_READ_NOT_INDEPENDENT_ATTESTATION",
    repo: record.repo, pr: record.pr, check: record.check_name,
    source_sha: record.source_sha, grants: 0, remote_writes: 0,
    retry_enforcement: false, evidence_sha256: record.observation?.evidence_sha256,
    observation: record.observation
  }, args);
  const proof = proofFrom(record.proof, args, record.proof?.id);
  const recomputed = makeAudit({ args, observation, proof, seenAt: record.observed_at });
  if (JSON.stringify(record) !== JSON.stringify(recomputed))
    deny("AUDIT_INTEGRITY_INVALID");
  return recomputed;
}
export async function verifyR3({
  argv = [], env = process.env, gh, root = env.PHIBOT_LEARNING_HOME || LEARNING_HOME,
  now = Date.now, bridge = runCIBridge
} = {}) {
  const args = parseR3Verify(argv);
  const policy = queuePolicy(env);
  validateQueueRequest("repo.steward.inspect", {
    repository: args.repository, prNumber: args.prNumber,
    requiredChecks: [args.checkName]
  }, policy);
  const token = env.PHIBOT_GITHUB_TOKEN || env.GH_TOKEN;
  if (!gh && !token) deny("READ_TOKEN_REQUIRED");
  const reader = safeReader(gh ?? githubClient(token), args.repository);
  const preview = await bridge({ argv: argv.filter(v => v !== "--save"),
    env, gh: reader });
  const observation = checkBridge(preview, args);
  const proof = await corroborateCheck(reader, args);
  const ms = now();
  if (!Number.isSafeInteger(ms) || ms < 0) deny("CLOCK_INVALID");
  const audit = makeAudit({
    args, observation, proof, seenAt: new Date(ms).toISOString()
  });
  if (!args.save) return { status: "R3_PREVIEW_NO_SAVE", audit,
    grants: 0, policy_writes: 0, github_writes: 0 };
  const state = await immutable(auditFile(root, audit.id), audit);
  return { status: "LOCAL_UNSIGNED_AUDIT_SAVED", audit_id: audit.id,
    signature: audit.signature, save_status: state,
    trust: audit.trust, grants: 0, policy_writes: 0, github_writes: 0 };
}
export async function proposeR3(idOne, idTwo, {
  root = LEARNING_HOME, now = Date.now
} = {}) {
  if (!HEX64.test(idOne || "") || !HEX64.test(idTwo || "") ||
      idOne === idTwo) deny("TWO_DIFFERENT_AUDITS_REQUIRED");
  const a = validateAudit(await readSmall(auditFile(root, idOne)));
  const b = validateAudit(await readSmall(auditFile(root, idTwo)));
  if (a.id !== idOne || b.id !== idTwo) deny("AUDIT_ID_MISMATCH");
  if (a.repo !== b.repo || a.signature !== b.signature ||
      a.check_name !== b.check_name ||
      a.source_sha === b.source_sha || a.proof.id === b.proof.id)
    deny("RECURRENCE_NOT_INDEPENDENT");
  const ms = now();
  if (!Number.isSafeInteger(ms) || ms < 0) deny("CLOCK_INVALID");
  for (const record of [a, b]) {
    const age = ms - Date.parse(record.observed_at);
    if (age < 0 || age > MAX_AGE_MS) deny("AUDIT_STALE_OR_FUTURE");
  }
  const payload = {
    schema: "phibot.learning.review.proposal.v1",
    mode: "HUMAN_REVIEW_REQUIRED_NO_EXECUTION",
    source_trust: "SAME_PROVIDER_CORROBORATED_UNSIGNED",
    repo: a.repo, signature: a.signature, check_name: a.check_name,
    audit_ids: [idOne, idTwo].sort(),
    action: "CONSIDER_STOP_RETRY_ADVISORY",
    promoted: false, policy_writes: 0, grants: 0,
    reverify_at_promotion: true
  };
  const proposal = { ...payload, id: hash(payload) };
  const state = await immutable(reviewFile(root, proposal.id), proposal);
  return { status: "HUMAN_REVIEW_PACKET_ONLY", proposal_id: proposal.id,
    save_status: state, audit_ids: proposal.audit_ids,
    promoted: false, policy_writes: 0, grants: 0 };
}
async function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === "verify") return verifyR3({ argv: args });
  if (cmd === "propose" && args.length === 2)
    return proposeR3(args[0], args[1],
      { root: process.env.PHIBOT_LEARNING_HOME || LEARNING_HOME });
  deny("USAGE_INVALID");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(data => {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  }).catch(e => {
    const safe = /^(LG_R3_|LG_CI_|QUEUE_|LG_)[A-Z0-9_]+$/.test(e?.message || "")
      ? e.message : "LG_R3_OPERATION_REFUSED";
    process.stderr.write(safe + "\n");
    process.exitCode = 1;
  });
}
