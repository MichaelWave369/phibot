import type { ToolCapability } from "./types.js";
import type { ToolCapabilityRegistry } from "./registry.js";

/**
 * PHIBOT-22. A narrow, always-gated write capability: one existing Markdown
 * file, one previously authorized issue, one new branch, and one draft PR.
 * It cannot merge, dispatch workflows, edit code/config, or deploy.
 */
export interface GovernedDraftOptions {
  owner?: string;
  allowlist?: string[];
  token?: string;
  writeEnabled?: boolean;
  fetchImpl?: typeof fetch;
}

export interface DraftInput {
  repository: string;
  issueNumber: number;
  target: string;
  expectedBaseSha: string;
  expectedBlobSha: string;
  replacement: string;
  summary: string;
}

export interface DraftOutput {
  status: "DRAFT_PR_CREATED_CI_UNVERIFIED";
  repository: string;
  issueNumber: number;
  target: string;
  branch: string;
  prNumber: number;
  url: string;
  commitSha: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}
function targetFile(value: unknown): value is string {
  return typeof value === "string" && value.length <= 180 &&
    (value === "README.md" ||
      (/^docs\/[a-zA-Z0-9_.\/-]+\.md$/.test(value) &&
        value.split("/").every(segment => segment !== "." && segment !== ".." && segment !== ""))) &&
    !/(?:^|\/)(?:\.|secrets?|credentials?|auth|security|gate|authority|vendor|dist|node_modules)(?:[-_.\/]|$)/i.test(value);
}
function exactIssueTarget(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const matches = [...body.matchAll(/^\s*Target file:\s*[\x60]?([^\s\x60]+)[\x60]?\s*$/gim)];
  const target = matches.length === 1 ? matches[0]?.[1] : undefined;
  return targetFile(target) ? target : null;
}
function validRepo(value: unknown, owner: string): value is string {
  if (typeof value !== "string") return false;
  const match = /^([a-z0-9-]{1,39})\/([a-z0-9_.-]{1,100})$/i.exec(value);
  return !!match && match[1]?.toLowerCase() === owner.toLowerCase() &&
    match[2] !== "." && match[2] !== "..";
}
function eligible(issue: unknown, target: string): boolean {
  return record(issue) && issue.state === "open" && !issue.pull_request &&
    Array.isArray(issue.labels) && issue.labels.some(label =>
      (typeof label === "string" ? label : record(label) ? label.name : null) === "phibot-ready") &&
    exactIssueTarget(issue.body) === target;
}
function bounded(before: string, after: string): boolean {
  if (before === after || !after.trim() || after.includes("\0") ||
      Buffer.byteLength(after, "utf8") > 12000 ||
      Math.abs(before.length - after.length) > 1800 ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[a-z0-9_]+|ghp_[a-z0-9]{20,}|sk-[a-z0-9]{25,}/i.test(after)) return false;
  const a = before.split("\n"), b = after.split("\n");
  let front = 0, back = 0;
  while (front < a.length && front < b.length && a[front] === b[front]) front++;
  while (back < a.length - front && back < b.length - front &&
    a[a.length - back - 1] === b[b.length - back - 1]) back++;
  return Math.max(a.length - front - back, b.length - front - back) <= 48 &&
    b.length >= Math.floor(a.length * 0.7);
}

export function validateGovernedDraftInput(value: unknown, owner: string, allowed: ReadonlySet<string>): DraftInput {
  const keys = ["repository", "issueNumber", "target", "expectedBaseSha",
    "expectedBlobSha", "replacement", "summary"];
  if (!record(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key)) ||
      !validRepo(value.repository, owner) || !allowed.has(value.repository) ||
      !Number.isSafeInteger(value.issueNumber) || (value.issueNumber as number) < 1 ||
      !targetFile(value.target) || !hash(value.expectedBaseSha) ||
      !hash(value.expectedBlobSha) || typeof value.replacement !== "string" ||
      value.replacement.length > 12000 || typeof value.summary !== "string" ||
      value.summary.trim().length < 12 || value.summary.length > 180 ||
      /[\r\n\0]/.test(value.summary)) {
    throw new Error("Governed draft input denied: exact allowlisted repo, issue, Markdown target, two SHAs, bounded content and summary required");
  }
  return value as unknown as DraftInput;
}

export function registerGovernedDraftTool(
  registry: ToolCapabilityRegistry,
  options: GovernedDraftOptions = {},
): ToolCapabilityRegistry {
  const owner = options.owner ?? process.env.PHIBOT_OWNER ?? "MichaelWave369";
  if (!/^[a-z0-9-]{1,39}$/i.test(owner)) throw new Error("Invalid governed draft owner");
  const allowlist = options.allowlist ?? (process.env.PHIBOT_REPO_ALLOWLIST ?? "")
    .split(",").map(value => value.trim()).filter(Boolean);
  if (allowlist.length > 30 || allowlist.some(repo => !validRepo(repo, owner)) ||
      new Set(allowlist).size !== allowlist.length)
    throw new Error("Invalid governed draft repository allowlist");
  const allowed = new Set(allowlist);
  const token = options.token ?? process.env.PHIBOT_GITHUB_TOKEN ?? "";
  const writeEnabled = options.writeEnabled ?? process.env.PHIBOT_ENABLE_GOVERNED_DRAFTS === "1";
  const transport = options.fetchImpl ?? fetch;

  async function github(
    method: "GET" | "POST" | "PUT", resource: string, signal: AbortSignal,
    data?: Record<string, unknown>, optional = false,
  ): Promise<unknown> {
    const response = await transport("https://api.github.com" + resource, {
      method, signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "PhiBot-Governed-Draft/0.1",
        authorization: "Bearer " + token,
        ...(data ? { "content-type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error("Governed GitHub " + method + " refused (HTTP " + response.status + ")");
    return response.json() as Promise<unknown>;
  }

  const capability: ToolCapability<DraftInput, DraftOutput> = {
    id: "repo.steward.draft",
    description: "Create one SHA-bound, issue-authorized, single-Markdown-file draft PR after explicit Reality Gate approval.",
    actionClass: "write",
    external: true,
    requiresGate: true,
    validate(input: unknown): DraftInput {
      return validateGovernedDraftInput(input, owner, allowed);
    },
    async execute(input, context) {
      if (!writeEnabled || !token) throw new Error("Governed draft writing disabled or scoped GitHub token missing");
      const prefix = "/repos/" + input.repository;
      const metadata = await github("GET", prefix, context.signal);
      if (!record(metadata) || metadata.full_name !== input.repository ||
          metadata.archived || metadata.disabled || metadata.fork ||
          !record(metadata.owner) || String(metadata.owner.login).toLowerCase() !== owner.toLowerCase() ||
          typeof metadata.default_branch !== "string" || metadata.default_branch.length === 0)
        throw new Error("Repository identity or default branch invalid");
      const defaultBranch = metadata.default_branch;
      const branch = "phibot/issue-" + input.issueNumber;
      const currentBranch = await github("GET", prefix + "/git/ref/heads/" +
        encodeURIComponent(branch), context.signal, undefined, true);
      if (currentBranch) throw new Error("Issue branch already exists: no repeat attempts");

      const issue = await github("GET", prefix + "/issues/" + input.issueNumber, context.signal);
      if (!eligible(issue, input.target)) throw new Error("Issue authorization missing or changed");

      const currentRef = await github("GET", prefix + "/git/ref/heads/" +
        encodeURIComponent(defaultBranch), context.signal);
      if (!record(currentRef) || !record(currentRef.object) ||
          currentRef.object.sha !== input.expectedBaseSha)
        throw new Error("Default branch moved since proposed patch");
      const original = await github("GET", prefix + "/contents/" + input.target +
        "?ref=" + input.expectedBaseSha, context.signal);
      if (!record(original) || original.type !== "file" ||
          original.encoding !== "base64" || original.sha !== input.expectedBlobSha ||
          typeof original.content !== "string" || original.content.length > 20000)
        throw new Error("Source blob SHA changed or file is not a small text file");
      const before = Buffer.from(original.content.replace(/\s/g, ""), "base64").toString("utf8");
      if (!bounded(before, input.replacement))
        throw new Error("Replacement refused: no-op, secret pattern, mass rewrite or excessive size");
      // Re-read issue and head just before creating the sole allowed branch.
      const [freshIssue, freshHead, freshBranch] = await Promise.all([
        github("GET", prefix + "/issues/" + input.issueNumber, context.signal),
        github("GET", prefix + "/git/ref/heads/" + encodeURIComponent(defaultBranch), context.signal),
        github("GET", prefix + "/git/ref/heads/" + encodeURIComponent(branch),
          context.signal, undefined, true),
      ]);
      if (!eligible(freshIssue, input.target) || !record(freshHead) ||
          !record(freshHead.object) || freshHead.object.sha !== input.expectedBaseSha ||
          freshBranch) throw new Error("Task approval, base SHA or branch changed before write");
      await github("POST", prefix + "/git/refs", context.signal, {
        ref: "refs/heads/" + branch, sha: input.expectedBaseSha,
      });
      const update = await github("PUT", prefix + "/contents/" + input.target, context.signal, {
        message: "phibot: governed draft for issue #" + input.issueNumber,
        content: Buffer.from(input.replacement, "utf8").toString("base64"),
        sha: input.expectedBlobSha, branch,
      });
      if (!record(update) || !record(update.commit) || !hash(update.commit.sha))
        throw new Error("GitHub file update response invalid; branch may require operator inspection");
      const pr = await github("POST", prefix + "/pulls", context.signal, {
        title: "PhiBot candidate: " + (record(issue) && typeof issue.title === "string"
          ? issue.title.slice(0, 120) : "issue #" + input.issueNumber),
        head: branch, base: defaultBranch, draft: true,
        body: "Autonomous local-model candidate for #" + input.issueNumber +
          "\n\nTarget file: " + input.target +
          "\n\n" + input.summary +
          "\n\nPHIBOT-22: explicitly gated SHA-bound Markdown candidate." +
          "\nNot verified: tests, correctness, security, merge, deployment." +
          "\nOperator must review diff and CI. No automatic promotion.",
      });
      if (!record(pr) || !Number.isSafeInteger(pr.number) ||
          typeof pr.html_url !== "string" ||
          !pr.html_url.startsWith("https://github.com/" + input.repository + "/pull/") ||
          pr.draft !== true) throw new Error("GitHub draft PR response unconfirmed; inspect branch manually");
      return { status: "DRAFT_PR_CREATED_CI_UNVERIFIED",
        repository: input.repository, issueNumber: input.issueNumber,
        target: input.target, branch, prNumber: pr.number as number,
        url: pr.html_url, commitSha: update.commit.sha };
    },
  };
  return registry.register(capability);
}
