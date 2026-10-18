import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { RealityGate } from "../src/gate/reality-gate.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolCapabilityRegistry } from "../src/tools/registry.js";
import {
  registerGovernedRepairTool, validateRepairInput, failedCiEvidence, repairTarget,
  boundedRepair, type GovernedRepairInput,
} from "../src/tools/repo-steward-repair-gated.js";

const REPO = "MichaelWave369/Demo", SHA = "a".repeat(40);
const BLOB = "b".repeat(40), NEW_SHA = "c".repeat(40);
const BEFORE = "export function answer() {\n  return 1;\n}\n";
const AFTER = "export function answer() {\n  return 2;\n}\n";

const proposal: GovernedRepairInput = {
  repository: REPO, prNumber: 12, issueNumber: 7, target: "src/calc.ts",
  expectedHeadSha: SHA, expectedBlobSha: BLOB,
  replacement: AFTER, summary: "Correct the calculation in the existing function.",
};

const manifest = (write: PhiBotManifest["authority"]["write"] = true,
  declared = true): PhiBotManifest => ({
  id: "repair-operator", name: "Repair Operator", version: "0.1.0",
  role: "governed_repair", description: "PHIBOT-23 unit test",
  model: { provider: "operator", name: "human" },
  memory: { scope: "repo", maxDepth: 1 },
  capabilities: declared ? ["repo.steward.repair"] : [],
  authority: { read: true, propose: true, write, deploy: false },
  escalation: { target: "human", confidenceBelow: 0.99 },
});

const failed = { total_count: 1, check_runs: [
  { id: 10, name: "unit", status: "completed", conclusion: "failure" },
] };
const successes = { total_count: 1, check_runs: [
  { id: 11, name: "unit", status: "completed", conclusion: "success" },
] };
const statuses = { total_count: 0, statuses: [] };

type MockOptions = {
  noToken?: boolean; writeEnabled?: boolean; revoked?: boolean;
  priorRepair?: boolean; multiFile?: boolean; changedHead?: boolean;
  wrongBlob?: boolean; ciPassing?: boolean; ciPending?: boolean;
  branchMoved?: boolean; baseBehind?: boolean; missingChecks?: boolean;
};
function harness(options: MockOptions = {}) {
  const calls: { method: string; path: string; data: Record<string, unknown> | null }[] = [];
  let prReads = 0;
  const transport = (async (uri: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(uri));
    const path = url.pathname + url.search;
    const method = init?.method ?? "GET";
    const data = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ method, path, data });
    let response: unknown;
    const prefix = "/repos/" + REPO;
    if (path === prefix) response = {
      full_name: REPO, owner: { login: "MichaelWave369" },
      default_branch: "main", fork: false,
    };
    else if (path === prefix + "/pulls/12") {
      prReads++;
      response = {
        number: 12, state: "open", draft: true, mergeable: true,
        title: "PhiBot candidate: fix calc",
        body: "Autonomous local-model candidate for #7\n\nTarget file: src/calc.ts\n",
        head: { ref: "phibot/issue-7",
          sha: options.changedHead && prReads > 1 ? "d".repeat(40) : SHA,
          repo: { full_name: REPO } },
        base: { ref: "main", repo: { full_name: REPO } },
      };
    } else if (path === prefix + "/issues/7") response = {
      number: 7, state: "open",
      labels: options.revoked ? [] : [{ name: "phibot-ready" }],
      body: "Target file: src/calc.ts",
    };
    else if (path.endsWith("/pulls/12/files?per_page=100")) response = options.multiFile
      ? [{ filename: "src/calc.ts", status: "modified" },
        { filename: "src/extra.ts", status: "added" }]
      : [{ filename: "src/calc.ts", status: "modified" }];
    else if (path.endsWith("/pulls/12/commits?per_page=100")) response = [
      { commit: { message: "phibot: candidate fix #7" } },
      ...(options.priorRepair ? [{ commit: { message: "phibot: repair-once pr#12" } }] : []),
    ];
    else if (path.endsWith("/check-runs?per_page=100")) response = options.ciPassing
      ? successes : options.ciPending ? { total_count: 1, check_runs: [
        { id: 12, name: "unit", status: "queued", conclusion: null },
      ] } : failed;
    else if (path.endsWith("/status?per_page=100")) response = statuses;
    else if (path.includes("/compare/")) response = { behind_by: options.baseBehind ? 2 : 0 };
    else if (path.includes("/contents/src/calc.ts?ref=")) response = {
      type: "file", encoding: "base64", sha: options.wrongBlob ? "d".repeat(40) : BLOB,
      content: Buffer.from(BEFORE).toString("base64"),
    };
    else if (path.includes("/git/ref/heads/phibot%2Fissue-7")) response = {
      object: { sha: options.branchMoved ? "d".repeat(40) : SHA },
    };
    else if (method === "PUT" && path.endsWith("/contents/src/calc.ts")) response = {
      commit: { sha: NEW_SHA },
    };
    else throw new Error("Unexpected remote call: " + method + " " + path);
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  const registry = registerGovernedRepairTool(new ToolCapabilityRegistry(), {
    owner: "MichaelWave369", allowlist: [REPO], requiredChecks: options.missingChecks ? [] : ["unit"],
    token: options.noToken ? "" : "fake-token", writeEnabled: options.writeEnabled ?? true,
    fetchImpl: transport,
  });
  const ledger = new MemoryLedger();
  const gate = new RealityGate({ secret: "1234567890abcdef1234567890abcdef", ledger });
  return { ledger, gate, registry,
    executor: new ToolExecutor(registry, ledger, { timeoutMs: 4000 }, gate), calls };
}

async function getGrant(h: ReturnType<typeof harness>, runId = "governed-one") {
  const request = await h.executor.execute(manifest(), {
    capability: "repo.steward.repair", input: proposal,
  }, runId);
  assert.equal(request.status, "gated");
  assert.ok(request.gateRequest);
  const decision = await h.gate.decide(request.gateRequest, { outcome: "approve" });
  assert.ok(decision.grant);
  return decision.grant!;
}

test("repair capability registration is safe without CI policy or write credentials", () => {
  const registry = registerGovernedRepairTool(new ToolCapabilityRegistry(), {
    owner: "MichaelWave369", allowlist: [], requiredChecks: [],
    token: "", writeEnabled: false,
  });
  assert.equal(registry.get("repo.steward.repair")?.requiresGate, true);
});

test("repair target rejects sensitive paths and traversal", () => {
  assert.equal(repairTarget("src/calc.ts"), true);
  for (const target of ["src/core/auth.ts", "src/gate/sign.ts", "test/../config.js",
    ".github/workflows/ci.yml", "package.json", "docs/README.md",
    "src/./calc.ts", "src/secret-tokens.js", "src/util.json"]) assert.equal(repairTarget(target), false);
});

test("exact proposal rejects malicious replacements or changed grant scope", () => {
  const allowlist = new Set([REPO]);
  assert.deepEqual(validateRepairInput(proposal, "MichaelWave369", allowlist), proposal);
  for (const change of [
    { ...proposal, repository: "OtherOwner/Demo" },
    { ...proposal, prNumber: 0 },
    { ...proposal, issueNumber: -1 },
    { ...proposal, target: "src/auth/session.ts" },
    { ...proposal, expectedHeadSha: "short" },
    { ...proposal, summary: "short" },
    { ...proposal, unexpected: true },
  ]) assert.throws(() => validateRepairInput(change, "MichaelWave369", allowlist), /denied/);
  assert.equal(boundedRepair(BEFORE, AFTER), true);
  assert.equal(boundedRepair(BEFORE, BEFORE), false);
  assert.equal(boundedRepair(BEFORE, "ghp_" + "x".repeat(25)), false);
  assert.equal(boundedRepair("a\n".repeat(110), "b\n".repeat(110)), false);
});

test("CI evidence requires exact configured check names and completed failures", () => {
  assert.equal(failedCiEvidence(failed, statuses, ["unit"]), true);
  assert.equal(failedCiEvidence(successes, statuses, ["unit"]), false);
  assert.equal(failedCiEvidence(failed, statuses, ["lint"]), false);
  assert.equal(failedCiEvidence(failed, statuses, []), false);
  assert.equal(failedCiEvidence({ total_count: 101, check_runs: failed.check_runs },
    statuses, ["unit"]), false);
  assert.equal(failedCiEvidence({ total_count: 2, check_runs: [
    ...failed.check_runs, { id: 11, name: "other", status: "queued" },
  ] }, statuses, ["unit"]), false);
});

test("write:true still requests a Reality Gate approval and never touches GitHub before it", async () => {
  const h = harness();
  const status = await h.executor.execute(manifest(true), {
    capability: "repo.steward.repair", input: proposal,
  });
  assert.equal(status.status, "gated");
  assert.equal(h.calls.length, 0);
  assert.equal(h.registry.get("repo.steward.repair")?.actionClass, "write");
});

test("denied manifest and replayed or altered grant make no network writes", async () => {
  const h = harness();
  const nope = await h.executor.execute(manifest(false), {
    capability: "repo.steward.repair", input: proposal,
  });
  assert.equal(nope.status, "denied");
  const grant = await getGrant(h);
  const altered = await h.executor.execute(manifest(), {
    capability: "repo.steward.repair", input: { ...proposal, replacement: AFTER + "x" }, grant,
  }, "governed-one");
  assert.equal(altered.status, "denied");
  assert.match(altered.error ?? "", /digest/);
  assert.equal(h.calls.length, 0);
});

test("single successful repair writes only one PUT to an existing PR branch", async () => {
  const h = harness();
  const grant = await getGrant(h);
  const res = await h.executor.execute(manifest(), {
    capability: "repo.steward.repair", input: proposal, grant,
  }, "governed-one");
  assert.equal(res.status, "executed", res.error);
  assert.deepEqual(res.output, {
    status: "REPAIR_COMMIT_PUSHED_CI_UNVERIFIED", repository: REPO,
    prNumber: 12, issueNumber: 7, target: "src/calc.ts",
    oldHeadSha: SHA, newHeadSha: NEW_SHA,
  });
  const writes = h.calls.filter(c => c.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.method, "PUT");
  assert.equal(writes[0]?.path, "/repos/" + REPO + "/contents/src/calc.ts");
  assert.equal(writes[0]?.data?.branch, "phibot/issue-7");
  assert.equal(writes[0]?.data?.sha, BLOB);
  assert.equal(Buffer.from(String(writes[0]?.data?.content), "base64").toString("utf8"), AFTER);
  assert.ok(!JSON.stringify(h.ledger.receipts).includes(AFTER));
  const callsBefore = h.calls.length;
  const second = await h.executor.execute(manifest(), {
    capability: "repo.steward.repair", input: proposal, grant,
  }, "governed-one");
  assert.equal(second.status, "denied");
  assert.equal(h.calls.length, callsBefore);
});

test("revoked issue, prior repair, multi-file changes and stale head refuse BEFORE PUT", async () => {
  for (const [scenario, expected] of [
    [{ revoked: true }, /authorization/],
    [{ priorRepair: true }, /Previous repair/],
    [{ multiFile: true }, /one modified/],
    [{ changedHead: true }, /changed/],
    [{ wrongBlob: true }, /blob/],
    [{ branchMoved: true }, /changed/],
    [{ baseBehind: true }, /CI is missing/],
    [{ ciPassing: true }, /CI is missing/],
    [{ ciPending: true }, /CI is missing/],
    [{ missingChecks: true }, /PHIBOT_REQUIRED_CHECKS/],
    [{ writeEnabled: false }, /disabled/],
  ] as const) {
    const h = harness(scenario);
    const grant = await getGrant(h);
    const res = await h.executor.execute(manifest(), {
      capability: "repo.steward.repair", input: proposal, grant,
    }, "governed-one");
    assert.equal(res.status, "failed", JSON.stringify(scenario));
    assert.match(res.error ?? "", expected);
    assert.equal(h.calls.filter(c => c.method === "PUT").length, 0);
  }
});
