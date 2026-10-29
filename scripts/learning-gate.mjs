#!/usr/bin/env node
/**
 * PHIBOT-30 Learning Gate R1.
 * Local, operator-invoked, metadata-only failure capsules and advisory replay.
 * No network, models, GitHub mutations, grants, policy edits, or automatic hooks.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LEARNING_HOME = join(process.cwd(), ".phibot", "learning-gate");
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const REPO = /^[A-Za-z0-9_.-]{1,80}\/[A-Za-z0-9_.-]{1,100}$/;
const IDENT = /^[A-Za-z0-9_.:-]{1,80}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const LAYERS = new Set(["HARNESS", "LOOP", "GRAPH"]);
const FAILURES = new Set([
  "DUPLICATE_REPAIR_ATTEMPT", "REPEATED_OBSERVATION",
  "MISSING_VERIFICATION", "UNAVAILABLE_CAPABILITY",
  "DUPLICATE_WORK", "FAILED_GATE"
]);
const OBS_KEYS = [
  "check_id", "evidence_sha256", "expected_code", "failure_class",
  "layer", "observed_code", "repo", "run_id", "source_sha", "task_kind"
];
const CAPSULE_KEYS = ["id", "mode", "observation", "schema", "signature"];
const PROPOSAL_KEYS = ["capsule_ids", "id", "mode", "rule", "schema", "signature"];
const MAX_ITEMS = 500;

const digest = data => createHash("sha256").update(JSON.stringify(data)).digest("hex");
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
function keys(v, expected, code) {
  if (!object(v) || Object.keys(v).sort().join("|") !== expected.slice().sort().join("|"))
    throw new Error(code);
}
function matches(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(code);
  return value;
}

export function validateObservation(input) {
  keys(input, OBS_KEYS, "LG_OBSERVATION_KEYS_INVALID");
  const obs = {
    repo: matches(input.repo, REPO, "LG_REPO_INVALID"),
    run_id: matches(input.run_id, IDENT, "LG_RUN_ID_INVALID"),
    source_sha: matches(input.source_sha, SHA, "LG_SOURCE_SHA_INVALID"),
    layer: input.layer,
    failure_class: input.failure_class,
    task_kind: matches(input.task_kind, IDENT, "LG_TASK_KIND_INVALID"),
    check_id: matches(input.check_id, IDENT, "LG_CHECK_ID_INVALID"),
    expected_code: matches(input.expected_code, CODE, "LG_EXPECTED_CODE_INVALID"),
    observed_code: matches(input.observed_code, CODE, "LG_OBSERVED_CODE_INVALID"),
    evidence_sha256: matches(input.evidence_sha256, HASH, "LG_EVIDENCE_HASH_INVALID")
  };
  if (!LAYERS.has(obs.layer) || !FAILURES.has(obs.failure_class))
    throw new Error("LG_CLASSIFICATION_INVALID");
  if (obs.expected_code === obs.observed_code)
    throw new Error("LG_NO_OBSERVED_GAP");
  return obs;
}
export function failureSignature(observation) {
  const o = validateObservation(observation);
  // Run/commit/evidence identifiers intentionally excluded so recurrence is visible.
  return digest({
    schema: "phibot.learning.signature.v1", repo: o.repo,
    layer: o.layer, failure_class: o.failure_class, task_kind: o.task_kind,
    check_id: o.check_id, expected_code: o.expected_code,
    observed_code: o.observed_code
  });
}
function makeCapsule(input) {
  const observation = validateObservation(input);
  const payload = {
    schema: "phibot.learning.capsule.v1", mode: "LOCAL_SELF_REPORT",
    observation, signature: failureSignature(observation)
  };
  return { ...payload, id: digest(payload) };
}
function checkCapsule(v) {
  keys(v, CAPSULE_KEYS, "LG_CAPSULE_KEYS_INVALID");
  const expected = makeCapsule(v.observation);
  if (JSON.stringify(v) !== JSON.stringify(expected))
    throw new Error("LG_CAPSULE_INTEGRITY_FAILED");
  return expected;
}
async function boundedJson(path, limit = 4096) {
  const st = await lstat(path);
  if (!st.isFile() || st.size < 2 || st.size > limit)
    throw new Error("LG_FILE_TYPE_OR_SIZE_INVALID");
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error("LG_FILE_SIZE_CHANGED");
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("LG_JSON_INVALID"); }
}
async function putImmutable(dir, id, data) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, id + ".json");
  const content = JSON.stringify(data, null, 2) + "\n";
  try {
    await writeFile(file, content, { flag: "wx", mode: 0o600 });
    return "CREATED";
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
    // Existing identities are immutable; a mismatched or damaged file refuses.
    const existing = await boundedJson(file);
    if (JSON.stringify(existing) !== JSON.stringify(data))
      throw new Error("LG_IDENTITY_COLLISION_OR_TAMPER");
    return "EXISTS_IDENTICAL";
  }
}
async function loadDir(dir, validator) {
  let entries;
  try { entries = await readdir(dir); }
  catch (e) { if (e?.code === "ENOENT") return []; throw e; }
  if (entries.length > MAX_ITEMS) throw new Error("LG_RECORD_LIMIT_EXCEEDED");
  const result = [];
  for (const file of entries.sort()) {
    if (!HASH.test(file.slice(0, -5)) || !file.endsWith(".json"))
      throw new Error("LG_UNEXPECTED_RECORD");
    const record = validator(await boundedJson(join(dir, file)));
    if (file !== record.id + ".json") throw new Error("LG_FILE_ID_MISMATCH");
    result.push(record);
  }
  return result;
}
const capsuleDir = root => join(resolve(root), "capsules");
const proposalDir = root => join(resolve(root), "proposals");

export async function captureFailure(input, root = LEARNING_HOME) {
  const record = makeCapsule(input);
  const status = await putImmutable(capsuleDir(root), record.id, record);
  return { status, capsule_id: record.id, signature: record.signature,
    mode: record.mode };
}
export async function listFailures(root = LEARNING_HOME) {
  const capsules = await loadDir(capsuleDir(root), checkCapsule);
  const counts = new Map();
  for (const c of capsules) {
    const current = counts.get(c.signature) || new Set();
    current.add(c.observation.run_id);
    counts.set(c.signature, current);
  }
  return { status: "READ_ONLY", total: capsules.length,
    signatures: [...counts].map(([signature, runs]) =>
      ({ signature, distinct_runs: runs.size })).sort((a, b) =>
      a.signature.localeCompare(b.signature)) };
}
function makeProposal(capsules, signature) {
  const payload = {
    schema: "phibot.learning.proposal.v1",
    mode: "REVIEW_ONLY_NO_ENFORCEMENT",
    signature,
    capsule_ids: capsules.map(c => c.id).sort(),
    rule: { trigger: "REPEATED_FAILURE_SIGNATURE",
      effect: "STOP_RETRY_ADVISORY" }
  };
  return { ...payload, id: digest(payload) };
}
function checkProposal(v) {
  keys(v, PROPOSAL_KEYS, "LG_PROPOSAL_KEYS_INVALID");
  if (v.schema !== "phibot.learning.proposal.v1" ||
      v.mode !== "REVIEW_ONLY_NO_ENFORCEMENT" ||
      !HASH.test(v.signature || "") || !Array.isArray(v.capsule_ids) ||
      v.capsule_ids.length < 2 || v.capsule_ids.length > MAX_ITEMS ||
      v.capsule_ids.some(id => !HASH.test(id)) ||
      new Set(v.capsule_ids).size !== v.capsule_ids.length)
    throw new Error("LG_PROPOSAL_INVALID");
  keys(v.rule, ["effect", "trigger"], "LG_RULE_KEYS_INVALID");
  if (v.rule.trigger !== "REPEATED_FAILURE_SIGNATURE" ||
      v.rule.effect !== "STOP_RETRY_ADVISORY")
    throw new Error("LG_RULE_UNSUPPORTED");
  const expected = makeProposal(v.capsule_ids.map(id => ({ id })), v.signature);
  if (JSON.stringify(v) !== JSON.stringify(expected))
    throw new Error("LG_PROPOSAL_INTEGRITY_FAILED");
  return expected;
}
function qualifying(capsules, ids, signature) {
  const selected = capsules.filter(c => ids.includes(c.id));
  if (selected.length !== ids.length ||
      selected.some(c => c.signature !== signature) ||
      new Set(selected.map(c => c.observation.run_id)).size < 2)
    throw new Error("LG_EVIDENCE_MISSING_OR_NOT_INDEPENDENT");
  return selected;
}
export async function proposeLesson(signature, root = LEARNING_HOME) {
  matches(signature, HASH, "LG_SIGNATURE_INVALID");
  const records = await loadDir(capsuleDir(root), checkCapsule);
  const selected = records.filter(c => c.signature === signature);
  if (new Set(selected.map(c => c.observation.run_id)).size < 2)
    throw new Error("LG_NEEDS_TWO_DISTINCT_RUNS");
  const proposal = makeProposal(selected, signature);
  const status = await putImmutable(proposalDir(root), proposal.id, proposal);
  return { status, proposal_id: proposal.id, signature,
    distinct_runs: new Set(selected.map(c => c.observation.run_id)).size,
    mode: proposal.mode };
}
export async function replayLesson(proposalId, observation, root = LEARNING_HOME) {
  matches(proposalId, HASH, "LG_PROPOSAL_ID_INVALID");
  const v = checkProposal(await boundedJson(join(proposalDir(root), proposalId + ".json")));
  if (v.id !== proposalId) throw new Error("LG_PROPOSAL_ID_MISMATCH");
  const capsules = await loadDir(capsuleDir(root), checkCapsule);
  qualifying(capsules, v.capsule_ids, v.signature);
  const actualSignature = failureSignature(observation);
  const matched = actualSignature === v.signature;
  return {
    status: matched ? "MATCH_STOP_RETRY_ADVISORY" : "NO_MATCH",
    proposal_id: proposalId, signature: actualSignature,
    simulated: true, enforced: false, grants: 0, github_writes: 0
  };
}
async function main(args) {
  const root = process.env.PHIBOT_LEARNING_HOME || LEARNING_HOME;
  const [cmd, a, b] = args;
  let result;
  if (cmd === "capture" && a && !b)
    result = await captureFailure(await boundedJson(a, 2048), root);
  else if (cmd === "list" && !a) result = await listFailures(root);
  else if (cmd === "propose" && a && !b) result = await proposeLesson(a, root);
  else if (cmd === "replay" && a && b && args.length === 3)
    result = await replayLesson(a, await boundedJson(b, 2048), root);
  else throw new Error("LG_USAGE_CAPTURE_LIST_PROPOSE_REPLAY");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    // Only fixed diagnostic codes, never caller-supplied data or raw file contents.
    const code = /^LG_[A-Z0-9_]+$/.test(error?.message || "")
      ? error.message : "LG_OPERATION_FAILED";
    process.stderr.write(code + "\n");
    process.exitCode = 1;
  });
}
