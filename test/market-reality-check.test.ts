import assert from "node:assert/strict";
import test from "node:test";
import { assessMarketTick } from "../src/market/observation.js";
import { checkTinyAdvisory } from "../src/market/reality-check.js";
import type { TinyAdvisory } from "../src/market/pocketbrain-tiny.js";

const observation = assessMarketTick({
  symbol: "BTC-USD", price: 104, referencePrice: 100,
  sourceUrl: "https://synthetic.example/fixture/BTC-USD",
  sourceTime: "2026-10-29T02:00:59.482Z",
}, { allowedHosts: ["synthetic.example"], minimumMovePct: 3 },
new Date("2026-10-29T02:00:59.482Z"));

function advisory(text: string): TinyAdvisory {
  return {
    status: "advisory", botId: "phibot-skeptic", text,
    model: "SmolLM2-135M", receiptSchema: "POCKETBRAIN_TINY_RUN_V2",
    provenance: "unverified-model-output",
    sdkReportedBackend: "webgpu",
    sdkReportedModel: "onnx-community/SmolLM2-135M-Instruct-ONNX-GQA",
    sdkReportedDtype: "q4f16",
  };
}

test("restrictive exact synthetic fixture phrase is review-only, not fact proof", () => {
  const r = checkTinyAdvisory(advisory(
    "The synthetic BTC-USD fixture moved from 100 to 104 (+4%). The cause is unknown."
  ), observation);
  assert.equal(r.disposition, "RESTRICTED_MATCH_REVIEW_ONLY");
  assert.deepEqual(r.reasonCodes, []);
  assert.equal(r.sdkReportedBackend, "webgpu");
  assert.equal(r.sdkReportedDtype, "q4f16");
  assert.equal(r.independentModelAttestation, false);
  assert.equal(r.actualSourceVerified, false);
  assert.equal(r.financialActionAuthorized, false);
  assert.match(r.fixtureStatement, /Cause unknown/);
});

test("first live-run style prompt echo and incomplete output must be held", () => {
  const s = "The price moved from 100 to 104. Source verification is not available. Do not invent reasons or news. Do";
  const r = checkTinyAdvisory(advisory(s), observation);
  assert.equal(r.disposition, "HELD_FOR_HUMAN_REVIEW");
  assert.ok(r.reasonCodes.includes("PROMPT_ECHO"));
  assert.ok(r.reasonCodes.includes("POSSIBLE_TRUNCATION"));
  assert.equal(r.rawText, s);
});

test("first live-run style invented market-demand causal story is held", () => {
  const r = checkTinyAdvisory(advisory(
    "The price rose to 104 due to a surge in demand and the market had been slowing down."
  ), observation);
  assert.equal(r.disposition, "HELD_FOR_HUMAN_REVIEW");
  assert.ok(r.reasonCodes.includes("UNSUPPORTED_CAUSAL_CLAIM"));
  assert.ok(r.reasonCodes.includes("NOT_EXACTLY_SUPPORTED"));
});

test("incorrect number, added narrative, unrecognized benign text and overlong output fail closed", () => {
  for (const s of [
    "Synthetic BTC-USD increased from 100 to 105, a 5% move. No cause is established.",
    "Bitcoin is up 4%.",
    "The price moved from 100 to 104, so a profit is guaranteed.",
    "Synthetic BTC-USD: 100 to 104 (+4%). No cause is established. Extra speculation.",
    "x".repeat(350) + ".",
  ]) {
    const r = checkTinyAdvisory(advisory(s), observation);
    assert.equal(r.disposition, "HELD_FOR_HUMAN_REVIEW", s);
    assert.ok(r.reasonCodes.length > 0);
  }
});

test("no model advisory cannot produce a safe text verdict", () => {
  const r = checkTinyAdvisory({
    status: "rejected", botId: "phibot-scout", reason: "generation-failed",
  }, observation);
  assert.equal(r.disposition, "HELD_FOR_HUMAN_REVIEW");
  assert.deepEqual(r.reasonCodes, ["NO_VALID_ADVISORY"]);
  assert.equal(r.rawText, null);
  assert.equal(r.sdkReportedBackend, null);
});

test("scope protection rejects changes to the synthetic price, timestamp or provenance", () => {
  for (const mutation of [
    { price: 105 }, { status: "quiet" as const },
    { provenance: "invalid" as "source-claimed-unverified" },
    { sourceUrl: "https://evil.example/fixture/BTC-USD" },
    { checkedAt: "2026-10-29T02:05:59.482Z" },
  ]) {
    const bad = { ...observation, ...mutation };
    const r = checkTinyAdvisory(advisory(
      "The synthetic BTC-USD fixture moved from 100 to 104 (+4%). The cause is unknown."
    ), bad);
    assert.equal(r.disposition, "HELD_FOR_HUMAN_REVIEW");
    assert.ok(r.reasonCodes.includes("FIXTURE_SCOPE_REFUSED"));
  }
});
