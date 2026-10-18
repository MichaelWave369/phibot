# PHIBOT-20: SkepticBot and one-attempt CI repair

> **PHIBOT-24 safety update:** The legacy `steward:repair` direct-write command is now disabled. To generate a reviewed model proposal without any GitHub writes, use `npm run steward:repair:handoff`, then inspect the saved JSON and manually invoke `npm run steward:governed-repair -- <proposal.json>`. Read [PHIBOT-24 handoff guide](REPAIR_HANDOFF_QUEUE.md).


This is an **opt-in, local Ollama proof of concept** for an isolated Repo Steward runner. It is not yet registered as a PhiBot Reality Gate capability and it is not an autonomous multi-step agent running in the background. No schedule, remote model inference, repository code execution, or deployment is added.

## Exact candidate eligibility

- The repository must be listed in `PHIBOT_REPO_ALLOWLIST` and pass the PHIBOT-19 owner/identity check.
- An **open draft** PR must have the PhiBot-created `phibot/issue-N` branch, canonical candidate title/body, a SHA-bound head, and a still-open `phibot-ready` source issue identifying exactly one permitted existing target file.
- GitHub must report a failed CI check, all required checks must be present, the branch must not be behind main, and GitHub must report mergeability.
- The PR must contain **only one modified file**, matching the originally authorized target path. No other added or deleted files.
- The PR commit history must be inspectable, under 100 commits, and must contain **no previous** `phibot: repair-once pr#N` commit.

## Repair sequence

1. Re-run the PHIBOT-19 read-only verifier and select the first eligible candidate with `CHECKS_FAILED`.
2. Read the issue, current PR snapshot, one-file changes, bounded failed-check summaries, and target file content from the exact failing commit SHA.
3. Ask the local **PatchBot** model for schema-constrained JSON containing a short rationale and a complete replacement for that one file.
4. Reject unchanged content, unexpected secret patterns, large changes, major deletion, large files, and changes touching more than 48 contiguous lines (max 1,800-character length difference). The model never receives GitHub credentials.
5. Ask the separate local **SkepticBot** model for a structured judgment using the original source, candidate replacement, issue and failed-check evidence. It must explicitly approve with `LOW` risk, otherwise refuse.
6. **Dry-run is default**. For writes, require `PHIBOT_ENABLE_REPAIR_WRITES=1`, revalidate PR, issue, source content, check evidence, branch SHA, and remote attempt history.
7. Atomically create a durable local one-use attempt marker **before** the remote write. Push one additional commit to the same draft PR branch. Do not create a new PR, merge, enable auto-merge, rerun a workflow, or execute repository code.
8. The GitHub CI system may start new checks on the repair commit. Those checks are **unknown at the time of writing** and must be inspected separately with `steward:verify`.

**The reviewer is another model, not an independently verified test or a proof of safety.** Diagnostic summaries and source files may contain prompt-injection attempts. They are treated as data, with only predefined actions allowed.

## Windows PowerShell field setup

Requires Node 22+, installed local Ollama, repo-scoped fine-grained GitHub token with Contents read/write, Issues read, Pull requests read, Checks read, Commit statuses read, and two different local model tags. Keep credentials outside the repository and do not paste them into chat or issue text.

```powershell
git pull origin main
npm.cmd test
ollama list
$env:PHIBOT_GITHUB_TOKEN = "<securely retrieved short-lived repo-scoped token>"
$env:PHIBOT_REPO_ALLOWLIST = "MichaelWave369/Domistika"
$env:PHIBOT_REQUIRED_CHECKS = "test"
$env:PHIBOT_MODEL = "qwen3.5:9b"
$env:PHIBOT_REVIEW_MODEL = "granite4.2:8b"

# Dry run: local model calls and GitHub reads, but no remote writes
npm.cmd run steward:repair:dry

# After inspecting trial results, prepare a local governed proposal
# Legacy direct-write command retired in PHIBOT-24.
# Use reviewed handoff and separate human-approved Reality Gate workflow:
npm.cmd run steward:repair:handoff
```

Check names are exact GitHub check **job/context** names, not filenames or workflow titles. Try a disposable, tightly allowlisted repository first. The local PC and both models must be available while the command runs.

## Refusal and bounded authority

- No eligible failed CI draft: `NO_REPAIRABLE_FAILED_CI_DRAFTS`.
- Patch fails static guards: `PATCH_REJECTED`.
- SkepticBot refuses or assigns anything but LOW risk: `SKEPTIC_REFUSED`.
- Dry-run approval: `DRY_RUN_REVIEW_ACCEPTED_NO_WRITE` (no remote mutation).
- Successfully submitted one attempt: `ONE_REPAIR_COMMIT_PUSHED_CI_UNVERIFIED`.
- Remote or local retry already consumed, stale PR, different SHA, revoked issue, unsafe target, changed branch, ambiguous CI: stop with an explicit error.

A consumed local attempt marker is **not automatically reset** if a remote write fails or the process crashes. A different local machine has its own markers, so do not run multiple independent operators simultaneously; the GitHub PR commit-message check provides an additional, non-atomic cross-host guard. This prototype does **not** offer distributed transactional locking. Use only one local worker.

Only the main repo's own Node mock tests qualify the implementation in CI. Actual Windows/Ollama inference, remote CI summary fidelity, SkepticBot decision quality, and repository compatibility need operator field evidence.

## Next qualification gates

- Independent hardening audit of prompts and check-summary ingestion.
- GitHub App with repository installation permissions, not a broadly scoped personal token.
- Actual branch-protected CI and sandboxed test reproduction with log size and content controls.
- Governed capabilities behind PhiBot Reality Gate; persistent task queue, retries, lease and per-repo policies.
- Human-only merge remains mandatory.

**Ledger above ego: failed CI is evidence, a suggested repair is a proposal, and a model's low-risk vote is not authority.**
