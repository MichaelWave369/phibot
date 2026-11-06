/**
 * PHIBOT-39: human-reviewed, source-pinned advisory handoff.
 * Absolutely no GitHub/network writes, draft code, commits, or tool dispatch.
 * TTY approval only marks advice for future *manual* drafting.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  listPinnedReviews, pinnedReviewDir, type PinnedReviewReceipt,
  type PinnedSourceProof,
} from "./crew-pinned-review.js";
import { readPinnedDocument } from "./crew-pinned-source.js";

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILENAME = /^[0-9a-f-]{36}\.json$/;
const TYPE = "phibot.crew.review-handoff.v1" as const;
const STATUS = "HUMAN_REVIEWED_FOR_MANUAL_DRAFT_ONLY" as const;
const SCOPE = "ONE_PINNED_MARKDOWN_FILE_PROSE_ONLY" as const;
const AUTHORITY = "NO_EXECUTION_NO_REPO_WRITE_NO_GRANTS" as const;
const ATTESTATION = "LOCAL_TTY_ACKNOWLEDGEMENT_NOT_IDENTITY_ATTESTED" as const;
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const object = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const exactKeys = (x: unknown, names: string[]) =>
  object(x) && Object.keys(x).sort().join(",") === [...names].sort().join(",");

export interface ReviewHandoffProposal {
  schema: "phibot.crew.review-handoff-proposal.v1";
  reviewId: string;
  reviewDigest: string;
  source: PinnedSourceProof;
  model: string;
  scoutAdvisory: string;
  patchAdvisory: string;
  skepticAdvisory: string;
  scope: typeof SCOPE;
  authority: typeof AUTHORITY;
  purpose: "MANUAL_HUMAN_DRAFT_CONSIDERATION_ONLY";
}
export interface ReviewHandoffReceipt {
  schema: typeof TYPE;
  id: string;
  createdAt: string;
  proposal: ReviewHandoffProposal;
  proposalDigest: string;
  acknowledgement: typeof ATTESTATION;
  status: typeof STATUS;
  digest: string;
}
export const handoffDir = () => resolve(".phibot", "crew-review-handoffs");

function safeGit(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 3000,
    maxBuffer: 16384, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function buildHandoffProposal(review: PinnedReviewReceipt): ReviewHandoffProposal {
  if (review.status !== "THREE_ADVISORIES_UNVERIFIED" ||
      review.stages.length !== 3 ||
      review.stages[0]?.role !== "scout" ||
      review.stages[1]?.role !== "patch" ||
      review.stages[2]?.role !== "skeptic")
    throw Error("CREW_HANDOFF_COMPLETE_REVIEW_REQUIRED");
  return {
    schema: "phibot.crew.review-handoff-proposal.v1",
    reviewId: review.id, reviewDigest: review.digest,
    source: structuredClone(review.source), model: review.model,
    scoutAdvisory: review.stages[0].summary,
    patchAdvisory: review.stages[1].summary,
    skepticAdvisory: review.stages[2].summary,
    scope: SCOPE, authority: AUTHORITY,
    purpose: "MANUAL_HUMAN_DRAFT_CONSIDERATION_ONLY",
  };
}
export function verifyHandoffProposal(value: unknown): ReviewHandoffProposal {
  if (!exactKeys(value, [
    "schema", "reviewId", "reviewDigest", "source", "model",
    "scoutAdvisory", "patchAdvisory", "skepticAdvisory",
    "scope", "authority", "purpose",
  ])) throw Error("CREW_HANDOFF_PROPOSAL_SCHEMA_INVALID");
  const v = value as unknown as ReviewHandoffProposal;
  if (v.schema !== "phibot.crew.review-handoff-proposal.v1" ||
      !UUID.test(v.reviewId) || !HASH.test(v.reviewDigest) ||
      v.scope !== SCOPE || v.authority !== AUTHORITY ||
      v.purpose !== "MANUAL_HUMAN_DRAFT_CONSIDERATION_ONLY" ||
      typeof v.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/.test(v.model) ||
      !exactKeys(v.source, [
        "repository", "commit", "path", "blobSha", "sha256", "bytes", "trust",
      ]) ||
      v.source.trust !== "LOCAL_GIT_COMMIT_NOT_REMOTE_ATTESTED" ||
      !/^[a-f0-9]{40}$/.test(v.source.commit) ||
      !/^[a-f0-9]{40}$/.test(v.source.blobSha) ||
      !HASH.test(v.source.sha256) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(v.source.repository) ||
      !/^(?:README\.md|docs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.md)$/.test(v.source.path) ||
      !Number.isInteger(v.source.bytes) || v.source.bytes < 1 || v.source.bytes > 6144)
    throw Error("CREW_HANDOFF_PROPOSAL_INVALID");
  for (const summary of [v.scoutAdvisory, v.patchAdvisory, v.skepticAdvisory]) {
    if (typeof summary !== "string" || summary.length < 1 || summary.length > 240 ||
        /[\u0000-\u001f\u007f]/.test(summary))
      throw Error("CREW_HANDOFF_ADVISORY_INVALID");
  }
  return structuredClone(v);
}

export function verifyHandoffReceipt(value: unknown): ReviewHandoffReceipt {
  if (!exactKeys(value, [
    "schema", "id", "createdAt", "proposal", "proposalDigest",
    "acknowledgement", "status", "digest",
  ])) throw Error("CREW_HANDOFF_RECEIPT_SCHEMA_INVALID");
  const v = value as unknown as ReviewHandoffReceipt;
  if (v.schema !== TYPE || !UUID.test(v.id) ||
      !Number.isFinite(Date.parse(v.createdAt)) ||
      v.acknowledgement !== ATTESTATION || v.status !== STATUS ||
      typeof v.proposalDigest !== "string" || !HASH.test(v.proposalDigest) ||
      typeof v.digest !== "string" || !HASH.test(v.digest))
    throw Error("CREW_HANDOFF_RECEIPT_INVALID");
  verifyHandoffProposal(v.proposal);
  if (digest(v.proposal) !== v.proposalDigest)
    throw Error("CREW_HANDOFF_PROPOSAL_DIGEST_MISMATCH");
  const { digest: oldHash, ...body } = v;
  if (digest(body) !== oldHash) throw Error("CREW_HANDOFF_RECEIPT_DIGEST_MISMATCH");
  return structuredClone(v);
}

/** Revalidate source snapshot AND current checkout; never accept a stale HEAD or modified target. */
async function checkSource({
  repoDir, allowedRoots, review,
}: { repoDir: string; allowedRoots: string[]; review: PinnedReviewReceipt }): Promise<void> {
  const pinned = await readPinnedDocument({
    repoDir, allowedRoots, commit: review.source.commit, path: review.source.path,
  });
  for (const key of ["repository", "commit", "path", "blobSha", "sha256", "bytes", "trust"] as const) {
    if (pinned[key] !== review.source[key])
      throw Error("CREW_HANDOFF_SOURCE_MISMATCH");
  }
  const root = await realpath(resolve(repoDir));
  if (safeGit(root, ["rev-parse", "HEAD"]) !== review.source.commit)
    throw Error("CREW_HANDOFF_STALE_HEAD");
  if (safeGit(root, ["status", "--porcelain=v1", "--untracked-files=no", "--",
    review.source.path]) !== "")
    throw Error("CREW_HANDOFF_DIRTY_TARGET");
}
export async function prepareReviewHandoff({
  reviewId, repoDir, allowedRoots, reviewDir = pinnedReviewDir(),
}: {
  reviewId: string; repoDir: string; allowedRoots: string[]; reviewDir?: string;
}): Promise<{ proposal: ReviewHandoffProposal; proposalDigest: string }> {
  if (typeof reviewId !== "string" || !UUID.test(reviewId))
    throw Error("CREW_HANDOFF_REVIEW_ID_INVALID");
  const reviews = await listPinnedReviews(reviewDir);
  const review = reviews.find(x => x.id === reviewId);
  if (!review) throw Error("CREW_HANDOFF_REVIEW_NOT_FOUND");
  const proposal = verifyHandoffProposal(buildHandoffProposal(review));
  await checkSource({ repoDir, allowedRoots, review });
  return { proposal, proposalDigest: digest(proposal) };
}

/**
 * Recheck before storing, then exclusively write an inert human-review packet.
 * Acknowledgement code is a CLI UX gate, not proof of operator identity.
 */
export async function acknowledgeReviewHandoff({
  reviewId, repoDir, allowedRoots, approvalText,
  reviewDir = pinnedReviewDir(), dir = handoffDir(), now = () => new Date(),
}: {
  reviewId: string; repoDir: string; allowedRoots: string[]; approvalText: string;
  reviewDir?: string; dir?: string; now?: () => Date;
}): Promise<{ record: ReviewHandoffReceipt; path: string }> {
  const { proposal, proposalDigest } = await prepareReviewHandoff({
    reviewId, repoDir, allowedRoots, reviewDir,
  });
  if (approvalText !== "REVIEW " + proposalDigest.slice(0, 16))
    throw Error("CREW_HANDOFF_OPERATOR_DECLINED");
  const at = now();
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    throw Error("CREW_HANDOFF_CLOCK_INVALID");
  const base = {
    schema: TYPE, id: randomUUID(), createdAt: at.toISOString(),
    proposal, proposalDigest,
    acknowledgement: ATTESTATION, status: STATUS,
  };
  const record = verifyHandoffReceipt({ ...base, digest: digest(base) });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, record.id + ".json");
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  return { record, path };
}

export async function listReviewHandoffs(dir = handoffDir()): Promise<ReviewHandoffReceipt[]> {
  let names: string[];
  try { names = await readdir(dir); }
  catch (error: unknown) {
    if (object(error) && error.code === "ENOENT") return [];
    throw error;
  }
  if (names.length > 100 || names.some(x => !FILENAME.test(x)))
    throw Error("CREW_HANDOFF_DIRECTORY_INVALID");
  const results: ReviewHandoffReceipt[] = [];
  for (const name of names.sort()) {
    const path = join(dir, name);
    if ((await stat(path)).size > 8192) throw Error("CREW_HANDOFF_FILE_OVERSIZE");
    const record = verifyHandoffReceipt(JSON.parse(await readFile(path, "utf8")) as unknown);
    if (name !== record.id + ".json") throw Error("CREW_HANDOFF_FILENAME_INVALID");
    results.push(record);
  }
  return results.reverse();
}
