# Tool Capability Layer

Rung 2 gives PhiBots governed hands.

## Core rule

A model may **request** a capability. It does not define what that capability means, what arguments are valid, or what authority it requires.

The registry is authoritative.

```text
model proposal
     |
 capability id + input
     |
ToolCapabilityRegistry
     |
 known? ------ no ---> DENY + receipt
     |
 declared by bot? -- no ---> DENY + receipt
     |
 registry-owned action class
     |
manifest authority
   /   |   \
 yes gated no
  |     |    |
sandbox gate deny
  |
execute
  |
receipt
```

## Typed descriptors

Each tool is a `ToolCapability<TInput, TOutput>` with:

- stable capability ID
- description
- registry-owned action class
- external-side-effect flag
- runtime input validator
- typed executor

Example:

```ts
{
  id: "math.add",
  actionClass: "read",
  external: false,
  validate(input) { ... },
  async execute(input, context) { ... }
}
```

## Per-capability arguments

Arguments are validated by the registered capability before execution. Provider output is untrusted data until the capability validator accepts it.

## Action-class authority

The registry maps tools to one of four authority classes:

- `read`
- `propose`
- `write`
- `deploy`

The bot manifest then independently sets each class to:

- `true`
- `false`
- `"gated"`

This prevents a model from relabeling a write tool as a read tool to bypass policy.

## Deny by default

Calls are denied when:

1. the bot manifest does not declare the capability, or
2. the capability has no registered implementation.

There is no permissive unknown-tool fallback.

## Execution sandbox

`ToolSandbox` provides a bounded cooperative execution wrapper:

- structured-cloned input
- timeout
- cancellation signal
- scoped bot ID / run ID context
- no provider authority bypass

This is **not an operating-system security sandbox**. A future PhiOS rung should supply process, filesystem, network, and syscall isolation. Rung 2's sandbox is the runtime boundary around trusted registered tool implementations.

## Receipts

Every tool attempt emits a `stage: "tool"` ledger receipt.

Receipts identify:

- capability
- registry-owned action class
- external-side-effect flag
- status
- denial/gate/failure reason
- duration for successful calls

Raw tool arguments are intentionally not copied into the default receipt, reducing accidental secret leakage.
