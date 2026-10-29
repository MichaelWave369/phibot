# PHIBOT-30: Learning Gate R1 (local, review-only)

Learning Gate R1 turns **operator-supplied, sanitized failure metadata** into immutable local capsules, recognizes repeated failure signatures across **at least two distinct claimed run IDs**, and simulates a **stop-retry advisory** when a proposed lesson matches another observation.

This is an experimental **standalone, read-only-in-authority** companion to PhiBot's work queue. It writes local capsule/proposal JSON files but **never** modifies repository source, CI, queue policies, Reality Gate grants, or remote systems. It is **not wired into the queue**, does not automatically collect CI evidence, and does not enforce retry stops. No Ollama, network connection, tokens, GitHub API, merge, or deployment is required.

## Design and trust boundaries

1. **Capture:** validate an exact 10-field JSON observation (no raw logs, prompts, diagnostics, credentials, free-text model output, or extra keys). Only a claimed evidence_sha256 and exact source commit SHA are retained; neither is independently attested by this tool.
2. **Fingerprint:** hash repo + owner layer (HARNESS, LOOP, or GRAPH) + failure class + task kind + check ID + expected/observed categorical codes. Distinct run IDs, commit SHAs, and evidence hashes do not change the failure signature. They remain separately present in immutable capsules.
3. **Propose:** require two separate *self-reported* run IDs with an identical signature. A repeated ID with different evidence is insufficient. Save an immutable proposal with the sole supported STOP_RETRY_ADVISORY effect.
4. **Replay:** validate the proposal hash and supporting capsules again, compare a fresh observation's signature, and return MATCH_STOP_RETRY_ADVISORY or NO_MATCH, always marked simulated=true, enforced=false. There is **no command to promote** a proposal.
5. **Refuse:** unexpected fields, nonsensical expected==observed pairs, unexpected stored files, oversized files, changed capsule/proposal bodies, missing evidence, unsupported rule effects and malformed data all fail closed.

The hash is a local consistency/correlation digest, **not a signature, proof of source accuracy, reproducible CI result, or evidence of independent reviewer agreement**. Distinct run IDs are supplied by the caller, not independently verified. A false or malicious metadata producer can manufacture recurrence. Never grant authority based on these records.

## Windows PowerShell operator trial

Requires Node 22 or later. After merging and pulling, create failure-1.json locally **outside** the repository:

~~~json
{
  "repo": "MichaelWave369/phibot",
  "run_id": "local-run-1",
  "source_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "layer": "LOOP",
  "failure_class": "DUPLICATE_REPAIR_ATTEMPT",
  "task_kind": "repo.steward.repair",
  "check_id": "test",
  "expected_code": "TEST_PASS",
  "observed_code": "TEST_FAIL",
  "evidence_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
~~~

The hashes above are **synthetic placeholders**, never evidence of actual CI. For a second trial file, change run_id to local-run-2 and evidence_sha256 to a different source-claimed evidence hash, keeping classification fields identical.

~~~powershell
npm.cmd test
npm.cmd run learning:capture -- C:\Temp\failure-1.json
npm.cmd run learning:capture -- C:\Temp\failure-2.json
npm.cmd run learning:list
# Copy the 64-hex signature printed by capture/list:
npm.cmd run learning:propose -- 'PASTE_64_HEX_SIGNATURE_HERE'
# Copy the emitted 64-hex proposal_id:
npm.cmd run learning:replay -- 'PASTE_64_HEX_PROPOSAL_ID_HERE' C:\Temp\failure-2.json
~~~

Set PHIBOT_LEARNING_HOME to an operator-owned local directory to override the default .phibot/learning-gate/. Files are created exclusively and never intentionally overwritten. Protect the directory with OS permissions, keep it out of version control, and do not store tokens or raw trace data alongside it.

### Supported failure classes

DUPLICATE_REPAIR_ATTEMPT, REPEATED_OBSERVATION, MISSING_VERIFICATION, UNAVAILABLE_CAPABILITY, DUPLICATE_WORK, FAILED_GATE.

The layer is metadata only. Selecting HARNESS/LOOP/GRAPH does not change privileges. Categorical expected_code and observed_code must be different and match the uppercase validation grammar.

## Negative controls

- Unknown payload fields such as raw_log or approve are refused.
- Repeat captures of the same observation are idempotent, not overwrites.
- Two capsules with the **same claimed run ID** do not qualify as recurrence.
- Signatures do not mix repositories, tests, or different observed failure codes.
- Editing stored hashes or proposal effects causes refusal.
- Removing a supporting capsule blocks replay.
- Replayed matches are **never** enforced, permitted to write, or promoted.

Run the new tests with: node --test scripts/learning-gate.test.mjs. The same suite runs from npm test in CI.

## R1 acceptance and future gates

**R1 green** means tests pass, sample capture/list/propose/replay works on a local machine, and no unintended side effects occur. It does **not** mean real CI evidence has been independently corroborated.

Before using any lesson to actually block retries or alter live policy, a separate later PR should require:
- a pinned, source-attested adapter to PhiBot's queue/CI Inspector, with no unverified self-report;
- replay against real regression fixtures and a distinct verifier context;
- rule versioning, impact evaluation, false-positive measurement, expiry/revalidation and rollback;
- explicit human approval and a Reality Gate/Reality Ledger handoff;
- refusal on stale source, mismatch, lost evidence, or privileges outside original scope.

**Ledger above ego: the observation proposes a lesson; it does not grant the lesson authority.**
