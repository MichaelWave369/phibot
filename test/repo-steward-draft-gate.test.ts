import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { RealityGate } from "../src/gate/reality-gate.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolCapabilityRegistry } from "../src/tools/registry.js";
import {
  registerGovernedDraftTool, validateGovernedDraftInput,
  type DraftInput,
} from "../src/tools/repo-steward-draft.js";

const REPO = "MichaelWave369/Demo";
const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const NEW = "c".repeat(40);
const BEFORE = "# Demo\nOld sentence.\n";
const AFTER = "# Demo\nUpdated sentence.\n";

const input: DraftInput = {
  repository: REPO,
  issueNumber: 7,
  target: "README.md",
  expectedBaseSha: BASE,
  expectedBlobSha: BLOB,
  replacement: AFTER,
  summary: "Updated an existing documentation sentence.",
};

const manifest = (write: PhiBotManifest["authority"]["write"] = true,
  declared = true): PhiBotManifest => ({
  id: "governed-writer",
  name: "Governed Writer",
  version: "0.1.0",
  role: "single_file_draft",
  description: "PHIBOT-22 review fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "repo", maxDepth: 1 },
  capabilities: declared ? ["repo.steward.draft"] : [],
  authority: { read: true, propose: true, write, deploy: false },
  escalation: { target: "human", confidenceBelow: 0.95 },
});

function mockedGitHub({
  existingBranch = false, revoked = false, changedBase = false,
  changedBlob = false, failureAt = "",
} = {}) {
  const calls: { method: string; path: string; data: Record<string, unknown> | null }[] = [];
  const transport = (async (uri: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(uri));
    const path = url.pathname + url.search;
    const method = init?.method ?? "GET";
    const data = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ method, path, data });
    if (path.includes(failureAt) && failureAt) return new Response("{}", { status: 502 });

    let status = 200;
    let response: unknown = null;
    if (path === "/repos/" + REPO) {
      response = { full_name: REPO, default_branch: "main",
        owner: { login: "MichaelWave369" }, archived: false, fork: false };
    } else if (path.includes("/git/ref/heads/phibot%2Fissue-7")) {
      if (existingBranch) response = { ref: "refs/heads/phibot/issue-7" };
      else status = 404;
    } else if (path.endsWith("/issues/7")) {
      response = { state: "open", number: 7, title: "Fix the README",
        body: "Target file: README.md\nKeep wording clear",
        labels: revoked ? [] : [{ name: "phibot-ready" }] };
    } else if (path.endsWith("/git/ref/heads/main")) {
      response = { object: { sha: changedBase ? "d".repeat(40) : BASE } };
    } else if (path.includes("/contents/README.md?ref=")) {
      response = { type: "file", encoding: "base64",
        sha: changedBlob ? "d".repeat(40) : BLOB,
        content: Buffer.from(BEFORE).toString("base64") };
    } else if (method === "POST" && path.endsWith("/git/refs")) {
      response = { ref: "refs/heads/phibot/issue-7" };
    } else if (method === "PUT" && path.endsWith("/contents/README.md")) {
      response = { commit: { sha: NEW } };
    } else if (method === "POST" && path.endsWith("/pulls")) {
      response = { number: 13, draft: true,
        html_url: "https://github.com/" + REPO + "/pull/13" };
    } else throw new Error("Unknown test GitHub request " + method + " " + path);

    return new Response(JSON.stringify(response), {
      status, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const registry = registerGovernedDraftTool(new ToolCapabilityRegistry(), {
    owner: "MichaelWave369", allowlist: [REPO],
    token: "fake-scoped-token", writeEnabled: true, fetchImpl: transport,
  });
  const ledger = new MemoryLedger();
  const gate = new RealityGate({ secret: "this_is_a_test_secret_value_123456", ledger });
  const executor = new ToolExecutor(registry, ledger, { timeoutMs: 3000 }, gate);
  return { registry, ledger, gate, executor, calls };
}

async function grantFor(h: ReturnType<typeof mockedGitHub>,
  payload: DraftInput = input, runId = "run-one") {
  const first = await h.executor.execute(manifest(), {
    capability: "repo.steward.draft", input: payload,
  }, runId);
  assert.equal(first.status, "gated");
  assert.ok(first.gateRequest);
  const decision = await h.gate.decide(first.gateRequest!, { outcome: "approve" });
  assert.ok(decision.grant);
  return decision.grant!;
}

test("sensitive draft capability is mandatory Reality-Gated despite write true", async () => {
  const h = mockedGitHub();
  const info = h.registry.get("repo.steward.draft");
  assert.equal(info?.actionClass, "write");
  assert.equal(info?.external, true);
  assert.equal(info?.requiresGate, true);
  const first = await h.executor.execute(manifest(true), {
    capability: "repo.steward.draft", input,
  });
  assert.equal(first.status, "gated");
  assert.ok(first.gateRequest);
  assert.equal(h.calls.length, 0);
  assert.ok(h.ledger.receipts.some(r => r.metadata?.tool &&
    (r.metadata.tool as Record<string, unknown>).reason === "reality_gate_required"));
});

test("missing Reality Gate configuration never allows a write:true bypass", async () => {
  const h = mockedGitHub();
  const without = new ToolExecutor(h.registry, h.ledger);
  const outcome = await without.execute(manifest(true), {
    capability: "repo.steward.draft", input,
  });
  assert.equal(outcome.status, "gated");
  assert.match(outcome.error ?? "", /grant/i);
  assert.equal(h.calls.length, 0);
});

test("write:false, missing declared capability, and changed grant-bound input all deny", async () => {
  const h = mockedGitHub();
  const denied = await h.executor.execute(manifest(false), {
    capability: "repo.steward.draft", input,
  });
  assert.equal(denied.status, "denied");
  const undeclared = await h.executor.execute(manifest(true, false), {
    capability: "repo.steward.draft", input,
  });
  assert.equal(undeclared.status, "denied");
  const grant = await grantFor(h);
  const changed = await h.executor.execute(manifest(), {
    capability: "repo.steward.draft",
    input: { ...input, replacement: AFTER + "extra" }, grant,
  }, "run-one");
  assert.equal(changed.status, "denied");
  assert.match(changed.error ?? "", /digest/);
  assert.equal(h.calls.length, 0);
});

test("invalid targets, credential paths, other repos and unexpected keys are rejected", () => {
  const scope = new Set([REPO]);
  for (const bad of [
    { ...input, target: "src/app.ts" },
    { ...input, target: ".github/workflows/ci.yml" },
    { ...input, target: "docs/../README.md" },
    { ...input, target: "docs/security-secrets.md" },
    { ...input, repository: "OtherOwner/Other" },
    { ...input, expectedBaseSha: "short" },
    { ...input, extra: true },
    { ...input, summary: "short" },
  ]) {
    assert.throws(() => validateGovernedDraftInput(bad, "MichaelWave369", scope), /denied/);
  }
  assert.deepEqual(validateGovernedDraftInput(input, "MichaelWave369", scope), input);
});

test("approved, unchanged SHA-bound input writes only one doc and one draft PR", async () => {
  const h = mockedGitHub();
  const grant = await grantFor(h);
  const result = await h.executor.execute(manifest(), {
    capability: "repo.steward.draft", input, grant,
  }, "run-one");
  assert.equal(result.status, "executed");
  assert.deepEqual(result.output, {
    status: "DRAFT_PR_CREATED_CI_UNVERIFIED",
    repository: REPO, issueNumber: 7, target: "README.md",
    branch: "phibot/issue-7", prNumber: 13,
    url: "https://github.com/" + REPO + "/pull/13", commitSha: NEW,
  });
  assert.deepEqual(h.calls.filter(x => x.method !== "GET").map(x => x.method),
    ["POST", "PUT", "POST"]);
  const write = h.calls.find(x => x.method === "PUT");
  assert.equal(write?.data?.branch, "phibot/issue-7");
  assert.equal(write?.data?.sha, BLOB);
  assert.equal(Buffer.from(String(write?.data?.content), "base64").toString("utf8"), AFTER);
  assert.equal(h.calls.at(-1)?.data?.draft, true);
  assert.equal(h.ledger.receipts.at(-1)?.status, "ok");
  assert.ok(!JSON.stringify(h.ledger.receipts).includes(AFTER));
});

test("single-use grant replay cannot create a second branch or PR", async () => {
  const h = mockedGitHub();
  const grant = await grantFor(h);
  const first = await h.executor.execute(manifest(), {
    capability: "repo.steward.draft", input, grant,
  }, "run-one");
  assert.equal(first.status, "executed");
  const writes = h.calls.length;
  const replay = await h.executor.execute(manifest(), {
    capability: "repo.steward.draft", input, grant,
  }, "run-one");
  assert.equal(replay.status, "denied");
  assert.match(replay.error ?? "", /replay/);
  assert.equal(h.calls.length, writes);
});

test("existing branch, revoked issue, moved base and changed blob fail before any remote write", async () => {
  for(const [override, reason] of [
    [{ existingBranch: true }, /already exists/],
    [{ revoked: true }, /authorization/],
    [{ changedBase: true }, /moved/],
    [{ changedBlob: true }, /blob SHA/],
  ] as const) {
    const h = mockedGitHub(override);
    const grant = await grantFor(h);
    const result = await h.executor.execute(manifest(), {
      capability: "repo.steward.draft", input, grant,
    }, "run-one");
    assert.equal(result.status, "failed", JSON.stringify(override));
    assert.match(result.error ?? "", reason);
    assert.ok(h.calls.every(c => c.method === "GET"));
  }
});

test("network errors deny requests and cannot advance writes", async () => {
  const h = mockedGitHub({ failureAt: "/issues/7" });
  const grant = await grantFor(h);
  const result = await h.executor.execute(manifest(), {
    capability: "repo.steward.draft", input, grant,
  }, "run-one");
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /HTTP 502/);
  assert.ok(h.calls.every(c => c.method === "GET"));
});

test("capability honors independent runtime write enablement even after gate grant", async () => {
  const h = mockedGitHub();
  const deniedRegistry = registerGovernedDraftTool(new ToolCapabilityRegistry(), {
    owner: "MichaelWave369", allowlist: [REPO], token: "fake", writeEnabled: false,
    fetchImpl: (async () => { throw new Error("must not request"); }) as typeof fetch,
  });
  const deniedExecutor = new ToolExecutor(deniedRegistry, h.ledger, {}, h.gate);
  const grant = await grantFor(h, input, "same-run");
  const outcome = await deniedExecutor.execute(manifest(), {
    capability: "repo.steward.draft", input, grant,
  }, "same-run");
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /disabled/);
  assert.equal(h.calls.length, 0);
});

test("untrusted issue body cannot change the approved target", async () => {
  const h = mockedGitHub();
  const grant = await grantFor(h, input, "different-run");
  const bad = await h.executor.execute(manifest(), {
    capability: "repo.steward.draft",
    input: { ...input, target: "docs/README.md" }, grant,
  }, "different-run");
  assert.equal(bad.status, "denied");
  assert.equal(h.calls.length, 0);
});
