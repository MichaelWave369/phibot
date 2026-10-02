# PhiOS Service Mode

Rung 6 turns PhiBot from a library into a local service PhiOS can host.

## Responsibilities

`PhiBotService` owns:

- local bot registration
- lifecycle state
- per-bot run concurrency and rate budgets
- per-run provider-token and tool-call budgets
- service event stream for UI/status surfaces
- durable local replay state
- durable NBG memory storage
- durable CommonLine messages/groups
- append-only service ledger
- loopback-only status HTTP surface

## Service state directory

Default:

```text
.phibot/service/
├── registry.json
├── ledger.ndjson
├── replay/
│   └── consumed-grants.ndjson
├── memory/
│   └── <memory-id>.json
└── commonline/
    ├── messages/
    └── groups/
```

All durable adapters are behind existing interfaces, so PhiOS can replace filesystem storage with platform-native services later.

## Bot registry

The registry persists:

- manifest
- registration/update timestamps
- service state
- active run count

A registered bot may be:

- `idle`
- `running`
- `disabled`
- `error`

Rung 6 does not yet allow arbitrary remote registration through HTTP.

## Resource budgets

Default budgets:

- 2 concurrent runs per bot
- 60 run starts per minute
- 32,768 provider tokens per run
- 100 tool calls per run

Budget checks happen before counters are mutated past their limit.

Budget violations emit both service events and ledger receipts.

These are orchestration budgets, not OS-level CPU/RAM cgroups.

## UI/status events

`ServiceEventBus` emits typed `phibot.service.event.v1` events for:

- service start/stop
- bot register/unregister/state
- run start/finish
- budget updates/blocks

The in-memory event history is bounded to 500 events.

## HTTP surface

The Rung 6 HTTP server is intentionally **loopback-only**.

Default:

```text
127.0.0.1:7369
```

Read-only endpoints:

- `GET /health`
- `GET /bots`
- `GET /events?limit=100`

There are deliberately no unauthenticated mutation endpoints.

## CLI

```bash
npm run service -- --manifest bots/examples/local-scout.phibot.json
```

Optional:

```bash
npm run service -- \
  --state-dir .phibot/service \
  --host 127.0.0.1 \
  --port 7369 \
  --manifest bots/examples/local-scout.phibot.json
```

## Durable Reality Gate replay protection

`FileReplayStore` preserves consumed grant IDs across service restarts.

It is designed for a **single local service writer**. Distributed multi-process atomic replay protection belongs in PhiOS platform storage or another transactional backend.

## Security boundary

Rung 6 is a local service contract, not a kernel sandbox.

It does not claim:

- CPU/RAM cgroup enforcement
- filesystem namespaces
- syscall filtering
- multi-user authentication
- network sandboxing

Those controls belong to PhiOS process/container services. The important part here is that the runtime contracts no longer need to change when PhiOS supplies them.
