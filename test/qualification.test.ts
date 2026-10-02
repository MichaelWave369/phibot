import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFieldQualification } from "../src/qualification/runner.js";

test("qualification emits hashed PASS evidence for full deterministic lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-qualification-"));

  try {
    const result = await runFieldQualification({
      outputDir: root,
      mode: "deterministic",
      sourceCommit: "test-commit",
    });

    assert.equal(result.record.status, "PASS");
    assert.equal(result.record.acceptance?.passed, true);
    assert.equal(
      result.record.environment.sourceCommit,
      "test-commit",
    );
    assert.equal(result.record.artifacts.length > 0, true);
    assert.equal(
      result.record.artifacts.some(
        (artifact) => artifact.path === "ledger.ndjson",
      ),
      true,
    );

    const recordBytes = await readFile(result.recordPath);
    const digest = createHash("sha256")
      .update(recordBytes)
      .digest("hex");
    assert.equal(result.recordSha256, digest);

    const digestText = await readFile(result.digestPath, "utf8");
    assert.equal(
      digestText,
      `${digest}  qualification.json\n`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("qualification refuses a non-empty output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "phibot-qualification-"));

  try {
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(join(root, "existing.txt"), "do not overwrite"),
    );

    await assert.rejects(
      () =>
        runFieldQualification({
          outputDir: root,
          mode: "deterministic",
        }),
      /must be empty/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
