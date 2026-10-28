# PhiPots: proposed six-role crew for PhiBot

**Status: PUBLIC DESIGN SHOWCASE + LOCAL DETERMINISTIC REHEARSAL.** The public React role roster remains a design preview. PHIBOT-31 now adds an operator-only, six-role, no-tools template pass through real PhiBotRuntime lifecycles; it is **not a live agent crew**. See [local dry-run protocol](PHIPOTS_LOCAL_DRY_RUN.md). PhiPots is the proposed team name for specialist PhiBot roles. **MikeyBot6000** is the playful nickname for the future building crew, not a separately deployed orchestration service.

This document is a candidate coordination protocol. The public React Mission Control crew page is a static, selectable roster. The buttons switch browser display state only. There is **no autonomous agent fleet**, agent spawn, model invocation, GitHub API call, CI execution, write, merge, deployment, persistent memory, scheduler, or remote PhiBot connection in this addition.

## Roster

| PhiPot | Job | Required evidence or handoff | Authority |
| --- | --- | --- | --- |
| IdeaBot | Convert parked ideas to a bounded spec | Original idea, constraints, questions, acceptance criteria | Proposal only |
| BuilderBot | Draft original, scoped patches or design plans | Approved scope, target files, source provenance | Proposal only; real writes require separately approved exact gate |
| TestBot | Plan test cases and inspect named checks | Pinned candidate SHA, CI context/results, missing-check state | Observe/report only; cannot claim PASS without evidence |
| AuditBot | Challenge permissions, provenance, and assumptions | Proposed patch, attack surface, independent objections | Review only; cannot approve its own proposal |
| DeployBot | Assemble rollout/rollback checklist | Verified candidate, release criteria, operator decision | Planning only; no automatic publish/merge |
| LedgerBot | Summarize receipts and decisions | Job references, immutable hashes, source origins, exact stage results | Record evidence, not invent or promote it |

## Proposed handoff

1. **PLANT:** IdeaBot takes a user-supplied concept and records constraints and provenance.
2. **DESIGN:** BuilderBot prepares a scoped proposal; it must not execute unchecked source.
3. **CHALLENGE:** TestBot observes real CI/status evidence where available; AuditBot independently questions the change. Missing evidence remains **UNVERIFIED**.
4. **APPROVE:** The human reviews the exact proposal. Any enabled repository write must use an existing, single-use **Reality Gate** grant; model approval never substitutes for human approval.
5. **RECEIPT:** LedgerBot reports actual observed transitions and their origin. Release/deployment may be planned by DeployBot but is not automated here.

## Existing building blocks versus future wiring

| Existing in PhiBot repository | Does NOT mean |
| --- | --- |
| PhiBotRuntime, governed tools and Reality Gate | The six PhiPots roles have been integrated with runtime spawning |
| RepoScout read capabilities, bounded read-only local queue and localhost dashboard | Autonomous GitHub writes or unattended background agents |
| PatchBot / SkepticBot isolated repair proposal experiments | Full BuilderBot or AuditBot services with production field verification |
| Governed exact draft/repair write candidates with human approvals | Universal code editing, auto-merge, unattended deployment |
| Public React/Vite Mission Control demo | Remote or live access to the local PhiBot worker |

## Next implementation gates (not completed here)

- Define manifests for candidate specialty roles using the existing PhiBot schema; start with **zero write authority**.
- Establish a locally tested, budget-capped, operator-invoked coordination/handoff protocol.
- Require independent read-only evidence for every claimed CI PASS; preserve negative controls and refused handoffs.
- Validate Windows Ollama/inference and permission isolation on the target machine before claiming any bot works.
- Add new high-impact operations only through independently reviewed, exact, human-approved Reality Gate grants.
- Keep the public showcase permanently disconnected from local credentials, agent tools, and task queues.

**Build outward. Circle back. Ledger Above Ego.**
