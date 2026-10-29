import assert from "node:assert/strict";
import test from "node:test";
import { BrowserMarketLab, type BrowserTinyClient } from "../src/market/browser-lab.js";

const SDK_URL = "https://example.invalid/local-sdk.mjs";
const NOW = new Date("2026-10-29T03:16:12.310Z");

function dynamicMock(prompts: string[], bad: boolean = false): BrowserTinyClient {
  let ready = false;
  let inflight = 0;
  return {
    getStatus: () => ({
      ready, phase: ready ? "ready" : "idle", model: ready ? "synthetic-sdk-test-model" : null,
      device: "webgpu", dtype: "q4f16",
    }),
    load: async () => { ready = true; },
    generate: async (prompt) => {
      assert.equal(inflight, 0, "Model calls must be serialized");
      inflight++;
      try {
        prompts.push(prompt);
        assert.doesNotMatch(prompt, /CAUSE=DEMAND|wrong-percent|invented-cause/);
        const symbol = /Synthetic symbol: ([A-Z0-9-]+)/.exec(prompt)?.[1];
        const reference = Number(/Synthetic reference: (\d+)/.exec(prompt)?.[1]);
        const current = Number(/Synthetic current: (\d+)/.exec(prompt)?.[1]);
        if (!symbol || !reference || !current) throw new Error("Invalid dynamic prompt");
        const change = (current - reference) / reference * 100;
        await Promise.resolve();
        return {
          text: "SYMBOL=" + symbol + ";REFERENCE=" + reference +
            ";CURRENT=" + current + ";MOVE_PCT=" + (bad ? Math.round(change) + 1 : Math.round(change)) +
            ";CAUSE=UNKNOWN",
          receipt: {
            schema: "POCKETBRAIN_TINY_RUN_V2",
            backend: "webgpu", model: "synthetic-sdk-test-model", dtype: "q4f16",
          },
        };
      } finally {
        inflight--;
      }
    },
    dispose: async () => { ready = false; },
  };
}

test("R2.2 seeded dynamic challenge requires consent, yields two distinct prompts and isolated scores", async () => {
  const prompts: string[] = [];
  const lab = new BrowserMarketLab();
  await assert.rejects(lab.runDynamicChallenge(SDK_URL, 123, NOW), /Click Load/);
  assert.equal(prompts.length, 0);
  await lab.loadWithConsent(true, async () => dynamicMock(prompts));
  const result = await lab.runDynamicChallenge(SDK_URL, 192837, NOW);
  assert.equal(result.schema, "phibot.browser-dynamic-challenge.v1");
  assert.equal(result.fixture, "SEEDED_SYNTHETIC_ONLY");
  assert.equal(result.seed, 192837);
  assert.equal(result.cases.length, 2);
  assert.notEqual(result.cases[0]!.observation.symbol, result.cases[1]!.observation.symbol);
  assert.equal(prompts.length, 2);
  assert.notEqual(prompts[0], prompts[1]);
  assert.equal(result.scores.sdkReceipts, 2);
  assert.equal(result.scores.numericalMatches, 2);
  assert.equal(result.scores.formatMatches, 2);
  assert.equal(result.scores.reviewOnlyMatches, 2);
  assert.equal(result.negativeControls.correctlyHeld, 12);
  assert.equal(result.validatorSelfTestPassed, true);
  assert.equal(result.sdkReportedBackend, "webgpu");
  assert.equal(result.computeBackendIndependentlyVerified, false);
  assert.equal(result.realPricesChecked, false);
  assert.equal(result.sourceVerified, false);
  assert.equal(result.modelOutputTrusted, false);
  assert.equal(result.financialActionsAuthorized, false);
  assert.equal(result.authority, "READ_ONLY_ADVISORY");
  const copy = lab.getReports() as unknown as Array<{ authority: string }>;
  copy[0]!.authority = "TRADE_ALLOWED";
  assert.equal(lab.getReports()[0]!.authority, "READ_ONLY_ADVISORY");
  await lab.unload();
  assert.equal(lab.getStatus().phase, "idle");
});

test("R2.2 numeric failure does not erase valid SDK receipts", async () => {
  const prompts: string[] = [];
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => dynamicMock(prompts, true));
  const result = await lab.runDynamicChallenge(SDK_URL, 729921, NOW);
  assert.equal(result.scores.sdkReceipts, 2);
  assert.equal(result.scores.formatMatches, 2);
  assert.equal(result.scores.numericalScorable, 2);
  assert.equal(result.scores.numericalMatches, 0);
  assert.equal(result.scores.reviewOnlyMatches, 0);
  assert.ok(result.checks.every(x => x.reasonCodes.includes("NUMERIC_MISMATCH")));
});

test("invalid seed and invalid clock do not trap host in running state", async () => {
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => dynamicMock([]));
  await assert.rejects(lab.runDynamicChallenge(SDK_URL, -3, NOW), /seed/);
  await assert.rejects(lab.runDynamicChallenge(SDK_URL, 3, new Date("bad")), /clock/);
  assert.equal(lab.getStatus().phase, "ready");
  assert.equal(lab.getReports().length, 0);
  await lab.unload();
});

test("R2.1 fixed lab remains usable after dynamic challenge and report union stays local", async () => {
  const prompts: string[] = [];
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => dynamicMock(prompts));
  await lab.runDynamicChallenge(SDK_URL, 42, NOW);
  const legacy = await lab.runSyntheticCrew(SDK_URL, NOW);
  assert.equal(legacy.schema, "phibot.browser-market-lab.v2");
  assert.equal(legacy.fixture, "SYNTHETIC_ONLY");
  assert.equal(lab.getStatus().reportCount, 2);
  assert.equal(lab.getReports().length, 2);
});
