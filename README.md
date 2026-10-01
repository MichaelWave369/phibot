# PhiBot

**PhiBot** is a governed micro-agent runtime inspired by the Vessie / PhiVessel architecture.

Small specialist agents get explicit identity, bounded authority, provider receipts, governed tools, a cryptographic Reality Gate, nested NBG memory, typed CommonLine communication, and an append-only ledger.

## Core loop

```text
observe -> interpret -> propose -> verify -> ledger
```

## Phi ecosystem

- **Vessie**: coordinator / governor
- **PhiBots**: small specialist workers
- **CommonLine**: typed inter-agent communication
- **PhiOS**: host and capability substrate
- **NBG memory**: nested task / bot storage and retrieval
- **Reality Gate**: governed external-action boundary
- **Ledger**: receipts and provenance

## Current capabilities

- typed manifests
- provider registry and local Ollama
- deterministic provider fallback
- typed governed tools
- one-use cryptographic Reality Gate grants
- nested NBG memory with explicit promotion
- typed bot-to-bot messages
- reply and handoff lineage
- bounded NBG memory handoff packets
- expiring temporary bot groups
- dedicated Vessie coordinator channel
- pluggable CommonLine transport
- tests and GitHub Actions CI

## Crew shape

```text
                         VESSIE
                            ▲
                     coordinator channel
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
     ScoutBot            PatchBot            MemoryBot
        │                   │                   │
        └──── CommonLine threads / handoffs ───┘
                            │
                       NBG packets
```

See [docs/COMMONLINE.md](docs/COMMONLINE.md), [docs/MEMORY.md](docs/MEMORY.md), [docs/REALITY_GATE.md](docs/REALITY_GATE.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
