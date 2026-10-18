# PHIBOT-23: SHA-bound Reality-Gated source repair

> **PHIBOT-24 safety update:** The legacy `steward:repair` direct-write command is now disabled. To generate a reviewed model proposal without any GitHub writes, use `npm run steward:repair:handoff`, then inspect the saved JSON and manually invoke `npm run steward:governed-repair -- <proposal.json>`. Read [PHIBOT-24 handoff guide](REPAIR_HANDOFF_QUEUE.md).


PHIBOT-23 adds `repo.steward.repair`, an **always-gated** tool in the normal PhiBot ToolExecutor. It can submit one bounded source-code repair to an *existing PhiBot draft PR with genuinely failed GitHub CI*. This does not autonomously generate fixes; a human must inspect and approve the full replacement source with the Reality Gate digest. A separate local PatchBot/SkepticBot prototype from PHIBOT-20 can suggest candidates, but its model votes alone never provide write authorization.

## Exact evidence and authorization

- The repository must match `PHIBOT_OWNER` and the explicit `PHIBOT_REPO_ALLOWLIST`.
- The bot must declare `repo.steward.repair` and have non-denied write authority. `requiresGate: true` means even `write: true` cannot bypass a signed, expiring, one-use, exact-input Reality Gate grant.
- The pull request must be **open, draft, mergeable**, originate from `phibot/issue-N` in the same repo, target the current default branch, and bind the exact issue and file in the PR body.
- The linked issue must be open, carry `phibot-ready`, and contain one matching `Target file:` line.
- The PR must modify **exactly one existing source/test file**. The new tool only permits `src/` or `test/` TypeScript, JavaScript, MJS, TSX or CSS. Sensitive paths, workflow/config files, hidden or traversal segments, auth/security/gate/authority modules, and dependency/infra/deploy paths are denied.
- The failing CI result must be bound to `expectedHeadSha`, show every `PHIBOT_REQUIRED_CHECKS` job/context, contain at least one actual failure, and have no currently pending checks. Truncated and missing evidence fail closed. The PR must not be behind the default branch.
- The file blob SHA must match `expectedBlobSha` from the exact PR head. The candidate must be nonempty, at most 12 KiB, not a no-op, contain no obvious secret patterns, change at most 48 contiguous lines, and avoid mass deletion.
- No previous commit may carry either the legacy `phibot: repair-once pr#` marker or the new `phibot: governed repair PR#` marker. Commit lists reaching the first-page limit refuse to prevent hidden older repairs.

The tool rereads the PR, issue, branch head and commit history immediately before writing. The only remote write is a **single GitHub Contents PUT** on the existing PR branch, against the expected file blob SHA. No new PR, no checkout, no shell, no workflow rerun, no review approval, no branch merge, no deploy and no issue closure.

After submitting, it returns `REPAIR_COMMIT_PUSHED_CI_UNVERIFIED`: the **new** GitHub CI result is not yet known. Use `steward:verify` or the governed `repo.steward.inspect` to observe it independently.

## Human operator field setup (Windows PowerShell)

Requires a local clone, Node 22+, GitHub token scoped only to a disposable test repository with metadata/issue/PR/Contents read-write where appropriate, plus Checks and Commit statuses read. A PR with real failed CI is required. Do not paste tokens or the gate secret into chats, repositories or screenshots.

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/Demo'
$env:PHIBOT_REQUIRED_CHECKS = 'test'
$env:PHIBOT_GITHUB_TOKEN = '<read from secure local credential storage>'
$env:PHIBOT_REALITY_GATE_SECRET = '<random local secret at least 32 characters>'
$env:PHIBOT_ENABLE_GOVERNED_REPAIR = '1'
npm.cmd run steward:governed-repair -- C:\OutsideRepo\exact-repair.json
```

`PHIBOT_REQUIRED_CHECKS` must list the precise **job or commit-status context names** from the PR Checks tab, comma separated. Verify they correspond to the selected repository. Leaving this empty disables writes.

The local proposal JSON should include **only** these eight fields (replace placeholders with observed values and a truly reviewed patch):

```json
{
  "repository": "MichaelWave369/Demo",
  "prNumber": 12,
  "issueNumber": 7,
  "target": "src/calc.ts",
  "expectedHeadSha": "<40 hex characters from the failing PR commit>",
  "expectedBlobSha": "<40 hex characters from the target file in that commit>",
  "replacement": "export function calc() {\n  return 2;\n}\n",
  "summary": "Correct the observed return value without altering unrelated logic."
}
```

The example is illustrative only. It will not pass SHA validation with placeholders and must not be used against a real repository as-is. The interactive command prints the complete proposed replacement, asks the operator to enter `APPROVE` followed by the first 16 characters of the Reality Gate SHA-256 request digest, then invokes the single-use grant. Declining produces an auditable denial and no GitHub write. Non-interactive sessions fail closed.

## What is still experimental

- The PHIBOT-20 `steward:repair` command is still an **isolated** opt-in script. It has **not** been rewired to this gate. Prefer this human-approved governed path for field tests.
- A passing TypeScript/unit-test suite qualifies the local contract, not the security or correctness of an AI-generated source patch. Local Windows/Ollama, actual GitHub read/write permissions, failure diagnostics, protected branches and post-write CI need field qualification.
- The Reality Gate's replay store is in-memory per process; the remote commit marker and SHA checks reject common repeats, but cross-host, concurrent writes and partial network failures are not transactional. If a remote PUT fails ambiguously, inspect GitHub manually; do not retry blindly.
- Human review remains necessary. Source code and issue descriptions are untrusted, model review remains advisory, and no unattended scheduling, autosignoff, auto-merge, CI override or production deploy is authorized.

**Ledger above ego: model-generated patches are hypotheses. A grant authorizes only a proposed commit, never its correctness.**
