# PhiBot Architecture

## Purpose

PhiBot is the governed micro-agent layer of the Phi ecosystem. A PhiBot should be small enough to understand, replace, audit, and route cheaply.

> Capability is not authority.

## Runtime model

```text
                   VESSIE
          governor / coordinator
                    |
          +---------+---------+
          |         |         |
       PhiBot    PhiBot    PhiBot
          |         |         |
          +------ CommonLine -+
                    |
                  PhiOS
                    |
          NBG / Ledger / Gate
```

Inside one PhiBot:

```text
provider -> propose
              |
         capability registry
              |
       registry action class
              |
        manifest authority
         /      |       \
      allow    gate     deny
        |       |
        |    GateRequest
        |       |
        |   decision
        |    / | \
        | deny | narrow
        |      |
        |   signed grant
        |      |
        +-- verification
              |
           sandbox
              |
            ledger
```

## Authority

The manifest contains `read`, `propose`, `write`, and `deploy`. The tool registry owns the action class for every registered capability.

## Reality Gate

A gated authority class does not execute directly.

The gate creates a request bound to the exact tool input digest. An approval produces a short-lived, signed, one-use grant. Verification checks signature, expiry, bot, run, capability, action class, input digest, and replay status before execution.

This means approval cannot silently become standing authority.

## Ledger

Reasoning, provider, gate, and tool events share the append-only receipt schema. Gate request, decision, verification, and tool execution IDs form an auditable chain.

## Security boundary

The current tool sandbox is cooperative and the default replay store is process-local. PhiOS service mode is expected to supply stronger process isolation, key custody, and durable replay state.
