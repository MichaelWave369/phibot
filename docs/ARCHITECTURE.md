# PhiBot Architecture

## Purpose

PhiBot is the governed micro-agent layer of the Phi ecosystem.

> Capability is not authority.

## Runtime model

```text
                         VESSIE
                     coordinator
                         ▲
                         │ CommonLine
                         │
        ┌────────────────┼────────────────┐
        │                │                │
     ScoutBot         PatchBot        MemoryBot
        │                │                │
        └──── typed messages / handoffs ──┘
                         │
                    NBG packets
                         │
                  nested memory
                         │
 provider → proposal → capability registry
                         │
                  manifest authority
                   /      |      \
                allow    gate    deny
                  │       │
                  │   signed grant
                  └── sandbox
                         │
                       ledger
```

## CommonLine

PhiBots communicate with typed envelopes. Sender identity comes from the manifest, not message input.

Replies preserve thread lineage. Handoffs may include bounded NBG escalation packets. Temporary groups have explicit membership and expiry. Vessie uses a dedicated coordinator address.

The current transport and group stores are in-process reference implementations. Later rungs may bind these seams to the standalone CommonLine service or PhiOS IPC.

## NBG memory

Task bubbles sit inside bot bubbles. Information crosses scopes only through explicit promotion.

## Reality Gate

Gated tool operations use short-lived one-use grants bound to the exact operation.

## Ledger

Reasoning, provider, tool, gate, memory, and CommonLine events share the append-only receipt schema.
