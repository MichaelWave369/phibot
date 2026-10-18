# PHIBOT-28: local queue field qualification receipt

This rung converts a **previously executed PHIBOT-25 read-only work-queue job** into a bounded **local self-reported qualification record**. It does not rerun the job, talk to GitHub, query Ollama, grant any permission, merge, deploy or modify queue events. It can qualify the first real RepoScout observation that was already completed on the operator's Windows PC.

## First Windows 11 qualification

After merging PHIBOT-28, in the **same local PhiBot clone and working directory** that contains the saved dashboard jobs and `.phibot/work-queue`:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
npm.cmd run queue:list
npm.cmd run queue:qualify
```

When **exactly one completed read job** is in the queue, `queue:qualify` selects it automatically. A successful run prints `FIELD_RECEIPT_SAVED_LOCAL_SELF_REPORT`, a SHA-256 digest, the local file path, the observed task/issue counts or check status, and which qualification gates remain open.

If more than one completed job exists, copy the *full 64-character job ID* from `npm.cmd run queue:list`, then:

```powershell
npm.cmd run queue:qualify -- create --job <full-64-character-job-id>
npm.cmd run queue:qualify -- verify --job <full-64-character-job-id>
```

The receipt is written to **`.phibot/work-queue/qualification/<job-id>.json`** (ignored by Git, exclusively created, file mode `0600` on POSIX; Windows permissions depend on the user profile and NTFS ACLs). Never commit the qualification directory, credentials, queue files or full private receipts to GitHub. The command needs **no GitHub token**. It makes no network calls.

## What is checked

1. The queue job appears in the existing `inspectQueue` projection, has a valid allowlisted repository identity, is `completed` after 1 or 2 attempts, and reports `OBSERVED_NO_PROMOTION`.
2. The underlying durable job file is readable, bounded in size, matches the projection, has **no active lease**, and contains the expected metadata-only observation schema and SHA-256 digest.
3. The local worker lock **must be absent**. The journal must be complete and parseable, with correctly typed event records and a bounded number of relevant transitions.
4. The chosen job's event sequence must start with `ENQUEUED`, progress through `LEASED`, optionally `RETRY_QUEUED` or `STALE_LEASE_RECOVERED`, and finally end at `OBSERVED`. Attempt counts and observed metadata must exactly match the job file. Timestamp reversal, duplicate terminal events, missing evidence, broken ordering and mismatched digests are refused.
5. Source job bytes and journal bytes are re-read before saving; any observed change aborts the qualification.
6. The saved **metadata-only receipt** holds the original job file digest, the selected journal-event chain digest, transition times/types, observation counts/check status, OS platform/architecture, Node major version, and explicit unverified gates. A deterministic self-hash covers the receipt body. Requalifying the same job never overwrites the original receipt.

**Important:** `verify` only checks the receipt's own SHA-256 consistency. It does not establish authenticity or independently prove the remote GitHub response. Anyone who can rewrite the receipt can also recompute an unkeyed hash. The filesystem and originating job/events are **local, self-reported evidence**. They are not signed attestations or proof that model behavior, source changes or CI correctness have been independently tested.

## Classification

A successful create reports:

`LOCAL_SELF_REPORTED_READ_OBSERVED`

This means: *The already-persisted local files are internally consistent with a completed read-only observation.* It does **not** assert independent source correctness, new remote GitHub checks, absence of unrelated program side effects, or production security.

Still open after this rung:

- Independent recheck of the GitHub observation
- Actual SHA-bound Repo Steward CI Inspector field run
- Interrupted worker/lease recovery under Windows
- Local PatchBot/SkepticBot field qualification
- One **separately authorized**, human-gated disposable-repo write test

## Known limits

- No remote or network access; no code from target repositories is executed. Nothing is automatically scheduled.
- Evidence journal and job files are local mutable state. Hashes are correlation checks, not a signature, TPM quote or permission boundary.
- Receipts are intentionally local-only. Do not upload them to the public GitHub Pages demo.
- If a worker is still active, the event journal is missing/truncated, a job ID is ambiguous, or any contract is inconsistent, the tool refuses and **does not produce a PASS-looking receipt**. It won't repair the ledger or fabricate missing transitions.
- The latest job state is authoritative for queue status. This qualifier cannot reconstruct raw earlier responses or prove CI conclusions that were never persisted.
- Process platform and Node metadata are diagnostic self-reports, not hardware inventory or an attested machine identity.

**Ledger Above Ego. The provenance of an observation is not the same thing as independently proving it.**
