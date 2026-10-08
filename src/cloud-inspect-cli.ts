#!/usr/bin/env node
/** PHIBOT-09: explicit one-shot read-only cloud observation only. */
import { inspectPublishedCloudScout } from "./cloud/public-acquisition.js";

async function main(): Promise<void> {
  if (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === "--read-only")) {
    if (process.argv[2] === "--help") {
      console.log("npm run cloud:inspect  # four public, no-auth GitHub GETs; no agent execution");
      return;
    }
    throw new Error("Only the fixed read-only Scout mission is supported. No URL/task arguments.");
  }
  const evidence = await inspectPublishedCloudScout();
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.review.disposition !== "OBSERVED_OK_UNVERIFIED_PUBLIC") process.exitCode = 2;
}
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "PHIBOT_PUBLIC_REFUSED");
  process.exitCode = 1;
});
