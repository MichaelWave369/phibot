import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { runAcceptanceScenario } from "../acceptance/scenario.js";
import { runQualificationDoctor } from "./doctor.js";
import type {
  QualificationArtifact,
  QualificationFailure,
  QualificationOptions,
  QualificationRecord,
  QualificationResult,
} from "./types.js";

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}

async function ensureEmptyDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const entries = await readdir(path);
  if (entries.length > 0) {
    throw new Error(
      `Qualification output directory must be empty: ${path}`,
    );
  }
}

async function collectArtifacts(
  root: string,
  current = root,
): Promise<QualificationArtifact[]> {
  const artifacts: QualificationArtifact[] = [];

  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return artifacts;
    }
    throw error;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(current, entry.name);

    if (entry.isDirectory()) {
      artifacts.push(...(await collectArtifacts(root, fullPath)));
      continue;
    }

    if (!entry.isFile()) continue;

    const bytes = await readFile(fullPath);
    const info = await stat(fullPath);
    artifacts.push({
      path: normalizeRelativePath(relative(root, fullPath)),
      sha256: sha256(bytes),
      bytes: info.size,
    });
  }

  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

function failureFrom(error: unknown): QualificationFailure {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

function preflightFailureMessage(
  checks: Array<{ status: string; detail: string }>,
): string {
  return checks
    .filter((item) => item.status === "fail")
    .map((item) => item.detail)
    .join(" | ");
}

export async function runFieldQualification(
  options: QualificationOptions,
): Promise<QualificationResult> {
  const outputDir = resolve(options.outputDir);
  await ensureEmptyDirectory(outputDir);

  const runtimeStateDir = join(outputDir, "runtime");
  const mode = options.mode ?? "ollama";
  const clock = options.now ?? Date.now;
  const startedAt = new Date(clock()).toISOString();

  const preflight = await runQualificationDoctor({
    mode,
    ...(options.ollamaHost === undefined
      ? {}
      : { ollamaHost: options.ollamaHost }),
    ...(options.requiredModel === undefined
      ? {}
      : { requiredModel: options.requiredModel }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    now: clock,
  });

  let acceptance;
  let failure: QualificationFailure | undefined;

  if (!preflight.passed) {
    failure = {
      name: "QualificationPreflightError",
      message:
        preflightFailureMessage(preflight.checks) ||
        "Qualification preflight failed.",
    };
  } else {
    try {
      acceptance = await runAcceptanceScenario({
        stateDir: runtimeStateDir,
        mode,
        ...(options.ollamaHost === undefined
          ? {}
          : { ollamaHost: options.ollamaHost }),
        ...(options.secret === undefined ? {} : { secret: options.secret }),
        now: clock,
      });
    } catch (error: unknown) {
      failure = failureFrom(error);
    }
  }

  const artifacts = await collectArtifacts(runtimeStateDir);
  const status =
    acceptance?.passed === true && failure === undefined ? "PASS" : "FAIL";

  const environment = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    providerMode: mode,
    ...(preflight.ollamaHost === undefined
      ? {}
      : { ollamaHost: preflight.ollamaHost }),
    ...(options.sourceCommit === undefined
      ? {}
      : { sourceCommit: options.sourceCommit }),
  };

  const record: QualificationRecord = {
    schema: "phibot.qualification.record.v1",
    qualificationId: randomUUID(),
    status,
    startedAt,
    finishedAt: new Date(clock()).toISOString(),
    environment,
    preflight,
    runtimeStateDir,
    ...(acceptance === undefined ? {} : { acceptance }),
    ...(failure === undefined ? {} : { failure }),
    artifacts,
  };

  const recordPath = join(outputDir, "qualification.json");
  const recordBytes = Buffer.from(
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  await writeFile(recordPath, recordBytes);

  const recordSha256 = sha256(recordBytes);
  const digestPath = join(outputDir, "qualification.sha256");
  await writeFile(
    digestPath,
    `${recordSha256}  qualification.json\n`,
    "utf8",
  );

  return {
    record,
    recordPath,
    digestPath,
    recordSha256,
  };
}
