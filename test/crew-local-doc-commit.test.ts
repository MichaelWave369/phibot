import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PhiProvider } from "../src/providers/types.js";
import type { CrewReadinessView } from "../src/qualification/crew-readiness.js";
import { runPinnedReview } from "../src/crew-pinned-review.js";
import { acknowledgeReviewHandoff, prepareReviewHandoff } from "../src/crew-review-handoff.js";
import { prepareMarkdownDraft, storeMarkdownDraft } from "../src/crew-markdown-draft.js";
import { applyLocalMarkdown } from "../src/crew-markdown-apply.js";
import {
  commitLocalDoc, localDocCommitDir, previewLocalDocCommit,
  validateLocalDocCommitIntent, verifyLocalDocCommit, verifyLocalDocCommitResult,
} from "../src/crew-local-doc-commit.js";
import {
  registerLocalDocCommit, LOCAL_DOC_COMMIT_CAPABILITY,
} from "../src/tools/crew-local-doc-commit.js";
import { ToolCapabilityRegistry } from "../src/tools/registry.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { RealityGate } from "../src/gate/reality-gate.js";
import { MemoryLedger } from "../src/core/ledger.js";
import { validateManifest } from "../src/core/manifest.js";

const MODEL = "qwen3:4b";
const TIME = new Date("2026-11-06T22:20:00.000Z");
const ORIGINAL = "# Guide\nThe example says --dry-run.\nEnd.\n";
const NEW = "# Guide\nThe example says --preview.\nEnd.\n";
function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
const ready: CrewReadinessView = {
  schema: "phibot.crew.readiness-view.v1",
  classification: "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED",
  maxAgeMs: 3600000,
  records: [{
    model: MODEL, ollamaPort: 11434, checkedAt: TIME.toISOString(),
    status: "RECENT_PROBE_PASS_SELF_REPORT",
    inferenceLatencyMs: 110, inferenceAttempts: 1, digest: "a".repeat(64),
  }],
};
const provider = (): PhiProvider => ({
  id: "ollama", model: MODEL,
  async complete(request) {
    assert.deepEqual(request.manifest.capabilities, []);
    assert.deepEqual(request.manifest.authority, {
      read: false, propose: false, write: false, deploy: false,
    });
    return {
      provider: "ollama", model: MODEL, fallback: false,
      content: JSON.stringify({
        summary: "Unverified " + request.manifest.role + " suggestion",
        confidence: 0.6,
      }),
      metrics: { latencyMs: 14, attempts: 1 },
    };
  },
});
interface Fixture {
  root: string;
  oldHead: string;
  draftId: string;
}
async function fixture(work: (f: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "phibot42-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "PhiBot Fixture"]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "guide.md"), ORIGINAL);
    await writeFile(join(root, ".gitignore"), ".phibot/\n");
    git(root, ["add", "docs/guide.md", ".gitignore"]);
    git(root, ["commit", "-qm", "baseline"]);
    const oldHead = git(root, ["rev-parse", "HEAD"]);
    git(root, ["switch", "-q", "-c", "phibot/docs-guide"]);
    const reviewDir = join(root, ".phibot", "crew-pinned-reviews");
    const handoffRecordsDir = join(root, ".phibot", "crew-review-handoffs");
    const draftDir = join(root, ".phibot", "crew-markdown-drafts");
    await mkdir(join(root, ".phibot", "crew-drafts"), { recursive: true });
    const replacementFile = join(root, ".phibot", "crew-drafts", "guide.md");
    await writeFile(replacementFile, NEW);
    const {record: review} = await runPinnedReview({
      repoDir: root, allowedRoots: [root],
      commit: oldHead, filePath: "docs/guide.md", model: MODEL,
      dir: reviewDir, now: () => TIME,
      readReadiness: async () => ready, providerFactory: provider,
    });
    const summary = await prepareReviewHandoff({
      reviewId: review.id, repoDir: root, allowedRoots: [root], reviewDir,
    });
    const {record: handoff} = await acknowledgeReviewHandoff({
      reviewId: review.id, repoDir: root, allowedRoots: [root],
      dir: handoffRecordsDir, reviewDir,
      approvalText: "REVIEW " + summary.proposalDigest.slice(0,16),
      now: () => TIME,
    });
    const proposal = await prepareMarkdownDraft({
      handoffId: handoff.id, repoDir: root, allowedRoots: [root],
      replacementFile, handoffRecordsDir, reviewDir,
    });
    const {record: draft} = await storeMarkdownDraft({
      handoffId: handoff.id, repoDir: root, allowedRoots: [root],
      replacementFile, handoffRecordsDir, reviewDir,
      expectedDigest: proposal.proposalDigest,
      approvalText: "DRAFT " + proposal.proposalDigest.slice(0,16),
      dir: draftDir, now: () => TIME,
    });
    await applyLocalMarkdown({
      schema: "phibot.crew.markdown-apply-intent.v1",
      draftId: draft.id, draftReceiptDigest: draft.receiptDigest,
      proposalDigest: draft.proposalDigest, repoRoot: root,
      commit: oldHead, target: "docs/guide.md",
      beforeSha256: draft.proposal.beforeSha256,
      afterSha256: draft.proposal.afterSha256,
      authority: "ONE_LOCAL_FILE_WRITE_NO_GIT_COMMIT_NO_PUSH",
    }, {allowedRoots:[root],draftDir,handoffRecordsDir,reviewDir});
    await work({root,oldHead,draftId:draft.id});
  } finally {
    await rm(root, {recursive:true,force:true});
  }
}
const args = (f: Fixture) => ({
  draftId:f.draftId,repoDir:f.root,allowedRoots:[f.root],
});
function gated(f: Fixture) {
  const ledger = new MemoryLedger();
  const gate = new RealityGate({ ledger, secret: "x".repeat(64) });
  const registry = registerLocalDocCommit(new ToolCapabilityRegistry(), [f.root]);
  const executor = new ToolExecutor(registry, ledger, {timeoutMs:10000}, gate);
  const manifest = validateManifest({
    id: "human-doc-commit-operator",
    name: "Human Markdown Commit",
    version: "1.0.0",
    role: "exact_local_commit",
    description: "Explicit gate for local documentation commit",
    model: {provider:"operator",name:"human"},
    memory:{scope:"none",maxDepth:0},
    capabilities:[LOCAL_DOC_COMMIT_CAPABILITY],
    authority:{read:true,propose:false,write:"gated",deploy:false},
    escalation:{target:"human",confidenceBelow:1},
  });
  return {ledger,gate,executor,manifest};
}
test("one-use gate permits exactly one local commit; independent verifier checks bytes", async()=>{
  await fixture(async f=>{
    const {intent} = await previewLocalDocCommit(args(f));
    assert.equal(intent.branch, "phibot/docs-guide");
    assert.equal(intent.oldHead, f.oldHead);
    assert.equal(intent.target, "docs/guide.md");
    const {ledger,gate,executor,manifest} = gated(f);
    const asked=await executor.execute(manifest,{
      capability:LOCAL_DOC_COMMIT_CAPABILITY,input:intent,
    },"run-doc");
    assert.equal(asked.status,"gated");
    assert.ok(asked.gateRequest);
    assert.equal(git(f.root,["rev-parse","HEAD"]),f.oldHead);
    assert.equal(git(f.root,["diff","--cached","--name-only"]),"");
    assert.equal(await readFile(join(f.root,"docs","guide.md"),"utf8"),NEW);
    const decision=await gate.decide(asked.gateRequest,{outcome:"approve"});
    assert.ok(decision.grant);
    const completed=await executor.execute(manifest,{
      capability:LOCAL_DOC_COMMIT_CAPABILITY,
      input:intent,grant:decision.grant,
    },"run-doc");
    assert.equal(completed.status,"executed",String(completed.error));
    const result=completed.output as ReturnType<typeof verifyLocalDocCommitResult>;
    assert.equal(result.status,"LOCAL_COMMIT_CREATED_NOT_PUSHED_CI_UNVERIFIED");
    assert.equal(result.intent.target,"docs/guide.md");
    assert.equal(git(f.root,["rev-parse","HEAD"]),result.newHead);
    assert.equal(git(f.root,["rev-parse","HEAD^"]),f.oldHead);
    assert.equal(git(f.root,["show","--format=","--name-only","HEAD"]).trim(),"docs/guide.md");
    assert.equal(git(f.root,["status","--porcelain=v1"]),"");
    assert.equal(git(f.root,["diff","--cached","--name-only"]),"");
    assert.equal(git(f.root,["log","-1","--format=%s"]),intent.message);
    assert.equal(await readFile(join(f.root,"docs","guide.md"),"utf8"),NEW);
    const evidence=await verifyLocalDocCommit(args(f));
    assert.equal(evidence.status,"LOCAL_COMMIT_HASH_VERIFIED_REMOTE_CI_UNKNOWN");
    assert.equal(evidence.commit,result.newHead);
    assert.equal(evidence.sha256,intent.expectedSha256);
    assert.equal(git(f.root,["remote","-v"]),"");
    assert.ok(ledger.receipts.some(x=>x.stage==="gate" && x.status==="ok"));
    const replay=await executor.execute(manifest,{
      capability:LOCAL_DOC_COMMIT_CAPABILITY,
      input:intent,grant:decision.grant,
    },"run-doc");
    assert.equal(replay.status,"denied");
    assert.match(String(replay.error),/replay/i);
  });
});
test("operator denial and forged intent never create Git commits",async()=>{
  await fixture(async f=>{
    const {intent}=await previewLocalDocCommit(args(f));
    const {gate,executor,manifest}=gated(f);
    const pending=await executor.execute(manifest,{
      capability:LOCAL_DOC_COMMIT_CAPABILITY,input:intent,
    },"deny");
    assert.ok(pending.gateRequest);
    await gate.decide(pending.gateRequest,{outcome:"deny"});
    assert.equal(git(f.root,["rev-parse","HEAD"]),f.oldHead);
    assert.equal(git(f.root,["diff","--cached","--name-only"]),"");
    assert.throws(()=>validateLocalDocCommitIntent({
      ...intent,authority:"PUSH_AND_MERGE",
    }),/CREW_COMMIT_INTENT_INVALID/);
    assert.throws(()=>validateLocalDocCommitIntent({
      ...intent,ci:"success",
    }),/CREW_COMMIT_INTENT_SCHEMA_INVALID/);
    await assert.rejects(verifyLocalDocCommit(args(f)));
  });
});
test("protected/undesignated branch, staged index, or unrelated files are refused",async()=>{
  await fixture(async f=>{
    await writeFile(join(f.root,"extra.txt"),"untracked");
    await assert.rejects(previewLocalDocCommit(args(f)),
      /CREW_COMMIT_UNRELATED_CHANGES_OR_STAGED_CONTENT/);
    await rm(join(f.root,"extra.txt"));
    git(f.root,["add","docs/guide.md"]);
    // The earlier PHIBOT-41 verifier can refuse the staged target before
    // PHIBOT-42 reaches its own whole-worktree staging guard.
    await assert.rejects(previewLocalDocCommit(args(f)),
      /CREW_COMMIT_UNRELATED_CHANGES_OR_STAGED_CONTENT|MARKDOWN_APPLY_VERIFY_WORKTREE_STATE_CHANGED/);
    git(f.root,["reset","-q","HEAD","--","docs/guide.md"]);
    git(f.root,["switch","-q","-c","manual-review"]);
    await assert.rejects(previewLocalDocCommit(args(f)),
      /CREW_COMMIT_DEDICATED_BRANCH_REQUIRED/);
    assert.equal(git(f.root,["rev-parse","HEAD"]),f.oldHead);
  });
});
test("invalid allowlist, changed bytes and modified receipts fail closed",async()=>{
  await fixture(async f=>{
    await assert.rejects(previewLocalDocCommit({
      ...args(f),allowedRoots:[tmpdir()],
    }),/CREW_COMMIT_REPO_NOT_ALLOWLISTED/);
    await writeFile(join(f.root,"docs","guide.md"),NEW+"tampering\n");
    await assert.rejects(previewLocalDocCommit(args(f)),
      /MARKDOWN_APPLY_VERIFY_TARGET_HASH_MISMATCH/);
    await writeFile(join(f.root,"docs","guide.md"),NEW);
    const file=join(f.root,".phibot","crew-markdown-applies",f.draftId+".result.json");
    const before=JSON.parse(await readFile(file,"utf8")) as Record<string,unknown>;
    await writeFile(file,JSON.stringify({...before,receiptDigest:"0".repeat(64)}));
    await assert.rejects(previewLocalDocCommit(args(f)),
      /MARKDOWN_APPLY_RESULT_TAMPERED/);
  });
});
test("exclusive attempt receipt blocks another commit after HEAD is reset",async()=>{
  await fixture(async f=>{
    const {intent}=await previewLocalDocCommit(args(f));
    await commitLocalDoc(intent,[f.root]);
    git(f.root,["reset","--hard",f.oldHead]);
    await writeFile(join(f.root,"docs","guide.md"),NEW);
    const again=await previewLocalDocCommit(args(f));
    assert.deepEqual(again.intent,intent);
    await assert.rejects(commitLocalDoc(intent,[f.root]),
      (e:unknown)=>e instanceof Error && "code" in e && e.code==="EEXIST");
    assert.equal(git(f.root,["rev-parse","HEAD"]),f.oldHead);
  });
});
test("read-only verifier rejects target modification and altered receipt",async()=>{
  await fixture(async f=>{
    const {intent}=await previewLocalDocCommit(args(f));
    const saved=await commitLocalDoc(intent,[f.root]);
    assert.equal(verifyLocalDocCommitResult(saved).newHead,saved.newHead);
    await writeFile(join(f.root,"docs","guide.md"),NEW+"tampered\n");
    await assert.rejects(verifyLocalDocCommit(args(f)),
      /CREW_COMMIT_VERIFY_WORKTREE_MISMATCH/);
    await writeFile(join(f.root,"docs","guide.md"),NEW);
    const path=join(localDocCommitDir(f.root),f.draftId+".result.json");
    await writeFile(path,JSON.stringify({...saved,status:"CI_PASSED_AND_MERGED"}));
    await assert.rejects(verifyLocalDocCommit(args(f)),
      /CREW_COMMIT_RESULT_INVALID/);
  });
});
