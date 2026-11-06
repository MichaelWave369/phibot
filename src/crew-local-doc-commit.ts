/**
 * PHIBOT-42: one operator-approved local Git commit of an already applied,
 * independently verified Markdown draft. No push, PR, CI, deploy or merge.
 * Registered ONLY by the explicit terminal operator command, not builtins.
 *
 * Uses a strictly bounded Git index update and commit-tree/update-ref, rather
 * than invoking hooks, an editor or a shell. A crash after staging or updating
 * HEAD can leave ambiguous state; the prewritten one-attempt fence is retained.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  applyLedgerDir, verifyAppliedMarkdown, verifyMarkdownApplyResult,
  type MarkdownApplyResult,
} from "./crew-markdown-apply.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BRANCH = /^phibot\/docs-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const sha256 = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const exact = (x: unknown, keys: string[]): x is Record<string, unknown> =>
  record(x) && Object.keys(x).sort().join(",") === [...keys].sort().join(",");

export interface LocalDocCommitIntent {
  schema: "phibot.crew.local-doc-commit-intent.v1";
  repoRoot: string;
  branch: string;
  draftId: string;
  applyReceiptDigest: string;
  oldHead: string;
  target: string;
  expectedSha256: string;
  message: string;
  authority: "ONE_LOCAL_BRANCH_COMMIT_NO_PUSH_NO_MERGE";
}
export interface LocalDocCommitResult {
  schema: "phibot.crew.local-doc-commit-result.v1";
  id: string;
  committedAt: string;
  intent: LocalDocCommitIntent;
  newHead: string;
  tree: string;
  blob: string;
  status: "LOCAL_COMMIT_CREATED_NOT_PUSHED_CI_UNVERIFIED";
  digest: string;
}
export const localDocCommitDir = (repoRoot: string) =>
  join(repoRoot, ".phibot", "crew-local-commits");

function checkGitEnvironment(): void {
  for (const key of [
    "GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR",
    "GIT_NAMESPACE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS",
  ]) {
    if (process.env[key] !== undefined)
      throw Error("CREW_COMMIT_GIT_ENV_OVERRIDE_REFUSED");
  }
}
function git(
  root: string, args: string[], options: { input?: Buffer; maxBuffer?: number } = {},
): string {
  checkGitEnvironment();
  return execFileSync("git", ["-C", root, ...args], {
    shell: false, windowsHide: true, timeout: 5000,
    maxBuffer: options.maxBuffer ?? 16384,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    ...(options.input === undefined ? {} : { input: options.input }),
  }).trim();
}
async function canonicalRoot(repoDir: string, allowedRoots: string[]): Promise<string> {
  if (!Array.isArray(allowedRoots) || allowedRoots.length < 1 ||
      allowedRoots.length > 12 || allowedRoots.some(x => typeof x !== "string" || !x.trim()))
    throw Error("CREW_COMMIT_ALLOWLIST_REQUIRED");
  const root = await realpath(resolve(repoDir));
  const allowed = await Promise.all(allowedRoots.map(x => realpath(resolve(x))));
  if (!allowed.includes(root))
    throw Error("CREW_COMMIT_REPO_NOT_ALLOWLISTED");
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (await realpath(resolve(top)) !== root)
    throw Error("CREW_COMMIT_REPO_TOPLEVEL_REQUIRED");
  if (git(root, ["rev-parse", "--is-bare-repository"]) !== "false" ||
      git(root, ["rev-parse", "--show-object-format"]) !== "sha1")
    throw Error("CREW_COMMIT_UNSUPPORTED_GIT_REPOSITORY");
  return root;
}
function branchName(root: string): string {
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!BRANCH.test(branch) || branch.includes("..") || branch.endsWith(".lock"))
    throw Error("CREW_COMMIT_DEDICATED_BRANCH_REQUIRED");
  return branch;
}
async function validatedLocalFile(path: string, maxBytes: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      info.size < 1 || info.size > maxBytes)
    throw Error("CREW_COMMIT_UNSAFE_LOCAL_FILE");
  const bytes = await readFile(path);
  if (bytes.length < 1 || bytes.length > maxBytes)
    throw Error("CREW_COMMIT_LOCAL_FILE_SIZE_INVALID");
  return bytes;
}
function worktreeStatus(root: string, target: string): void {
  // Unlike a trimmed path-only result, the leading XY status columns matter:
  // " M" is ONLY an unstaged modification, never a staged change.
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=normal"]).trimEnd();
  if (status !== " M " + target)
    throw Error("CREW_COMMIT_UNRELATED_CHANGES_OR_STAGED_CONTENT");
  if (git(root, ["diff", "--check", "--", target]) !== "")
    throw Error("CREW_COMMIT_WHITESPACE_CHECK_FAILED");
}
async function readAppliedResult(root: string, draftId: string): Promise<MarkdownApplyResult> {
  const file = join(applyLedgerDir(root), draftId + ".result.json");
  return verifyMarkdownApplyResult(
    JSON.parse((await validatedLocalFile(file, 8192)).toString("utf8")) as unknown,
  );
}
export function validateLocalDocCommitIntent(value: unknown): LocalDocCommitIntent {
  if (!exact(value, [
    "schema", "repoRoot", "branch", "draftId", "applyReceiptDigest",
    "oldHead", "target", "expectedSha256", "message", "authority",
  ])) throw Error("CREW_COMMIT_INTENT_SCHEMA_INVALID");
  const v = value as unknown as LocalDocCommitIntent;
  if (v.schema !== "phibot.crew.local-doc-commit-intent.v1" ||
      typeof v.repoRoot !== "string" || !v.repoRoot.trim() ||
      typeof v.branch !== "string" || !BRANCH.test(v.branch) ||
      v.branch.includes("..") || v.branch.endsWith(".lock") ||
      typeof v.draftId !== "string" || !UUID.test(v.draftId) ||
      typeof v.applyReceiptDigest !== "string" || !HEX64.test(v.applyReceiptDigest) ||
      typeof v.oldHead !== "string" || !HEX40.test(v.oldHead) ||
      typeof v.target !== "string" ||
      !/^(?:README\.md|docs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)$/.test(v.target) ||
      typeof v.expectedSha256 !== "string" || !HEX64.test(v.expectedSha256) ||
      v.message !== "docs(phi): approved crew draft " + v.draftId.slice(0, 8) ||
      v.authority !== "ONE_LOCAL_BRANCH_COMMIT_NO_PUSH_NO_MERGE")
    throw Error("CREW_COMMIT_INTENT_INVALID");
  return structuredClone(v);
}

export async function previewLocalDocCommit({
  draftId, repoDir, allowedRoots,
}: { draftId: string; repoDir: string; allowedRoots: string[] }): Promise<{
  intent: LocalDocCommitIntent;
  apply: MarkdownApplyResult;
}> {
  if (typeof draftId !== "string" || !UUID.test(draftId))
    throw Error("CREW_COMMIT_DRAFT_ID_INVALID");
  const root = await canonicalRoot(repoDir, allowedRoots);
  const branch = branchName(root);
  // A PHIBOT-41 local-file hash receipt is necessary but not permission.
  const observed = await verifyAppliedMarkdown({
    draftId, repoDir: root, allowedRoots,
  });
  const applied = await readAppliedResult(root, draftId);
  if (applied.intent.repoRoot !== root || applied.intent.draftId !== draftId ||
      applied.intent.target !== observed.target ||
      applied.intent.afterSha256 !== observed.sha256 ||
      applied.intent.commit !== git(root, ["rev-parse", "HEAD"]))
    throw Error("CREW_COMMIT_APPLY_EVIDENCE_MISMATCH");
  worktreeStatus(root, observed.target);
  const intent: LocalDocCommitIntent = {
    schema: "phibot.crew.local-doc-commit-intent.v1",
    repoRoot: root, branch, draftId,
    applyReceiptDigest: applied.receiptDigest,
    oldHead: applied.intent.commit, target: observed.target,
    expectedSha256: observed.sha256,
    message: "docs(phi): approved crew draft " + draftId.slice(0, 8),
    authority: "ONE_LOCAL_BRANCH_COMMIT_NO_PUSH_NO_MERGE",
  };
  return { intent: validateLocalDocCommitIntent(intent), apply: applied };
}

export function verifyLocalDocCommitResult(value: unknown): LocalDocCommitResult {
  if (!exact(value, [
    "schema", "id", "committedAt", "intent", "newHead", "tree",
    "blob", "status", "digest",
  ])) throw Error("CREW_COMMIT_RESULT_SCHEMA_INVALID");
  const v = value as unknown as LocalDocCommitResult;
  if (v.schema !== "phibot.crew.local-doc-commit-result.v1" ||
      typeof v.id !== "string" || !UUID.test(v.id) ||
      typeof v.committedAt !== "string" || !Number.isFinite(Date.parse(v.committedAt)) ||
      typeof v.newHead !== "string" || !HEX40.test(v.newHead) ||
      typeof v.tree !== "string" || !HEX40.test(v.tree) ||
      typeof v.blob !== "string" || !HEX40.test(v.blob) ||
      v.status !== "LOCAL_COMMIT_CREATED_NOT_PUSHED_CI_UNVERIFIED" ||
      typeof v.digest !== "string" || !HEX64.test(v.digest))
    throw Error("CREW_COMMIT_RESULT_INVALID");
  validateLocalDocCommitIntent(v.intent);
  const { digest, ...body } = v;
  if (sha256(JSON.stringify(body)) !== digest)
    throw Error("CREW_COMMIT_RESULT_TAMPERED");
  return structuredClone(v);
}

async function fenceDir(root: string): Promise<string> {
  const dir = localDocCommitDir(root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (await realpath(dir) !== dir)
    throw Error("CREW_COMMIT_LEDGER_DIR_SYMLINK");
  return dir;
}

/** Called ONLY as the body of the separately gated, CLI-only capability. */
export async function commitLocalDoc(
  value: unknown, allowedRoots: string[],
): Promise<LocalDocCommitResult> {
  const intent = validateLocalDocCommitIntent(value);
  const fresh = await previewLocalDocCommit({
    draftId: intent.draftId, repoDir: intent.repoRoot, allowedRoots,
  });
  if (JSON.stringify(intent) !== JSON.stringify(fresh.intent))
    throw Error("CREW_COMMIT_APPROVAL_NO_LONGER_MATCHES");
  if (git(intent.repoRoot, ["config", "--get", "user.name"]).length < 1 ||
      git(intent.repoRoot, ["config", "--get", "user.email"]).length < 3)
    throw Error("CREW_COMMIT_GIT_IDENTITY_REQUIRED");
  const dir = await fenceDir(intent.repoRoot);
  const fence = join(dir, intent.draftId + ".intent.json");
  const output = join(dir, intent.draftId + ".result.json");
  // One attempt per draft, written BEFORE staging, object writes or ref updates.
  await writeFile(fence, JSON.stringify({
    schema: "phibot.crew.local-doc-commit-attempt.v1",
    createdAt: new Date().toISOString(), intent,
  }, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const root = intent.repoRoot;
  // No shell, commit hooks, commit editor or remote I/O.
  // The actual blob bytes MUST equal the human-approved PHIBOT-41 SHA-256.
  worktreeStatus(root, intent.target);
  const bytes = await validatedLocalFile(join(root, ...intent.target.split("/")), 6144);
  if (sha256(bytes) !== intent.expectedSha256)
    throw Error("CREW_COMMIT_TARGET_CHANGED_AFTER_FENCE");
  if (git(root, ["rev-parse", "HEAD"]) !== intent.oldHead ||
      branchName(root) !== intent.branch)
    throw Error("CREW_COMMIT_HEAD_CHANGED_AFTER_FENCE");
  const blob = git(root, ["hash-object", "-w", "--stdin"], { input: bytes });
  if (!HEX40.test(blob)) throw Error("CREW_COMMIT_BLOB_INVALID");
  // Update only the explicitly allowed target in the local index.
  git(root, ["update-index", "--add", "--cacheinfo", "100644," + blob + "," + intent.target]);
  const tree = git(root, ["write-tree"]);
  if (!HEX40.test(tree)) throw Error("CREW_COMMIT_TREE_INVALID");
  const changed = git(root, ["diff-tree", "--no-commit-id", "--name-only",
    "-r", intent.oldHead, tree]);
  if (changed !== intent.target)
    throw Error("CREW_COMMIT_TREE_MULTIFILE_OR_DIFFERENT_CHANGE");
  if (git(root, ["ls-files", "--stage", "--", intent.target]) !==
      "100644 " + blob + " 0\t" + intent.target)
    throw Error("CREW_COMMIT_INDEX_BLOB_MISMATCH");
  if (git(root, ["rev-parse", "HEAD"]) !== intent.oldHead ||
      branchName(root) !== intent.branch)
    throw Error("CREW_COMMIT_HEAD_MOVED_BEFORE_COMMIT");
  const newHead = git(root, ["-c", "commit.gpgsign=false",
    "commit-tree", tree, "-p", intent.oldHead, "-m", intent.message]);
  if (!HEX40.test(newHead)) throw Error("CREW_COMMIT_CREATED_OBJECT_INVALID");
  const detail = git(root, ["cat-file", "-p", newHead]);
  if (!detail.startsWith("tree " + tree + "\nparent " + intent.oldHead + "\n"))
    throw Error("CREW_COMMIT_PARENT_OR_TREE_INVALID");
  // Atomic compare-and-swap protects the branch ref against another update.
  git(root, ["update-ref", "refs/heads/" + intent.branch, newHead, intent.oldHead]);
  if (git(root, ["rev-parse", "HEAD"]) !== newHead)
    throw Error("CREW_COMMIT_POSTREF_AMBIGUOUS");
  if (git(root, ["status", "--porcelain=v1", "--untracked-files=normal"]) !== "")
    throw Error("CREW_COMMIT_POSTREF_DIRTY_MANUAL_RECOVERY");
  const committedBlob = git(root, ["rev-parse", newHead + ":" + intent.target]);
  if (committedBlob !== blob ||
      sha256(Buffer.from(execFileSync("git",
        ["-C", root, "cat-file", "blob", committedBlob], {
          timeout: 5000, maxBuffer: 8192,
          stdio: ["ignore", "pipe", "ignore"],
        }))) !== intent.expectedSha256)
    throw Error("CREW_COMMIT_POSTWRITE_BLOB_MISMATCH");
  const body = {
    schema: "phibot.crew.local-doc-commit-result.v1" as const,
    id: randomUUID(), committedAt: new Date().toISOString(),
    intent, newHead, tree, blob,
    status: "LOCAL_COMMIT_CREATED_NOT_PUSHED_CI_UNVERIFIED" as const,
  };
  const result = verifyLocalDocCommitResult({
    ...body, digest: sha256(JSON.stringify(body)),
  });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n",
    { encoding: "utf8", flag: "wx", mode: 0o600 });
  return result;
}

/** Read-only, independent local verification. No remote CI claim. */
export async function verifyLocalDocCommit({
  draftId, repoDir, allowedRoots,
}: { draftId: string; repoDir: string; allowedRoots: string[] }): Promise<{
  status: "LOCAL_COMMIT_HASH_VERIFIED_REMOTE_CI_UNKNOWN";
  branch: string;
  commit: string;
  parent: string;
  target: string;
  sha256: string;
}> {
  if (typeof draftId !== "string" || !UUID.test(draftId))
    throw Error("CREW_COMMIT_VERIFY_DRAFT_ID_INVALID");
  const root = await canonicalRoot(repoDir, allowedRoots);
  const dir = localDocCommitDir(root);
  const attempt = JSON.parse(
    (await validatedLocalFile(join(dir, draftId + ".intent.json"), 4096)).toString("utf8"),
  ) as unknown;
  if (!exact(attempt, ["schema", "createdAt", "intent"]) ||
      attempt.schema !== "phibot.crew.local-doc-commit-attempt.v1")
    throw Error("CREW_COMMIT_VERIFY_ATTEMPT_INVALID");
  const intent = validateLocalDocCommitIntent(attempt.intent);
  if (intent.repoRoot !== root || intent.draftId !== draftId)
    throw Error("CREW_COMMIT_VERIFY_ATTEMPT_MISMATCH");
  const result = verifyLocalDocCommitResult(
    JSON.parse((await validatedLocalFile(join(dir, draftId + ".result.json"), 8192))
      .toString("utf8")) as unknown,
  );
  if (JSON.stringify(result.intent) !== JSON.stringify(intent))
    throw Error("CREW_COMMIT_VERIFY_INTENT_MISMATCH");
  if (branchName(root) !== intent.branch ||
      git(root, ["rev-parse", "HEAD"]) !== result.newHead ||
      git(root, ["rev-parse", result.newHead + "^"]) !== intent.oldHead ||
      git(root, ["rev-parse", result.newHead + "^{tree}"]) !== result.tree)
    throw Error("CREW_COMMIT_VERIFY_HEAD_OR_PARENT_MISMATCH");
  const currentBlob = git(root, ["rev-parse", "HEAD:" + intent.target]);
  if (currentBlob !== result.blob)
    throw Error("CREW_COMMIT_VERIFY_BLOB_MISMATCH");
  const currentBytes = await validatedLocalFile(
    join(root, ...intent.target.split("/")), 6144,
  );
  if (sha256(currentBytes) !== intent.expectedSha256 ||
      git(root, ["status", "--porcelain=v1", "--untracked-files=normal"]) !== "")
    throw Error("CREW_COMMIT_VERIFY_WORKTREE_MISMATCH");
  return {
    status: "LOCAL_COMMIT_HASH_VERIFIED_REMOTE_CI_UNKNOWN",
    branch: intent.branch, commit: result.newHead, parent: intent.oldHead,
    target: intent.target, sha256: intent.expectedSha256,
  };
}
