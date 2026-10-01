import assert from "node:assert/strict";
import test from "node:test";
import { ProviderBackedAdapter } from "../src/adapters/provider-backed.js";
import { MemoryLedger } from "../src/core/ledger.js";
import { PhiBotRuntime } from "../src/core/runtime.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { DryRunProvider } from "../src/providers/dry-run.js";

const manifest: PhiBotManifest = {
  id: "receiptbot",
  name: "ReceiptBot",
  version: "0.2.0",
  role: "receipt_test",
  description: "resource receipt fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 1 },
  capabilities: ["repo.read"],
  authority: { read: true, propose: true, write: false, deploy: false },
  escalation: { target: "vessie", confidenceBelow: 0.5 }
};

test("records provider metadata for stages and aggregates final usage", async () => {
  const ledger = new MemoryLedger();
  const runtime = new PhiBotRuntime(
    manifest,
    new ProviderBackedAdapter(new DryRunProvider()),
    ledger,
  );

  const result = await runtime.run({ task: "inspect repository" });

  assert.equal(result.status, "completed");
  assert.equal(result.receipts[0]?.metadata?.provider !== undefined, true);

  const finalMetadata = result.receipts.at(-1)?.metadata;
  const totals = finalMetadata?.providerTotals as Record<string, unknown>;
  assert.equal(totals.calls, 4);
  assert.equal(totals.fallbackCalls, 0);
  assert.equal(totals.totalTokens, 0);
});
