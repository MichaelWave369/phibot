# PHIBOT-17 R2.1 · Deterministic Reality Check (synthetic fixture only)

**Scope:** The public PocketBrain browser lab at `/phibot/market-lab/`, with no changes to the privileged PhiBot service, Reality Gate, repository tools, local queue or human approval model.

## Why this rung exists

The first real browser evidence export on 2026-10-29 reported two SDK-recognized advisory responses from one SmolLM2 135M model. The Scout response partially echoed its prompt and ended mid-thought. The Skeptic response invented a causal story involving market demand. These are **observed limitations of tiny-model text** on a completely invented price fixture, not evidence about Bitcoin.

This work uses short *representative synthetic examples* in tests, not the user's entire original exported evidence file.

## Strict classifier

`src/market/reality-check.ts` implements a **small, deterministic, fail-closed textual allowlist** for an *exact* BTC-USD fixture: 100 → 104, 4%, source `synthetic.example`, threshold 3%, same checked/source time, no provenance verification.

- `RESTRICTED_MATCH_REVIEW_ONLY`: model text matches one of a few exact, source-bounded synthetic statements; **does not mean factuality is certified**.
- `HELD_FOR_HUMAN_REVIEW`: any other response, including benign paraphrases, incomplete strings, prompt echo, unsupported causal language, wrong prices or new contextual claims.
- Reasons are individually recorded, including `POSSIBLE_TRUNCATION`, `PROMPT_ECHO`, `UNSUPPORTED_CAUSAL_CLAIM`, and `NOT_EXACTLY_SUPPORTED`. Detection of partial text is heuristic and an omitted detection never constitutes approval.
- The UI **never promotes raw model output into the fixture statement**. It displays the deterministic fixture statement separately and visibly labels raw model text untrusted.
- Output and reason codes remain in local browser memory until the user explicitly exports JSON. No new API, GitHub call, storage layer, background job, trade operation or write path.
- This is **not** a general hallucination detector. A strict exact match can be copied or guessed by a model. Stronger proof requires independent source checks and other safety layers.

## Compute attribution

The existing PocketBrain SDK offers a `getStatus().device` field and `POCKETBRAIN_TINY_RUN_V2` receipt fields `backend`, `model` and `dtype`.

R2.1 preserves these as **SDK-reported claims**, using only `webgpu` or `wasm` for backend labels and `null` for missing data. Presence of `navigator.gpu` is still explicitly separate and insufficient. `computeBackendIndependentlyVerified` is always `false`; runtime downloads and ONNX assets remain without end-to-end content attestation.

## How to qualify

1. Check root CI `npm test`, including `test/market-reality-check.test.ts` and `test/market-browser-lab.test.ts`, and Pages `market:build`.
2. After a human merges, open the live lab, explicitly consent to model download, and select WebGPU (then repeat with WASM).
3. Click `Run Scout + Skeptic`. Observe **two distinct metrics**: SDK advisory receipt count and restrictive-output match count. A 2/2 receipt with 0/2 restricted matches is expected and does not imply a failure to load.
4. Export the new `phibot.browser-market-lab-export.v2` evidence and inspect `reports[].realityChecks[]` for untrusted raw output, reason codes and the deterministic fixture statement.
5. Confirm SDK backend claims in both `sdkReportedBackend` (session) and `reports[].sdkReportedBackend` (client status). If missing, report `not reported`; do **not** label WebGPU performance proven.
6. Test fail-closed controls: incomplete replies, unrelated prices and invented demand stories stay held.

**No actual live browser run or hardware backend attestation is claimed by CI.** This protects a narrow lab exercise while providing concrete receipts for future work.

Ledger Above Ego.
