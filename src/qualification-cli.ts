#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runFieldQualification } from "./qualification/runner.js";
import type { AcceptanceProviderMode } from "./acceptance/types.js";

interface Args {
  mode: AcceptanceProviderMode;
  outputDir?: string;
  ollamaHost?: string;
  ollamaTimeoutMs?: number;
  sourceCommit?: string;
}

function requireValue(
  argv: string[],
  index: number,
  flag: string,
): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function positiveInteger(
  value: string,
  flag: string,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function defaultOutputDir(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
  return resolve(".phibot", "qualification", stamp);
}

function currentGitCommit(): string | undefined {
  try {
    const value = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    return /^[0-9a-f]{40}$/i.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "ollama",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--mode") {
      const mode = requireValue(argv, ++index, "--mode");
      if (mode !== "ollama" && mode !== "deterministic") {
        throw new Error("--mode must be ollama or deterministic.");
      }
      args.mode = mode;
    } else if (value === "--output-dir") {
      args.outputDir = resolve(
        requireValue(argv, ++index, "--output-dir"),
      );
    } else if (value === "--ollama-host") {
      args.ollamaHost = requireValue(argv, ++index, "--ollama-host");
    } else if (value === "--ollama-timeout-ms") {
      args.ollamaTimeoutMs = positiveInteger(
        requireValue(argv, ++index, "--ollama-timeout-ms"),
        "--ollama-timeout-ms",
      );
    } else if (value === "--source-commit") {
      args.sourceCommit = requireValue(argv, ++index, "--source-commit");
    } else if (value !== undefined) {
      throw new Error(`Unknown qualification argument: ${value}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args.outputDir ?? defaultOutputDir();
  const sourceCommit = args.sourceCommit ?? currentGitCommit();

  const result = await runFieldQualification({
    outputDir,
    mode: args.mode,
    ...(args.ollamaHost === undefined
      ? {}
      : { ollamaHost: args.ollamaHost }),
    ...(args.ollamaTimeoutMs === undefined
      ? {}
      : { ollamaTimeoutMs: args.ollamaTimeoutMs }),
    ...(sourceCommit === undefined
      ? {}
      : { sourceCommit }),
  });

  console.log(
    JSON.stringify(
      {
        status: result.record.status,
        qualificationId: result.record.qualificationId,
        providerMode: result.record.environment.providerMode,
        sourceCommit:
          result.record.environment.sourceCommit ?? null,
        ollamaTimeoutMs:
          result.record.environment.ollamaTimeoutMs ?? null,
        preflightPassed: result.record.preflight.passed,
        preflightChecks: result.record.preflight.checks,
        outputDir,
        recordPath: result.recordPath,
        digestPath: result.digestPath,
        recordSha256: result.recordSha256,
        acceptancePassed: result.record.acceptance?.passed ?? false,
        failure: result.record.failure ?? null,
      },
      null,
      2,
    ),
  );

  if (result.record.status !== "PASS") {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
