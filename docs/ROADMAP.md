# PhiBot Roadmap

The roadmap is rung-based. Each rung should remain runnable before the next one begins.

## Rung 0 - Bootstrap

- [x] repository skeleton
- [x] typed manifest
- [x] five-stage runtime loop
- [x] authority gate
- [x] append-only receipts
- [x] dry-run adapter
- [x] CLI
- [x] example bots
- [x] tests and CI

## Rung 1 - Provider interfaces

- [x] provider registry
- [x] Ollama adapter
- [x] structured provider result contract
- [x] token / latency / resource receipts
- [x] deterministic provider fallback

## Rung 2 - Tool capability registry

- [x] typed capability descriptors
- [x] per-capability arguments
- [x] action-class authority
- [x] tool execution sandbox
- [x] deny-by-default unknown tools
- [x] tool execution receipts

## Rung 3 - Reality Gate

- [x] gate request object
- [x] approve / deny / narrow grant decisions
- [x] signed short-lived grants
- [x] exact bot/run/capability/class/input binding
- [x] one-use replay protection
- [x] gate receipt chain

## Rung 4 - NBG memory pods

- [x] task memory bubble
- [x] bot-local parent bubble
- [x] explicit promotion rules
- [x] provenance links and content digests
- [x] expiry
- [x] deterministic compaction
- [x] nested retrieval
- [x] Vessie escalation memory packet
- [x] pluggable memory-store seam

## Rung 5 - CommonLine

- [ ] typed inter-bot messages
- [ ] sender identity
- [ ] reply / handoff receipts
- [ ] temporary bot groups
- [ ] Vessie coordinator channel

## Rung 6 - PhiOS service

- [ ] daemon/service wrapper
- [ ] local bot registry
- [ ] process/resource budgets
- [ ] UI status events
- [ ] governed bot spawning
- [ ] durable replay store / platform key custody
- [ ] durable NBG memory store

## Rung 7 - PhiBot spawning

Vessie may propose a new bot when a recurring work pattern is detected. Spawning creates a manifest from a governed template, assigns minimum capabilities, and requires approval for persistent authority.

Ephemeral bots should be able to dissolve after completing their bounded task.
