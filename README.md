# PhiBot

**PhiBot** is a governed micro-agent runtime and local agent-service layer inspired by Vessie / PhiVessel.

Small specialist agents get explicit identity, bounded authority, local model providers, governed tools, a cryptographic Reality Gate, nested NBG memory, typed CommonLine communication, durable service state, governed spawning, and a full-lifecycle acceptance harness.

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

Run the deterministic full lifecycle:

```bash
npm run acceptance
```

Run against a real local Ollama model:

```bash
ollama serve
ollama pull qwen3:4b
npm run acceptance -- --mode ollama
```

Live Ollama mode is strict: it does not fall back to the deterministic provider.

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

See [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), [docs/SPAWNING.md](docs/SPAWNING.md), [docs/SERVICE.md](docs/SERVICE.md), [docs/COMMONLINE.md](docs/COMMONLINE.md), [docs/MEMORY.md](docs/MEMORY.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
