# CommonLine

Rung 5 gives PhiBots a typed inter-agent communication seam.

## Goals

CommonLine should let bots collaborate without turning messages into invisible prompt injection or allowing callers to impersonate another agent.

## Identity

Sender identity is derived from the sending `PhiBotManifest`:

- bot ID
- bot version
- role

Callers do not supply arbitrary sender identities.

## Envelope

Every message uses `phibot.commonline.message.v1` and contains:

- message ID
- thread ID
- message kind
- manifest-derived sender
- typed recipients
- creation time
- optional reply link
- optional handoff link
- payload
- optional bounded NBG memory escalation packet

## Message kinds

- `message` — ordinary bot-to-bot or group message
- `reply` — continues the exact parent thread and links `replyTo`
- `handoff` — transfers work and may attach an NBG memory packet
- `coordinator` — sends a message to Vessie

## Handoffs

A handoff may include `phibot.memory.escalation.v1`.

CommonLine verifies that the packet's `botId` matches the sending manifest. The receiving bot gets the bounded memory packet as explicit data rather than ambient hidden context.

## Vessie coordinator channel

Vessie is represented by:

```json
{ "kind": "coordinator", "id": "vessie" }
```

A memory packet sent through the coordinator channel must also target Vessie.

Coordinator publications produce an `escalate` ledger receipt.

## Replies

Replies fetch the original message from the transport and preserve its thread ID. The reply recipient is derived from the original sender.

This prevents a caller from fabricating a reply chain.

## Temporary groups

Groups are explicit objects with:

- owner bot
- member list
- creation time
- expiration time

The creator is automatically a member.

Only members may publish to the group. Only the owner may dissolve it. Expired groups reject publication.

Default lifetime: 30 minutes.

Maximum lifetime: 24 hours.

## Transport seam

`CommonLineTransport` defines:

- publish
- get
- list thread
- list messages for bot

Rung 5 ships with an in-memory transport. The seam is ready for the actual CommonLine service, PhiOS IPC, WebSocket, local sockets, or another durable transport later.

## Ledger

CommonLine events use `stage: "message"`.

Receipts record message IDs, thread IDs, recipient addresses, reply/handoff links, group events, and optional memory-packet IDs.

Message text and arbitrary payload data are intentionally not copied into the default ledger receipt.
