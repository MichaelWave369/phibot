# PHIBOT-33 | Learning Gate R4: synthetic regression metrics and PhiOS review request

**Status: local, review-only prototype. This does not implement a PhiOS Reality Gate integration, rule promotion, or enforcement.**

PHIBOT-30 captured operator-supplied failures, PHIBOT-31 read pinned failed GitHub CI, and PHIBOT-32 built unsigned, same-provider-corroborated review packets. R4 now tests a proposed recurrence rule against **eight fixed, synthetic counterfactual cases** and can explicitly export a non-executable offline review request intended for a *future* PhiOS Reality Gate intake implementation.

This is not real-world false-positive measurement. Both R3 source audits and R4 regression fixtures have important trust limitations. R3 relies on one GitHub provider and local SHA-256 hashes; R4 tests a deterministic rule against metamorphic variations of the original observation, not independently collected production incidents. R4 does not claim independent source attestation.

## Commands

Use Node 22+ in a PhiBot clone. This R4 operation is completely local and needs **no GitHub token, model, Ollama instance, network, or OS service**. R3 audit and human-review proposal files must already exist under PHIBOT_LEARNING_HOME (default: .phibot/learning-gate).

PowerShell:

~~~powershell
npm.cmd test

# Inspect one previously created R3 proposal. No local files written.
npm.cmd run learning:regression:evaluate -- PASTE_64_HEX_R3_PROPOSAL_ID_HERE fixtures/learning-r4-regression.v1.json

# After inspecting the report, explicitly produce an immutable offline request:
npm.cmd run learning:regression:handoff -- PASTE_64_HEX_R3_PROPOSAL_ID_HERE fixtures/learning-r4-regression.v1.json
~~~

No proposal ID is included as a fake sample. If two fresh, distinct, qualifying R3 audits do not exist, R4 refuses.

R4 reads two local audits and their R3 review proposal, validates identities and self-hashes, checks that audits concern different commits, check-run IDs and run IDs, and refuses audit timestamps in the future or older than 14 days. It does not re-read GitHub. Any later admission or promotion would need **fresh** source checks.

## The R4 regression suite

The versioned fixture file contains **eight exact scenarios**, each marked with the expected result and a strict schema. Duplicate or omitted scenarios, altered expectations, unknown keys, oversize inputs, or tampered upstream records refuse.

Three scenarios are expected to match the candidate failure signature even as the run ID, source SHA, or evidence digest changes. Five must not match because the repository, check, failure code, architectural layer, or task kind changes.

R4 computes a synthetic confusion matrix: true positives, true negatives, false positives, false negatives, synthetic false-positive rate, and synthetic false-negative rate. It permits export only when all eight examples pass, including **zero false positives and zero false negatives on these fixtures**. It also tests deliberately broken classifiers to prove the evaluator can detect errors.

Zero errors on this tiny, synthetic fixture suite are **not** zero errors in deployment. The evaluation explicitly records live_false_positive_rate=null, live_replay_verified=false, approved=false and enforced=false.

This is a **metamorphic unit test**, not independent external regression testing. The fixture source is in this repository and derives counterfactuals from the R3 baseline. Future work must add real externally reviewed cases, sampling, confidence intervals, and drift tracking.

## Offline PhiOS governance handoff

The separate handoff command revalidates the full R3 packet and runs the fixtures again before it writes one exclusive-create JSON record to:

.phibot/learning-gate/r4/handoffs/<sha256-id>.json

The record names a **future** destination PHIOS_REALITY_GATE_FUTURE_REVIEW_INBOX. No such destination is invoked or implemented by this rung. The request explicitly has approved=false, executable=false, grants=0, policy_writes=0, github_writes=0, merge=false and deploy=false, plus a seven-day request lifetime.

It lists conditions that a **separate, future, expressly authorized workflow** must satisfy before policy promotion can even be considered: fresh remote CI revalidation; independently reviewed real-world regressions; false-positive impact assessment; explicit human approval; signed Reality Gate authorization; and a tested rollback plan.

The JSON hash is a local self-hash, not a digital signature. The request should be treated as **untrusted input** by any eventual PhiOS consumer. GitHub tests validate the JSON contract but do not qualify cross-project integration or operator credentials.

## CI acceptance and safety boundaries

~~~powershell
node --test scripts/learning-regression-r4.test.mjs
npm.cmd test
~~~

Negative tests cover bad fixtures, relabeled expectations, incomplete suites, false positives/negatives, corrupted R3 proposals/audits, stale/future evidence, missing upstream records, default no-save evaluation, explicit handoff, idempotence and tamper refusal.

**No automatic rule promotion, policy mutation, live retry blocking, grant creation, PR creation, model inference, deployment or GitHub API request is added.**

**Ledger above ego: eight simulated passes are reason to review, never permission to act.**
