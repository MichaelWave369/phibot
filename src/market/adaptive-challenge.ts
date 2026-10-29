import type { DynamicChallengeCase } from "./dynamic-challenge.js";
import { checkDynamicResponse } from "./dynamic-challenge.js";
import type { TinyAdvisory } from "./pocketbrain-tiny.js";

export type AdaptiveStrategy = "compact-fields" | "percent-only-guarded";

export interface AdaptiveAttemptReview {
  schema: "phibot.market.adaptive-review.v1";
  strategy: AdaptiveStrategy;
  caseId: string;
  botId: string;
  sdkReceiptValid: boolean;
  formatMatch: boolean;
  numericAccuracy: "MATCH" | "MISMATCH" | "NOT_SCORABLE";
  outputShape: "COMPLETE" | "UNPARSEABLE";
  promptEchoSignal: "INPUT_OR_INSTRUCTION_ECHO_DETECTED" | "NOT_DETECTED";
  unsupportedClaimSignal: "DETECTED" | "NOT_DETECTED";
  generationEndReason: "NOT_REPORTED_BY_SDK";
  hostCaptureClipped: boolean;
  disposition: "MATCHES_SYNTHETIC_ARITHMETIC_REVIEW_ONLY" | "HELD_FOR_HUMAN_REVIEW";
  rawText: string | null;
  expectedMovePct: number;
  reasonCodes: readonly string[];
  financialActionAuthorized: false;
}

export function adaptivePrompt(test: DynamicChallengeCase, strategy: AdaptiveStrategy): string {
  const o = test.observation;
  if (strategy === "compact-fields") {
    return [
      "Fictional arithmetic only. Never explain a market move.",
      "Symbol " + o.symbol + ", reference " + o.referencePrice + ", current " + o.price + ".",
      "Calculate signed percent: 100*(current-reference)/reference.",
      "One line only: SYMBOL=<ID>;REFERENCE=<REF>;CURRENT=<CUR>;MOVE_PCT=<INTEGER>;CAUSE=UNKNOWN",
    ].join("\n");
  }
  if (strategy === "percent-only-guarded") {
    return [
      "Arithmetic exercise. Calculate: 100 * (" + o.price + " - " + o.referencePrice + ") / " +
        o.referencePrice + " = ?",
      "Output one signed integer only. No other words, units, news or explanation.",
    ].join("\n");
  }
  throw new Error("Unknown diagnostic prompt strategy.");
}

const PERCENT_ONLY = /^[+-]?\d{1,2}$/;
const ECHO_INPUT = /(?:Synthetic symbol:|Synthetic reference:|Synthetic current:|Synthetic alert threshold:|Do not echo these instructions|Output EXACTLY|One line only:|Arithmetic exercise\. Calculate:|Output one signed integer only|Fictional arithmetic only|Symbol [A-Z]+-[A-Z], reference)/i;
const EXTRA_CLAIMS = /\b(?:because|due to|caused by|driven by|market demand|surge in demand|buy|sell|trade now|guaranteed|profit|news report)\b/i;

/** Diagnose only what is observable. No SDK finish reason exists for this integration. */
export function reviewAdaptiveAttempt(
  test: DynamicChallengeCase, strategy: AdaptiveStrategy, response: TinyAdvisory,
): Readonly<AdaptiveAttemptReview> {
  const sdkReceiptValid = response.status === "advisory" && response.botId === test.botId;
  const rawText = response.status === "advisory" ? response.text : null;
  const text = rawText?.trim() ?? "";
  const actualPct = ((test.observation.price - test.observation.referencePrice) /
    test.observation.referencePrice) * 100;
  const expectedMovePct = Math.round(actualPct);
  const correctInteger = Math.abs(actualPct - expectedMovePct) < 1e-8;
  const echoDetected = ECHO_INPUT.test(text) ||
    (text.includes("Synthetic symbol: " + test.observation.symbol) &&
     text.includes("Synthetic reference: " + test.observation.referencePrice));
  const claimDetected = EXTRA_CLAIMS.test(text) ||
    /\bCAUSE\s*=\s*(?!UNKNOWN(?:$|;|\s))\S+/i.test(text);

  let formatMatch = false;
  let numericAccuracy: AdaptiveAttemptReview["numericAccuracy"] = "NOT_SCORABLE";
  if (strategy === "compact-fields") {
    const existing = checkDynamicResponse(test, response);
    formatMatch = existing.formatCompliant;
    numericAccuracy = existing.numericalAccuracy;
  } else if (strategy === "percent-only-guarded") {
    formatMatch = PERCENT_ONLY.test(text) && text === rawText;
    if (formatMatch) {
      numericAccuracy = correctInteger && Number(text) === expectedMovePct ? "MATCH" : "MISMATCH";
    }
  } else {
    throw new Error("Unknown diagnostic prompt strategy.");
  }

  const reasons: string[] = [];
  if (!sdkReceiptValid) reasons.push("NO_VALID_SDK_RECEIPT");
  if (!formatMatch) reasons.push("FORMAT_MISMATCH");
  if (numericAccuracy === "MISMATCH") reasons.push("NUMERIC_MISMATCH");
  if (numericAccuracy === "NOT_SCORABLE") reasons.push("NUMERIC_NOT_SCORABLE");
  if (echoDetected) reasons.push("PROMPT_ECHO_SIGNAL");
  if (claimDetected) reasons.push("UNSUPPORTED_CLAIM_SIGNAL");
  const hostCaptureClipped = response.status === "advisory"
    ? response.hostCaptureClipped === true : false;
  if (hostCaptureClipped) reasons.push("HOST_CAPTURE_CLIPPED");

  return Object.freeze({
    schema: "phibot.market.adaptive-review.v1" as const,
    strategy,
    caseId: test.id,
    botId: test.botId,
    sdkReceiptValid,
    formatMatch,
    numericAccuracy,
    outputShape: formatMatch ? "COMPLETE" as const : "UNPARSEABLE" as const,
    promptEchoSignal: echoDetected
      ? "INPUT_OR_INSTRUCTION_ECHO_DETECTED" as const
      : "NOT_DETECTED" as const,
    unsupportedClaimSignal: claimDetected ? "DETECTED" as const : "NOT_DETECTED" as const,
    generationEndReason: "NOT_REPORTED_BY_SDK" as const,
    hostCaptureClipped,
    disposition: reasons.length === 0
      ? "MATCHES_SYNTHETIC_ARITHMETIC_REVIEW_ONLY" as const
      : "HELD_FOR_HUMAN_REVIEW" as const,
    rawText,
    expectedMovePct,
    reasonCodes: Object.freeze(reasons),
    financialActionAuthorized: false as const,
  });
}
