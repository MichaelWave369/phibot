# PhiBot

**PhiBot** is a governed micro-agent runtime inspired by the Vessie / PhiVessel architecture.

Instead of cloning one giant agent repeatedly, PhiBot is built around small purpose-specific workers with explicit identity, bounded memory, declared capabilities, authority limits, escalation rules, provider receipts, and an append-only ledger.

## Core loop

```text
observe -> interpret -> propose -> verify -> ledger
```

## Place in the Phi ecosystem

- **Vessie**: coordinator / governor
- **PhiBots**: small specialist workers
- **CommonLine**: inter-agent communication transport
- **PhiOS**: host and capability substrate
- **NBG memory**: scoped storage / retrieval / promotion layer
- **Reality Gate**: governed external-action boundary
- **Ledger**: receipts and provenance

## Current capabilities

Rung 0 established the governed runtime. Rung 1 adds real model-provider plumbing:

- typed PhiBot manifest contract
- fixed five-stage vessel loop
- capability and authority declarations
- external-action authority gate
- append-only NDJSON receipts
- provider registry
- deterministic provider
- local Ollama provider
- automatic deterministic fallback when a configured provider is unavailable
- structured provider result validation
- per-stage token / latency / provider receipts
- example dry-run and local Ollama bots
- CLI runner
- unit tests and GitHub Actions CI

## Quick start

Requires Node.js 22+.

```bash
npm install
npm test
npm run phibot -- bots/examples/scout.phibot.json "map the repository"
```

A run writes receipts to `.phibot/ledger.ndjson` by default.

## Run a local Ollama-backed PhiBot

Start Ollama and make sure the manifest's model exists:

```bash
ollama serve
ollama pull qwen3:4b
npm run phibot -- bots/examples/local-scout.phibot.json "inspect this task and propose the safest next step"
```

The default Ollama endpoint is `http://127.0.0.1:11434`. Override it with `OLLAMA_HOST`.

By default, provider failures fall back to the deterministic `dry-run` provider. The receipt explicitly records that fallback and its reason. Disable fallback when testing failure behavior:

```bash
PHIBOT_PROVIDER_FALLBACK=none npm run phibot -- bots/examples/local-scout.phibot.json "test strict provider mode"
```

## Design law

> Capability is not authority.

A bot may know how to perform an operation while still lacking permission to perform it. Provider choice does not change that boundary.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/MANIFEST.md](docs/MANIFEST.md), [docs/PROVIDERS.md](docs/PROVIDERS.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
