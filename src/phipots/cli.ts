#!/usr/bin/env node
/**
 * Operator-invoked only. One quoted idea, one deterministic local six-role
 * rehearsal. No background schedule or connected agent/tools.
 */
import { runPhiPotsDryRun } from "./crew.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const idea = args[0];
  if (args.length !== 1 || idea === undefined || idea === "--help" || idea === "-h") {
    console.error('Usage: npm run phipots:dry -- "Describe one project idea"');
    if (args.length !== 1 || args[0] !== "--help" && args[0] !== "-h") {
      process.exitCode = 1;
    }
    return;
  }
  const report = await runPhiPotsDryRun(idea);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "PHIPOTS_UNKNOWN_REFUSAL";
  console.error(
    /^(PHIPOTS_)[A-Z_]+$/.test(code) ? code : "PHIPOTS_DRY_RUN_FAILED",
  );
  process.exitCode = 1;
});
