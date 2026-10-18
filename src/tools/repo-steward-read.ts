import type { ToolCapability } from "./types.js";
import type { ToolCapabilityRegistry } from "./registry.js";

/**
 * PHIBOT-21: actual read-only GitHub capabilities in the governed tool registry.
 * Unlike the separate Repo Steward scripts, these run through ToolExecutor
 * manifest checks, the existing sandbox adapter and receipt ledger.
 * They do not grant writes or call local models.
 */
export interface RepoStewardReadOptions {
  owner?: string;
  allowlist?: string[];
  token?: string;
  fetchImpl?: typeof fetch;
}

type DiscoverInput = { repository: string };
type VerifyInput = { repository: string; prNumber: number; requiredChecks: string[] };

type RepoTask = { source: string; line: number; text: string };
type RepoIssue = { number: number; title: string; eligible: boolean; target: string | null };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExact(input: unknown, keys: string[], action: string): asserts input is Record<string, unknown> {
  if (!object(input) || Object.keys(input).some(key => !keys.includes(key))) {
    throw new Error(action + " requires a bounded, exact input object");
  }
}

function isRepo(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^[a-z0-9-]{1,39}\/([a-z0-9_.-]{1,100})$/i.exec(value);
  return !!match && match[1] !== "." && match[1] !== "..";
}
const SAFE_TARGET = /^(README\.md|(?:src|docs|test)\/[a-z0-9_.\/-]+\.(?:md|ts|tsx|js|mjs|json|css))$/i;
function safeTarget(value: unknown): value is string {
  return typeof value === "string" && value.length <= 180 &&
    SAFE_TARGET.test(value) &&
    !value.split("/").some(part => part === "" || part === "." || part === "..") &&
    !/(?:^|\/)(?:\.|secrets?|credentials?|auth|security|gate|authority|vendor|dist|node_modules)(?:[-_.\/]|$)/i.test(value);
}

function issueTarget(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const matches = [...body.matchAll(/^\s*Target file:\s*[\x60]?([^\s\x60]+)[\x60]?\s*$/gim)];
  const target = matches.length === 1 ? matches[0]?.[1] : undefined;
  return safeTarget(target) ? target : null;
}
function readyIssue(value: unknown): boolean {
  return object(value) && value.state === "open" && !value.pull_request &&
    Array.isArray(value.labels) &&
    value.labels.some(item => (typeof item === "string" ? item : object(item) ? item.name : null) === "phibot-ready") &&
    issueTarget(value.body) !== null;
}

export function extractRepoTasks(content: string, source: string): RepoTask[] {
  return content.split(/\r?\n/).flatMap((line, idx) => {
    const match = line.match(/^\s*[-*]\s+\[ \]\s+(.{4,240})$/);
    const task = match?.[1];
    return task ? [{ source, line: idx + 1, text: task.trim() }] : [];
  }).slice(0, 20);
}

function formatStatus(checks: unknown, statuses: unknown, required: string[]): {
  status: string; checkCount: number; missing: string[]; failed: string[]; pending: string[];
} {
  const empty = (status: string) => ({ status, checkCount: 0, missing: [] as string[],
    failed: [] as string[], pending: [] as string[] });
  if (!object(checks) || !object(statuses) ||
      !Array.isArray(checks.check_runs) || !Array.isArray(statuses.statuses) ||
      !Number.isInteger(checks.total_count) || !Number.isInteger(statuses.total_count))
    return empty("CHECK_DATA_INVALID");
  const cr = checks.check_runs, cs = statuses.statuses;
  if (cr.length > 100 || cs.length > 100 || (checks.total_count as number) > cr.length ||
      (statuses.total_count as number) > cs.length) return empty("CHECK_DATA_TRUNCATED");
  const latest = new Map<string, { name: string; status: string; conclusion: string | null }>();
  for (const run of [...cr].sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))) {
    if (!object(run) || typeof run.name !== "string" || latest.has(run.name)) continue;
    latest.set(run.name, { name: run.name, status: String(run.status),
      conclusion: typeof run.conclusion === "string" ? run.conclusion : null });
  }
  // Combined statuses are newest first, unlike independent Check Runs.
  const statusContexts = new Map<string, { name: string; status: string; conclusion: null }>();
  for (const row of cs) {
    if (!object(row) || typeof row.context !== "string" || statusContexts.has(row.context)) continue;
    statusContexts.set(row.context, { name: row.context, status: String(row.state), conclusion: null });
  }
  const missing = required.filter(name => !latest.has(name) && !statusContexts.has(name));
  const failed: string[] = [], pending: string[] = [];
  for (const state of [...latest.values(), ...statusContexts.values()]) {
    const name = state.name;
    if (state.status === "completed") {
      if (state.conclusion !== "success") failed.push(name);
    } else if (state.status === "failure" || state.status === "error") failed.push(name);
    else if (state.status !== "success") pending.push(name);
  }
  return { status: missing.length ? "CHECKS_MISSING" :
    failed.length ? "CHECKS_FAILED" : pending.length ? "CHECKS_PENDING" : "CHECKS_PASS_REVIEW_ONLY",
    checkCount: latest.size + statusContexts.size, missing, failed, pending };
}

export function registerRepoStewardReadTools(
  registry: ToolCapabilityRegistry,
  options: RepoStewardReadOptions = {},
): ToolCapabilityRegistry {
  const owner = options.owner ?? process.env.PHIBOT_OWNER ?? "MichaelWave369";
  if (!/^[a-z0-9-]{1,39}$/i.test(owner)) throw new Error("Invalid PHIBOT_OWNER");
  const allowlist = options.allowlist ?? (process.env.PHIBOT_REPO_ALLOWLIST ?? "")
    .split(",").map(item => item.trim()).filter(Boolean);
  if (allowlist.length > 30 || allowlist.some(item => !isRepo(item) ||
      item.split("/")[0].toLowerCase() !== owner.toLowerCase()))
    throw new Error("PHIBOT_REPO_ALLOWLIST must be owner-scoped and contain at most 30 repositories");
  const allowed = new Set(allowlist);
  const token = options.token ?? process.env.PHIBOT_GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  const transport = options.fetchImpl ?? fetch;

  function allowedRepo(repo: string): void {
    if (!allowed.has(repo)) throw new Error("Repository is not on the explicit PhiBot allowlist");
  }
  async function get(path: string, signal: AbortSignal, missingIsNull = false): Promise<unknown> {
    const response = await transport("https://api.github.com" + path, {
      method: "GET", signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "PhiBot-Tool/0.1",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
    });
    if (missingIsNull && response.status === 404) return null;
    if (!response.ok) throw new Error("GitHub read refused (HTTP " + response.status + ")");
    return response.json() as Promise<unknown>;
  }
  async function meta(repo: string, signal: AbortSignal): Promise<{ branch: string }> {
    const raw = await get("/repos/" + repo, signal);
    if (!object(raw) || raw.full_name !== repo || raw.archived || raw.disabled ||
        raw.fork || typeof raw.default_branch !== "string" ||
        !object(raw.owner) || String(raw.owner.login).toLowerCase() !== owner.toLowerCase())
      throw new Error("GitHub repository identity failed closed");
    return { branch: raw.default_branch };
  }

  const discover: ToolCapability<DiscoverInput, {
    repository: string; defaultBranch: string; tasks: RepoTask[]; issues: RepoIssue[]; mode: string;
  }> = {
    id: "repo.steward.discover",
    description: "Read bounded roadmap checkboxes and open issue metadata from one approved GitHub repository.",
    actionClass: "read",
    external: true,
    validate(input: unknown): DiscoverInput {
      assertExact(input, ["repository"], "repo.steward.discover");
      if (!isRepo(input.repository)) throw new Error("Invalid repository name");
      allowedRepo(input.repository);
      return { repository: input.repository };
    },
    async execute(input, context) {
      const repo = input.repository;
      const repository = await meta(repo, context.signal);
      const tasks: RepoTask[] = [];
      for (const path of ["README.md", "docs/ROADMAP.md"]) {
        const response = await get("/repos/" + repo + "/contents/" + path, context.signal, true);
        if (!object(response) || response.type !== "file" ||
            response.encoding !== "base64" || typeof response.content !== "string" ||
            response.content.length > 20000) continue;
        const content = Buffer.from(response.content.replace(/\s/g, ""), "base64").toString("utf8");
        if (content.length <= 12000) tasks.push(...extractRepoTasks(content, path));
      }
      const raw = await get("/repos/" + repo + "/issues?state=open&per_page=100", context.signal);
      if (!Array.isArray(raw) || raw.length >= 100) throw new Error("Issue inventory truncated");
      const issues: RepoIssue[] = raw.filter(row => object(row) && !row.pull_request &&
        Number.isSafeInteger(row.number) && typeof row.title === "string").map(row => ({
        number: row.number as number,
        title: String(row.title).slice(0, 160),
        eligible: readyIssue(row),
        target: issueTarget(row.body),
      }));
      return { repository: repo, defaultBranch: repository.branch,
        tasks: tasks.slice(0, 40), issues, mode: "READ_ONLY_NO_AUTHORITY_PROMOTION" };
    },
  };

  const inspect: ToolCapability<VerifyInput, {
    repository: string; prNumber: number; headSha: string; status: string; checkCount: number;
    missing: string[]; failed: string[]; pending: string[]; mode: string;
  }> = {
    id: "repo.steward.inspect",
    description: "Observe SHA-bound required GitHub CI checks of one authorized PhiBot draft PR.",
    actionClass: "read",
    external: true,
    validate(input: unknown): VerifyInput {
      assertExact(input, ["repository", "prNumber", "requiredChecks"], "repo.steward.inspect");
      if (!isRepo(input.repository) || !Number.isSafeInteger(input.prNumber) ||
          (input.prNumber as number) < 1 || !Array.isArray(input.requiredChecks) ||
          input.requiredChecks.length < 1 || input.requiredChecks.length > 20 ||
          new Set(input.requiredChecks).size !== input.requiredChecks.length ||
          input.requiredChecks.some(name => typeof name !== "string" ||
            !/^[A-Za-z0-9_ .:/-]{1,100}$/.test(name)))
        throw new Error("Invalid bounded CI inspection input");
      allowedRepo(input.repository);
      return { repository: input.repository, prNumber: input.prNumber as number,
        requiredChecks: [...input.requiredChecks] as string[] };
    },
    async execute(input, context) {
      if (!token) throw new Error("GitHub check inspection requires a scoped read token");
      const prefix = "/repos/" + input.repository;
      const repository = await meta(input.repository, context.signal);
      const path = prefix + "/pulls/" + input.prNumber;
      const original = await get(path, context.signal);
      if (!object(original) || original.state !== "open" || original.draft !== true ||
          typeof original.title !== "string" ||
          !original.title.startsWith("PhiBot candidate: ") ||
          !object(original.head) || !object(original.base) ||
          original.head.repo == null || original.base.repo == null ||
          !object(original.head.repo) || !object(original.base.repo) ||
          original.head.repo.full_name !== input.repository ||
          original.base.repo.full_name !== input.repository ||
          original.base.ref !== repository.branch ||
          typeof original.head.ref !== "string" ||
          !/^phibot\/issue-[1-9][0-9]*$/.test(original.head.ref) ||
          typeof original.head.sha !== "string" || !/^[0-9a-f]{40}$/i.test(original.head.sha) ||
          typeof original.body !== "string")
        throw new Error("Target is not an eligible PhiBot draft PR");
      const match = /^phibot\/issue-([1-9][0-9]*)$/.exec(original.head.ref);
      const issueNumber = Number(match?.[1]);
      const target = issueTarget(original.body);
      if (!target || !original.body.includes("Autonomous local-model candidate for #" + issueNumber + "\n"))
        throw new Error("PhiBot PR task binding invalid");
      const issue = await get(prefix + "/issues/" + issueNumber, context.signal);
      if (!readyIssue(issue) || !object(issue) || issueTarget(issue.body) !== target)
        throw new Error("PhiBot issue authorization revoked");
      const sha = original.head.sha;
      const [checks, statuses, comparison] = await Promise.all([
        get(prefix + "/commits/" + sha + "/check-runs?per_page=100", context.signal),
        get(prefix + "/commits/" + sha + "/status?per_page=100", context.signal),
        get(prefix + "/compare/" + encodeURIComponent(repository.branch) + "..." + sha, context.signal),
      ]);
      const evaluation = formatStatus(checks, statuses, input.requiredChecks);
      const latest = await get(path, context.signal);
      if (!object(latest) || !object(latest.head) || latest.head.sha !== sha ||
          latest.state !== "open" || latest.draft !== true ||
          latest.body !== original.body || latest.head.ref !== original.head.ref)
        throw new Error("PR changed during CI inspection");
      const state = !object(comparison) || comparison.behind_by !== 0
        ? "BASE_BEHIND_OR_UNKNOWN" : latest.mergeable !== true
        ? "MERGEABILITY_NOT_CONFIRMED" : evaluation.status;
      return { repository: input.repository, prNumber: input.prNumber, headSha: sha,
        status: state, checkCount: evaluation.checkCount, missing: evaluation.missing,
        failed: evaluation.failed, pending: evaluation.pending, mode: "READ_ONLY_NO_PROMOTION" };
    },
  };
  return registry.register(discover).register(inspect);
}
