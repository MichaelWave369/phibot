import { randomUUID } from "node:crypto";
import type { Ledger } from "../core/ledger.js";
import type { LedgerReceipt, PhiBotManifest } from "../core/types.js";
import { assessMarketTick, type MarketObservation, type MarketReadPolicy, type MarketTick } from "./observation.js";
import type { TinyAdvisory, TinyBotSession } from "./pocketbrain-tiny.js";

export interface MarketScoutInput {
  manifest: PhiBotManifest;
  ledger: Ledger;
  tick: MarketTick;
  policy: MarketReadPolicy;
  brain?: TinyBotSession;
  now?: Date;
}

export interface MarketScoutResult {
  runId: string;
  observation: Readonly<MarketObservation>;
  advisory: TinyAdvisory | null;
  receipt: LedgerReceipt;
}

/**
 * One explicitly invoked, no-tools, no-trades market mission.
 * Caller provides the actual source observation; no automatic feed or scheduling exists.
 */
export async function runReadOnlyMarketScout(input: MarketScoutInput): Promise<MarketScoutResult> {
  const { manifest, ledger, tick, policy, brain } = input;
  const now = input.now ?? new Date();
  const runId = randomUUID();
  const receiptBase = {
    schema: "phibot.receipt.v1" as const,
    runId,
    botId: manifest.id,
    botVersion: manifest.version,
    stage: "service" as const,
    timestamp: now.toISOString(),
  };
  const allowed =
    manifest.authority.read === true &&
    manifest.authority.write === false &&
    manifest.authority.deploy === false &&
    manifest.capabilities.includes("market.quote.read") &&
    (!brain || brain.botId === manifest.id);
  if (!allowed) {
    const refusal: LedgerReceipt = {
      ...receiptBase,
      status: "blocked",
      summary: "Market scout refused: mission is outside read-only manifest authority.",
    };
    await ledger.append(refusal);
    throw new Error(refusal.summary);
  }
  let observation: Readonly<MarketObservation>;
  try {
    observation = assessMarketTick(tick, policy, now);
  } catch {
    const refusal: LedgerReceipt = {
      ...receiptBase,
      status: "blocked",
      summary: "Market scout refused invalid, stale, or unapproved feed input.",
    };
    await ledger.append(refusal);
    throw new Error(refusal.summary);
  }
  const advisory = brain ? await brain.advise(observation) : null;
  const receipt: LedgerReceipt = {
    ...receiptBase,
    status: "ok",
    summary: observation.status === "alert" ? "Read-only market threshold crossed." : "Read-only market check quiet.",
    metadata: {
      symbol: observation.symbol,
      price: observation.price,
      referencePrice: observation.referencePrice,
      movePct: observation.movePct,
      thresholdPct: observation.thresholdPct,
      sourceUrl: observation.sourceUrl,
      sourceTime: observation.sourceTime,
      sourceProvenance: observation.provenance,
      brainStatus: advisory?.status ?? "not-attached",
      brainOutputTrusted: false,
      financialActionsAuthorized: false,
    },
  };
  await ledger.append(receipt);
  return { runId, observation, advisory, receipt };
}
