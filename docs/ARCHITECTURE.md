# PhiBot Architecture

## Purpose

PhiBot is the governed micro-agent layer of the Phi ecosystem.

> Capability is not authority.

## Runtime model

```text
                   VESSIE
          governor / coordinator
                    ▲
          escalation packet
                    │
               Bot Bubble
              /    |    \
        Task A   Task B   promoted memory
           │
         PhiBot
           │
 provider -> proposal -> capability registry
                         │
                  manifest authority
                    /    |    \
                 allow  gate  deny
                   │      │
                   │  signed grant
                   └── sandbox
                         │
                       ledger
```

## NBG memory

Memory is nested by scope.

A task bubble is the inner working context. A bot bubble is the parent persistent context. Information crosses that boundary only through explicit promotion rules.

Each record has provenance, content digest, salience, confidence, TTL, and bubble identity.

Retrieval walks outward from current task to bot scope. Escalation to Vessie sends a bounded provenance-preserving packet rather than dumping the entire store.

## Compaction

Compaction removes expired, duplicate, and excess records deterministically. It never asks a model to rewrite historical records.

## Storage boundary

The current memory store is in-process. The `MemoryStore` interface is the seam for later PhiOS-backed persistence and vector/graph indexing.

## Reality Gate

Gated tool operations use one-use signed grants bound to the exact operation.

## Ledger

Reasoning, provider, gate, tool, and memory events share the append-only receipt schema.
