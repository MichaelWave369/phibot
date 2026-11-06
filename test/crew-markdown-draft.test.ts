import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PhiProvider } from "../src/providers/types.js";
import type { CrewReadinessView } from "../src/qualification/crew-readiness.js";
import { runPinnedReview } from "../src/crew-pinned-review.js";
import { acknowledgeReviewHandoff, prepareReviewHandoff } from "../src/crew-review-handoff.js";
import {
  prepareMarkdownDraft, storeMarkdownDraft, listMarkdownDrafts,
  verifyMarkdownDraftRecord, verifyMarkdownDraftProposal, markdownDiff,
} from "../src/crew-markdown-draft.js";

const MODEL = "qwen3:4b";
const DATE = new Date("2026-11-06T20:10:00.000Z");
const ORIGINAL = "# Local pilot\nThe example uses --dry-run.\nThis documentation is for humans.\n";
const NEW = "# Local pilot\nThe example uses --preview.\nThis documentation is for humans.\n";
const readiness: CrewReadinessView = {
  schema: "phibot.crew.readiness-view.v1",
  classification: "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED",
  maxAgeMs: 3600000,
  records: [{
    model: MODEL, ollamaPort: 11434, checkedAt: DATE.toISOString(),
    status: "RECENT_PROBE_PASS_SELF_REPORT",
    inferenceLatencyMs: 44, inferenceAttempts: 1,
    digest: "a".repeat(64),
  }],
};
const runGit = (root: string, args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const provider = (): PhiProvider => ({
  id: "ollama", model: MODEL,
  async complete(req) {
    assert.deepEqual(req.manifest.capabilities, []);
    assert.deepEqual(req.manifest.authority,
      { read:false, propose:false, write:false, deploy:false });
    return {
      provider: "ollama", model: MODEL, fallback: false,
      metrics: { latencyMs: 8, attempts: 1 },
      content: JSON.stringify({
        summary: "Unverified " + req.manifest.role + " observation",
        confidence: 0.7,
      }),
    };
  },
});
type Context = {
  root: string; handoffId: string; originalCommit: string;
  replacementFile: string; handoffRecordsDir: string; reviewDir: string;
  draftDir: string;
};
async function fixture(fn: (ctx: Context) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "phibot40-"));
  try {
    runGit(root, ["init", "-q"]);
    runGit(root, ["config", "user.email", "local-test@example.invalid"]);
    runGit(root, ["config", "user.name", "Local Fixture"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "note.md"), ORIGINAL);
    await writeFile(join(root, ".gitignore"), ".phibot/\n");
    runGit(root, ["add", "docs/note.md", ".gitignore"]);
    runGit(root, ["commit", "-qm", "source baseline"]);
    const originalCommit = runGit(root, ["rev-parse", "HEAD"]);
    const reviewDir = join(root, ".phibot", "crew-pinned-reviews");
    const handoffRecordsDir = join(root, ".phibot", "crew-review-handoffs");
    const draftDir = join(root, ".phibot", "crew-markdown-drafts");
    const inputsDir = join(root, ".phibot", "crew-drafts");
    await mkdir(inputsDir, { recursive: true });
    const replacementFile = join(inputsDir, "note.md");
    await writeFile(replacementFile, NEW);
    const { record: review } = await runPinnedReview({
      repoDir: root, allowedRoots: [root], commit: originalCommit,
      filePath: "docs/note.md", model: MODEL, dir: reviewDir,
      now: () => DATE, readReadiness: async () => readiness,
      providerFactory: provider,
    });
    const handoffPreview = await prepareReviewHandoff({
      reviewId: review.id, repoDir: root, allowedRoots: [root], reviewDir,
    });
    const { record: handoff } = await acknowledgeReviewHandoff({
      reviewId: review.id, repoDir: root, allowedRoots: [root],
      reviewDir, dir: handoffRecordsDir, now: () => DATE,
      approvalText: "REVIEW " + handoffPreview.proposalDigest.slice(0, 16),
    });
    await fn({
      root, handoffId: handoff.id, originalCommit, replacementFile,
      handoffRecordsDir, reviewDir, draftDir,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const args = (c: Context) => ({
  handoffId: c.handoffId, repoDir: c.root, allowedRoots: [c.root],
  replacementFile: c.replacementFile, handoffRecordsDir: c.handoffRecordsDir,
  reviewDir: c.reviewDir,
});
test("exact Markdown proposal preserves pinned source and is never applied", async () => {
  await fixture(async c => {
    const { proposal, proposalDigest } = await prepareMarkdownDraft(args(c));
    assert.equal(proposal.source.commit, c.originalCommit);
    assert.equal(proposal.status, "DRAFT_UNAPPLIED_SEPARATE_REALITY_GATE_REQUIRED");
    assert.equal(proposal.authority, "NO_WRITE_NO_APPLY_NO_GRANT");
    assert.equal(proposal.beforeSha256, proposal.source.sha256);
    assert.notEqual(proposal.afterSha256, proposal.beforeSha256);
    assert.equal(proposal.replacement, NEW);
    assert.equal(proposal.removedLines, 1);
    assert.equal(proposal.addedLines, 1);
    assert.match(proposal.diff, /-The example uses --dry-run/);
    assert.match(proposal.diff, /\+The example uses --preview/);
    assert.equal(verifyMarkdownDraftProposal(proposal).handoffId, c.handoffId);
    const { record, path } = await storeMarkdownDraft({
      ...args(c), dir: c.draftDir, now: () => DATE,
      expectedDigest: proposalDigest,
      approvalText: "DRAFT " + proposalDigest.slice(0, 16),
    });
    assert.equal(record.classification, "LOCAL_OPERATOR_RECORDED_NOT_WRITE_APPROVED");
    assert.equal(verifyMarkdownDraftRecord(record).receiptDigest, record.receiptDigest);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), record);
    assert.deepEqual(await listMarkdownDrafts(c.draftDir), [record]);
    assert.equal(await readFile(join(c.root, "docs", "note.md"), "utf8"), ORIGINAL);
    assert.equal(runGit(c.root, ["status", "--porcelain=v1"]), "");
    await assert.rejects(storeMarkdownDraft({
      ...args(c), dir: c.draftDir, now: () => DATE,
      expectedDigest: proposalDigest,
      approvalText: "DRAFT " + proposalDigest.slice(0, 16),
    }), (e: unknown) => e instanceof Error && "code" in e && e.code === "EEXIST");
  });
});
test("exact typed digest and unchanged candidate are required to store", async () => {
  await fixture(async c => {
    const initial = await prepareMarkdownDraft(args(c));
    await assert.rejects(storeMarkdownDraft({
      ...args(c), dir: c.draftDir,
      expectedDigest: initial.proposalDigest,
      approvalText: "APPROVE " + initial.proposalDigest.slice(0,16),
    }), /CREW_DRAFT_OPERATOR_ACK_REQUIRED/);
    await writeFile(c.replacementFile, NEW.replace("--preview", "--help"));
    await assert.rejects(storeMarkdownDraft({
      ...args(c), dir: c.draftDir,
      expectedDigest: initial.proposalDigest,
      approvalText: "DRAFT " + initial.proposalDigest.slice(0,16),
    }), /CREW_DRAFT_REPLACEMENT_CHANGED_SINCE_PREVIEW/);
    assert.deepEqual(await listMarkdownDrafts(c.draftDir), []);
  });
});
test("moved HEAD, dirty target, forged handoff and missing allowlist fail closed", async () => {
  await fixture(async c => {
    await assert.rejects(prepareMarkdownDraft({
      ...args(c), allowedRoots: [tmpdir()],
    }), /CREW_PIN_REPOSITORY_NOT_ALLOWED/);
    await assert.rejects(prepareMarkdownDraft({
      ...args(c), handoffId: "0".repeat(8) + "-0000-0000-0000-000000000000",
    }), /CREW_DRAFT_HANDOFF_NOT_FOUND/);
    await writeFile(join(c.root, "docs", "note.md"), ORIGINAL + "DIRTY\n");
    await assert.rejects(prepareMarkdownDraft(args(c)), /CREW_HANDOFF_DIRTY_TARGET/);
    await writeFile(join(c.root, "docs", "note.md"), ORIGINAL);
    await writeFile(join(c.root, "other.txt"), "change commit");
    runGit(c.root, ["add", "other.txt"]);
    runGit(c.root, ["commit", "-qm", "HEAD moved"]);
    await assert.rejects(prepareMarkdownDraft(args(c)), /CREW_HANDOFF_STALE_HEAD/);
  });
});
test("draft source path confined to local .phibot directory, symlinks excluded", async () => {
  await fixture(async c => {
    const outside = join(c.root, "candidate.md");
    await writeFile(outside, NEW);
    await assert.rejects(prepareMarkdownDraft({
      ...args(c), replacementFile: outside,
    }), /CREW_DRAFT_FILE_OUTSIDE_LOCAL_DRAFT_DIR/);
    const path = join(c.root, ".phibot", "crew-drafts", "link.md");
    await symlink(c.replacementFile, path);
    await assert.rejects(prepareMarkdownDraft({
      ...args(c), replacementFile: path,
    }), /CREW_DRAFT_FILE_INVALID/);
  });
});
test("no-op, oversized edits, long line replacement, or secret patterns refused", async () => {
  await fixture(async c => {
    for (const text of [
      ORIGINAL,
      "# Swapped entirely\n" + "changed\n".repeat(26),
      "x".repeat(6150),
      "# Key\nsk-" + "a".repeat(30) + "\n",
    ]) {
      await writeFile(c.replacementFile, text);
      await assert.rejects(prepareMarkdownDraft(args(c)),
        /CREW_DRAFT_(?:NO_CHANGE|CONTENT_INVALID|FILE_INVALID|CHANGED_LINES_EXCEEDED|BYTE_DELTA_EXCEEDED)/);
    }
  });
});
test("tampered proposal, extra authority, and altered local records are rejected", async () => {
  await fixture(async c => {
    const p = await prepareMarkdownDraft(args(c));
    const { record, path } = await storeMarkdownDraft({
      ...args(c), dir: c.draftDir, now: () => DATE,
      expectedDigest: p.proposalDigest,
      approvalText: "DRAFT " + p.proposalDigest.slice(0,16),
    });
    assert.throws(() => verifyMarkdownDraftProposal({
      ...p.proposal, permission: "write",
    }), /CREW_DRAFT_PROPOSAL_SCHEMA_INVALID/);
    assert.throws(() => verifyMarkdownDraftProposal({
      ...p.proposal, replacement: NEW + "hidden change",
    }), /CREW_DRAFT_PROPOSAL_INVALID/);
    assert.throws(() => verifyMarkdownDraftRecord({
      ...record, proposalDigest: "0".repeat(64),
    }), /CREW_DRAFT_PROPOSAL_DIGEST_MISMATCH/);
    await writeFile(path, JSON.stringify({
      ...record, proposal: { ...record.proposal, authority: "WRITE_ALLOWED" },
    }));
    await assert.rejects(listMarkdownDrafts(c.draftDir),
      /CREW_DRAFT_PROPOSAL_INVALID/);
  });
});
test("diff context is adjacent to changed lines, including suffix longer than 2", () => {
  const source = "a\nb\nOLD\nc\nd\ne\nf\n";
  const target = "a\nb\nNEW\nc\nd\ne\nf\n";
  const result = markdownDiff("docs/note.md", source, target);
  assert.match(result.diff, /^--- a\/docs\/note\.md/m);
  assert.match(result.diff, /-OLD\n\+NEW\n c\n d\n/);
  assert.ok(!result.diff.includes(" e\n f\n"));
});
