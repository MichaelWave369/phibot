# PhiBot

**PhiBot** is a governed micro-agent runtime inspired by the Vessie / PhiVessel architecture.

Instead of cloning one giant agent repeatedly, PhiBot is built around small purpose-specific workers with explicit identity, bounded memory, declared capabilities, authority limits, escalation rules, and an append-only receipt trail.

## Core loop

```text
observe -> interpret -> propose -> verify -> ledger
```

The bootstrap deliberately keeps the provider layer simple. The included dry-run adapter proves the runtime contract without requiring cloud keys, local models, or external services.

## Place in the Phi ecosystem

- **Vessie**: coordinator / governor
- **PhiBots**: small specialist workers
- **CommonLine**: inter-agent communication transport
- **PhiOS**: host and capability substrate
- **NBG memory**: scoped storage / retrieval / promotion layer
- **Reality Gate**: governed external-action boundary
- **Ledger**: receipts and provenance

## Bootstrap capabilities

- typed PhiBot manifest contract
- fixed five-stage vessel loop
- capability and authority declarations
- external-action authority gate
- append-only NDJSON receipts
- deterministic dry-run adapter
- example ScoutBot and PatchBot manifests
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

## Design law

> Capability is not authority.

A bot may know how to perform an operation while still lacking permission to perform it. That distinction is structural, not conversational.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/MANIFEST.md](docs/MANIFEST.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
