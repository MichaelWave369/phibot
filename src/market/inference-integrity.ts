import type { CapabilityLevel, CapabilityProbe, CapabilityReview } from "./capability-ladder.js";
import { CAPABILITY_LEVELS, makeCapabilityProbe, reviewCapabilityProbe } from "./capability-ladder.js";
import type { DynamicChallengeCase } from "./dynamic-challenge.js";
import type { TinyAdvisory } from "./pocketbrain-tiny.js";

/** This describes a tokenizer's optional local rendering, not attested input token IDs. */
export interface TemplateInspection {
  schema: "phibot.market.template-inspection.v1";
  status: "TOKENIZER_RENDERED" | "API_UNAVAILABLE" | "RENDER_ERROR";
  method: "apply_chat_template";
  addGenerationPromptRequested: true;
  inputMessages: "VENDORED_SYSTEM_PLUS_USER";
  renderedPreview: string | null;
  renderedLength: number | null;
  previewClipped: boolean;
  exactGeneratorInputTokenSequenceVerified: false;
  errorClass: string | null;
}

export interface IntegrityReceipt {
  sdkReceiptValid: boolean;
  sdkReportedModel: string | null;
  sdkReportedBackend: string | null;
  sdkReportedDtype: string | null;
  sdkReportedDecodeMode: string | null;
  generationWallMs: number | null;
  observedTokenCallbacks: number | null;
  promptChars: number | null;
  outputChars: number | null;
  timeToFirstTokenMs: number | null;
  runtimeFinishReasonAvailable: false;
  hardwareIndependentlyVerified: false;
}

export interface IntegrityReview {
  schema: "phibot.market.integrity-review.v1";
  level: CapabilityLevel;
  caseId: string;
  botId: string;
  rawText: string | null;
  hostExpectedText: string;
  strictReview: CapabilityReview;
  echoSignals: readonly ("EXACT_PROMPT" | "REPEATED_FORMAT_PLACEHOLDERS" | "COPIED_INPUT_PHRASE")[];
  receipt: IntegrityReceipt;
  disposition: "HELD_FOR_HUMAN_REVIEW" | "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY";
}

/** One case, one attempt per tier; the input seed determines all numbers. */
export function makeIntegrityProbes(caseA: DynamicChallengeCase): readonly CapabilityProbe[] {
  return Object.freeze(CAPABILITY_LEVELS.map(level => makeCapabilityProbe(caseA, level)));
}

export function detectIntegrityEcho(
  prompt: string, rawText: string | null,
): readonly ("EXACT_PROMPT" | "REPEATED_FORMAT_PLACEHOLDERS" | "COPIED_INPUT_PHRASE")[] {
  if (!rawText?.trim()) return Object.freeze([]);
  const raw = rawText.trim();
  const flags: Array<"EXACT_PROMPT" | "REPEATED_FORMAT_PLACEHOLDERS" | "COPIED_INPUT_PHRASE"> = [];
  if (raw === prompt.trim() || (raw.length > 25 && prompt.includes(raw))) {
    flags.push("EXACT_PROMPT");
  }
  if (/SYMBOL=<[^>]+>;REF=<[^>]+>;CUR=<[^>]+>;DELTA=<[^>]+>;PCT=<[^>]+>;CAUSE=UNKNOWN/i.test(raw) ||
      /(?:SYMBOL=<ID>|REF=<N>|CUR=<N>|DELTA=<N>)/i.test(raw)) {
    flags.push("REPEATED_FORMAT_PLACEHOLDERS");
  }
  const copied = [
    /Synthetic prices:\s*reference\s+\d+,\s*current\s+\d+/i,
    /Fictional symbol\s+SIM-[A-F];\s*reference\s+\d+;\s*current\s+\d+/i,
    /Compute \d+ \+ \d+/i,
  ].some(pattern => {
    const snippet = pattern.exec(raw)?.[0];
    return snippet && prompt.includes(snippet);
  });
  if (copied) flags.push("COPIED_INPUT_PHRASE");
  return Object.freeze(flags);
}

function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function inspectIntegrityReceipt(value: unknown): Readonly<IntegrityReceipt> {
  const r = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const valid = r.schema === "POCKETBRAIN_TINY_RUN_V2";
  return Object.freeze({
    sdkReceiptValid: valid,
    sdkReportedModel: typeof r.model === "string" ? r.model.slice(0, 120) : null,
    sdkReportedBackend: r.backend === "webgpu" || r.backend === "wasm" ? r.backend : null,
    sdkReportedDtype: typeof r.dtype === "string" ? r.dtype.slice(0, 30) : null,
    sdkReportedDecodeMode: r.mode === "baseline" || r.mode === "guarded" ? r.mode : null,
    generationWallMs: nonnegative(r.generation_wall_ms),
    observedTokenCallbacks: nonnegative(r.observed_token_callback_events),
    promptChars: nonnegative(r.prompt_char_count),
    outputChars: nonnegative(r.output_char_count),
    timeToFirstTokenMs: nonnegative(r.time_to_first_token_callback_ms),
    runtimeFinishReasonAvailable: false as const,
    hardwareIndependentlyVerified: false as const,
  });
}

export function reviewIntegrityProbe(
  probe: CapabilityProbe, response: TinyAdvisory, receiptValue: unknown,
): Readonly<IntegrityReview> {
  const strictReview = reviewCapabilityProbe(probe, response);
  const receipt = inspectIntegrityReceipt(receiptValue);
  const echoSignals = detectIntegrityEcho(probe.prompt, strictReview.rawText);
  const authorizedMatch = receipt.sdkReceiptValid &&
    strictReview.disposition === "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY" &&
    echoSignals.length === 0;
  return Object.freeze({
    schema: "phibot.market.integrity-review.v1" as const,
    level: probe.level,
    caseId: probe.caseId, botId: probe.botId,
    rawText: strictReview.rawText,
    hostExpectedText: probe.expectedText,
    strictReview,
    echoSignals,
    receipt,
    disposition: authorizedMatch
      ? "MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY" as const
      : "HELD_FOR_HUMAN_REVIEW" as const,
  });
}

/** Pure local comparison; different dtype/precision means this is NOT same-execution parity. */
export function compareIntegrityRuns(
  left: {seed:number; sdkReportedBackend:string|null; sdkReportedDtype:string|null; sdkReportedModel:string|null; attempts:readonly {probe:CapabilityProbe; review:IntegrityReview}[]},
  right: {seed:number; sdkReportedBackend:string|null; sdkReportedDtype:string|null; sdkReportedModel:string|null; attempts:readonly {probe:CapabilityProbe; review:IntegrityReview}[]},
) {
  const equalInputs = left.seed === right.seed &&
    left.attempts.length === right.attempts.length &&
    left.attempts.every((item, i) =>
      item.probe.prompt === right.attempts[i]?.probe.prompt &&
      item.probe.expectedText === right.attempts[i]?.probe.expectedText);
  const comparable = equalInputs && left.sdkReportedModel !== null &&
    left.sdkReportedModel === right.sdkReportedModel;
  const outputIdentical = comparable && left.attempts.every((item, i) =>
    item.review.rawText === right.attempts[i]?.review.rawText);
  return Object.freeze({
    schema: "phibot.market.manual-backend-comparison.v1" as const,
    sameSeed: left.seed === right.seed,
    sameInputs: equalInputs,
    sameSdkModelClaim: left.sdkReportedModel !== null && left.sdkReportedModel === right.sdkReportedModel,
    backendA: left.sdkReportedBackend,
    backendB: right.sdkReportedBackend,
    dtypeA: left.sdkReportedDtype,
    dtypeB: right.sdkReportedDtype,
    outputsIdentical: comparable ? outputIdentical : null,
    backendClaimsDiffer: left.sdkReportedBackend !== null && right.sdkReportedBackend !== null &&
      left.sdkReportedBackend !== right.sdkReportedBackend,
    sameQuantization: left.sdkReportedDtype !== null && left.sdkReportedDtype === right.sdkReportedDtype,
    independentlyAttested: false as const,
    numericalParityProven: false as const,
    comparisonAvailable: comparable,
  });
}
