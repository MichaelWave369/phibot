import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFieldQualification } from "../src/qualification/runner.js";

test("failed Ollama preflight writes a hashed FAIL record without running acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-preflight-"));

  try {
    const fetchImpl = (async () =>
      new Response("offline", { status: 503 })) as typeof fetch;

    const result = await runFieldQualification({
      outputDir: root,
      mode: "ollama",
      fetchImpl,
      sourceCommit: "preflight-test",
    });

    assert.equal(result.record.status, "FAIL");
    assert.equal(result.record.preflight.passed, false);
    assert.equal(
      result.record.failure?.name,
      "QualificationPreflightError",
    );
    assert.equal(result.record.acceptance, undefined);
    assert.equal(result.record.artifacts.length, 0);
    assert.equal(result.recordSha256.length, 64);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
