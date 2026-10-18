#!/usr/bin/env node
/**
 * PHIBOT-29: read-only eligibility and CI-context preflight before a
 * human explicitly queues one real CI Inspector observation.
 * No model, target-code execution, GitHub mutation, grant or auto queueing.
 * Only the --enqueue option persists a local READ job.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { enqueue, queuePolicy, validateQueueRequest } from "./work-queue.mjs";
import { githubClient, eligibleIssue, parseIssueTarget } from "./repo-steward.mjs";
import { classifyCheckEvidence } from "./repo-steward-verify.mjs";

const sha40 = /^[a-f0-9]{40}$/i;
const exactRepo = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const checkState = new Set(["CHECKS_FAILED", "CHECKS_PENDING", "CHECKS_PASS_REVIEW_ONLY"]);

export function parsePreflightArgs(argv = []) {
  const allowed = new Set(["--repo", "--pr", "--checks", "--enqueue"]);
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!allowed.has(flag) || flag in values)
      throw new Error("PREFLIGHT_ARGUMENT_INVALID");
    if (flag === "--enqueue") { values[flag] = true; continue; }
    const raw = argv[++i];
    if (!raw || raw.startsWith("--") || raw.length > 300)
      throw new Error("PREFLIGHT_ARGUMENT_INVALID");
    values[flag] = raw;
  }
  if (typeof values["--repo"] !== "string" ||
      typeof values["--pr"] !== "string" ||
      typeof values["--checks"] !== "string" ||
      !/^[1-9][0-9]{0,9}$/.test(values["--pr"]))
    throw new Error("PREFLIGHT_ARGUMENT_INVALID");
  return {
    repository: values["--repo"],
    prNumber: Number(values["--pr"]),
    requiredChecks: values["--checks"].split(",").map(v => v.trim()),
    enqueue: values["--enqueue"] === true,
  };
}
const report = (input, status, extra = {}) => ({
  schema: "phibot.ci.preflight.v1", status,
  mode: "READ_ONLY_NO_PROMOTION",
  repository: input.repository, prNumber: input.prNumber,
  requiredChecks: input.requiredChecks, ...extra,
});

function prIdentity(pr, input, defaultBranch) {
  if (pr?.state !== "open" || pr.draft !== true ||
      typeof pr.title !== "string" || !pr.title.startsWith("PhiBot candidate: "))
    return null;
  if (pr.base?.ref !== defaultBranch ||
      pr.base?.repo?.full_name !== input.repository ||
      pr.head?.repo?.full_name !== input.repository ||
      typeof pr.head?.ref !== "string" || !sha40.test(pr.head?.sha || "") ||
      typeof pr.body !== "string")
    return null;
  const match = /^phibot\/issue-([1-9][0-9]*)$/.exec(pr.head.ref);
  if (!match) return null;
  const target = parseIssueTarget(pr.body);
  if (!target ||
      !pr.body.includes("Autonomous local-model candidate for #" + match[1] + "\n"))
    return null;
  return { issueNumber: Number(match[1]), target,
    headSha: pr.head.sha, branch: pr.head.ref, body: pr.body };
}

/** Remote transport is injected in tests; production uses GitHub GETs only. */
export async function preflightCI({ gh, input, policy }) {
  validateQueueRequest("repo.steward.inspect", input, policy);
  if (typeof gh !== "function") throw new Error("PREFLIGHT_READER_REQUIRED");
  const prefix = "/repos/" + input.repository;
  const meta = await gh("GET", prefix);
  if (meta?.full_name !== input.repository ||
      meta.owner?.login?.toLowerCase() !== policy.owner.toLowerCase() ||
      meta.archived || meta.disabled || meta.fork ||
      typeof meta.default_branch !== "string" ||
      meta.default_branch.length < 1 || meta.default_branch.length > 100)
    return report(input, "REPOSITORY_IDENTITY_INVALID");

  const path = prefix + "/pulls/" + input.prNumber;
  const first = await gh("GET", path, undefined, true);
  if (!first) return report(input, "PR_NOT_FOUND");
  const original = prIdentity(first, input, meta.default_branch);
  if (!original) return report(input, "PR_NOT_ELIGIBLE_PHIBOT_DRAFT");

  const issue = await gh("GET", prefix + "/issues/" + original.issueNumber, undefined, true);
  if (!eligibleIssue(issue) || parseIssueTarget(issue?.body) !== original.target)
    return report(input, "ISSUE_AUTHORIZATION_NOT_PRESENT",
      { headSha: original.headSha });

  const sha = original.headSha;
  const [checks, statuses, compare] = await Promise.all([
    gh("GET", prefix + "/commits/" + sha + "/check-runs?per_page=100"),
    gh("GET", prefix + "/commits/" + sha + "/status?per_page=100"),
    gh("GET", prefix + "/compare/" + encodeURIComponent(meta.default_branch) + "..." + sha),
  ]);
  const ci = classifyCheckEvidence(checks, statuses, input.requiredChecks);
  const fresh = await gh("GET", path);
  const latest = prIdentity(fresh, input, meta.default_branch);
  if (!latest || latest.headSha !== sha || latest.branch !== original.branch ||
      latest.body !== original.body || latest.issueNumber !== original.issueNumber ||
      latest.target !== original.target)
    return report(input, "PR_CHANGED_DURING_PREFLIGHT", { headSha: sha });
  if (!compare || !Number.isSafeInteger(compare.behind_by) ||
      compare.behind_by !== 0)
    return report(input, "PR_BASE_BEHIND_OR_UNVERIFIED", { headSha: sha });
  if (fresh.mergeable !== true)
    return report(input, "PR_MERGEABILITY_NOT_CONFIRMED", { headSha: sha });
  if (!checkState.has(ci.status))
    return report(input,
      ci.status === "CHECKS_MISSING" ? "REQUIRED_CHECKS_MISSING" : "CHECK_DATA_UNQUALIFIED",
      { headSha: sha, checkStatus: ci.status,
        missingChecks: ci.missing?.filter(x => input.requiredChecks.includes(x)) ?? [] });

  return report(input, "READY_FOR_READ_ONLY_INSPECT_QUEUE", {
    headSha: sha, issueNumber: original.issueNumber, target: original.target,
    checkStatus: ci.status,
    observedCheckNames: ci.evidence?.map(e => e.name)
      .filter(n => input.requiredChecks.includes(n)).sort() ?? [],
    warning: "PRELIMINARY_REMOTE_READ_RECHECKED_BY_INSPECTOR",
  });
}

export async function runPreflight({ argv, env = process.env, gh, dir,
  record = enqueue } = {}) {
  const args = parsePreflightArgs(argv);
  const policy = queuePolicy(env);
  if (!exactRepo.test(args.repository)) throw new Error("PREFLIGHT_REPO_INVALID");
  const input = { repository: args.repository, prNumber: args.prNumber,
    requiredChecks: args.requiredChecks };
  validateQueueRequest("repo.steward.inspect", input, policy);
  if (!(env.PHIBOT_GITHUB_TOKEN || env.GH_TOKEN) && !gh)
    throw new Error("PREFLIGHT_READ_ONLY_GITHUB_TOKEN_REQUIRED");
  const outcome = await preflightCI({
    gh: gh ?? githubClient(env.PHIBOT_GITHUB_TOKEN || env.GH_TOKEN),
    input, policy,
  });
  if (!args.enqueue || outcome.status !== "READY_FOR_READ_ONLY_INSPECT_QUEUE")
    return { ...outcome, localEnqueue: "NOT_REQUESTED_OR_NOT_ELIGIBLE" };
  const queued = await record({
    capability: "repo.steward.inspect", input,
  }, policy, dir);
  return { ...outcome, localEnqueue: queued.status,
    queuedJobId: queued.id, postQueueWarning: "RECHECK_LIVE_SHA_ON_RUN_ONCE" };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runPreflight({ argv });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const safe = typeof error?.message === "string" &&
      /^(PREFLIGHT_|QUEUE_)/.test(error.message)
      ? error.message : "PREFLIGHT_READ_REFUSED";
    process.stderr.write("PhiBot CI preflight refused: " + safe + "\n");
    process.exitCode = 1;
  });
}
