# PHIBOT-16 candidate: PocketBrain Tiny market research crew

Status: **review-only experimental integration seam**, not an autonomous trader, not a live financial terminal, and not a confirmed PocketBrain-in-Node deployment.

## Intent

Give each governed PhiBot an isolated advisory context while reusing one already-loaded browser PocketBrain Tiny inference engine. ScoutBot collects feed data under its existing permitted tool/authority system; deterministic code evaluates freshness and price thresholds; Tiny can write an **untrusted, short advisory**; the PhiBot ledger keeps the reported source, timestamp and exact arithmetic. Vessie, not Tiny, remains the coordinator. No model can convert text into a permission.

- Code: `src/market/observation.ts`, `src/market/pocketbrain-tiny.ts`, `src/market/mission.ts`
- Tests: `test/market-crew.test.ts`
- Current runtime: PhiBot is Node.js >=22; PocketBrain Tiny SDK v0.1 is **browser-only** and experimental.
- Original upstream maintained in our ecosystem: [PocketBrain's SDK candidate](https://github.com/MichaelWave369/PocketBrain/blob/main/docs/TINY_SDK_CANDIDATE.md)
- **No code imports or copies a third-party financial terminal or external engine.** No new dependency is added.

## Contract boundaries

1. **Human consent**: Host browser must explicitly load PocketBrain Tiny, for example from a Load button. Import/construct does not initiate downloads. No automatic model loads, cloud inference, timers or background agents in this PR.
2. **One shared engine**: PocketBrain SDK currently loads weights separately for each client. `PocketBrainTinyFleet` serializes use of **one injected, already-loaded client** to avoid multiplying model memory. `forBot(botId)` creates an isolated, stateless request identity; it **does not yet implement persistent memories**. NBG per-bot memory will need its own scoped, governed integration.
3. **Observed ≠ verified**: `assessMarketTick` takes a caller-provided quote. It enforces a source hostname allowlist, HTTPS, source timestamp, freshness, finite prices, and a deterministic threshold. A URL and a timestamp do **not** prove the feed actually produced the number. All receipts say `source-claimed-unverified`. An upstream independently verified signed feed can be considered in a later rung.
4. **No causal claims**: A price move is arithmetic; a story about why it moved requires independently sourced evidence. The Tiny model gets only safe scalar fields, not fetched news or executable commands. Output is labeled `unverified-model-output`.
5. **No permission upgrade**: `runReadOnlyMarketScout` requires the manifest capability `market.quote.read` plus `read:true, write:false, deploy:false`. It records one service receipt, or a blocked receipt on refusal. It never registers trading capabilities, changes balances, or issues transactions.
6. **No implied compatibility**: The browser SDK cannot be directly imported and run inside the existing Node service. A separately reviewed host integration (browser worker, bounded IPC, or proven Node runtime) is necessary before a PhiBot process can invoke real Tiny weights. Dependency pinning, independent model parity, browser portability and explicit consent gates remain open.

## Proposed use after a browser host exists

```ts
// Pseudocode: executed by an explicit browser UI action, NOT by PhiBot Node.
const tiny = createPocketBrainTinyClient();
await tiny.load({ preferredDevice: "auto" }); // explicit user's Load click
const fleet = new PocketBrainTinyFleet(tiny);
const scoutTiny = fleet.forBot("market-scout");
// The host can pass scoutTiny into a governed market mission only after
// its own isolation, origin and authorized transport have been verified.
```

## Recommended next rungs

- **PHIBOT-17**: opt-in browser-host demo using our version-pinned PocketBrain SDK; verify actual WebGPU/WASM, consent, origin, one-client residency and no cross-bot memory leaks on real hardware.
- **PHIBOT-18**: separate read-only public feed collector with official source timestamps, validation fixtures, and an audited source-to-receipt chain.
- **PHIBOT-19**: AnalystBot + SkepticBot with independent evidence citations and explicit disagreement; NBG per-bot memory and BudgetGenius bounded escalation to local Ollama.
- **PHIBOT-20**: manually triggered backtesting and alerting with no future leakage, fee/slippage checks, source freshness, and no financial transaction path.

## Qualification

Run `npm test`. These are deterministic **contract tests**, not proof of genuine model inference, third-party data accuracy, market causation, autonomous scheduling, or a complete trading terminal.

**Ledger above ego.**
