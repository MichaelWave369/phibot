# PHIBOT-29: CI Inspector eligibility preflight

The first PHIBOT-28 operator field run saved a **real local self-reported observation receipt** (16 detected roadmap tasks, 0 issues). The next distinct field gate is **SHA-bound CI Inspector**. That capability is intentionally limited to an *open, same-repository, PhiBot-generated draft PR* linked to an *open issue with the `phibot-ready` label*. It will **not** accept an arbitrary merged PR, including this project's normal merged PRs.

PHIBOT-29 adds a bounded **GitHub GET-only preflight** to check strict eligibility and required CI contexts **before** an operator consumes an attempt in PHIBOT-25's local queue. This does not create an issue, draft PR, repair, grant, branch, source commit, or CI status.

## One-time Windows setup

After merging PHIBOT-29, in the **same local PhiBot directory**:

```powershell
git pull origin main
npm.cmd install
npm.cmd test

$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/YourSandboxRepo'
$env:PHIBOT_GITHUB_TOKEN = '<read-only fine-grained GitHub token stored outside the repo>'
```

The token needs read permissions for repository metadata, pull requests, issues, checks, commit statuses and compare APIs. Do not paste it into the command, a tracked file or a dashboard form.

## Required real candidate

First, an operator must already have an **eligible open draft PhiBot candidate PR** in the selected sandbox repository, produced by the existing independently authorized Repo Steward workflow:

- PR is **open and draft**, titled `PhiBot candidate: ...`
- PR is in the same allowlisted repository and branches from its current default branch
- Head branch is `phibot/issue-N` with a valid 40-character Git SHA
- PR body includes the **exact** issue binding `Autonomous local-model candidate for #N` and a single valid `Target file:` line
- Issue **N is open**, labeled `phibot-ready` and contains the **same target file**
- Pull request head is not behind default branch and GitHub reports it mergeable
- Named CI check context(s) exist and their data are complete

The Repo Steward initial draft creation workflow remains a separately opted-in write path. **This preflight cannot create its own test PR or override the issue authorizations.** A successful ordinary PR is not sufficient. If no eligible draft PR currently exists, leave this CI qualification as **NOT YET FIELD TESTED** rather than inserting fabricated evidence.

## Preflight (read-only)

With an existing eligible sandbox PR and its **exact GitHub Actions check name**:

```powershell
npm.cmd run queue:inspect:preflight -- --repo MichaelWave369/YourSandboxRepo --pr 7 --checks "test"
```

This displays a metadata-only result. For an eligible, unchanged PR with fully observed named checks, the preflight reports:

`READY_FOR_READ_ONLY_INSPECT_QUEUE`

It also distinguishes cases such as `PR_NOT_ELIGIBLE_PHIBOT_DRAFT`, `ISSUE_AUTHORIZATION_NOT_PRESENT`, `REQUIRED_CHECKS_MISSING`, `PR_CHANGED_DURING_PREFLIGHT`, and `PR_BASE_BEHIND_OR_UNVERIFIED`.

**No queue file is written by this command.** A passing check is `CHECKS_PASS_REVIEW_ONLY`, not proof of code correctness or permission to merge.

## Explicitly enqueue and run

Only after reviewing the eligible PR:

```powershell
npm.cmd run queue:inspect:preflight -- --repo MichaelWave369/YourSandboxRepo --pr 7 --checks "test" --enqueue
npm.cmd run queue:list
npm.cmd run queue:run-once
npm.cmd run queue:list
```

The `--enqueue` flag exclusively creates **one local PHIBOT-25 `repo.steward.inspect` read job**. It does not remotely mutate the repository. The existing queue worker re-checks current PR/issue state, SHA, checks and allowlist when the operator later starts `run-once`. A PR changing between preflight and execution is refused. Queue jobs are deterministic and immutable; re-running identical enqueue does **not** reset a completed or exhausted job.

If the inspection completes, you can qualify that new job separately:

```powershell
npm.cmd run queue:qualify -- create --job <64-hex-job-id-from-queue:list>
npm.cmd run queue:qualify -- verify --job <64-hex-job-id-from-queue:list>
```

PHIBOT-28 records a local self-report; this second field run does **not** independently authenticate the remote check status or prove CI correctness. Independent out-of-band remote rechecking remains a separate gate.

## Hard boundaries

- **Only GitHub GETs** through the existing PhiBot API client; no POST, PUT, DELETE or model calls
- Requires a **repository allowlist, exact CI check names and a read-only token**
- No autonomous job creation; `--enqueue` is an explicit operator action and only touches ignored local queue files
- No raw issue descriptions, source code, check logs or credentials in the preflight response
- No creation, automatic repair, merge, deployment or Reality Gate authorization
- This does not alter PhiBot's previously accepted permissions or widen CI Inspector eligibility

**Ledger Above Ego. A legitimate test needs legitimate authorization, not a convenient substitute.**
