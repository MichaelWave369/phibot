import assert from "node:assert/strict";
import test from "node:test";
import { CommonLine } from "../src/commonline/commonline.js";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";

function manifest(id: string): PhiBotManifest {
  return {
    id,
    name: id,
    version: "0.6.0",
    role: "fixture",
    description: "group fixture",
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

test("temporary groups enforce membership, expiry, and owner dissolution", async () => {
  let now = 1_000_000;
  const line = new CommonLine({
    ledger: new MemoryLedger(),
    now: () => now,
    defaultGroupTtlMs: 100,
    maxGroupTtlMs: 1_000,
  });

  const scout = manifest("scoutbot");
  const patch = manifest("patchbot");
  const stranger = manifest("strangerbot");

  const group = await line.createGroup(
    scout,
    {
      name: "repair-cell",
      members: [patch.id, patch.id],
    },
    "run-group",
  );

  assert.deepEqual(group.members, [patch.id, scout.id].sort());

  const message = await line.sendToGroup(
    patch,
    {
      groupId: group.groupId,
      text: "Patch is ready.",
    },
    "run-group-send",
  );

  assert.deepEqual(message.recipients, [
    { kind: "group", id: group.groupId },
  ]);

  await assert.rejects(
    () =>
      line.sendToGroup(stranger, {
        groupId: group.groupId,
        text: "let me in",
      }),
    /not a member/,
  );

  await assert.rejects(
    () => line.dissolveGroup(patch, group.groupId),
    /owner/,
  );

  now += 101;

  await assert.rejects(
    () =>
      line.sendToGroup(scout, {
        groupId: group.groupId,
        text: "too late",
      }),
    /expired/,
  );
});

test("owner can dissolve a live group", async () => {
  const line = new CommonLine({ ledger: new MemoryLedger() });
  const scout = manifest("scoutbot");

  const group = await line.createGroup(scout, {
    name: "short-cell",
    members: [],
  });

  assert.equal(await line.dissolveGroup(scout, group.groupId), true);
  assert.equal(await line.groups.get(group.groupId), undefined);
});
