import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommonLineEnvelope, CommonLineGroup } from "../src/commonline/types.js";
import type { MemoryRecord } from "../src/memory/types.js";
import {
  FileCommonLineGroupStore,
  FileCommonLineTransport,
  FileMemoryStore,
  FileReplayStore,
} from "../src/service/persistence.js";

test("durable adapters survive fresh instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-service-"));

  try {
    const replayPath = join(root, "replay.ndjson");
    const firstReplay = new FileReplayStore(replayPath);
    assert.equal(await firstReplay.consume("grant-1"), true);

    const secondReplay = new FileReplayStore(replayPath);
    assert.equal(await secondReplay.consume("grant-1"), false);

    const memory: MemoryRecord = {
      schema: "phibot.memory.v1",
      memoryId: "memory-1",
      bubbleId: "bot:bot-a",
      botId: "bot-a",
      scope: "bot",
      content: "persistent memory",
      contentDigest: "digest",
      tags: [],
      salience: 0.8,
      confidence: 0.9,
      createdAt: "2026-10-01T00:00:00.000Z",
      provenance: {
        source: { kind: "system" },
        parents: [],
      },
    };

    const firstMemory = new FileMemoryStore(join(root, "memory"));
    await firstMemory.put(memory);
    const secondMemory = new FileMemoryStore(join(root, "memory"));
    assert.equal((await secondMemory.get("memory-1"))?.content, "persistent memory");

    const message: CommonLineEnvelope = {
      schema: "phibot.commonline.message.v1",
      messageId: "message-1",
      threadId: "thread-1",
      kind: "message",
      sender: {
        kind: "bot",
        botId: "bot-a",
        botVersion: "1",
        role: "test",
      },
      recipients: [{ kind: "bot", id: "bot-b" }],
      createdAt: "2026-10-01T00:00:00.000Z",
      payload: { text: "hello" },
    };

    const firstTransport = new FileCommonLineTransport(join(root, "messages"));
    await firstTransport.publish(message);
    const secondTransport = new FileCommonLineTransport(join(root, "messages"));
    assert.equal((await secondTransport.get("message-1"))?.threadId, "thread-1");

    const group: CommonLineGroup = {
      schema: "phibot.commonline.group.v1",
      groupId: "group-1",
      name: "test",
      ownerBotId: "bot-a",
      members: ["bot-a", "bot-b"],
      createdAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2026-10-02T00:00:00.000Z",
    };

    const firstGroups = new FileCommonLineGroupStore(join(root, "groups"));
    await firstGroups.put(group);
    const secondGroups = new FileCommonLineGroupStore(join(root, "groups"));
    assert.equal((await secondGroups.get("group-1"))?.name, "test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
