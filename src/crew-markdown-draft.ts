/**
 * PHIBOT-40: exact, source-bound Markdown replacement proposal only.
 * It never edits the reviewed document, calls a model, runs tools, grants
 * permissions, or sends a GitHub/Reality Gate request.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { listReviewHandoffs, prepareReviewHandoff, handoffDir } from "./crew-review-handoff.js";
import { readPinnedDocument } from "./crew-pinned-source.js";
import type { PinnedSourceProof } from "./crew-pinned-review.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const FILE = /^[A-Za-z0-9_-][A-Za-z0-9_-]{0,79}\.md$/;
const SCOPE = "ONE_PINNED_MARKDOWN_FILE_PROSE_ONLY" as const;
const AUTH = "NO_WRITE_NO_APPLY_NO_GRANT" as const;
const STATUS = "DRAFT_UNAPPLIED_SEPARATE_REALITY_GATE_REQUIRED" as const;
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const canonical = (v: unknown) => sha(JSON.stringify(v));
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const fields = (v: unknown, keys: string[]) =>
  obj(v) && Object.keys(v).sort().join(",") === [...keys].sort().join(",");

export interface MarkdownDraftProposal {
  schema: "phibot.crew.markdown-draft-proposal.v1";
  handoffId: string;
  handoffDigest: string;
  reviewDigest: string;
  source: PinnedSourceProof;
  beforeSha256: string;
  afterSha256: string;
  model: string;
  replacement: string;
  diff: string;
  removedLines: number;
  addedLines: number;
  scope: typeof SCOPE;
  authority: typeof AUTH;
  status: typeof STATUS;
}
export interface MarkdownDraftRecord {
  schema: "phibot.crew.markdown-draft.v1";
  id: string;
  createdAt: string;
  proposal: MarkdownDraftProposal;
  proposalDigest: string;
  classification: "LOCAL_OPERATOR_RECORDED_NOT_WRITE_APPROVED";
  receiptDigest: string;
}
export const markdownDraftDir = () => resolve(".phibot", "crew-markdown-drafts");

function validateReplacement(text: string, original: string): string {
  // Replacement line endings are canonical LF; original must already be LF
  // so the proposed change cannot silently rewrite a whole CRLF document.
  if (original.includes("\r")) throw Error("CREW_DRAFT_ORIGINAL_CRLF_UNSUPPORTED");
  const candidate = text.replace(/\r\n/g, "\n");
  if (candidate.includes("\r") || !candidate.trim() ||
      Buffer.byteLength(candidate, "utf8") > 6144 ||
      candidate.split("\n").length > 160 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(candidate) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[a-z0-9_]+|ghp_[a-z0-9]{20,}|sk-[a-z0-9]{25,}/i.test(candidate))
    throw Error("CREW_DRAFT_CONTENT_INVALID");
  if (candidate === original) throw Error("CREW_DRAFT_NO_CHANGE");
  if (Math.abs(Buffer.byteLength(candidate) - Buffer.byteLength(original)) > 1500)
    throw Error("CREW_DRAFT_BYTE_DELTA_EXCEEDED");
  return candidate;
}

export function markdownDiff(path: string, original: string, replacement: string): {
  diff: string; removedLines: number; addedLines: number;
} {
  const a = original.split("\n"), b = replacement.split("\n");
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
         a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  if (Math.max(removed.length, added.length) > 16)
    throw Error("CREW_DRAFT_CHANGED_LINES_EXCEEDED");
  const leftContext = a.slice(Math.max(0, prefix - 2), prefix);
  const rightContext = suffix ? a.slice(a.length - suffix, a.length - suffix + Math.min(2, suffix)) : [];
  const start = prefix - leftContext.length + 1;
  const oldCount = leftContext.length + removed.length + rightContext.length;
  const newCount = leftContext.length + added.length + rightContext.length;
  const rendered = [
    "--- a/" + path, "+++ b/" + path,
    "@@ -" + start + "," + oldCount + " +" + start + "," + newCount + " @@",
    ...leftContext.map(v => " " + v),
    ...removed.map(v => "-" + v),
    ...added.map(v => "+" + v),
    ...rightContext.map(v => " " + v),
  ].join("\n") + "\n";
  if (Buffer.byteLength(rendered, "utf8") > 4096)
    throw Error("CREW_DRAFT_DIFF_TOO_LARGE");
  return { diff: rendered, removedLines: removed.length, addedLines: added.length };
}

async function localReplacement(repoDir: string, filename: string): Promise<string> {
  const root = await realpath(resolve(repoDir));
  const path = resolve(filename);
  if (!FILE.test(basename(path)) ||
      dirname(path) !== join(root, ".phibot", "crew-drafts"))
    throw Error("CREW_DRAFT_FILE_OUTSIDE_LOCAL_DRAFT_DIR");
  const base = await realpath(dirname(path));
  if (base !== join(root, ".phibot", "crew-drafts"))
    throw Error("CREW_DRAFT_DIR_SYMLINK_REJECTED");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 6144)
    throw Error("CREW_DRAFT_FILE_INVALID");
  if (await realpath(path) !== path)
    throw Error("CREW_DRAFT_FILE_SYMLINK_REJECTED");
  const bytes = await readFile(path);
  if (bytes.length > 6144) throw Error("CREW_DRAFT_FILE_OVERSIZE");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw Error("CREW_DRAFT_FILE_UTF8_INVALID"); }
}

export function verifyMarkdownDraftProposal(input: unknown): MarkdownDraftProposal {
  if (!fields(input, [
    "schema", "handoffId", "handoffDigest", "reviewDigest", "source",
    "beforeSha256", "afterSha256", "model", "replacement", "diff",
    "removedLines", "addedLines", "scope", "authority", "status",
  ])) throw Error("CREW_DRAFT_PROPOSAL_SCHEMA_INVALID");
  const p = input as MarkdownDraftProposal;
  if (p.schema !== "phibot.crew.markdown-draft-proposal.v1" ||
      !UUID.test(p.handoffId) || !SHA.test(p.handoffDigest) ||
      !SHA.test(p.reviewDigest) || !SHA.test(p.beforeSha256) ||
      !SHA.test(p.afterSha256) || p.scope !== SCOPE ||
      p.authority !== AUTH || p.status !== STATUS ||
      typeof p.model !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/.test(p.model) ||
      !fields(p.source, ["repository", "commit", "path", "blobSha", "sha256", "bytes", "trust"]) ||
      !/^[a-f0-9]{40}$/.test(p.source.commit) ||
      !/^[a-f0-9]{40}$/.test(p.source.blobSha) ||
      typeof p.source.sha256 !== "string" || !SHA.test(p.source.sha256) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(p.source.repository) ||
      !/^(?:README\.md|docs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)$/.test(p.source.path) ||
      p.source.trust !== "LOCAL_GIT_COMMIT_NOT_REMOTE_ATTESTED" ||
      !Number.isInteger(p.source.bytes) || p.source.bytes < 1 ||
      p.source.bytes > 6144 || p.beforeSha256 !== p.source.sha256 ||
      typeof p.replacement !== "string" ||
      sha(p.replacement) !== p.afterSha256 ||
      typeof p.diff !== "string" || Buffer.byteLength(p.diff) > 4096 ||
      !Number.isInteger(p.removedLines) || p.removedLines < 0 ||
      p.removedLines > 16 || !Number.isInteger(p.addedLines) ||
      p.addedLines < 0 || p.addedLines > 16 ||
      p.removedLines + p.addedLines === 0)
    throw Error("CREW_DRAFT_PROPOSAL_INVALID");
  // With the original Git snapshot unavailable to the verifier, the receipt
  // hash checks packet consistency; prepare() rechecks the live pinned blob.
  if (!p.replacement.trim() || Buffer.byteLength(p.replacement) > 6144 ||
      p.replacement.split("\n").length > 160 ||
      /[\u0000-\u0008\u000b\u000c\u000d\u000e-\u001f\u007f]/.test(p.replacement))
    throw Error("CREW_DRAFT_REPLACEMENT_INVALID");
  return structuredClone(p);
}
export function verifyMarkdownDraftRecord(input: unknown): MarkdownDraftRecord {
  if (!fields(input, [
    "schema", "id", "createdAt", "proposal", "proposalDigest",
    "classification", "receiptDigest",
  ])) throw Error("CREW_DRAFT_RECORD_SCHEMA_INVALID");
  const r = input as MarkdownDraftRecord;
  if (r.schema !== "phibot.crew.markdown-draft.v1" ||
      !UUID.test(r.id) || !Number.isFinite(Date.parse(r.createdAt)) ||
      r.classification !== "LOCAL_OPERATOR_RECORDED_NOT_WRITE_APPROVED" ||
      !SHA.test(r.proposalDigest) || !SHA.test(r.receiptDigest))
    throw Error("CREW_DRAFT_RECORD_INVALID");
  verifyMarkdownDraftProposal(r.proposal);
  if (canonical(r.proposal) !== r.proposalDigest)
    throw Error("CREW_DRAFT_PROPOSAL_DIGEST_MISMATCH");
  const { receiptDigest, ...body } = r;
  if (canonical(body) !== receiptDigest)
    throw Error("CREW_DRAFT_RECORD_DIGEST_MISMATCH");
  return structuredClone(r);
}

export async function prepareMarkdownDraft({
  handoffId, repoDir, allowedRoots, replacementFile,
  handoffRecordsDir = handoffDir(),
  reviewDir,
}: {
  handoffId: string; repoDir: string; allowedRoots: string[];
  replacementFile: string; handoffRecordsDir?: string; reviewDir?: string;
}): Promise<{ proposal: MarkdownDraftProposal; proposalDigest: string }> {
  if (!UUID.test(handoffId)) throw Error("CREW_DRAFT_HANDOFF_ID_INVALID");
  const handoff = (await listReviewHandoffs(handoffRecordsDir))
    .find(v => v.id === handoffId);
  if (!handoff) throw Error("CREW_DRAFT_HANDOFF_NOT_FOUND");
  const originalReview = await prepareReviewHandoff({
    reviewId: handoff.proposal.reviewId, repoDir, allowedRoots,
    ...(reviewDir === undefined ? {} : { reviewDir }),
  });
  if (handoff.proposalDigest !== originalReview.proposalDigest ||
      JSON.stringify(handoff.proposal) !== JSON.stringify(originalReview.proposal))
    throw Error("CREW_DRAFT_HANDOFF_REVIEW_MISMATCH");
  const source = await readPinnedDocument({
    repoDir, allowedRoots, commit: handoff.proposal.source.commit,
    path: handoff.proposal.source.path,
  });
  for (const key of ["repository", "commit", "path", "blobSha", "sha256", "bytes", "trust"] as const)
    if (source[key] !== handoff.proposal.source[key])
      throw Error("CREW_DRAFT_PIN_MISMATCH");
  const input = await localReplacement(repoDir, replacementFile);
  const replacement = validateReplacement(input, source.text);
  const changes = markdownDiff(source.path, source.text, replacement);
  const proposal: MarkdownDraftProposal = {
    schema: "phibot.crew.markdown-draft-proposal.v1",
    handoffId, handoffDigest: handoff.digest,
    reviewDigest: handoff.proposal.reviewDigest,
    source: structuredClone(handoff.proposal.source),
    beforeSha256: source.sha256, afterSha256: sha(replacement),
    model: handoff.proposal.model, replacement, ...changes,
    scope: SCOPE, authority: AUTH, status: STATUS,
  };
  return { proposal: verifyMarkdownDraftProposal(proposal),
    proposalDigest: canonical(proposal) };
}

export async function storeMarkdownDraft({
  handoffId, repoDir, allowedRoots, replacementFile,
  expectedDigest, approvalText,
  handoffRecordsDir, reviewDir, dir = markdownDraftDir(),
  now = () => new Date(),
}: {
  handoffId: string; repoDir: string; allowedRoots: string[];
  replacementFile: string; expectedDigest: string; approvalText: string;
  handoffRecordsDir?: string; reviewDir?: string; dir?: string; now?: () => Date;
}): Promise<{ record: MarkdownDraftRecord; path: string }> {
  if (!SHA.test(expectedDigest) ||
      approvalText !== "DRAFT " + expectedDigest.slice(0, 16))
    throw Error("CREW_DRAFT_OPERATOR_ACK_REQUIRED");
  // Recheck original review, source and replacement after the terminal prompt.
  const prepared = await prepareMarkdownDraft({
    handoffId, repoDir, allowedRoots, replacementFile,
    ...(handoffRecordsDir === undefined ? {} : { handoffRecordsDir }),
    ...(reviewDir === undefined ? {} : { reviewDir }),
  });
  if (prepared.proposalDigest !== expectedDigest)
    throw Error("CREW_DRAFT_REPLACEMENT_CHANGED_SINCE_PREVIEW");
  const time = now();
  if (!(time instanceof Date) || !Number.isFinite(time.getTime()))
    throw Error("CREW_DRAFT_CLOCK_INVALID");
  const body = {
    schema: "phibot.crew.markdown-draft.v1" as const,
    id: randomUUID(), createdAt: time.toISOString(),
    proposal: prepared.proposal, proposalDigest: expectedDigest,
    classification: "LOCAL_OPERATOR_RECORDED_NOT_WRITE_APPROVED" as const,
  };
  const record = verifyMarkdownDraftRecord({ ...body, receiptDigest: canonical(body) });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Immutable one-per-human-handoff. No overwrite/replay.
  const path = join(dir, handoffId + ".json");
  await writeFile(path, JSON.stringify(record, null, 2) + "\n",
    { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { record, path };
}

export async function listMarkdownDrafts(dir = markdownDraftDir()): Promise<MarkdownDraftRecord[]> {
  let names: string[];
  try { names = await readdir(dir); }
  catch (e: unknown) { if (obj(e) && e.code === "ENOENT") return []; throw e; }
  if (names.length > 100 || names.some(v =>
      !/^[0-9a-f-]{36}\.json$/.test(v))) throw Error("CREW_DRAFT_DIRECTORY_INVALID");
  const records: MarkdownDraftRecord[] = [];
  for (const name of names.sort()) {
    const path = join(dir, name);
    if ((await stat(path)).size > 17000) throw Error("CREW_DRAFT_PACKET_OVERSIZE");
    const record = verifyMarkdownDraftRecord(JSON.parse(await readFile(path, "utf8")) as unknown);
    if (name !== record.proposal.handoffId + ".json")
      throw Error("CREW_DRAFT_FILENAME_INVALID");
    records.push(record);
  }
  return records.reverse();
}
