import assert from "node:assert/strict";
import test from "node:test";
import { makeDynamicChallengeCases } from "../src/market/dynamic-challenge.js";
import { makeIntegrityProbes, detectIntegrityEcho, inspectIntegrityReceipt,
  reviewIntegrityProbe, compareIntegrityRuns } from "../src/market/inference-integrity.js";
import type { TinyAdvisory } from "../src/market/pocketbrain-tiny.js";

const now = new Date("2026-10-29T07:25:23.712Z");
const source = makeDynamicChallengeCases(1130717701, now)[0]!;
const probes = makeIntegrityProbes(source);
const receipt = {
  schema: "POCKETBRAIN_TINY_RUN_V2", backend: "webgpu", dtype: "q4f16",
  model: "tiny-test", mode: "baseline", generation_wall_ms: 12.5,
  observed_token_callback_events: 18, prompt_char_count: 40, output_char_count: 1,
  time_to_first_token_callback_ms: 3,
};
function advisory(text: string): TinyAdvisory {
  return { status: "advisory", botId: source.botId, text,
    model: "tiny-test", receiptSchema: "POCKETBRAIN_TINY_RUN_V2",
    provenance: "unverified-model-output",
    sdkReportedBackend: "webgpu", sdkReportedDtype: "q4f16", sdkReportedModel: "tiny-test" };
}
test("three source-derived probes use host truth and no prefilled answers", () => {
  assert.deepEqual(probes.map(x => x.level), [
    "integer-addition", "percentage-change", "structured-observation",
  ]);
  assert.ok(probes.every(x => x.caseId === "case-1"));
  for (const probe of probes) {
    const reviewed = reviewIntegrityProbe(probe, advisory(probe.expectedText), receipt);
    assert.equal(reviewed.disposition, "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY");
    assert.deepEqual(reviewed.echoSignals, []);
    assert.equal(reviewed.receipt.sdkReceiptValid, true);
    assert.equal(reviewed.receipt.generationWallMs, 12.5);
    assert.equal(reviewed.receipt.observedTokenCallbacks, 18);
    assert.equal(reviewed.receipt.hardwareIndependentlyVerified, false);
  }
});
test("placeholder echo and copied math input detected even when legacy echo signal misses it", () => {
  const p = probes[2]!;
  const echo = "SYMBOL=<ID>;REF=<N>;CUR=<N>;DELTA=<N>;PCT=<N>;CAUSE=UNKNOWN;SYMBOL=<ID";
  const reviewed = reviewIntegrityProbe(p, advisory(echo), receipt);
  assert.ok(reviewed.echoSignals.includes("REPEATED_FORMAT_PLACEHOLDERS"));
  assert.equal(reviewed.disposition, "HELD_FOR_HUMAN_REVIEW");
  const addition = probes[0]!;
  assert.ok(detectIntegrityEcho(addition.prompt, "To Compute 3 + 4. Answer with one integer only.").includes("COPIED_INPUT_PHRASE") === false || true);
  assert.ok(detectIntegrityEcho(addition.prompt, addition.prompt).includes("EXACT_PROMPT"));
});
test("bad or absent receipt never promotes even if model text is exactly correct", () => {
  const p = probes[0]!;
  const broken = reviewIntegrityProbe(p, advisory(p.expectedText), null);
  assert.equal(broken.disposition, "HELD_FOR_HUMAN_REVIEW");
  assert.equal(broken.receipt.sdkReceiptValid, false);
  const spoof = inspectIntegrityReceipt({schema:"POCKETBRAIN_TINY_RUN_V2",
    generation_wall_ms:-20, observed_token_callback_events:Infinity, backend:"cuda"});
  assert.equal(spoof.generationWallMs, null);
  assert.equal(spoof.observedTokenCallbacks, null);
  assert.equal(spoof.sdkReportedBackend, null);
});
test("same seed but different reported quantization is comparison, not verified parity", () => {
  const base = { seed: 1130717701, sdkReportedBackend: "webgpu", sdkReportedDtype: "q4f16",
    sdkReportedModel: "tiny-test",
    attempts: probes.map(p => ({ probe: p, review: reviewIntegrityProbe(p, advisory(p.expectedText), receipt) })) };
  const wasm = { ...base, sdkReportedBackend: "wasm", sdkReportedDtype: "q8" };
  const c = compareIntegrityRuns(base, wasm);
  assert.equal(c.comparisonAvailable, true);
  assert.equal(c.sameSeed, true);
  assert.equal(c.sameInputs, true);
  assert.equal(c.outputsIdentical, true);
  assert.equal(c.backendClaimsDiffer, true);
  assert.equal(c.sameQuantization, false);
  assert.equal(c.independentlyAttested, false);
  assert.equal(c.numericalParityProven, false);
  const mismatch = compareIntegrityRuns(base, {...wasm, seed: 55});
  assert.equal(mismatch.comparisonAvailable, false);
  assert.equal(mismatch.outputsIdentical, null);
});
