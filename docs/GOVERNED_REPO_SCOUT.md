# PHIBOT-21: RepoScout governed read tools

This rung connects **bounded GitHub repository observation** to PhiBot's existing `ToolExecutor`, capability registry, manifest authority and append-only tool receipts. It does **not** execute the prior Repo Steward's draft-PR creation or local repair scripts through the Reality Gate. Those remain separate, explicit opt-in commands pending a future exact-input write-grant design.

## Capabilities

- `repo.steward.discover` (`read`, external): Reads one explicitly allowlisted public or token-accessible repository's metadata, README and `docs/ROADMAP.md` checkbox evidence (with line numbers), and the first page of open issue metadata. Unchecked tasks are **observations**, never permission to act. Issue target paths are filtered. The endpoint cannot write.
- `repo.steward.inspect` (`read`, external): Reads one open PhiBot draft PR, associated authorized `phibot-ready` issue, checks for the exact head SHA, commit status contexts and base comparison. It returns only read-only status and safe metadata; `CHECKS_PASS_REVIEW_ONLY` does **not** grant merge permission.

Both tools are included in the normal `createBuiltinToolRegistry()` used by `npm run tool`. A bot must list the exact capability, have `authority.read=true` (or an actual Reality Gate grant if read is gated), and be scoped by the separate environment allowlist. Merely listing a capability in a manifest never overrides the allowlist.

## Windows PowerShell test

From a local PhiBot clone after merging PHIBOT-21, with Node 22+:

```powershell
git pull origin main
npm.cmd test
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
# Optional read-only token in a secure process environment; required for PR check inspection
$env:PHIBOT_GITHUB_TOKEN = '<securely retrieved, narrowly scoped read token>'

npm.cmd run tool -- bots/examples/repo-scout.phibot.json repo.steward.discover '{"repository":"MichaelWave369/phibot"}'
```

CI inspection requires a genuine eligible **open draft** PR created by the Repo Steward issue workflow. The PocketBrain PR and ordinary human PRs do not qualify. Replace the example PR number with an eligible draft:

```powershell
npm.cmd run tool -- bots/examples/repo-scout.phibot.json repo.steward.inspect '{"repository":"MichaelWave369/phibot","prNumber":123,"requiredChecks":["test"]}'
```

Do not put tokens in CLI command arguments, manifests, GitHub issues, commits or logs. For private repositories use only selected repo scopes. GitHub check inspection needs **Checks: read** and **Commit statuses: read**, and both capabilities use HTTP GET only. The registry does not import a general GitHub API client with write methods.

## Safety limits and next rung

- One repo per call, explicit owner-matching allowlist, maximum 30 allowlisted names, limited README/roadmap body length, first 100 open issues, and no check pagination. Inventory overflow produces a refusal instead of a claim that all issues were inspected.
- The built-in `ToolSandbox` remains a cooperative timeout/cancellation wrapper, not an OS sandbox. This rung executes only predefined HTTP GET actions and does not run source code from repositories.
- GitHub content is untrusted evidence. Even when an issue is labeled `phibot-ready`, no code change is authorized by a read response. Tool receipts record capability, class, duration and status without raw request bodies.
- `repo.steward.inspect` repeats the PR read after gathering check evidence, rejects revoked issue grants and changed heads, and requires zero base-behind commits and confirmed mergeability to report review-only green.
- No autonomous scheduler, credential vault, CI rerun, code sandbox, independent model safety proof, agent persistence, merge or deploy authority is added.

**Next:** attach a write-capability wrapper to `ToolExecutor` with exact repo/issue/file/commit grants, and retain the existing one-attempt, draft-PR-only rules. Use durable replay receipts and narrow process permissions before attempting unattended operation.

Ledger above ego.
