#!/usr/bin/env node
import { runQualificationDoctor } from "./qualification/doctor.js";

interface Args {
  ollamaHost?: string;
  requiredModel?: string;
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
  const args: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--ollama-host") {
      args.ollamaHost = requireValue(argv, ++index, "--ollama-host");
    } else if (value === "--model") {
      args.requiredModel = requireValue(argv, ++index, "--model");
    } else if (value !== undefined) {
      throw new Error(`Unknown doctor argument: ${value}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const preflight = await runQualificationDoctor({
    mode: "ollama",
    ...(args.ollamaHost === undefined
      ? {}
      : { ollamaHost: args.ollamaHost }),
    ...(args.requiredModel === undefined
      ? {}
      : { requiredModel: args.requiredModel }),
  });

  console.log(JSON.stringify(preflight, null, 2));

  if (!preflight.passed) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
