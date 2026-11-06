import test from "node:test";
import assert from "node:assert/strict";
import { projectCrew, readCrewService } from "./crew-live.mjs";

const bot = {
  manifest: {
    id: "scout-1", name: "Scout <script>not markup</script>",
    role: "Research", model: { provider: "ollama", name: "qwen3:4b" },
    capabilities: ["repo.steward.discover"],
    authority: { read: true, write: false }, apiKey: "NEVER_EXPOSE_SECRET",
  },
  state: "idle", activeRuns: 0, updatedAt: "2026-11-06T08:00:00.000Z",
};
const event = {
  schema: "phibot.service.event.v1", type: "bot.registered",
  timestamp: "2026-11-06T08:00:00.000Z", botId: "scout-1",
  detail: { secret: "NEVER_EXPOSE_SECRET" },
};

test("disabled by default, no model calls or local service lookup", async () => {
  const result = await readCrewService({ env: {}, fetchImpl: () => {
    throw new Error("MUST_NOT_FETCH");
  } });
  assert.equal(result.connected, false);
  assert.equal(result.status, "SERVICE_NOT_CONFIGURED");
  assert.deepEqual(result.bots, []);
});

test("real service projection exposes metadata only and does not promote authority", () => {
  const result = projectCrew({ bots: [bot] }, { events: [event] });
  assert.equal(result.connected, true);
  assert.equal(result.modelStatus, "CONFIGURED_NOT_PROBED");
  assert.equal(result.bots[0].model.name, "qwen3:4b");
  assert.equal(result.bots[0].model.verifiedAvailable, false);
  assert.equal(result.events[0].type, "bot.registered");
  assert.ok(!JSON.stringify(result).includes("NEVER_EXPOSE_SECRET"));
  assert.ok(!JSON.stringify(result).includes("capabilities"));
  assert.ok(!JSON.stringify(result).includes("authority.write"));
});

test("fetches only bounded loopback GET endpoints with no forwarded credentials", async () => {
  const urls = [];
  const fetchImpl = async (url, opts) => {
    urls.push(url);
    assert.equal(opts.method, "GET");
    assert.equal(opts.redirect, "error");
    assert.deepEqual(opts.headers, { accept: "application/json" });
    return new Response(JSON.stringify(url.endsWith("/bots")
      ? { bots: [bot] } : { events: [event] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await readCrewService({
    env: { PHIBOT_CREW_SERVICE_PORT: "7369" }, fetchImpl,
  });
  assert.equal(result.bots.length, 1);
  assert.deepEqual(urls.sort(), [
    "http://127.0.0.1:7369/bots",
    "http://127.0.0.1:7369/events?limit=24",
  ]);
});

test("malformed port or service projection fails closed", async () => {
  for (const port of ["0", "65536", "-1", "7369/evil", "http://host", " 7369"]) {
    await assert.rejects(readCrewService({
      env: { PHIBOT_CREW_SERVICE_PORT: port },
    }), /CREW_SERVICE_PORT_INVALID/);
  }
  assert.throws(() => projectCrew({ bots: [{ ...bot, state: "invented" }] },
    { events: [] }), /CREW_BOT_INVALID/);
  assert.throws(() => projectCrew({ bots: [bot, bot] },
    { events: [] }), /CREW_DUPLICATE_BOTS/);
  assert.throws(() => projectCrew({ bots: [bot] },
    { events: [{ ...event, type: "grant.approved" }] }), /CREW_EVENT_INVALID/);
  assert.throws(() => projectCrew({ bots: [bot] },
    { events: [{ ...event, timestamp: "invalid" }] }), /CREW_TIMESTAMP_INVALID/);
});

test("oversized or non-JSON service response is refused", async () => {
  const env = { PHIBOT_CREW_SERVICE_PORT: "7369" };
  await assert.rejects(readCrewService({ env, fetchImpl: async () =>
    new Response("x".repeat(129 * 1024), {
      headers: { "content-type": "application/json" },
    }) }), /CREW_SERVICE_RESPONSE_OVERSIZE/);
  await assert.rejects(readCrewService({ env, fetchImpl: async () =>
    new Response("<html>", {
      headers: { "content-type": "text/html" },
    }) }), /CREW_SERVICE_RESPONSE_INVALID/);
});
