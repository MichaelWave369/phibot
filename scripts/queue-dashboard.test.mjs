import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startQueueDashboard } from "./queue-dashboard.mjs";

const REPO = "MichaelWave369/Demo";
const env = {
  PHIBOT_OWNER: "MichaelWave369",
  PHIBOT_REPO_ALLOWLIST: REPO,
  PHIBOT_QUEUE_MAX_JOBS: "2",
  PHIBOT_QUEUE_MAX_MS: "60000",
};

async function setup(options, fn) {
  const dir = await mkdtemp(join(tmpdir(), "phibot-ops-test-"));
  const app = await startQueueDashboard({ env, port: 0, dir, ...options });
  try { await fn(app); } finally {
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
}
async function post(app, route, body, token, opts = {}) {
  return fetch(new URL(route, app.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": opts.origin ?? app.url.slice(0, -1),
      ...(token ? { "x-phibot-session": token } : {}),
      ...(opts.headers || {}),
    },
    body: JSON.stringify(body),
  });
}

test("default viewer is localhost-bound, read-only, no action token or worker", async () => {
  await setup({}, async app => {
    assert.equal(app.actionsEnabled, false);
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") || "", /default-src 'none'/);
    const markup = await page.text();
    assert.match(markup, /PHIBOT-26/);
    assert.match(markup, /Run one bounded pass/);
    assert.doesNotMatch(markup, /<script[^>]*>[^<]/);
    const js = await fetch(new URL("/app.js", app.url));
    assert.equal(js.status, 200);
    const css = await fetch(new URL("/style.css", app.url));
    assert.equal(css.status, 200);
    const session = await (await fetch(new URL("/api/session", app.url))).json();
    assert.equal(session.actionsEnabled, false);
    assert.equal(session.token, null);
    const state = await (await fetch(new URL("/api/state", app.url))).json();
    assert.equal(state.total, 0);
    assert.equal(state.budget.maxJobs, 2);
    assert.equal(state.worker.state, "NO_LOCK");
    assert.deepEqual(state.events, []);
    const rejected = await post(app, "/api/run-once", {}, "fake");
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).code, "ACTIONS_DISABLED_BY_DEFAULT");
    const forbidden = await fetch(new URL("/api/secrets", app.url));
    assert.equal(forbidden.status, 404);
  });
});

test("operator mode requires exact origin and session nonce for every POST", async () => {
  await setup({ actionsEnabled: true }, async app => {
    const session = await (await fetch(new URL("/api/session", app.url))).json();
    const token = session.token;
    assert.match(token, /^[a-f0-9]{64}$/);
    const proposal = { capability: "repo.steward.discover", input: { repository: REPO } };
    for (const [attempt, expected] of [
      [post(app, "/api/enqueue", proposal, null), 403],
      [post(app, "/api/enqueue", proposal, "bad-token"), 403],
      [post(app, "/api/enqueue", proposal, token, { origin: "https://evil.example" }), 403],
      [post(app, "/api/enqueue", proposal, token, { headers: { "sec-fetch-site": "cross-site" } }), 403],
      [post(app, "/api/approve", {}, token), 405],
      [post(app, "/api/enqueue", { capability: "repo.steward.repair",
        input: { repository: REPO } }, token), 422],
      [post(app, "/api/enqueue", { ...proposal, grant: "bypass" }, token), 400],
      [post(app, "/api/enqueue", { capability: "repo.steward.draft",
        input: { repository: REPO } }, token), 422],
    ]) {
      const response = await attempt;
      assert.equal(response.status, expected);
    }
    const good = await post(app, "/api/enqueue", proposal, token);
    assert.equal(good.status, 200);
    assert.equal((await good.json()).status, "ENQUEUED_READ_ONLY");
    const inventory = await (await fetch(new URL("/api/state", app.url))).json();
    assert.equal(inventory.total, 1);
    assert.equal(inventory.jobs[0].state, "queued");
    assert.equal(inventory.jobs[0].capability, "repo.steward.discover");
    assert.ok(!JSON.stringify(inventory).includes(token));
  });
});

test("one manual pass uses injected read-only execution and persists metadata, not source", async () => {
  const calls = [];
  await setup({ actionsEnabled: true, execute: async request => {
    calls.push(request);
    return { status: "executed",
      output: { tasks: [{ text: "NEVER_EXPOSE_UNTRUSTED_SOURCE" }],
        issues: [], mode: "READ_ONLY_NO_AUTHORITY_PROMOTION" } };
  } }, async app => {
    const token = (await (await fetch(new URL("/api/session", app.url))).json()).token;
    const requested = await post(app, "/api/enqueue", {
      capability: "repo.steward.discover", input: { repository: REPO },
    }, token);
    assert.equal(requested.status, 200);
    const invalidRun = await post(app, "/api/run-once", { grant: "skip" }, token);
    assert.equal(invalidRun.status, 400);
    const run = await post(app, "/api/run-once", {}, token);
    assert.equal(run.status, 200);
    const summary = await run.json();
    assert.equal(summary.status, "BOUNDED_READ_ONLY_RUN");
    assert.equal(summary.attempted, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.githubWrites, 0);
    assert.equal(summary.modelCalls, 0);
    assert.deepEqual(calls, [{ capability: "repo.steward.discover",
      input: { repository: REPO } }]);
    const updated = await (await fetch(new URL("/api/state", app.url))).json();
    assert.equal(updated.jobs[0].state, "completed");
    assert.equal(updated.jobs[0].evidence.tasks, 1);
    assert.ok(updated.events.some(event => event.event === "OBSERVED"));
    assert.ok(!JSON.stringify(updated).includes("NEVER_EXPOSE_UNTRUSTED_SOURCE"));
    const replay = await post(app, "/api/run-once", {}, token);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).attempted, 0);
  });
});

test("busy operator pass refuses concurrent actions without a second execution", async () => {
  let startWork;
  let finishWork;
  const started = new Promise(ok => { startWork = ok; });
  const finish = new Promise(ok => { finishWork = ok; });
  let executions = 0;
  await setup({ actionsEnabled: true, execute: async () => {
    executions++;
    startWork();
    await finish;
    return { status: "executed", output: { tasks: [], issues: [] } };
  } }, async app => {
    const token = (await (await fetch(new URL("/api/session", app.url))).json()).token;
    await post(app, "/api/enqueue", {
      capability: "repo.steward.discover", input: { repository: REPO },
    }, token);
    const running = post(app, "/api/run-once", {}, token);
    await started;
    const concurrent = await post(app, "/api/run-once", {}, token);
    assert.equal(concurrent.status, 409);
    assert.equal(executions, 1);
    finishWork();
    assert.equal((await running).status, 200);
    const state = await (await fetch(new URL("/api/state", app.url))).json();
    assert.equal(state.busy, false);
  });
});

test("invalid port is rejected before the dashboard binds", async () => {
  await assert.rejects(startQueueDashboard({ env, port: 70000 }),
    /DASHBOARD_PORT_INVALID/);
});
