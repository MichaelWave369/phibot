import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PhiBotManifest } from "../src/core/types.js";
import { PhiBotService } from "../src/service/service.js";
import { SpawnGovernor } from "../src/spawn/governor.js";

const helper: PhiBotManifest = {
  id: "helperbot",
  name: "HelperBot",
  version: "1.0.0",
  role: "helper",
  description: "crew helper",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 2 },
  capabilities: [],
  authority: {
    read: true,
    propose: true,
    write: false,
    deploy: false,
  },
  escalation: { target: "vessie", confidenceBelow: 0.5 },
};

test("ephemeral spawn forms crew then expires and dissolves", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-spawn-"));
  let now = Date.parse("2026-10-01T20:00:00.000Z");
  const service = new PhiBotService({ stateDir: root, now: () => now });
  await service.start();
  await service.registerBot(helper);

  try {
    const governor = new SpawnGovernor({
      service,
      secret: "0123456789abcdef",
      now: () => now,
      policy: {
        ephemeralLifetimeMs: 100,
        crewGroupTtlMs: 1_000,
      },
    });

    const proposal = await governor.propose({
      templateId: "research-scout",
      patternKey: "repeat-scout",
      evidence: [0, 1, 2].map((index) => ({
        evidenceId: `s-${index}`,
        patternKey: "repeat-scout",
        observedAt: new Date(now - index).toISOString(),
      })),
      requestedCapabilities: ["repo.read"],
      lifetime: "ephemeral",
      crewMembers: [helper.id],
    });

    const record = await governor.spawn(proposal);

    assert.equal(record.status, "active");
    assert.ok(record.groupId);
    assert.ok(await service.registry.get(record.botId));

    const group = await service.commonLine.groups.get(record.groupId);
    assert.equal(group?.members.includes(helper.id), true);
    assert.equal(group?.members.includes(record.botId), true);
    assert.equal(
      service.events.history().some((event) => event.type === "bot.spawned"),
      true,
    );

    now += 101;
    const swept = await governor.sweepExpired();

    assert.equal(swept.length, 1);
    assert.equal(swept[0]?.status, "dissolved");
    assert.equal(await service.registry.get(record.botId), undefined);
    assert.equal(
      service.events.history().some((event) => event.type === "bot.dissolved"),
      true,
    );

    const stored = await governor.store.get(record.spawnId);
    assert.equal(stored?.status, "dissolved");
  } finally {
    await service.unregisterBot(helper.id);
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});
