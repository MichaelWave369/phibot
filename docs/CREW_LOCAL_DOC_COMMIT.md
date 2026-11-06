# PHIBOT-42: Explicitly approved local documentation commit

PHIBOT-42 adds an **independent Reality Gate and a single human-controlled local Git commit** after the PHIBOT-41 Markdown apply and hash verification. It is intentionally limited to a **local dedicated documentation branch**. It never performs a push, remote GitHub API call, PR creation, CI run, merge or deployment. Neither the review model nor any normal bot can invoke its capability.

## Required evidence and branch

Before PHIBOT-42, the local repository must have one completed chain: (38) source-pinned Scout/Patch/Skeptic advisory, (39) human-review acknowledgement, (40) exact Markdown draft, (41) a **separately Reality-Gate-authorized local apply** with a matching independent hash receipt. The new commit gate does **not** promote old acknowledgements into write authority.

You must be on a branch matching `phibot/docs-<topic>`, created at the **same source commit** recorded in the PHIBOT-38 review. Do not use `main`, `master`, detached HEAD, a release branch, or arbitrary branches. Creating a new branch from the same existing commit does not change the pinned commit, so it can be done after applying the edit, as long as no checkout changes the document.

The entire Git working tree must have exactly **one unstaged modification**, the PHIBOT-41 approved Markdown file. Other tracked modifications, staged changes, and untracked files are refused. Ignored `.phibot/` evidence is permitted. `git diff --check` on the target must pass. No untrusted document or model output determines the branch name, target, or commit message.

## Windows PowerShell procedure

After PR review/merge and local pull, use your own clone, not the GitHub-hosted test runner:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_CREW_REPO_ALLOWLIST = (Resolve-Path .).Path
# Create a dedicated local branch AT THE SAME SOURCE COMMIT as the older review:
git switch -c phibot/docs-reviewed-guide
```

Perform PHIBOT-38 through PHIBOT-41 using your real model and the documented operator commands. With exactly one verified PHIBOT-41 local edit (and no other changed or untracked files):

```powershell
npm.cmd run crew:apply:verify -- --draft <actual-PHIBOT-40-draft-UUID> --repo .
git status --short
git diff -- docs/CREW_TRIAL.md
git diff --check
```

Replace the example path with the actual approved target. Then generate a new local secret for the separate commit Gate, or securely reuse your existing locally held one. Never put the secret in an issue, commit, chat, screenshot, command history, or CI log.

```powershell
$draft = '<actual-PHIBOT-40-draft-UUID>'
$env:PHIBOT_ENABLE_LOCAL_DOC_COMMIT = '1'
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:PHIBOT_REALITY_GATE_SECRET = [Convert]::ToBase64String($bytes)
npm.cmd run crew:commit -- --draft $draft --repo .
```

The CLI creates a new Reality Gate request and prints the exact canonical repository root, dedicated branch, old HEAD, approved target, PHIBOT-41 receipt digest and approved new SHA-256. Type **`COMMIT <first 16 hex characters of the new Reality Gate input digest>`** only after reviewing. Any mismatch denies the grant without attempting staging.

On explicit authorization, a single local commit is created with message `docs(phi): approved crew draft <8-char-draft-prefix>`. It uses Git's lower-level `hash-object`, `update-index`, `write-tree`, `commit-tree` and compare-and-swap `update-ref` to avoid running shell scripts, hooks or an editor. A single new commit is allowed to include **only** the approved Markdown path. The source SHA-256 is rechecked before staging, immediately before creating the commit, after the commit, and during independent verification. No remote branch is updated.

Independently verify the result:

```powershell
npm.cmd run crew:commit:verify -- --draft $draft --repo .
git status --short
git show --stat --oneline HEAD
git show --format= -- docs/CREW_TRIAL.md
npm.cmd test
```

Replace the example path with the actual target. Expected result: exactly one committed documentation change and a clean working tree. The verifier reports **`LOCAL_COMMIT_HASH_VERIFIED_REMOTE_CI_UNKNOWN`**, checks exact branch/head/parent/tree, the committed Git blob's contents, local working file SHA-256, and no further modifications. **It does not report green CI.**

## Security design and recovery

- The tool capability ID is `crew.markdown.commit-local`, `actionClass=write`, `requiresGate=true`. It is **only registered by the operator CLI**, not the builtin tool registry, service or dashboard. It has a separate explicit opt-in `PHIBOT_ENABLE_LOCAL_DOC_COMMIT=1`, requires a real TTY, and a 32+ character Reality Gate secret. The exact-input grant is short-lived and one-use.
- The canonical local repository must match `PHIBOT_CREW_REPO_ALLOWLIST`, be the actual Git top-level (not a subdirectory), use Git SHA-1 object IDs, and have a dedicated `phibot/docs-...` branch. Git environment overrides (such as `GIT_INDEX_FILE`, `GIT_DIR`, or `GIT_WORK_TREE`) are refused.
- The exact PHIBOT-41 application intent and result are revalidated, along with the live local file SHA-256, pinned parent commit, status and clean-diff checks. The Git index is updated for **only** the selected target and the new tree is compared with the original commit to reject any second path.
- The operator's local Git `user.name` and `user.email` must be configured. Commit signing and hooks are not invoked through this lower-level method. Git config values and local OS security still belong to the trusted operator.
- A one-attempt intent file is written with exclusive-create semantics under ignored `.phibot/crew-local-commits/<draft-UUID>.intent.json` **before staging or commit-object writes**. No automatic rollback/replay is attempted. A verified success receipt is written only after HEAD and the local working tree are independently checked.
- **Crash and race limitation:** this is not an atomic transaction across the index, object store, Git branch ref, local receipt and ledger. Another local process could change the worktree/index during the operation. The branch ref update is compare-and-swap against the old SHA, but Git provides no cross-process lock for the whole operation. If an error happens after intent creation, **do not blindly retry or delete the fence**. Inspect `git status`, `git log -1`, `git ls-files --stage`, the exact target bytes, and local receipt/ledger; manual recovery may be required.
- The receipt hashes are for local integrity consistency, **not cryptographic attestation of user identity**. A process with OS write access could forge local evidence. The human TTY prompt is not an identity credential.
- CI is **not run automatically** by PHIBOT-42. GitHub Actions cannot see a local-only commit until a user deliberately pushes or opens a PR elsewhere. A later rung may add read-only GitHub CI evidence tied to an exact remote commit SHA, without granting automatic merge.
- Real Windows and local Ollama field qualification remain separately outstanding. GitHub CI uses mocked model outputs and temporary Git fixtures.

## Regression acceptance

`test/crew-local-doc-commit.test.ts` constructs real local Git repositories and the complete mock PHIBOT-38→39→40→41 chain. It exercises a new gate request/approval/consume cycle, exact single-path Git commit, independent verification, grant replay and denial, refusal of arbitrary branches, unrelated/untracked and staged content, changed source and receipts, receipt forgery, exclusive one-attempt fence and post-commit tampering.

**Ledger Above Ego. A local commit is evidence of a local change, not a remote CI result or permission to merge.**
