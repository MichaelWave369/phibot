# PhiBot Architecture

## Purpose

PhiBot is the governed micro-agent layer of the Phi ecosystem.

> Capability is not authority.

## Full governed crew shape

```text
                         VESSIE
                    coordinator / governor
                           |
                 recurring-pattern evidence
                           |
                    spawn proposal
                           |
                least-authority template
                           |
              +------------+------------+
              |                         |
          ephemeral                  persistent
              |                         |
              |                  signed approval
              +------------+------------+
                           |
                       PhiOS Service
                           |
                 registered PhiBot crew
               /           |           \
          ScoutBot      PatchBot      MemoryBot
               \          |          /
                    CommonLine
                         |
                     NBG memory
                         |
                    Reality Gate
                         |
                   governed tools
                         |
                       ledger
```

## Spawning

Rung 7 adds governed specialization.

A proposal requires recurring-pattern evidence. Templates constrain capabilities and authority ceilings. The generated manifest receives only the requested capability subset and the authority classes those capabilities require.

Ephemeral bots expire and can be swept automatically. Persistent bots require a signed, short-lived, one-use approval bound to the exact manifest digest.

Spawned bots form temporary CommonLine crews and notify Vessie through the coordinator channel.

## Service boundary

The PhiBot service persists registry, memory, replay state, CommonLine state, spawn records, and ledger receipts. PhiOS-native isolation and key custody remain platform responsibilities.
