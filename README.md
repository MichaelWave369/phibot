# PhiBot

**PhiBot** is a governed micro-agent runtime inspired by the Vessie / PhiVessel architecture.

Small specialist agents get explicit identity, bounded authority, provider receipts, governed tools, a cryptographic Reality Gate, nested NBG memory, typed CommonLine communication, durable local service state, and an append-only ledger.

## Core loop

```text
observe -> interpret -> propose -> verify -> ledger
```

## Current stack

```text
                          PhiOS
                            │
                      PhiBot Service
                 /          |          \
           registry      budgets      events
              │             │           │
         PhiBot crew ─── CommonLine ── Vessie
              │
          NBG memory
              │
        Reality Gate
              │
        governed tools
              │
            ledger
```

## Rung 6 service mode

PhiBot can now run as a loopback local service with:

- persistent bot registry
- resource budgets
- UI/status events
- durable Reality Gate replay state
- durable NBG memory
- durable CommonLine messages/groups
- read-only local status endpoints

Start it:

```bash
npm run service -- --manifest bots/examples/local-scout.phibot.json
```

Default status surface:

```text
http://127.0.0.1:7369/health
http://127.0.0.1:7369/bots
http://127.0.0.1:7369/events
```

The HTTP interface is intentionally loopback-only and mutation-free in this rung.

See [docs/SERVICE.md](docs/SERVICE.md), [docs/COMMONLINE.md](docs/COMMONLINE.md), [docs/MEMORY.md](docs/MEMORY.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
