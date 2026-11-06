# PHIBOT-39: Human-reviewed source-pinned crew handoff

PHIBOT-39 turns a **completed PHIBOT-38 Scout → Patch → Skeptic read-only review** into a human-acknowledged, **inert local advisory handoff**. It does not generate replacement code, apply a patch, call GitHub, make a commit, open a PR, or issue a Reality Gate grant. An acknowledgement is permission to **consider manually drafting** a change, not authorization to make one.

## What is actually approved

The human sees and explicitly accepts the combination of:

- The repository label, **full pinned commit SHA**, approved Markdown path, Git blob SHA and **SHA-256 of the exact source bytes**.
- The PHIBOT-38 review ID and SHA-256 receipt digest, local model name, and three short, unverified Scout/Patch/Skeptic advisory summaries.
- The narrow scope `ONE_PINNED_MARKDOWN_FILE_PROSE_ONLY` and authority `NO_EXECUTION_NO_REPO_WRITE_NO_GRANTS`.

The tool refuses incomplete or failed three-role reviews. The locally stored review must pass its original strict schema/digest validation. Before preview or storage, the tool reopens the **original pinned Git blob**, verifies the SHA-256/identity, requires the local checkout `HEAD` still equals the reviewed commit, and refuses a staged or unstaged change to that one target file.

## PowerShell quick start

After merging, from your local PhiBot clone (with Node 22+ and Git installed):

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_CREW_REPO_ALLOWLIST = (Resolve-Path .).Path
npm.cmd run crew:pinned:list
```

Take a **successful** PHIBOT-38 pinned review's `id` from your local output. It must belong to the exact current commit. A review from an older commit is intentionally considered stale: rerun PHIBOT-36 model qualification as needed, then PHIBOT-38 with the current commit, before continuing.

Preview an existing review without storing anything:

```powershell
$review = '<actual-PHIBOT-38-review-UUID>'
npm.cmd run crew:handoff:preview -- --review $review --repo .
```

To acknowledge the **same** plan in an interactive PowerShell terminal:

```powershell
npm.cmd run crew:handoff:review -- --review $review --repo .
npm.cmd run crew:handoffs
```

The CLI prints the three unverified advisories and exact proposal SHA-256. Type **`REVIEW <first 16 hex characters>`** precisely when prompted. There is no unattended approval option. A second acknowledgement for the same review ID fails rather than overwriting the original.

The exclusive-create acknowledgement file is kept under ignored local state `.phibot/crew-review-handoffs/<review-UUID>.json`. The filename uses the underlying review ID for one-per-review idempotency. Each receipt stores its own SHA-256 consistency digest, the proposal digest, the three short summaries, the exact source evidence and a conspicuous local, unauthenticated acknowledgement classification.

## Threat model, limits, and next gate

- **No writable Git operations** in this feature. The program reads only existing PHIBOT-38 receipts and a fixed Git snapshot using existing source validation. `git status` and `git rev-parse HEAD` are used to refuse source drift. No external network access, HTTP listener, model inference or API token handling is added.
- Local SHA-256 protects integrity against accidental edits, not malicious local actors. A terminal phrase does **not** cryptographically attest the operator's identity. A local program can call the TypeScript functions; this is process/account-level trust, not a hardened multi-user approval service.
- The approval phrase binds one exact immutable *advisory packet*, not a future patch or repository write. A later actual source change still needs its own full proposed replacement, pinned GitHub issue/PR authorization, explicit Reality Gate human approval, and downstream CI verification.
- PHIBOT-39 packets have a different schema from the existing governed source-repair tool. They **cannot** be fed into it as a valid executable repair request. No automatic promotion from advisory review to actual code editing.
- Only one tracked Markdown target is eligible through the existing PHIBOT-38 source reader. Dirty target and moved HEAD are refused. Other files may be dirty; this is deliberately not a whole-repository clean-state guarantee. A file could change between the check and writing the inert packet; no transactional filesystem lock is claimed.
- The packet contains three model summaries, which could quote sensitive reviewed text. Do not use this path with secrets or private/confidential Markdown. Receipt files stay local under `.phibot`.
- If a model's advice is incorrect, three model opinions do not make it true. Human review should consider source facts separately.

## Tests

`npm test` includes a genuine temporary-Git-repository test suite that checks immutable proposal binding, source/hash replay, dirty target refusal, moved-HEAD refusal, repo allowlist enforcement, failed/incomplete reviews, strict schema and authority, tamper rejection, and one-review-one-acknowledgement behavior.

GitHub CI tests use mocked local provider output. CI cannot confirm real Windows/Ollama field behavior or human identity. This is an operator trial, not a production deploy grant.

**Ledger Above Ego. Human-reviewed advice is still not a license to write.**
