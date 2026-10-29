import assert from "node:assert/strict";
import test from "node:test";
import { BrowserMarketLab, type BrowserTinyClient } from "../src/market/browser-lab.js";

const SDK_URL = "https://example.invalid/vendor/sdk/v0.1/index.mjs";

function mockClient(log: string[], response = "Unverified movement; no causal evidence."): BrowserTinyClient {
  let ready = false;
  return {
    getStatus: () => ({ ready, phase: ready ? "ready" : "idle", model: ready ? "SmolLM2-135M" : null }),
    load: async ({ preferredDevice }) => { log.push("load:" + preferredDevice); ready = true; },
    generate: async (prompt) => {
      log.push(prompt.includes("Bot: phibot-scout") ? "scout" : "skeptic");
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { text: response, receipt: { schema: "POCKETBRAIN_TINY_RUN_V2" } };
    },
    dispose: async () => { log.push("dispose"); ready = false; },
  };
}

test("browser host is inert before explicit consent", async () => {
  const lab = new BrowserMarketLab();
  let imports = 0;
  const resolveClient = async () => { imports++; return mockClient([]); };
  assert.deepEqual(lab.getStatus().phase, "idle");
  await assert.rejects(lab.loadWithConsent(false, resolveClient), /consent/);
  assert.equal(imports, 0);
  await assert.rejects(lab.runSyntheticCrew(SDK_URL), /Click Load/);
  assert.equal(lab.getReports().length, 0);
});

test("two bots share one real-client contract with no broker authority", async () => {
  const lab = new BrowserMarketLab();
  const events: string[] = [];
  let imports = 0;
  await lab.loadWithConsent(true, async () => { imports++; return mockClient(events); }, "wasm");
  assert.equal(lab.getStatus().phase, "ready");
  const result = await lab.runSyntheticCrew(SDK_URL, new Date("2026-10-13T09:00:00Z"));
  assert.equal(imports, 1);
  assert.deepEqual(events, ["load:wasm", "scout", "skeptic"]);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0]?.botId, "phibot-scout");
  assert.equal(result.sessions[1]?.botId, "phibot-skeptic");
  assert.equal(result.observation.movePct, 4);
  assert.equal(result.fixture, "SYNTHETIC_ONLY");
  assert.equal(result.realPricesChecked, false);
  assert.equal(result.sourceVerified, false);
  assert.equal(result.financialActionsAuthorized, false);
  assert.equal(result.modelOutputTrusted, false);
  assert.equal(result.observation.provenance, "source-claimed-unverified");
  assert.equal(lab.getStatus().reportCount, 1);
  await lab.unload();
  assert.equal(events.at(-1), "dispose");
  assert.equal(lab.getStatus().phase, "idle");
});

test("reports are copied, stay local until explicit export, and never drive transactions", async () => {
  const lab = new BrowserMarketLab();
  const events: string[] = [];
  await lab.loadWithConsent(true, async () => mockClient(events, "BUY BUY BUY"));
  const report = await lab.runSyntheticCrew(SDK_URL);
  assert.equal(report.sessions[0]?.status, "advisory");
  assert.equal(report.modelOutputTrusted, false);
  const copies = lab.getReports() as unknown as Array<{ authority: string }>;
  copies[0]!.authority = "TRADE_ALLOWED";
  assert.equal(lab.getReports()[0]?.authority, "READ_ONLY_ADVISORY");
  await assert.rejects(lab.loadWithConsent(true, async () => mockClient([])), /already loaded/);
});

test("load errors do not construct an enabled fleet or trigger fallback", async () => {
  const lab = new BrowserMarketLab();
  await assert.rejects(lab.loadWithConsent(true, async () => {
    throw new Error("remote SDK unavailable");
  }), /remote SDK unavailable/);
  assert.equal(lab.getStatus().phase, "error");
  assert.equal(lab.getStatus().reportCount, 0);
  await assert.rejects(lab.runSyntheticCrew(SDK_URL), /Click Load/);
  await lab.unload();
  assert.equal(lab.getStatus().phase, "idle");
});

test("cannot unload a generating client; serial inference only", async () => {
  const lab = new BrowserMarketLab();
  const events: string[] = [];
  await lab.loadWithConsent(true, async () => mockClient(events));
  const running = lab.runSyntheticCrew(SDK_URL);
  await assert.rejects(lab.unload(), /busy/);
  await assert.rejects(lab.runSyntheticCrew(SDK_URL), /Click Load/);
  await running;
  await lab.unload();
});
