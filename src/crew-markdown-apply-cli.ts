#!/usr/bin/env node
/**
 * PHIBOT-41. Local, explicitly enabled, TTY-only Reality Gate for ONE
 * Markdown worktree edit. No Git add/commit/push, CI or GitHub API.
 */
import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { FileLedger } from "./core/ledger.js";
import { validateManifest } from "./core/manifest.js";
import { RealityGate } from "./gate/reality-gate.js";
import { ToolExecutor } from "./tools/executor.js";
import { ToolCapabilityRegistry } from "./tools/registry.js";
import {
  registerLocalMarkdownApply, MARKDOWN_LOCAL_APPLY_CAPABILITY,
} from "./tools/crew-markdown-apply-local.js";
import { previewMarkdownApply, verifyAppliedMarkdown } from "./crew-markdown-apply.js";

function parse(argv: string[]): {
  command: "apply" | "verify";
  draftId: string; repoDir: string; allowedRoots: string[];
} {
  const command = argv[0];
  if ((command !== "apply" && command !== "verify") || argv.length !== 5)
    throw Error("Usage: crew:apply or crew:apply:verify -- --draft <uuid> --repo <local-root>");
  const args: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key || !value || !["--draft", "--repo"].includes(key) ||
        args[key] !== undefined)
      throw Error("MARKDOWN_APPLY_CLI_ARGUMENTS_INVALID");
    args[key] = value;
  }
  const draftId = args["--draft"], repoDir = args["--repo"];
  const roots = process.env.PHIBOT_CREW_REPO_ALLOWLIST;
  if (!draftId || !repoDir || !roots)
    throw Error("MARKDOWN_APPLY_REPO_ALLOWLIST_REQUIRED");
  return {
    command, draftId, repoDir,
    allowedRoots: roots.split(";").map(s => s.trim()).filter(Boolean),
  };
}
async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parse(argv);
  if (args.command === "verify") {
    stdout.write(JSON.stringify(await verifyAppliedMarkdown({
      draftId: args.draftId, repoDir: args.repoDir, allowedRoots: args.allowedRoots,
    }), null, 2) + "\n");
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY)
    throw Error("MARKDOWN_APPLY_INTERACTIVE_TERMINAL_REQUIRED");
  if (process.env.PHIBOT_ENABLE_MARKDOWN_LOCAL_APPLY !== "1")
    throw Error("MARKDOWN_APPLY_EXPLICIT_OPT_IN_REQUIRED");
  const secret = process.env.PHIBOT_REALITY_GATE_SECRET ?? "";
  if (secret.length < 32 || secret.length > 256 || /[\r\n]/.test(secret))
    throw Error("MARKDOWN_APPLY_REALITY_GATE_SECRET_REQUIRED");

  const preview = await previewMarkdownApply({
    draftId: args.draftId, repoDir: args.repoDir, allowedRoots: args.allowedRoots,
  });
  const root = await realpath(resolve(args.repoDir));
  // The Reality Gate ledger also stays inside this canonical ignored directory.
  const localState = join(root, ".phibot");
  await mkdir(localState, { recursive: true, mode: 0o700 });
  if (await realpath(localState) !== localState)
    throw Error("MARKDOWN_APPLY_LOCAL_STATE_SYMLINK");
  const ledger = new FileLedger(join(localState, "ledger.ndjson"));
  const gate = new RealityGate({ secret, ledger, defaultTtlMs: 60_000 });
  const registry = registerLocalMarkdownApply(new ToolCapabilityRegistry(), {
    allowedRoots: args.allowedRoots,
  });
  const executor = new ToolExecutor(registry, ledger, { timeoutMs: 30_000 }, gate);
  const manifest = validateManifest({
    id: "human-markdown-local-operator",
    name: "Human-Approved Markdown Operator",
    version: "1.0.0",
    role: "single_local_markdown_replacement",
    description: "Operator-initiated, Reality Gate authorized local worktree edit",
    model: { provider: "operator", name: "human" },
    memory: { scope: "none", maxDepth: 0 },
    capabilities: [MARKDOWN_LOCAL_APPLY_CAPABILITY],
    authority: { read: true, propose: false, write: "gated", deploy: false },
    escalation: { target: "human", confidenceBelow: 1 },
  });
  const runId = randomUUID();
  const gated = await executor.execute(manifest, {
    capability: MARKDOWN_LOCAL_APPLY_CAPABILITY, input: preview.intent,
  }, runId);
  if (gated.status !== "gated" || !gated.gateRequest)
    throw Error("MARKDOWN_APPLY_REALITY_GATE_REQUEST_MISSING");

  stdout.write([
    "\nPHIBOT-41 / EXACT LOCAL MARKDOWN REALITY GATE",
    "Repository root: " + preview.intent.repoRoot,
    "Target: " + preview.intent.target,
    "Commit: " + preview.intent.commit,
    "Draft ID: " + preview.intent.draftId,
    "Draft receipt SHA-256: " + preview.intent.draftReceiptDigest,
    "Original source SHA-256: " + preview.intent.beforeSha256,
    "Proposed new SHA-256: " + preview.intent.afterSha256,
    "ONLY an uncommitted local file replacement can occur.",
    "No Git add, commit, push, PR, merge, CI pass, deploy, or new permission.",
    "\nEXACT PROPOSED DIFF:",
    preview.proposal.diff,
    "Reality Gate exact input SHA-256: " + gated.gateRequest.inputDigest,
  ].join("\n") + "\n\n");

  const approval = "APPLY " + gated.gateRequest.inputDigest.slice(0,16);
  const io = createInterface({ input: stdin, output: stdout });
  let reply = "";
  try { reply = await io.question("Type exactly '" + approval +
    "' to replace this ONE local file: "); }
  finally { io.close(); }

  if (reply !== approval) {
    await gate.decide(gated.gateRequest, {
      outcome: "deny", reason: "Operator did not approve the exact local Markdown change",
    });
    stdout.write("DENIED: target document unchanged.\n");
    return;
  }
  const decision = await gate.decide(gated.gateRequest, {
    outcome: "approve", reason: "Operator reviewed source pin, exact diff and local-only scope",
  });
  if (!decision.grant) throw Error("MARKDOWN_APPLY_GATE_GRANT_MISSING");
  const applied = await executor.execute(manifest, {
    capability: MARKDOWN_LOCAL_APPLY_CAPABILITY,
    input: preview.intent, grant: decision.grant,
  }, runId);
  if (applied.status !== "executed")
    throw Error("MARKDOWN_APPLY_REFUSED_OR_AMBIGUOUS_INSPECT_LOCAL_STATE");
  const output = applied.output;
  stdout.write(JSON.stringify({
    status: "APPLIED_LOCAL_WORKTREE_UNCOMMITTED_CI_UNVERIFIED",
    result: output,
    nextStep: "Run crew:apply:verify, inspect git diff, test locally, then independently decide any commit.",
  }, null, 2) + "\n");
}
main().catch(error => {
  process.stderr.write("Markdown Reality Gate refused: " +
    (error instanceof Error ? error.message : "unknown") + "\n");
  process.exitCode = 1;
});
