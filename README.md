# PhiBot

**PhiBot** is a governed micro-agent runtime and local agent-service layer inspired by Vessie / PhiVessel.

Small specialist agents get explicit identity, bounded authority, local model providers, governed tools, a cryptographic Reality Gate, nested NBG memory, typed CommonLine communication, durable service state, governed spawning, full-lifecycle acceptance, and field qualification evidence.

## The complete governed path

```text
Vessie
  |
recurring evidence
  |
spawn proposal
  |
least-authority PhiBot
  |
PhiOS Service
  |
NBG memory
  |
CommonLine crew
  |
provider-backed vessel loop
  |
Reality Gate
  |
governed tool
  |
ledger
  |
dissolve / retain
```

## Acceptance

Deterministic full lifecycle:

```bash
npm run acceptance
```

Strict local Ollama lifecycle:

```bash
ollama serve
ollama pull qwen3:4b
npm run acceptance -- --mode ollama
```

## Field qualification

Produce a preserved PASS/FAIL evidence pack on the target machine:

```bash
npm run qualify
```

Optionally bind the record to a source commit:

```bash
npm run qualify -- --source-commit <git-commit-sha>
```

The pack includes a qualification record, detached SHA-256, and hashes for every durable runtime artifact.

## Service mode

```bash
npm run service -- --manifest bots/examples/local-scout.phibot.json
```

Default local status surface:

```text
http://127.0.0.1:7369/health
http://127.0.0.1:7369/bots
http://127.0.0.1:7369/events
```

See [docs/FIELD_QUALIFICATION.md](docs/FIELD_QUALIFICATION.md), [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), [docs/SPAWNING.md](docs/SPAWNING.md), [docs/SERVICE.md](docs/SERVICE.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
