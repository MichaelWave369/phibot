# PhiBot Architecture

## Purpose

PhiBot is the governed micro-agent layer of the Phi ecosystem. A PhiBot should be small enough to understand, replace, audit, and route cheaply.

The architecture starts from one rule:

> Capability is not authority.

A provider or tool may make an operation technically possible. The manifest decides whether the bot is allowed to request or perform it.

## Runtime model

```text
                   VESSIE
          governor / coordinator
                    |
          +---------+---------+
          |         |         |
       PhiBot    PhiBot    PhiBot
        Scout     Build     Memory
          |         |         |
          +------ CommonLine -+
                    |
                  PhiOS
                    |
          NBG / Ledger / Gate
```

## Five-stage vessel loop

Every run follows the same semantic seam:

1. **observe** - collect bounded task state
2. **interpret** - map observations to role and capability
3. **propose** - form a candidate action or answer
4. **verify** - check the candidate against evidence and constraints
5. **ledger** - emit a durable receipt

Keeping the seam fixed lets providers change without changing governance.

## Manifest boundary

A manifest declares stable identity, role, provider/model binding, memory scope, capabilities, authority, and escalation policy.

Manifests are configuration, not proof. Runtime checks still enforce boundaries.

## Authority

The bootstrap defines four authority dimensions: `read`, `propose`, `write`, and `deploy`.

Each may be `true`, `false`, or `"gated"`.

The current bootstrap uses `write` as the coarse gate for external actions. Later rungs replace this with explicit action classes and signed grants.

## Ledger

Receipts use `phibot.receipt.v1` and are append-only NDJSON by default. They remain provider-independent.

## Provider seam

`PhiBotAdapter` is the model/provider seam. The first adapter is deterministic and performs no external work. Future adapters can bind Ollama, Vessie, hosted models, or PhiOS services without changing the runtime contract.

## Memory seam

The bootstrap stores only manifest-level memory policy. NBG-backed memory is deferred until its interface explicitly covers scope, provenance, promotion, expiry, cross-bot transfer, and contamination controls.

## CommonLine seam

Inter-bot messages should become typed events rather than hidden prompt injection. CommonLine integration belongs behind a transport interface with sender identity, message type, authority context, and receipt linkage.

## Reality Gate

A gated external action stops before execution and returns an escalation receipt. A later Reality Gate service can turn a gate request into a signed approval, denial, or narrowed grant.
