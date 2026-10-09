# PHIBOT-11 | Local Scout Shadow Pilot

**Status:** operator-run only / LOCAL OLLAMA OPTIONAL / NOT A CLOUD-HOSTED AUTONOMOUS PHIBOT.

PhiBot's original `PhiBotRuntime` now has an isolated first public-observation reasoning exercise. It consumes only a validated `PHIBOT-09` public Scout review, produced on explicit operator request from four public GitHub GETs. **The live public-read qualification from PHIBOT-10 remains a separate manual field test. This pilot does not infer that qualification happened merely because the GitHub Actions PR checks are green.**

## Run on the operator's own Node 22+/Ollama machine

After separately running PHIBOT-10's manual GitHub Actions field qualification and confirming a **fresh** successful public observation:

```bash
npm install
npm run scout:shadow -- --ack-unverified-public
```

Optionally select an existing local model:

```bash
npm run scout:shadow -- --ack-unverified-public --model qwen3:4b
```

**Operator must explicitly acknowledge that public GitHub data is unverified.** No generic task, URL, host or capability argument is accepted. The Ollama upstream is fixed to `http://127.0.0.1:11434`, overriding `OLLAMA_HOST`. There are no API keys, gateway credentials, remote model APIs or cloud inference.

## Safety boundaries

1. PHIBOT-09 performs four public, unauthenticated, read-only GETs and validates the response (blob IDs, paired source/sidecar, GH Actions metadata, expiry).
2. If the result is anything but `OBSERVED_OK_UNVERIFIED_PUBLIC`, processing halts **before** contacting Ollama.
3. `runLocalScoutShadow()` constructs a fixed no-capability PhiBot manifest: `read=false`, `propose=false`, `write=false`, `deploy=false`, no registered tools and no memory depth.
4. The original `PhiBotRuntime` executes four logical stages. `observe`, `propose` and `verify` are deterministic inert stages; **only `interpret` calls Ollama once**. The local provider may retry once for its narrowly configured token-repeat-limit recovery; this is a retry of the same reasoning stage, not a second agent task.
5. Ollama sees only hardcoded status enum fields, not public raw JSON, untrusted text, GitHub URLs, repository output or previous model summaries. All model-proposed actions, unexpected provider changes, fallback or dangerous/unbounded output are rejected.
6. A transient `MemoryLedger` is used only inside this in-process run, then discarded. The CLI prints a bounded advisory summary with no prompt, task payload, stored memory, tool output, or privileged state.
7. No PhiBot Service registration, persistent bot spawning, CommonLine sends, field memory promotion, Reality Gate grant, PhiOS syscall, task scheduling, deployment, repository write or external tool execution occurs.

## What this proves

CI checks pure offline invariants with a fake provider and fixed public-summary fixtures. On a qualified local Ollama machine, an explicit manual run can demonstrate **one real local reasoning stage on a safely minimized evidence projection**. It cannot prove source authorship, AI alignment, OS process isolation, independent identity, remote bot autonomy or live hosted agent execution.

This rung is a shadow pilot, not a generally deployable cloud agent. The standalone existing PhiBot acceptance/qualification systems remain unchanged.

## PHIBOT-14: Advisory-only local schema

The first Windows field run proved public GitHub reads worked but qwen3:4b returned a forbidden action. The local Scout provider now explicitly requests an action-free JSON schema with `summary` and `confidence` only. The consumer separately rejects action-shaped or extra fields. The existing no-authority runtime restrictions are unchanged.
