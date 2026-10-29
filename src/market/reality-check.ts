import type { MarketObservation } from "./observation.js";
import type { TinyAdvisory } from "./pocketbrain-tiny.js";

export type RealityReason =
  | "FIXTURE_SCOPE_REFUSED"
  | "NO_VALID_ADVISORY"
  | "EMPTY_OUTPUT"
  | "OVERSIZED_OUTPUT"
  | "POSSIBLE_TRUNCATION"
  | "PROMPT_ECHO"
  | "UNSUPPORTED_CAUSAL_CLAIM"
  | "NOT_EXACTLY_SUPPORTED";

export interface TinyRealityCheck {
  schema: "phibot.market.reality-check.v1";
  botId: string;
  disposition: "RESTRICTED_MATCH_REVIEW_ONLY" | "HELD_FOR_HUMAN_REVIEW";
  reasonCodes: readonly RealityReason[];
  // Original text stays local and untrusted, even if it matches a permitted sentence.
  rawText: string | null;
  // This is generated deterministically from the synthetic fixture, NOT from a model.
  fixtureStatement: string;
  sdkReportedBackend: "webgpu" | "wasm" | null;
  sdkReportedModel: string | null;
  sdkReportedDtype: string | null;
  independentModelAttestation: false;
  actualSourceVerified: false;
  financialActionAuthorized: false;
}

// This gate deliberately recognizes only a narrowly specified, synthetic exercise.
// It is NOT a general factuality detector and does not validate a model's reasoning.
const EXACT_SAFE_RESPONSES = new Set([
  "the synthetic btc-usd fixture moved from 100 to 104 (+4%). the cause is unknown.",
  "synthetic btc-usd increased from 100 to 104, a 4% move. no cause is established.",
  "synthetic btc-usd: 100 to 104 (+4%). no cause is established.",
]);
const ECHO = /do not (invent|claim|recommend)|source verification is not available|respond in at most|bot:\s*(phibot-|scout|skeptic)/i;
const CAUSAL = /\b(because|due to|caused by|driven by|surge in demand|slowdown|market had been|anticipated by the market|factors including)\b/i;

function isKnownSyntheticFixture(o: Readonly<MarketObservation>): boolean {
  return o.schema === "phibot.market.observation.v1" &&
    o.symbol === "BTC-USD" && o.price === 104 && o.referencePrice === 100 &&
    o.movePct === 4 && o.status === "alert" && o.thresholdPct === 3 &&
    o.sourceUrl === "https://synthetic.example/fixture/BTC-USD" &&
    o.provenance === "source-claimed-unverified" &&
    Number.isFinite(Date.parse(o.checkedAt)) &&
    o.checkedAt === o.sourceTime;
}

export function checkTinyAdvisory(
  advisory: TinyAdvisory,
  observation: Readonly<MarketObservation>,
): Readonly<TinyRealityCheck> {
  const rawText = advisory.status === "advisory" ? advisory.text.slice(0, 800) : null;
  const reasons: RealityReason[] = [];
  if (!isKnownSyntheticFixture(observation)) reasons.push("FIXTURE_SCOPE_REFUSED");
  if (advisory.status !== "advisory") reasons.push("NO_VALID_ADVISORY");
  if (rawText !== null) {
    const text = rawText.trim().replace(/\s+/g, " ");
    if (!text) reasons.push("EMPTY_OUTPUT");
    if (rawText.length > 240) reasons.push("OVERSIZED_OUTPUT");
    if (text && !/[.!?]$/.test(text)) reasons.push("POSSIBLE_TRUNCATION");
    if (ECHO.test(text)) reasons.push("PROMPT_ECHO");
    if (CAUSAL.test(text)) reasons.push("UNSUPPORTED_CAUSAL_CLAIM");
    if (!EXACT_SAFE_RESPONSES.has(text.toLowerCase())) reasons.push("NOT_EXACTLY_SUPPORTED");
  }
  return Object.freeze({
    schema: "phibot.market.reality-check.v1" as const,
    botId: advisory.botId,
    disposition: reasons.length === 0
      ? "RESTRICTED_MATCH_REVIEW_ONLY" as const
      : "HELD_FOR_HUMAN_REVIEW" as const,
    reasonCodes: Object.freeze(reasons),
    rawText,
    fixtureStatement: "Synthetic BTC-USD: 100 to 104 (+4.00%). Cause unknown; source not verified.",
    sdkReportedBackend: advisory.status === "advisory" ? advisory.sdkReportedBackend : null,
    sdkReportedModel: advisory.status === "advisory" ? advisory.sdkReportedModel : null,
    sdkReportedDtype: advisory.status === "advisory" ? advisory.sdkReportedDtype : null,
    independentModelAttestation: false as const,
    actualSourceVerified: false as const,
    financialActionAuthorized: false as const,
  });
}
