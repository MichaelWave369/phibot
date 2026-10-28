# PhiBot R1-J · Disposable fixed-code acceptance trial

**Status: Candidate, review-only.** This rung executes the **exact, fixed, public Python toy proposal** from the already-verified Agentora R1-H packet, inside a short-lived GitHub-hosted Docker container. It does not automatically generate code, edit repositories, create PRs, merge or deploy.

## No-install browser field test

After the R1-J PhiBot PR is merged:

1. Reuse the public single-line `phibot-review-packet.base64url.txt` artifact from Agentora's earlier successful manual `draft_review` run. If Agentora's `main` has moved, rerun [Agentora Cloud Trial](https://github.com/MichaelWave369/Agentora/actions/workflows/development-board-cloud-trial.yml) with `draft_review` to get a new exact pin.
2. Open [PhiBot R1-J Disposable Code Validation](https://github.com/MichaelWave369/PhiBot/actions/workflows/r1j-disposable-code-validation.yml).
3. Choose **Run workflow**, on `main`; paste **the entire one-line** public base64url packet into `packet_b64`.
4. Once the run succeeds, download `phibot-r1j-disposable-code-review-<run number>` in its **Artifacts** section. Read `phibot-r1j-code-validation.json` and `r1j-container-tests.json`.

The expected status is `BOUNDED_CONTAINER_TESTS_PASS_REVIEW_ONLY`, with exactly five passing test names. This means a **known, fixed toy change** passed fixed behavioral tests. It **does not** mean PhiBot wrote a commit, independently reviewed arbitrary AI-authored code, or acquired merge permission.

## Exact gate sequence

**Before executing any Python:**
- A Node-only producer checks the full exact R1-H packet contract, including source before and after, SHA-256 digests, exact public demo repo/path and all no-authority flags.
- It invokes the previously qualified R1-I GitHub verifier (three HTTPS **GET** calls) to correlate original bytes with the exact commit and ensure the Agentora `main` head still matches.
- Only then does it write a new `r1j-scratch/candidate.py` containing exactly the known proposed source and a metadata manifest. Scratch creation is exclusive; an existing scratch directory causes a refusal. No repository file is modified.

**In the disposable container:**
- The workflow pulls `python:3.12-alpine` **before** the offline execution step. **The image tag is not digest-pinned or independently attested**; this remains a supply-chain limitation. A future step should pin the reviewed image by digest.
- The container has `--network none`, `--read-only`, UID/GID `65534:65534`, dropped capabilities, `no-new-privileges`, Docker's default seccomp policy, a PID cap (64), 256 MiB memory, one CPU and a 25-second outer timeout.
- Only the **one fixed candidate file** and the **fixed test harness** are bind-mounted read-only. No token, env secret, whole repository or GitHub workspace is mounted inside.
- Python runs with `-I -S -B`. The harness **rechecks the exact allowlisted source bytes before loading the candidate** and runs five checks: collapse mixed whitespace; preserve single word; preserve empty input; reject an integer with expected TypeError; reject `None` with expected TypeError.
- The container emits bounded JSON test results to a runner-local output file; it does not create or modify a GitHub repository.

**After the container exits successfully:**
- A separate Node verifier rereads the staged candidate and receipt, enforces the exact candidate SHA-256, expected test names/count, status, no-model and no-write flags.
- Only then does it create the two **metadata-only** review artifacts. Any failed step stops the run and **does not publish an accepted receipt**.

## Qualification and security boundaries

GitHub CI exercises these gates using **fake R1-I remote evidence and synthetic Docker test receipts**. It checks stale/forged source, wrong SHA, tampered candidate or manifest, missing/failing tests, extra test fields and authority escalation. CI **does not** run Docker, pull a Python image or prove the hosted trial works; this must be tested with a separate manual `workflow_dispatch` on the merged branch.

A Docker container shares the host kernel and is **not a strong general-purpose untrusted-code sandbox**. This milestone is intentionally safe-by-restriction: its only runnable candidate must match the one fixed known Python function **byte for byte**. The simulated CI, source SHA-256 and successful five tests are **not** independent cryptographic attestation, semantic correctness for arbitrary projects or release authorization.

**R1-J does not upgrade PhiBot's privileges.** It does not call PhiBot's `repo.steward.draft`, invoke Reality Gate, write GitHub, create issues or PRs, dispatch workflows from models, use automated approvals, or enable merges. Existing R1-H and R1-I remain unchanged.

**Next possible rung:** image digest pinning, real attempt transcript checks, and human reviewed candidate test expansion before considering any broader source scope.

**Ledger Above Ego. The tool proves five tiny behaviors; the human decides everything else.**
