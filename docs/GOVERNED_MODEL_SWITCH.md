# PHIBOT-35: Governed local model configuration switch

PHIBOT-35 adds an **actual** change to the model configured for an existing idle PhiBot. It is not inference, a mission dispatch, or a bot permission update. The existing PHIBOT-34 dashboard planner remains review-only.

## What changes

An operator launches a dedicated **interactive terminal** command, reviews the bot ID, previous model, proposed Ollama model, exact registry revision and SHA-256 digest, and types `APPROVE <first 16 hex characters>`. The CLI sends the exact proposal to an opt-in, token-authenticated, fixed-loopback endpoint of the already running PhiBot service.

The service independently validates the canonical digest, checks the configured target in local Ollama `GET /api/tags`, and serializes updates with run start/finish and registry changes. It refuses running/disabled/missing bots, active runs, stale revisions, no-ops, invalid model tags, malformed proposals and incorrect credentials. It changes **only** `manifest.model` and creates an intent and completion ledger receipt. The service reports `MODEL_CHANGED_NO_INFERENCE`.

## Windows 11 field instructions

Use Node.js 22+ and local Ollama. Review/merge the PR and run `npm.cmd test` on your PhiBot clone.

**Before starting the service:** prepare a random 32+ character secret for the current PowerShell session and keep it in local secure storage. Never paste it in a chat, repository or log. Set the same secret locally in the separate operator terminal. The example variable below intentionally does not contain a real secret.

PowerShell terminal A:

```powershell
$env:PHIBOT_CREW_MODEL_CONTROL = '1'
$env:PHIBOT_CREW_CONTROL_TOKEN = '<locally-generated-random-secret-at-least-32-chars>'
$env:PHIBOT_CREW_OLLAMA_PORT = '11434'
npm.cmd run service -- --port 7369 --manifest bots/examples/repo-scout.phibot.json
```

Start Ollama on `127.0.0.1:11434` with a previously installed model. This rung **does not download** models or run inference. It only checks the tags reported by Ollama. Do not run a second PhiBot service against the same registry.

PowerShell terminal B:

```powershell
$env:PHIBOT_CREW_CONTROL_TOKEN = '<the-same-local-secret-from-terminal-A>'
npm.cmd run model:apply -- --bot repo-scout --model qwen3:4b --port 7369
```

Replace `repo-scout` with the bot ID printed by your service and `qwen3:4b` with the exact installed Ollama tag. Read the printed plan and type the displayed `APPROVE <digest prefix>` only if everything is correct. The CLI does **not** accept noninteractive approval and refuses absent or malformed secrets.

Verify the actual registered model using the local service `/bots` endpoint or by restarting the local dashboard with the PHIBOT-27 crew observer. Only configured model identity changes; availability for tool use and real inference are unqualified.

## Restart behavior

Normal `npm.cmd run service -- --manifest <path>` now preserves an existing registered bot instead of silently resetting a human-approved model choice. To deliberately overwrite a registered bot from its manifest (including the model and any other fields in the manifest), use the separate explicit `--replace-existing-manifests` flag during service startup. Existing bots should not be casually replaced because manifest replacement can change permissions.

## Security boundaries and residual risks

- Disabled by default. The control route is available only when PHIBOT_CREW_MODEL_CONTROL=1 and PHIBOT_CREW_CONTROL_TOKEN passes startup validation. The service must bind to IPv4 127.0.0.1, not a LAN address.
- The token is never returned by an API. The POST requires the exact Host, loopback peer, JSON type, absent browser Origin/Referer, and a constant-time token comparison. A token-holder can use the endpoint; terminal confirmation is a CLI safeguard, **not cryptographic proof of a human**.
- This feature relies on a trusted local OS account and a single PhiBot service process. Other local processes under the same user may still be able to access loopback services and environment data; do not expose service ports over Starlink, a tunnel or a reverse proxy.
- The exact request body is capped at 3000 bytes; the server fetches Ollama tags only from a fixed loopback origin with a 2.5-second timeout and 128KiB cap, validating all model names and refusing duplicate tags.
- SHA-256 binds the requested bot, current model identity, `updatedAt` revision, and the target model. It detects stale/tampered proposals, but is **not a signature**. The registry's compare-and-swap condition and single-process mutex prevent a concurrent run beginning during the change.
- The service persists a model-change intent before writing. An unexpected crash after registry persistence but before completion receipt may leave an ambiguous outcome. Inspect the registry/ledger and **do not blindly retry**.
- No network-level isolation between different local processes, no multi-host lock, no secure key vault and no native PhiOS isolation are claimed. The local operator is responsible for controlling the token.
- No mission is queued or started, no Reality Gate grant is minted, no existing authority/capability is modified and no model inference or source write occurs. This is a **configuration operation**, not a full autonomous model hot-swap or readiness qualification.

## Acceptance

`npm test` includes the PHIBOT-35 TypeScript negative controls for request integrity, token/Origin boundaries, missing models, stale revisions, active runs, serialization and receipt persistence. CI uses a local mock Ollama responder. Run a real Windows/Ollama field test separately; green CI does not certify your physical environment.

**Ledger Above Ego. An approved model configuration still has exactly the same permissions.**
