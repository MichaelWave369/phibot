import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PhiProvider } from "../src/providers/types.js";
import type { CrewReadinessView } from "../src/qualification/crew-readiness.js";
import { runPinnedReview } from "../src/crew-pinned-review.js";
import { acknowledgeReviewHandoff, prepareReviewHandoff } from "../src/crew-review-handoff.js";
import { prepareMarkdownDraft, storeMarkdownDraft } from "../src/crew-markdown-draft.js";
import {
  previewMarkdownApply, applyLocalMarkdown, verifyAppliedMarkdown,
  validateMarkdownApplyInput, verifyMarkdownApplyResult,
  applyLedgerDir,
} from "../src/crew-markdown-apply.js";
import {
  registerLocalMarkdownApply, MARKDOWN_LOCAL_APPLY_CAPABILITY,
} from "../src/tools/crew-markdown-apply-local.js";
import { ToolCapabilityRegistry } from "../src/tools/registry.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { RealityGate } from "../src/gate/reality-gate.js";
import { MemoryLedger } from "../src/core/ledger.js";
import { validateManifest } from "../src/core/manifest.js";

const MODEL = "qwen3:4b";
const AT = new Date("2026-11-06T20:11:00.000Z");
const ORIGINAL = "# User guide\nThe example uses --dry-run.\nThis remains a guide.\n";
const NEW = "# User guide\nThe example uses --preview.\nThis remains a guide.\n";
const runGit = (root: string, args: string[]): string =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const ready: CrewReadinessView = {
  schema: "phibot.crew.readiness-view.v1",
  classification: "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED",
  maxAgeMs: 3600000,
  records: [{
    model: MODEL, ollamaPort: 11434, checkedAt: AT.toISOString(),
    status: "RECENT_PROBE_PASS_SELF_REPORT",
    inferenceLatencyMs: 19, inferenceAttempts: 1,
    digest: "a".repeat(64),
  }],
};
const provider = (): PhiProvider => ({
  id: "ollama", model: MODEL,
  async complete(req) {
    assert.deepEqual(req.manifest.capabilities, []);
    assert.deepEqual(req.manifest.authority,
      { read:false, propose:false, write:false, deploy:false });
    return {
      provider: "ollama", model: MODEL, fallback: false,
      content: JSON.stringify({
        summary: "Unverified " + req.manifest.role + " review",
        confidence: 0.7,
      }),
      metrics: { latencyMs: 8, attempts: 1 },
    };
  },
});
type State = {
  root: string;
  commit: string;
  draftId: string;
  draftDir: string;
  reviewDir: string;
  handoffDir: string;
};
async function fixture(fn: (s: State) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "phibot41-"));
  try {
    runGit(root, ["init", "-q"]);
    runGit(root, ["config", "user.email", "fixture@example.invalid"]);
    runGit(root, ["config", "user.name", "PhiBot Local Test"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "guide.md"), ORIGINAL);
    await writeFile(join(root, ".gitignore"), ".phibot/\n");
    runGit(root, ["add", "docs/guide.md", ".gitignore"]);
    runGit(root, ["commit", "-qm", "baseline"]);
    const commit = runGit(root, ["rev-parse", "HEAD"]);
    const reviewDir = join(root, ".phibot", "crew-pinned-reviews");
    const handoffDir = join(root, ".phibot", "crew-review-handoffs");
    const draftDir = join(root, ".phibot", "crew-markdown-drafts");
    await mkdir(join(root, ".phibot", "crew-drafts"), { recursive: true });
    const replacementFile = join(root, ".phibot", "crew-drafts", "guide.md");
    await writeFile(replacementFile, NEW);
    const { record: review } = await runPinnedReview({
      repoDir: root, allowedRoots: [root], commit,
      filePath: "docs/guide.md", model: MODEL,
      dir: reviewDir, now: () => AT,
      readReadiness: async () => ready, providerFactory: provider,
    });
    const handoff = await prepareReviewHandoff({
      reviewId: review.id, repoDir: root, allowedRoots: [root], reviewDir,
    });
    const { record: acknowledged } = await acknowledgeReviewHandoff({
      reviewId: review.id, repoDir: root, allowedRoots: [root],
      reviewDir, dir: handoffDir, now: () => AT,
      approvalText: "REVIEW " + handoff.proposalDigest.slice(0,16),
    });
    const draft = await prepareMarkdownDraft({
      handoffId: acknowledged.id, repoDir: root, allowedRoots: [root],
      replacementFile, handoffRecordsDir: handoffDir, reviewDir,
    });
    const { record } = await storeMarkdownDraft({
      handoffId: acknowledged.id, repoDir: root, allowedRoots: [root],
      replacementFile, handoffRecordsDir: handoffDir, reviewDir,
      expectedDigest: draft.proposalDigest,
      approvalText: "DRAFT " + draft.proposalDigest.slice(0,16),
      dir: draftDir, now: () => AT,
    });
    await fn({ root, commit, draftId: record.id, draftDir, reviewDir, handoffDir });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const opts = (s: State) => ({
  draftId: s.draftId, repoDir: s.root, allowedRoots: [s.root],
  draftDir: s.draftDir, handoffRecordsDir: s.handoffDir, reviewDir: s.reviewDir,
});
function gateSystem(s: State) {
  const ledger = new MemoryLedger();
  const gate = new RealityGate({ ledger, secret: "R".repeat(64) });
  const registry = registerLocalMarkdownApply(new ToolCapabilityRegistry(), {
    allowedRoots: [s.root], draftDir: s.draftDir,
    handoffRecordsDir: s.handoffDir, reviewDir: s.reviewDir,
  });
  const executor = new ToolExecutor(registry, ledger, { timeoutMs: 5000 }, gate);
  const manifest = validateManifest({
    id: "human-markdown-local-operator", name: "Local Markdown Human",
    version: "1.0.0", role: "single_local_markdown_replacement",
    description: "Human explicitly approves one local Markdown replacement",
    model: { provider: "operator", name: "human" },
    memory: { scope: "none", maxDepth: 0 },
    capabilities: [MARKDOWN_LOCAL_APPLY_CAPABILITY],
    authority: { read: true, propose: false, write: "gated", deploy: false },
    escalation: { target: "human", confidenceBelow: 1 },
  });
  return { gate, executor, manifest, ledger };
}
test("default gated tool cannot change source without explicit exact-input grant", async () => {
  await fixture(async s => {
    const { intent } = await previewMarkdownApply(opts(s));
    const { executor, manifest, gate, ledger } = gateSystem(s);
    const request = await executor.execute(manifest, {
      capability: MARKDOWN_LOCAL_APPLY_CAPABILITY, input: intent,
    }, "run-approve");
    assert.equal(request.status, "gated");
    assert.ok(request.gateRequest);
    assert.equal(await readFile(join(s.root, "docs", "guide.md"), "utf8"), ORIGINAL);
    assert.equal((await readdir(join(s.root, ".phibot"))).includes("crew-markdown-applies"), false);

    const approval = await gate.decide(request.gateRequest, { outcome: "approve" });
    assert.ok(approval.grant);
    const result = await executor.execute(manifest, {
      capability: MARKDOWN_LOCAL_APPLY_CAPABILITY,
      input: intent, grant: approval.grant,
    }, "run-approve");
    assert.equal(result.status, "executed");
    const output = result.output as { status: string; actualSha256: string };
    assert.equal(output.status, "APPLIED_LOCAL_WORKTREE_UNCOMMITTED_CI_UNVERIFIED");
    assert.equal(output.actualSha256, intent.afterSha256);
    assert.equal(await readFile(join(s.root, "docs", "guide.md"), "utf8"), NEW);
    assert.equal(runGit(s.root, ["rev-parse", "HEAD"]), s.commit);
    assert.equal(runGit(s.root, ["status", "--porcelain=v1"]), "M docs/guide.md");
    const checked = await verifyAppliedMarkdown({
      draftId: s.draftId, repoDir: s.root, allowedRoots: [s.root],
    });
    assert.equal(checked.status, "LOCAL_FILE_HASH_VERIFIED_CI_NOT_RUN");
    const replay = await executor.execute(manifest, {
      capability: MARKDOWN_LOCAL_APPLY_CAPABILITY,
      input: intent, grant: approval.grant,
    }, "run-approve");
    assert.equal(replay.status, "denied");
    assert.match(String(replay.error), /replay/);
    assert.ok(ledger.receipts.some(v => v.stage === "gate" && v.status === "ok"));
    assert.ok(ledger.receipts.some(v => v.stage === "tool" && v.status === "ok"));
  });
});
test("rejected or denied grant cannot mutate a document", async () => {
  await fixture(async s => {
    const { intent } = await previewMarkdownApply(opts(s));
    const { executor, manifest, gate } = gateSystem(s);
    const ask = await executor.execute(manifest, {
      capability: MARKDOWN_LOCAL_APPLY_CAPABILITY, input: intent,
    }, "run-deny");
    assert.ok(ask.gateRequest);
    const decision = await gate.decide(ask.gateRequest, { outcome: "deny" });
    assert.equal(decision.grant, undefined);
    const tampered = await executor.execute(manifest, {
      capability: MARKDOWN_LOCAL_APPLY_CAPABILITY, input: {
        ...intent, afterSha256: "0".repeat(64),
      },
    }, "run-tampered");
    assert.equal(tampered.status, "gated");
    assert.equal(await readFile(join(s.root, "docs", "guide.md"), "utf8"), ORIGINAL);
    assert.throws(() => validateMarkdownApplyInput({ ...intent, grants: ["deploy"] }),
      /MARKDOWN_APPLY_INTENT_SCHEMA_INVALID/);
    assert.throws(() => validateMarkdownApplyInput({ ...intent, authority: "WRITE_ALL" }),
      /MARKDOWN_APPLY_INTENT_INVALID/);
  });
});
test("stale HEAD, dirty target, allowlist and changed draft record fail before write", async () => {
  await fixture(async s => {
    await assert.rejects(previewMarkdownApply({
      ...opts(s), allowedRoots: [tmpdir()],
    }), /CREW_PIN_REPOSITORY_NOT_ALLOWED/);
    await writeFile(join(s.root, "docs", "guide.md"), ORIGINAL + "dirty\n");
    await assert.rejects(previewMarkdownApply(opts(s)), /CREW_HANDOFF_DIRTY_TARGET/);
    await writeFile(join(s.root, "docs", "guide.md"), ORIGINAL);
    await writeFile(join(s.root, "elsewhere.txt"), "commit moves");
    runGit(s.root, ["add", "elsewhere.txt"]);
    runGit(s.root, ["commit", "-qm", "new commit"]);
    await assert.rejects(previewMarkdownApply(opts(s)), /CREW_HANDOFF_STALE_HEAD/);
  });
  await fixture(async s => {
    const path = join(s.draftDir, (await readdir(s.draftDir))[0]!);
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string,unknown>;
    await writeFile(path, JSON.stringify({ ...value, classification: "WRITE_AUTHORIZED" }));
    await assert.rejects(previewMarkdownApply(opts(s)), /CREW_DRAFT_RECORD_INVALID/);
    assert.equal(await readFile(join(s.root, "docs", "guide.md"), "utf8"), ORIGINAL);
  });
});
test("unsafe target symlink or changed target never becomes a local write", async () => {
  await fixture(async s => {
    const full = join(s.root, "docs", "guide.md");
    await unlink(full);
    await symlink(join(s.root, ".gitignore"), full);
    await assert.rejects(previewMarkdownApply(opts(s)),
      /CREW_HANDOFF_DIRTY_TARGET|MARKDOWN_APPLY_TARGET_UNSAFE_FILE/);
    assert.equal(await readFile(join(s.root, ".gitignore"), "utf8"), ".phibot/\n");
  });
});
test("verification independently detects edits after the approved application", async () => {
  await fixture(async s => {
    const { intent } = await previewMarkdownApply(opts(s));
    const record = await applyLocalMarkdown(intent, {
      allowedRoots: [s.root], draftDir: s.draftDir,
      handoffRecordsDir: s.handoffDir, reviewDir: s.reviewDir,
    });
    assert.equal(verifyMarkdownApplyResult(record).actualSha256, intent.afterSha256);
    assert.throws(() => verifyMarkdownApplyResult({
      ...record, status: "GITHUB_MERGED",
    }), /MARKDOWN_APPLY_RESULT_INVALID/);
    assert.throws(() => verifyMarkdownApplyResult({
      ...record, actualSha256: "0".repeat(64),
    }), /MARKDOWN_APPLY_RESULT_SHA_INVALID/);
    await writeFile(join(s.root, "docs", "guide.md"), NEW + "tampered\n");
    await assert.rejects(verifyAppliedMarkdown({
      draftId: s.draftId, repoDir: s.root, allowedRoots: [s.root],
    }), /MARKDOWN_APPLY_VERIFY_TARGET_HASH_MISMATCH/);
    const resultFile = join(applyLedgerDir(s.root), s.draftId + ".result.json");
    await writeFile(resultFile, JSON.stringify({ ...record, receiptDigest: "0".repeat(64) }));
    await assert.rejects(verifyAppliedMarkdown({
      draftId: s.draftId, repoDir: s.root, allowedRoots: [s.root],
    }), /MARKDOWN_APPLY_RESULT_TAMPERED/);
  });
});
test("exclusive one-attempt fence prevents silent replay even after source restore", async () => {
  await fixture(async s => {
    const { intent } = await previewMarkdownApply(opts(s));
    const opts2 = {
      allowedRoots: [s.root], draftDir: s.draftDir,
      handoffRecordsDir: s.handoffDir, reviewDir: s.reviewDir,
    };
    await applyLocalMarkdown(intent, opts2);
    await writeFile(join(s.root, "docs", "guide.md"), ORIGINAL);
    await assert.rejects(applyLocalMarkdown(intent, opts2),
      (e:unknown) => e instanceof Error && "code" in e && e.code === "EEXIST");
    assert.equal(await readFile(join(s.root, "docs", "guide.md"), "utf8"), ORIGINAL);
  });
});
