import assert from "node:assert/strict";
import test from "node:test";
import {
  makeDynamicChallengeCases, dynamicChallengePrompt, checkDynamicResponse,
  scoreDynamicChecks, auditNegativeControls, type DynamicChallengeCase,
} from "../src/market/dynamic-challenge.js";
import type { TinyAdvisory } from "../src/market/pocketbrain-tiny.js";

const clock = new Date("2026-10-29T03:16:12.310Z");

function response(test: DynamicChallengeCase, raw: string): TinyAdvisory {
  return {
    status: "advisory", botId: test.botId, text: raw,
    model: "test-model", receiptSchema: "POCKETBRAIN_TINY_RUN_V2",
    provenance: "unverified-model-output",
    sdkReportedBackend: "webgpu", sdkReportedModel: "test-model", sdkReportedDtype: "q4f16",
  };
}

function correctAnswer(test: DynamicChallengeCase): string {
  const o = test.observation;
  const pct = (o.price - o.referencePrice) / o.referencePrice * 100;
  return "SYMBOL=" + o.symbol + ";REFERENCE=" + o.referencePrice +
    ";CURRENT=" + o.price + ";MOVE_PCT=" + Math.round(pct) + ";CAUSE=UNKNOWN";
}

test("seed replay stable and two bots get distinct, exact arithmetic scenarios", () => {
  const same = makeDynamicChallengeCases(0x11ccff20, clock);
  assert.deepEqual(same, makeDynamicChallengeCases(0x11ccff20, clock));
  assert.equal(same.length, 2);
  assert.notEqual(same[0]?.observation.symbol, same[1]?.observation.symbol);
  assert.deepEqual(same.map(x => x.botId), ["phibot-scout", "phibot-skeptic"]);
  for (const item of same) {
    assert.equal(item.observation.provenance, "source-claimed-unverified");
    assert.equal(item.observation.status, "alert");
    assert.equal(item.observation.checkedAt, clock.toISOString());
    assert.ok(/^SIM-[A-F]$/.test(item.observation.symbol));
    assert.ok(Number.isInteger(item.observation.price));
    assert.ok(Number.isInteger(item.observation.referencePrice));
    assert.ok(Math.abs(item.observation.movePct) >= item.observation.thresholdPct);
  }
  // Multiple seeds cover nonhardcoded positive and negative moves.
  const fixtures = [0, 1, 2, 3, 991122, 0xffffffff].flatMap(seed =>
    makeDynamicChallengeCases(seed, clock));
  assert.ok(new Set(fixtures.map(x => x.observation.referencePrice)).size > 2);
  assert.ok(fixtures.some(x => x.observation.movePct < 0));
  assert.ok(fixtures.some(x => x.observation.movePct > 0));
});

test("unsigned seed validation and invalid clocks fail closed", () => {
  for (const seed of [-1, 0x100000000, 1.4, Number.NaN, Infinity]) {
    assert.throws(() => makeDynamicChallengeCases(seed, clock), /seed/);
  }
  assert.throws(() => makeDynamicChallengeCases(33, new Date("invalid")), /clock/);
});

test("prompt has input-only values, no completed answer and no computed percent", () => {
  const fixture = makeDynamicChallengeCases(777, clock)[0]!;
  const prompt = dynamicChallengePrompt(fixture);
  assert.match(prompt, /SIM-/);
  assert.match(prompt, /MOVE_PCT=<SIGNED_INTEGER>/);
  assert.doesNotMatch(prompt, /moved from 100 to 104/);
  assert.doesNotMatch(prompt, /The synthetic BTC-USD fixture moved/);
  assert.doesNotMatch(prompt, /Synthetic move percent: /);
  assert.doesNotMatch(prompt, /\b(?:BUY|SELL) NOW\b/);
});

test("correct dynamic values match only the synthetic fixture and remain review-only", () => {
  const challenges = makeDynamicChallengeCases(193369, clock);
  const checks = challenges.map(item =>
    checkDynamicResponse(item, response(item, correctAnswer(item))));
  const scores = scoreDynamicChecks(checks);
  assert.deepEqual(scores, {
    total: 2, sdkReceipts: 2, formatMatches: 2, numericalMatches: 2,
    numericalScorable: 2, unsupportedClaimSignals: 0, reviewOnlyMatches: 2,
  });
  for (const r of checks) {
    assert.equal(r.disposition, "MATCHES_SYNTHETIC_FIXTURE_REVIEW_ONLY");
    assert.deepEqual(r.reasonCodes, []);
    assert.equal(r.computeBackendIndependentlyVerified, false);
    assert.equal(r.financialActionAuthorized, false);
  }
});

test("wrong numeric fields are scored separately from strict formatting", () => {
  const fixture = makeDynamicChallengeCases(73, clock)[0]!;
  const good = correctAnswer(fixture);
  const bad = good.replace(";CURRENT=" + fixture.observation.price + ";",
    ";CURRENT=" + (fixture.observation.price + 1) + ";");
  const r = checkDynamicResponse(fixture, response(fixture, bad));
  assert.equal(r.inferenceReceiptValid, true);
  assert.equal(r.formatCompliant, true);
  assert.equal(r.numericalAccuracy, "MISMATCH");
  assert.equal(r.disposition, "HELD_FOR_HUMAN_REVIEW");
  assert.ok(r.reasonCodes.includes("NUMERIC_MISMATCH"));
});

test("invalid strings and unverifiable claims do not gain arithmetic or format credit", () => {
  const fixture = makeDynamicChallengeCases(37, clock)[0]!;
  const good = correctAnswer(fixture);
  for (const text of [
    good + " Due to an unexpected surge in demand.",
    good.replace("CAUSE=UNKNOWN", "CAUSE=DEMAND"),
    good.slice(0, -7),
    "Bot: phibot-scout. Do not invent prices.",
    "SYMBOL=" + fixture.observation.symbol + ";REFERENCE=5;CURRENT=9;MOVE_PCT=80;CAUSE=UNKNOWN",
  ]) {
    const r = checkDynamicResponse(fixture, response(fixture, text));
    assert.equal(r.disposition, "HELD_FOR_HUMAN_REVIEW");
  }
  const causal = checkDynamicResponse(fixture, response(fixture, good + " Because demand surged."));
  assert.equal(causal.unsupportedClaimSignal, "DETECTED");
  const noise = checkDynamicResponse(fixture, response(fixture, "It went up."));
  assert.equal(noise.numericalAccuracy, "NOT_SCORABLE");
  assert.equal(noise.formatCompliant, false);
});

test("invalid/misattributed SDK receipt gets no inference or safe verdict", () => {
  const fixture = makeDynamicChallengeCases(999, clock)[0]!;
  const missing = checkDynamicResponse(fixture, {
    status: "rejected", botId: fixture.botId, reason: "invalid-receipt",
  });
  assert.equal(missing.inferenceReceiptValid, false);
  assert.equal(missing.disposition, "HELD_FOR_HUMAN_REVIEW");
  const spoof = checkDynamicResponse(fixture, {
    ...response(fixture, correctAnswer(fixture)), botId: "a-different-bot",
  });
  assert.equal(spoof.inferenceReceiptValid, false);
  assert.equal(spoof.disposition, "HELD_FOR_HUMAN_REVIEW");
});

test("hidden negative controls always hold, and are tested on the validator only", () => {
  const cases = makeDynamicChallengeCases(1288, clock);
  const audit = auditNegativeControls(cases);
  assert.equal(audit.total, 12);
  assert.equal(audit.correctlyHeld, 12);
  assert.equal(audit.falseAcceptances, 0);
  assert.ok(audit.cases.every(x => x.held));
  assert.equal(audit.cases.filter(x => x.control === "wrong-percent").length, 2);
  assert.match(audit.description, /NEVER sent to model/);
});
