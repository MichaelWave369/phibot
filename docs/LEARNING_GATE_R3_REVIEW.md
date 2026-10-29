# PHIBOT-32 | Learning Gate R3: GitHub CI corroboration and human review packets

**Status:** review-only candidate. No learned rule becomes executable. No automatic authority transition.

R3 extends PHIBOT-30 failure capsules and PHIBOT-31 two-pass GitHub CI reading. It adds a separately coded **corroboration path** that reads a GitHub check-run's detail endpoint after R2's SHA-bound preflight. It can save a small unsigned local audit. Two recent failures on **different commit SHAs and check-run IDs**, with the same failure signature, may yield a human-only review packet.

This is **not independent attestation by a separate provider**. Both code paths read the GitHub API. Local files are SHA-256 self-hashed, not signed, so users with local write access can forge them. GitHub, the operator machine and the read credential remain trust dependencies. Do not use R3 output alone to authorize a fix, grant, merge, deployment or runtime policy change.

## Operator commands

Requirements: Node.js 22+, explicit owner-scoped PHIBOT_REPO_ALLOWLIST, online GitHub access and a short-lived fine-grained token with read-only metadata, issues, pull requests, checks and commit-status permissions. Store credentials outside the repository. The commands use neither Ollama nor target repository code execution.

PowerShell example (PR number and SHA are illustrative and **not** qualifying evidence):

~~~powershell
npm.cmd test
$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
# Obtain a scoped read-only token via your credential manager; do not paste it.
$env:PHIBOT_GITHUB_TOKEN = '<secure read-only token>'

# Preview: no local file is saved:
npm.cmd run learning:review:verify -- --repo MichaelWave369/phibot --pr 123 --check test --sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

# Explicit local-save opt-in:
npm.cmd run learning:review:verify -- --repo MichaelWave369/phibot --pr 123 --check test --sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --save

# After collecting an audit from a distinct failed commit:
npm.cmd run learning:review:propose -- <first_64_hex_audit_id> <second_64_hex_audit_id>
~~~

Replace the angle-bracket placeholders with real values before executing. An eligible failed, still-open PhiBot draft PR must actually exist. If no qualifying candidate exists, the command refuses.

Storage defaults to:
- .phibot/learning-gate/r3/audits/<audit-id>.json
- .phibot/learning-gate/r3/review-proposals/<proposal-id>.json

PHIBOT_LEARNING_HOME overrides the root. All files are exclusive-create, hash-addressed and integrity-checked on read. An existing mismatched record fails closed. R3 never sends these artifacts back to GitHub.

## Source verification

Before an audit can be saved:

1. R2 must return exact REVIEW_ONLY_PREVIEW evidence for the allowlisted repository, open canonical PhiBot draft PR, currently authorized issue, exact failed check name and pinned head SHA. R2 independently re-reads the PR and CI.
2. R3 separately reads that commit's check-run listing. It requires a complete list and exactly one completed failing check-run with the exact requested name.
3. R3 reads the matching check-run's detail by numeric ID, requiring that ID, name, head SHA, status and failure conclusion agree. If GitHub returns the check suite SHA, it must also match.
4. R3 re-reads the draft PR head, and the check-run detail again. Changed heads or mismatching detailed check results refuse the audit.
5. Only categorical metadata, source SHA, check-run ID, evidence hash, and local capture time are saved. No raw issue body, check log, token or source code is persisted.

R3 always labels its saved audit as SAME_PROVIDER_CORROBORATED_UNSIGNED. A GitHub API response is useful evidence, not a proof of external source authenticity or an identity certificate.

## Human review gate

The operator supplies exactly two saved audit IDs. Both self-hashes and internal field relationships are revalidated. The records must have the same repository, failure signature and named check, but distinct source SHAs and numeric check-run IDs. They must be no more than 14 days old and cannot be future-dated.

The packet's action is CONSIDER_STOP_RETRY_ADVISORY. It explicitly returns:
- promoted: false
- policy_writes: 0
- grants: 0
- reverify_at_promotion: true

R3 deliberately provides no apply, execute, scheduler, auto-merge or grant issuing command. Actual promotion needs a future, separate implementation with tested regression replay, quantified false positives, revocation/expiry, human approval and fresh source checks through the existing PhiOS Reality Gate. These controls are **not** in R3.

## Tests and limits

~~~powershell
node --test scripts/learning-review-r3.test.mjs
npm.cmd test
~~~

Synthetic GitHub response tests cover no-save preview, strict arguments, GET-only transport, moved PR heads, check detail changes, duplicate/missing/passing CI, revoked authorization, allowlist/token refusal, immutable tamper detection, distinct commits/check-run IDs, expiry/future timestamps and forged R2 outputs. These mock tests are not a live Windows/GitHub field qualification.

**Ledger above ego: corroboration within one provider is not cryptographic attestation, and a lesson proposal is not authority.**
