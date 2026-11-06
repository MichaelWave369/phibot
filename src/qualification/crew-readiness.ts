/**
 * PHIBOT-36: explicitly invoked, local-only Ollama provider-readiness evidence.
 * Reuses the existing representative PhiBot qualification doctor.
 * An evidence file is a locally generated self-report, not an attestation.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runQualificationDoctor } from "./doctor.js";
import type { QualificationPreflight } from "./types.js";

const MODEL = /^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.json$/;
const CHECKS = ["node.version", "ollama.reachable", "ollama.model", "ollama.inference"] as const;
const MAX_RECORD_FILES = 200;
const MAX_RECORD_BYTES = 8192;
const AGE_MS = 60 * 60 * 1000;
const SOURCE = "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED" as const;

export interface CrewReadinessRecord {
  schema: "phibot.crew.readiness.v1";
  probeId: string;
  checkedAt: string;
  model: string;
  ollamaPort: number;
  status: "PASS" | "FAIL";
  source: typeof SOURCE;
  strictModelEcho: true;
  checks: Record<string, "pass" | "fail">;
  inferenceLatencyMs: number | null;
  inferenceAttempts: number | null;
  digest: string;
}

export interface ReadinessDisplay {
  model: string;
  checkedAt: string;
  status: "RECENT_PROBE_PASS_SELF_REPORT" | "FAILED_PROBE" | "STALE_PROBE";
  inferenceLatencyMs: number | null;
  inferenceAttempts: number | null;
  digest: string;
}
export interface CrewReadinessView {
  schema: "phibot.crew.readiness-view.v1";
  classification: typeof SOURCE;
  maxAgeMs: number;
  records: ReadinessDisplay[];
}

export const defaultReadinessDir = () => resolve(".phibot", "crew-readiness");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

export function validateCrewProbeInput(model: string, port: number, timeoutMs: number): void {
  if (typeof model !== "string" || !MODEL.test(model))
    throw new Error("CREW_PROBE_MODEL_INVALID");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("CREW_PROBE_PORT_INVALID");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000)
    throw new Error("CREW_PROBE_TIMEOUT_INVALID");
}

function makeRecord(
  model: string, port: number, preflight: QualificationPreflight | null, at: Date,
): CrewReadinessRecord {
  const checks: Record<string, "pass" | "fail"> = {};
  for (const name of CHECKS) {
    const found = preflight?.checks.filter(c => c.name === name) ?? [];
    checks[name] = found.length === 1 && found[0]?.status === "pass" ? "pass" : "fail";
  }
  const passed = preflight?.passed === true &&
    preflight.providerMode === "ollama" &&
    preflight.requiredModel === model &&
    Object.values(checks).every(s => s === "pass");
  const input = {
    schema: "phibot.crew.readiness.v1" as const,
    probeId: randomUUID(),
    checkedAt: at.toISOString(), model, ollamaPort: port,
    status: (passed ? "PASS" : "FAIL") as "PASS" | "FAIL",
    source: SOURCE, strictModelEcho: true as const,
    checks,
    inferenceLatencyMs: Number.isSafeInteger(preflight?.inferenceLatencyMs) &&
      (preflight?.inferenceLatencyMs ?? -1) >= 0 ? preflight!.inferenceLatencyMs! : null,
    inferenceAttempts: Number.isSafeInteger(preflight?.inferenceAttempts) &&
      (preflight?.inferenceAttempts ?? -1) >= 1 &&
      (preflight?.inferenceAttempts ?? 99) <= 2 ? preflight!.inferenceAttempts! : null,
  };
  return { ...input, digest: hash(input) };
}

export function verifyReadinessRecord(value: unknown): CrewReadinessRecord {
  if (!obj(value) ||
      Object.keys(value).sort().join(",") !== [
        "schema", "probeId", "checkedAt", "model", "ollamaPort",
        "status", "source", "strictModelEcho", "checks",
        "inferenceLatencyMs", "inferenceAttempts", "digest",
      ].sort().join(","))
    throw new Error("CREW_READINESS_SCHEMA_INVALID");
  const r = value as unknown as CrewReadinessRecord;
  if (r.schema !== "phibot.crew.readiness.v1" || !ID.test(r.probeId) ||
      !Number.isFinite(Date.parse(r.checkedAt)) ||
      !MODEL.test(r.model) || !Number.isInteger(r.ollamaPort) ||
      r.ollamaPort < 1 || r.ollamaPort > 65535 ||
      (r.status !== "PASS" && r.status !== "FAIL") ||
      r.source !== SOURCE || r.strictModelEcho !== true ||
      !obj(r.checks) || Object.keys(r.checks).sort().join(",") !==
        [...CHECKS].sort().join(",") ||
      Object.values(r.checks).some(v => v !== "pass" && v !== "fail") ||
      (r.inferenceLatencyMs !== null &&
        (!Number.isSafeInteger(r.inferenceLatencyMs) || r.inferenceLatencyMs < 0)) ||
      (r.inferenceAttempts !== null &&
        (!Number.isInteger(r.inferenceAttempts) || r.inferenceAttempts < 1 ||
          r.inferenceAttempts > 2)) ||
      typeof r.digest !== "string" || !SHA.test(r.digest))
    throw new Error("CREW_READINESS_RECORD_INVALID");
  const { digest, ...body } = r;
  if (hash(body) !== digest) throw new Error("CREW_READINESS_DIGEST_MISMATCH");
  if (r.status === "PASS" && (
      Object.values(r.checks).some(v => v !== "pass") ||
      r.inferenceAttempts === null || r.inferenceLatencyMs === null))
    throw new Error("CREW_READINESS_UNSUPPORTED_PASS");
  return structuredClone(r);
}

/** One manual probe, plus one immutable local receipt on PASS or FAIL. */
export async function runCrewReadiness({
  model, port = 11434, timeoutMs = 90000,
  dir = defaultReadinessDir(),
  doctor = runQualificationDoctor,
  now = () => new Date(),
}: {
  model: string;
  port?: number;
  timeoutMs?: number;
  dir?: string;
  doctor?: typeof runQualificationDoctor;
  now?: () => Date;
}): Promise<{ record: CrewReadinessRecord; path: string }> {
  validateCrewProbeInput(model, port, timeoutMs);
  const at = now();
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    throw new Error("CREW_PROBE_CLOCK_INVALID");
  let preflight: QualificationPreflight | null = null;
  try {
    preflight = await doctor({
      mode: "ollama",
      requiredModel: model,
      ollamaHost: "http://127.0.0.1:" + port,
      timeoutMs: 2500,
      inferenceTimeoutMs: timeoutMs,
      strictModelIdentity: true,
    });
  } catch {
    // No untrusted model/provider message or prompt is exported to the receipt.
  }
  const record = verifyReadinessRecord(makeRecord(model, port, preflight, at));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filename = at.toISOString().replace(/[:.]/g, "-") + "-" + record.probeId + ".json";
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(record, null, 2) + "\n",
    { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { record, path };
}

/** Read-only, bounded, self-hash-checked local evidence projection. */
export async function readCrewReadiness({
  dir = defaultReadinessDir(),
  now = () => Date.now(),
}: { dir?: string; now?: () => number } = {}): Promise<CrewReadinessView> {
  let names: string[];
  try { names = await readdir(dir); }
  catch (error: unknown) {
    if (obj(error) && error.code === "ENOENT")
      return {
        schema: "phibot.crew.readiness-view.v1",
        classification: SOURCE, maxAgeMs: AGE_MS, records: [],
      };
    throw error;
  }
  if (names.length > MAX_RECORD_FILES ||
      names.some(name => !FILE.test(name)))
    throw new Error("CREW_READINESS_DIRECTORY_INVALID");
  const latest = new Map<string, CrewReadinessRecord>();
  for (const name of names.sort()) {
    const file = join(dir, name);
    if ((await stat(file)).size > MAX_RECORD_BYTES)
      throw new Error("CREW_READINESS_FILE_OVERSIZE");
    const record = verifyReadinessRecord(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (!name.endsWith(record.probeId + ".json"))
      throw new Error("CREW_READINESS_FILENAME_MISMATCH");
    const prior = latest.get(record.model);
    if (!prior || record.checkedAt > prior.checkedAt ||
        (record.checkedAt === prior.checkedAt && record.probeId > prior.probeId))
      latest.set(record.model, record);
  }
  const at = now();
  if (!Number.isFinite(at)) throw new Error("CREW_READINESS_CLOCK_INVALID");
  return {
    schema: "phibot.crew.readiness-view.v1",
    classification: SOURCE, maxAgeMs: AGE_MS,
    records: [...latest.values()].sort((a,b) => a.model.localeCompare(b.model)).map(r => {
      const age = at - Date.parse(r.checkedAt);
      const stale = age < 0 || age > AGE_MS;
      return {
        model: r.model,
        checkedAt: r.checkedAt,
        status: stale ? "STALE_PROBE" as const :
          r.status === "PASS" ? "RECENT_PROBE_PASS_SELF_REPORT" as const :
          "FAILED_PROBE" as const,
        inferenceLatencyMs: r.inferenceLatencyMs,
        inferenceAttempts: r.inferenceAttempts,
        digest: r.digest,
      };
    }),
  };
}
