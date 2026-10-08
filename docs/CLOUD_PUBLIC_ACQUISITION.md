# PHIBOT-09: Opt-in public Scout observation acquisition

**Status: opt-in read-only evidence acquisition / not a hosted PhiBot agent.**

FCW-03 now publishes \`docs/phibot_mission.json\` together with \`docs/status.json\`. PHIBOT-08 inspects an already-supplied mission offline. PHIBOT-09 adds the smallest live public reader, invoked manually by an operator. It does not spawn or run a PhiBot or invoke any inference provider.

## Run (local Node 22+, no secrets)

From the PhiBot repository:

\`\`\`sh
npm run cloud:inspect
\`\`\`

This makes **exactly four** public unauthenticated GitHub REST GET requests, in order:

1. \`/repos/MichaelWave369/FieldCloudWorker/branches/main\` (resolve a snapshot commit)
2. \`/contents/docs/status.json?ref=<same-full-commit>\`
3. \`/contents/docs/phibot_mission.json?ref=<same-full-commit>\`
4. \`/actions/runs/<derived-allowlisted-run-id>\`

All targets are strictly validated. No redirects, no POSTs, no user-supplied URL, no tokens, no webhooks, no background polling. The HTTP loader has bounded responses, content-type check, timeout, and re-computes Git blob SHA-1 for both files. The existing PHIBOT-08 consumer matches source SHA-256, Scout mission identity, scope, expiry, receipt digest, run identity, zero model/write budgets and no-authority flags. Then the new reader correlates public GitHub run metadata for the workflow, repository, run ID, branch, event, outcome, commit prefix and timestamps.

**The current main commit may differ from the commit the earlier observation ran on.** GitHub Actions writes a new commit to publish the receipt; metadata correlation compares the source-record's seven-character prefix against the historical run head, not blindly against the current main commit.

The output is a small, safe review receipt. It explicitly states:

- \`independent_prior_source_pin_verified=false\`
- \`operator_identity_authenticated=false\`
- \`measurement_truth_authenticated=false\`
- \`source_authorship_authenticated=false\`
- \`bot_spawned=false\`
- \`agent_runtime_executed=false\`
- \`action_executed=false\`
- \`authority_granted=false\`
- \`memory_admitted=false\`

A coherent set of public GitHub records **does not** establish a trusted publisher identity, independent content attestation, operator permission, or task measurement truth. The moving main commit is only a consistent public snapshot.

The CLI is not a PhiBot service API. No CommonLine transport, live BrainC routing, model generation, NBG memory admission or scheduled work was added. Another separate authorization/field-qualification rung is required for actual agents.

## CI and limitations

\`npm test\` runs the new tests entirely offline with injected fake GitHub responses. It does not claim that the target Windows/Ollama/PhiOS machine was qualified. A manual live \`npm run cloud:inspect\` after merge is the live-network acceptance step.

**Evidence is not authority. Public data is not an agent command.**
