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

- [ ] typed capability descriptors
- [ ] per-capability arguments
- [ ] action-class authority
- [ ] tool execution sandbox
- [ ] deny-by-default unknown tools

## Rung 3 - Reality Gate

- [ ] gate request object
- [ ] approve / deny / narrow grant
- [ ] signed short-lived grants
- [ ] replay protection
- [ ] gate receipt chain

## Rung 4 - NBG memory pods

- [ ] task memory bubble
- [ ] bot-local memory bubble
- [ ] promotion rules
- [ ] provenance links
- [ ] expiry / compaction
- [ ] Vessie escalation memory packet

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

## Rung 7 - PhiBot spawning

Vessie may propose a new bot when a recurring work pattern is detected. Spawning creates a manifest from a governed template, assigns minimum capabilities, and requires approval for persistent authority.

Ephemeral bots should be able to dissolve after completing their bounded task.
