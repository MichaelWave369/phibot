#!/usr/bin/env node
/**
 * PHIBOT-31: explicit, read-only GitHub CI -> Learning Gate R2 bridge.
 * Real GitHub reads are head-SHA bound and independently re-read before
 * any optional local capture. Does not change the R1 capsule trust tier.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureFailure, LEARNING_HOME } from "./learning-gate.mjs";
import { preflightCI } from "./repo-ci-preflight.mjs";
import { classifyCheckEvidence } from "./repo-steward-verify.mjs";
import { githubClient } from "./repo-steward.mjs";
import { queuePolicy, validateQueueRequest } from "./work-queue.mjs";

const HEX40 = /^[a-f0-9]{40}$/;
const CHECK = /^[A-Za-z0-9_ .:/-]{1,100}$/;
const sha256 = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function deny(code) { throw new Error("LG_CI_" + code); }

export function parseCIBridgeArgs(argv) {
  const values = {};
  const flags = new Set(["--repo", "--pr", "--check", "--sha", "--capture"]);
  if (!Array.isArray(argv) || argv.length > 9) deny("ARGS_INVALID");
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flags.has(flag) || Object.hasOwn(values, flag)) deny("ARGS_INVALID");
    if (flag === "--capture") { values[flag] = true; continue; }
    const value = argv[++i];
    if (typeof value !== "string" || value.length > 180 || !value) deny("ARGS_INVALID");
    values[flag] = value;
  }
  const pr = values["--pr"];
  if (!values["--repo"] || !/^[1-9][0-9]{0,9}$/.test(pr || "") ||
      !CHECK.test(values["--check"] || "") ||
      !HEX40.test(values["--sha"] || ""))
    deny("ARGS_INVALID");
  return {
    repository: values["--repo"], prNumber: Number(pr),
    checkName: values["--check"], expectedSha: values["--sha"],
    capture: values["--capture"] === true
  };
}
function assertPreflight(first, args) {
  if (first?.status !== "READY_FOR_READ_ONLY_INSPECT_QUEUE" ||
      first.mode !== "READ_ONLY_NO_PROMOTION" ||
      first.headSha !== args.expectedSha ||
      first.checkStatus !== "CHECKS_FAILED" ||
      !Array.isArray(first.observedCheckNames) ||
      !first.observedCheckNames.includes(args.checkName) ||
      !Number.isSafeInteger(first.issueNumber) || first.issueNumber < 1 ||
      typeof first.target !== "string")
    deny("PREFLIGHT_REFUSED_OR_SHA_CHANGED");
  return {
    headSha: first.headSha, checkStatus: first.checkStatus,
    issueNumber: first.issueNumber, target: first.target,
    observedCheckNames: [...first.observedCheckNames].sort()
  };
}
/** Only GitHub GETs for this one allowlisted repository. */
function readOnly(reader, repository) {
  const prefix = "/repos/" + repository;
  return (method, path, data, optional) => {
    if (method !== "GET" || data !== undefined ||
        typeof path !== "string" ||
        !(path === prefix || path.startsWith(prefix + "/")))
      deny("READER_AUTHORITY_VIOLATION");
    return reader(method, path, undefined, optional);
  };
}
async function observeCheck(gh, args) {
  const base = "/repos/" + args.repository + "/commits/" + args.expectedSha;
  const [checkRuns, statuses] = await Promise.all([
    gh("GET", base + "/check-runs?per_page=100"),
    gh("GET", base + "/status?per_page=100")
  ]);
  const classified = classifyCheckEvidence(checkRuns, statuses, [args.checkName]);
  if (classified.status !== "CHECKS_FAILED" || !Array.isArray(classified.evidence))
    deny("CHECK_NOT_FAILED_OR_EVIDENCE_INCOMPLETE");
  const selected = classified.evidence.filter(item => item.name === args.checkName);
  // R2 deliberately accepts only a single, completed, failed *check run*,
  // not ambiguous duplicate names, pending checks, or commit-status aliases.
  if (selected.length !== 1 || selected[0].origin !== "check_run" ||
      selected[0].status !== "completed" || selected[0].conclusion !== "failure")
    deny("EXACT_FAILED_CHECK_REQUIRED");
  return {
    checkName: args.checkName, origin: "check_run",
    status: "completed", conclusion: "failure",
    classifiedStatus: classified.status
  };
}
export async function runCIBridge({
  argv = [], env = process.env, gh, root, save = captureFailure,
  preflight = preflightCI
} = {}) {
  const args = parseCIBridgeArgs(argv);
  const policy = queuePolicy(env);
  const input = {
    repository: args.repository, prNumber: args.prNumber,
    requiredChecks: [args.checkName]
  };
  validateQueueRequest("repo.steward.inspect", input, policy);
  const token = env.PHIBOT_GITHUB_TOKEN || env.GH_TOKEN;
  if (!gh && !token) deny("READ_ONLY_TOKEN_REQUIRED");
  const reader = readOnly(gh ?? githubClient(token), args.repository);
  const first = assertPreflight(await preflight({ gh: reader, input, policy }), args);
  const checkOne = await observeCheck(reader, args);
  // Revalidate PR eligibility and exact commit/check after the first observation.
  const second = assertPreflight(await preflight({ gh: reader, input, policy }), args);
  const checkTwo = await observeCheck(reader, args);
  if (JSON.stringify(first) !== JSON.stringify(second) ||
      JSON.stringify(checkOne) !== JSON.stringify(checkTwo))
    deny("REMOTE_STATE_CHANGED");
  const evidence = {
    schema: "phibot.learning.github-ci-read.v1", repo: args.repository,
    pr: args.prNumber, expected_sha: args.expectedSha,
    preflight: second, check: checkTwo
  };
  const observation = {
    repo: args.repository,
    run_id: "ci-pr" + args.prNumber + "-" + args.expectedSha,
    source_sha: args.expectedSha,
    layer: "LOOP", failure_class: "FAILED_GATE",
    task_kind: "repo.steward.inspect",
    check_id: "CI_" + sha256(args.checkName).slice(0, 24).toUpperCase(),
    expected_code: "CHECKS_PASS_REVIEW_ONLY",
    observed_code: "CHECKS_FAILED",
    evidence_sha256: sha256(evidence)
  };
  const common = {
    schema: "phibot.learning.ci.bridge.v1",
    status: args.capture ? "LOCAL_CAPTURE_REQUESTED" : "REVIEW_ONLY_PREVIEW",
    repo: args.repository, pr: args.prNumber, source_sha: args.expectedSha,
    check: args.checkName, evidence_sha256: observation.evidence_sha256,
    source: "RECHECKED_GITHUB_API_READ_NOT_INDEPENDENT_ATTESTATION",
    grants: 0, remote_writes: 0, retry_enforcement: false
  };
  if (!args.capture) return { ...common, observation };
  const saved = await save(observation, root ?? env.PHIBOT_LEARNING_HOME ?? LEARNING_HOME);
  return {
    ...common, status: "LOCAL_FAILURE_CAPSULE_SAVED",
    capsule_id: saved.capsule_id, signature: saved.signature,
    save_status: saved.status, capsule_mode: saved.mode,
    warning: "CAPSULE_IS_R1_LOCAL_SELF_REPORT_NO_PROVENANCE_PROMOTION"
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCIBridge({ argv: process.argv.slice(2) }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }).catch(error => {
    const code = typeof error?.message === "string" &&
      /^(LG_CI_|QUEUE_)/.test(error.message)
      ? error.message : "LG_CI_READ_REFUSED";
    process.stderr.write("Learning CI bridge refused: " + code + "\n");
    process.exitCode = 1;
  });
}
