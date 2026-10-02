import assert from "node:assert/strict";
import test from "node:test";
import { CommonLine } from "../src/commonline/commonline.js";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";

function manifest(id: string, role: string): PhiBotManifest {
  return {
    id,
    name: id,
    version: "0.6.0",
    role,
    description: "CommonLine fixture",
    model: { provider: "dry-run", name: "deterministic" },
    memory: { scope: "task", maxDepth: 4 },
    capabilities: [],
    authority: {
      read: true,
      propose: true,
      write: false,
      deploy: false,
    },
    escalation: { target: "vessie", confidenceBelow: 0.5 },
  };
}

test("sender identity comes from manifest and reply preserves thread", async () => {
  const line = new CommonLine({ ledger: new MemoryLedger() });
  const scout = manifest("scoutbot", "research");
  const patch = manifest("patchbot", "repair");

  const first = await line.send(
    scout,
    { to: patch.id, text: "I found the failing file." },
    "run-send",
  );

  assert.equal(first.sender.botId, scout.id);
  assert.equal(first.sender.role, "research");
  assert.equal(first.recipients[0]?.kind, "bot");

  const reply = await line.reply(
    patch,
    first.messageId,
    "Send me the failure details.",
    "run-reply",
  );

  assert.equal(reply.kind, "reply");
  assert.equal(reply.threadId, first.threadId);
  assert.equal(reply.replyTo, first.messageId);
  assert.deepEqual(reply.recipients, [{ kind: "bot", id: scout.id }]);

  const thread = await line.transport.listThread(first.threadId);
  assert.deepEqual(
    thread.map((message) => message.messageId),
    [first.messageId, reply.messageId],
  );
});

test("handoff can carry sender-owned NBG memory packet", async () => {
  const line = new CommonLine({ ledger: new MemoryLedger() });
  const scout = manifest("scoutbot", "research");

  const handoff = await line.handoff(
    scout,
    {
      to: "patchbot",
      text: "Take over this repair.",
      memoryPacket: {
        schema: "phibot.memory.escalation.v1",
        packetId: "packet-1",
        target: "vessie",
        botId: scout.id,
        taskId: "task-1",
        createdAt: "2026-10-01T00:00:00.000Z",
        records: [],
      },
    },
    "run-handoff",
  );

  assert.equal(handoff.kind, "handoff");
  assert.equal(handoff.payload.memoryPacket?.packetId, "packet-1");

  await assert.rejects(
    () =>
      line.handoff(
        scout,
        {
          to: "patchbot",
          text: "spoofed",
          memoryPacket: {
            schema: "phibot.memory.escalation.v1",
            packetId: "packet-bad",
            target: "vessie",
            botId: "some-other-bot",
            taskId: "task-1",
            createdAt: "2026-10-01T00:00:00.000Z",
            records: [],
          },
        },
      ),
    /sender/,
  );
});

test("Vessie coordinator channel validates packet target and receipts escalation", async () => {
  const ledger = new MemoryLedger();
  const line = new CommonLine({ ledger });
  const scout = manifest("scoutbot", "research");

  const message = await line.sendToVessie(
    scout,
    {
      text: "Need coordinator review.",
      memoryPacket: {
        schema: "phibot.memory.escalation.v1",
        packetId: "packet-v",
        target: "vessie",
        botId: scout.id,
        taskId: "task-v",
        createdAt: "2026-10-01T00:00:00.000Z",
        records: [],
      },
    },
    "run-vessie",
  );

  assert.equal(message.kind, "coordinator");
  assert.deepEqual(message.recipients, [
    { kind: "coordinator", id: "vessie" },
  ]);
  assert.equal(ledger.receipts.at(-1)?.status, "escalate");

  await assert.rejects(
    () =>
      line.sendToVessie(scout, {
        text: "wrong target",
        memoryPacket: {
          schema: "phibot.memory.escalation.v1",
          packetId: "packet-wrong",
          target: "not-vessie",
          botId: scout.id,
          taskId: "task-v",
          createdAt: "2026-10-01T00:00:00.000Z",
          records: [],
        },
      }),
    /target/,
  );
});
