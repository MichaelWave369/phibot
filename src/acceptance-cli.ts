#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAcceptanceScenario } from "./acceptance/scenario.js";
import type { AcceptanceProviderMode } from "./acceptance/types.js";

interface Args {
  mode: AcceptanceProviderMode;
  stateDir?: string;
  ollamaHost?: string;
  keepState: boolean;
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

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "deterministic",
    keepState: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--mode") {
      const mode = requireValue(argv, ++index, "--mode");
      if (mode !== "deterministic" && mode !== "ollama") {
        throw new Error("--mode must be deterministic or ollama.");
      }
      args.mode = mode;
    } else if (value === "--state-dir") {
      args.stateDir = resolve(
        requireValue(argv, ++index, "--state-dir"),
      );
    } else if (value === "--ollama-host") {
      args.ollamaHost = requireValue(argv, ++index, "--ollama-host");
    } else if (value === "--keep-state") {
      args.keepState = true;
    } else if (value !== undefined) {
      throw new Error(`Unknown acceptance argument: ${value}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const temporary = args.stateDir === undefined;
  const stateDir =
    args.stateDir ??
    (await mkdtemp(join(tmpdir(), "phibot-acceptance-")));

  try {
    const report = await runAcceptanceScenario({
      stateDir,
      mode: args.mode,
      ...(args.ollamaHost === undefined
        ? {}
        : { ollamaHost: args.ollamaHost }),
    });

    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 2;
  } finally {
    if (temporary && !args.keepState) {
      await rm(stateDir, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
