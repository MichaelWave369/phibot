# Reality Gate

Rung 3 turns the manifest value `"gated"` into an explicit authorization protocol.

## Goal

A PhiBot may request a gated operation without receiving standing permission to perform that class of operation later.

A Reality Grant is deliberately narrow.

It binds approval to:

- one bot ID
- one run ID
- one capability
- one registry-owned authority class
- one exact canonical input digest
- one expiration time
- one use

## Flow

```text
ToolExecutor
    |
manifest says "gated"
    |
RealityGate.createRequest()
    |
GateRequest + receipt
    |
human / governor decision
    |
+----------+-----------+
|          |           |
deny     approve      narrow
|          |           |
stop     signed       signed
        grant         shorter-lived grant
           \          /
            verify
              |
     signature valid?
     not expired?
     same run/bot/tool/class/input?
     unused grant?
              |
           execute
```

## Request

A `phibot.gate.request.v1` contains identity and the SHA-256 digest of the exact canonical tool input. Raw arguments are not copied into the default ledger receipt.

## Decisions

- **deny**: no grant is created.
- **approve**: issues a one-use grant with the configured TTL.
- **narrow**: issues the same narrowly bound grant but requires a TTL shorter than the default approval TTL.

Rung 3 does not support widening. A decision cannot swap the bot, tool, run, authority class, or input digest.

## Signed grants

Grants use HMAC-SHA-256 over canonical JSON.

The signing secret:

- must be at least 16 characters
- is never written to receipts
- should come from a secret store or environment at deployment time
- must not be committed to the repository

A later PhiOS integration can replace the local HMAC signer with platform-backed keys without changing the gate contract.

## Replay protection

Every grant has `maxUses: 1`.

`ReplayStore.consume(grantId)` atomically decides whether the current runtime has already consumed a grant. The default implementation is in-memory.

The interface is intentionally separate so PhiOS can later provide a durable or distributed replay store.

## Receipt chain

Gate events use `stage: "gate"`.

The ledger records:

1. request created
2. decision issued or denied
3. grant accepted or rejected
4. final tool execution result

IDs link the chain without copying raw tool arguments or signing secrets into receipts.

## Important limitation

The default replay store is process-local. Restarting the process clears it.

That is acceptable for this rung's local runtime contract, but durable PhiOS service mode should provide persistent replay state before grants are used across process boundaries.
