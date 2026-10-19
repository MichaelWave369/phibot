# PHIBOT-31: PhiPots local six-role dry-run

**Status:** operator-invoked, deterministic local template rehearsal. Not six live AI workers.

This adds six strictly zero-authority PhiBot manifests and runs each through the **actual PhiBotRuntime** observe / interpret / propose / verify / ledger lifecycle. A deterministic adapter supplies a fixed, role-specific *template proposal*. It does not answer the user's idea with AI or perform engineering, testing, code review or deployment.

## Run on your Windows Node 22+ development machine

From your existing PhiBot clone after merging:

```powershell
git pull origin main
npm.cmd ci
npm.cmd test
npm.cmd run phipots:dry -- "Make a relaxing board game hub with chess and mahjong."
```

This is **one** synchronous six-role dry-run. No service, watcher, scheduler, model server, token, or GitHub credential is needed. Do not put secrets into the idea argument: terminals and shells may preserve command arguments/history.

The output is a JSON report:
- `schema=phibot.phipots.local-dry-run.v1`
- `classification=LOCAL_TEMPLATE_NOT_AGENT_EXECUTION`
- SHA-256 of the locally entered idea, not the raw idea text
- Six named role reports, each with actual runtime run ID, four stage results counted, five in-memory receipts counted, and a **static** suggested handoff
- Hard-coded zero for model calls, tool calls, writes, deployment and persistent-memory writes
- `outcome=HUMAN_REVIEW_REQUIRED_NO_ACTIONS`

**Important:** A `runtimeStatus: completed` here means *the local template lifecycle finished*, not that an implementation, CI test, audit or release completed. The SHA-256 is a local correlation digest, **not independent attestation**. No external system verifies the idea or any output.

## The six roles

| Manifest | Intended eventual job | What PHIBOT-31 actually does |
| --- | --- | --- |
| `bots/phipots/idea.phibot.json` | Idea intake | Static scope/requirements handoff template |
| `bots/phipots/builder.phibot.json` | Bounded implementation | Static proposed build-map template |
| `bots/phipots/test.phibot.json` | Evidence-based tests | Static verification plan and missing-evidence reminder |
| `bots/phipots/audit.phibot.json` | Independent skepticism | Static permission/provenance review reminder |
| `bots/phipots/deploy.phibot.json` | Human-approved release | Static rollout/rollback checklist suggestion |
| `bots/phipots/ledger.phibot.json` | Evidence provenance | Static receipt and nonclaim reminder |

Every manifest is checked **in full before any runtime is invoked**. Its provider must remain `dry-run/deterministic`, it must have **no capabilities**, memory max depth **0**, and *all* read / propose / write / deploy authority must be **false**. Unknown manifest fields or policy changes refuse. This does not relax any existing Reality Gate policy or add a model fallback.

## Privacy, scope and limitations

- No GitHub/API/network access, source editing, subprocesses, installs, model inference, git branches, background agents, scheduler, Reality Gate grants, or actual application deployment are performed by this CLI.
- Each runtime uses an **in-memory ledger**. No files, tasks, memory pods, persistent agents, or receipts are added on disk.
- Raw idea text is never written into the report or stage summaries. However, its digest can still correlate low-entropy inputs, and the terminal may retain your command.
- These are actual PhiBotRuntime *template passes*, **not** communication between six autonomous models. No passing of model-generated deliverables or external verification occurs.
- Unit tests check normal completion and refusals for unexpected capability grants, arbitrary provider changes, memory expansion, write/deploy/propose upgrades, extra keys and invalid task strings.
- Local Windows/Ollama field qualification and end-to-end live role collaboration remain open gates. CI passing alone does not resolve them.

## Next gate

After GitHub CI and an operator Windows smoke test, build **IdeaBot only** as an operator-invoked, bounded local inference **candidate**, with structured non-action output, sanitized evidence receipts, explicit model tags, and failure handling. Keep the other roles template-only until the first real role is qualified. Integrate with existing role/memory/tool governance rather than creating an alternate authorization system.

Build outward. Circle back. **Ledger Above Ego.**
