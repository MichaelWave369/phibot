#!/usr/bin/env node
/**
 * PHIBOT-19: Read-only GitHub check evidence for Repo Steward draft PRs.
 * Never marks a PR ready, merges, deploys or executes repo code.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  githubClient, receipt, eligibleIssue, parseIssueTarget
} from "./repo-steward.mjs";

const OWNER = process.env.PHIBOT_OWNER || "MichaelWave369";
const MAX_REPOS = 30;
const MAX_PRS = 100;

export function parseVerificationPolicy(env = process.env) {
  const token = env.PHIBOT_GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) throw new Error("Verification requires a GitHub token scoped to selected repositories");
  const owner = env.PHIBOT_OWNER || "MichaelWave369";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) throw new Error("Invalid repository owner");
  const repos = (env.PHIBOT_REPO_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!repos.length || repos.length > MAX_REPOS || new Set(repos).size !== repos.length ||
      repos.some(name => !new RegExp("^" + owner + "/[A-Za-z0-9_.-]{1,100}$", "i").test(name))) {
    throw new Error("Verification requires 1..30 unique owner-scoped allowlisted repositories");
  }
  const required = (env.PHIBOT_REQUIRED_CHECKS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!required.length || required.length > 20 || new Set(required).size !== required.length ||
      required.some(s => !/^[A-Za-z0-9_ .:/-]{1,100}$/.test(s))) {
    throw new Error("Set PHIBOT_REQUIRED_CHECKS to 1..20 exact named CI checks");
  }
  return { token, owner, repos, required };
}

function latestByName(items, nameField, stampField) {
  const sorted = [...items].sort((a, b) => {
    const first = Number(a[stampField]) || 0;
    const second = Number(b[stampField]) || 0;
    return second - first;
  });
  const found = new Map();
  for (const item of sorted) {
    const name = item?.[nameField];
    if (typeof name === "string" && name && !found.has(name)) found.set(name, item);
  }
  return found;
}

export function classifyCheckEvidence(checkRunResponse, statusResponse, required) {
  if (!Array.isArray(required) || required.length === 0)
    return { status: "CHECK_POLICY_MISSING", required: [], missing: [] };
  const runs = checkRunResponse?.check_runs, statuses = statusResponse?.statuses;
  if (!Array.isArray(runs) || !Array.isArray(statuses) ||
      !Number.isInteger(checkRunResponse.total_count) ||
      !Number.isInteger(statusResponse.total_count)) {
    return { status: "CHECK_DATA_INVALID", required, missing: [] };
  }
  if (runs.length > 100 || checkRunResponse.total_count > runs.length ||
      statusResponse.total_count > statuses.length) {
    return { status: "CHECK_DATA_TRUNCATED", required, missing: [] };
  }
  const byRun = latestByName(runs, "name", "id");
  const byStatus = new Map();
  // GitHub's combined status endpoint returns contexts newest-first.
  for (const state of statuses) {
    if (typeof state?.context === "string" && !byStatus.has(state.context))
      byStatus.set(state.context, state);
  }
  const missing = required.filter(name => !byRun.has(name) && !byStatus.has(name));
  const evidence = [
    ...[...byRun].map(([name, run]) => ({
      name, origin: "check_run", status: run.status,
      conclusion: run.conclusion
    })),
    ...[...byStatus].map(([name, item]) => ({
      name, origin: "commit_status", status: item.state
    }))
  ];
  if (missing.length)
    return { status: "CHECKS_MISSING", required, missing, evidence };
  const failed = evidence.filter(e => e.origin === "check_run"
    ? (e.status === "completed" && e.conclusion !== "success")
    : (e.status === "failure" || e.status === "error"));
  if (failed.length)
    return { status: "CHECKS_FAILED", required, missing: [], evidence };
  const pending = evidence.filter(e => e.origin === "check_run"
    ? e.status !== "completed" : e.status !== "success");
  if (pending.length)
    return { status: "CHECKS_PENDING", required, missing: [], evidence };
  return { status: "CHECKS_PASS_REVIEW_ONLY", required, missing: [], evidence };
}

export function candidateIssueNumber(pr, repoName, defaultBranch) {
  if (!pr || pr.state !== "open" || pr.draft !== true ||
      !pr.title?.startsWith("PhiBot candidate: ") ||
      pr.base?.ref !== defaultBranch || pr.base?.repo?.full_name !== repoName ||
      pr.head?.repo?.full_name !== repoName ||
      !/^[0-9a-f]{40}$/i.test(pr.head?.sha || "")) return null;
  const match = /^phibot\/issue-([1-9][0-9]*)$/.exec(pr.head?.ref || "");
  if (!match || !pr.body?.includes("Autonomous local-model candidate for #" + match[1] + "\n"))
    return null;
  const target = parseIssueTarget(pr.body);
  return target ? { number: Number(match[1]), target } : null;
}

export async function verifyCandidates(gh, policy) {
  const repos = [];
  for (const repoName of policy.repos) {
    const repoResult = { repository: repoName, candidates: [] };
    repos.push(repoResult);
    try {
      const metadata = await gh("GET", "/repos/" + repoName);
      if (metadata?.full_name !== repoName || metadata.archived || metadata.disabled ||
          metadata.owner?.login?.toLowerCase() !== policy.owner.toLowerCase()) {
        repoResult.error = "REPO_IDENTITY_OR_STATE_INVALID";
        continue;
      }
      const baseName = metadata.default_branch;
      if (typeof baseName !== "string" || !baseName) {
        repoResult.error = "DEFAULT_BRANCH_UNAVAILABLE";
        continue;
      }
      const pulls = await gh("GET", "/repos/" + repoName + "/pulls?state=open&per_page=100");
      if (!Array.isArray(pulls) || pulls.length === MAX_PRS) {
        repoResult.error = "PR_INVENTORY_INCOMPLETE";
        continue;
      }
      for (const pr of pulls) {
        if (!/^phibot\/issue-/.test(pr?.head?.ref || "")) continue;
        const bound = candidateIssueNumber(pr, repoName, baseName);
        const item = { pr: pr.number, url: pr.html_url, headSha: pr.head?.sha };
        repoResult.candidates.push(item);
        if (!bound) {
          item.status = "PR_OUT_OF_SCOPE";
          continue;
        }
        try {
          const prefix = "/repos/" + repoName;
          const issue = await gh("GET", prefix + "/issues/" + bound.number);
          if (!eligibleIssue(issue) || parseIssueTarget(issue.body) !== bound.target) {
            item.status = "ISSUE_AUTHORIZATION_REVOKED";
            continue;
          }
          const sha = pr.head.sha;
          const checks = await gh("GET", prefix + "/commits/" + sha + "/check-runs?per_page=100");
          const statuses = await gh("GET", prefix + "/commits/" + sha + "/status?per_page=100");
          const evaluation = classifyCheckEvidence(checks, statuses, policy.required);
          item.checkStatus = evaluation.status;
          item.missing = evaluation.missing;
          item.evidence = evaluation.evidence || [];
          const compare = await gh("GET", prefix + "/compare/" + encodeURIComponent(baseName) + "..." + sha);
          const latest = await gh("GET", prefix + "/pulls/" + pr.number);
          const stillBound = candidateIssueNumber(latest, repoName, baseName);
          if (!stillBound || latest.head.sha !== sha || stillBound.number !== bound.number ||
              stillBound.target !== bound.target) {
            item.status = "PR_CHANGED_OR_NO_LONGER_ELIGIBLE";
          } else if (compare?.behind_by !== 0) {
            item.status = "BASE_BEHIND_OR_UNVERIFIED";
          } else if (latest.mergeable !== true) {
            item.status = "PR_MERGEABILITY_NOT_CONFIRMED";
          } else {
            item.status = evaluation.status;
          }
        } catch (error) {
          item.status = "EVIDENCE_READ_ERROR";
          item.error = error instanceof Error ? error.message : "unknown read error";
        }
      }
    } catch (error) {
      repoResult.error = error instanceof Error ? error.message : "unknown repository error";
    }
  }
  return { schema: "phibot.repo-verification.v1", observedAt: new Date().toISOString(),
    mode: "READ_ONLY_NO_PROMOTION", repositories: repos };
}

export async function main() {
  const policy = parseVerificationPolicy();
  const gh = githubClient(policy.token);
  const results = await verifyCandidates(gh, policy);
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  await receipt({
    status: "CI_EVIDENCE_OBSERVED_NO_PROMOTION",
    repositories: results.repositories.length,
    candidates: results.repositories.reduce((n, repo) => n + repo.candidates.length, 0),
    passedChecksOnly: results.repositories.reduce((n, repo) =>
      n + repo.candidates.filter(pr => pr.status === "CHECKS_PASS_REVIEW_ONLY").length, 0)
  });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write("PhiBot verification refused: " +
      (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  });
}
