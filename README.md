# PhiBot

**PhiBot** is a governed micro-agent runtime inspired by the Vessie / PhiVessel architecture.

Small specialist agents get explicit identity, bounded authority, provider receipts, governed tools, a cryptographic Reality Gate, nested NBG memory, and an append-only ledger.

## Core loop

```text
observe -> interpret -> propose -> verify -> ledger
```

## Phi ecosystem

- **Vessie**: coordinator / governor
- **PhiBots**: small specialist workers
- **CommonLine**: inter-agent communication transport
- **PhiOS**: host and capability substrate
- **NBG memory**: nested task / bot storage and retrieval
- **Reality Gate**: governed external-action boundary
- **Ledger**: receipts and provenance

## Current capabilities

- typed manifests
- provider registry and local Ollama
- deterministic provider fallback
- typed tool capability registry
- deny-by-default tool execution
- one-use cryptographic Reality Gate grants
- task-local NBG memory bubbles
- parent bot memory bubbles
- explicit threshold-based promotion
- provenance and content digests
- expiry and deterministic compaction
- bounded Vessie escalation packets
- tests and GitHub Actions CI

## NBG memory shape

```text
Vessie
  ▲
  │ bounded escalation packet
  │
Bot Bubble
  ├── promoted memory
  ├── Task Bubble A
  └── Task Bubble B
```

Task memories do not become durable bot memories by accident. Promotion is explicit, thresholded, and provenance-preserving.

See [docs/MEMORY.md](docs/MEMORY.md), [docs/REALITY_GATE.md](docs/REALITY_GATE.md), [docs/TOOLS.md](docs/TOOLS.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
