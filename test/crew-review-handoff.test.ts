import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PhiProvider } from "../src/providers/types.js";
import type { CrewReadinessView } from "../src/qualification/crew-readiness.js";
import { runPinnedReview } from "../src/crew-pinned-review.js";
import {
  buildHandoffProposal, prepareReviewHandoff, acknowledgeReviewHandoff,
  listReviewHandoffs, verifyHandoffProposal, verifyHandoffReceipt,
} from "../src/crew-review-handoff.js";

const MODEL = "qwen3:4b";
const DATE = new Date("2026-11-06T20:00:00.000Z");
const DOCUMENT = "# Local test\nThe fictional flag is --dry-run here but the sentence says --preview.\n";
const readiness: CrewReadinessView = {
  schema: "phibot.crew.readiness-view.v1",
  classification: "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED",
  maxAgeMs: 3600000,
  records: [{
    model: MODEL, ollamaPort: 11434,
    checkedAt: DATE.toISOString(),
    status: "RECENT_PROBE_PASS_SELF_REPORT",
    inferenceLatencyMs: 500, inferenceAttempts: 1,
    digest: "a".repeat(64),
  }],
};
function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8", timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
async function fixture(fn: (root: string, commit: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "phibot-39-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    git(root, ["config", "user.name", "PhiBot Fixture"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "note.md"), DOCUMENT);
    git(root, ["add", "docs/note.md"]);
    git(root, ["commit", "-qm", "pinned review source"]);
    await fn(root, git(root, ["rev-parse", "HEAD"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function provider(failAt = -1): PhiProvider {
  let call = 0;
  return {
    id: "ollama", model: MODEL,
    async complete(request) {
      const index = call++;
      assert.deepEqual(request.manifest.capabilities, []);
      assert.deepEqual(request.manifest.authority, {
        read: false, propose: false, write: false, deploy: false,
      });
      return {
        provider: "ollama", model: MODEL, fallback: false,
        metrics: { latencyMs: 5, attempts: 1 },
        content: JSON.stringify(index === failAt
          ? { summary: "INVALID", confidence: 0.9, action: { authority: "write" } }
          : { summary: request.manifest.role + " advice only", confidence: 0.7 }),
      };
    },
  };
}
async function review(root: string, commit: string, failAt = -1) {
  return runPinnedReview({
    repoDir: root, allowedRoots: [root], commit, filePath: "docs/note.md",
    model: MODEL, dir: join(root, "pinned-reviews"), now: () => DATE,
    readReadiness: async () => readiness,
    providerFactory: () => provider(failAt),
  });
}
const params = (root: string, id: string) => ({
  reviewId: id, repoDir: root, allowedRoots: [root],
  reviewDir: join(root, "pinned-reviews"),
});
test("manual handoff binds the three advisories and exact Git source, without any repair write", async () => {
  await fixture(async (root, commit) => {
    const { record: crew } = await review(root, commit);
    const prepared = await prepareReviewHandoff(params(root, crew.id));
    assert.equal(prepared.proposal.source.commit, commit);
    assert.equal(prepared.proposal.source.sha256, crew.source.sha256);
    assert.equal(prepared.proposal.reviewDigest, crew.digest);
    assert.equal(prepared.proposal.patchAdvisory, crew.stages[1]?.summary);
    assert.equal(prepared.proposal.skepticAdvisory, crew.stages[2]?.summary);
    assert.equal(prepared.proposal.authority, "NO_EXECUTION_NO_REPO_WRITE_NO_GRANTS");
    assert.equal(prepared.proposal.purpose, "MANUAL_HUMAN_DRAFT_CONSIDERATION_ONLY");
    assert.equal(verifyHandoffProposal(prepared.proposal).scope,
      "ONE_PINNED_MARKDOWN_FILE_PROSE_ONLY");
    const dir = join(root, "handoffs");
    const saved = await acknowledgeReviewHandoff({
      ...params(root, crew.id), dir, now: () => DATE,
      approvalText: "REVIEW " + prepared.proposalDigest.slice(0, 16),
    });
    assert.equal(saved.record.status, "HUMAN_REVIEWED_FOR_MANUAL_DRAFT_ONLY");
    assert.equal(saved.record.acknowledgement,
      "LOCAL_TTY_ACKNOWLEDGEMENT_NOT_IDENTITY_ATTESTED");
    assert.equal(saved.record.proposalDigest, prepared.proposalDigest);
    assert.equal(verifyHandoffReceipt(saved.record).digest, saved.record.digest);
    assert.deepEqual(JSON.parse(await readFile(saved.path, "utf8")), saved.record);
    assert.deepEqual(await listReviewHandoffs(dir), [saved.record]);
    assert.equal(await readFile(join(root, "docs", "note.md"), "utf8"), DOCUMENT);
    assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=no",
      "--", "docs/note.md"]), "");
    // Exclusive storage forbids replay or overwriting the same review's human decision.
    await assert.rejects(acknowledgeReviewHandoff({
      ...params(root, crew.id), dir, now: () => DATE,
      approvalText: "REVIEW " + prepared.proposalDigest.slice(0, 16),
    }), (err: unknown) => err instanceof Error && "code" in err && err.code === "EEXIST");
  });
});
test("wrong or absent digest acknowledgement creates no local handoff", async () => {
  await fixture(async (root, commit) => {
    const { record } = await review(root, commit);
    const dir = join(root, "handoffs");
    await assert.rejects(acknowledgeReviewHandoff({
      ...params(root, record.id), dir, approvalText: "APPROVE ANYTHING",
    }), /CREW_HANDOFF_OPERATOR_DECLINED/);
    assert.deepEqual(await listReviewHandoffs(dir), []);
  });
});
test("reject moved HEAD and dirty pinned target even if original Git blob is still present", async () => {
  await fixture(async (root, commit) => {
    const { record } = await review(root, commit);
    await writeFile(join(root, "docs", "note.md"), DOCUMENT + "DIRTY EDIT\n");
    await assert.rejects(prepareReviewHandoff(params(root, record.id)),
      /CREW_HANDOFF_DIRTY_TARGET/);
    await writeFile(join(root, "docs", "note.md"), DOCUMENT);
    await writeFile(join(root, "other.md"), "unrelated file");
    git(root, ["add", "other.md"]);
    git(root, ["commit", "-qm", "advance HEAD"]);
    await assert.rejects(prepareReviewHandoff(params(root, record.id)),
      /CREW_HANDOFF_STALE_HEAD/);
  });
});
test("reject a different allowlist root, forged review ID and incomplete crew reviews", async () => {
  await fixture(async (root, commit) => {
    const good = await review(root, commit);
    await assert.rejects(prepareReviewHandoff({
      ...params(root, good.record.id), allowedRoots: [tmpdir()],
    }), /CREW_PIN_REPOSITORY_NOT_ALLOWED/);
    await assert.rejects(prepareReviewHandoff(params(root, "not-uuid")),
      /CREW_HANDOFF_REVIEW_ID_INVALID/);
    const incomplete = await review(root, commit, 1);
    assert.equal(incomplete.record.status, "FAILED_INCOMPLETE_NO_APPROVAL");
    assert.throws(() => buildHandoffProposal(incomplete.record),
      /CREW_HANDOFF_COMPLETE_REVIEW_REQUIRED/);
    await assert.rejects(prepareReviewHandoff(params(root, incomplete.record.id)),
      /CREW_HANDOFF_COMPLETE_REVIEW_REQUIRED/);
  });
});
test("reject local receipt tampering and authority/role injection", async () => {
  await fixture(async (root, commit) => {
    const { record: crew, path: reviewPath } = await review(root, commit);
    const p = await prepareReviewHandoff(params(root, crew.id));
    assert.throws(() => verifyHandoffProposal({
      ...p.proposal, authority: "WRITE_GRANTED",
    }), /CREW_HANDOFF_PROPOSAL_INVALID/);
    assert.throws(() => verifyHandoffProposal({
      ...p.proposal, grant: "yes",
    }), /CREW_HANDOFF_PROPOSAL_SCHEMA_INVALID/);
    const dir = join(root, "handoffs");
    const saved = await acknowledgeReviewHandoff({
      ...params(root, crew.id), dir, now: () => DATE,
      approvalText: "REVIEW " + p.proposalDigest.slice(0, 16),
    });
    assert.throws(() => verifyHandoffReceipt({
      ...saved.record, proposalDigest: "0".repeat(64),
    }), /CREW_HANDOFF_PROPOSAL_DIGEST_MISMATCH/);
    assert.throws(() => verifyHandoffReceipt({
      ...saved.record, proposal: { ...saved.record.proposal,
        patchAdvisory: "forged review" },
    }), /CREW_HANDOFF_PROPOSAL_DIGEST_MISMATCH/);
    await writeFile(saved.path, JSON.stringify({
      ...saved.record, status: "WRITE_APPROVED",
    }));
    await assert.rejects(listReviewHandoffs(dir), /CREW_HANDOFF_RECEIPT_INVALID/);
    await writeFile(reviewPath, JSON.stringify({
      ...crew, stages: [{ ...crew.stages[0], summary: "injected" }, ...crew.stages.slice(1)],
    }));
    await assert.rejects(prepareReviewHandoff(params(root, crew.id)),
      /CREW_PINNED_DIGEST_MISMATCH/);
  });
});
