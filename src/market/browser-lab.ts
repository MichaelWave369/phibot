import { assessMarketTick, type MarketObservation } from "./observation.js";
import { PocketBrainTinyFleet, type TinyAdvisory, type TinySdkClient } from "./pocketbrain-tiny.js";

export type TinyDevice = "auto" | "webgpu" | "wasm";
export type BrowserLabPhase = "idle" | "loading" | "ready" | "running" | "disposing" | "error";

export interface BrowserTinyClient extends TinySdkClient {
  load(options: { preferredDevice: TinyDevice; onProgress?: (event: unknown) => void }): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface BrowserLabReport {
  schema: "phibot.browser-market-lab.v1";
  fixture: "SYNTHETIC_ONLY";
  runAt: string;
  runId: string;
  observation: Readonly<MarketObservation>;
  sessions: readonly TinyAdvisory[];
  sdkUrl: string;
  model: string | null;
  sdkStatus: string;
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
  private reports: BrowserLabReport[] = [];
  private failure: string | null = null;

  getStatus(): Readonly<{
    phase: BrowserLabPhase;
    model: string | null;
    sdkPhase: string | null;
    reportCount: number;
    error: string | null;
  }> {
    return Object.freeze({
      phase: this.phase,
      model: this.client?.getStatus().model ?? null,
      sdkPhase: this.client?.getStatus().phase ?? null,
      reportCount: this.reports.length,
      error: this.failure,
    });
  }

  /** A snapshot, never a reference to internal mutable history. */
  getReports(): readonly BrowserLabReport[] {
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
      const result: BrowserLabReport = Object.freeze({
        schema: "phibot.browser-market-lab.v1",
        fixture: "SYNTHETIC_ONLY",
        runAt: now.toISOString(),
        runId: "market-lab-" + (this.reports.length + 1),
        observation,
        sessions,
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
