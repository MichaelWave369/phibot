#!/usr/bin/env node
/**
 * PHIBOT-25: bounded local read-only work queue. No timers, crons, shells,
 * models, API writes, merge/deploy functions, or unattended grant issuers.
 * One operator invocation processes at most N jobs under a single-host lock.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const QUEUE_HOME = resolve(".phibot", "work-queue");
const CAPABILITIES = ["repo.steward.discover", "repo.steward.inspect"];
const MAX_ATTEMPTS = 2;
const LEASE_MS = 120000;
const LOCK_MS = 180000;
const hash = data => createHash("sha256").update(data).digest("hex");
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
const sha = x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const stamp = ms => new Date(ms).toISOString();

export function queuePolicy(env = process.env) {
  const owner = env.PHIBOT_OWNER || "MichaelWave369";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) throw new Error("INVALID_QUEUE_OWNER");
  const repos = (env.PHIBOT_REPO_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean);
  if (repos.length < 1 || repos.length > 30 || new Set(repos).size !== repos.length ||
      repos.some(s => !new RegExp("^" + owner + "/[A-Za-z0-9_.-]{1,100}$", "i").test(s) ||
        /\/\.{1,2}$/.test(s))) throw new Error("EXPLICIT_QUEUE_ALLOWLIST_REQUIRED");
  return { owner, repos };
}

export function queueBudget(env = process.env) {
  const maxJobs = Number(env.PHIBOT_QUEUE_MAX_JOBS ?? 2);
  const maxMs = Number(env.PHIBOT_QUEUE_MAX_MS ?? 60000);
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 5 ||
      !Number.isInteger(maxMs) || maxMs < 1000 || maxMs > 300000)
    throw new Error("QUEUE_BUDGET_OUT_OF_BOUNDS");
  return { maxJobs, maxMs, maxAttempts: MAX_ATTEMPTS, modelCalls: 0, githubWrites: 0 };
}

export function validateQueueRequest(capability, input, policy) {
  if (!CAPABILITIES.includes(capability) || !isObj(input) || !policy ||
      !Array.isArray(policy.repos)) throw new Error("QUEUE_CAPABILITY_OR_INPUT_DENIED");
  if (typeof input.repository !== "string" || !policy.repos.includes(input.repository) ||
      input.repository.split("/")[0]?.toLowerCase() !== policy.owner.toLowerCase())
    throw new Error("QUEUE_REPOSITORY_NOT_ALLOWED");
  const keys = capability === "repo.steward.discover"
    ? ["repository"] : ["prNumber", "repository", "requiredChecks"];
  if (Object.keys(input).sort().join(",") !== [...keys].sort().join(","))
    throw new Error("QUEUE_UNEXPECTED_INPUT_KEYS");
  if (capability === "repo.steward.inspect" &&
      (!Number.isSafeInteger(input.prNumber) || input.prNumber < 1 ||
       !Array.isArray(input.requiredChecks) ||
       input.requiredChecks.length < 1 || input.requiredChecks.length > 20 ||
       new Set(input.requiredChecks).size !== input.requiredChecks.length ||
       input.requiredChecks.some(v => typeof v !== "string" ||
         !/^[A-Za-z0-9_ .:/-]{1,100}$/.test(v))))
    throw new Error("QUEUE_CHECK_POLICY_INVALID");
  return structuredClone(input);
}
function jobsFolder(dir) { return join(dir, "jobs"); }
function jobFile(dir, id) { return join(jobsFolder(dir), id + ".json"); }
function shapeJob(job, id) {
  if (!isObj(job) || job.schema !== "phibot.queue.job.v1" || job.id !== id ||
      !sha(job.id) || !CAPABILITIES.includes(job.capability) ||
      !["queued", "leased", "completed", "exhausted"].includes(job.state) ||
      !Number.isInteger(job.attempts) || job.attempts < 0 ||
      job.attempts > MAX_ATTEMPTS ||
      typeof job.createdAt !== "string" || !Number.isFinite(Date.parse(job.createdAt)) ||
      typeof job.updatedAt !== "string" || !Number.isFinite(Date.parse(job.updatedAt)))
    throw new Error("QUEUE_JOB_INVALID");
  return job;
}
async function writeAtomic(path, value) {
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n",
      { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}
async function appendEvent(dir, event) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await appendFile(join(dir, "events.ndjson"),
    JSON.stringify({ schema: "phibot.queue.event.v1", timestamp: new Date().toISOString(),
      ...event }) + "\n", { encoding: "utf8", mode: 0o600 });
}
function identity(capability, input) {
  // Canonical field order makes equivalent JSON inputs share one durable ID.
  const normalized = capability === "repo.steward.discover"
    ? { repository: input.repository }
    : { repository: input.repository, prNumber: input.prNumber,
        requiredChecks: input.requiredChecks };
  return hash(JSON.stringify({ capability, input: normalized }));
}
export async function enqueue({ capability, input }, policy, dir = QUEUE_HOME) {
  const validated = validateQueueRequest(capability, input, policy);
  const id = identity(capability, validated);
  await mkdir(jobsFolder(dir), { recursive: true, mode: 0o700 });
  const job = { schema: "phibot.queue.job.v1", id, capability, input: validated,
    state: "queued", attempts: 0, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), lease: null, lastOutcome: null, evidence: null };
  const file = jobFile(dir, id);
  try {
    await writeFile(file, JSON.stringify(job, null, 2) + "\n",
      { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      const prior = shapeJob(JSON.parse(await readFile(file, "utf8")), id);
      if (identity(prior.capability, prior.input) !== id)
        throw new Error("QUEUE_DUPLICATE_IDENTITY_MISMATCH");
      return { status: "ALREADY_QUEUED_NO_OVERWRITE", id };
    }
    throw error;
  }
  await appendEvent(dir, { event: "ENQUEUED", id, capability });
  return { status: "ENQUEUED_READ_ONLY", id, capability };
}
async function readJobs(dir) {
  let names;
  try { names = await readdir(jobsFolder(dir)); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  if (names.length > 1000) throw new Error("QUEUE_TOO_MANY_FILES");
  const output = [];
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("QUEUE_UNEXPECTED_FILE");
    const path = join(jobsFolder(dir), name);
    if ((await stat(path)).size > 16000) throw new Error("QUEUE_JOB_TOO_LARGE");
    const job = shapeJob(JSON.parse(await readFile(path, "utf8")), name.slice(0, 64));
    if (identity(job.capability, job.input) !== job.id)
      throw new Error("QUEUE_JOB_IDENTITY_CHANGED");
    output.push(job);
  }
  return output.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export async function inspectQueue(policy, dir = QUEUE_HOME) {
  const jobs = await readJobs(dir);
  for (const job of jobs) validateQueueRequest(job.capability, job.input, policy);
  return { status: "LOCAL_READ_ONLY_INVENTORY", total: jobs.length,
    jobs: jobs.map(job => ({
      id: job.id, capability: job.capability,
      repository: job.input.repository,
      ...(job.input.prNumber ? { prNumber: job.input.prNumber } : {}),
      state: job.state, attempts: job.attempts,
      updatedAt: job.updatedAt,
      leaseExpiresAt: job.state === "leased" && Number.isSafeInteger(job.lease?.expiresMs) &&
        job.lease.expiresMs >= 0 && job.lease.expiresMs < 8640000000000000
        ? new Date(job.lease.expiresMs).toISOString() : null,
      lastOutcome: job.lastOutcome, evidence: job.evidence
    })) };
}

async function readLock(dir) {
  try {
    return JSON.parse(await readFile(join(dir, "worker.lock"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
function pidActive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}
export async function acquireWorkerLock(dir = QUEUE_HOME, opts = {}) {
  const now = opts.now ?? Date.now;
  const active = opts.pidActive ?? pidActive;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "worker.lock");
  const lock = { schema: "phibot.queue.lock.v1", nonce: randomUUID(),
    pid: process.pid, startedMs: now(), expiresMs: now() + LOCK_MS };
  async function exclusive() {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(lock) + "\n"); }
    finally { await handle.close(); }
  }
  try { await exclusive(); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const prior = await readLock(dir);
    if (!isObj(prior) || !Number.isFinite(prior.expiresMs) ||
        now() <= prior.expiresMs || active(prior.pid)) throw new Error("QUEUE_WORKER_LOCKED");
    // Single-machine stale-lock recovery only. Do not use shared/mounted volumes.
    await rm(file, { force: true });
    try { await exclusive(); }
    catch { throw new Error("QUEUE_WORKER_LOCKED"); }
  }
  return async () => {
    const current = await readLock(dir);
    if (current?.nonce === lock.nonce) await rm(file, { force: true });
  };
}
function evidenceFor(job, outcome) {
  if (outcome?.status !== "executed") return null;
  const data = outcome.output;
  if (!isObj(data)) return null;
  const digest = hash(JSON.stringify(data));
  if (job.capability === "repo.steward.discover")
    return { digest, tasks: Array.isArray(data.tasks) ? data.tasks.length : 0,
      issues: Array.isArray(data.issues) ? data.issues.length : 0,
      mode: "OBSERVATION_ONLY" };
  const goodStates = ["CHECKS_FAILED", "CHECKS_PENDING", "CHECKS_MISSING",
    "CHECKS_PASS_REVIEW_ONLY", "CHECK_DATA_INVALID", "CHECK_DATA_TRUNCATED",
    "BASE_BEHIND_OR_UNKNOWN", "MERGEABILITY_NOT_CONFIRMED"];
  return { digest, headSha: typeof data.headSha === "string" ? data.headSha : null,
    checkStatus: goodStates.includes(data.status) ? data.status : "UNKNOWN",
    mode: "OBSERVATION_ONLY" };
}
export async function runQueue({ policy, execute, budget = queueBudget(),
  dir = QUEUE_HOME, now = Date.now, active = pidActive } = {}) {
  if (typeof execute !== "function") throw new Error("QUEUE_EXECUTOR_REQUIRED");
  if (!policy) throw new Error("QUEUE_POLICY_REQUIRED");
  if (!budget || !Number.isInteger(budget.maxJobs) ||
      budget.maxJobs < 1 || budget.maxJobs > 5 ||
      !Number.isInteger(budget.maxMs) || budget.maxMs < 1000 ||
      budget.maxMs > 300000) throw new Error("QUEUE_BUDGET_OUT_OF_BOUNDS");
  const release = await acquireWorkerLock(dir, { now, pidActive: active });
  const started = now();
  const seen = new Set();
  const summary = { status: "BOUNDED_READ_ONLY_RUN", attempted: 0,
    completed: 0, retryable: 0, exhausted: 0, recovered: 0,
    maxJobs: budget.maxJobs, maxMs: budget.maxMs, githubWrites: 0, modelCalls: 0 };
  try {
    const jobs = await readJobs(dir);
    for (const job of jobs) validateQueueRequest(job.capability, job.input, policy);
    for (const job of jobs) {
      if (job.state !== "leased") continue;
      if (!isObj(job.lease) || !Number.isFinite(job.lease.expiresMs))
        throw new Error("QUEUE_LEASE_INVALID");
      if (now() <= job.lease.expiresMs || active(job.lease.pid)) continue;
      job.state = job.attempts >= MAX_ATTEMPTS ? "exhausted" : "queued";
      job.lease = null;
      job.lastOutcome = "STALE_LEASE_RECOVERED";
      job.updatedAt = stamp(now());
      await writeAtomic(jobFile(dir, job.id), job);
      await appendEvent(dir, { event: "STALE_LEASE_RECOVERED", id: job.id,
        attempts: job.attempts });
      summary.recovered++;
    }
    for (const job of jobs) {
      if (summary.attempted >= budget.maxJobs || now() - started >= budget.maxMs) break;
      if (seen.has(job.id) || job.state !== "queued") continue;
      seen.add(job.id);
      if (job.attempts >= MAX_ATTEMPTS) continue;
      job.attempts++;
      job.state = "leased";
      job.lease = { pid: process.pid, nonce: randomUUID(),
        expiresMs: now() + LEASE_MS };
      job.updatedAt = stamp(now());
      await writeAtomic(jobFile(dir, job.id), job);
      await appendEvent(dir, { event: "LEASED", id: job.id, attempts: job.attempts });
      summary.attempted++;
      let outcome = null;
      let fail = "EXECUTION_EXCEPTION";
      try {
        outcome = await execute({ capability: job.capability, input: structuredClone(job.input) });
        fail = outcome?.status === "denied" ? "TOOL_DENIED" :
          outcome?.status === "gated" ? "TOOL_GATED" : "TOOL_FAILED";
      } catch { /* Never log untrusted exceptions, tokens or source payloads. */ }
      const evidence = evidenceFor(job, outcome);
      const success = outcome?.status === "executed" && evidence !== null;
      job.state = success ? "completed" :
        job.attempts >= MAX_ATTEMPTS ? "exhausted" : "queued";
      job.lastOutcome = success ? "OBSERVED_NO_PROMOTION" : fail;
      job.evidence = success ? evidence : null;
      job.lease = null;
      job.updatedAt = stamp(now());
      await writeAtomic(jobFile(dir, job.id), job);
      await appendEvent(dir, { event: job.state === "completed" ? "OBSERVED" :
        job.state === "exhausted" ? "ATTEMPTS_EXHAUSTED" : "RETRY_QUEUED",
        id: job.id, outcome: job.lastOutcome,
        attempts: job.attempts, ...(evidence ? { evidence } : {}) });
      if (success) summary.completed++;
      else if (job.state === "exhausted") summary.exhausted++;
      else summary.retryable++;
    }
    return summary;
  } finally { await release(); }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0] || "list";
  if (!["list", "enqueue", "run-once"].includes(command)) throw new Error("QUEUE_UNKNOWN_COMMAND");
  const policy = queuePolicy(env);
  if (command === "list" && argv.length === 1) {
    const result = await inspectQueue(policy);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (command === "enqueue" && argv.length === 3) {
    const rawInput = argv[2].startsWith("@")
      ? await readFile(resolve(argv[2].slice(1)), "utf8")
      : argv[2];
    if (Buffer.byteLength(rawInput, "utf8") > 2500)
      throw new Error("QUEUE_INPUT_TOO_LARGE");
    const input = JSON.parse(rawInput);
    const result = await enqueue({ capability: argv[1], input }, policy);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  if (command === "run-once" && argv.length === 1) {
    const { createBuiltinToolRegistry } = await import("../dist/src/tools/builtins.js");
    const { ToolExecutor } = await import("../dist/src/tools/executor.js");
    const { FileLedger } = await import("../dist/src/core/ledger.js");
    const { validateManifest } = await import("../dist/src/core/manifest.js");
    const registry = createBuiltinToolRegistry();
    const ledger = new FileLedger(join(QUEUE_HOME, "tool-receipts.ndjson"));
    const manifest = validateManifest({
      id: "queue-scout", name: "Queue Scout", version: "0.1.0",
      role: "bounded_read_only_queue", description: "Operator-triggered repository observations",
      model: { provider: "dry-run", name: "deterministic" },
      memory: { scope: "task", maxDepth: 1 },
      capabilities: [...CAPABILITIES],
      authority: { read: true, propose: false, write: false, deploy: false },
      escalation: { target: "human", confidenceBelow: 0.9 }
    });
    const budget = queueBudget(env);
    const executor = new ToolExecutor(registry, ledger,
      { timeoutMs: Math.min(30000, budget.maxMs) });
    const result = await runQueue({ policy, budget,
      execute: request => executor.execute(manifest, request) });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  throw new Error("Usage: work-queue.mjs list | enqueue <repo.steward.discover|repo.steward.inspect> '<JSON>' | run-once");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write("PhiBot work queue refused: " +
      (error instanceof Error ? error.message : "unknown failure") + "\n");
    process.exitCode = 1;
  });
}
