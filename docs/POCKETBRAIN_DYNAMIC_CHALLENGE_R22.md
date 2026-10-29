# PHIBOT-17 R2.2 · Seeded Dynamic Reality Challenge

**Status: experimental, browser-only, human operated, synthetic-only, read-only.**

## Why

The first R2.1 WebGPU session produced two exact copies of the sample sentence already in the model's prompt. That qualified the fixed textual gate, **not** arithmetic reasoning. R2.2 creates new numeric challenges without passing the expected percentage or a completed sample answer to the model.

## Operator workflow

1. After PR merge and Pages deploy, open https://michaelwave369.github.io/phibot/market-lab/
2. Explicitly consent to model/runtime downloads, choose WebGPU or WASM, and load the Tiny SDK.
3. Click **Run R2.2 seeded dynamic challenge**. The browser uses \`crypto.getRandomValues\` to generate a uint32 seed. The seed is stored with the run solely for reproduction.
4. Scout and Skeptic receive **different** invented symbols and prices, sequentially on one shared model. Each receives reference/current values and an alert threshold, but not the calculated move percent.
5. Export the **v3** JSON evidence, then optionally reload and test WASM. The legacy R2.1 fixed-fixture button remains available.

No real price data, source verification, financial advice, persistent agent memory, work queue, GitHub API call, tool execution or trading permission is introduced.

## Cases and determinism

- Fixed allowlisted nonmarket symbols \`SIM-A\` through \`SIM-F\`. They are fictional.
- Two distinct symbols per run; reference price is a multiple of 100, current is derived from a signed **integer percentage** (2–9 in magnitude); threshold is independently selected within that magnitude.
- Each case is assessed by the existing \`assessMarketTick\` validator, with the same \`synthetic.example\` fabricated source and source timestamp equal to local run time.
- The PRNG is xorshift32 seeded from the browser's cryptographically provided 32-bit seed. **The xorshift output itself is not cryptographically unpredictable**, and the seed is published in the report; this is reproducible test data, not a secret challenge or resistance to adversarial prompt injection.
- The prompt defines a one-line **field schema**, \`SYMBOL=<...>;REFERENCE=<...>;CURRENT=<...>;MOVE_PCT=<...>;CAUSE=UNKNOWN\`, not an example completed response. If a tiny model copies placeholders or fails to follow the schema, that is diagnostic evidence, not an implementation failure.

## Four separate measurements (no misleading aggregate grade)

| Counter | Exact meaning |
| --- | --- |
| \`sdkReceipts\` | Model-generated replies that passed the existing SDK receipt contract and bot association |
| \`formatMatches\` | Replies matching the strict one-line schema |
| \`numericalMatches\` / \`numericalScorable\` | Exact checks of reference/current/percent against host-computed fixture; nonparseable responses are **not scorable**, not silently counted as mathematically wrong |
| \`unsupportedClaimSignals\` | Narrow heuristic detections of causal/trading phrases or non-UNKNOWN cause fields; **zero signals does not prove there are no unsupported claims** |

\`reviewOnlyMatches\` requires every condition: receipt, strict fields, correct symbols and exact arithmetic, and no flagged claims. A match is **still untrusted text for human review**, not independent factuality, model attestation or action authority. The raw model text is retained untrusted and shown via \`textContent\` (never executed as HTML).

## Negative controls: validator self-test, NOT model evaluation

For each synthetic case, the host directly submits six **deliberately corrupted local strings to the deterministic checker**: wrong percent, wrong current, wrong symbol, invented cause, extra causal claim and truncated response.

These inputs are **never sent to the model**. The ledger includes \`total\`, \`correctlyHeld\` and \`falseAcceptances\` and per-case labels. This validates that the checker rejects known examples. It is **not evidence that Scout/Skeptic resisted these attacks**. A nonzero \`falseAcceptances\` makes \`validatorSelfTestPassed:false\` and needs immediate human review.

## Export

\`phibot.browser-market-lab-export.v3\` retains both legacy v2 reports and new \`phibot.browser-dynamic-challenge.v1\` reports. Each dynamic run includes the replay seed, two fixtures, two original untrusted SDK responses, two independent checks, separate score counters, and the local negative-control ledger. No automatic uploads. \`backendIndependentlyVerified:false\` and \`externalRuntimeAndModelAttestation:"NOT_ATTESTED"\` remain truthful.

## Acceptance

- [ ] Root CI TypeScript + Node regression suite green.
- [ ] Pages build copies \`dynamic-challenge.js\` and exports a usable app after human merge.
- [ ] Before load, page has zero model inference and no ambient model download.
- [ ] Two distinct prompts and sequential SDK receipts observed in a real browser.
- [ ] One R2.2 WebGPU export and one WASM export collected; compare SDK-reported device (not independent hardware proof).
- [ ] Negative controls all held, and honest partial scoring if the tiny model fails format.
- [ ] No new authority, storage, fetch or trading pathways.

**Ledger Above Ego.**
