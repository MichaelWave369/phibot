#!/usr/bin/env node
/**
 * PHIBOT-38 local manual pinned documentation crew review.
 * No web API listener, credentials, repository mutation or autonomous trigger.
 */
import { runPinnedReview, listPinnedReviews } from "./crew-pinned-review.js";

function options(argv: string[]): {
  repoDir: string; commit: string; filePath: string; model: string;
  port: number; timeoutMs: number; allowedRoots: string[];
} {
  const fields: Record<string, string> = {};
  if (argv.length < 8 || argv.length > 12 || argv.length % 2 !== 0)
    throw Error("Usage: crew:pinned -- --repo <dir> --commit <40-char-sha> --file <docs/file.md> --model <tag> [--port 11434] [--timeout-ms 45000]");
  const allowed = new Set(["--repo", "--commit", "--file", "--model", "--port", "--timeout-ms"]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], val = argv[i + 1];
    if (!key || !val || !allowed.has(key) || fields[key] !== undefined)
      throw Error("CREW_PINNED_CLI_INVALID");
    fields[key] = val;
  }
  const repoDir = fields["--repo"], commit = fields["--commit"];
  const filePath = fields["--file"], model = fields["--model"];
  if (!repoDir || !commit || !filePath || !model)
    throw Error("CREW_PINNED_CLI_REQUIRED_FIELDS_MISSING");
  const rawPort = fields["--port"] ?? "11434";
  const rawTimeout = fields["--timeout-ms"] ?? "45000";
  if (!/^[0-9]{1,5}$/.test(rawPort) ||
      !/^[0-9]{4,5}$/.test(rawTimeout))
    throw Error("CREW_PINNED_CLI_NUMERIC_INVALID");
  const rawAllowlist = process.env.PHIBOT_CREW_REPO_ALLOWLIST;
  if (!rawAllowlist) throw Error("CREW_PINNED_EXPLICIT_REPO_ALLOWLIST_REQUIRED");
  const allowedRoots = rawAllowlist.split(";").map(s => s.trim()).filter(Boolean);
  return { repoDir, commit, filePath, model,
    port: Number(rawPort), timeoutMs: Number(rawTimeout), allowedRoots };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length === 1 && argv[0] === "list") {
    const records = await listPinnedReviews();
    console.log(JSON.stringify({
      classification: "LOCAL_PINNED_DOC_SELF_REPORT_NOT_ATTESTED",
      records: records.map(v => ({
        id: v.id, checkedAt: v.checkedAt, model: v.model,
        repository: v.source.repository, commit: v.source.commit,
        path: v.source.path, sha256: v.source.sha256,
        status: v.status, digest: v.digest,
      })),
    }, null, 2));
    return;
  }
  if (argv[0] !== "run") throw Error("CREW_PINNED_COMMAND_INVALID");
  const params = options(argv.slice(1));
  console.log("PHIBOT-38: local pinned Markdown advisory only. No files modified, tools dispatched or grants issued.");
  const result = await runPinnedReview(params);
  console.log(JSON.stringify(result, null, 2));
  if (result.record.status !== "THREE_ADVISORIES_UNVERIFIED")
    process.exitCode = 2;
}
main().catch(error => {
  console.error("Pinned crew review refused: " +
    (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
});
