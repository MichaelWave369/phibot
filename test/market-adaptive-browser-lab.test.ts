import assert from "node:assert/strict";
import test from "node:test";
import { BrowserMarketLab, type BrowserTinyClient } from "../src/market/browser-lab.js";

const NOW = new Date("2026-10-29T03:46:05.219Z");

function mockAdaptive(
  traces: Array<{ prompt: string; mode: string; tokens: number }>,
  policy: "recover" | "always-echo" | "always-correct" = "recover",
): BrowserTinyClient {
  let ready = false;
  let active = 0;
  return {
    getStatus: () => ({ ready, phase: ready ? "ready" : "idle",
      model: "mock-135m", device: "webgpu", dtype: "q4f16" }),
    load: async () => { ready = true; },
    dispose: async () => { ready = false; },
    generate: async (prompt, options) => {
      assert.equal(active, 0, "SDK must never receive overlapping prompts");
      active++;
      try {
        traces.push({ prompt, mode: options.mode, tokens: options.maxNewTokens });
        assert.equal(options.maxNewTokens, 48);
        let text: string;
        if (options.mode === "guarded") {
          const x = /100 \* \((\d+) - (\d+)\) \/ (\d+)/.exec(prompt);
          if (!x) throw Error("Unexpected guarded prompt");
          const delta = (Number(x[1]) - Number(x[2])) / Number(x[3]) * 100;
          text = policy === "always-echo" ? prompt : String(Math.round(delta));
        } else {
          const m = /Symbol (SIM-[A-F]), reference (\d+), current (\d+)\./.exec(prompt);
          if (!m) throw Error("Unexpected compact prompt");
          const delta = (Number(m[3]) - Number(m[2])) / Number(m[2]) * 100;
          const good = "SYMBOL=" + m[1] + ";REFERENCE=" + m[2] +
            ";CURRENT=" + m[3] + ";MOVE_PCT=" + Math.round(delta) + ";CAUSE=UNKNOWN";
          text = policy === "always-correct" || (policy === "recover" && m[1] === "SIM-A") ? good :
            "Symbol " + m[1] + ", reference " + m[2] + ", current " + m[3] + ".";
        }
        await Promise.resolve();
        return {
          text,
          receipt: { schema: "POCKETBRAIN_TINY_RUN_V2", backend: "webgpu",
            model: "mock-135m", dtype: "q4f16" },
        };
      } finally {
        active--;
      }
    },
  };
}

test("R2.3 requires consent and caps generations; never masks original held text", async () => {
  const traces: Array<{ prompt: string; mode: string; tokens: number }> = [];
  const lab = new BrowserMarketLab();
  await assert.rejects(lab.runAdaptiveChallenge(1735783628, NOW), /Click Load/);
  assert.equal(traces.length, 0);
  await lab.loadWithConsent(true, async () => mockAdaptive(traces, "recover"));
  const result = await lab.runAdaptiveChallenge(1735783628, NOW);
  assert.equal(result.schema, "phibot.browser-adaptive-challenge.v1");
  assert.equal(result.seed, 1735783628);
  assert.equal(result.cases.length, 2);
  assert.equal(result.metrics.generations, 3);
  assert.equal(result.metrics.firstPassMatches, 1);
  assert.equal(result.metrics.fallbackInvocations, 1);
  assert.equal(result.metrics.fallbackRecoveries, 1);
  assert.equal(result.metrics.finalReviewOnlyMatches, 2);
  assert.equal(result.metrics.sdkReceipts, 3);
  assert.deepEqual(traces.map(x => x.mode), ["baseline", "baseline", "guarded"]);
  assert.equal(result.attempts[1]?.review.disposition, "HELD_FOR_HUMAN_REVIEW");
  assert.match(result.attempts[1]?.review.rawText ?? "", /Symbol SIM-F/);
  assert.equal(result.attempts[2]?.review.numericAccuracy, "MATCH");
  assert.equal(result.generationFinishReasonAvailable, false);
  assert.equal(result.computeBackendIndependentlyVerified, false);
  assert.equal(result.financialActionsAuthorized, false);
  assert.equal(result.modelOutputTrusted, false);
  assert.equal(result.actionAuthority, "READ_ONLY_ADVISORY");
  assert.equal(result.validatorControls.falseAcceptances, 0);
  assert.equal(lab.getStatus().phase, "ready");
  const cloned = lab.getReports() as unknown as Array<{ actionAuthority: string }>;
  cloned[0]!.actionAuthority = "PRIVILEGED";
  assert.equal((lab.getReports()[0] as { actionAuthority: string }).actionAuthority, "READ_ONLY_ADVISORY");
  await lab.unload();
});

test("R2.3 holds both probes and records no fabricated arithmetic when tiny model just echoes", async () => {
  const traces: Array<{ prompt: string; mode: string; tokens: number }> = [];
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => mockAdaptive(traces, "always-echo"));
  const r = await lab.runAdaptiveChallenge(1735783628, NOW);
  assert.equal(r.metrics.generations, 4);
  assert.equal(r.metrics.fallbackInvocations, 2);
  assert.equal(r.metrics.fallbackRecoveries, 0);
  assert.equal(r.metrics.finalReviewOnlyMatches, 0);
  assert.equal(r.metrics.numericalMatches, 0);
  assert.equal(r.metrics.numericalScorable, 0);
  assert.equal(r.metrics.sdkReceipts, 4);
  assert.ok(r.attempts.every(x => x.review.disposition === "HELD_FOR_HUMAN_REVIEW"));
  assert.deepEqual(traces.map(x => x.mode), ["baseline", "guarded", "baseline", "guarded"]);
});

test("R2.3 skips fallback entirely after two matching first responses", async () => {
  const traces: Array<{ prompt: string; mode: string; tokens: number }> = [];
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => mockAdaptive(traces, "always-correct"));
  const r = await lab.runAdaptiveChallenge(1735783628, NOW);
  assert.equal(r.metrics.generations, 2);
  assert.equal(r.metrics.firstPassMatches, 2);
  assert.equal(r.metrics.fallbackInvocations, 0);
  assert.equal(r.metrics.finalReviewOnlyMatches, 2);
  assert.deepEqual(traces.map(x => x.mode), ["baseline", "baseline"]);
});

test("bad replay seed leaves host ready and empty", async () => {
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async () => mockAdaptive([]));
  await assert.rejects(lab.runAdaptiveChallenge(-1, NOW), /seed/);
  assert.equal(lab.getStatus().phase, "ready");
  assert.equal(lab.getReports().length, 0);
});
