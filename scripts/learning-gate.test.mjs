import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  captureFailure, failureSignature, listFailures, proposeLesson,
  replayLesson, validateObservation
} from "./learning-gate.mjs";

function observation(run_id = "run-1", changes = {}) {
  return {
    repo: "MichaelWave369/phibot",
    run_id,
    source_sha: "a".repeat(40),
    layer: "LOOP",
    failure_class: "DUPLICATE_REPAIR_ATTEMPT",
    task_kind: "repo.steward.repair",
    check_id: "test_expired_session",
    expected_code: "TEST_PASS",
    observed_code: "TEST_FAIL",
    evidence_sha256: "b".repeat(64),
    ...changes
  };
}
async function inTemp(fn) {
  const root = await mkdtemp(join(tmpdir(), "phibot-learning-"));
  try { await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("strict input contract excludes raw transcripts, tokens and unrecognized authority", () => {
  const o = observation();
  assert.deepEqual(validateObservation(o), o);
  assert.throws(() => validateObservation({ ...o, raw_log: "Bearer SECRET" }),
    /LG_OBSERVATION_KEYS_INVALID/);
  assert.throws(() => validateObservation({ ...o, approve: true }),
    /LG_OBSERVATION_KEYS_INVALID/);
  assert.throws(() => validateObservation({ ...o, repo: "../private" }),
    /LG_REPO_INVALID/);
  assert.throws(() => validateObservation({ ...o, failure_class: "DO_ANYTHING" }),
    /LG_CLASSIFICATION_INVALID/);
  assert.throws(() => validateObservation({ ...o, expected_code: "TEST_FAIL" }),
    /LG_NO_OBSERVED_GAP/);
  assert.throws(() => validateObservation({ ...o, evidence_sha256: "not verified" }),
    /LG_EVIDENCE_HASH_INVALID/);
});

test("same class and check across commits gets same signature, but different repo does not", () => {
  const one = observation();
  const two = observation("run-2", {
    source_sha: "c".repeat(40), evidence_sha256: "d".repeat(64)
  });
  assert.equal(failureSignature(one), failureSignature(two));
  assert.notEqual(failureSignature(one),
    failureSignature(observation("run-3", { repo: "OtherOwner/Repo" })));
  assert.notEqual(failureSignature(one),
    failureSignature(observation("run-3", { observed_code: "TIMEOUT" })));
});

test("capsules are immutable, idempotent, metadata-only, and list distinct runs", async () => {
  await inTemp(async root => {
    const o = observation();
    const a = await captureFailure(o, root);
    assert.equal(a.status, "CREATED");
    assert.equal((await captureFailure(o, root)).status, "EXISTS_IDENTICAL");
    const b = await captureFailure(observation("run-2", {
      evidence_sha256: "d".repeat(64)
    }), root);
    assert.equal(a.signature, b.signature);
    assert.notEqual(a.capsule_id, b.capsule_id);
    const contents = await readFile(join(root, "capsules", a.capsule_id + ".json"), "utf8");
    assert.equal(contents.includes("raw_log"), false);
    assert.equal(contents.includes("Bearer"), false);
    const listing = await listFailures(root);
    assert.equal(listing.total, 2);
    assert.equal(listing.signatures[0].distinct_runs, 2);
  });
});

test("proposal requires two separate runs and never promotes itself", async () => {
  await inTemp(async root => {
    const a = await captureFailure(observation(), root);
    await assert.rejects(proposeLesson(a.signature, root),
      /LG_NEEDS_TWO_DISTINCT_RUNS/);
    await captureFailure(observation("run-1", { evidence_sha256: "e".repeat(64) }), root);
    await assert.rejects(proposeLesson(a.signature, root),
      /LG_NEEDS_TWO_DISTINCT_RUNS/);
    await captureFailure(observation("run-2", {
      source_sha: "c".repeat(40), evidence_sha256: "d".repeat(64)
    }), root);
    const p = await proposeLesson(a.signature, root);
    assert.equal(p.status, "CREATED");
    assert.equal(p.distinct_runs, 2);
    assert.equal(p.mode, "REVIEW_ONLY_NO_ENFORCEMENT");
    assert.equal((await proposeLesson(a.signature, root)).status, "EXISTS_IDENTICAL");
    const replay = await replayLesson(p.proposal_id, observation("run-3"), root);
    assert.deepEqual({
      status: replay.status, simulated: replay.simulated, enforced: replay.enforced,
      grants: replay.grants, github_writes: replay.github_writes
    }, {
      status: "MATCH_STOP_RETRY_ADVISORY", simulated: true,
      enforced: false, grants: 0, github_writes: 0
    });
    assert.equal((await replayLesson(p.proposal_id,
      observation("run-3", { observed_code: "TIMEOUT" }), root)).status, "NO_MATCH");
    const content = JSON.parse(await readFile(join(root, "proposals",
      p.proposal_id + ".json"), "utf8"));
    assert.deepEqual(content.rule, {
      trigger: "REPEATED_FAILURE_SIGNATURE", effect: "STOP_RETRY_ADVISORY"
    });
  });
});

test("tampered capsule or proposal fails closed before any replay result", async () => {
  await inTemp(async root => {
    const a = await captureFailure(observation(), root);
    const file = join(root, "capsules", a.capsule_id + ".json");
    const original = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...original, signature: "f".repeat(64) }));
    await assert.rejects(listFailures(root), /LG_CAPSULE_INTEGRITY_FAILED/);
    await assert.rejects(captureFailure(observation(), root),
      /LG_IDENTITY_COLLISION_OR_TAMPER/);
  });
  await inTemp(async root => {
    const a = await captureFailure(observation(), root);
    await captureFailure(observation("run-2"), root);
    const p = await proposeLesson(a.signature, root);
    const file = join(root, "proposals", p.proposal_id + ".json");
    const original = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({
      ...original, rule: { trigger: "REPEATED_FAILURE_SIGNATURE", effect: "AUTO_MERGE" }
    }));
    await assert.rejects(replayLesson(p.proposal_id, observation("run-3"), root),
      /LG_RULE_UNSUPPORTED/);
  });
});

test("missing supporting capsule blocks replay and no evidence can be invented", async () => {
  await inTemp(async root => {
    const a = await captureFailure(observation(), root);
    const b = await captureFailure(observation("run-2"), root);
    const p = await proposeLesson(a.signature, root);
    await rm(join(root, "capsules", b.capsule_id + ".json"));
    await assert.rejects(replayLesson(p.proposal_id, observation("run-3"), root),
      /LG_EVIDENCE_MISSING_OR_NOT_INDEPENDENT/);
  });
});

test("operator CLI runs offline and rejects extra arguments", async () => {
  await inTemp(async root => {
    const inFile = join(root, "input.json");
    await writeFile(inFile, JSON.stringify(observation()));
    const script = new URL("./learning-gate.mjs", import.meta.url).pathname;
    const env = { ...process.env, PHIBOT_LEARNING_HOME: join(root, "store") };
    const output = JSON.parse(execFileSync(process.execPath,
      [script, "capture", inFile], { encoding: "utf8", env }));
    assert.equal(output.status, "CREATED");
    const list = JSON.parse(execFileSync(process.execPath,
      [script, "list"], { encoding: "utf8", env }));
    assert.equal(list.total, 1);
    assert.throws(() => execFileSync(process.execPath,
      [script, "list", "unexpected"], { encoding: "utf8", env, stdio: "pipe" }));
  });
});
