# PHIBOT-17 R2.4 · Model Capability Ladder

**Status: experimental, six client-side generations per human click, read-only, synthetic-only.**

## Why this rung
R2.3 produced four valid SDK-reported generations but zero scorable arithmetic answers; neither shortened formatting nor a guarded fallback recovered the computation. The model's outputs also included prompt echoes and arithmetic-looking inventions. Before claiming any arithmetic or structured reasoning, test progressively simpler tasks and preserve every raw result.

## Three independent diagnostic tiers

Each click uses an unsigned 32-bit seed to create the same two fictional SIM-* cases as R2.2/R2.3, then makes exactly **six serial SDK calls**, two per tier:

1. **integer-addition**: two small positive integers derived deterministically from the synthetic fixture. Ask for one integer; host computes the sum and compares exact equality.
2. **percentage-change**: provide reference/current fictional prices and an explicit percentage formula, but **not the answer**. Ask for one signed integer; host performs the calculation independently.
3. **structured-observation**: ask for a single format containing symbol, reference, current, delta, percentage and \`CAUSE=UNKNOWN\`, without a completed sample answer. Host strictly parses each field and validates numbers and symbol.

Every tier is independently marked for **SDK receipt**, strict format, **numerical scorable**, numerical matches, and review-only matches. Text that fails to parse is **NOT_SCORABLE**, not silently a wrong arithmetic answer. No overall intelligence score. Even matching text remains unverified model output, with no source or financial authority.

## Replay and comparisons

The UI has an optional **replay seed** input. Blank input uses \`crypto.getRandomValues\` for an unsigned seed. After a run, the seed is placed in the input for exact **input replay** on the next click. Clear it for a fresh challenge.

The six prompts and cases will be identical on replay; inference text **need not** be identical. Neither deterministic seed nor greedy decoding is a guarantee of repeatable model output across browsers/backends. The seed and all prompts/outputs are included in the local **v5** export. The legacy R2.1, R2.2, and R2.3 buttons remain available.

## SDK prompt construction audit

R2.4 directly inspected the vendored first-party source, without changing the model runtime:

- \`web/market-lab/vendor/pocketbrain-tiny.mjs\`: \`buildTinyMessages\` constructs a \`system\` message with the default \`You are PocketBrain, a concise assistant.\` and one \`user\` message with a trimmed prompt (max 4,000 characters).
- \`createTinyRunner\` sends the **messages array** to \`generator(messages, {...options, streamer})\`, not a pre-rendered string.
- \`extractTinyReply\` selects the last assistant-role segment when generated text returns message objects; the pipeline uses \`return_full_text:false\` and a streaming text callback.
- \`web/market-lab/vendor/sdk/v0.1/index.mjs\` forwards \`generate()\` into the opted-in loaded model session and emits \`POCKETBRAIN_TINY_RUN_V2\` receipts.
- The reproducible CI boundary test verifies these source contracts without importing a remote runtime or downloading model weights.

**We have NOT independently inspected the tokenizer-rendered final chat template, verified real GPU execution, validated externally hosted model/runtime asset integrity, or established model arithmetic ability.** Chat-role construction differs from actual tokenization, and the model may still repeat inputs.

## Boundaries
- Existing human consent must precede model import/download.
- Six sequential, single-model generations; no retry loop, cloud inference, task delegation, background process or persistent memory.
- All fixtures come from \`synthetic.example\` and are invented; no live prices.
- Results stored in browser memory only until human-initiated JSON export. Original untrusted text displayed with \`textContent\`.
- No trading, GitHub writes, approval bypass, source verification or externally asserted mathematical truth.
- Use exact v5 export schema \`phibot.browser-market-lab-export.v5\`; the new report has \`phibot.browser-capability-ladder.v1\`.

## Acceptance
- [ ] CI \`npm test\`, Pages contract and \`npm run market:build\` green on PR head.
- [ ] Public page updated after human merge, R2.4 button present.
- [ ] Browser WebGPU run exports v5 results, including six raw responses and separate per-level metrics.
- [ ] Same-seed replay, then different seed, to check response variability without claiming deterministic model output.
- [ ] Optional WASM repeat; device remains SDK-reported, not independently attested.
- [ ] No totalizing score or promotion of model-generated math over host calculation.

Ledger Above Ego.
