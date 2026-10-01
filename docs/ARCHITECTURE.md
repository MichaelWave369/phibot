# PhiBot Architecture

## Purpose

PhiBot is the governed micro-agent layer of the Phi ecosystem. A PhiBot should be small enough to understand, replace, audit, and route cheaply.

The architecture starts from one rule:

> Capability is not authority.

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

Inside one PhiBot:

```text
manifest
   |
runtime -> provider adapter -> provider registry -> Ollama
   |                              |
   |                              +--> deterministic fallback
   |
tool request -> capability registry
                    |
             registry-owned
              action class
                    |
                authority
               /    |    \
           execute gate  deny
              |
           sandbox
              |
            ledger
```

## Five-stage vessel loop

Every reasoning run follows:

1. **observe**
2. **interpret**
3. **propose**
4. **verify**
5. **ledger**

Tool execution is separately receipted as `stage: "tool"`.

## Authority

The manifest contains four authority classes:

- `read`
- `propose`
- `write`
- `deploy`

Each is `true`, `false`, or `"gated"`.

For registered tools, the **registry owns the action class**. Model output cannot override it.

## Provider seam

Providers supply structured candidate reasoning. They do not grant tool or external-action authority.

## Tool seam

A `ToolCapabilityRegistry` stores typed descriptors. `ToolExecutor` requires both declaration in the bot manifest and registration in the local registry. Unknown tools are denied by default.

`ToolSandbox` applies a timeout, cancellation signal, cloned input, and scoped execution context. It is a cooperative runtime boundary, not OS isolation. PhiOS process isolation belongs to a later rung.

## Ledger

Receipts use `phibot.receipt.v1` and remain provider-independent. Provider and tool metadata are attached to receipts rather than trusted as hidden runtime state.

## Memory seam

NBG-backed memory remains deferred until its interface explicitly covers scope, provenance, promotion, expiry, cross-bot transfer, and contamination controls.

## CommonLine seam

Inter-bot messages should become typed events rather than hidden prompt injection.

## Reality Gate

A gated action stops before execution. Rung 3 will add explicit approval objects, narrowed grants, signatures, expiry, and replay protection.
