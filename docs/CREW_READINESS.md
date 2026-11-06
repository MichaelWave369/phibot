# PHIBOT-36: Crew model inference readiness receipts

PHIBOT-36 bridges the **existing representative PhiBot Ollama qualification doctor** into the local Crew dashboard. This is a target-machine, opt-in **provider-contract probe**, not a claim of general model competence or permission to run autonomous missions.

## What the operator does

After the PR is reviewed, merged and local dependencies are installed, start Ollama on 127.0.0.1:11434 with your existing model already installed. The requested model tag must match exactly.

From the PhiBot clone, in PowerShell:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
npm.cmd run model:qualify -- --model qwen3:4b
npm.cmd run model:status
```

The first command runs **one** provider probe on a **fixed 127.0.0.1** Ollama port: GET version, GET installed tags, and **one governed structured-output chat probe** using PhiBot's production provider profile (no thinking, JSON schema, bounded generation). A narrowly scoped existing token-repeat recovery may do exactly one extra model attempt. No hidden deterministic provider fallback is permitted. This run additionally requires Ollama to echo the **exact requested model tag**; a missing or different model identity fails.

For a locally chosen alternate port and bounded timeout, use:

```powershell
npm.cmd run model:qualify -- --model gemma3:12b --port 11434 --timeout-ms 90000
```

Timeout range is 5,000 to 120,000 ms. No arbitrary URLs, remote hosts, credentials, scripts or tool capabilities can be supplied. This request consumes local compute, and may take GPU resources while running. It does **not** execute a PhiBot job, invoke GitHub tools, issue Reality Gate grants, install models, spawn agents, write to repositories or change model configuration.

## Local evidence

Every manual PASS or FAIL saves a new immutable JSON file under the ignored directory `.phibot/crew-readiness/`. The record contains only:

- model tag and configured Ollama TCP port;
- time, PASS or FAIL status, and four pass/fail checks (Node, Ollama reachable, model reported installed, representative structured inference);
- optional measured inference latency and attempt count;
- SHA-256 of the record's own JSON fields;
- mandatory classification `LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED`.

No prompts, raw responses, chain of thought, provider error messages, user data or credentials are saved. The content digest catches accidental file changes but is **not a cryptographic signature**. Anyone who can rewrite local files can rewrite their digest too.

## Crew dashboard

Run the existing localhost dashboard after `npm.cmd run model:qualify`. Its **GET /api/readiness** route projects the newest valid receipt per model (up to 200 local files), with no inference calls. The Crew cards show:

- `RECENT LOCAL PROBE PASS · SELF-REPORT` when the newest receipt passed within the last hour;
- `LOCAL PROBE FAILED` when the newest local attempt failed;
- `LOCAL PROBE STALE` after one hour;
- `NO LOCAL INFERENCE RECEIPT` if the configured model has never been probed or evidence cannot be read.

These labels are **not proof the model is available right now**, not a safety certification, and not an authorization decision. Stale evidence never turns into green status. An invalid or tampered receipt makes the evidence endpoint fail closed instead of displaying false success. The dashboard remains read-only by default. The public GitHub Pages simulation has no access to receipts.

## Acceptance limits

`npm test` includes strict-model-echo refusal, bounded port/time/model validation, synthetic PASS/FAIL receipt tests, file-hash mismatch rejection, missing/stale evidence and dashboard GET-only regression checks. CI uses mocked Ollama responses and **cannot** establish a field PASS on your Windows/RTX machine. For the real result you must run the explicit command above on your computer.

The probe verifies one representative bounded structured-output call, not model quality on real tasks, safe tool use, independent validation of output truth, long-run reliability, multi-agent coordination or isolation. The existing full lifecycle `npm run qualify` remains separate and more comprehensive.

**Ledger Above Ego. An installed tag is not a qualified brain, and one provider probe is not a license to act.**
