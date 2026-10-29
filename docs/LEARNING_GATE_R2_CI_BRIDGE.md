# PHIBOT-31: Learning Gate R2 | GitHub CI read bridge

**Status:** experimental, opt-in, local-capture-only, no policy promotion.

R2 supplies a narrow live GitHub evidence observation path to the existing PHIBOT-30 Learning Gate. It does not turn self-reports into trusted signatures or issue permissions. It observes one **explicitly authorized open PhiBot draft PR** and its one **exact named failed GitHub check run** at an **operator-pinned 40-character head commit SHA**. The operator must choose to capture. Preview is the default.

## Evidence path

The new scripts/learning-ci-bridge.mjs calls the existing PHIBOT-29 read-only preflight. This enforces all of the following:

- The repository is in PHIBOT_REPO_ALLOWLIST, belongs to the configured owner, and is neither archived, disabled, nor a fork.
- The PR is an open, same-repository phibot/issue-N **draft**, has the canonical PhiBot candidate identity and a linked open phibot-ready issue with the same permitted target file.
- The PR is not behind its default branch, its current mergeability is confirmed, and GitHub's check and status listings are complete.
- The PR head SHA equals the SHA the operator supplied, and the requested check is a **single completed GitHub check run with conclusion=failure**, not a pending check, context alias, success, or neutral result.
- After the first check read, all PR identity and check conditions are read again. A stale/moving head or different sanitized evidence refuses capture.
- All remote actions are GET requests constrained to the selected repository. Raw check logs, issue body and source code are **not** stored.

R2 derives run_id=ci-prN-<head_sha> so two reads of the same PR commit never manufacture two independent runs. A new commit with the same exact failed check produces a distinct run ID while retaining the same R1 failure signature. The check name is represented in the capsule by a stable hash-derived categorical CI_... check ID.

An R2 observation uses layer=LOOP, failure_class=FAILED_GATE, task_kind=repo.steward.inspect, expected_code=CHECKS_PASS_REVIEW_ONLY, observed_code=CHECKS_FAILED. Its evidence_sha256 is a digest of validated, bounded, rechecked GitHub API metadata, not a cryptographic GitHub signature.

**Important:** PHIBOT-30 stores every resulting capsule under its original LOCAL_SELF_REPORT mode. This is intentional. The bridge can describe a live, TLS-protected GitHub read at capture time, but saved R1 capsules still cannot independently prove where their content came from. No confidence/authority escalation, trusted lesson admission, or automatic rule promotion is inferred. Real target-machine field qualification is still required.

## Operator procedure (Windows PowerShell)

Requirements: Node.js 22+, a local PhiBot clone, online access to GitHub, and a short-lived **read-only** fine-grained token granting Metadata, Issues, Pull requests, Checks and Commit statuses read on the selected repository. Do not place tokens in chat, a repo or a command line.

~~~powershell
git pull origin main
npm.cmd test

# Set using a secure local credential mechanism. Do not commit or paste the real token.
$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
$env:PHIBOT_GITHUB_TOKEN = '<read-only token obtained securely>'

# Replace with an existing, eligible PhiBot draft PR and its current head SHA.
npm.cmd run learning:ci -- --repo MichaelWave369/phibot --pr 123 --check test --sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

# Only after confirming the preview, repeat with the optional local-capture flag:
npm.cmd run learning:ci -- --repo MichaelWave369/phibot --pr 123 --check test --sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --capture

npm.cmd run learning:list
~~~

The PR number and SHA are **examples**, not evidence of a qualifying PR. If no eligible failed draft exists, the command refuses. Capture writes a local immutable PHIBOT-30 capsule under PHIBOT_LEARNING_HOME or .phibot/learning-gate/; nothing is sent to GitHub.

The --check argument is the exact **GitHub check job/run name**, not the workflow filename. R2 supports GitHub check runs, not commit-status-only checks. R2 does not run tests, retry CI, write a PR, edit source code or schedule a worker.

## CI negative controls

Run:

~~~powershell
node --test scripts/learning-ci-bridge.test.mjs
npm.cmd test
~~~

The tests cover: exact CLI parsing, default no-write preview, explicit local capture, deterministic same-commit deduplication, cross-commit recurrence, SHA change, lost/changed authorization, non-draft PR, behind branch, passing/missing/neutral/ambiguous checks, allowlist, token requirement, revalidated GitHub GET-only reads, and no auto-promotion.

These tests use **synthetic GitHub response fixtures**, not live GitHub. They validate the bridge contract without claiming a successful real-world candidate qualification.

## Next rung

A later R3 should introduce a separately verified, versioned evidence record (or authenticated signed source artifact), evaluator replay on an independent fixture, failure taxonomy precision, false-positive metrics, expiry/revalidation, and a human-approved Reality Gate / PhiOS ledger handoff. It should never treat an R1 local hash as proof of source authenticity.

**Capability is not authority. A GitHub check result is an observation, not permission to fix or merge.**
