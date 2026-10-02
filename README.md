# PhiBot

**PhiBot** is a governed micro-agent runtime and local agent-service layer inspired by Vessie / PhiVessel.

Small specialist agents get explicit identity, bounded authority, local model providers, governed tools, a cryptographic Reality Gate, nested NBG memory, typed CommonLine communication, durable service state, and governed spawning.

## The full ladder

```text
Vessie
  |
pattern evidence
  |
spawn proposal
  |
least-authority PhiBot
  |
PhiOS Service
  |
CommonLine crew
  |
NBG memory
  |
Reality Gate
  |
governed tools
  |
ledger
```

## Governed spawning

Vessie can propose a specialist only after recurring-pattern evidence reaches policy threshold.

Ephemeral bots:

- use least-authority templates
- expire automatically
- form temporary CommonLine crews
- dissolve with receipts

Persistent bots additionally require a signed, short-lived, one-use approval bound to the exact generated manifest.

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

See [docs/SPAWNING.md](docs/SPAWNING.md), [docs/SERVICE.md](docs/SERVICE.md), [docs/COMMONLINE.md](docs/COMMONLINE.md), [docs/MEMORY.md](docs/MEMORY.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
