import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { QualificationPreflight } from "../src/qualification/types.js";
import { runQualificationDoctor } from "../src/qualification/doctor.js";
import {
  runCrewReadiness, readCrewReadiness, verifyReadinessRecord,
  validateCrewProbeInput,
} from "../src/qualification/crew-readiness.js";

const MODEL = "qwen3:4b";
const AT = new Date("2026-11-06T18:00:00.000Z");
const CHECK_NAMES = ["node.version", "ollama.reachable", "ollama.model", "ollama.inference"];

const success: QualificationPreflight = {
  schema: "phibot.qualification.preflight.v1",
  checkedAt: AT.toISOString(),
  providerMode: "ollama",
  requiredModel: MODEL,
  availableModels: [MODEL],
  checks: CHECK_NAMES.map(name => ({
    name, status: "pass" as const, detail: "fixture",
  })),
  passed: true, inferenceLatencyMs: 3142, inferenceAttempts: 1,
};
async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "phibot-36-"));
  try { await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const now = () => new Date(AT.getTime());
const doctor = async (): Promise<QualificationPreflight> => success;

test("manual readiness runs exact Ollama provider contract and writes immutable PASS", async () => {
  await withDir(async dir => {
    let opts: Parameters<typeof runQualificationDoctor>[0] | undefined;
    const probe = await runCrewReadiness({
      model: MODEL, port: 11434, timeoutMs: 5000, dir, now,
      doctor: async input => { opts = input; return success; },
    });
    assert.deepEqual(opts, {
      mode: "ollama", requiredModel: MODEL,
      ollamaHost: "http://127.0.0.1:11434",
      timeoutMs: 2500, inferenceTimeoutMs: 5000,
      strictModelIdentity: true,
    });
    assert.equal(probe.record.status, "PASS");
    assert.equal(probe.record.source, "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED");
    assert.equal(probe.record.strictModelEcho, true);
    assert.equal(probe.record.inferenceLatencyMs, 3142);
    assert.equal(verifyReadinessRecord(probe.record).digest, probe.record.digest);
    assert.equal((await readdir(dir)).length, 1);
    const saved = JSON.parse(await readFile(probe.path, "utf8")) as unknown;
    assert.deepEqual(saved, probe.record);
    const view = await readCrewReadiness({ dir, now: () => AT.getTime() });
    assert.equal(view.records[0]?.status, "RECENT_PROBE_PASS_SELF_REPORT");
    assert.equal(view.records[0]?.model, MODEL);
    assert.equal(view.records[0]?.ollamaPort, 11434);
    assert.equal(view.classification, "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED");
    const stale = await readCrewReadiness({ dir, now: () => AT.getTime() + 3600001 });
    assert.equal(stale.records[0]?.status, "STALE_PROBE");
  });
});

test("failed and throwing probes retain explicit FAIL self-report, never qualify", async () => {
  await withDir(async dir => {
    const fail = await runCrewReadiness({
      model: MODEL, dir, now,
      doctor: async () => ({
        ...success, passed: false,
        checks: success.checks.map(c => c.name === "ollama.inference"
          ? { ...c, status: "fail" as const, detail: "SECRET_NEVER_EXPORT" } : c),
      }),
    });
    assert.equal(fail.record.status, "FAIL");
    assert.ok(!JSON.stringify(fail.record).includes("SECRET_NEVER_EXPORT"));
    const thrown = await runCrewReadiness({
      model: "gemma3:12b", dir, now,
      doctor: async () => { throw new Error("SECRET_LOCAL_PROVIDER_DATA"); },
    });
    assert.equal(thrown.record.status, "FAIL");
    assert.ok(!JSON.stringify(thrown.record).includes("SECRET_LOCAL_PROVIDER_DATA"));
    const view = await readCrewReadiness({ dir, now: () => AT.getTime() });
    assert.equal(view.records.length, 2);
    assert.ok(view.records.every(r => r.status === "FAILED_PROBE"));
  });
});

test("missing, malformed, tampered, and unsupported pass receipts fail closed", async () => {
  await withDir(async dir => {
    const empty = await readCrewReadiness({ dir });
    assert.deepEqual(empty.records, []);
    const record = (await runCrewReadiness({ model: MODEL, dir, now, doctor })).record;
    assert.throws(() => verifyReadinessRecord({
      ...record, model: "other:7b",
    }), /CREW_READINESS_DIGEST_MISMATCH/);
    assert.throws(() => verifyReadinessRecord({
      ...record, authority: { deploy: true },
    }), /CREW_READINESS_SCHEMA_INVALID/);
    assert.throws(() => verifyReadinessRecord({
      ...record, inferenceAttempts: null,
    }), /CREW_READINESS_DIGEST_MISMATCH/);
    assert.throws(() => verifyReadinessRecord({
      ...record, inferenceAttempts: null,
      digest: "0".repeat(64),
    }), /CREW_READINESS_DIGEST_MISMATCH/);
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    const file = join(dir, files[0] as string);
    await writeFile(file, JSON.stringify({ ...record, model: "poison:7b" }));
    await assert.rejects(readCrewReadiness({ dir }),
      /CREW_READINESS_DIGEST_MISMATCH/);
  });
});

test("probe input is bounded and invalid inputs make no network requests", async () => {
  for (const [model, port, timeout] of [
    ["<script>", 11434, 90000],
    [MODEL, 65536, 90000],
    [MODEL, -1, 90000],
    [MODEL, 11434, 1000],
    [MODEL, 11434, 999999],
  ] as Array<[string, number, number]>) {
    assert.throws(() => validateCrewProbeInput(model, port, timeout));
  }
  await withDir(async dir => {
    await assert.rejects(runCrewReadiness({
      model: "bad model", dir,
      doctor: async () => { throw new Error("SHOULD_NOT_CALL"); },
    }), /CREW_PROBE_MODEL_INVALID/);
    assert.deepEqual(await readdir(dir), []);
  });
});

test("strict model echo fails a representative, schema-valid impostor response", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    if (url.endsWith("/api/version")) return json({ version: "mock" });
    if (url.endsWith("/api/tags")) return json({ models: [{ name: MODEL }] });
    if (url.endsWith("/api/chat")) {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.model, MODEL);
      return json({
        model: "wrong:7b",
        message: { content: '{"summary":"valid object","confidence":0.95}' },
      });
    }
    throw new Error("UNEXPECTED_ENDPOINT");
  };
  const probe = await runQualificationDoctor({
    mode: "ollama", requiredModel: MODEL,
    ollamaHost: "http://127.0.0.1:11434",
    strictModelIdentity: true, fetchImpl,
  });
  assert.equal(probe.passed, false);
  assert.equal(probe.checks.find(c => c.name === "ollama.inference")?.status, "fail");
  assert.ok(probe.checks.find(c => c.name === "ollama.inference")?.detail
    .includes("OLLAMA_MODEL_IDENTITY_MISMATCH"));
});
