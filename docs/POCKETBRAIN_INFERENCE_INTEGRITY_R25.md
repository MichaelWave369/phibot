# PHIBOT-17 R2.5 · Inference Integrity Gate

**Experimental. Read-only. Synthetic-only. Host arithmetic remains authoritative.**

## Motivation
Live R2.4 WebGPU evidence was 6/6 SDK-reported generations, 0/6 scorable results. The 135M model incorrectly narrated 3+4 and copied structured placeholders. That alone does **not** prove a tokenizer bug or backend execution issue. R2.5 measures the integration path before assigning blame.

## New opt-in integrity workflow
1. Refresh the PhiBot Market Lab, explicitly consent to load the local Tiny SDK, choose WebGPU or WASM, then load.
2. Leave the replay seed blank for a fresh unsigned 32-bit seed or enter an earlier one.
3. Click **Run R2.5 inference integrity · 3 probes**.
4. Inspect three ordered synthetic probes from one seeded case: simple addition, percent change, and structured fields. No hidden automatic retries.
5. Export **v6** \`phibot-17-r25-inference-integrity-evidence.json\` with all original untrusted responses, host-calculated answers, SDK metadata and optional template previews.
6. For an observational backend comparison: unload, select **WASM**, reload after explicit consent, preserve the same seed, click the R2.5 button again, and export the combined v6 report. The two runs remain only in this tab's in-memory report collection until reload. Nothing is automatically uploaded.

## Loaded tokenizer inspection, scope and limits
After explicit load and when the model is ready, the SDK exposes \`inspectPrompt(prompt)\` to call the **already loaded tokenizer's** \`apply_chat_template(buildTinyMessages(prompt), {tokenize:false, add_generation_prompt:true})\`. The prompt has only fictional arithmetic data; no user secrets are introduced. The inspected template is represented by a bounded 2,048-character preview, a total character count, and explicit status:
- \`TOKENIZER_RENDERED\`: API returned a string.
- \`API_UNAVAILABLE\`: API or runtime method not available; no substitute invented.
- \`RENDER_ERROR\`: tokenizer threw or returned a nonstring; only error **class**, no potentially revealing message.

Inspection never runs model inference, loads a second model, makes an extra network request, or changes generation settings. The normal generator still accepts the **original system/user message array**, not the inspected template string. So this **does not prove the exact token IDs passed to the ONNX session**. Template rendering and actual generator tokenization may differ; that limitation is always false/unknown in the receipt.

## Actual generation evidence
For each of three real model calls, store:
- The raw model text (max 800 characters, with explicit \`hostCaptureClipped\` flag for larger text).
- The original stricter Capability Ladder review: SDK response, format, math and bot identity.
- Additional non-authoritative echo heuristics: exact/partial prompt echo, copied numeric input phrase, and copied angle-bracket format placeholders. A zero echo count does NOT prove the output contains no copied content.
- The SDK-reported model, backend, dtype, decode mode, wall time, token callback count and first-token callback timing where supplied, all **browser self-reported** and not independent hardware telemetry.
- \`runtimeFinishReasonAvailable:false\`; don't infer that an unparseable response was truncated by max tokens.

A valid SDK receipt is **not** automatically a correct model answer. Mathematically correct answers are still only \`MATCHES_SYNTHETIC_HOST_MATH_REVIEW_ONLY\`; all other outputs are held.

## WebGPU / WASM comparison
Two in-memory R2.5 reports with the same seed and different SDK backend claims produce an observational comparison, checking:
- Same seed, source-derived prompts, and SDK-reported model ID.
- Whether raw output text is identical and whether each answer was scored against host arithmetic.
- SDK-reported backend and dtype, plus whether they differ.

**This is not strict numerical-execution parity.** WebGPU commonly uses \`q4f16\` and WASM \`q8\`, which are distinct quantized artifacts and may differ even with greedy decoding. Browser, model-asset contents, actual execution backend and full tokenizer inputs remain unverified. \`numericalParityProven:false\` and \`independentlyAttested:false\` remain fixed.

## Security and acceptance
- No model load or runtime download before consent. The inspected SDK/runtime modules are locally vendored; Transformers.js and model files still come from third-party hosts on opt-in.
- No genuine prices, broker permissions, cloud inference, persistent memory, automated test loops, tool execution or unattended requests.
- Template and raw model text render only via \`textContent\`, never as HTML; exported reports stay local.
- CI must verify the mock tokenizer inspection and real receipt contracts with no network access, all three ordered real calls, no backend claims fabricated, and old R2.1–R2.4 regression suites intact.
- After human merge and Pages deployment, operator obtains a WebGPU v6 export followed by a same-seed WASM export if supported.

Ledger Above Ego.
