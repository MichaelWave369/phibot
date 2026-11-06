/**
 * PHIBOT-38: explicit local Git commit + documentation blob evidence.
 * Git is invoked in read-only mode without shell interpolation or network use.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

const COMMIT = /^[0-9a-f]{40}$/;
const DOC = /^(?:README\.md|docs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)$/;
const MAX_BYTES = 6144;
const MAX_LINES = 160;

export interface PinnedDocument {
  schema: "phibot.crew.pinned-document.v1";
  repository: string;
  commit: string;
  path: string;
  blobSha: string;
  sha256: string;
  bytes: number;
  text: string;
  trust: "LOCAL_GIT_COMMIT_NOT_REMOTE_ATTESTED";
}
export function validatePinnedArgs(commit: string, path: string): void {
  if (typeof commit !== "string" || !COMMIT.test(commit))
    throw Error("CREW_PIN_COMMIT_INVALID");
  if (typeof path !== "string" || path.length > 180 || !DOC.test(path))
    throw Error("CREW_PIN_PATH_NOT_ALLOWLISTED");
}
function git(root: string, args: string[], binary = false): Buffer | string {
  const output = execFileSync("git", ["-C", root, ...args], {
    shell: false, windowsHide: true, timeout: 3000, maxBuffer: 16 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return binary ? output : output.toString("utf8");
}
export async function readPinnedDocument({
  repoDir, commit, path, allowedRoots,
}: {
  repoDir: string; commit: string; path: string; allowedRoots: string[];
}): Promise<PinnedDocument> {
  validatePinnedArgs(commit, path);
  if (!Array.isArray(allowedRoots) || allowedRoots.length < 1 ||
      allowedRoots.length > 12 || allowedRoots.some(x => typeof x !== "string" || !x.trim()))
    throw Error("CREW_PIN_REPOSITORY_ALLOWLIST_REQUIRED");
  const root = await realpath(resolve(repoDir));
  const allowed = await Promise.all(allowedRoots.map(x => realpath(resolve(x))));
  if (!allowed.includes(root)) throw Error("CREW_PIN_REPOSITORY_NOT_ALLOWED");
  const top = (git(root, ["rev-parse", "--show-toplevel"]) as string).trim();
  if (await realpath(resolve(top)) !== root)
    throw Error("CREW_PIN_REPO_ROOT_REQUIRED");

  const resolved = (git(root, ["rev-parse", "--verify", commit + "^{commit}"]) as string).trim();
  if (resolved !== commit) throw Error("CREW_PIN_NOT_EXACT_COMMIT");
  // ls-tree binds the exact commit and pathname to one regular Git blob,
  // rejecting symlinks (120000), submodules (160000) and absent paths.
  const line = (git(root, ["ls-tree", commit, "--", path]) as string).trimEnd();
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
  if (!match || match[3] !== path || !match[2])
    throw Error("CREW_PIN_NOT_REGULAR_DOC_BLOB");
  const blobSha = match[2];
  const bytes = git(root, ["cat-file", "blob", blobSha], true) as Buffer;
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES ||
      bytes.includes(0)) throw Error("CREW_PIN_DOCUMENT_SIZE_OR_BINARY_INVALID");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw Error("CREW_PIN_DOCUMENT_UTF8_INVALID"); }
  if (text.split("\n").length > MAX_LINES ||
      /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    throw Error("CREW_PIN_DOCUMENT_CONTROL_OR_LINES_INVALID");
  const repository = basename(root);
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repository))
    throw Error("CREW_PIN_REPOSITORY_LABEL_INVALID");
  return {
    schema: "phibot.crew.pinned-document.v1", repository,
    commit, path, blobSha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength, text,
    trust: "LOCAL_GIT_COMMIT_NOT_REMOTE_ATTESTED",
  };
}
