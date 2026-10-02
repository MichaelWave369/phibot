import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PhiBotManifest } from "../src/core/types.js";
import { PhiBotService } from "../src/service/service.js";

const manifest: PhiBotManifest = {
  id: "servicebot",
  name: "ServiceBot",
  version: "0.7.0",
  role: "service_test",
  description: "service fixture",
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

test("service persists registry and tracks run state/events", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-service-"));

  try {
    const service = new PhiBotService({
      stateDir: root,
      budgets: {
        maxConcurrentRuns: 1,
        maxRunsPerWindow: 10,
        windowMs: 60_000,
        maxProviderTokensPerRun: 20,
        maxToolCallsPerRun: 5,
      },
    });

    await service.start();
    await service.registerBot(manifest);

    const run = await service.beginRun(manifest.id, "service-run");
    assert.equal(run.runId, "service-run");

    await service.recordProviderTokens(run.runId, 7);
    await service.recordToolCall(run.runId, 2);

    let snapshot = await service.snapshot();
    assert.equal(snapshot.lifecycle, "running");
    assert.equal(snapshot.bots[0]?.state, "running");
    assert.equal(snapshot.activeRuns[0]?.providerTokens, 7);
    assert.equal(snapshot.activeRuns[0]?.toolCalls, 2);

    const finished = await service.finishRun(run.runId);
    assert.equal(finished.providerTokens, 7);

    snapshot = await service.snapshot();
    assert.equal(snapshot.bots[0]?.state, "idle");
    assert.equal(snapshot.activeRuns.length, 0);
    assert.equal(
      service.events.history().some((event) => event.type === "run.finished"),
      true,
    );

    await service.stop();

    const reopened = new PhiBotService({ stateDir: root });
    await reopened.start();
    assert.equal((await reopened.snapshot()).bots[0]?.manifest.id, manifest.id);
    await reopened.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
