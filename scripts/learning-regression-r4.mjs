#!/usr/bin/env node
/**
 * PHIBOT-33 Learning Gate R4: deterministic metamorphic regression evaluation
 * and offline human-only PhiOS governance *request* export.
 * No GitHub, model, remote transport, policy write or authority grant.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEARNING_HOME, failureSignature, validateObservation } from "./learning-gate.mjs";
import { validateAudit } from "./learning-review-r3.mjs";

const HEX = /^[a-f0-9]{64}$/;
const DAY = 86400000;
const MAX_AUDIT_AGE = 14 * DAY;
const HANDOFF_TTL = 7 * DAY;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const deny = code => { throw new Error("LG_R4_" + code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function exact(value, names) {
  if (!object(value) || Object.keys(value).sort().join("|") !== [...names].sort().join("|"))
    deny("INVALID_KEYS");
}
const SCENARIOS = new Map([
  ["SAME_SIGNATURE_NEW_RUN", true],
  ["SAME_SIGNATURE_NEW_SHA", true],
  ["SAME_SIGNATURE_NEW_EVIDENCE", true],
  ["OTHER_REPOSITORY", false],
  ["OTHER_CHECK", false],
  ["OTHER_FAILURE_CODE", false],
  ["OTHER_LAYER", false],
  ["OTHER_TASK_KIND", false]
]);

async function boundedJson(path, max = 8192) {
  const st = await lstat(path);
  if (!st.isFile() || st.size < 2 || st.size > max) deny("SOURCE_SIZE_OR_TYPE_INVALID");
  const data = await readFile(path);
  if (data.length > max) deny("SOURCE_CHANGED");
  try { return JSON.parse(data.toString("utf8")); }
  catch { deny("SOURCE_JSON_INVALID"); }
}
function auditFile(root, id) { return join(resolve(root), "r3", "audits", id + ".json"); }
function proposalFile(root, id) {
  return join(resolve(root), "r3", "review-proposals", id + ".json");
}
function handoffFile(root, id) {
  return join(resolve(root), "r4", "handoffs", id + ".json");
}
function timeMs(now) {
  const ms = now();
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8640000000000000)
    deny("CLOCK_INVALID");
  return ms;
}
function ageGate(audit, ms) {
  const age = ms - Date.parse(audit.observed_at);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AUDIT_AGE)
    deny("AUDIT_STALE_OR_FUTURE");
}
function expectedReviewPayload(record) {
  return {
    schema: "phibot.learning.review.proposal.v1",
    mode: "HUMAN_REVIEW_REQUIRED_NO_EXECUTION",
    source_trust: "SAME_PROVIDER_CORROBORATED_UNSIGNED",
    repo: record.repo, signature: record.signature,
    check_name: record.check_name, audit_ids: record.audit_ids,
    action: "CONSIDER_STOP_RETRY_ADVISORY",
    promoted: false, policy_writes: 0, grants: 0,
    reverify_at_promotion: true
  };
}
export function validateReviewPacket(packet) {
  exact(packet, ["schema", "mode", "source_trust", "repo", "signature",
    "check_name", "audit_ids", "action", "promoted", "policy_writes",
    "grants", "reverify_at_promotion", "id"]);
  if (!HEX.test(packet.id || "") || !HEX.test(packet.signature || "") ||
      !Array.isArray(packet.audit_ids) || packet.audit_ids.length !== 2 ||
      packet.audit_ids.some(id => !HEX.test(id)) ||
      packet.audit_ids[0] >= packet.audit_ids[1])
    deny("PROPOSAL_IDENTITY_INVALID");
  const payload = expectedReviewPayload(packet);
  const expected = { ...payload, id: hash(payload) };
  if (JSON.stringify(packet) !== JSON.stringify(expected))
    deny("PROPOSAL_INTEGRITY_INVALID");
  return packet;
}
export async function readReviewPacket(id, root = LEARNING_HOME, now = Date.now) {
  if (!HEX.test(id || "")) deny("PROPOSAL_ID_INVALID");
  const packet = validateReviewPacket(await boundedJson(proposalFile(root, id), 4096));
  if (packet.id !== id) deny("PROPOSAL_FILE_ID_MISMATCH");
  const audits = [];
  for (const auditId of packet.audit_ids) {
    const audit = validateAudit(await boundedJson(auditFile(root, auditId), 4096));
    if (audit.id !== auditId) deny("AUDIT_FILE_ID_MISMATCH");
    audits.push(audit);
  }
  const [a, b] = audits;
  if (a.repo !== packet.repo || b.repo !== packet.repo ||
      a.signature !== packet.signature || b.signature !== packet.signature ||
      a.check_name !== packet.check_name || b.check_name !== packet.check_name ||
      a.source_sha === b.source_sha || a.proof.id === b.proof.id ||
      a.observation.run_id === b.observation.run_id)
    deny("AUDIT_SUPPORT_INVALID");
  const ms = timeMs(now);
  audits.forEach(audit => ageGate(audit, ms));
  return { packet, audits, time: ms };
}
export function validateFixtures(fixture) {
  exact(fixture, ["schema", "mode", "cases"]);
  if (fixture.schema !== "phibot.learning.regression.fixtures.v1" ||
      fixture.mode !== "METAMORPHIC_SYNTHETIC_NO_FIELD_ATTESTATION" ||
      !Array.isArray(fixture.cases) || fixture.cases.length !== SCENARIOS.size)
    deny("FIXTURE_CONTRACT_INVALID");
  const seenIds = new Set(), seenScenarios = new Set();
  for (const item of fixture.cases) {
    exact(item, ["id", "scenario", "expected_stop"]);
    if (typeof item.id !== "string" || !/^[a-z][a-z0-9_-]{2,39}$/.test(item.id) ||
        seenIds.has(item.id) || !SCENARIOS.has(item.scenario) ||
        seenScenarios.has(item.scenario) ||
        item.expected_stop !== SCENARIOS.get(item.scenario))
      deny("FIXTURE_CASE_INVALID");
    seenIds.add(item.id); seenScenarios.add(item.scenario);
  }
  return fixture;
}
function different(value, alternative) {
  if (value !== alternative) return alternative;
  return (alternative[0] === "c" ? "d" : "c").repeat(alternative.length);
}
export function makeSyntheticObservation(baseline, scenario, index) {
  const o = { ...validateObservation(baseline) };
  // Inputs are deterministic counterfactuals, not real independent CI records.
  o.run_id = "r4-fixture-" + index;
  switch (scenario) {
    case "SAME_SIGNATURE_NEW_RUN": break;
    case "SAME_SIGNATURE_NEW_SHA":
      o.source_sha = different(o.source_sha, "c".repeat(40)); break;
    case "SAME_SIGNATURE_NEW_EVIDENCE":
      o.evidence_sha256 = different(o.evidence_sha256, "d".repeat(64)); break;
    case "OTHER_REPOSITORY":
      o.repo = o.repo === "PhiFixture/Other" ? "PhiFixture/Alternate" : "PhiFixture/Other"; break;
    case "OTHER_CHECK":
      o.check_id = o.check_id === "CI_DIFFERENT" ? "CI_ANOTHER" : "CI_DIFFERENT"; break;
    case "OTHER_FAILURE_CODE":
      o.observed_code = o.observed_code === "CHECK_FAILED_DIFFERENT"
        ? "CHECK_FAILED_OTHER" : "CHECK_FAILED_DIFFERENT"; break;
    case "OTHER_LAYER": o.layer = o.layer === "GRAPH" ? "HARNESS" : "GRAPH"; break;
    case "OTHER_TASK_KIND": o.task_kind =
      o.task_kind === "fixture.other" ? "fixture.alternate" : "fixture.other"; break;
    default: deny("UNKNOWN_SCENARIO");
  }
  return validateObservation(o);
}
export function scoreRegressions(packet, audit, fixture, {
  predict = (sample, signature) => failureSignature(sample) === signature
} = {}) {
  validateReviewPacket(packet);
  validateFixtures(fixture);
  if (!audit || audit.signature !== packet.signature || audit.repo !== packet.repo)
    deny("EVALUATION_BASELINE_INVALID");
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const rows = [];
  fixture.cases.forEach((entry, index) => {
    const synthetic = makeSyntheticObservation(audit.observation, entry.scenario, index);
    const predicted = predict(synthetic, packet.signature);
    if (typeof predicted !== "boolean") deny("PREDICTION_INVALID");
    if (entry.expected_stop && predicted) tp++;
    else if (!entry.expected_stop && !predicted) tn++;
    else if (!entry.expected_stop && predicted) fp++;
    else fn++;
    rows.push({ id: entry.id, scenario: entry.scenario,
      expected_stop: entry.expected_stop, predicted_stop: predicted,
      pass: predicted === entry.expected_stop });
  });
  const metrics = {
    tested: rows.length, true_positive: tp, true_negative: tn,
    false_positive: fp, false_negative: fn,
    synthetic_false_positive_rate: fp / (fp + tn),
    synthetic_false_negative_rate: fn / (fn + tp)
  };
  return { status: fp === 0 && fn === 0 && tp >= 3 && tn >= 5
      ? "SYNTHETIC_REGRESSION_PASS" : "REGRESSION_BLOCKED",
    metrics, rows };
}
export async function evaluateR4(proposalId, fixturePath, {
  root = LEARNING_HOME, now = Date.now, predict
} = {}) {
  const { packet, audits, time } = await readReviewPacket(proposalId, root, now);
  const fixture = validateFixtures(await boundedJson(fixturePath, 8192));
  const scored = scoreRegressions(packet, audits[0], fixture,
    predict ? { predict } : {});
  return {
    schema: "phibot.learning.regression.evaluation.v1",
    status: scored.status, mode: "SIMULATED_REVIEW_ONLY",
    proposal_id: proposalId, signature: packet.signature,
    source_trust: "SAME_PROVIDER_CORROBORATED_UNSIGNED",
    fixture_digest: hash(fixture),
    evaluated_at: new Date(time).toISOString(),
    metrics: scored.metrics, cases: scored.rows,
    live_false_positive_rate: null,
    live_replay_verified: false,
    approved: false, enforced: false, grants: 0, policy_writes: 0
  };
}
function handoffPayload(result, issued) {
  return {
    schema: "phibot.learning.phios.review-request.v1",
    origin: "PHIBOT_R4_OFFLINE_REVIEW",
    destination: "PHIOS_REALITY_GATE_FUTURE_REVIEW_INBOX",
    mode: "UNTRUSTED_HUMAN_REVIEW_REQUEST_ONLY",
    proposal_id: result.proposal_id,
    signature: result.signature, source_trust: result.source_trust,
    fixture_digest: result.fixture_digest,
    metrics: result.metrics,
    regression_evaluation_digest: hash(result),
    requested_action: "REVIEW_STOP_RETRY_ADVISORY_ONLY",
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + HANDOFF_TTL).toISOString(),
    required_before_any_promotion: [
      "FRESH_REMOTE_CI_REVALIDATION", "INDEPENDENT_REAL_REGRESSION_EVIDENCE",
      "FALSE_POSITIVE_IMPACT_REVIEW", "HUMAN_EXPLICIT_APPROVAL",
      "SIGNED_REALITY_GATE_GRANT", "TESTED_ROLLBACK_PLAN"
    ],
    authority: { approved: false, executable: false, grants: 0,
      policy_writes: 0, github_writes: 0, merge: false, deploy: false }
  };
}
export async function exportR4(proposalId, fixturePath, opts = {}) {
  const root = opts.root ?? LEARNING_HOME;
  const now = opts.now ?? Date.now;
  // Recompute from local artifacts each invocation, not from user-provided score.
  const evaluation = await evaluateR4(proposalId, fixturePath,
    { root, now, predict: opts.predict });
  if (evaluation.status !== "SYNTHETIC_REGRESSION_PASS")
    deny("REGRESSION_NOT_QUALIFIED");
  const issued = new Date(evaluation.evaluated_at);
  const payload = handoffPayload(evaluation, issued);
  const packet = { ...payload, id: hash(payload) };
  const file = handoffFile(root, packet.id);
  await mkdir(resolve(file, ".."), { recursive: true, mode: 0o700 });
  let state = "CREATED";
  try {
    await writeFile(file, JSON.stringify(packet, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
    const existing = await boundedJson(file, 8192);
    if (JSON.stringify(existing) !== JSON.stringify(packet))
      deny("HANDOFF_TAMPER_OR_COLLISION");
    state = "EXISTS_IDENTICAL";
  }
  return { status: "OFFLINE_HANDOFF_FOR_HUMAN_REVIEW", save_status: state,
    handoff_id: packet.id, destination: packet.destination,
    approved: false, executable: false, grants: 0, policy_writes: 0 };
}
async function main(args) {
  if (args.length !== 3 || !["evaluate", "handoff"].includes(args[0]))
    deny("USAGE_EVALUATE_OR_HANDOFF");
  const root = process.env.PHIBOT_LEARNING_HOME || LEARNING_HOME;
  const [cmd, proposalId, fixturePath] = args;
  return cmd === "evaluate"
    ? evaluateR4(proposalId, fixturePath, { root })
    : exportR4(proposalId, fixturePath, { root });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(out => {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  }).catch(error => {
    const msg = /^(LG_R4_|LG_R3_|LG_)[A-Z0-9_]+$/.test(error?.message || "")
      ? error.message : "LG_R4_OPERATION_REFUSED";
    process.stderr.write(msg + "\n");
    process.exitCode = 1;
  });
}
