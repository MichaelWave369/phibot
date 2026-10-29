import assert from "node:assert/strict";
import test from "node:test";
import { makeDynamicChallengeCases } from "../src/market/dynamic-challenge.js";
import { CAPABILITY_LEVELS, makeCapabilityProbe, reviewCapabilityProbe, summarizeCapabilityReviews } from "../src/market/capability-ladder.js";
import type { TinyAdvisory } from "../src/market/pocketbrain-tiny.js";

const date = new Date("2026-10-29T05:31:57.272Z");
const cases = makeDynamicChallengeCases(3438471309, date);
function reply(botId: string, text: string): TinyAdvisory {
  return { status: "advisory", botId, text,
    model: "test", receiptSchema: "POCKETBRAIN_TINY_RUN_V2",
    provenance: "unverified-model-output",
    sdkReportedBackend: "webgpu", sdkReportedModel: "test", sdkReportedDtype: "q4f16" };
}

test("three bounded capability levels on each of two deterministic cases", () => {
  assert.deepEqual(CAPABILITY_LEVELS, ["integer-addition", "percentage-change", "structured-observation"]);
  assert.deepEqual(cases, makeDynamicChallengeCases(3438471309, date));
  assert.equal(cases.length, 2);
  for (const eachCase of cases) {
    const probes = CAPABILITY_LEVELS.map(level => makeCapabilityProbe(eachCase, level));
    assert.equal(new Set(probes.map(x => x.level)).size, 3);
    assert.equal(probes[0]?.expectedValue, probes[0]!.input.left + probes[0]!.input.right);
    assert.equal(probes[1]?.expectedValue, eachCase.observation.movePct);
    assert.equal(probes[2]?.expectedValue, eachCase.observation.movePct);
    for (const p of probes) {
      assert.ok(p.prompt.length < 260);
      assert.doesNotMatch(p.prompt, /SIM-E: 2800 → 2688 = -4%/);
      assert.equal(p.caseId, eachCase.id);
      const r = reviewCapabilityProbe(p, reply(eachCase.botId, p.expectedText));
      assert.equal(r.disposition, "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY");
      assert.equal(r.numericAccuracy, "MATCH");
      assert.equal(r.sdkReceiptValid, true);
      assert.equal(r.independentModelAttestation, false);
      assert.equal(r.financialActionsAuthorized, false);
      assert.deepEqual(r.reasonCodes, []);
    }
  }
});

test("strict checker holds incorrect arithmetic, well-formatted wrong symbol and causal addition", () => {
  for (const eachCase of cases) {
    const sum = makeCapabilityProbe(eachCase, "integer-addition");
    const wrong = reviewCapabilityProbe(sum, reply(eachCase.botId, String(sum.expectedValue + 1)));
    assert.equal(wrong.formatCompliant, true);
    assert.equal(wrong.numericAccuracy, "MISMATCH");
    assert.equal(wrong.disposition, "HELD_FOR_HUMAN_REVIEW");

    const structured = makeCapabilityProbe(eachCase, "structured-observation");
    const wrongSymbol = reviewCapabilityProbe(structured,
      reply(eachCase.botId, structured.expectedText.replace("SYMBOL=" + eachCase.observation.symbol, "SYMBOL=SIM-Z")));
    assert.equal(wrongSymbol.disposition, "HELD_FOR_HUMAN_REVIEW"); // malformed symbol
    const validWrongSymbol = structured.expectedText.replace("SYMBOL=" + eachCase.observation.symbol, "SYMBOL=SIM-B");
    if (eachCase.observation.symbol !== "SIM-B") {
      const check = reviewCapabilityProbe(structured, reply(eachCase.botId, validWrongSymbol));
      assert.equal(check.numericAccuracy, "MATCH");
      assert.ok(check.reasonCodes.includes("SYMBOL_MISMATCH"));
      assert.equal(check.disposition, "HELD_FOR_HUMAN_REVIEW");
    }
    const addedClaim = reviewCapabilityProbe(structured,
      reply(eachCase.botId, structured.expectedText + " because of demand"));
    assert.equal(addedClaim.unsupportedClaimSignal, true);
    assert.equal(addedClaim.disposition, "HELD_FOR_HUMAN_REVIEW");
  }
});

test("repeated prompt input, unscorable text and wrong bot cannot be promoted", () => {
  const p = makeCapabilityProbe(cases[0]!, "percentage-change");
  const repeat = reviewCapabilityProbe(p, reply(p.botId, p.prompt));
  assert.equal(repeat.promptEchoSignal, true);
  assert.equal(repeat.numericAccuracy, "NOT_SCORABLE");
  assert.equal(repeat.disposition, "HELD_FOR_HUMAN_REVIEW");
  const noReceipt = reviewCapabilityProbe(p, { status: "rejected", botId: p.botId, reason: "generation-failed" });
  assert.equal(noReceipt.sdkReceiptValid, false);
  assert.equal(noReceipt.rawText, null);
  assert.equal(noReceipt.generationFinishReason, "NOT_REPORTED_BY_SDK");
  const spoofed = reviewCapabilityProbe(p, reply("other-bot", p.expectedText));
  assert.ok(spoofed.reasonCodes.includes("NO_VALID_RECEIPT"));
  assert.equal(spoofed.disposition, "HELD_FOR_HUMAN_REVIEW");
});

test("level scores preserve non-scorable denominator and never count raw receipt as math pass", () => {
  const reviews = CAPABILITY_LEVELS.flatMap(level =>
    cases.map((c, i) => {
      const p = makeCapabilityProbe(c, level);
      return reviewCapabilityProbe(p, reply(c.botId, i === 0 ? p.expectedText : "not a number"));
    }));
  const summary = summarizeCapabilityReviews(reviews);
  assert.equal(summary.length, 3);
  for (const s of summary) {
    assert.equal(s.total, 2);
    assert.equal(s.receipts, 2);
    assert.equal(s.numericalScorable, 1);
    assert.equal(s.numericalMatches, 1);
    assert.equal(s.reviewOnlyMatches, 1);
  }
});

test("out-of-scope fixture and unknown capability level fail closed", () => {
  assert.throws(() => makeCapabilityProbe(cases[0]!, "invented" as never), /Unknown capability/);
  const altered = {...cases[0]!, observation: {...cases[0]!.observation, sourceUrl: "https://untrusted.example/"}};
  assert.throws(() => makeCapabilityProbe(altered, "integer-addition"), /Out-of-scope/);
});
