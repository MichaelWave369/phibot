# PHIBOT-17 R2.3 · Adaptive Challenge Protocol

**Experimental browser-only diagnostic, never trusted model reasoning or trading authority.**

## Motivation and observed evidence

The first live R2.2 export (\`phibot.browser-market-lab-export.v3\`, seed \`1735783628\`) reported valid local SDK receipts for both Scout and Skeptic, and the checker held all 12 deliberately wrong local strings. Both model responses **echoed input lines** instead of producing the requested structured percentage:

- Scout: fictional SIM-A, 2600 → 2392; independently computed **−8%**.
- Skeptic: fictional SIM-F, 1700 → 1649; independently computed **−3%**.
- 2/2 SDK receipts, 0/2 format matches, **0 numeric answers scorable**, 12/12 verifier controls held.

The old validator emitted \`POSSIBLE_TRUNCATION\` when an output lacked \`CAUSE=UNKNOWN\`. That is not evidence of actual generation truncation. The vendored PocketBrain SDK v0.1 does **not** expose a reliable completion/finish reason to this host. R2.3 reports \`generationEndReason: NOT_REPORTED_BY_SDK\` instead, alongside a separate prompt-echo signal and \`hostCaptureClipped\` when the host explicitly clips text above 800 characters.

## Protocol

The operator loads the same vendored PocketBrain Tiny SDK via the existing **explicit consent** path and selects WebGPU/WASM. A new **Run R2.3 adaptive challenge** button creates two fictional cases via the same seed generator as R2.2, one for each bot. No real market feeds.

Each bot receives **at most two serialized, bounded** local inference attempts:

1. **\`compact-fields\`**: shortened one-line field-schema prompt using the case's symbol, reference price and current price. The prompt does **not** include the calculated answer. Uses SDK \`baseline\` mode and \`maxNewTokens:48\`.
2. **\`percent-only-guarded\`**, **only if stage one is held**: a short arithmetic-only expression asking for a single signed integer (no percent sign). Uses the SDK's existing, vendored \`guarded\` decode preset (greedy with repetition guard) and \`maxNewTokens:48\`.

This is **prompt-level constrained formatting**, not token-level grammar-constrained decoding or a replacement model. The fallback tests only the percentage and does **not** receive or claim credit for symbol, reference, current, or causal fields. First attempts are always preserved and never silently overwritten by a successful fallback.

The experiment stops with 2–4 SDK calls. Repeated runs need a human click. No timer, autonomous retries, new network request, tool access, cloud model, persistence, or trading call is added.

## Evidence and scoring

The v4 exported lab envelope includes new \`phibot.browser-adaptive-challenge.v1\` reports beside any old R2.1 and R2.2 reports. Every attempted response is included, **untrusted**, and rendered as inert \`textContent\`. Only these separate metrics are compared:

- \`sdkReceipts\`: SDK-reported generation success.
- \`firstPassMatches\`: correct full structured fields and symbol in stage one, review-only.
- \`fallbackInvocations\` and \`fallbackRecoveries\`: guarded attempts and correct percentage-only output, review-only.
- \`finalReviewOnlyMatches\`: per-case arithmetic matches by either attempted format, **not model factuality certification**.
- \`numericalMatches/numericalScorable\`: attempt-level numerical results. Invalid formats are \`NOT_SCORABLE\`.
- \`promptEchoSignals\`: heuristic input/instruction echo signals. Zero detections is not proof absence of echo.
- \`generationFinishReasonAvailable:false\`, \`backendIndependentlyVerified:false\`, \`sourceVerified:false\` remain honest nonclaims.

The local 12-case verifier negative-control test is carried forward from R2.2. These deliberately corrupted strings are **never sent to the model**, and the control audit measures checker behavior only.

## Field acceptance

1. Verify root CI and Pages tests green for the PR head; new \`adaptive-challenge.js\` is bundled.
2. Human reviews and merges; the Pages deploy is not automatic on a draft PR.
3. In Chrome, open https://michaelwave369.github.io/phibot/market-lab/, refresh, choose WebGPU and explicitly load the model.
4. Click **Run R2.3 adaptive challenge** and export \`phibot-17-r23-adaptive-challenge-evidence.json\`.
5. Inspect per-bot \`attempts\`: compare raw echo signals versus guarded percentage attempts and separate arithmetic correctness. Do not label a held malformed response as proof of truncated decoding.
6. Optionally repeat WASM and compare SDK-reported backend only. Independent hardware and external model-asset attestation are still pending.

**Pass/fail for the software tests is separate from qualification of an actual model's arithmetic ability.**

Ledger Above Ego.
