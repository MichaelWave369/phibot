# PHIBOT-25: bounded read-only work queue

PhiBot now has a **local durable job queue** to revisit explicitly enqueued *read-only* GitHub observations without expanding write authority. The queue is operator-started and processes a fixed batch; it does not install a cron job, service, background timer, or automatic GitHub write.

## Authority and task model

Only two job types are supported:
- \`repo.steward.discover\`, one allowlisted repository's roadmap and issue observations.
- \`repo.steward.inspect\`, one eligible PhiBot draft PR's SHA-bound CI evidence.

Both execute through the **existing** PhiBot \`ToolExecutor\`, with a dedicated queue manifest declaring only those read capabilities, \`authority.write=false\`, \`authority.deploy=false\`, and no Reality Gate/grant issuing. Calls performed by these built-in capabilities are GitHub GET requests only.

All inputs are checked against \`PHIBOT_REPO_ALLOWLIST\` and the exact declared fields; a model cannot enqueue arbitrary commands, file modifications, \`repo.steward.draft\`, \`repo.steward.repair\`, deploys, or local model calls.

## Windows PowerShell quick start

From the PhiBot clone, after merging PR #31:

\`\`\`powershell
git pull origin main
npm.cmd install
npm.cmd test

$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
# Optional token for public discovery; required for private repos and CI check inspection.
$env:PHIBOT_GITHUB_TOKEN = '<read-only fine-grained token from local credential storage>'

npm.cmd run queue:enqueue -- repo.steward.discover '{\"repository\":\"MichaelWave369/phibot\"}'
npm.cmd run queue:list
npm.cmd run queue:run-once
npm.cmd run queue:list
\`\`\`

On some Windows shells, inline JSON quoting differs; using Node directly with a correctly escaped JSON argument is an alternative. **No token or secret should be supplied as a command-line parameter or committed file.** \`queue:run-once\` needs Node 22+, dependency installation and a working internet connection for GitHub reads.

For one eligible PhiBot draft PR (replace the example values and use the *exact check context/job name*):

\`\`\`powershell
npm.cmd run queue:enqueue -- repo.steward.inspect '{\"repository\":\"MichaelWave369/phibot\",\"prNumber\":123,\"requiredChecks\":[\"test\"]}'
\`\`\`

The queue itself cannot create or alter that PR.

## Budgets and durability

- Each \`run-once\` attempts at most **2 jobs** by default; \`PHIBOT_QUEUE_MAX_JOBS\` can be 1–5.
- Its default wall-time scheduling budget is **60 seconds**; \`PHIBOT_QUEUE_MAX_MS\` accepts 1,000–300,000 ms. It stops launching new jobs once the budget is reached. A tool call already in progress is limited separately by the ToolExecutor timeout.
- **Two attempts total** per job across runs. A failed read is left queued for the next explicit \`run-once\`, then marked \`exhausted\` if it fails again. No automatic retries in the same invocation.
- Deterministic SHA-256 job IDs deduplicate exactly identical work. Jobs are saved under ignored \`.phibot/work-queue/jobs/<id>.json\` using exclusive create. Re-enqueueing does not alter a completed or exhausted job.
- The worker creates \`.phibot/work-queue/worker.lock\` exclusively. If it is already held, new workers refuse. An old lock is only eligible for recovery when its expiry has passed **and** its PID is no longer active on the current machine.
- Each attempt creates a lease before executing. An interrupted lease can be recovered on another \`run-once\` only when expired and its recorded PID is no longer active. Recovery consumes the previous attempt budget and is receipted.
- State updates use atomic temp-file renames. \`events.ndjson\` records transitions and \`tool-receipts.ndjson\` records PhiBot ToolExecutor outcomes. Raw source, issue text, API credentials and model prompts are not included in queue event summaries.

The queue preserves **observation metadata** (e.g., task count, issue count, CI check status, observed PR commit SHA and a digest of the read result), not a raw GitHub response. The digest is for correlation, **not a signature or proof of correctness**.

## Limits and nonclaims

This is a **single-machine** queue, not a distributed lock service. Do not point multiple machines at the same queue directory or force-remove active locks. A PID can be reused after a crash, so recovery errs toward refusing a suspicious lock. A crash between file-state and event-journal writes may leave metadata incomplete; the durable job file is authoritative. Files and tokens are still subject to the host's OS permissions.

The queue runs read-only remote observations. It does not execute source code from target repositories, auto-generate model repairs, approve PRs, grant GitHub writes, submit drafts, merge, deploy or schedule recurring jobs. Existing **human-gated** source repair and draft tools remain separate. No actual Windows/GitHub field test has been performed by these mocked contract tests.

Next qualification gates: local Windows runs against a disposable repo; stricter per-request bandwidth/read quotas; lease/queue storage migration and host-specific recovery tests; and eventually an operator-approved recurring schedule that invokes only the read-only catalog.

**Ledger above ego: a persisted task is permission to inspect, not permission to change.**
