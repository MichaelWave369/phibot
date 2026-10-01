# PhiBot

**PhiBot** is a governed micro-agent runtime inspired by the Vessie / PhiVessel architecture.

Instead of cloning one giant agent repeatedly, PhiBot is built around small purpose-specific workers with explicit identity, bounded memory, declared capabilities, authority limits, provider receipts, typed tool execution, and an append-only ledger.

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

- typed PhiBot manifests
- fixed five-stage vessel loop
- provider registry
- local Ollama provider with deterministic fallback
- provider token / latency receipts
- typed tool capability registry
- per-capability argument validation
- registry-owned action classes
- deny-by-default unknown tools
- bounded tool sandbox with timeout / cancellation signal
- receipted tool execution
- example local utilities
- tests and GitHub Actions CI

## Quick start

Requires Node.js 22+.

```bash
npm install
npm test
npm run phibot -- bots/examples/scout.phibot.json "map the repository"
```

## Local Ollama PhiBot

```bash
ollama serve
ollama pull qwen3:4b
npm run phibot -- bots/examples/local-scout.phibot.json "inspect this task and propose the safest next step"
```

## Governed tool execution

The model never gets to define a registered tool's authority class. The registry does.

```bash
npm run tool -- bots/examples/utility.phibot.json utility.echo '{"text":"hello PhiBot"}'
npm run tool -- bots/examples/utility.phibot.json math.add '{"values":[3,6,9]}'
```

Every attempt is receipted, including denied, gated, invalid, timed-out, and successful calls.

An undeclared or unknown capability is denied by default.

## Design law

> Capability is not authority.

Knowing how to call a tool does not grant permission to use it.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/MANIFEST.md](docs/MANIFEST.md), [docs/PROVIDERS.md](docs/PROVIDERS.md), [docs/TOOLS.md](docs/TOOLS.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
