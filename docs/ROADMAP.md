# PhiBot Roadmap

The initial rung ladder is complete. Work now moves through integration and qualification tracks.

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

- [x] typed inter-bot messages
- [x] manifest-derived sender identity
- [x] reply thread linkage
- [x] typed handoffs with NBG packets
- [x] message receipts
- [x] temporary bot groups with expiry
- [x] Vessie coordinator channel
- [x] pluggable transport and group-store seams

## Rung 6 - PhiOS service

- [x] daemon/service wrapper
- [x] persistent local bot registry
- [x] run concurrency/rate budgets
- [x] provider-token/tool-call budgets
- [x] UI/status event stream
- [x] loopback-only read-only status HTTP
- [x] durable Reality Gate replay store
- [x] durable NBG memory store
- [x] durable CommonLine transport/groups
- [x] append-only service ledger
- [ ] PhiOS-native process isolation
- [ ] PhiOS-native key custody
- [ ] PhiOS-native IPC adapter

## Rung 7 - Governed PhiBot spawning

- [x] governed spawn proposal
- [x] least-authority templates
- [x] recurring-pattern evidence threshold
- [x] ephemeral / persistent lifetime
- [x] signed one-use approval for persistent bots
- [x] durable approval replay protection
- [x] automatic temporary CommonLine crew
- [x] Vessie coordinator notification
- [x] durable spawn records
- [x] expiry sweep and dissolution
- [x] spawn / dissolve receipt chain
- [x] PhiOS status events

## Acceptance and qualification track

- [x] deterministic full-lifecycle acceptance harness
- [x] spawn -> NBG -> CommonLine -> provider -> Gate -> tool -> dissolve
- [x] receipt-chain acceptance assertion
- [x] resource-budget acceptance assertion
- [x] Reality Gate replay rejection assertion
- [x] strict local Ollama acceptance mode
- [x] field qualification evidence-pack writer
- [x] SHA-256 artifact manifest + detached record digest
- [x] FAIL records preserve available evidence
- [x] overwrite protection for qualification destinations
- [ ] run and preserve PASS qualification on target Ollama machine

## PhiOS integration track

- [ ] PhiOS-native process isolation
- [ ] PhiOS-native key custody
- [ ] PhiOS-native IPC adapter
- [ ] service startup/package integration in PhiOS image
- [ ] PhiOS UI crew/status surface

## Ecosystem integration track

- [ ] connect standalone CommonLine transport
- [ ] connect Vessie spawn-policy UI
- [ ] connect real repository read/patch/test tools behind Reality Gate
