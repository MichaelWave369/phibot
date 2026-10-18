# PHIBOT-22: exact-input Reality-Gated Markdown draft PRs

PHIBOT-22 introduces **one real GitHub write capability** in PhiBot's normal `ToolCapabilityRegistry`: `repo.steward.draft`. It is a candidate for local field qualification, not an installed unattended service. It does not automatically merge, approve, deploy, dispatch workflows, edit code files, or close issues.

## Fixed authority boundary

- Registry-owned `write` action class, `external: true`, **`requiresGate: true`**. Even a bot manifest with `authority.write=true` cannot bypass its Reality Gate.
- `authority.write=false` is an unconditional denial, even with a proposed grant. `authority.write="gated"` is the recommended manifest mode.
- A signed, expiring, one-use Reality Gate grant binds the **exact full request digest**, run ID, bot ID and capability ID. The complete replacement content, issue number, repository, target and both pinned SHAs are part of that digest.
- Default `npm run tool` has no Reality Gate configured and therefore cannot execute this write. The new interactive CLI configures the gate, displays the full proposal, and asks a human to type the request-specific approval digest.
- Separate `PHIBOT_ENABLE_GOVERNED_DRAFTS=1` and a narrowly scoped `PHIBOT_GITHUB_TOKEN` are additionally required to perform GitHub mutations.

## What the tool can do

1. Accept exactly seven fields: `repository`, `issueNumber`, `target`, `expectedBaseSha`, `expectedBlobSha`, `replacement`, `summary`.
2. Validate an owner-matching repository explicitly present in `PHIBOT_REPO_ALLOWLIST`.
3. Limit the target to an **existing Markdown file**: root `README.md` or safe `docs/**/*.md`. No `src`, `test`, workflow, gate, security, auth, hidden file, new file, config, dependency or deploy path.
4. Fetch repo identity, check that `phibot/issue-N` does not exist, and verify the linked issue remains **open**, has exactly one matching `Target file:` declaration, and is labeled `phibot-ready`.
5. Confirm the repository default branch tip matches `expectedBaseSha`, and the target blob exactly matches `expectedBlobSha`. Reject no-ops, large rewrites, suspicious credential patterns, and more than 48 changed contiguous lines.
6. Recheck issue approval, base SHA and branch absence immediately before GitHub writes. Create one new branch from the pinned base, PUT one existing Markdown file, then POST **one draft PR** with a warning that no CI has yet been verified.
7. Return the draft URL, commit SHA and explicit `DRAFT_PR_CREATED_CI_UNVERIFIED` receipt. Never merge or promote.

## Preparation (Windows PowerShell, Node 22+)

```powershell
git pull origin main
npm.cmd install
npm.cmd test

# Retrieve credentials securely in this local session, not inside GitHub files:
$env:PHIBOT_GITHUB_TOKEN = '<scoped token from secure local store>'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/Demo'
$env:PHIBOT_ENABLE_GOVERNED_DRAFTS = '1'
$env:PHIBOT_REALITY_GATE_SECRET = '<random secret at least 32 characters>'
```

Create an issue in an intentionally disposable and allowed test repository. The issue must be open, labeled `phibot-ready`, and include one line exactly `Target file: README.md`. Use repo-scoped token permissions: repository Metadata read, Issues read, Contents read/write, Pull requests read/write. Keep the gate secret and GitHub token out of CLI argument text, issues, scripts, repo files and chats.

Prepare a local JSON proposal with **real SHA values** inspected from the latest repository default branch commit and README blob. The content is a complete replacement, not a diff. Review the exact text carefully before proceeding:

```json
{
  "repository": "MichaelWave369/Demo",
  "issueNumber": 7,
  "target": "README.md",
  "expectedBaseSha": "<40-character current default-branch commit SHA>",
  "expectedBlobSha": "<40-character README Git blob SHA>",
  "replacement": "# Demo\nUpdated README text.\n",
  "summary": "Clarify the existing README documentation for an approved issue."
}
```

The placeholder SHAs above will fail validation until replaced with real 40-hex-character values. The default-base SHA and blob SHA are distinct. Place the JSON outside the Git repository. No local AI creates or submits this proposal automatically in PHIBOT-22.

```powershell
npm.cmd run steward:governed-draft -- C:\Path\OutsideRepo\candidate.json
```

The interactive CLI prints the exact proposal and digest, then asks you to type `APPROVE <16 hex characters from the displayed request digest>`. Anything else is recorded as a denied gate decision and creates **no GitHub write**. A non-interactive terminal, missing grant secret, invalid scope, changed branch or revoked issue refuses the action.

## Known limits and required field tests

- This does not turn the existing `steward:run` or `steward:repair` scripts into governed tools. Those **remain separate opt-in scripts**, and should not be scheduled or trusted to bypass this gate.
- `ToolSandbox` is a cooperative timeout/AbortSignal wrapper, **not** an OS process sandbox. A remote POST/PUT can succeed even if the local process crashes or times out afterward. An orphan branch may need manual inspection. The CLI uses a 90-second timeout for this reason.
- The built-in Reality Gate replay store is in-memory, not cross-machine durable. A second run may have a fresh gate, but the deterministic `phibot/issue-N` branch provides a remote no-repeat refusal; concurrent machines remain unsupported.
- GitHub's API calls are **not transactional**. The branch may exist without a completed PR after a partial remote failure. This implementation will refuse to retry automatically to avoid overwriting an ambiguous prior write.
- Prompt injection and unsafe Markdown are not eliminated by a second model or static checks. The human must review the complete replacement and the resulting diff; CI and review are mandatory before a merge.
- No unattended grant issuing, persistent leases, CI test execution, protected-branch enforcement or auto-merge authority is present.

**Ledger above ego: one precisely authorized proposal creates at most one draft, not an approved change.**
