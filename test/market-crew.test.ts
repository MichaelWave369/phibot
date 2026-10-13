import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { runReadOnlyMarketScout } from "../src/market/mission.js";
import { assessMarketTick, type MarketReadPolicy, type MarketTick } from "../src/market/observation.js";
import { PocketBrainTinyFleet, type TinySdkClient } from "../src/market/pocketbrain-tiny.js";

const clock = new Date("2026-10-13T07:00:00.000Z");
const policy: MarketReadPolicy = {
  allowedHosts: ["api.exchange.example"],
  minimumMovePct: 3,
};
const tick: MarketTick = {
  symbol: "BTC-USD",
  price: 104,
  referencePrice: 100,
  sourceUrl: "https://api.exchange.example/prices/BTC-USD",
  sourceTime: "2026-10-13T06:59:00.000Z",
};
const manifest: PhiBotManifest = {
  id: "market-scout",
  name: "Market Scout",
  version: "0.1.0",
  role: "read-only market observer",
  description: "source-claimed read-only observations",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "bot", maxDepth: 1 },
  capabilities: ["market.quote.read"],
  authority: { read: true, propose: false, write: false, deploy: false },
  escalation: { target: "vessie", confidenceBelow: 0.7 },
};

test("deterministic threshold emits source-claimed alert, not verified attribution", () => {
  const observed = assessMarketTick(tick, policy, clock);
  assert.equal(observed.status, "alert");
  assert.equal(observed.movePct, 4);
  assert.equal(observed.provenance, "source-claimed-unverified");
  assert.equal(observed.sourceTime, tick.sourceTime);
  assert.equal(assessMarketTick({ ...tick, price: 101 }, policy, clock).status, "quiet");
});

test("invalid, spoofed, stale, future or unallowlisted data refuses to run", () => {
  assert.throws(() => assessMarketTick(tick, { ...policy, allowedHosts: [] }, clock), /allowlist/);
  assert.throws(() => assessMarketTick({ ...tick, sourceUrl: "https://api.exchange.example.evil.test/x" }, policy, clock), /permitted/);
  assert.throws(() => assessMarketTick({ ...tick, sourceUrl: "http://api.exchange.example/x" }, policy, clock), /permitted/);
  assert.throws(() => assessMarketTick({ ...tick, sourceTime: "2026-10-13T06:00:00Z" }, policy, clock), /stale/);
  assert.throws(() => assessMarketTick({ ...tick, sourceTime: "2026-10-13T08:00:00Z" }, policy, clock), /future/);
  assert.throws(() => assessMarketTick({ ...tick, sourceTime: "2026-10-13" }, policy, clock), /timestamp/);
  assert.throws(() => assessMarketTick({ ...tick, price: Number.NaN }, policy, clock), /finite/);
});

test("Tiny fleet never loads by itself and does not generate while not ready", async () => {
  let calls = 0;
  const client: TinySdkClient = {
    getStatus: () => ({ ready: false, phase: "idle", model: null }),
    generate: async () => { calls++; throw new Error("should not generate"); },
  };
  const bot = new PocketBrainTinyFleet(client).forBot("scout-a");
  const result = await bot.advise(assessMarketTick(tick, policy, clock));
  assert.equal(result.status, "skipped");
  assert.equal(calls, 0);
});

test("Tiny fleet serializes model use between independent PhiBots without shared history", async () => {
  let active = 0;
  let maximumActive = 0;
  const prompts: string[] = [];
  const client: TinySdkClient = {
    getStatus: () => ({ ready: true, phase: "ready", model: "smollm2-135m" }),
    generate: async (prompt) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      prompts.push(prompt);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { text: "Movement observed; cause unverified.", receipt: { schema: "POCKETBRAIN_TINY_RUN_V2" } };
    },
  };
  const fleet = new PocketBrainTinyFleet(client);
  const observation = assessMarketTick(tick, policy, clock);
  const [a, b] = await Promise.all([fleet.forBot("scout-a").advise(observation), fleet.forBot("scout-b").advise(observation)]);
  assert.equal(a.status, "advisory");
  assert.equal(b.status, "advisory");
  assert.equal(maximumActive, 1);
  assert.equal(prompts.length, 2);
  assert.ok(prompts[0]?.includes("Bot: scout-a"));
  assert.ok(prompts[1]?.includes("Bot: scout-b"));
  assert.equal(prompts[1]?.includes("Bot: scout-a"), false);
});

test("Tiny refuses false receipts and never treats model text as evidence", async () => {
  const client: TinySdkClient = {
    getStatus: () => ({ ready: true, phase: "ready", model: "mock" }),
    generate: async () => ({ text: "BUY EVERYTHING", receipt: { schema: "other" } }),
  };
  const result = await new PocketBrainTinyFleet(client).forBot("scout-a").advise(assessMarketTick(tick, policy, clock));
  assert.deepEqual(result, { status: "rejected", botId: "scout-a", reason: "invalid-receipt" });
});

test("governed market mission records source metadata and rejects authority expansion", async () => {
  const ledger = new MemoryLedger();
  const result = await runReadOnlyMarketScout({ manifest, tick, policy, ledger, now: clock });
  assert.equal(result.observation.status, "alert");
  assert.equal(result.advisory, null);
  assert.equal(result.receipt.metadata?.financialActionsAuthorized, false);
  assert.equal(result.receipt.metadata?.sourceProvenance, "source-claimed-unverified");
  assert.equal(ledger.receipts.length, 1);

  const denied = new MemoryLedger();
  await assert.rejects(
    runReadOnlyMarketScout({
      manifest: { ...manifest, authority: { ...manifest.authority, write: true } },
      tick, policy, ledger: denied, now: clock,
    }),
    /outside read-only/,
  );
  assert.equal(denied.receipts[0]?.status, "blocked");
});
