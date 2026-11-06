# PHIBOT-37: Synthetic Three-Role Crew Review Trial

PHIBOT-37 is the first **manually triggered, real local Ollama, three-stage advisory collaboration** using Scout, Patch and Skeptic role manifests. It is deliberately limited to **one fictional documentation discrepancy**, not a real repository task, and it is not a GitHub coding agent.

## Workflow

1. An operator runs `npm run model:qualify -- --model qwen3:4b` on the **same local Ollama port** to record a successful recent PHIBOT-36 provider probe. This receipt is a locally generated self-report, not independent attestation or authorization.
2. The operator runs `npm run crew:trial -- --model qwen3:4b` from the PhiBot clone. This uses Ollama on `127.0.0.1:11434` by default. Optionally pass `--port 11434` and `--timeout-ms 45000` (5,000 to 90,000 per call).
3. **Scout** examines a bundled fictional README flag mismatch, then **Patch** suggests a prose-only documentation clarification, then **Skeptic** critiques the prior two unverified responses. Each stage is a distinct, sequential model request. The same selected local model currently performs all three roles.
4. The tool saves an exclusive-create local JSON receipt under ignored `.phibot/crew-trials/`, containing three bounded summaries and confidences, time, model, probe digest, and a SHA-256 consistency digest. Run `npm run crew:trials` to list summaries of local trial outcomes.

## What the crew can and cannot do

Every role is instantiated with **no capabilities** and all `read`, `propose`, `write`, and `deploy` authority values set to false. The prompts contain only a fixed synthetic fixture and prior unverified role summaries. Ollama is called locally in structured, advisory-only mode with a strict echoed-model check, bounded output, no fallback, no retry and a per-call timeout. The pipeline stops on the first invalid or failed response.

There are **no GitHub API calls, real repository reads/writes, command execution, shell access, model downloads, bot registration or registry mutation, CommonLine task dispatch, secret transmission, autonomous scheduling, Realitу Gate grants, CI verification, or merge actions** in this rung. It does not even modify the fictional document; Patch suggests only prose for review.

Completion produces the status `ADVISORY_UNVERIFIED`, **not** 'approved', 'verified', 'GMED', or 'ready to merge'. Skeptic is another untrusted model advisory, not independent proof of truth. A failure is `FAILED_NO_APPROVAL`. The receipt digest detects file edits but is not a signature and is not independently attested.

## Windows quick start

After merging this PR, with Node 22+ and Ollama running locally:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
npm.cmd run model:qualify -- --model qwen3:4b
npm.cmd run crew:trial -- --model qwen3:4b
npm.cmd run crew:trials
```

Use a model tag already installed in Ollama and sized for your computer. The crew trial rejects missing, stale, failed or mismatched-port local readiness evidence. This requires an actual local PHIBOT-36 probe, not GitHub Actions' simulated Ollama.

## Acceptance and boundaries

`npm test` runs `test/crew-trial.test.ts` with injected synthetic provider responses. It checks three sequential role calls, least-authority manifests, no premature execution, invalid outputs, wrong model identity, unapproved fallback, strict local evidence and immutable, self-hash-checked receipts. Automated CI does not perform actual Ollama inference and cannot certify Windows hardware.

The next gate should use **real, source-pinned read-only evidence** under an allowlisted repository policy, keep proposer and reviewer separated, and require a human/Reality Gate review before any actual code change. No authority should automatically flow from one bot to another.

**Ledger Above Ego. Three opinions are not proof, and a review is not permission to act.**
