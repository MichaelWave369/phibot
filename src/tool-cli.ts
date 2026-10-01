#!/usr/bin/env node
import { resolve } from "node:path";
import { FileLedger } from "./core/ledger.js";
import { loadManifest } from "./core/manifest.js";
import { createBuiltinToolRegistry } from "./tools/builtins.js";
import { ToolExecutor } from "./tools/executor.js";

async function main(): Promise<void> {
  const [, , manifestArg, capabilityArg, inputArg] = process.argv;

  if (!manifestArg || !capabilityArg || inputArg === undefined) {
    console.error(
      "Usage: npm run tool -- <manifest.json> <capability> '<json-input>'",
    );
    process.exitCode = 1;
    return;
  }

  const manifest = await loadManifest(resolve(manifestArg));
  const registry = createBuiltinToolRegistry();
  const executor = new ToolExecutor(registry, new FileLedger());

  let input: unknown;
  try {
    input = JSON.parse(inputArg) as unknown;
  } catch {
    throw new Error("Tool input must be valid JSON.");
  }

  const result = await executor.execute(manifest, {
    capability: capabilityArg,
    input,
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.status !== "executed") {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
