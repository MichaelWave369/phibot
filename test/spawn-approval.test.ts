import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PhiBotService } from "../src/service/service.js";
import { SpawnGovernor } from "../src/spawn/governor.js";

test("persistent spawn requires exact signed one-use approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-spawn-"));
  const now = Date.parse("2026-10-01T20:00:00.000Z");
  const service = new PhiBotService({ stateDir: root, now: () => now });
  await service.start();

  try {
    const governor = new SpawnGovernor({
      service,
      secret: "0123456789abcdef",
      now: () => now,
    });

    const proposal = await governor.propose({
      templateId: "research-scout",
      patternKey: "repeat-research",
      evidence: [0, 1, 2].map((index) => ({
        evidenceId: `research-${index}`,
        patternKey: "repeat-research",
        observedAt: new Date(now - index * 1000).toISOString(),
      })),
      requestedCapabilities: ["repo.read"],
      lifetime: "persistent",
    });

    await assert.rejects(
      () => governor.spawn(proposal),
      /requires explicit approval/,
    );

    const approval = await governor.approvePersistent(
      proposal,
      "keep recurring specialist",
    );

    const tampered = {
      ...approval,
      manifestDigest: "tampered",
    };
    await assert.rejects(
      () => governor.spawn(proposal, tampered),
      /signature/,
    );

    const record = await governor.spawn(proposal, approval);
    assert.equal(record.lifetime, "persistent");
    assert.equal(record.approvalId, approval.approvalId);
    assert.equal((await service.registry.get(record.botId)) !== undefined, true);

    await governor.dissolve(record.spawnId, "test cleanup");

    await assert.rejects(
      () => governor.spawn(proposal, approval),
      /replay/,
    );
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});
