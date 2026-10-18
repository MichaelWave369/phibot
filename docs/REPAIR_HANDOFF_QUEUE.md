# PHIBOT-24: local reviewed repair handoff

PatchBot and SkepticBot can now propose a single repair for a failed-CI PhiBot draft PR and **queue an exact eight-field proposal on the operator's own disk**, ready for the existing **human-approved Reality Gate source repair CLI**. Preparing or listing the handoff never writes to GitHub. The models cannot issue Reality Gate grants or merge PRs.

## Workflow

1. Use explicit `PHIBOT_REPO_ALLOWLIST` and exact `PHIBOT_REQUIRED_CHECKS`, with a narrowly scoped GitHub token that can **read** PRs, issues, checks and Contents. Only a currently open and authorized `phibot-ready` draft PR with failed, fully observed CI and a single existing file is eligible.
2. `npm run steward:repair:handoff` reads the failing head SHA and target blob SHA, asks local Ollama PatchBot for a bounded change, then has a different Ollama SkepticBot review the candidate.
3. Only an explicit **LOW-risk** model review plus the **same `validateRepairInput` schema used by the Reality-Gated write capability** allows a local handoff. Unsupported paths, invalid metadata and oversized edits are refused.
4. The complete proposal is written to `.phibot/repo-steward/handoffs/<opaque-id>.json` with exclusive-create semantics (`wx`, mode `0600`). Existing proposals for the same repository/PR/failing-head SHA are never overwritten.
5. A **metadata-only** receipt records the repo, issue, PR, source SHA, target, and full proposal digest in `.phibot/repo-steward/ledger.ndjson`. The replacement itself is kept in the local proposal file, not the receipt or console inventory.
6. `npm run steward:handoffs` lists local proposals with identity and digest checks, no remote calls. Neither creation nor listing constitutes approval.
7. An operator reviews the **entire replacement**, rechecks the target repo and CI status, configures the separate Reality Gate secret and write enablement, then manually invokes `npm run steward:governed-repair -- <path to the selected handoff JSON>`.
8. The Reality-Gated write validates the **live remote state again** and displays the proposal and its unique approval digest. Only a typed human authorization can submit one source repair commit. New CI on that commit remains **unverified** until separately inspected.

## Windows PowerShell

From a local PhiBot clone after merging PHIBOT-24:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/Demo'
$env:PHIBOT_REQUIRED_CHECKS = 'test'
$env:PHIBOT_GITHUB_TOKEN = '<scoped token retrieved securely in the local process>'
$env:PHIBOT_MODEL = 'qwen3.5:9b'
$env:PHIBOT_REVIEW_MODEL = 'granite4.2:8b'
npm.cmd run steward:repair:dry
npm.cmd run steward:repair:handoff
npm.cmd run steward:handoffs
```

Only after manually inspecting the generated JSON and its target repository, configure a **separate operator-controlled** 32+ character Reality Gate secret and opt-in:

```powershell
$env:PHIBOT_REALITY_GATE_SECRET = '<locally generated secret, never committed>'
$env:PHIBOT_ENABLE_GOVERNED_REPAIR = '1'
npm.cmd run steward:governed-repair -- 'C:\Path\To\Your\Queued\Proposal.json'
```

The path printed by the `handoff` and `handoffs` commands identifies the actual local proposal. There is no preconfigured approval, unattended scheduling, or hidden automatic consent.

## A deliberately closed old door

The legacy `npm run steward:repair` command is **disabled**. Even setting the old `PHIBOT_ENABLE_REPAIR_WRITES=1` has no effect. The standalone repair module retains **read-only** proposal generation and model review, but contains no GitHub PUT/POST operations. The only path for approved source repair writes introduced so far is the PHIBOT-23 Reality-Gated capability.

## Failure modes and limitations

- Stored model proposals and CI summaries are **untrusted**. The local inventory provides a SHA-256 digest and bounded schema checks, but a hash is not a signature and is not a secure defense against a hostile local operator. A tampered proposal is revalidated before a write; never approve without human inspection.
- Local handoffs are durable files, **not** a multi-worker lock, autonomous job scheduler or transactional queue. Running on multiple PCs creates independent files. An existing local handoff for a PR/head is not overwritten or automatically retried.
- Changes to the remote PR, its issue authorization, target blob, branch SHA, file count, or CI evidence after handoff generation are checked by the governed tool, which will refuse stale proposals.
- No target repo code is executed locally by PatchBot/SkepticBot. GitHub CI may later run, but it is not an independently verified sandbox or proof of correctness.
- The old `steward:run` initial draft-PR script is still an independent, opt-in path; this change only disables the **ungated legacy repair write** command.
- A failing PR may have CI failures unrelated to the permitted file, and the model can misdiagnose them. LOW-risk review is **advisory**, never write authority.

**Ledger above ego: propose, review, preserve evidence, then approve the exact change.**
