/**
 * PHIBOT-41: one exact Reality-Gate-authorized LOCAL working-tree Markdown write.
 * No git add/commit/push, GitHub API, model inference, or network actions.
 *
 * Only a strict operator-scoped ToolCapability is allowed to call apply().
 * An intent is persisted BEFORE mutation; a crash can require manual recovery.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstat, mkdir, open, readFile, realpath, rename, rm, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  listMarkdownDrafts, markdownDraftDir, markdownDiff,
} from "./crew-markdown-draft.js";
import { listReviewHandoffs, prepareReviewHandoff, handoffDir } from "./crew-review-handoff.js";
import { pinnedReviewDir } from "./crew-pinned-review.js";
import { readPinnedDocument } from "./crew-pinned-source.js";
import type { MarkdownDraftProposal, MarkdownDraftRecord } from "./crew-markdown-draft.js";

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, names: string[]) =>
  isObject(v) && Object.keys(v).sort().join(",") === [...names].sort().join(",");

export interface MarkdownApplyIntent {
  schema: "phibot.crew.markdown-apply-intent.v1";
  draftId: string;
  draftReceiptDigest: string;
  proposalDigest: string;
  repoRoot: string;
  commit: string;
  target: string;
  beforeSha256: string;
  afterSha256: string;
  authority: "ONE_LOCAL_FILE_WRITE_NO_GIT_COMMIT_NO_PUSH";
}
export interface MarkdownApplyResult {
  schema: "phibot.crew.markdown-apply-result.v1";
  id: string;
  appliedAt: string;
  intent: MarkdownApplyIntent;
  status: "APPLIED_LOCAL_WORKTREE_UNCOMMITTED_CI_UNVERIFIED";
  actualSha256: string;
  receiptDigest: string;
}
export interface ApplyContext {
  repoDir: string;
  allowedRoots: string[];
  draftDir?: string;
  handoffRecordsDir?: string;
  reviewDir?: string;
}
export const applyLedgerDir = (root: string) => join(root, ".phibot", "crew-markdown-applies");

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", shell: false, windowsHide: true,
    timeout: 3000, maxBuffer: 16384, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
function assertIntent(input: unknown): MarkdownApplyIntent {
  if (!keys(input, [
    "schema", "draftId", "draftReceiptDigest", "proposalDigest", "repoRoot",
    "commit", "target", "beforeSha256", "afterSha256", "authority",
  ])) throw Error("MARKDOWN_APPLY_INTENT_SCHEMA_INVALID");
  const v = input as MarkdownApplyIntent;
  if (v.schema !== "phibot.crew.markdown-apply-intent.v1" ||
      typeof v.draftId !== "string" || !UUID.test(v.draftId) ||
      typeof v.draftReceiptDigest !== "string" || !HEX64.test(v.draftReceiptDigest) ||
      typeof v.proposalDigest !== "string" || !HEX64.test(v.proposalDigest) ||
      typeof v.repoRoot !== "string" || !v.repoRoot.trim() ||
      typeof v.commit !== "string" || !HEX40.test(v.commit) ||
      typeof v.target !== "string" ||
      !/^(?:README\.md|docs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)$/.test(v.target) ||
      typeof v.beforeSha256 !== "string" || !HEX64.test(v.beforeSha256) ||
      typeof v.afterSha256 !== "string" || !HEX64.test(v.afterSha256) ||
      v.authority !== "ONE_LOCAL_FILE_WRITE_NO_GIT_COMMIT_NO_PUSH")
    throw Error("MARKDOWN_APPLY_INTENT_INVALID");
  return structuredClone(v);
}
export function validateMarkdownApplyInput(input: unknown): MarkdownApplyIntent {
  return assertIntent(input);
}

async function trackedTarget(root: string, path: string): Promise<{
  fullPath: string;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number | bigint;
  dev: number | bigint;
  currentSha256: string;
}> {
  const fullPath = resolve(root, path);
  if (!fullPath.startsWith(root + sep))
    throw Error("MARKDOWN_APPLY_TARGET_OUTSIDE_REPO");
  const components = relative(root, dirname(fullPath)).split(sep).filter(Boolean);
  let parent = root;
  for (const component of components) {
    parent = join(parent, component);
    const info = await lstat(parent);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw Error("MARKDOWN_APPLY_PARENT_SYMLINK_OR_NONDIR");
  }
  if (await realpath(dirname(fullPath)) !== dirname(fullPath))
    throw Error("MARKDOWN_APPLY_PARENT_NOT_CANONICAL");
  const info = await lstat(fullPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      (info.mode & 0o111) !== 0 || info.size > 6144)
    throw Error("MARKDOWN_APPLY_TARGET_UNSAFE_FILE");
  if (await realpath(fullPath) !== fullPath)
    throw Error("MARKDOWN_APPLY_TARGET_SYMLINK");
  const bytes = await readFile(fullPath);
  if (bytes.length > 6144) throw Error("MARKDOWN_APPLY_TARGET_OVERSIZE");
  return {
    fullPath, mode: info.mode, size: info.size,
    mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs,
    ino: info.ino, dev: info.dev, currentSha256: hash(bytes),
  };
}
function sameFileRevision(
  a: Awaited<ReturnType<typeof trackedTarget>>,
  b: Awaited<ReturnType<typeof trackedTarget>>,
): boolean {
  return a.dev === b.dev && a.ino === b.ino &&
    a.size === b.size && a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs && a.currentSha256 === b.currentSha256;
}
async function fixedStore(root: string): Promise<string> {
  const dir = applyLedgerDir(root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (await realpath(dir) !== dir) throw Error("MARKDOWN_APPLY_LEDGER_SYMLINK");
  return dir;
}
function checkGitClean(root: string, commit: string, path: string): void {
  if (git(root, ["rev-parse", "HEAD"]) !== commit)
    throw Error("MARKDOWN_APPLY_STALE_HEAD");
  if (git(root, ["status", "--porcelain=v1", "--untracked-files=no", "--", path]) !== "")
    throw Error("MARKDOWN_APPLY_TARGET_DIRTY_OR_STAGED");
}
function checkReplacement(proposal: MarkdownDraftProposal, original: string): void {
  if (original.includes("\r") || proposal.replacement.includes("\r") ||
      proposal.replacement === original ||
      Buffer.byteLength(proposal.replacement, "utf8") > 6144 ||
      proposal.replacement.split("\n").length > 160 ||
      Math.abs(Buffer.byteLength(proposal.replacement) - Buffer.byteLength(original)) > 1500 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(proposal.replacement) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[a-z0-9_]+|ghp_[a-z0-9]{20,}|sk-[a-z0-9]{25,}/i.test(proposal.replacement))
    throw Error("MARKDOWN_APPLY_REPLACEMENT_INVALID");
  const expected = markdownDiff(proposal.source.path, original, proposal.replacement);
  if (proposal.diff !== expected.diff ||
      proposal.addedLines !== expected.addedLines ||
      proposal.removedLines !== expected.removedLines)
    throw Error("MARKDOWN_APPLY_DIFF_MISMATCH");
}

export async function previewMarkdownApply({
  draftId, repoDir, allowedRoots, draftDir = markdownDraftDir(),
  handoffRecordsDir = handoffDir(), reviewDir = pinnedReviewDir(),
}: ApplyContext & { draftId: string }): Promise<{
  intent: MarkdownApplyIntent;
  proposal: MarkdownDraftProposal;
  draft: MarkdownDraftRecord;
}> {
  if (typeof draftId !== "string" || !UUID.test(draftId))
    throw Error("MARKDOWN_APPLY_DRAFT_ID_INVALID");
  const draft = (await listMarkdownDrafts(draftDir)).find(x => x.id === draftId);
  if (!draft) throw Error("MARKDOWN_APPLY_DRAFT_NOT_FOUND");
  const p = draft.proposal;
  const handoff = (await listReviewHandoffs(handoffRecordsDir))
    .find(x => x.id === p.handoffId);
  if (!handoff || handoff.digest !== p.handoffDigest ||
      handoff.proposal.reviewDigest !== p.reviewDigest ||
      handoff.proposal.model !== p.model ||
      JSON.stringify(handoff.proposal.source) !== JSON.stringify(p.source))
    throw Error("MARKDOWN_APPLY_HANDOFF_MISMATCH");
  const linked = await prepareReviewHandoff({
    reviewId: handoff.proposal.reviewId, repoDir, allowedRoots, reviewDir,
  });
  if (linked.proposalDigest !== handoff.proposalDigest ||
      JSON.stringify(linked.proposal) !== JSON.stringify(handoff.proposal))
    throw Error("MARKDOWN_APPLY_REVIEW_MISMATCH");
  const source = await readPinnedDocument({
    repoDir, allowedRoots, commit: p.source.commit, path: p.source.path,
  });
  for (const name of ["repository", "commit", "path", "blobSha", "sha256", "bytes", "trust"] as const)
    if (source[name] !== p.source[name])
      throw Error("MARKDOWN_APPLY_SOURCE_PIN_MISMATCH");
  checkReplacement(p, source.text);
  const root = await realpath(resolve(repoDir));
  checkGitClean(root, p.source.commit, p.source.path);
  const target = await trackedTarget(root, p.source.path);
  if (target.currentSha256 !== p.beforeSha256)
    throw Error("MARKDOWN_APPLY_TARGET_SHA_MISMATCH");
  const intent: MarkdownApplyIntent = {
    schema: "phibot.crew.markdown-apply-intent.v1",
    draftId, draftReceiptDigest: draft.receiptDigest,
    proposalDigest: draft.proposalDigest, repoRoot: root,
    commit: p.source.commit, target: p.source.path,
    beforeSha256: p.beforeSha256, afterSha256: p.afterSha256,
    authority: "ONE_LOCAL_FILE_WRITE_NO_GIT_COMMIT_NO_PUSH",
  };
  return { intent: validateMarkdownApplyInput(intent), proposal: p, draft };
}

export function verifyMarkdownApplyResult(input: unknown): MarkdownApplyResult {
  if (!keys(input, [
    "schema", "id", "appliedAt", "intent", "status", "actualSha256", "receiptDigest",
  ])) throw Error("MARKDOWN_APPLY_RESULT_SCHEMA_INVALID");
  const r = input as MarkdownApplyResult;
  if (r.schema !== "phibot.crew.markdown-apply-result.v1" ||
      typeof r.id !== "string" || !UUID.test(r.id) ||
      typeof r.appliedAt !== "string" || !Number.isFinite(Date.parse(r.appliedAt)) ||
      r.status !== "APPLIED_LOCAL_WORKTREE_UNCOMMITTED_CI_UNVERIFIED" ||
      typeof r.actualSha256 !== "string" || !HEX64.test(r.actualSha256) ||
      typeof r.receiptDigest !== "string" || !HEX64.test(r.receiptDigest))
    throw Error("MARKDOWN_APPLY_RESULT_INVALID");
  validateMarkdownApplyInput(r.intent);
  if (r.actualSha256 !== r.intent.afterSha256)
    throw Error("MARKDOWN_APPLY_RESULT_SHA_INVALID");
  const { receiptDigest, ...withoutHash } = r;
  if (hash(JSON.stringify(withoutHash)) !== receiptDigest)
    throw Error("MARKDOWN_APPLY_RESULT_TAMPERED");
  return structuredClone(r);
}

/** Only called by the separately-registered gated CLI capability. */
export async function applyLocalMarkdown(
  input: unknown, options: {
    allowedRoots: string[];
    draftDir?: string;
    handoffRecordsDir?: string;
    reviewDir?: string;
  },
): Promise<MarkdownApplyResult> {
  const intent = validateMarkdownApplyInput(input);
  const fresh = await previewMarkdownApply({
    draftId: intent.draftId, repoDir: intent.repoRoot,
    allowedRoots: options.allowedRoots,
    ...(options.draftDir === undefined ? {} : { draftDir: options.draftDir }),
    ...(options.handoffRecordsDir === undefined ? {} : { handoffRecordsDir: options.handoffRecordsDir }),
    ...(options.reviewDir === undefined ? {} : { reviewDir: options.reviewDir }),
  });
  if (JSON.stringify(intent) !== JSON.stringify(fresh.intent))
    throw Error("MARKDOWN_APPLY_GRANT_NO_LONGER_MATCHES_EVIDENCE");
  const dir = await fixedStore(intent.repoRoot);
  const intentPath = join(dir, intent.draftId + ".intent.json");
  const resultPath = join(dir, intent.draftId + ".result.json");
  // Durable one-attempt fence before any repository write; recovery is manual.
  await writeFile(intentPath, JSON.stringify({
    schema: "phibot.crew.markdown-apply-attempt.v1",
    createdAt: new Date().toISOString(), intent,
  }, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const targetBefore = await trackedTarget(intent.repoRoot, intent.target);
  if (targetBefore.currentSha256 !== intent.beforeSha256)
    throw Error("MARKDOWN_APPLY_TARGET_CHANGED_AFTER_INTENT");
  const tempPath = join(dirname(targetBefore.fullPath), ".phibot-markdown-" + randomUUID() + ".tmp");
  try {
    const file = await open(tempPath, "wx", targetBefore.mode & 0o777);
    try {
      await file.writeFile(fresh.proposal.replacement, "utf8");
      await file.sync();
    } finally { await file.close(); }
    checkGitClean(intent.repoRoot, intent.commit, intent.target);
    const targetAgain = await trackedTarget(intent.repoRoot, intent.target);
    if (!sameFileRevision(targetBefore, targetAgain))
      throw Error("MARKDOWN_APPLY_TARGET_CHANGED_DURING_PREPARE");
    await rename(tempPath, targetBefore.fullPath);
    // Read back from disk independently of draft packet contents.
    const written = await trackedTarget(intent.repoRoot, intent.target);
    if (written.currentSha256 !== intent.afterSha256)
      throw Error("MARKDOWN_APPLY_POSTWRITE_HASH_MISMATCH_MANUAL_RECOVERY");
    if (git(intent.repoRoot, ["rev-parse", "HEAD"]) !== intent.commit)
      throw Error("MARKDOWN_APPLY_HEAD_CHANGED_MANUAL_RECOVERY");
    const body = {
      schema: "phibot.crew.markdown-apply-result.v1" as const,
      id: randomUUID(), appliedAt: new Date().toISOString(),
      intent, status: "APPLIED_LOCAL_WORKTREE_UNCOMMITTED_CI_UNVERIFIED" as const,
      actualSha256: written.currentSha256,
    };
    const result = verifyMarkdownApplyResult({
      ...body, receiptDigest: hash(JSON.stringify(body)),
    });
    await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n",
      { encoding: "utf8", flag: "wx", mode: 0o600 });
    return result;
  } finally {
    await rm(tempPath, { force: true });
  }
}

/** Separate, read-only verification; a matching hash is NOT a CI pass. */
export async function verifyAppliedMarkdown({
  draftId, repoDir, allowedRoots,
}: { draftId: string; repoDir: string; allowedRoots: string[] }): Promise<{
  status: "LOCAL_FILE_HASH_VERIFIED_CI_NOT_RUN";
  target: string;
  sha256: string;
  draftId: string;
}> {
  if (typeof draftId !== "string" || !UUID.test(draftId))
    throw Error("MARKDOWN_APPLY_VERIFY_ID_INVALID");
  const root = await realpath(resolve(repoDir));
  const roots = await Promise.all(allowedRoots.map(x => realpath(resolve(x))));
  if (!roots.includes(root)) throw Error("MARKDOWN_APPLY_VERIFY_REPO_NOT_ALLOWED");
  const dir = await fixedStore(root);
  const attempt = JSON.parse(await readFile(join(dir, draftId + ".intent.json"), "utf8")) as unknown;
  if (!keys(attempt, ["schema", "createdAt", "intent"]) ||
      attempt.schema !== "phibot.crew.markdown-apply-attempt.v1")
    throw Error("MARKDOWN_APPLY_ATTEMPT_INVALID");
  const intent = validateMarkdownApplyInput(attempt.intent);
  if (intent.draftId !== draftId || intent.repoRoot !== root)
    throw Error("MARKDOWN_APPLY_VERIFY_ID_MISMATCH");
  const file = join(dir, draftId + ".result.json");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
    throw Error("MARKDOWN_APPLY_VERIFY_RESULT_UNSAFE");
  const result = verifyMarkdownApplyResult(JSON.parse(await readFile(file, "utf8")) as unknown);
  if (JSON.stringify(result.intent) !== JSON.stringify(intent))
    throw Error("MARKDOWN_APPLY_VERIFY_INTENT_MISMATCH");
  if (git(root, ["rev-parse", "HEAD"]) !== intent.commit)
    throw Error("MARKDOWN_APPLY_VERIFY_HEAD_MOVED");
  const target = await trackedTarget(root, intent.target);
  if (target.currentSha256 !== intent.afterSha256)
    throw Error("MARKDOWN_APPLY_VERIFY_TARGET_HASH_MISMATCH");
  if (git(root, ["status", "--porcelain=v1", "--untracked-files=no", "--", intent.target]) !==
      "M " + intent.target)
    throw Error("MARKDOWN_APPLY_VERIFY_WORKTREE_STATE_CHANGED");
  return {
    status: "LOCAL_FILE_HASH_VERIFIED_CI_NOT_RUN",
    target: intent.target, sha256: target.currentSha256, draftId,
  };
}
