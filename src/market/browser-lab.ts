import { assessMarketTick, type MarketObservation } from "./observation.js";
import { PocketBrainTinyFleet, type TinyAdvisory, type TinySdkClient } from "./pocketbrain-tiny.js";
import { checkTinyAdvisory, type TinyRealityCheck } from "./reality-check.js";
import { auditNegativeControls, checkDynamicResponse, makeDynamicChallengeCases, scoreDynamicChecks,
  type DynamicChallengeCase, type DynamicChallengeCheck, type ChallengeScores, type NegativeControlAudit } from "./dynamic-challenge.js";
import { reviewAdaptiveAttempt, type AdaptiveStrategy, type AdaptiveAttemptReview } from "./adaptive-challenge.js";
import { CAPABILITY_LEVELS, makeCapabilityProbe, reviewCapabilityProbe, summarizeCapabilityReviews,
  type CapabilityProbe, type CapabilityReview } from "./capability-ladder.js";
import { makeIntegrityProbes, reviewIntegrityProbe, compareIntegrityRuns,
  type TemplateInspection, type IntegrityReview } from "./inference-integrity.js";

export type TinyDevice = "auto" | "webgpu" | "wasm";
export type BrowserLabPhase = "idle" | "loading" | "ready" | "running" | "disposing" | "error";

export interface BrowserTinyClient extends TinySdkClient {
  load(options: { preferredDevice: TinyDevice; onProgress?: (event: unknown) => void }): Promise<unknown>;
  inspectPrompt?(prompt: string): Promise<TemplateInspection>;
  dispose(): Promise<void>;
}

export interface BrowserLabReport {
  schema: "phibot.browser-market-lab.v2";
  fixture: "SYNTHETIC_ONLY";
  runAt: string;
  runId: string;
  observation: Readonly<MarketObservation>;
  sessions: readonly TinyAdvisory[];
  realityChecks: readonly TinyRealityCheck[];
  restrictedMatchCount: number;
  sdkReportedBackend: "webgpu" | "wasm" | null;
  sdkReportedDtype: string | null;
  sdkReportedModel: string | null;
  computeBackendIndependentlyVerified: false;
  sdkUrl: string;
  model: string | null;
  sdkStatus: string;
  authority: "READ_ONLY_ADVISORY";
  realPricesChecked: false;
  sourceVerified: false;
  modelOutputTrusted: false;
  financialActionsAuthorized: false;
}

export interface DynamicChallengeReport {
  schema: "phibot.browser-dynamic-challenge.v1";
  fixture: "SEEDED_SYNTHETIC_ONLY";
  runAt: string;
  runId: string;
  seed: number;
  cases: readonly DynamicChallengeCase[];
  sessions: readonly TinyAdvisory[];
  checks: readonly DynamicChallengeCheck[];
  scores: Readonly<ChallengeScores>;
  negativeControls: Readonly<NegativeControlAudit>;
  validatorSelfTestPassed: boolean;
  sdkReportedBackend: "webgpu" | "wasm" | null;
  sdkReportedDtype: string | null;
  sdkReportedModel: string | null;
  computeBackendIndependentlyVerified: false;
  sdkUrl: string;
  authority: "READ_ONLY_ADVISORY";
  realPricesChecked: false;
  sourceVerified: false;
  modelOutputTrusted: false;
  financialActionsAuthorized: false;
}

export interface AdaptiveChallengeReport {
  schema: "phibot.browser-adaptive-challenge.v1";
  fixture: "SEEDED_SYNTHETIC_ONLY";
  runAt: string;
  runId: string;
  seed: number;
  cases: readonly DynamicChallengeCase[];
  attempts: readonly Readonly<{
    caseId: string;
    strategy: AdaptiveStrategy;
    response: TinyAdvisory;
    review: AdaptiveAttemptReview;
  }>[];
  metrics: Readonly<{
    cases: number;
    generations: number;
    firstPassMatches: number;
    fallbackInvocations: number;
    fallbackRecoveries: number;
    finalReviewOnlyMatches: number;
    promptEchoSignals: number;
    numericalMatches: number;
    numericalScorable: number;
    sdkReceipts: number;
  }>;
  validatorControls: NegativeControlAudit;
  sdkReportedBackend: "webgpu" | "wasm" | null;
  computeBackendIndependentlyVerified: false;
  generationFinishReasonAvailable: false;
  actionAuthority: "READ_ONLY_ADVISORY";
  authority: "READ_ONLY_ADVISORY";
  realPricesChecked: false;
  sourceVerified: false;
  modelOutputTrusted: false;
  financialActionsAuthorized: false;
}

export interface CapabilityLadderReport {
  schema: "phibot.browser-capability-ladder.v1";
  fixture: "SEEDED_SYNTHETIC_ONLY";
  runId: string;
  runAt: string;
  seed: number;
  cases: readonly DynamicChallengeCase[];
  attempts: readonly Readonly<{ probe: CapabilityProbe; response: TinyAdvisory; review: CapabilityReview }>[];
  byLevel: Readonly<ReturnType<typeof summarizeCapabilityReviews>>;
  sdkPromptEnvelope: "VENDORED_SYSTEM_PLUS_USER_MESSAGES";
  sdkRenderedChatTemplateIndependentlyInspected: false;
  repeatability: "REPLAY_SAME_SEED_MANUALLY";
  sdkReportedBackend: "webgpu" | "wasm" | null;
  sdkReportedModel: string | null;
  computeBackendIndependentlyVerified: false;
  authority: "READ_ONLY_ADVISORY";
  realPricesChecked: false;
  sourceVerified: false;
  modelOutputTrusted: false;
  financialActionsAuthorized: false;
}

export interface InferenceIntegrityReport {
  schema: "phibot.browser-inference-integrity.v1";
  fixture: "SEEDED_SYNTHETIC_ONLY";
  runId: string;
  runAt: string;
  seed: number;
  attempts: readonly Readonly<{
    probe: CapabilityProbe;
    templateInspection: TemplateInspection;
    response: TinyAdvisory;
    review: IntegrityReview;
  }>[];
  sdkReportedBackend: "webgpu" | "wasm" | null;
  sdkReportedDtype: string | null;
  sdkReportedModel: string | null;
  sdkVersionClaim: "0.1.0-experimental";
  sdkRuntimeFinishReasonAvailable: false;
  tokenizerRenderingEqualsActualInputTokensProven: false;
  modelAssetsIndependentlyVerified: false;
  computeBackendIndependentlyVerified: false;
  authority: "READ_ONLY_ADVISORY";
  realPricesChecked: false;
  sourceVerified: false;
  modelOutputTrusted: false;
  financialActionsAuthorized: false;
}

/**
 * Experimental browser-only qualification host, not the Node PhiBotRuntime.
 * No storage, fetch, timers, broker tools or ambient model downloads.
 */
export class BrowserMarketLab {
  private phase: BrowserLabPhase = "idle";
  private client: BrowserTinyClient | null = null;
  private fleet: PocketBrainTinyFleet | null = null;
  private reports: Array<BrowserLabReport | DynamicChallengeReport | AdaptiveChallengeReport | CapabilityLadderReport | InferenceIntegrityReport> = [];
  private failure: string | null = null;

  getStatus(): Readonly<{
    phase: BrowserLabPhase;
    model: string | null;
    sdkPhase: string | null;
    sdkReportedBackend: string | null;
    sdkReportedDtype: string | null;
    reportCount: number;
    error: string | null;
  }> {
    return Object.freeze({
      phase: this.phase,
      model: this.client?.getStatus().model ?? null,
      sdkPhase: this.client?.getStatus().phase ?? null,
      sdkReportedBackend: this.client?.getStatus().device ?? null,
      sdkReportedDtype: this.client?.getStatus().dtype ?? null,
      reportCount: this.reports.length,
      error: this.failure,
    });
  }

  /** A snapshot, never a reference to internal mutable history. */
  getReports(): readonly (BrowserLabReport | DynamicChallengeReport | AdaptiveChallengeReport | CapabilityLadderReport | InferenceIntegrityReport)[] {
    return structuredClone(this.reports);
  }

  /**
   * Caller must supply an explicitly affirmative consent value from a button click.
   * Importing PocketBrain's SDK and loading weights both happen inside resolveClient.
   */
  async loadWithConsent(
    consent: boolean,
    resolveClient: () => Promise<BrowserTinyClient>,
    preferredDevice: TinyDevice = "auto",
  ): Promise<void> {
    if (consent !== true) throw new Error("Explicit PocketBrain download consent is required.");
    if (this.phase !== "idle" && this.phase !== "error") throw new Error("Lab is busy or already loaded.");
    if (!["auto", "webgpu", "wasm"].includes(preferredDevice)) throw new Error("Invalid backend.");
    this.phase = "loading";
    this.failure = null;
    let candidate: BrowserTinyClient | null = null;
    try {
      candidate = await resolveClient();
      if (
        !candidate ||
        typeof candidate.load !== "function" ||
        typeof candidate.dispose !== "function" ||
        typeof candidate.generate !== "function" ||
        typeof candidate.getStatus !== "function"
      ) {
        throw new Error("PocketBrain SDK client contract mismatch.");
      }
      await candidate.load({ preferredDevice });
      if (!candidate.getStatus().ready) throw new Error("PocketBrain did not become ready.");
      this.client = candidate;
      this.fleet = new PocketBrainTinyFleet(candidate);
      this.phase = "ready";
    } catch (error) {
      if (candidate && typeof candidate.dispose === "function") {
        try { await candidate.dispose(); } catch { /* do not mask original failure */ }
      }
      this.client = null;
      this.fleet = null;
      this.phase = "error";
      this.failure = error instanceof Error ? error.message : "PocketBrain load failed.";
      throw error;
    }
  }

  /** Both PhiBot identities use a single loaded Tiny client, serialized by PocketBrainTinyFleet. */
  async runSyntheticCrew(sdkUrl: string, now: Date = new Date()): Promise<BrowserLabReport> {
    if (this.phase !== "ready" || !this.client?.getStatus().ready || !this.fleet) {
      throw new Error("Click Load PocketBrain Tiny and complete initialization first.");
    }
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid clock.");
    this.phase = "running";
    try {
      const observation = assessMarketTick(
        {
          symbol: "BTC-USD",
          price: 104,
          referencePrice: 100,
          sourceUrl: "https://synthetic.example/fixture/BTC-USD",
          sourceTime: now.toISOString(),
        },
        { allowedHosts: ["synthetic.example"], minimumMovePct: 3 },
        now,
      );
      const sessions = await Promise.all([
        this.fleet.forBot("phibot-scout").advise(observation),
        this.fleet.forBot("phibot-skeptic").advise(observation),
      ]);
      const reviews = sessions.map(advisory => checkTinyAdvisory(advisory, observation));
      const reported = this.client.getStatus();
      const result: BrowserLabReport = Object.freeze({
        schema: "phibot.browser-market-lab.v2",
        fixture: "SYNTHETIC_ONLY",
        runAt: now.toISOString(),
        runId: "market-lab-" + (this.reports.length + 1),
        observation,
        sessions,
        realityChecks: reviews,
        restrictedMatchCount: reviews.filter(review => review.disposition === "RESTRICTED_MATCH_REVIEW_ONLY").length,
        sdkReportedBackend: reported.device === "webgpu" || reported.device === "wasm" ? reported.device : null,
        sdkReportedDtype: typeof reported.dtype === "string" ? reported.dtype.slice(0, 30) : null,
        sdkReportedModel: typeof reported.model === "string" ? reported.model.slice(0, 120) : null,
        computeBackendIndependentlyVerified: false,
        sdkUrl,
        model: this.client.getStatus().model,
        sdkStatus: this.client.getStatus().phase,
        authority: "READ_ONLY_ADVISORY",
        realPricesChecked: false,
        sourceVerified: false,
        modelOutputTrusted: false,
        financialActionsAuthorized: false,
      });
      this.reports.push(result);
      return structuredClone(result);
    } finally {
      this.phase = "ready";
    }
  }

  /** New diagnostic challenge: no model call unless loaded by human consent. */
  async runDynamicChallenge(
    sdkUrl: string, seed: number, now: Date = new Date(),
  ): Promise<DynamicChallengeReport> {
    if (this.phase !== "ready" || !this.client?.getStatus().ready || !this.fleet) {
      throw new Error("Click Load PocketBrain Tiny and complete initialization first.");
    }
    // Generate and validate before marking busy; invalid input cannot poison the host phase.
    const cases = makeDynamicChallengeCases(seed, now);
    this.phase = "running";
    try {
      const sessions = await Promise.all(cases.map(test =>
        this.fleet!.forBot(test.botId).challenge(test),
      ));
      const checks = cases.map((test, i) => checkDynamicResponse(test, sessions[i]!));
      // These are local, deliberately corrupted strings NEVER presented to PocketBrain.
      const negativeControls = auditNegativeControls(cases);
      const status = this.client.getStatus();
      const result: DynamicChallengeReport = Object.freeze({
        schema: "phibot.browser-dynamic-challenge.v1",
        fixture: "SEEDED_SYNTHETIC_ONLY",
        runAt: now.toISOString(),
        runId: "dynamic-challenge-" + (this.reports.length + 1),
        seed,
        cases,
        sessions,
        checks,
        scores: scoreDynamicChecks(checks),
        negativeControls,
        validatorSelfTestPassed: negativeControls.total > 0 && negativeControls.falseAcceptances === 0,
        sdkReportedBackend: status.device === "webgpu" || status.device === "wasm" ? status.device : null,
        sdkReportedDtype: typeof status.dtype === "string" ? status.dtype.slice(0, 30) : null,
        sdkReportedModel: typeof status.model === "string" ? status.model.slice(0, 120) : null,
        computeBackendIndependentlyVerified: false,
        sdkUrl,
        authority: "READ_ONLY_ADVISORY",
        realPricesChecked: false,
        sourceVerified: false,
        modelOutputTrusted: false,
        financialActionsAuthorized: false,
      });
      this.reports.push(result);
      return structuredClone(result);
    } finally {
      this.phase = "ready";
    }
  }

  /**
   * Bounded observational retry: each bot receives one compact-fields attempt.
   * Only a held response can invoke the guarded percentage-only probe.
   * Never replace the original response or promote an unscorable guess.
   */
  async runAdaptiveChallenge(
    seed: number, now: Date = new Date(),
  ): Promise<AdaptiveChallengeReport> {
    if (this.phase !== "ready" || !this.client?.getStatus().ready || !this.fleet) {
      throw new Error("Click Load PocketBrain Tiny and complete initialization first.");
    }
    const cases = makeDynamicChallengeCases(seed, now);
    this.phase = "running";
    try {
      const attempts: Array<{
        caseId: string; strategy: AdaptiveStrategy;
        response: TinyAdvisory; review: AdaptiveAttemptReview;
      }> = [];
      let firstPassMatches = 0;
      let fallbackInvocations = 0;
      let fallbackRecoveries = 0;
      let finalReviewOnlyMatches = 0;
      for (const test of cases) {
        const firstStrategy = "compact-fields" as const;
        const first = await this.fleet.forBot(test.botId).adaptive(test, firstStrategy);
        const firstReview = reviewAdaptiveAttempt(test, firstStrategy, first);
        attempts.push({ caseId: test.id, strategy: firstStrategy, response: first, review: firstReview });
        if (firstReview.disposition === "MATCHES_SYNTHETIC_ARITHMETIC_REVIEW_ONLY") {
          firstPassMatches++;
          finalReviewOnlyMatches++;
          continue;
        }
        fallbackInvocations++;
        const fallbackStrategy = "percent-only-guarded" as const;
        const fallback = await this.fleet.forBot(test.botId).adaptive(test, fallbackStrategy);
        const fallbackReview = reviewAdaptiveAttempt(test, fallbackStrategy, fallback);
        attempts.push({
          caseId: test.id, strategy: fallbackStrategy, response: fallback, review: fallbackReview,
        });
        if (fallbackReview.disposition === "MATCHES_SYNTHETIC_ARITHMETIC_REVIEW_ONLY") {
          fallbackRecoveries++;
          finalReviewOnlyMatches++;
        }
      }
      const validatorControls = auditNegativeControls(cases);
      const status = this.client.getStatus();
      const reviews = attempts.map(item => item.review);
      const report: AdaptiveChallengeReport = Object.freeze({
        schema: "phibot.browser-adaptive-challenge.v1" as const,
        fixture: "SEEDED_SYNTHETIC_ONLY" as const,
        runAt: now.toISOString(),
        runId: "adaptive-challenge-" + (this.reports.length + 1),
        seed, cases, attempts,
        metrics: Object.freeze({
          cases: cases.length,
          generations: attempts.length,
          firstPassMatches,
          fallbackInvocations,
          fallbackRecoveries,
          finalReviewOnlyMatches,
          promptEchoSignals: reviews.filter(x =>
            x.promptEchoSignal === "INPUT_OR_INSTRUCTION_ECHO_DETECTED").length,
          numericalMatches: reviews.filter(x => x.numericAccuracy === "MATCH").length,
          numericalScorable: reviews.filter(x => x.numericAccuracy !== "NOT_SCORABLE").length,
          sdkReceipts: reviews.filter(x => x.sdkReceiptValid).length,
        }),
        validatorControls,
        sdkReportedBackend: status.device === "webgpu" || status.device === "wasm" ? status.device : null,
        computeBackendIndependentlyVerified: false as const,
        generationFinishReasonAvailable: false as const,
        actionAuthority: "READ_ONLY_ADVISORY" as const,
        authority: "READ_ONLY_ADVISORY" as const,
        realPricesChecked: false as const,
        sourceVerified: false as const,
        modelOutputTrusted: false as const,
        financialActionsAuthorized: false as const,
      });
      this.reports.push(report);
      return structuredClone(report);
    } finally {
      this.phase = "ready";
    }
  }

  /** Exactly six sequential probes: two synthetic cases at each of three levels. */
  async runCapabilityLadder(seed: number, now: Date = new Date()): Promise<CapabilityLadderReport> {
    if (this.phase !== "ready" || !this.client?.getStatus().ready || !this.fleet) {
      throw new Error("Click Load PocketBrain Tiny and complete initialization first.");
    }
    const cases = makeDynamicChallengeCases(seed, now);
    this.phase = "running";
    try {
      const attempts: Array<{ probe: CapabilityProbe; response: TinyAdvisory; review: CapabilityReview }> = [];
      for (const level of CAPABILITY_LEVELS) {
        for (const test of cases) {
          const probe = makeCapabilityProbe(test, level);
          const response = await this.fleet.forBot(test.botId).capability(probe);
          const review = reviewCapabilityProbe(probe, response);
          attempts.push({ probe, response, review });
        }
      }
      const reported = this.client.getStatus();
      const result: CapabilityLadderReport = Object.freeze({
        schema: "phibot.browser-capability-ladder.v1" as const,
        fixture: "SEEDED_SYNTHETIC_ONLY" as const,
        runId: "capability-ladder-" + (this.reports.length + 1),
        runAt: now.toISOString(), seed, cases, attempts,
        byLevel: summarizeCapabilityReviews(attempts.map(x => x.review)),
        sdkPromptEnvelope: "VENDORED_SYSTEM_PLUS_USER_MESSAGES" as const,
        sdkRenderedChatTemplateIndependentlyInspected: false as const,
        repeatability: "REPLAY_SAME_SEED_MANUALLY" as const,
        sdkReportedBackend: reported.device === "webgpu" || reported.device === "wasm" ? reported.device : null,
        sdkReportedModel: typeof reported.model === "string" ? reported.model.slice(0, 120) : null,
        computeBackendIndependentlyVerified: false as const,
        authority: "READ_ONLY_ADVISORY" as const,
        realPricesChecked: false as const,
        sourceVerified: false as const,
        modelOutputTrusted: false as const,
        financialActionsAuthorized: false as const,
      });
      this.reports.push(result);
      return structuredClone(result);
    } finally {
      this.phase = "ready";
    }
  }

  /** Three ordered probes, each with tokenizer-render evidence and original SDK metadata. */
  async runInferenceIntegrity(seed: number, now: Date = new Date()): Promise<InferenceIntegrityReport> {
    if (this.phase !== "ready" || !this.client?.getStatus().ready) {
      throw new Error("Click Load PocketBrain Tiny and complete initialization first.");
    }
    const cases = makeDynamicChallengeCases(seed, now);
    const probes = makeIntegrityProbes(cases[0]!);
    this.phase = "running";
    try {
      const attempts: Array<{
        probe: CapabilityProbe;
        templateInspection: TemplateInspection;
        response: TinyAdvisory;
        review: IntegrityReview;
      }> = [];
      for (const probe of probes) {
        let templateInspection: TemplateInspection = {
          schema: "phibot.market.template-inspection.v1",
          status: "API_UNAVAILABLE", method: "apply_chat_template",
          addGenerationPromptRequested: true,
          inputMessages: "VENDORED_SYSTEM_PLUS_USER",
          renderedPreview: null, renderedLength: null, previewClipped: false,
          exactGeneratorInputTokenSequenceVerified: false, errorClass: null,
        };
        if (typeof this.client!.inspectPrompt === "function") {
          try {
            templateInspection = await this.client!.inspectPrompt(probe.prompt);
          } catch {
            templateInspection = { ...templateInspection, status: "RENDER_ERROR", errorClass: "SDK_INSPECTION_EXCEPTION" };
          }
        }
        let response: TinyAdvisory;
        let runReceipt: unknown = null;
        try {
          const generated = await this.client!.generate(probe.prompt, {
            mode: "baseline", maxNewTokens: 48,
          });
          runReceipt = generated.receipt;
          const valid = generated.receipt?.schema === "POCKETBRAIN_TINY_RUN_V2" &&
            typeof generated.text === "string" && generated.text.trim() !== "";
          response = valid
            ? Object.freeze({
              status: "advisory" as const, botId: probe.botId,
              text: generated.text.slice(0, 800), hostCaptureClipped: generated.text.length > 800,
              model: this.client!.getStatus().model,
              receiptSchema: "POCKETBRAIN_TINY_RUN_V2" as const,
              provenance: "unverified-model-output" as const,
              sdkReportedBackend: generated.receipt.backend === "webgpu" || generated.receipt.backend === "wasm"
                ? generated.receipt.backend : null,
              sdkReportedModel: typeof generated.receipt.model === "string"
                ? generated.receipt.model.slice(0, 120) : null,
              sdkReportedDtype: typeof generated.receipt.dtype === "string"
                ? generated.receipt.dtype.slice(0, 30) : null,
            })
            : Object.freeze({status: "rejected" as const, botId: probe.botId, reason: "invalid-receipt" as const});
        } catch {
          response = Object.freeze({status: "rejected" as const, botId: probe.botId, reason: "generation-failed" as const});
        }
        attempts.push({probe, templateInspection, response, review: reviewIntegrityProbe(probe, response, runReceipt)});
      }
      const sdk = this.client.getStatus();
      const report: InferenceIntegrityReport = Object.freeze({
        schema: "phibot.browser-inference-integrity.v1" as const,
        fixture: "SEEDED_SYNTHETIC_ONLY" as const,
        runId: "inference-integrity-" + (this.reports.length + 1),
        runAt: now.toISOString(), seed, attempts,
        sdkReportedBackend: sdk.device === "webgpu" || sdk.device === "wasm" ? sdk.device : null,
        sdkReportedDtype: typeof sdk.dtype === "string" ? sdk.dtype.slice(0, 30) : null,
        sdkReportedModel: typeof sdk.model === "string" ? sdk.model.slice(0, 120) : null,
        sdkVersionClaim: "0.1.0-experimental" as const,
        sdkRuntimeFinishReasonAvailable: false as const,
        tokenizerRenderingEqualsActualInputTokensProven: false as const,
        modelAssetsIndependentlyVerified: false as const,
        computeBackendIndependentlyVerified: false as const,
        authority: "READ_ONLY_ADVISORY" as const,
        realPricesChecked: false as const,
        sourceVerified: false as const,
        modelOutputTrusted: false as const,
        financialActionsAuthorized: false as const,
      });
      this.reports.push(report);
      return structuredClone(report);
    } finally {
      this.phase = "ready";
    }
  }

  getIntegrityComparisons(): readonly ReturnType<typeof compareIntegrityRuns>[] {
    const reports = this.reports.filter((r): r is InferenceIntegrityReport =>
      r.schema === "phibot.browser-inference-integrity.v1");
    const comparisons: ReturnType<typeof compareIntegrityRuns>[] = [];
    for (let i = 0; i < reports.length; i++) {
      for (let j = i + 1; j < reports.length; j++) {
        if (reports[i]!.seed === reports[j]!.seed &&
            reports[i]!.sdkReportedBackend !== reports[j]!.sdkReportedBackend) {
          comparisons.push(compareIntegrityRuns(reports[i]!, reports[j]!));
        }
      }
    }
    return structuredClone(comparisons);
  }

  async unload(): Promise<void> {
    if (this.phase === "loading" || this.phase === "running" || this.phase === "disposing") {
      throw new Error("Cannot unload while the lab is busy.");
    }
    if (!this.client) {
      this.phase = "idle";
      this.failure = null;
      return;
    }
    this.phase = "disposing";
    try {
      await this.client.dispose();
      this.client = null;
      this.fleet = null;
      this.phase = "idle";
      this.failure = null;
    } catch (error) {
      this.phase = "error";
      this.failure = error instanceof Error ? error.message : "Unable to dispose model.";
      throw error;
    }
  }
}
