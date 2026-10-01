#!/usr/bin/env node
import { resolve } from "node:path";
import { ProviderBackedAdapter } from "./adapters/provider-backed.js";
import { FileLedger } from "./core/ledger.js";
import { loadManifest } from "./core/manifest.js";
import { PhiBotRuntime } from "./core/runtime.js";
import { createDefaultProviderRegistry } from "./providers/registry.js";

async function main(): Promise<void> {
  const [, , manifestArg, ...taskParts] = process.argv;

  if (!manifestArg || taskParts.length === 0) {
    console.error('Usage: npm run phibot -- <manifest.json> "<task>"');
    process.exitCode = 1;
    return;
  }

  const manifest = await loadManifest(resolve(manifestArg));
  const registry = createDefaultProviderRegistry();

  const configuredFallback = process.env.PHIBOT_PROVIDER_FALLBACK ?? "dry-run";
  const fallback =
    configuredFallback.trim().toLowerCase() === "none"
      ? undefined
      : configuredFallback.trim();

  const provider = fallback
    ? registry.create(manifest.model.provider, manifest.model.name, {
        fallbackProvider: fallback,
        fallbackModel: "deterministic",
      })
    : registry.create(manifest.model.provider, manifest.model.name);

  const runtime = new PhiBotRuntime(
    manifest,
    new ProviderBackedAdapter(provider),
    new FileLedger(),
  );
  const result = await runtime.run({ task: taskParts.join(" ") });

  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
