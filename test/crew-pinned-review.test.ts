import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PhiProvider, ProviderRequest } from "../src/providers/types.js";
import type { CrewReadinessView } from "../src/qualification/crew-readiness.js";
import { readPinnedDocument, validatePinnedArgs } from "../src/crew-pinned-source.js";
import { runPinnedReview, listPinnedReviews, verifyPinnedReview } from "../src/crew-pinned-review.js";

const MODEL = "qwen3:4b";
const AT = new Date("2026-11-06T19:30:00.000Z");
const ORIGINAL = "# Test pilot\nThis fictional instruction uses --dry-run and the next line says --preview.\n";
const SHA256 = (v: string) => createHash("sha256").update(v).digest("hex");
const readiness: CrewReadinessView = {
  schema: "phibot.crew.readiness-view.v1",
  classification: "LOCAL_OPERATOR_SELF_REPORT_NOT_ATTESTED",
  maxAgeMs: 3600000,
  records: [{
    model: MODEL, ollamaPort: 11434, checkedAt: AT.toISOString(),
    status: "RECENT_PROBE_PASS_SELF_REPORT",
    inferenceLatencyMs: 40, inferenceAttempts: 1, digest: "a".repeat(64),
  }],
};
function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
async function fixture(fn: (root: string, sha: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "phibot-pin-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "local-test@example.invalid"]);
    git(root, ["config", "user.name", "PhiBot Test"]);
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "pilot.md"), ORIGINAL);
    await writeFile(join(root, "README.md"), "# Safe sample\n");
    git(root, ["add", "docs/pilot.md", "README.md"]);
    git(root, ["commit", "-qm", "documentation snapshot"]);
    const sha = git(root, ["rev-parse", "HEAD"]);
    await fn(root, sha);
  } finally { await rm(root, { recursive: true, force: true }); }
}
function fakeProvider(seen: ProviderRequest[], brokenAt = -1): PhiProvider {
  return {
    id: "ollama", model: MODEL,
    async complete(request) {
      const index = seen.length;
      seen.push(request);
      return {
        provider: "ollama", model: MODEL, fallback: false,
        content: JSON.stringify(index === brokenAt
          ? { summary: "unsafe", confidence: 0.8, action: { authority: "write" } }
          : { summary: "Unverified " + request.manifest.role, confidence: 0.8 }),
        metrics: { latencyMs: 10, attempts: 1 },
      };
    },
  };
}
test("source reader pins exact committed bytes, ignoring dirty worktree", async () => {
  await fixture(async (root, commit) => {
    await writeFile(join(root, "docs/pilot.md"), "DIRTY WORKTREE CONTENT");
    const doc = await readPinnedDocument({
      repoDir: root, allowedRoots: [root], commit, path: "docs/pilot.md",
    });
    assert.equal(doc.commit, commit);
    assert.equal(doc.path, "docs/pilot.md");
    assert.equal(doc.sha256, SHA256(ORIGINAL));
    assert.equal(doc.bytes, Buffer.byteLength(ORIGINAL));
    assert.equal(doc.text, ORIGINAL);
    assert.equal(doc.trust, "LOCAL_GIT_COMMIT_NOT_REMOTE_ATTESTED");
  });
});
test("reject unallowlisted repos, unsafe files, shortened pins and unavailable commits", async () => {
  await fixture(async (root, commit) => {
    for (const path of [
      "../.env", ".git/config", "src/secret.ts", "docs/../README.md",
      "docs/.hidden.md", "docs/a b.md", "README.md:secret",
    ]) {
      assert.throws(() => validatePinnedArgs(commit, path), /CREW_PIN_PATH_NOT_ALLOWLISTED/);
    }
    assert.throws(() => validatePinnedArgs(commit.slice(0, 7), "README.md"),
      /CREW_PIN_COMMIT_INVALID/);
    await assert.rejects(readPinnedDocument({
      repoDir: root, allowedRoots: [tmpdir()], commit, path: "README.md",
    }), /CREW_PIN_REPOSITORY_NOT_ALLOWED/);
    await assert.rejects(readPinnedDocument({
      repoDir: root, allowedRoots: [root], commit: "0".repeat(40), path: "README.md",
    }));
    await assert.rejects(readPinnedDocument({
      repoDir: root, allowedRoots: [], commit, path: "README.md",
    }), /CREW_PIN_REPOSITORY_ALLOWLIST_REQUIRED/);
  });
});
test("symlink blobs and oversized documents are refused before model calls", async () => {
  await fixture(async (root, _sha) => {
    await symlink("../README.md", join(root, "docs", "linked.md"));
    await writeFile(join(root, "docs", "oversized.md"), "x".repeat(7000));
    git(root, ["add", "docs/linked.md", "docs/oversized.md"]);
    git(root, ["commit", "-qm", "unsafe fixtures"]);
    const commit = git(root, ["rev-parse", "HEAD"]);
    await assert.rejects(readPinnedDocument({
      repoDir: root, allowedRoots: [root], commit, path: "docs/linked.md",
    }), /CREW_PIN_NOT_REGULAR_DOC_BLOB/);
    await assert.rejects(readPinnedDocument({
      repoDir: root, allowedRoots: [root], commit, path: "docs/oversized.md",
    }), /CREW_PIN_DOCUMENT_SIZE_OR_BINARY_INVALID|ENOBUFS/);
  });
});
test("three reviewers see only a pinned document, no tools, and produce review evidence", async () => {
  await fixture(async (root, commit) => {
    const seen: ProviderRequest[] = [];
    const dir = join(root, "trial-receipts");
    const { record, path } = await runPinnedReview({
      repoDir: root, allowedRoots: [root], commit, filePath: "docs/pilot.md",
      model: MODEL, dir, now: () => AT,
      readReadiness: async () => readiness,
      providerFactory: () => fakeProvider(seen),
    });
    assert.equal(record.status, "THREE_ADVISORIES_UNVERIFIED");
    assert.deepEqual(seen.map(r => r.stage), ["observe", "propose", "verify"]);
    assert.deepEqual(seen.map(r => r.manifest.role),
      ["scout_advisory_only", "patch_advisory_only", "skeptic_advisory_only"]);
    for (const request of seen) {
      assert.deepEqual(request.manifest.capabilities, []);
      assert.deepEqual(request.manifest.authority,
        { read: false, propose: false, write: false, deploy: false });
      assert.deepEqual(request.prior, []);
      assert.ok(request.input.task.includes(ORIGINAL.trim()));
      assert.ok(request.input.task.includes(commit));
    }
    assert.equal(record.source.sha256, SHA256(ORIGINAL));
    assert.equal(record.source.commit, commit);
    assert.equal(record.source.path, "docs/pilot.md");
    assert.equal(record.readinessDigest, "a".repeat(64));
    assert.equal(record.authority, "NO_TOOLS_NO_WRITES_NO_GRANTS");
    assert.equal((await readFile(path, "utf8")).includes(ORIGINAL), false);
    assert.deepEqual((await listPinnedReviews(dir))[0], record);
  });
});
test("missing, stale or wrong-port evidence refuses before a provider exists", async () => {
  await fixture(async (root, commit) => {
    for (const altered of [
      { ...readiness, records: [] },
      { ...readiness, records: [{ ...readiness.records[0], status: "STALE_PROBE" }] },
      { ...readiness, records: [{ ...readiness.records[0], ollamaPort: 19999 }] },
      { ...readiness, records: [{ ...readiness.records[0], status: "FAILED_PROBE" }] },
    ] as CrewReadinessView[]) {
      await assert.rejects(runPinnedReview({
        repoDir: root, allowedRoots: [root], commit, filePath: "docs/pilot.md",
        model: MODEL, now: () => AT,
        readReadiness: async () => altered,
        providerFactory: () => { throw Error("SHOULD_NOT_CREATE_PROVIDER"); },
      }), /CREW_READINESS_REQUIRED/);
    }
  });
});
test("bad patch output refuses Skeptic; receipt is failure without approval", async () => {
  await fixture(async (root, commit) => {
    const seen: ProviderRequest[] = [];
    const { record } = await runPinnedReview({
      repoDir: root, allowedRoots: [root], commit, filePath: "docs/pilot.md",
      model: MODEL, dir: join(root, "failures"), now: () => AT,
      readReadiness: async () => readiness,
      providerFactory: () => fakeProvider(seen, 1),
    });
    assert.equal(record.status, "FAILED_INCOMPLETE_NO_APPROVAL");
    assert.deepEqual(seen.map(r => r.stage), ["observe", "propose"]);
    assert.equal(record.stages.length, 1);
  });
});
test("tampered or authority-inflated records cannot pass local verification", async () => {
  await fixture(async (root, commit) => {
    const seen: ProviderRequest[] = [];
    const dir = join(root, "verified");
    const { record, path } = await runPinnedReview({
      repoDir: root, allowedRoots: [root], commit, filePath: "docs/pilot.md",
      model: MODEL, dir, now: () => AT,
      readReadiness: async () => readiness,
      providerFactory: () => fakeProvider(seen),
    });
    assert.throws(() => verifyPinnedReview({ ...record, authority: "WRITE" }),
      /CREW_PINNED_RECEIPT_INVALID/);
    assert.throws(() => verifyPinnedReview({ ...record, permission: true }),
      /CREW_PINNED_RECEIPT_SCHEMA_INVALID/);
    await writeFile(path, JSON.stringify({
      ...record, source: { ...record.source, sha256: "f".repeat(64) },
    }));
    await assert.rejects(listPinnedReviews(dir), /CREW_PINNED_DIGEST_MISMATCH/);
  });
});
