# PhiBot

**PhiBot** is a governed micro-agent runtime inspired by the Vessie / PhiVessel architecture.

Instead of cloning one giant agent repeatedly, PhiBot is built around small purpose-specific workers with explicit identity, bounded memory, declared capabilities, authority limits, provider receipts, typed tool execution, a cryptographic Reality Gate, and an append-only ledger.

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
- registry-owned action classes
- deny-by-default unknown tools
- bounded tool sandbox
- cryptographic Reality Gate requests and grants
- approve / deny / narrow decisions
- short-lived one-use grants
- grant binding to bot, run, capability, action class, and exact input digest
- replay protection
- gate + tool receipt chain
- tests and GitHub Actions CI

## Reality Gate flow

```text
gated tool call
      |
  gate request
      |
 approve / deny / narrow
      |
 signed one-use grant
      |
 verify signature + expiry + binding + replay
      |
    execute
      |
 gate + tool receipts
```

A grant is not general permission. It is bound to the original bot, run ID, capability, authority class, and exact canonical tool-input SHA-256 digest.

See [docs/REALITY_GATE.md](docs/REALITY_GATE.md) for the contract.

## Design law

> Capability is not authority.

And now:

> Approval is not permanent authority.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TOOLS.md](docs/TOOLS.md), [docs/PROVIDERS.md](docs/PROVIDERS.md), [docs/REALITY_GATE.md](docs/REALITY_GATE.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
