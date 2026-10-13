/** Read-only market observations. Data is caller-supplied, not fetched or verified here. */
export interface MarketTick {
  symbol: string;
  price: number;
  referencePrice: number;
  sourceUrl: string;
  sourceTime: string;
}

export interface MarketReadPolicy {
  /** Explicit hostnames approved by the operator, not a wildcard. */
  allowedHosts: readonly string[];
  minimumMovePct: number;
  maxAgeMs?: number;
}

export interface MarketObservation {
  schema: "phibot.market.observation.v1";
  symbol: string;
  price: number;
  referencePrice: number;
  movePct: number;
  status: "alert" | "quiet";
  sourceUrl: string;
  sourceTime: string;
  checkedAt: string;
  thresholdPct: number;
  /** Source URL/time are claims supplied by the feed. No independent verification. */
  provenance: "source-claimed-unverified";
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function assessMarketTick(
  tick: MarketTick,
  policy: MarketReadPolicy,
  now: Date = new Date(),
): Readonly<MarketObservation> {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid observation clock.");
  if (!/^[A-Za-z0-9^._-]{1,24}$/.test(tick.symbol)) {
    throw new Error("Invalid symbol.");
  }
  if (!positive(tick.price) || !positive(tick.referencePrice)) {
    throw new Error("Price and reference price must be finite and positive.");
  }
  if (!positive(policy.minimumMovePct)) {
    throw new Error("Move threshold must be finite and positive.");
  }
  const maxAgeMs = policy.maxAgeMs ?? 15 * 60 * 1000;
  if (!positive(maxAgeMs) || maxAgeMs > 24 * 60 * 60 * 1000) {
    throw new Error("Invalid freshness policy.");
  }
  if (policy.allowedHosts.length === 0) {
    throw new Error("Market source allowlist required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(tick.sourceUrl);
  } catch {
    throw new Error("Invalid market source URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    !policy.allowedHosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase())
  ) {
    throw new Error("Market source is not explicitly permitted.");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(tick.sourceTime)) {
    throw new Error("A timezone-qualified source timestamp is required.");
  }
  const time = Date.parse(tick.sourceTime);
  const ageMs = now.getTime() - time;
  if (!Number.isFinite(time) || ageMs < -60_000 || ageMs > maxAgeMs) {
    throw new Error("Market quote is missing, stale, or from the future.");
  }
  const movePct = ((tick.price - tick.referencePrice) / tick.referencePrice) * 100;
  if (!Number.isFinite(movePct)) throw new Error("Market move is not representable.");
  return Object.freeze({
    schema: "phibot.market.observation.v1" as const,
    symbol: tick.symbol.toUpperCase(),
    price: tick.price,
    referencePrice: tick.referencePrice,
    movePct,
    status: Math.abs(movePct) >= policy.minimumMovePct ? "alert" as const : "quiet" as const,
    sourceUrl: parsed.toString(),
    sourceTime: new Date(time).toISOString(),
    checkedAt: now.toISOString(),
    thresholdPct: policy.minimumMovePct,
    provenance: "source-claimed-unverified" as const,
  });
}
