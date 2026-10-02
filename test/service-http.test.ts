import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startPhiBotHttpServer } from "../src/service/http.js";
import { PhiBotService } from "../src/service/service.js";

test("HTTP surface is loopback-only and exposes read-only health", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-http-"));
  const service = new PhiBotService({ stateDir: root });
  await service.start();

  try {
    await assert.rejects(
      () =>
        startPhiBotHttpServer(service, {
          host: "0.0.0.0",
          port: 0,
        }),
      /loopback-only/,
    );

    const server = await startPhiBotHttpServer(service, {
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/health`,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok: boolean };
      assert.equal(body.ok, true);

      const mutation = await fetch(
        `http://127.0.0.1:${address.port}/bots`,
        { method: "POST" },
      );
      assert.equal(mutation.status, 404);
    } finally {
      await new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise()),
      );
    }
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});
