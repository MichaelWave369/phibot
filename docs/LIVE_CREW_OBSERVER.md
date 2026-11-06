# PHIBOT-27: Live Crew Observer (local-only)

This is the first **live crew visibility** slice for the existing PhiBot operations console. It is **not** an AI chat client, an autonomous workforce, a React rewrite, a model picker, or a computer-use sandbox.

It reads the **actual running PhiBot service** over its existing loopback-only **GET** endpoints, projects only allowlisted metadata, and shows:
- registered bots, names, roles, service-reported state and active run counts;
- configured provider/model strings (not a provider availability or inference check);
- bounded, sanitized event types and timestamps from the current service process.

The observer does not read durable transcripts, memory, source files, credential fields, provider responses, tool inputs, full bot manifests, secrets, grants, or free-text event details. The service could self-report inaccurate information; the UI labels it **not attested**. Empty, offline, or unconfigured states never synthesize bots.

## Run on Windows 11 (Node 22+)

Merge the feature PR after checks and review. In the PhiBot clone run:

\`\`\`powershell
git pull origin main
npm.cmd install
npm.cmd test
\`\`\`

In **PowerShell terminal A**, explicitly start a service with a known, reviewed local manifest:

\`\`\`powershell
npm.cmd run service -- --port 7369 --manifest bots/examples/repo-scout.phibot.json
\`\`\`

In **PowerShell terminal B**, explicitly link the read-only dashboard to that port:

\`\`\`powershell
$env:PHIBOT_OWNER = 'MichaelWave369'
$env:PHIBOT_REPO_ALLOWLIST = 'MichaelWave369/phibot'
$env:PHIBOT_CREW_SERVICE_PORT = '7369'
npm.cmd run queue:dashboard
\`\`\`

Open the printed **http://127.0.0.1:43969/** URL. If no service is started, or if the port is omitted, the panel shows **SERVICE NOT CONNECTED** and makes no claim that an agent is live.

**Important:** The \`PHIBOT_CREW_SERVICE_PORT\` value must be a numeric TCP port. The dashboard constructs a fixed \`127.0.0.1\` endpoint and never accepts a user-controlled hostname or path. Only \`GET /bots\` and \`GET /events?limit=24\` are read, with a 2.5s timeout and 128KiB response cap. The endpoint itself is unauthenticated and must never be reverse-proxied or exposed to LAN/Starlink.

## Security and authority

- \`/api/crew\` is **GET-only** and never has an action token or permission-grant path.
- No bot creates, starts, stops, or executes as a result of reading this view.
- Existing PHIBOT-25/26 manual operator controls remain unchanged: view-only by default, and optional **read-only** queue requests only.
- The browser uses \`textContent\`, never \`innerHTML\`, for external names and event labels. The original Content Security Policy remains enforced.
- Invalid, oversized, unknown-schema or unreachable service responses fail closed as \`CREW_SERVICE_UNAVAILABLE\` and do not show stale live agents.
- The service's bot \`state\` is **service-reported**, not independently verified against operating-system processes. Model names are configured, not tested.
- This does not prove model quality, provider availability, live inference, Native PhiOS isolation, secure key custody, authenticated multi-user access or computer-use safety.

## Acceptance

Run \`npm test\` and inspect the localhost interface. Test the offline view without the env var, a valid live service with a registered test manifest, interruption of terminal A, and malformed service JSON. Check that the panel does not change the read-only permission boundary. The automated tests use mock HTTP responses, **not** a qualified Windows field run.

## Next gates

1. Human-reviewed bot creation/configuration in the existing service, with exact proposed-diff display and no authority escalation.
2. Actual provider readiness/probe receipts with strict resource limits and no hidden fallback.
3. Governed MCP adapter, sandboxed execution, and only then any model switching or real task dispatch.

**Ledger Above Ego. Seeing a bot is not permission to command it.**
