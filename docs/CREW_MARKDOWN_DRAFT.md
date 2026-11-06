# PHIBOT-40: Exact Markdown draft proposals without repository writes

PHIBOT-40 turns a completed, locally acknowledged **PHIBOT-39 source-pinned crew handoff** into one proposed, exact Markdown replacement. It is intentionally **not** a source-repair executor. The source file is never written. The draft, exact small diff, source hashes, and local receipt are saved under ignored `.phibot` state. No model inference or GitHub API calls are added.

## Safety and meaning of the acknowledgement

The existing PHIBOT-39 handoff must already contain a complete three-role review and a human-typed advisory acknowledgement. **That old acknowledgement only permits drafting.** The operator then authors an exact candidate Markdown file. PHIBOT-40 checks source provenance and candidate size, presents the precise diff, and requires a **separate** `DRAFT <first 16 hex characters of proposal digest>` in an interactive terminal before saving the inert proposal.

This is not a Reality Gate write approval. The existing governed repair tool requires an open issue, draft PR, exact code path under `src/` or `test/`, human approval of a different exact replacement, and a Reality Gate grant. That tool **cannot** consume PHIBOT-40 Markdown draft packets. Actual Markdown writes will require a separate, purpose-built, human-approved gated workflow in a future rung. No merge or deploy is authorized by this code.

## Windows operator instructions

On your local PhiBot clone, review and merge the PHIBOT-40 PR, then pull, install dependencies and run tests. Keep Git on the exact commit selected by the PHIBOT-38 review and PHIBOT-39 handoff. If `HEAD` has moved, create a fresh source-pinned review and handoff rather than trying to reuse a stale one.

PowerShell:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_CREW_REPO_ALLOWLIST = (Resolve-Path .).Path
npm.cmd run crew:handoffs
```

Choose an actual PHIBOT-39 handoff **ID**. Its underlying review must still be available in ignored local `.phibot/crew-pinned-reviews/`. For a human-edited candidate, create a draft under the fixed ignored folder, not inside the reviewed `docs/` file:

```powershell
New-Item -ItemType Directory -Force .phibot/crew-drafts | Out-Null
Copy-Item docs/CREW_TRIAL.md .phibot/crew-drafts/crew-trial.md
# Edit .phibot/crew-drafts/crew-trial.md in your editor.
$handoff = '<actual-PHIBOT-39-handoff-UUID>'
npm.cmd run crew:draft:preview -- --handoff $handoff --repo . --replacement .phibot/crew-drafts/crew-trial.md
npm.cmd run crew:draft:record -- --handoff $handoff --repo . --replacement .phibot/crew-drafts/crew-trial.md
npm.cmd run crew:drafts
```

The copied filename can be different, but the replacement file must be a regular `.md` file **directly inside** `.phibot/crew-drafts/` for the same allowed repository. It cannot be a symlink or elsewhere on disk. Input is strictly valid UTF-8, at most 6144 bytes and 160 lines, with normalized LF line endings; the original pinned source must already use LF. PowerShell copy preserves existing content; save your edited candidate in UTF-8. The revised file must actually differ from the source.

The diff is bounded to **16 changed lines per side**, a total size of at most 4096 UTF-8 bytes, and at most 1500 UTF-8 bytes of file-size difference. Obvious private-key and common API-token patterns are refused, but **that is not complete secret detection**. Never use this pipeline with private or sensitive source material. The draft packet intentionally contains the full replacement Markdown, which may be confidential if you put confidential content in it.

## Source pin and recheck behavior

- The source repository must be one of the canonical paths in `PHIBOT_CREW_REPO_ALLOWLIST`. Its exact commit and Markdown path are obtained from the immutable PHIBOT-39 handoff, **never from model-generated instructions**.
- The handoff and linked PHIBOT-38 review must both pass schema and SHA-256 consistency checks. PHIBOT-40 re-runs the PHIBOT-39 source checks: original pinned Git blob, commit SHA, path, Git blob SHA, SHA-256, repository label, exact current `HEAD`, and a clean target file.
- The original document is read from the selected immutable Git blob, not from the possibly dirty worktree. The candidate comes only from the explicit local draft folder.
- The stored packet binds the handoff ID and receipt digest, crew review digest, exact original source identity, original and proposed file SHA-256 hashes, full replacement Markdown bytes, a context diff, edit counts and an unambiguously inert status.
- The command recomputes the entire proposal after the interactive digest prompt. If the source, review, handoff or candidate changes between preview and final recording, it refuses. There is no cross-process Git lock or host-level attestation.
- The output is stored with exclusive-create semantics in `.phibot/crew-markdown-drafts/<handoff-id>.json`: **one recorded draft per acknowledged handoff**, no overwrite. If you need a different proposal after recording, create a new source review and handoff rather than overwriting the earlier evidence.

## Validation and residual limitations

The exact replacement and diff are reproducible against the pinned source. Receipt hashes detect accidental edits but are **not signatures**; a malicious local process with filesystem access could rewrite both the content and its hash. The typed phrase proves only the human-facing CLI was used as intended, not identity. The source file could change after checking and before writing the inert packet; the packet does not write to it, so this is not a transaction.

Tests use real temporary Git repositories and mock crew models to exercise normal proposals, the changed-line diff, no-op and size limits, symlink/out-of-folder input rejection, changed candidates after preview, stale HEAD and dirty target refusal, incomplete or tampered handoffs, forged authority, duplicate recording and absence of Git source modifications. CI does **not** test real Ollama inference or provide Windows field qualification.

**Ledger Above Ego. A reviewed exact draft remains a proposal, not permission to change source.**
