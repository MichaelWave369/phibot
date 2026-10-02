import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PhiBotService } from "../src/service/service.js";
import { SpawnGovernor } from "../src/spawn/governor.js";

function evidence(now: number, count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    evidenceId: `e-${index}`,
    patternKey: "repeat-repo-repair",
    observedAt: new Date(now - index * 1000).toISOString(),
    taskRef: `task-${index}`,
  }));
}

test("requires recurring evidence and derives least authority", async () => {
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

    await assert.rejects(
      () =>
        governor.propose({
          templateId: "code-repair",
          patternKey: "repeat-repo-repair",
          evidence: evidence(now, 2),
          requestedCapabilities: ["repo.read"],
          lifetime: "ephemeral",
        }),
      /at least 3/,
    );

    const proposal = await governor.propose({
      templateId: "code-repair",
      patternKey: "repeat-repo-repair",
      evidence: evidence(now),
      requestedCapabilities: ["repo.read"],
      lifetime: "ephemeral",
    });

    assert.deepEqual(proposal.manifest.capabilities, ["repo.read"]);
    assert.equal(proposal.manifest.authority.read, true);
    assert.equal(proposal.manifest.authority.propose, true);
    assert.equal(proposal.manifest.authority.write, false);
    assert.equal(proposal.manifest.authority.deploy, false);

    const withWrite = await governor.propose({
      templateId: "code-repair",
      patternKey: "repeat-repo-repair",
      evidence: evidence(now),
      requestedCapabilities: ["repo.patch", "repo.read"],
      lifetime: "ephemeral",
    });

    assert.equal(withWrite.manifest.authority.write, "gated");
    assert.equal(withWrite.manifest.authority.deploy, false);
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});
