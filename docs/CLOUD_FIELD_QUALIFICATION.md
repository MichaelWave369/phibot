# PHIBOT-10: Manual cloud public-read field qualification

**Status: manual-only, review-only, no agent execution.** PHIBOT-09's public reader passes deterministic fixture tests. To establish that the real GitHub GET path is reachable and still matches FCW-03's exact published file formats, we need a live, reproducible run.

After this PR is merged, go to **PhiBot → Actions → PhiBot Scout Public Field Qualification → Run workflow**, select **main**, and trigger it. The new workflow only supports manual \`workflow_dispatch\`; it never runs on schedule, push, or PR. No repository write permissions, checkout credentials, cache, background bot, provider model, or persistent artifact is involved.

The workflow compiles PhiBot, runs offline negative-control tests, and runs the exact PHIBOT-09 command using Node 22:

\`\`\`bash
node dist/src/cloud-inspect-cli.js > "$RUNNER_TEMP/phi-cloud-public-review.json"
node scripts/cloud-field-assert.mjs "$RUNNER_TEMP/phi-cloud-public-review.json"
\`\`\`

The second script refuses malformed data, missing source-hash/GitHub-run checks, forged actor/task IDs, any claim of model execution, action authority or memory admission, future timestamps, stale receipts older than eight hours, and unknown fields that might smuggle instructions. It prints only a small qualification summary and SHA-256 digest of the temporary reviewed file, then the workflow deletes that file. The script deliberately never prints model text, task outputs, credentials, raw JSON, or private system information. The workflow does not publish source bytes.

If the last public observation has expired, the live run **fails safely**. Run the FieldCloudWorker observation manually (its existing separate workflow) to refresh its public receipt, then trigger this qualification again. That upstream workflow may write its existing sanitized public observation files under its own permissions; this PhiBot workflow itself is always read-only.

A green manual qualification proves the **four real public GETs and the current schema/run correlation worked at that moment**. It does *not* prove publisher authorship, measurement truth, agent runtime activation, target-machine Ollama availability, PhiOS isolation, live model routing, or permission to execute anything.

For local inspection without GitHub Actions:

\`\`\`sh
npm run cloud:inspect
\`\`\`

This remains a separate explicit operator action. All default CI tests remain offline and need no network access.

**Qualification of public evidence ≠ qualification of PhiBot as an autonomous agent.**
