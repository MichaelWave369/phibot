# PHIBOT-17 | Opt-in real PocketBrain Tiny browser qualification

**Candidate, not field-qualified.** Source CI validates TypeScript and deterministic mock-client tests. Only an actual browser run can establish real ONNX inference, browser CORS, GPU/WASM compatibility, performance and model residency.

## Objective

Use the existing PHIBOT-16 `PocketBrainTinyFleet` from a **browser** instead of pretending the experimental browser SDK runs inside PhiBot's Node service. Scout and Skeptic each have a separate stateless advisory identity. One injected PocketBrain SDK client loads the Tiny model once and serializes the two requests. Output is **unverified language model text**, not fact or authorization.

## Local test

1. On a PC with Node.js 22+, clone PhiBot and run `npm install`.
2. Run `npm run market:serve`, which compiles TypeScript, copies required browser-safe modules into `.market-host-dist/`, and binds a static server to `127.0.0.1:4173`.
3. Open `http://127.0.0.1:4173` in Chrome. Note: 127.0.0.1 is a **different browser origin** from `https://michaelwave369.github.io`.
4. Check the consent box, select **Auto**, **WebGPU** or **WASM**, and click **Load PocketBrain Tiny**. Expect a potentially large first model download.
5. Click **Run Scout + Skeptic on one Tiny model**. The only quote is **invented 100 to 104 BTC-USD**; a fake `.example` source and freshly generated fixture timestamp must not be mistaken for exchange data.
6. Inspect both real SDK responses. Export evidence only by clicking **Export local qualification JSON**. Submit the JSON for review separately; no automatic upload or persistence exists.
7. Click **Unload model** and confirm the status resets. Reloading the page clears reports from memory.

Local-only check commands:

```bash
npm test
npm run market:build
npm run market:serve
```

The page's WebGPU availability indicator only shows whether a browser API exists. It does not prove model execution or parity. The SDK response is self-reported, not independently certified. The test does not measure model memory usage or prove GPU weight sharing across worker processes. The controller uses one SDK instance in one tab, not one per bot; other tabs/apps may allocate additional copies.

## Consent, sources and isolation

- Initial page/scripts contain **no** external SDK import. The SDK module is imported dynamically only inside the human-triggered Load action following affirmative consent. No `client.load` otherwise.
- SDK candidate: `https://michaelwave369.github.io/PocketBrain/sdk/v0.1/index.mjs`; version string is checked, but **it is not revision/content-hash pinned**. Its relative adapter import also points to mutable content. Dependency immutability and real artifact verification remain a security/reproducibility blocker.
- The SDK loads Transformers.js through jsDelivr, and ONNX weights/tokenizer through Hugging Face when explicitly initialized. No broker endpoints, wallet, account, user-auth, market-data APIs or remote inference are present.
- The origin field reflects the actual host origin, allowing manual distinct-origin/CORS verification. When both apps are on `michaelwave369.github.io`, it is *same origin* even if different Pages paths.
- The browser host contains **no memory store**. Bot separation is by identity and stateless prompt content; NBG scoped persistent memories have not been connected.
- The deterministic fixture is marked `SYNTHETIC_ONLY`. Quote source and time are unverified input claims; they are **not genuine live market provenance**.
- The text output can still hallucinate explanations or suggest trades despite prompt instructions. It is isolated as a non-authoritative string displayed via `textContent`. No model output is executed or fed into an action system.
- The browser lab does not run `PhiBotRuntime`, read a real market feed, or talk to a local/network PhiBot Node service. These integration gates remain open.

## Acceptance checklist

- [x] Source tests: no eager load or fallback, explicit consent, two session identities, single shared client, serialized inference, blocked busy disposal, untrusted receipts.
- [ ] Real Chrome WebGPU load with explicit network evidence and two successful inference receipts.
- [ ] Real Chrome WASM run on same fixture and output comparison.
- [ ] Distinct browser origin CORS test from `127.0.0.1` (not inferred from GitHub Pages).
- [ ] Browser profile/device performance, initialization times, memory review and disposal.
- [ ] Content-hash pinning for SDK JS, Transformers.js runtime, model and tokenizer.
- [ ] Independent reference parity of actual ONNX generations.
- [ ] Separate operator-approved IPC transport and PhiBot Node authority-gated mission integration.

This is a **qualification lab**, not live trading research. PHIBOT-18 can introduce an independently sourced, read-only public market-data feed with honest source timestamps and receipt binding. Later rungs can add scoped NBG memory and Vessie/Crane Fly escalation. No external codebase was forked or copied.

**Ledger above ego.**
