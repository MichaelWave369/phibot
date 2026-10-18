#!/usr/bin/env node
/**
 * Human-operated entrypoint for a single Reality-Gated documentation draft.
 * Never runs from cron/CI: requires an interactive TTY and exact digest echo.
 */
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
  const path = process.argv[2];
  if (!path || process.argv.length !== 3)
    throw new Error("Usage: npm run steward:governed-draft -- <proposal.json>");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Interactive terminal required; this operation cannot run unattended");
  if (process.env.PHIBOT_ENABLE_GOVERNED_DRAFTS !== "1")
    throw new Error("Set PHIBOT_ENABLE_GOVERNED_DRAFTS=1 after reviewing the write policy");
  const secret = process.env.PHIBOT_REALITY_GATE_SECRET ?? "";
  if (secret.length < 32) throw new Error("PHIBOT_REALITY_GATE_SECRET must be at least 32 characters");
  const candidate = await readFile(resolve(path), "utf8");
  if (Buffer.byteLength(candidate, "utf8") > 15000) throw new Error("Proposal too large");
  const payload: unknown = JSON.parse(candidate);
  const registry = createBuiltinToolRegistry();
  const capability = registry.get("repo.steward.draft");
  if (!capability) throw new Error("Governed draft capability is unregistered");
  // Validate before asking an operator to grant anything.
  const approvedShape = capability.validate(payload);
  const manifest = validateManifest({
    id: "governed-draft-operator",
    name: "Governed Draft Operator",
    version: "0.1.0",
    role: "human_confirmed_markdown_draft",
    description: "Interactive consent for one exact SHA-bound GitHub draft proposal",
    model: { provider: "operator", name: "human" },
    memory: { scope: "task", maxDepth: 0 },
    capabilities: ["repo.steward.draft"],
    authority: { read: true, propose: true, write: "gated", deploy: false },
    escalation: { target: "human", confidenceBelow: 1 },
  });
  const ledger = new FileLedger();
  const gate = new RealityGate({ secret, ledger });
  const executor = new ToolExecutor(registry, ledger, { timeoutMs: 90000 }, gate);
  const runId = randomUUID();
  const request = await executor.execute(manifest,
    { capability: "repo.steward.draft", input: approvedShape }, runId);
  if (request.status !== "gated" || !request.gateRequest)
    throw new Error("Reality Gate did not issue an approval request");

  // Print the full content, so a human can actually inspect what's approved.
  process.stdout.write("\nREVIEW EXACT PROPOSAL (the whole replacement is shown):\n" +
    JSON.stringify(approvedShape, null, 2) + "\n\n" +
    "Reality Gate SHA-256 input digest: " + request.gateRequest.inputDigest + "\n" +
    "No repository is written until you approve this single request.\n\n");
  const confirmation = "APPROVE " + request.gateRequest.inputDigest.slice(0, 16);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await rl.question("Type '" + confirmation + "' to approve, anything else denies: ");
  } finally {
    rl.close();
  }
  if (answer.trim() !== confirmation) {
    await gate.decide(request.gateRequest, {
      outcome: "deny", reason: "Operator did not approve exact proposal",
    });
    process.stdout.write("DENIED: No GitHub write performed.\n");
    return;
  }
  const decision = await gate.decide(request.gateRequest, {
    outcome: "approve", reason: "Operator explicitly approved exact reviewed proposal",
  });
  if (!decision.grant) throw new Error("Reality Gate denied grant");
  const result = await executor.execute(manifest, {
    capability: "repo.steward.draft", input: approvedShape, grant: decision.grant,
  }, runId);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "executed") process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write("Governed draft refused: " +
    (error instanceof Error ? error.message : "unknown error") + "\n");
  process.exitCode = 1;
});
