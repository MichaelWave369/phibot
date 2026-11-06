import test from "node:test";
import assert from "node:assert/strict";
import {
  readOllamaModels, buildCrewAssignment, verifyCrewAssignment,
  validateCrewPlanInput,
} from "./crew-model-planner.mjs";
import { startQueueDashboard } from "./queue-dashboard.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOT = {
  id: "repo-scout", name: "Scout", role: "research",
  model: { provider: "dry-run", name: "deterministic" },
  state: "idle", activeRuns: 0, updatedAt: "2026-11-06T16:00:00.000Z",
};
const crew = {
  schema: "phibot.crew.live.v1", connected: true,
  status: "LIVE_SERVICE_SELF_REPORT_NOT_ATTESTED",
  bots: [BOT], events: [], authority: "READ_ONLY_NO_ACTIONS",
};
const models = {
  schema: "phibot.crew.models.v1", connected: true,
  status: "LOCAL_OLLAMA_TAGS_SELF_REPORT",
  models: ["qwen3:4b", "gemma3:12b"], qualification: "TAGS_PRESENT_INFERENCE_NOT_TESTED",
};
const proposal = () => buildCrewAssignment({
  crew, models, botId: BOT.id, modelName: "qwen3:4b", mission: "scout",
});

test("default model catalog is disconnected without network use", async () => {
  const result = await readOllamaModels({ env: {}, fetchImpl: () => {
    throw Error("unexpected network");
  } });
  assert.equal(result.connected, false);
  assert.deepEqual(result.models, []);
  assert.equal(result.qualification, "NOT_PROBED");
});

test("Ollama tags use only a fixed loopback GET and are not inference receipts", async () => {
  const seen = [];
  const result = await readOllamaModels({
    env: { PHIBOT_CREW_OLLAMA_PORT: "11434" },
    fetchImpl: async (url, opts) => {
      seen.push(url);
      assert.equal(opts.method, "GET");
      assert.equal(opts.redirect, "error");
      assert.deepEqual(opts.headers, { accept: "application/json" });
      return new Response(JSON.stringify({
        models: [{ name: "qwen3:4b" }, { name: "gemma3:12b" }],
      }), { headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(seen, ["http://127.0.0.1:11434/api/tags"]);
  assert.deepEqual(result.models, ["gemma3:12b", "qwen3:4b"]);
  assert.equal(result.qualification, "TAGS_PRESENT_INFERENCE_NOT_TESTED");
});

test("model inventory refuses bad endpoints and bad tag output", async () => {
  for (const port of ["0", "65536", "http://localhost", " 11434", "11434/", "-1"])
    await assert.rejects(readOllamaModels({
      env: { PHIBOT_CREW_OLLAMA_PORT: port },
    }), /CREW_MODEL_PORT_INVALID/);
  const env = { PHIBOT_CREW_OLLAMA_PORT: "11434" };
  const fake = json => readOllamaModels({ env,
    fetchImpl: async () => new Response(JSON.stringify(json), {
      headers: { "content-type": "application/json" },
    }) });
  await assert.rejects(fake({ models: [{ name: "<script>" }] }), /CREW_MODEL_TAG_INVALID/);
  await assert.rejects(fake({ models: [{ name: "qwen3:4b" }, { name: "qwen3:4b" }] }),
    /CREW_MODEL_DUPLICATE_TAG/);
  await assert.rejects(fake({ models: { name: "qwen3:4b" } }), /CREW_MODEL_CATALOG_INVALID/);
  await assert.rejects(readOllamaModels({ env, fetchImpl: async () =>
    new Response("x".repeat(129 * 1024), {
      headers: { "content-type": "application/json" },
    }) }), /CREW_MODEL_OVERSIZE/);
  await assert.rejects(readOllamaModels({ env, fetchImpl: async () =>
    new Response("<html>", { headers: { "content-type": "text/html" } }) }),
    /CREW_MODEL_RESPONSE_INVALID/);
});

test("assignment proposal binds exact bot model, revision and independently rechecks", () => {
  const plan = proposal();
  assert.equal(plan.action, "REVIEW_ONLY_NO_EXECUTION");
  assert.equal(plan.candidate.provider, "ollama");
  assert.equal(plan.mission, "scout");
  assert.match(plan.digest, /^[a-f0-9]{64}$/);
  assert.equal(verifyCrewAssignment(plan, crew, models).verified, true);
  assert.ok(!JSON.stringify(plan).includes("write"));
  assert.deepEqual(Object.keys(plan.current).sort(), ["name","provider","updatedAt"]);
});

test("review-only planner rejects stale, nonexistent, running and tampered proposals", () => {
  assert.throws(() => buildCrewAssignment({
    crew, models, botId: BOT.id, modelName: "not-installed", mission: "scout",
  }), /CREW_PLANNER_SELECTION_DENIED/);
  assert.throws(() => buildCrewAssignment({
    crew: { ...crew, bots: [{ ...BOT, state: "running", activeRuns: 1 }] },
    models, botId: BOT.id, modelName: "qwen3:4b", mission: "scout",
  }), /CREW_PLANNER_BOT_NOT_IDLE/);
  const plan = proposal();
  assert.throws(() => verifyCrewAssignment(plan, {
    ...crew, bots: [{ ...BOT, updatedAt: "2026-11-06T16:01:00.000Z" }],
  }, models), /CREW_PLAN_STALE_BOT/);
  assert.throws(() => verifyCrewAssignment({
    ...plan, digest: "0".repeat(64),
  }, crew, models), /CREW_PLAN_DIGEST_MISMATCH/);
  assert.throws(() => verifyCrewAssignment({
    ...plan, authority: { write: true },
  }, crew, models), /CREW_PLAN_SCHEMA_INVALID/);
  assert.throws(() => validateCrewPlanInput({
    botId: BOT.id, modelName: "qwen3:4b", mission: "scout", execute: true,
  }), /CREW_PLAN_INPUT_INVALID/);
});

test("dashboard plan requires explicit opt-in and session/origin; it never writes", async () => {
  const env = {
    PHIBOT_OWNER: "MichaelWave369",
    PHIBOT_REPO_ALLOWLIST: "MichaelWave369/phibot",
    PHIBOT_CREW_PLANNER_ACTIONS: "1",
  };
  const dir = await mkdtemp(join(tmpdir(), "crew-plan-test-"));
  let crewReads = 0, catalogReads = 0;
  const app = await startQueueDashboard({
    env, dir, port: 0,
    readCrew: async () => { crewReads++; return crew; },
    readModels: async () => { catalogReads++; return models; },
  });
  try {
    const session = await (await fetch(new URL("/api/session", app.url))).json();
    assert.equal(session.actionsEnabled, false);
    assert.equal(session.plannerEnabled, true);
    assert.match(session.token, /^[0-9a-f]{64}$/);
    const headers = {
      "content-type": "application/json",
      origin: app.url.slice(0, -1),
      "x-phibot-session": session.token,
    };
    const selected = { botId: BOT.id, modelName: "qwen3:4b", mission: "scout" };
    const post = (body, h = headers) => fetch(new URL("/api/crew/plan", app.url), {
      method: "POST", headers: h, body: JSON.stringify(body),
    });
    assert.equal((await post(selected, { "content-type": "application/json" })).status, 403);
    assert.equal((await post(selected, { ...headers, origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ ...selected, grant: "yes" })).status, 422);
    assert.equal((await post({ ...selected, modelName: "not-installed" })).status, 422);
    const response = await post(selected);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.recheck, "REVIEW_ONLY_RECHECK_PASSED_NO_ACTION");
    assert.equal(verifyCrewAssignment(result.plan, crew, models).verified, true);
    assert.equal((await fetch(new URL("/api/models", app.url))).status, 200);
    const forbiddenQueue = await fetch(new URL("/api/run-once", app.url), {
      method: "POST", headers, body: "{}",
    });
    assert.equal(forbiddenQueue.status, 403);
    assert.equal((await forbiddenQueue.json()).code, "ACTIONS_DISABLED_BY_DEFAULT");
    assert.ok(crewReads > 0 && catalogReads > 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("planner remains off by default even when models are available", async () => {
  const env = {
    PHIBOT_OWNER: "MichaelWave369",
    PHIBOT_REPO_ALLOWLIST: "MichaelWave369/phibot",
  };
  const dir = await mkdtemp(join(tmpdir(), "crew-disabled-test-"));
  const app = await startQueueDashboard({
    env, dir, port: 0,
    readCrew: async () => crew, readModels: async () => models,
  });
  try {
    const session = await (await fetch(new URL("/api/session", app.url))).json();
    assert.equal(session.plannerEnabled, false);
    assert.equal(session.token, null);
    const response = await fetch(new URL("/api/crew/plan", app.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: BOT.id, modelName: "qwen3:4b", mission: "scout" }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "CREW_PLANNER_DISABLED_BY_DEFAULT");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
