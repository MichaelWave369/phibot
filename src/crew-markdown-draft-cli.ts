#!/usr/bin/env node
/**
 * PHIBOT-40: preview and record one exact *inert* Markdown replacement.
 * Only local ignored .phibot/ state is written, never the reviewed source.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { listMarkdownDrafts, prepareMarkdownDraft, storeMarkdownDraft } from "./crew-markdown-draft.js";

type Params = {
  handoffId: string;
  repoDir: string;
  allowedRoots: string[];
  replacementFile: string;
};
function parse(argv: string[]): Params {
  if (argv.length !== 6) throw Error(
    "Usage: --handoff <uuid> --repo <local-clone> --replacement <.phibot/crew-drafts/name.md>");
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i+1];
    if (!flag || !value || !["--handoff", "--repo", "--replacement"].includes(flag) ||
        values[flag] !== undefined)
      throw Error("CREW_DRAFT_CLI_INVALID_ARGUMENTS");
    values[flag] = value;
  }
  const handoffId = values["--handoff"], repoDir = values["--repo"];
  const replacementFile = values["--replacement"];
  const allowlist = process.env.PHIBOT_CREW_REPO_ALLOWLIST;
  if (!handoffId || !repoDir || !replacementFile || !allowlist)
    throw Error("CREW_DRAFT_CLI_MISSING_ARGUMENT_OR_ALLOWLIST");
  return {
    handoffId, repoDir,
    replacementFile,
    allowedRoots: allowlist.split(";").map(x => x.trim()).filter(Boolean),
  };
}
async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0];
  if (command === "list" && argv.length === 1) {
    const records = await listMarkdownDrafts();
    stdout.write(JSON.stringify({
      classification: "LOCAL_OPERATOR_RECORDED_NOT_WRITE_APPROVED",
      records: records.map(r => ({
        id: r.id, createdAt: r.createdAt,
        handoffId: r.proposal.handoffId,
        source: r.proposal.source, status: r.proposal.status,
        beforeSha256: r.proposal.beforeSha256,
        afterSha256: r.proposal.afterSha256,
        proposalDigest: r.proposalDigest, receiptDigest: r.receiptDigest,
      })),
    }, null, 2) + "\n");
    return;
  }
  if (command !== "preview" && command !== "record")
    throw Error("CREW_DRAFT_COMMAND_INVALID");
  if (command === "record" && (!stdin.isTTY || !stdout.isTTY))
    throw Error("CREW_DRAFT_INTERACTIVE_TERMINAL_REQUIRED");
  const args = parse(argv.slice(1));
  const prepared = await prepareMarkdownDraft(args);
  stdout.write([
    "PHIBOT-40 / EXACT MARKDOWN DRAFT / NEVER APPLIED",
    "Source: " + prepared.proposal.source.repository + " / " + prepared.proposal.source.path,
    "Pinned commit: " + prepared.proposal.source.commit,
    "Original blob SHA: " + prepared.proposal.source.blobSha,
    "Original SHA-256: " + prepared.proposal.beforeSha256,
    "Proposed SHA-256: " + prepared.proposal.afterSha256,
    "Handoff ID: " + prepared.proposal.handoffId,
    "Handoff receipt digest: " + prepared.proposal.handoffDigest,
    "Changed lines: -" + prepared.proposal.removedLines +
      " +" + prepared.proposal.addedLines,
    "Scope: one Markdown file, prose only; source document is not modified.",
    "Authority: " + prepared.proposal.authority,
    "Status: " + prepared.proposal.status,
    "",
    prepared.proposal.diff,
    "Proposal SHA-256: " + prepared.proposalDigest,
    "",
  ].join("\n"));
  if (command === "preview") {
    stdout.write("PREVIEW ONLY. No saved draft and no source change.\n");
    return;
  }
  const exact = "DRAFT " + prepared.proposalDigest.slice(0,16);
  const rl = createInterface({ input: stdin, output: stdout });
  let response = "";
  try { response = await rl.question("Type '" + exact +
    "' to store this inert local draft proposal: "); }
  finally { rl.close(); }
  const result = await storeMarkdownDraft({
    ...args, expectedDigest: prepared.proposalDigest, approvalText: response,
  });
  stdout.write(JSON.stringify({
    status: result.record.proposal.status,
    file: result.path,
    handoffId: result.record.proposal.handoffId,
    proposalDigest: result.record.proposalDigest,
    receiptDigest: result.record.receiptDigest,
    note: "No source file touched. No Reality Gate grant or GitHub write occurred.",
  }, null, 2) + "\n");
}
main().catch(error => {
  process.stderr.write("Markdown draft refused: " +
    (error instanceof Error ? error.message : "unknown") + "\n");
  process.exitCode = 1;
});
