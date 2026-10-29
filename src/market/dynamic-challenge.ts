import { assessMarketTick, type MarketObservation } from "./observation.js";
import type { TinyAdvisory } from "./pocketbrain-tiny.js";

// Diagnostic only: no real ticker, market feed, broker, or verified source.
export interface DynamicChallengeCase {
  schema: "phibot.market.dynamic-case.v1";
  id: string;
  botId: "phibot-scout" | "phibot-skeptic";
  observation: Readonly<MarketObservation>;
}

export type ChallengeReason =
  | "NO_VALID_SDK_RECEIPT" | "FORMAT_MISMATCH" | "NUMERIC_MISMATCH"
  | "SYMBOL_MISMATCH" | "UNSUPPORTED_CLAIM_DETECTED" | "POSSIBLE_TRUNCATION";

export interface DynamicChallengeCheck {
  schema: "phibot.market.dynamic-check.v1";
  caseId: string;
  botId: string;
  disposition: "MATCHES_SYNTHETIC_FIXTURE_REVIEW_ONLY" | "HELD_FOR_HUMAN_REVIEW";
  inferenceReceiptValid: boolean;
  formatCompliant: boolean;
  numericalAccuracy: "MATCH" | "MISMATCH" | "NOT_SCORABLE";
  symbolMatches: boolean | null;
  unsupportedClaimSignal: "DETECTED" | "NOT_DETECTED";
  reasonCodes: readonly ChallengeReason[];
  rawText: string | null;
  expected: Readonly<{ symbol: string; reference: number; current: number; movePct: number }>;
  sdkReportedBackend: "webgpu" | "wasm" | null;
  computeBackendIndependentlyVerified: false;
  financialActionAuthorized: false;
}

export interface ChallengeScores {
  total: number;
  sdkReceipts: number;
  formatMatches: number;
  numericalMatches: number;
  numericalScorable: number;
  unsupportedClaimSignals: number;
  reviewOnlyMatches: number;
}

export interface NegativeControlAudit {
  schema: "phibot.market.validator-controls.v1";
  description: "Validator self-test, NEVER sent to model; not model robustness proof";
  total: number;
  correctlyHeld: number;
  falseAcceptances: number;
  cases: readonly Readonly<{ caseId: string; control: string; held: boolean }>[];
}

const SYMBOLS = ["SIM-A", "SIM-B", "SIM-C", "SIM-D", "SIM-E", "SIM-F"] as const;

function seededGenerator(seed: number): () => number {
  let state = seed === 0 ? 0x6d2b79f5 : seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

export function makeDynamicChallengeCases(
  seed: number, now: Date,
): readonly DynamicChallengeCase[] {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("Dynamic challenge requires an unsigned 32-bit seed.");
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid challenge clock.");
  const next = seededGenerator(seed);
  const first = next() % SYMBOLS.length;
  const second = (first + 1 + (next() % (SYMBOLS.length - 1))) % SYMBOLS.length;
  const symbols = [SYMBOLS[first]!, SYMBOLS[second]!] as const;
  return Object.freeze(symbols.map((symbol, i) => {
    const reference = (2 + next() % 28) * 100;
    const changeMagnitude = 2 + next() % 8;
    const signedPct = (next() % 2 === 0 ? 1 : -1) * changeMagnitude;
    const current = reference + reference * signedPct / 100;
    const threshold = 1 + next() % Math.min(4, changeMagnitude);
    const observation = assessMarketTick({
      symbol,
      referencePrice: reference,
      price: current,
      sourceUrl: "https://synthetic.example/fixture/" + symbol,
      sourceTime: now.toISOString(),
    }, { allowedHosts: ["synthetic.example"], minimumMovePct: threshold }, now);
    // The reference is a multiple of 100, so generated percentages are exact integers.
    if (Math.abs(observation.movePct - signedPct) > 1e-8 || observation.status !== "alert") {
      throw new Error("Internal synthetic fixture arithmetic mismatch.");
    }
    return Object.freeze({
      schema: "phibot.market.dynamic-case.v1" as const,
      id: "case-" + (i + 1),
      botId: (i === 0 ? "phibot-scout" : "phibot-skeptic") as DynamicChallengeCase["botId"],
      observation,
    });
  }));
}

/** No example answer or expected percentage is supplied to the model. */
export function dynamicChallengePrompt(test: DynamicChallengeCase): string {
  const o = test.observation;
  return [
    "You are a read-only PhiBot in an INVENTED arithmetic exercise, not a real market.",
    "Use only the supplied synthetic symbol, reference and current price.",
    "Compute the signed percentage: ((CURRENT - REFERENCE) / REFERENCE) * 100.",
    "Use integer arithmetic for this exercise. Do not invent reasons, news or trading advice.",
    "Output EXACTLY one line and no additional text:",
    "SYMBOL=<SYMBOL>;REFERENCE=<INTEGER>;CURRENT=<INTEGER>;MOVE_PCT=<SIGNED_INTEGER>;CAUSE=UNKNOWN",
    "Angle bracket names are placeholders, not literal output. Replace with observed values.",
    "Synthetic symbol: " + o.symbol,
    "Synthetic reference: " + o.referencePrice,
    "Synthetic current: " + o.price,
    "Synthetic alert threshold (not the move percent): " + o.thresholdPct,
    "No external source was verified. Do not echo these instructions.",
  ].join("\n");
}

const STRICT = /^SYMBOL=([A-Z0-9-]{3,16});REFERENCE=(\d{1,6});CURRENT=(\d{1,6});MOVE_PCT=([+-]?\d{1,2});CAUSE=UNKNOWN$/;
const CLAIM_SIGNAL = /\b(because|due to|caused by|driven by|surge in demand|market slowdown|buy|sell|trade now|profit|guaranteed|news report)\b/i;

export function checkDynamicResponse(
  test: DynamicChallengeCase, response: TinyAdvisory,
): Readonly<DynamicChallengeCheck> {
  const rawText = response.status === "advisory" ? response.text.slice(0, 800) : null;
  const receiptValid = response.status === "advisory" && response.botId === test.botId;
  const text = rawText?.trim() ?? "";
  const matches = STRICT.exec(text);
  const formatCompliant = matches !== null && text === rawText;
  const o = test.observation;
  const expectedPct = ((o.price - o.referencePrice) / o.referencePrice) * 100;
  const expected = Object.freeze({
    symbol: o.symbol, reference: o.referencePrice, current: o.price,
    movePct: Math.round(expectedPct),
  });
  const symbolMatches = matches ? matches[1] === expected.symbol : null;
  const numericalAccuracy: DynamicChallengeCheck["numericalAccuracy"] = matches
    ? (Number(matches[2]) === expected.reference &&
       Number(matches[3]) === expected.current &&
       Number(matches[4]) === expected.movePct &&
       Math.abs(expectedPct - expected.movePct) < 1e-8 ? "MATCH" : "MISMATCH")
    : "NOT_SCORABLE";
  const claimDetected = CLAIM_SIGNAL.test(text) ||
    /\bCAUSE\s*=\s*(?!UNKNOWN(?:$|;|\s))\S+/i.test(text);
  const reasons: ChallengeReason[] = [];
  if (!receiptValid) reasons.push("NO_VALID_SDK_RECEIPT");
  if (!formatCompliant) reasons.push("FORMAT_MISMATCH");
  if (numericalAccuracy === "MISMATCH") reasons.push("NUMERIC_MISMATCH");
  if (symbolMatches === false) reasons.push("SYMBOL_MISMATCH");
  if (claimDetected) reasons.push("UNSUPPORTED_CLAIM_DETECTED");
  if (text && !text.endsWith("CAUSE=UNKNOWN")) reasons.push("POSSIBLE_TRUNCATION");
  return Object.freeze({
    schema: "phibot.market.dynamic-check.v1" as const,
    caseId: test.id,
    botId: test.botId,
    disposition: reasons.length === 0
      ? "MATCHES_SYNTHETIC_FIXTURE_REVIEW_ONLY" as const
      : "HELD_FOR_HUMAN_REVIEW" as const,
    inferenceReceiptValid: receiptValid,
    formatCompliant,
    numericalAccuracy,
    symbolMatches,
    unsupportedClaimSignal: claimDetected ? "DETECTED" as const : "NOT_DETECTED" as const,
    reasonCodes: Object.freeze(reasons),
    rawText,
    expected,
    sdkReportedBackend: response.status === "advisory" ? response.sdkReportedBackend : null,
    computeBackendIndependentlyVerified: false as const,
    financialActionAuthorized: false as const,
  });
}

export function scoreDynamicChecks(checks: readonly DynamicChallengeCheck[]): Readonly<ChallengeScores> {
  return Object.freeze({
    total: checks.length,
    sdkReceipts: checks.filter(x => x.inferenceReceiptValid).length,
    formatMatches: checks.filter(x => x.formatCompliant).length,
    numericalMatches: checks.filter(x => x.numericalAccuracy === "MATCH").length,
    numericalScorable: checks.filter(x => x.numericalAccuracy !== "NOT_SCORABLE").length,
    unsupportedClaimSignals: checks.filter(x => x.unsupportedClaimSignal === "DETECTED").length,
    reviewOnlyMatches: checks.filter(x => x.disposition === "MATCHES_SYNTHETIC_FIXTURE_REVIEW_ONLY").length,
  });
}

function localAdvisory(test: DynamicChallengeCase, text: string): TinyAdvisory {
  return Object.freeze({
    status: "advisory" as const, botId: test.botId, text,
    model: null, receiptSchema: "POCKETBRAIN_TINY_RUN_V2" as const,
    provenance: "unverified-model-output" as const,
    sdkReportedBackend: null, sdkReportedModel: null, sdkReportedDtype: null,
  });
}

export function auditNegativeControls(cases: readonly DynamicChallengeCase[]): Readonly<NegativeControlAudit> {
  const inspected: Array<Readonly<{ caseId: string; control: string; held: boolean }>> = [];
  for (const test of cases) {
    const o = test.observation;
    const percent = Math.round(((o.price - o.referencePrice) / o.referencePrice) * 100);
    const correct = "SYMBOL=" + o.symbol + ";REFERENCE=" + o.referencePrice +
      ";CURRENT=" + o.price + ";MOVE_PCT=" + percent + ";CAUSE=UNKNOWN";
    const controls: readonly [string, string][] = [
      ["wrong-percent", correct.replace(";MOVE_PCT=" + percent + ";", ";MOVE_PCT=" + (percent + 1) + ";")],
      ["wrong-current", correct.replace(";CURRENT=" + o.price + ";", ";CURRENT=" + (o.price + 1) + ";")],
      ["wrong-symbol", correct.replace("SYMBOL=" + o.symbol + ";", "SYMBOL=SIM-Z;")],
      ["invented-cause", correct.replace("CAUSE=UNKNOWN", "CAUSE=DEMAND")],
      ["extra-claim", correct + " A surge in demand caused the move."],
      ["truncated", correct.slice(0, -7)],
    ];
    for (const [control, candidate] of controls) {
      const review = checkDynamicResponse(test, localAdvisory(test, candidate));
      inspected.push(Object.freeze({
        caseId: test.id, control,
        held: review.disposition === "HELD_FOR_HUMAN_REVIEW",
      }));
    }
  }
  const correctlyHeld = inspected.filter(x => x.held).length;
  return Object.freeze({
    schema: "phibot.market.validator-controls.v1" as const,
    description: "Validator self-test, NEVER sent to model; not model robustness proof" as const,
    total: inspected.length,
    correctlyHeld, falseAcceptances: inspected.length - correctlyHeld,
    cases: Object.freeze(inspected),
  });
}
