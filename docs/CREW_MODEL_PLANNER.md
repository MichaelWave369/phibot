# PHIBOT-34: Local Crew Model & Mission Planner

PHIBOT-34 extends the real localhost Crew Observer with a model picker and mission-role selector for each idle registered bot. It is an **operator-review-only** tool, not a hot-swap engine or autonomous dispatcher.

## What is real

- The existing PhiBot service supplies actual registered bots, not invented demo agents.
- A separately running local Ollama server supplies installed model tags using its **GET /api/tags** endpoint on the explicitly configured loopback port.
- Pick one reported Ollama tag and a mission label (scout, patch, skeptic, test, memory) for a bot that reports idle and zero active runs.
- Clicking **Review assignment** makes the server re-read both sources, validate the request, construct a SHA-256-bound proposal pinned to the bot's existing model and updatedAt revision, and independently recompute/check the proposal.
- The reviewed proposal is returned with an explicit **NO CHANGE MADE** message. It is neither stored as a mission nor executed.

**Not implemented in this rung:** real model switching, inference, new bot registration, mission dispatch, MCP tools, privileges, grants, memory access, GitHub writes, or model installation. A tag reported by Ollama is not proof that inference works.

## Windows 11 quick start

Use Node.js 22+ and locally running Ollama. After merging and reviewing the PR, in your PhiBot clone:

    git pull origin main
    npm.cmd install
    npm.cmd test

Start PhiBot service in PowerShell terminal A with an existing reviewed manifest:

    npm.cmd run service -- --port 7369 --manifest bots/examples/repo-scout.phibot.json

Start Ollama separately on 127.0.0.1:11434 and install models manually beforehand if needed. PHIBOT-34 never downloads a model.

In PowerShell terminal B:

    $env:PHIBOT_OWNER = 'MichaelWave369'
    $env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
    $env:PHIBOT_CREW_SERVICE_PORT = '7369'
    $env:PHIBOT_CREW_OLLAMA_PORT = '11434'
    $env:PHIBOT_CREW_PLANNER_ACTIONS = '1'
    npm.cmd run queue:dashboard

Open http://127.0.0.1:43969/ and find **Live crew observer**. The selector reads local Ollama tags. Review any proposed assignment. No running model is changed.

The separate PHIBOT_QUEUE_DASHBOARD_ACTIONS opt-in remains off by default; turning on the crew planner never authorizes the work queue.

## Threat model and boundaries

- Ollama origin is hardcoded to fixed loopback 127.0.0.1 plus a numeric 1..65535 port, with no custom scheme, hostname or redirect. Only a GET is used, with a 2.5-second timeout and 128-KiB response cap.
- Malformed or duplicate model tags, invalid arrays, unknown input keys, and oversized provider responses are refused.
- Ollama tags are a local process **self-report, not a trusted inference qualification**. The proposal integrity check is an input/revision checksum, not a cryptographic signature or remote attestation.
- The app retains its localhost-only listener, exact Host/Origin checks, operator session token and restrictive Content Security Policy. Model and bot labels render as text nodes.
- POST /api/crew/plan exists only with PHIBOT_CREW_PLANNER_ACTIONS=1 and it has no write or execution path.
- The backend rechecks that the specific bot remains idle and registered and the candidate model tag exists. Proposal SHA-256 binds bot ID, old provider/model, updatedAt revision, new model and mission label.
- This is a local single-user application; the source service's GET APIs are unauthenticated. Never expose the PhiBot service or dashboard through a proxy, tunnel, LAN or Starlink. The local Windows profile remains the security boundary.
- No full manifests, keys, memory, raw model responses, tool inputs or untrusted event details are exposed in review output.
- Independent proposal rechecking validates consistency of two local self-reports, not independently observed running inference or a transactional cross-process state.

## Acceptance

Run npm test. Added tests check fixed origin, bounded response reads, model tag validation, missing Ollama, digest and stale-revision behavior, running-bot refusals, origin/session enforcement, and default-deny queue and planner paths.

CI uses mocked providers. A green CI is not a Windows/Ollama field qualification. Test manually with actual service and Ollama, including the service dropping offline, and verify that reviewing does not modify the registry or run inference.

## Future gates

1. Authenticated, separately reviewed service-control path for actual idle-only model switching and permission-preserving durable receipts.
2. Strict bounded local model-inference readiness test, with no hidden fallback.
3. Real least-authority mission dispatch with a separate SkepticBot reviewer and Reality Gate enforcement.
4. Sanitized, read-only PhiMadaPrime crew activity integration.

**Ledger Above Ego. An installed tag is not a qualified brain, and a plan is not permission to act.**
