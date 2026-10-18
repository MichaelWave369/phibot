import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  queuePolicy, queueBudget, validateQueueRequest, enqueue, inspectQueue,
  acquireWorkerLock, runQueue,
} from "./work-queue.mjs";

const REPO = "MichaelWave369/Demo";
const policy = { owner: "MichaelWave369", repos: [REPO] };
const discovery = { capability: "repo.steward.discover", input: { repository: REPO } };
const inspect = (n) => ({ capability: "repo.steward.inspect",
  input: { repository: REPO, prNumber: n, requiredChecks: ["test"] } });
const successFor = async job => ({ status: "executed",
  output: job.capability === "repo.steward.discover"
    ? { tasks: [{ text: "untrusted raw text should not appear" }], issues: [], mode: "READ_ONLY" }
    : { headSha: "a".repeat(40), status: "CHECKS_FAILED",
      missing: [], failed: ["test"], pending: [] }
});

async function inTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "phibot-q-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("strict owner-scoped allowlist, work capability and budgets reject expanded authority", () => {
  assert.deepEqual(queuePolicy({ PHIBOT_REPO_ALLOWLIST: REPO }), policy);
  assert.throws(() => queuePolicy({ PHIBOT_REPO_ALLOWLIST: "" }), /ALLOWLIST/);
  assert.throws(() => queuePolicy({ PHIBOT_REPO_ALLOWLIST: "Other/Repo" }), /ALLOWLIST/);
  assert.deepEqual(queueBudget({}), { maxJobs: 2, maxMs: 60000,
    maxAttempts: 2, modelCalls: 0, githubWrites: 0 });
  assert.throws(() => queueBudget({ PHIBOT_QUEUE_MAX_JOBS: "50" }), /BUDGET/);
  assert.throws(() => queueBudget({ PHIBOT_QUEUE_MAX_MS: "0" }), /BUDGET/);
  assert.throws(() => validateQueueRequest("repo.steward.repair",
    { repository: REPO }, policy), /DENIED/);
  assert.throws(() => validateQueueRequest("repo.steward.draft",
    { repository: REPO }, policy), /DENIED/);
  assert.throws(() => validateQueueRequest("repo.steward.discover",
    { repository: REPO, grant: "allow" }, policy), /INPUT_KEYS/);
  assert.throws(() => validateQueueRequest("repo.steward.inspect",
    { repository: REPO, prNumber: 1, requiredChecks: [] }, policy), /CHECK_POLICY/);
});

test("enqueue identity deduplicates immutable work without overwriting status", async () => {
  await inTemp(async dir => {
    const first = await enqueue(discovery, policy, dir);
    assert.equal(first.status, "ENQUEUED_READ_ONLY");
    assert.match(first.id, /^[a-f0-9]{64}$/);
    const file = join(dir, "jobs", first.id + ".json");
    const before = await readFile(file, "utf8");
    const again = await enqueue(discovery, policy, dir);
    assert.equal(again.status, "ALREADY_QUEUED_NO_OVERWRITE");
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal((await inspectQueue(policy, dir)).jobs.length, 1);
    assert.equal((await readdir(join(dir, "jobs"))).length, 1);
  });
});

test("run-once processes maximum two jobs with read-only receipt summaries", async () => {
  await inTemp(async dir => {
    await enqueue(discovery, policy, dir);
    await enqueue(inspect(12), policy, dir);
    await enqueue(inspect(13), policy, dir);
    const invocations = [];
    const result = await runQueue({ dir, policy, budget: { maxJobs: 2, maxMs: 60000 },
      execute: async job => { invocations.push(job); return successFor(job); } });
    assert.equal(result.status, "BOUNDED_READ_ONLY_RUN");
    assert.equal(result.attempted, 2);
    assert.equal(result.completed, 2);
    assert.equal(result.githubWrites, 0);
    assert.equal(result.modelCalls, 0);
    assert.equal(invocations.length, 2);
    const jobs = (await inspectQueue(policy, dir)).jobs;
    assert.equal(jobs.filter(x => x.state === "completed").length, 2);
    assert.equal(jobs.filter(x => x.state === "queued").length, 1);
    const events = await readFile(join(dir, "events.ndjson"), "utf8");
    assert.ok(!events.includes("untrusted raw text should not appear"));
    assert.ok(!JSON.stringify(jobs).includes("untrusted raw text should not appear"));
    assert.ok(jobs.some(j => j.evidence?.digest));
  });
});

test("failed read-only job is retried on separate bounded run then exhausted", async () => {
  await inTemp(async dir => {
    await enqueue(discovery, policy, dir);
    const execute = async () => ({ status: "failed", error: "Bearer secret-should-not-appear" });
    const first = await runQueue({ dir, policy, execute });
    assert.equal(first.attempted, 1);
    assert.equal(first.retryable, 1);
    const second = await runQueue({ dir, policy, execute });
    assert.equal(second.exhausted, 1);
    const third = await runQueue({ dir, policy, execute });
    assert.equal(third.attempted, 0);
    const job = (await inspectQueue(policy, dir)).jobs[0];
    assert.equal(job?.state, "exhausted");
    assert.equal(job?.attempts, 2);
    assert.ok(!(await readFile(join(dir, "events.ndjson"), "utf8"))
      .includes("secret-should-not-appear"));
  });
});

test("active lease cannot be stolen, stale dead-process lease recovers once", async () => {
  await inTemp(async dir => {
    const queued = await enqueue(discovery, policy, dir);
    const file = join(dir, "jobs", queued.id + ".json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    saved.state = "leased"; saved.attempts = 1;
    saved.lease = { pid: 888888, nonce: "old", expiresMs: 10000 };
    await writeFile(file, JSON.stringify(saved));
    const blocked = await runQueue({ dir, policy, now: () => 20000,
      active: () => true, execute: successFor });
    assert.equal(blocked.attempted, 0);
    assert.equal(blocked.recovered, 0);
    const recovered = await runQueue({ dir, policy, now: () => 20000,
      active: () => false, execute: successFor });
    assert.equal(recovered.recovered, 1);
    assert.equal(recovered.completed, 1);
    const jobs = (await inspectQueue(policy, dir)).jobs;
    assert.equal(jobs[0]?.attempts, 2);
    assert.equal(jobs[0]?.state, "completed");
  });
});

test("exclusive worker lock blocks second worker, then releases", async () => {
  await inTemp(async dir => {
    const release = await acquireWorkerLock(dir);
    await assert.rejects(acquireWorkerLock(dir), /QUEUE_WORKER_LOCKED/);
    await release();
    const next = await acquireWorkerLock(dir);
    await next();
  });
});

test("stale dead-worker lock only recovered after deadline", async () => {
  await inTemp(async dir => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "worker.lock");
    await writeFile(file, JSON.stringify({ pid: 888888, expiresMs: 10000, nonce: "old" }));
    await assert.rejects(acquireWorkerLock(dir, { now: () => 9000,
      pidActive: () => false }), /QUEUE_WORKER_LOCKED/);
    await assert.rejects(acquireWorkerLock(dir, { now: () => 20000,
      pidActive: () => true }), /QUEUE_WORKER_LOCKED/);
    const release = await acquireWorkerLock(dir, { now: () => 20000,
      pidActive: () => false });
    await release();
  });
});

test("untrusted local job modification refuses execution and ledger writes", async () => {
  await inTemp(async dir => {
    const added = await enqueue(discovery, policy, dir);
    const file = join(dir, "jobs", added.id + ".json");
    const changed = JSON.parse(await readFile(file, "utf8"));
    changed.input = { repository: "OtherOwner/Evil" };
    await writeFile(file, JSON.stringify(changed));
    let calls = 0;
    await assert.rejects(runQueue({ dir, policy, execute: async () => {
      calls++; return successFor(discovery);
    } }), /IDENTITY_CHANGED/);
    assert.equal(calls, 0);
  });
});

test("queue list does not need network access or a GitHub token", async () => {
  await inTemp(async dir => {
    await enqueue(inspect(34), policy, dir);
    const output = await inspectQueue(policy, dir);
    assert.equal(output.total, 1);
    assert.equal(output.jobs[0]?.prNumber, 34);
    assert.equal(output.jobs[0]?.state, "queued");
  });
});
