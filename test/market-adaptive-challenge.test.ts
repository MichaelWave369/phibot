import assert from "node:assert/strict";
import test from "node:test";
import { makeDynamicChallengeCases } from "../src/market/dynamic-challenge.js";
import {
  adaptivePrompt, reviewAdaptiveAttempt,
} from "../src/market/adaptive-challenge.js";
import type { TinyAdvisory } from "../src/market/pocketbrain-tiny.js";

const at = new Date("2026-10-29T03:46:05.219Z");
const tests = makeDynamicChallengeCases(1735783628, at);

function advisory(botId: string, text: string, clipped = false): TinyAdvisory {
  return { status: "advisory", botId, text, hostCaptureClipped: clipped,
    model: "synthetic-test", receiptSchema: "POCKETBRAIN_TINY_RUN_V2",
    provenance: "unverified-model-output",
    sdkReportedBackend: "webgpu", sdkReportedModel: "synthetic-test", sdkReportedDtype: "q4f16" };
}

function fields(testCase: typeof tests[number], overrideSymbol?: string): string {
  const o = testCase.observation;
  const pct = Math.round(100 * (o.price - o.referencePrice) / o.referencePrice);
  return "SYMBOL=" + (overrideSymbol ?? o.symbol) + ";REFERENCE=" + o.referencePrice +
    ";CURRENT=" + o.price + ";MOVE_PCT=" + pct + ";CAUSE=UNKNOWN";
}

test("live R2.2 input-echo pattern is detected separately from unknown termination reason", () => {
  assert.equal(tests[0]?.observation.symbol, "SIM-A");
  assert.equal(tests[0]?.observation.movePct, -8);
  const echo = [
    "Synthetic symbol: SIM-A",
    "Synthetic reference: 2600",
    "Synthetic current: 2392",
    "Synthetic alert threshold (not the move percent): 3",
    "No external source was verified. Do not echo these instructions.",
  ].join("\n");
  const check = reviewAdaptiveAttempt(tests[0]!, "compact-fields", advisory("phibot-scout", echo));
  assert.equal(check.disposition, "HELD_FOR_HUMAN_REVIEW");
  assert.equal(check.promptEchoSignal, "INPUT_OR_INSTRUCTION_ECHO_DETECTED");
  assert.equal(check.numericAccuracy, "NOT_SCORABLE");
  assert.equal(check.generationEndReason, "NOT_REPORTED_BY_SDK");
  assert.equal(check.outputShape, "UNPARSEABLE");
  assert.ok(check.reasonCodes.includes("PROMPT_ECHO_SIGNAL"));
  assert.equal(check.reasonCodes.includes("POSSIBLE_TRUNCATION"), false);
  assert.equal(check.rawText, echo);
});

test("compact fields compare exact arithmetic and symbol; matching is still review-only", () => {
  const testCase = tests[0]!;
  const check = reviewAdaptiveAttempt(testCase, "compact-fields",
    advisory(testCase.botId, fields(testCase)));
  assert.equal(check.disposition, "MATCHES_SYNTHETIC_ARITHMETIC_REVIEW_ONLY");
  assert.equal(check.numericAccuracy, "MATCH");
  assert.equal(check.formatMatch, true);
  assert.equal(check.financialActionAuthorized, false);

  const wrong = reviewAdaptiveAttempt(testCase, "compact-fields",
    advisory(testCase.botId, fields(testCase, "SIM-Z")));
  assert.equal(wrong.formatMatch, true);
  assert.equal(wrong.numericAccuracy, "MATCH");
  assert.ok(wrong.reasonCodes.includes("SYMBOL_MISMATCH"));
  assert.equal(wrong.disposition, "HELD_FOR_HUMAN_REVIEW");
});

test("percent-only guarded attempt independently grades a single computed integer", () => {
  const testCase = tests[1]!;
  assert.equal(testCase.observation.symbol, "SIM-F");
  assert.equal(testCase.observation.movePct, -3);
  const okay = reviewAdaptiveAttempt(testCase, "percent-only-guarded",
    advisory(testCase.botId, "-3"));
  assert.equal(okay.numericAccuracy, "MATCH");
  assert.equal(okay.disposition, "MATCHES_SYNTHETIC_ARITHMETIC_REVIEW_ONLY");
  assert.deepEqual(okay.reasonCodes, []);

  const wrong = reviewAdaptiveAttempt(testCase, "percent-only-guarded",
    advisory(testCase.botId, "-8"));
  assert.equal(wrong.formatMatch, true);
  assert.equal(wrong.numericAccuracy, "MISMATCH");
  assert.ok(wrong.reasonCodes.includes("NUMERIC_MISMATCH"));

  const unscorable = reviewAdaptiveAttempt(testCase, "percent-only-guarded",
    advisory(testCase.botId, "MOVE_PCT=-3; CAUSE=UNKNOWN"));
  assert.equal(unscorable.numericAccuracy, "NOT_SCORABLE");
  assert.equal(unscorable.disposition, "HELD_FOR_HUMAN_REVIEW");
});

test("SDK doesn't provide finish reason; captured truncation only when host clipped its copy", () => {
  const testCase = tests[0]!;
  const text = "z".repeat(800);
  const held = reviewAdaptiveAttempt(testCase, "compact-fields",
    advisory(testCase.botId, text, true));
  assert.equal(held.hostCaptureClipped, true);
  assert.equal(held.generationEndReason, "NOT_REPORTED_BY_SDK");
  assert.ok(held.reasonCodes.includes("HOST_CAPTURE_CLIPPED"));
  assert.equal(held.numericAccuracy, "NOT_SCORABLE");
});

test("unsupported statements and bot-misattributed answers remain held", () => {
  const testCase = tests[0]!;
  const extra = reviewAdaptiveAttempt(testCase, "compact-fields",
    advisory(testCase.botId, fields(testCase) + " BUY now"));
  assert.equal(extra.unsupportedClaimSignal, "DETECTED");
  assert.equal(extra.disposition, "HELD_FOR_HUMAN_REVIEW");
  const botMismatch = reviewAdaptiveAttempt(testCase, "compact-fields",
    advisory("other-bot", fields(testCase)));
  assert.ok(botMismatch.reasonCodes.includes("NO_VALID_SDK_RECEIPT"));
  const failed = reviewAdaptiveAttempt(testCase, "compact-fields",
    { status: "rejected", botId: testCase.botId, reason: "generation-failed" });
  assert.equal(failed.sdkReceiptValid, false);
  assert.equal(failed.rawText, null);
});

test("prompts are short, strategy-specific, and never contain calculated result", () => {
  for (const testCase of tests) {
    const compact = adaptivePrompt(testCase, "compact-fields");
    const guarded = adaptivePrompt(testCase, "percent-only-guarded");
    const pct = Math.round(testCase.observation.movePct);
    assert.ok(compact.length < 350);
    assert.ok(guarded.length < 200);
    assert.ok(compact.includes(String(testCase.observation.referencePrice)));
    assert.ok(guarded.includes(String(testCase.observation.price)));
    assert.doesNotMatch(compact, new RegExp("MOVE_PCT=" + pct + "[;\\n]"));
    assert.doesNotMatch(guarded, /MOVE_PCT=-?\d/);
    assert.doesNotMatch(compact, /The synthetic BTC-USD fixture moved/);
    assert.doesNotMatch(guarded, /Synthetic alert threshold/);
  }
  assert.throws(() => adaptivePrompt(tests[0]!, "fiction" as never), /Unknown/);
});
