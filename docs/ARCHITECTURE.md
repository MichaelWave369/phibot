# PhiBot Architecture

## Purpose

PhiBot is the governed micro-agent layer of the Phi ecosystem.

> Capability is not authority.

## Hosted shape

```text
                       PhiOS
                         │
                  PhiBot Service
        ┌────────────────┼────────────────┐
        │                │                │
   bot registry      budgets/events    durable state
        │                │                │
        │                │        replay / memory /
        │                │          CommonLine
        │                │
     PhiBots ─────── CommonLine ─────── Vessie
        │
   NBG memory
        │
 capability registry
        │
 Reality Gate
        │
      tools
        │
      ledger
```

## Service boundary

Rung 6 introduces a local service wrapper with persistent bot registration, resource accounting, UI-facing status events, durable local state adapters, and a loopback-only status API.

The service does not claim to replace PhiOS process isolation. Instead, it exposes stable seams PhiOS can wrap with native cgroups, namespaces, IPC, key custody, and stronger persistence.

## Durable seams

Filesystem implementations now exist for:

- Reality Gate replay state
- NBG memory
- CommonLine messages
- CommonLine groups

All implement the interfaces established in earlier rungs.

## Resource budgets

Budgets constrain run concurrency/rate, provider tokens, and tool calls. They are runtime orchestration controls, not kernel resource controls.

## HTTP

The service HTTP surface is read-only and loopback-only in this rung.
