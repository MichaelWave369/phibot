# End-to-End Acceptance

The initial PhiBot ladder is complete. This track proves the pieces operate as one governed lifecycle.

## What the scenario exercises

```text
recurring evidence
      |
Vessie-style spawn proposal
      |
ephemeral least-authority repair bot
      |
PhiBot Service registration + budget
      |
NBG task memory -> promoted bot memory
      |
bounded memory packet
      |
CommonLine handoff
      |
provider-backed vessel loop
      |
gated repo.patch request
      |
Reality Gate approval
      |
one successful tool execution
      |
replay rejection
      |
run budget closeout
      |
spawn dissolution
      |
receipt-chain verification
```

The acceptance patch tool is a fixture. It returns an `applied` result but does **not** modify repository files.

## Deterministic CI acceptance

GitHub CI runs:

```bash
npm test
```

That includes the full acceptance lifecycle using the deterministic provider. This validates orchestration and governance without requiring a live Ollama daemon on the GitHub runner.

You can run the same scenario directly:

```bash
npm run acceptance
```

## Live local Ollama acceptance

To prove the provider stage uses a real local model:

```bash
ollama serve
ollama pull qwen3:4b
npm run acceptance -- --mode ollama
```

Optional custom Ollama endpoint:

```bash
npm run acceptance -- \
  --mode ollama \
  --ollama-host http://127.0.0.1:11434
```

Live mode does **not** use the deterministic fallback. If Ollama is unavailable, times out, returns invalid structured output, or fails the governed reasoning stage, the acceptance run fails.

## Inspecting durable evidence

By default the CLI uses a temporary state directory and removes it after printing the report.

Keep the state:

```bash
npm run acceptance -- --keep-state
```

Or choose a location:

```bash
npm run acceptance -- \
  --state-dir .phibot/acceptance \
  --mode ollama
```

The state directory contains the same durable registry, ledger, replay, memory, CommonLine, and spawn records used by service mode.

## Pass criteria

The report only returns `passed: true` when all of these hold:

- spawned bot was registered
- generated manifest remained least-authority
- NBG memory promoted with provenance
- CommonLine handoff arrived with its memory packet
- provider-backed vessel loop completed
- write tool hit Reality Gate
- approved tool executed exactly once
- grant replay was rejected
- provider/tool usage was reflected in service budgets
- expected receipt stages were present
- spawned bot dissolved and unregistered cleanly

## What this does not prove

Deterministic CI acceptance does not prove Ollama availability or model quality. Live Ollama mode covers that provider boundary.

Neither mode proves PhiOS kernel-level isolation, platform key custody, or native IPC. Those remain integration work rather than something we pretend a Node test magically certified.
