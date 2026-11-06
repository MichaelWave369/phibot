#!/usr/bin/env node
/**
 * PHIBOT-39: explicit local operator acknowledgement of three advisory summaries.
 * Does not issue a Reality Gate grant, prepare a source replacement, or execute Git.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  prepareReviewHandoff, acknowledgeReviewHandoff, listReviewHandoffs,
} from "./crew-review-handoff.js";

interface Options { reviewId: string; repoDir: string; allowedRoots: string[] }
function options(argv: string[]): Options {
  if (argv.length !== 4) throw Error(
    "Usage: crew:handoff:preview or crew:handoff:review -- --review <uuid> --repo <local-repo>",
  );
  const fields: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key || !value || !["--review", "--repo"].includes(key) ||
        fields[key] !== undefined) throw Error("CREW_HANDOFF_CLI_ARGS_INVALID");
    fields[key] = value;
  }
  const reviewId = fields["--review"], repoDir = fields["--repo"];
  if (!reviewId || !repoDir) throw Error("CREW_HANDOFF_CLI_REQUIRED");
  const rawRoots = process.env.PHIBOT_CREW_REPO_ALLOWLIST;
  if (!rawRoots) throw Error("CREW_HANDOFF_REPO_ALLOWLIST_REQUIRED");
  return { reviewId, repoDir,
    allowedRoots: rawRoots.split(";").map(x => x.trim()).filter(Boolean) };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0];
  if (command === "list" && argv.length === 1) {
    const records = await listReviewHandoffs();
    console.log(JSON.stringify({
      classification: "LOCAL_TTY_ACKNOWLEDGEMENT_NOT_IDENTITY_ATTESTED",
      records: records.map(r => ({
        id: r.id, reviewId: r.proposal.reviewId, createdAt: r.createdAt,
        source: r.proposal.source, model: r.proposal.model,
        status: r.status, proposalDigest: r.proposalDigest, digest: r.digest,
      })),
    }, null, 2));
    return;
  }
  if (command !== "preview" && command !== "review")
    throw Error("CREW_HANDOFF_COMMAND_INVALID");
  const { reviewId, repoDir, allowedRoots } = options(argv.slice(1));
  if (command === "review" && (!stdin.isTTY || !stdout.isTTY))
    throw Error("CREW_HANDOFF_INTERACTIVE_TTY_REQUIRED");
  const { proposal, proposalDigest } = await prepareReviewHandoff({
    reviewId, repoDir, allowedRoots,
  });
  const displayed = [
    "PHIBOT-39 / SOURCE-PINNED HUMAN REVIEW",
    "Repository: " + proposal.source.repository,
    "Commit: " + proposal.source.commit,
    "Markdown: " + proposal.source.path,
    "Blob: " + proposal.source.blobSha,
    "Source SHA-256: " + proposal.source.sha256,
    "Crew review ID: " + proposal.reviewId,
    "Crew review digest: " + proposal.reviewDigest,
    "Local model: " + proposal.model,
    "",
    "Scout (UNVERIFIED): " + proposal.scoutAdvisory,
    "Patch suggestion (UNVERIFIED): " + proposal.patchAdvisory,
    "Skeptic critique (UNVERIFIED): " + proposal.skepticAdvisory,
    "",
    "Scope: one Markdown file, prose-only review.",
    "No executable patch, code generation, commits, GitHub write, Reality Gate",
    "grant, deployment, merge, or permission escalation will happen.",
    "This acknowledgement is not proof of operator identity or source correctness.",
    "Proposal SHA-256: " + proposalDigest,
    "",
  ].join("\n");
  stdout.write(displayed);
  if (command === "preview") {
    stdout.write("PREVIEW ONLY. No acknowledgement stored.\n");
    return;
  }
  const required = "REVIEW " + proposalDigest.slice(0, 16);
  const io = createInterface({ input: stdin, output: stdout });
  let answer: string;
  try { answer = await io.question("Type exactly '" + required +
    "' to store an inert local review handoff: "); }
  finally { io.close(); }
  const result = await acknowledgeReviewHandoff({
    reviewId, repoDir, allowedRoots, approvalText: answer,
  });
  stdout.write(JSON.stringify({
    status: result.record.status, proposalDigest: result.record.proposalDigest,
    receiptDigest: result.record.digest, path: result.path,
    authority: result.record.proposal.authority,
    nextAction: "Human drafting and a separate governed repair approval, if ever warranted.",
  }, null, 2) + "\n");
}
main().catch(error => {
  process.stderr.write("Crew handoff refused: " +
    (error instanceof Error ? error.message : "unknown") + "\n");
  process.exitCode = 1;
});
