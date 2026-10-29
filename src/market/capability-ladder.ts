import type { DynamicChallengeCase } from "./dynamic-challenge.js";
import type { TinyAdvisory } from "./pocketbrain-tiny.js";

export type CapabilityLevel = "integer-addition" | "percentage-change" | "structured-observation";
export const CAPABILITY_LEVELS: readonly CapabilityLevel[] = Object.freeze([
  "integer-addition", "percentage-change", "structured-observation",
]);

export interface CapabilityProbe {
  schema: "phibot.market.capability-probe.v1";
  caseId: string;
  botId: DynamicChallengeCase["botId"];
  level: CapabilityLevel;
  prompt: string;
  expectedText: string;
  expectedValue: number;
  input: Readonly<{ left: number; right: number; symbol: string }>;
}

/** Pure, deterministic host truth, never supplied as a completed prompt answer. */
export function makeCapabilityProbe(
  test: DynamicChallengeCase, level: CapabilityLevel,
): Readonly<CapabilityProbe> {
  if (!CAPABILITY_LEVELS.includes(level)) throw new Error("Unknown capability level.");
  const o = test.observation;
  if (!/^SIM-[A-F]$/.test(o.symbol) || !Number.isInteger(o.price) ||
      !Number.isInteger(o.referencePrice) ||
      o.sourceUrl !== "https://synthetic.example/fixture/" + o.symbol ||
      o.provenance !== "source-claimed-unverified") {
    throw new Error("Out-of-scope synthetic capability fixture.");
  }
  const pct = 100 * (o.price - o.referencePrice) / o.referencePrice;
  if (!Number.isInteger(Math.round(pct)) || Math.abs(pct - Math.round(pct)) > 1e-8) {
    throw new Error("Capability percentage must be integer-valued.");
  }
  const left = 2 + o.referencePrice % 7;
  const right = 2 + o.price % 7;
  let prompt: string;
  let expectedText: string;
  let expectedValue: number;
  if (level === "integer-addition") {
    prompt = "Compute " + left + " + " + right + ". Answer with one integer only.";
    expectedValue = left + right;
    expectedText = String(expectedValue);
  } else if (level === "percentage-change") {
    prompt = "Synthetic prices: reference " + o.referencePrice + ", current " + o.price +
      ". Percentage change = 100 * (current - reference) / reference. Reply with one signed integer only.";
    expectedValue = Math.round(pct);
    expectedText = String(expectedValue);
  } else {
    prompt = "Fictional symbol " + o.symbol + "; reference " + o.referencePrice +
      "; current " + o.price + ". Calculate delta and signed percentage. " +
      "Reply as one line: SYMBOL=<ID>;REF=<N>;CUR=<N>;DELTA=<N>;PCT=<N>;CAUSE=UNKNOWN";
    expectedValue = Math.round(pct);
    expectedText = "SYMBOL=" + o.symbol + ";REF=" + o.referencePrice + ";CUR=" + o.price +
      ";DELTA=" + (o.price - o.referencePrice) +
      ";PCT=" + expectedValue + ";CAUSE=UNKNOWN";
  }
  return Object.freeze({
    schema: "phibot.market.capability-probe.v1" as const,
    caseId: test.id, botId: test.botId, level, prompt, expectedText, expectedValue,
    input: Object.freeze({left, right, symbol: o.symbol}),
  });
}

export type CapabilityReason = "NO_VALID_RECEIPT" | "FORMAT_MISMATCH" |
  "NUMERIC_MISMATCH" | "SYMBOL_MISMATCH" | "PROMPT_ECHO_SIGNAL" |
  "UNSUPPORTED_CLAIM_SIGNAL" | "HOST_CAPTURE_CLIPPED";

export interface CapabilityReview {
  schema: "phibot.market.capability-review.v1";
  caseId: string;
  botId: string;
  level: CapabilityLevel;
  sdkReceiptValid: boolean;
  formatCompliant: boolean;
  numericAccuracy: "MATCH" | "MISMATCH" | "NOT_SCORABLE";
  promptEchoSignal: boolean;
  unsupportedClaimSignal: boolean;
  disposition: "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY" | "HELD_FOR_HUMAN_REVIEW";
  reasonCodes: readonly CapabilityReason[];
  rawText: string | null;
  expectedText: string;
  sdkReportedBackend: "webgpu" | "wasm" | null;
  generationFinishReason: "NOT_REPORTED_BY_SDK";
  independentModelAttestation: false;
  sourceVerified: false;
  financialActionsAuthorized: false;
}

const INTEGER = /^-?(?:0|[1-9]\d{0,5})$/;
const STRUCT = /^SYMBOL=(SIM-[A-F]);REF=(\d{1,5});CUR=(\d{1,5});DELTA=(-?\d{1,5});PCT=(-?\d{1,3});CAUSE=UNKNOWN$/;
const ECHO = /\b(?:Answer with|Reply with|Fictional symbol|Synthetic prices|Percentage change|Calculate delta|one integer only)\b/i;
const CLAIM = /\b(?:because|due to|caused by|surge in demand|buy|sell|trade now|guaranteed profit|news report)\b/i;

export function reviewCapabilityProbe(
  probe: CapabilityProbe, response: TinyAdvisory,
): Readonly<CapabilityReview> {
  const sdkReceiptValid = response.status === "advisory" && response.botId === probe.botId;
  const rawText = response.status === "advisory" ? response.text : null;
  const text = rawText?.trim() ?? "";
  let formatCompliant: boolean;
  let numericAccuracy: CapabilityReview["numericAccuracy"] = "NOT_SCORABLE";
  let symbolMismatch = false;
  if (probe.level === "structured-observation") {
    const match = STRUCT.exec(text);
    formatCompliant = Boolean(match) && text === rawText;
    if (match) {
      symbolMismatch = match[1] !== probe.input.symbol;
      const correct = probe.expectedText.match(STRUCT);
      numericAccuracy = correct &&
        Number(match[2]) === Number(correct[2]) &&
        Number(match[3]) === Number(correct[3]) &&
        Number(match[4]) === Number(correct[4]) &&
        Number(match[5]) === Number(correct[5]) ? "MATCH" : "MISMATCH";
    }
  } else {
    formatCompliant = INTEGER.test(text) && text === rawText;
    if (formatCompliant) {
      numericAccuracy = Number(text) === probe.expectedValue ? "MATCH" : "MISMATCH";
    }
  }
  const promptEchoSignal = ECHO.test(text);
  const unsupportedClaimSignal = CLAIM.test(text) || /\bCAUSE\s*=\s*(?!UNKNOWN(?:$|;|\s))\S+/i.test(text);
  const reasons: CapabilityReason[] = [];
  if (!sdkReceiptValid) reasons.push("NO_VALID_RECEIPT");
  if (!formatCompliant) reasons.push("FORMAT_MISMATCH");
  if (numericAccuracy === "MISMATCH") reasons.push("NUMERIC_MISMATCH");
  if (symbolMismatch) reasons.push("SYMBOL_MISMATCH");
  if (promptEchoSignal) reasons.push("PROMPT_ECHO_SIGNAL");
  if (unsupportedClaimSignal) reasons.push("UNSUPPORTED_CLAIM_SIGNAL");
  if (response.status === "advisory" && response.hostCaptureClipped) {
    reasons.push("HOST_CAPTURE_CLIPPED");
  }
  return Object.freeze({
    schema: "phibot.market.capability-review.v1" as const,
    caseId: probe.caseId, botId: probe.botId, level: probe.level,
    sdkReceiptValid, formatCompliant, numericAccuracy, promptEchoSignal, unsupportedClaimSignal,
    disposition: reasons.length === 0
      ? "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY" as const
      : "HELD_FOR_HUMAN_REVIEW" as const,
    reasonCodes: Object.freeze(reasons),
    rawText, expectedText: probe.expectedText,
    sdkReportedBackend: response.status === "advisory" ? response.sdkReportedBackend : null,
    generationFinishReason: "NOT_REPORTED_BY_SDK" as const,
    independentModelAttestation: false as const,
    sourceVerified: false as const,
    financialActionsAuthorized: false as const,
  });
}

export function summarizeCapabilityReviews(reviews: readonly CapabilityReview[]) {
  return CAPABILITY_LEVELS.map(level => {
    const selected = reviews.filter(x => x.level === level);
    return Object.freeze({
      level,
      total: selected.length,
      receipts: selected.filter(x => x.sdkReceiptValid).length,
      formatMatches: selected.filter(x => x.formatCompliant).length,
      numericalScorable: selected.filter(x => x.numericAccuracy !== "NOT_SCORABLE").length,
      numericalMatches: selected.filter(x => x.numericAccuracy === "MATCH").length,
      reviewOnlyMatches: selected.filter(x =>
        x.disposition === "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY").length,
    });
  });
}
