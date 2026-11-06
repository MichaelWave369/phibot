import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { PhiBotManifest } from "../src/core/types.js";
import {
  buildModelChange, verifyModelChange, requireLocalOllamaTag,
} from "../src/service/model-change.js";
import { PhiBotService } from "../src/service/service.js";
import { startPhiBotHttpServer } from "../src/service/http.js";

const template: PhiBotManifest = {
  id: "scout-1", name: "Scout", version: "1.0.0",
  role: "read_only_research", description: "test crew worker",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 1 },
  capabilities: ["repo.steward.discover"],
  authority: { read: true, propose: false, write: false, deploy: false },
  escalation: { target: "human", confidenceBelow: 0.9 },
};
const secret = "S".repeat(64);

async function fixture(run: (service: PhiBotService, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "phibot-35-"));
  const service = new PhiBotService({ stateDir: root });
  try {
    await service.start();
    await service.registerBot(structuredClone(template));
    await run(service, root);
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
}
async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => { server.off("error", fail); ok(); });
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return addr.port;
}
async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((ok, fail) => server.close(err => err ? fail(err) : ok()));
}
function getBot(service: PhiBotService) {
  return service.registry.get("scout-1").then(value => {
    assert.ok(value);
    return value;
  });
}

test("canonical proposal is exact-digest, minimal shape, and rejects extra authority", async () => {
  await fixture(async service => {
    const plan = buildModelChange(await getBot(service), "qwen3:4b");
    assert.equal(verifyModelChange(plan).digest, plan.digest);
    assert.equal(Object.keys(plan).sort().join(","),
      ["schema", "botId", "current", "candidate", "digest"].sort().join(","));
    assert.throws(() => verifyModelChange({ ...plan, authority: { write: true } }),
      /MODEL_CHANGE_SHAPE_INVALID/);
    assert.throws(() => verifyModelChange({ ...plan, digest: "0".repeat(64) }),
      /MODEL_CHANGE_DIGEST_MISMATCH/);
    const current = await getBot(service);
    assert.throws(() => buildModelChange(current, "<invalid>"),
      /MODEL_CHANGE_BOT_INELIGIBLE/);
  });
});

test("only idle bot model is changed and no authority field is altered", async () => {
  await fixture(async (service, root) => {
    const before = await getBot(service);
    const proposal = buildModelChange(before, "qwen3:4b");
    const run = await service.beginRun(before.manifest.id);
    await assert.rejects(service.changeBotModel(proposal), /MODEL_CHANGE_BOT_NOT_IDLE/);
    await service.finishRun(run.runId);
    await assert.rejects(service.changeBotModel(proposal), /MODEL_CHANGE_STALE_REVISION/);
    const next = buildModelChange(await getBot(service), "qwen3:4b");
    const result = await service.changeBotModel(next);
    assert.equal(result.status, "MODEL_CHANGED_NO_INFERENCE");
    assert.equal(result.model.name, "qwen3:4b");
    const after = await getBot(service);
    assert.deepEqual(after.manifest.authority, before.manifest.authority);
    assert.deepEqual(after.manifest.capabilities, before.manifest.capabilities);
    assert.deepEqual(after.manifest.memory, before.manifest.memory);
    assert.equal(after.manifest.role, before.manifest.role);
    assert.equal(after.manifest.model.provider, "ollama");
    assert.ok(after.updatedAt !== next.current.updatedAt);
    assert.ok(service.events.history().some(e => e.type === "bot.model.changed"));
    await assert.rejects(service.changeBotModel(next), /MODEL_CHANGE_STALE_REVISION/);
    const ledger = await readFile(join(root, "ledger.ndjson"), "utf8");
    assert.match(ledger, /bot.model.changed/);
    assert.ok(!ledger.includes(secret));
  });
});

test("service serializes concurrent beginRun and model change without an unsafe overlap", async () => {
  await fixture(async service => {
    const proposal = buildModelChange(await getBot(service), "qwen3:4b");
    const [run, change] = await Promise.allSettled([
      service.beginRun("scout-1", "race-run"),
      service.changeBotModel(proposal),
    ]);
    assert.equal(run.status, "fulfilled");
    assert.equal(change.status, "rejected");
    if (change.status === "rejected")
      assert.match(String(change.reason), /MODEL_CHANGE_BOT_NOT_IDLE/);
    if (run.status === "fulfilled") await service.finishRun(run.value.runId);
    assert.equal((await getBot(service)).manifest.model.provider, "dry-run");
  });
});

test("Ollama tag verification is fixed-loopback, read-only, and strict", async () => {
  let count = 0;
  const fake = createServer((req, res) => {
    count += 1;
    assert.equal(req.url, "/api/tags");
    assert.equal(req.method, "GET");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "qwen3:4b" }] }));
  });
  const port = await listen(fake);
  try {
    await requireLocalOllamaTag(port, "qwen3:4b");
    assert.equal(count, 1);
    await assert.rejects(requireLocalOllamaTag(port, "missing:7b"),
      /MODEL_CHANGE_TAG_NOT_INSTALLED/);
    assert.equal(count, 2);
  } finally { await close(fake); }
});

test("opt-in model endpoint requires secret, rejects origin, and applies one exact revision", async () => {
  await fixture(async service => {
    const ollama = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: [{ name: "qwen3:4b" }] }));
    });
    const ollamaPort = await listen(ollama);
    const api = await startPhiBotHttpServer(service, {
      host: "127.0.0.1", port: 0, modelControlToken: secret,
      ollamaPort,
    });
    const addr = api.address();
    assert.ok(addr && typeof addr === "object");
    const endpoint = "http://127.0.0.1:" + addr.port + "/crew/model";
    const proposal = buildModelChange(await getBot(service), "qwen3:4b");
    const send = (token: string | undefined, origin?: string, input: unknown = proposal) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { "x-phibot-control-token": token }),
          ...(origin ? { origin } : {}),
        },
        body: JSON.stringify(input),
      });
    try {
      assert.equal((await send(undefined)).status, 403);
      assert.equal((await send("bad")).status, 403);
      assert.equal((await send(secret, "http://evil.example")).status, 403);
      assert.equal((await send(secret, undefined, { ...proposal, escalate: true })).status, 422);
      const ok = await send(secret);
      assert.equal(ok.status, 200);
      const body = await ok.json() as { status: string; digest: string };
      assert.equal(body.status, "MODEL_CHANGED_NO_INFERENCE");
      assert.equal(body.digest, proposal.digest);
      assert.equal((await send(secret)).status, 422);
      assert.equal((await getBot(service)).manifest.model.name, "qwen3:4b");
      const fake = await send(secret, undefined,
        { ...buildModelChange(await getBot(service), "missing:7b") });
      assert.equal(fake.status, 422);
      assert.equal((await getBot(service)).manifest.model.name, "qwen3:4b");
    } finally {
      await close(api);
      await close(ollama);
    }
  });
});

test("model endpoint is unavailable by default, without token", async () => {
  await fixture(async service => {
    const api = await startPhiBotHttpServer(service, { port: 0 });
    const addr = api.address(); assert.ok(addr && typeof addr === "object");
    try {
      const res = await fetch("http://127.0.0.1:" + addr.port + "/crew/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 404);
      assert.equal((await getBot(service)).manifest.model.provider, "dry-run");
    } finally { await close(api); }
  });
});
