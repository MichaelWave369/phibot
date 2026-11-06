# PHIBOT-43: Exact-commit GitHub CI evidence, read-only

PHIBOT-43 introduces an explicit **read-only GitHub Actions observation** following PHIBOT-42's separately human-gated **local Git commit**. It checks that the remote branch has been pushed to the exact same commit as a locally verified PHIBOT-42 receipt, then inspects GitHub's reported `CI` workflow and `test` job for **that exact SHA**. It never pushes, opens a pull request, approves a change, merges, retries CI, deploys, edits workflow settings, or grants an agent any new capabilities.

## Crucial CI trigger distinction

PhiBot's current `.github/workflows/ci.yml` triggers on **pushes to `main`** and on **pull requests**. A push of `phibot/docs-...` alone may have **no corresponding CI run**. The expected result is `CI_NOT_OBSERVED`, not a green check. You can manually open a pull request to trigger the repository's existing CI, subject to GitHub rules and the run being associated with the exact commit SHA. **The software does not open the PR for you.**

## Preconditions and authentication

First complete PHIBOT-38, 39, 40, 41, and 42 on your own local Git clone. PHIBOT-42's `crew:commit:verify` must succeed, and the local branch must remain named `phibot/docs-...`, at the exact new commit with a clean worktree. Both the *local path* and *GitHub repository* must be explicitly allowlisted. The current implementation is intentionally scoped to PhiBot's concrete CI policy: workflow `CI`, file `.github/workflows/ci.yml`, and one required job named `test`.

Use a GitHub token with **read-only access** to the repository metadata, Contents/branches, and Actions runs/jobs. The process accepts `PHIBOT_GITHUB_TOKEN` or `GH_TOKEN` (only in memory; neither is included in the output or local receipt). Fine-grained tokens with Actions **read** and Contents **read** suffice for appropriately accessible repos; repository metadata is also read. The token must be supplied in the local process environment and never committed, pasted into logs or shared publicly.

## Windows PowerShell operator procedure

After reviewing and merging PHIBOT-43, pull it into your local clone and run the automated tests. Separately, **make and verify** a PHIBOT-42 documentation commit on a dedicated branch. The `crew:ci:read` command NEVER performs the push.

```powershell
npm.cmd test
$draft = '<actual-PHIBOT-40-draft-UUID>'
$env:PHIBOT_CREW_REPO_ALLOWLIST = (Resolve-Path .).Path
$env:PHIBOT_CREW_REMOTE_REPO_ALLOWLIST = 'MichaelWave369/phibot'
# Obtain PHIBOT_GITHUB_TOKEN or GH_TOKEN securely from your own credential store.
npm.cmd run crew:commit:verify -- --draft $draft --repo .
git rev-parse HEAD
git status --short
```

**Only if you decide to publish the local commit**, push the exact approved branch manually using Git. If you want the current repository CI workflow to run, create a pull request manually on GitHub. The push and PR are **human actions outside PHIBOT-43**.

```powershell
# Human-only, optional remote actions performed outside PhiBot:
git push -u origin phibot/docs-reviewed-guide
# After the branch and its CI run exist, observe without mutating GitHub:
npm.cmd run crew:ci:read -- --draft $draft --repo . --remote MichaelWave369/phibot
npm.cmd run crew:ci:list
```

Replace `phibot/docs-reviewed-guide` with the actual branch from `git branch --show-current`. The remote branch must point to the exact SHA returned by `crew:commit:verify`. If an unrelated or later commit moves it, the read reports `REMOTE_BRANCH_NOT_AT_LOCAL_COMMIT` and does not claim CI success.

## What gets checked

The observer first reuses PHIBOT-42's **independent local commit verifier**. This checks the locally saved commit intent/result, current dedicated branch, parent and Git tree, the committed blob bytes, and the worktree's exact SHA-256. Without a valid local receipt, **no GitHub read occurs**.

Then PhiBot uses only HTTPS **GET** calls against GitHub's fixed API and this exact allowlisted repository. It reads:

- Repository metadata and exact branch head. An unexpected owner, fork, disabled or archived repository is refused.
- At most 100 GitHub Actions workflow-run records filtered for the exact SHA. Incomplete or truncated result sets are refused instead of being treated as complete.
- The newest matching `CI` workflow run from this repository, with identical **head SHA**, **head branch**, **workflow path**, and `push` or `pull_request` event. Older successes never override a newer failure.
- Exactly one named `test` job for a complete run; pending, failed, skipped, missing, extra, or inconsistent jobs do **not** produce a PASS.
- A second read of that exact workflow run and another read of the remote branch, to refuse an observed change before reporting a PASS.

Outcomes:

| Status | Meaning |
| --- | --- |
| `CI_PASS_EVIDENCE_ONLY` | GitHub reports the matching latest CI run and its `test` job completed successfully. Human review is still required; not merge approval |
| `CI_FAILED` | GitHub reports failure for the matching run or required job |
| `CI_PENDING` | An observed run is not complete |
| `CI_NOT_OBSERVED` | No matching exact-SHA workflow run found, possibly because no PR has been opened |
| `REMOTE_BRANCH_NOT_AT_LOCAL_COMMIT` | The remote branch tip is missing or differs from the locally verified commit (a missing branch may cause a refused API read) |
| `CI_EVIDENCE_UNQUALIFIED` | The reported run/jobs are structurally incomplete, inconsistent or not successfully concluded |
| `CI_CHANGED_DURING_OBSERVATION` | The specific remote run or branch changed during the read |

Each observation is saved under ignored `.phibot/crew-remote-ci/<UUID>.json` as an **append-only local JSON receipt** with SHA-256 consistency hashes, the exact SHA, repo/branch identity, reported run/job status, timestamps, and explicit `remoteWrites: 0`, `gitPushes: 0`, `mergeAuthorized: false`. The inventory command revalidates schemas and hashes. These digests are **not cryptographic signatures**; an attacker with local write access can forge self-consistent records.

## What a green result does not establish

A GitHub API observation is not independent attestation or proof of code correctness. It does not prove required branch protection rules were satisfied, all repository checks succeeded, code review took place, external CI ran, the PR base is current, or that a merge is authorized. GitHub checks for pull requests may attach to a synthetic merge SHA rather than the exact branch-head commit. In that case PHIBOT-43 **does not promote the result**: no exact-match run is reported. The observer makes no mergeability or deployment claims.

GitHub can change between any two reads. The observer detects drift in the chosen branch and run, but cannot provide an atomic GitHub snapshot. Check names/workflow paths are pinned to this repository's current CI configuration and must be reviewed if that configuration changes. A workflow that succeeds despite malicious or insufficient tests is still not proof that a proposed documentation change is safe.

## Acceptance

`npm test` includes `scripts/crew-remote-ci.test.mjs`, which verifies exact identity checks, no remote mutation, persisted local receipts, required GitHub run/job checks, pending/missing/failure separation, newest-run precedence, truncated responses, remote branch drift, altered run attempts, forged identity and authority fields, missing allowlists, and refusal to query GitHub without a valid local PHIBOT-42 verifier result. All real GitHub observations require a valid token. CI tests use mocked GitHub responses and are not evidence of a real remote run or Windows field qualification.

**Ledger Above Ego. A green remote CI observation is evidence for a human, never permission to merge.**
