import type { ToolCapability } from "./types.js";
import type { ToolCapabilityRegistry } from "./registry.js";

/** PHIBOT-23: one exact-SHA, always-gated repair commit to an existing draft PR.
 * The human approval is mandatory; model review is advisory, not authority.
 * Never opens a new PR, merges, dispatches CI, executes target code or deploys.
 */
export interface GovernedRepairOptions {
  owner?: string;
  allowlist?: string[];
  requiredChecks?: string[];
  token?: string;
  writeEnabled?: boolean;
  fetchImpl?: typeof fetch;
}

export interface GovernedRepairInput {
  repository: string;
  prNumber: number;
  issueNumber: number;
  target: string;
  expectedHeadSha: string;
  expectedBlobSha: string;
  replacement: string;
  summary: string;
}

export interface GovernedRepairOutput {
  status: "REPAIR_COMMIT_PUSHED_CI_UNVERIFIED";
  repository: string;
  prNumber: number;
  issueNumber: number;
  target: string;
  oldHeadSha: string;
  newHeadSha: string;
}

const REPAIR_MARKER = "phibot: governed repair PR#";
const LEGACY_MARKER = "phibot: repair-once pr#";

function obj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}
function repoName(value: unknown, owner: string): value is string {
  if (typeof value !== "string") return false;
  const match = /^([a-z0-9-]{1,39})\/([a-z0-9_.-]{1,100})$/i.exec(value);
  return !!match && match[1]?.toLowerCase() === owner.toLowerCase() &&
    match[2] !== "." && match[2] !== "..";
}
export function repairTarget(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 180 ||
      !/^(?:src|test)\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|js|mjs|css)$/.test(value)) return false;
  if (value.split("/").some(p => !p || p === "." || p === "..")) return false;
  return !/(?:^|\/)(?:\.|auth|secrets?|credentials?|security|gate|authority|vendor|dist|node_modules|config|infra|deploy)(?:[-_.\/]|$)/i.test(value);
}
function issueTarget(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const matches = [...body.matchAll(/^\s*Target file:\s*[\x60]?([^\s\x60]+)[\x60]?\s*$/gim)];
  const target = matches.length === 1 ? matches[0]?.[1] : undefined;
  return repairTarget(target) ? target : null;
}
function authorizedIssue(issue: unknown, target: string): boolean {
  return obj(issue) && issue.state === "open" && !issue.pull_request &&
    Array.isArray(issue.labels) && issue.labels.some(label =>
      (typeof label === "string" ? label : obj(label) ? label.name : null) === "phibot-ready") &&
    issueTarget(issue.body) === target;
}
export function boundedRepair(before: string, after: string): boolean {
  if (!before || before === after || !after?.trim() || after.includes("\0") ||
      Buffer.byteLength(after, "utf8") > 12000 ||
      Math.abs(before.length - after.length) > 1800 ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[a-z0-9_]+|ghp_[a-z0-9]{20,}|sk-[a-z0-9]{25,}/i.test(after)) return false;
  const a = before.split("\n"), b = after.split("\n");
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return Math.max(a.length - prefix - suffix, b.length - prefix - suffix) <= 48 &&
    b.length >= Math.floor(a.length * 0.7);
}
export function validateRepairInput(value: unknown, owner: string,
  allowlist: ReadonlySet<string>): GovernedRepairInput {
  const keys = ["repository", "prNumber", "issueNumber", "target", "expectedHeadSha",
    "expectedBlobSha", "replacement", "summary"];
  if (!obj(value) || Object.keys(value).length !== keys.length ||
      keys.some(k => !Object.hasOwn(value, k)) ||
      !repoName(value.repository, owner) || !allowlist.has(value.repository) ||
      !Number.isSafeInteger(value.prNumber) || (value.prNumber as number) < 1 ||
      !Number.isSafeInteger(value.issueNumber) || (value.issueNumber as number) < 1 ||
      !repairTarget(value.target) || !sha(value.expectedHeadSha) ||
      !sha(value.expectedBlobSha) || typeof value.replacement !== "string" ||
      Buffer.byteLength(value.replacement, "utf8") > 12000 ||
      typeof value.summary !== "string" || value.summary.trim().length < 12 ||
      value.summary.length > 140 || /[\r\n\0]/.test(value.summary)) {
    throw new Error("Governed repair input denied: exact repo, PR, issue, source path, SHAs and bounded content required");
  }
  return value as unknown as GovernedRepairInput;
}

export function failedCiEvidence(checks: unknown, statuses: unknown, required: string[]): boolean {
  if (!required.length || !obj(checks) || !obj(statuses) ||
      !Array.isArray(checks.check_runs) || !Array.isArray(statuses.statuses) ||
      !Number.isInteger(checks.total_count) || !Number.isInteger(statuses.total_count) ||
      checks.check_runs.length >= 100 || statuses.statuses.length >= 100 ||
      (checks.total_count as number) > checks.check_runs.length ||
      (statuses.total_count as number) > statuses.statuses.length) return false;
  const seen = new Map<string, "success" | "failure" | "pending">();
  for (const check of [...checks.check_runs].sort((a, b) => Number(b?.id ?? 0) - Number(a?.id ?? 0))) {
    if (!obj(check) || typeof check.name !== "string" || seen.has("check:" + check.name)) continue;
    const state = check.status === "completed"
      ? check.conclusion === "success" ? "success" :
        check.conclusion === "failure" || check.conclusion === "timed_out" ? "failure" : "pending"
      : "pending";
    seen.set("check:" + check.name, state);
  }
  for (const status of statuses.statuses) {
    if (!obj(status) || typeof status.context !== "string" ||
        seen.has("status:" + status.context)) continue;
    const state = status.state === "success" ? "success" :
      ["error", "failure"].includes(String(status.state)) ? "failure" : "pending";
    seen.set("status:" + status.context, state);
  }
  return required.every(name => seen.has("check:" + name) || seen.has("status:" + name)) &&
    [...seen.values()].includes("failure") &&
    ![...seen.values()].includes("pending");
}

export function registerGovernedRepairTool(registry: ToolCapabilityRegistry,
  options: GovernedRepairOptions = {}): ToolCapabilityRegistry {
  const owner = options.owner ?? process.env.PHIBOT_OWNER ?? "MichaelWave369";
  if (!/^[a-z0-9-]{1,39}$/i.test(owner)) throw new Error("Invalid governed repair owner");
  const allowlist = options.allowlist ?? (process.env.PHIBOT_REPO_ALLOWLIST ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (allowlist.length > 30 || new Set(allowlist).size !== allowlist.length ||
      allowlist.some(r => !repoName(r, owner))) throw new Error("Invalid governed repair repo allowlist");
  const allowed = new Set(allowlist);
  const required = options.requiredChecks ?? (process.env.PHIBOT_REQUIRED_CHECKS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (required.length > 20 || new Set(required).size !== required.length ||
      required.some(s => !/^[a-zA-Z0-9_ .:/-]{1,100}$/.test(s)))
    throw new Error("Invalid PHIBOT_REQUIRED_CHECKS configuration");
  const token = options.token ?? process.env.PHIBOT_GITHUB_TOKEN ?? "";
  const enabled = options.writeEnabled ?? process.env.PHIBOT_ENABLE_GOVERNED_REPAIR === "1";
  const transport = options.fetchImpl ?? fetch;

  async function gh(method: "GET" | "PUT", path: string, signal: AbortSignal,
    data?: Record<string, unknown>): Promise<unknown> {
    const response = await transport("https://api.github.com" + path, {
      method, signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "PhiBot-Governed-Repair/0.1",
        authorization: "Bearer " + token,
        ...(data ? { "content-type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok) throw new Error("Governed repair " + method + " HTTP " + response.status);
    return response.json() as Promise<unknown>;
  }

  const capability: ToolCapability<GovernedRepairInput, GovernedRepairOutput> = {
    id: "repo.steward.repair",
    description: "Apply one manually granted code repair to an existing, failed-CI, authorized draft PR.",
    actionClass: "write",
    external: true,
    requiresGate: true,
    validate(input: unknown) { return validateRepairInput(input, owner, allowed); },
    async execute(input, context) {
      if (!enabled || !token) throw new Error("Governed repair writes disabled or token missing");
      if (!required.length) throw new Error("PHIBOT_REQUIRED_CHECKS must name mandatory CI checks");
      const prefix = "/repos/" + input.repository;
      const repo = await gh("GET", prefix, context.signal);
      if (!obj(repo) || repo.full_name !== input.repository || repo.archived || repo.disabled ||
          repo.fork || !obj(repo.owner) || String(repo.owner.login).toLowerCase() !== owner.toLowerCase() ||
          typeof repo.default_branch !== "string")
        throw new Error("Repository identity invalid");
      const base = repo.default_branch;
      const prPath = prefix + "/pulls/" + input.prNumber;
      const issuePath = prefix + "/issues/" + input.issueNumber;
      const pr = await gh("GET", prPath, context.signal);
      function draftBound(value: unknown): boolean {
        if (!obj(value) || value.number !== input.prNumber || value.state !== "open" ||
            value.draft !== true || value.mergeable !== true ||
            typeof value.title !== "string" || !value.title.startsWith("PhiBot candidate: ") ||
            !obj(value.head) || !obj(value.base) || !obj(value.head.repo) || !obj(value.base.repo) ||
            value.head.sha !== input.expectedHeadSha ||
            value.head.ref !== "phibot/issue-" + input.issueNumber ||
            value.head.repo.full_name !== input.repository || value.base.repo.full_name !== input.repository ||
            value.base.ref !== base || typeof value.body !== "string" ||
            !value.body.includes("Autonomous local-model candidate for #" + input.issueNumber + "\n") ||
            issueTarget(value.body) !== input.target) return false;
        return true;
      }
      if (!draftBound(pr)) throw new Error("Draft PR scope, head SHA or issue binding changed");
      const issue = await gh("GET", issuePath, context.signal);
      if (!authorizedIssue(issue, input.target)) throw new Error("Issue authorization missing or revoked");
      const files = await gh("GET", prPath + "/files?per_page=100", context.signal);
      if (!Array.isArray(files) || files.length !== 1 || !obj(files[0]) ||
          files[0].filename !== input.target || files[0].status !== "modified")
        throw new Error("Repair limited to PRs with exactly one modified authorized file");
      const commits = await gh("GET", prPath + "/commits?per_page=100", context.signal);
      if (!Array.isArray(commits) || commits.length >= 100 || commits.length === 0 ||
          commits.some(c => obj(c) && obj(c.commit) && typeof c.commit.message === "string" &&
            (c.commit.message.startsWith(REPAIR_MARKER) || c.commit.message.startsWith(LEGACY_MARKER))))
        throw new Error("Previous repair detected or PR commit history incomplete");
      const shaBefore = input.expectedHeadSha;
      const [checks, statuses, compare, content] = await Promise.all([
        gh("GET", prefix + "/commits/" + shaBefore + "/check-runs?per_page=100", context.signal),
        gh("GET", prefix + "/commits/" + shaBefore + "/status?per_page=100", context.signal),
        gh("GET", prefix + "/compare/" + encodeURIComponent(base) + "..." + shaBefore, context.signal),
        gh("GET", prefix + "/contents/" + input.target + "?ref=" + shaBefore, context.signal),
      ]);
      if (!failedCiEvidence(checks, statuses, required) ||
          !obj(compare) || compare.behind_by !== 0)
        throw new Error("CI is missing, pending, not failed, truncated or base became stale");
      if (!obj(content) || content.type !== "file" || content.encoding !== "base64" ||
          content.sha !== input.expectedBlobSha || typeof content.content !== "string" ||
          content.content.length > 20000)
        throw new Error("Target blob unavailable or changed");
      const before = Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8");
      if (!boundedRepair(before, input.replacement)) throw new Error("Repair candidate exceeds one-file bounds");

      // Last remote check: no stale/revoked permission and no other branch edits.
      const [freshPr, freshIssue, branch, freshCommits] = await Promise.all([
        gh("GET", prPath, context.signal),
        gh("GET", issuePath, context.signal),
        gh("GET", prefix + "/git/ref/heads/" + encodeURIComponent("phibot/issue-" + input.issueNumber),
          context.signal),
        gh("GET", prPath + "/commits?per_page=100", context.signal),
      ]);
      if (!draftBound(freshPr) || !authorizedIssue(freshIssue, input.target) ||
          !obj(branch) || !obj(branch.object) || branch.object.sha !== shaBefore ||
          !Array.isArray(freshCommits) || freshCommits.length !== commits.length ||
          freshCommits.length >= 100 ||
          freshCommits.some(c => obj(c) && obj(c.commit) && typeof c.commit.message === "string" &&
            (c.commit.message.startsWith(REPAIR_MARKER) || c.commit.message.startsWith(LEGACY_MARKER))))
        throw new Error("PR, permission, branch or repair history changed before write");
      const written = await gh("PUT", prefix + "/contents/" + input.target, context.signal, {
        message: REPAIR_MARKER + input.prNumber + " - " + input.summary,
        content: Buffer.from(input.replacement, "utf8").toString("base64"),
        sha: input.expectedBlobSha,
        branch: "phibot/issue-" + input.issueNumber,
      });
      if (!obj(written) || !obj(written.commit) || !sha(written.commit.sha))
        throw new Error("Write result ambiguous: inspect branch manually, never retry blindly");
      return { status: "REPAIR_COMMIT_PUSHED_CI_UNVERIFIED", repository: input.repository,
        prNumber: input.prNumber, issueNumber: input.issueNumber, target: input.target,
        oldHeadSha: shaBefore, newHeadSha: written.commit.sha };
    },
  };
  return registry.register(capability);
}
