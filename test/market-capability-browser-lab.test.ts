import assert from "node:assert/strict";
import test from "node:test";
import { BrowserMarketLab, type BrowserTinyClient } from "../src/market/browser-lab.js";

const NOW = new Date("2026-10-29T05:31:57.272Z");

function model(traces: string[], behavior: "correct" | "echo" | "second-wrong" = "correct"): BrowserTinyClient {
  let ready = false;
  let active = 0;
  return {
    getStatus: () => ({ready, phase: ready ? "ready" : "idle",
      model: "mock-capability-model", device: "webgpu", dtype: "q4f16"}),
    load: async () => {ready = true;},
    dispose: async () => {ready = false;},
    generate: async (prompt, opts) => {
      assert.equal(active, 0, "overlapping generations not allowed");
      active++;
      try {
        assert.equal(opts.mode, "baseline");
        assert.equal(opts.maxNewTokens, 48);
        traces.push(prompt);
        let text: string;
        const add = /^Compute (\d+) \+ (\d+)\./.exec(prompt);
        const percent = /Synthetic prices: reference (\d+), current (\d+)\./.exec(prompt);
        const struct = /Fictional symbol (SIM-[A-F]); reference (\d+); current (\d+)\./.exec(prompt);
        if (add) text = String(Number(add[1]) + Number(add[2]));
        else if (percent) text = String(Math.round(100 * (Number(percent[2]) - Number(percent[1])) / Number(percent[1])));
        else if (struct) {
          const ref = Number(struct[2]), cur = Number(struct[3]);
          const pct = Math.round(100 * (cur - ref) / ref);
          text = "SYMBOL=" + struct[1] + ";REF=" + ref + ";CUR=" + cur +
            ";DELTA=" + (cur-ref) + ";PCT=" + pct + ";CAUSE=UNKNOWN";
        } else throw new Error("Unexpected probe format");
        if (behavior === "echo") text = prompt;
        if (behavior === "second-wrong" && traces.length % 2 === 0) text = "The market is great";
        await Promise.resolve();
        return {text, receipt: {schema: "POCKETBRAIN_TINY_RUN_V2",
          backend: "webgpu", model: "mock-capability-model", dtype: "q4f16"}};
      } finally {active--;}
    },
  };
}

test("six serialized independent ladder probes and stable replay, consent required", async () => {
  const calls: string[] = [];
  const lab = new BrowserMarketLab();
  await assert.rejects(lab.runCapabilityLadder(3438471309, NOW), /Click Load/);
  assert.equal(calls.length, 0);
  await lab.loadWithConsent(true, async () => model(calls));
  const result = await lab.runCapabilityLadder(3438471309, NOW);
  assert.equal(result.schema, "phibot.browser-capability-ladder.v1");
  assert.equal(result.attempts.length, 6);
  assert.equal(calls.length, 6);
  assert.deepEqual(result.byLevel.map(x => x.reviewOnlyMatches), [2,2,2]);
  assert.deepEqual(result.byLevel.map(x => x.numericalMatches), [2,2,2]);
  assert.equal(result.sdkPromptEnvelope, "VENDORED_SYSTEM_PLUS_USER_MESSAGES");
  assert.equal(result.sdkRenderedChatTemplateIndependentlyInspected, false);
  assert.equal(result.computeBackendIndependentlyVerified, false);
  assert.equal(result.modelOutputTrusted, false);
  assert.equal(result.financialActionsAuthorized, false);
  assert.equal(result.authority, "READ_ONLY_ADVISORY");
  const again = await lab.runCapabilityLadder(3438471309, NOW);
  assert.deepEqual(result.attempts.map(x => x.probe), again.attempts.map(x => x.probe));
  assert.equal(lab.getStatus().reportCount, 2);
  const snapshot = lab.getReports() as unknown as Array<{ authority: string }>;
  snapshot[0]!.authority = "UNRESTRICTED";
  assert.equal(lab.getReports()[0]!.authority, "READ_ONLY_ADVISORY");
  await lab.unload();
});

test("bad answer still returns SDK receipt but receives zero math passes", async () => {
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => model([], "echo"));
  const r = await lab.runCapabilityLadder(88, NOW);
  assert.equal(r.attempts.length, 6);
  for (const level of r.byLevel) {
    assert.equal(level.receipts, 2);
    assert.equal(level.numericalScorable, 0);
    assert.equal(level.reviewOnlyMatches, 0);
  }
  assert.ok(r.attempts.every(x => x.review.disposition === "HELD_FOR_HUMAN_REVIEW"));
});

test("partial success does not become universal capability score", async () => {
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => model([], "second-wrong"));
  const r = await lab.runCapabilityLadder(44, NOW);
  for (const level of r.byLevel) {
    assert.equal(level.receipts, 2);
    assert.equal(level.numericalMatches, 1);
    assert.equal(level.numericalScorable, 1);
    assert.equal(level.reviewOnlyMatches, 1);
  }
  assert.equal(r.attempts.length, 6);
});

test("invalid replay seed cannot strand loaded client or emit report", async () => {
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => model([]));
  await assert.rejects(lab.runCapabilityLadder(-1, NOW), /seed/);
  assert.equal(lab.getStatus().phase, "ready");
  assert.equal(lab.getStatus().reportCount, 0);
});
