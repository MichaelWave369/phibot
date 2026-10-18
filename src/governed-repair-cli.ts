#!/usr/bin/env node
/** Human-only Reality Gate entrypoint for one SHA-bound source repair commit. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { FileLedger } from "./core/ledger.js";
import { validateManifest } from "./core/manifest.js";
import { RealityGate } from "./gate/reality-gate.js";
import { createBuiltinToolRegistry } from "./tools/builtins.js";
import { ToolExecutor } from "./tools/executor.js";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3)
    throw new Error("Usage: npm run steward:governed-repair -- <proposal.json>");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Interactive terminal required; no unattended approval");
  if (process.env.PHIBOT_ENABLE_GOVERNED_REPAIR !== "1")
    throw new Error("Set PHIBOT_ENABLE_GOVERNED_REPAIR=1 after reviewing the policy");
  const secret = process.env.PHIBOT_REALITY_GATE_SECRET ?? "";
  if (secret.length < 32) throw new Error("PHIBOT_REALITY_GATE_SECRET must be >=32 characters");
  const raw = await readFile(resolve(file), "utf8");
  if (Buffer.byteLength(raw, "utf8") > 16000) throw new Error("Repair proposal too large");
  const input: unknown = JSON.parse(raw);
  const registry = createBuiltinToolRegistry();
  const capability = registry.get("repo.steward.repair");
  if (!capability) throw new Error("Governed repair not registered");
  const candidate = capability.validate(input);
  const manifest = validateManifest({
    id: "human-approved-repair",
    name: "Human Approved Repair",
    version: "0.1.0",
    role: "one_commit_governed_source_repair",
    description: "Operator explicitly authorizes one bounded source replacement",
    model: { provider: "operator", name: "human" },
    memory: { scope: "repo", maxDepth: 0 },
    capabilities: ["repo.steward.repair"],
    authority: { read: true, propose: true, write: "gated", deploy: false },
    escalation: { target: "human", confidenceBelow: 1 },
  });
  const ledger = new FileLedger();
  const gate = new RealityGate({ secret, ledger });
  const executor = new ToolExecutor(registry, ledger, { timeoutMs: 90000 }, gate);
  const runId = randomUUID();
  const initial = await executor.execute(manifest,
    { capability: "repo.steward.repair", input: candidate }, runId);
  if (initial.status !== "gated" || !initial.gateRequest)
    throw new Error("Reality Gate did not create an approval request");
  process.stdout.write(
    "\nEXACT PROPOSAL TO REVIEW (includes the full replacement source):\n" +
    JSON.stringify(candidate, null, 2) + "\n\n" +
    "Reality Gate SHA-256 digest: " + initial.gateRequest.inputDigest + "\n" +
    "No GitHub code changes have been made.\n\n",
  );
  const prompt = "APPROVE " + initial.gateRequest.inputDigest.slice(0, 16);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let reply: string;
  try {
    reply = await rl.question("Type '" + prompt + "' to allow one draft repair commit: ");
  } finally { rl.close(); }
  if (reply.trim() !== prompt) {
    await gate.decide(initial.gateRequest, {
      outcome: "deny", reason: "Operator did not explicitly approve source repair",
    });
    process.stdout.write("DENIED. No GitHub write performed.\n");
    return;
  }
  const decision = await gate.decide(initial.gateRequest, {
    outcome: "approve", reason: "Operator reviewed and approved the exact code proposal",
  });
  if (!decision.grant) throw new Error("Reality Gate did not issue a grant");
  const result = await executor.execute(manifest, {
    capability: "repo.steward.repair", input: candidate, grant: decision.grant,
  }, runId);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "executed") process.exitCode = 2;
}
main().catch(error => {
  process.stderr.write("Governed source repair refused: " +
    (error instanceof Error ? error.message : "unknown error") + "\n");
  process.exitCode = 1;
});
