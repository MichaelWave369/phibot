# PHIBOT-17 R2 | PocketBrain Tiny browser lab rescue

**Status: experimental / human-operated / review only.** This replaces the stale 2026-10-13 PR #23 with a clean branch from current PhiBot main. No autonomy or GitHub mutation is introduced.

## Public entry

After this PR is merged and the *PhiBot React Pages* deployment is successful, open:

https://michaelwave369.github.io/phibot/market-lab/

The public GitHub Pages site is not a bridge into the localhost PhiBot runtime, a repository API client, or a hosted model-inference service. GitHub Pages does not execute a bot server.

## What works

1. Page initially loads **zero models** and issues no model-download request.
2. Human explicitly checks consent, chooses Auto/WebGPU/WASM, then clicks **Load PocketBrain Tiny**.
3. SDK source is copied from our own PocketBrain repository's `public/sdk/v0.1/index.mjs`, `public/pocketbrain-tiny.mjs`, and `public/pocketbrain-tiny-metrics.mjs` into the PhiBot repository. It is therefore fixed by this PhiBot commit, not imported as mutable JavaScript from another GitHub Pages site.
4. The loader still fetches Transformers.js runtime through jsDelivr and model/tokenizer artifacts from Hugging Face **after consent**. These external artifacts are **not independently hash-attested**; `@huggingface/transformers@3.8.1` is a version selector, not end-to-end content integrity.
5. A single loaded `PocketBrainTinyFleet` provides two *sequential, stateless* Scout/Skeptic sessions on a completely fabricated BTC-USD 100→104 input. No live market data or trading tools.
6. Reports stay in browser memory until manual JSON export. They are **self-reports**, not proof of secure model execution, identical outputs or correctness.
7. Human can unload the model; model output is shown only as inert text.

## Source and license provenance

The three vendor modules are copies of first-party **MichaelWave369/PocketBrain** sources, under the MIT license retained as `web/market-lab/vendor/LICENSE`. Keep these files reviewed and pinned to a known PhiBot source commit. Updating upstream PocketBrain does **not** silently change this lab.

## Local reproducibility

Requires Node.js >=22; then:

```bash
npm install
npm test
npm run market:build
npm run market:serve
```

Open `http://127.0.0.1:4173`. The static server has no GitHub credentials, privileged API, daemon or data store.

## Required live acceptance after merge

- [ ] CI `npm test` and `npm run market:build` pass on the new PR head.
- [ ] GitHub Pages build publishes `/phibot/market-lab/` and user opens it without installing anything.
- [ ] With no consent, browser network inspector shows no external SDK/model requests.
- [ ] With consent, Chrome WebGPU loads a real local model and completes two genuine `POCKETBRAIN_TINY_RUN_V2` inference receipts; no fallback to remote inference.
- [ ] WASM backend separately tested.
- [ ] External runtime, model and tokenizer assets reviewed for immutable revisions and content integrity before treating results as security-qualified.
- [ ] Exported report truthfully marks `financialActionsAuthorized:false`, `modelOutputTrusted:false`, `sourceVerified:false`.
- [ ] Verify all normal PhiBot tests and public-site boundary contracts remain green.
- [ ] Optional later: independent performance, origin/CORS and receipt-parity evidence.

### Explicit nonclaims

Model downloads are not offline. There are no six independent agents, background bot spawning, PhiBotRuntime connection, persistent bot memory, real market feeds, trading access, GitHub API calls from the lab, code writes, CI overrides, Reality Gate approvals, merges or deployments by these agents. The *GitHub Actions Pages deploy* itself is a normal maintainers' website publish only after a human merge.

The old PR #23 should be closed as superseded **only after** this replacement is independently reviewed. Its branch should not be merged or force-rebased.

Ledger Above Ego.
