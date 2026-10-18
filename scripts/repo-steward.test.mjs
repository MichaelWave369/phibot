import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTargetPath, parseIssueTarget, eligibleIssue, extractOpenTasks,
  validateReplacement, survey, selectPendingIssue, main
} from "./repo-steward.mjs";

test("single-file allowlist permits source, docs and tests only", () => {
  for (const path of ["README.md", "docs/ROADMAP.md", "src/ui/panel.tsx", "test/component.test.ts"]) {
    assert.equal(validateTargetPath(path), true, path);
  }
  for (const path of [
    "../.env", "/tmp/file", "src/../../.github/workflows/ci.yml",
    ".github/workflows/ci.yml", "package.json", "src/core/authority.ts",
    "src/security/role.ts", "src/auth/session.js", "docs\\.env", "src//index.ts",
    "src/./x.ts", "docs/secret-keys.md", "src/util.py"
  ]) assert.equal(validateTargetPath(path), false, path);
});

test("explicit target parser rejects ambiguous, missing, or unsafe requests", () => {
  assert.equal(parseIssueTarget("Do the thing\nTarget file: src/app.ts\n"), "src/app.ts");
  assert.equal(parseIssueTarget("Target file: " + String.fromCharCode(96) + "docs/ROADMAP.md" + String.fromCharCode(96)), "docs/ROADMAP.md");
  assert.equal(parseIssueTarget("Target file: .github/workflows/ci.yml"), null);
  assert.equal(parseIssueTarget("Target file: src/a.ts\nTarget file: src/b.ts"), null);
  assert.equal(parseIssueTarget("maybe edit src/a.ts"), null);
});

test("only explicitly labeled open issues are execution eligible", () => {
  const ready = { number: 1, state: "open", labels: [{ name: "phibot-ready" }],
    body: "Target file: docs/ROADMAP.md" };
  assert.equal(eligibleIssue(ready), true);
  assert.equal(eligibleIssue({ ...ready, labels: [] }), false);
  assert.equal(eligibleIssue({ ...ready, state: "closed" }), false);
  assert.equal(eligibleIssue({ ...ready, pull_request: { url: "somewhere" } }), false);
  assert.equal(eligibleIssue({ ...ready, body: "Target file: ../README.md" }), false);
});

test("roadmap tasks are evidence, never equivalent to approved issues", () => {
  assert.deepEqual(extractOpenTasks("# Roadmap\n- [x] Done\n- [ ] Implement a test\n- [ ] Add a report", "README.md"),
    [{ source: "README.md", line: 3, text: "Implement a test" },
      { source: "README.md", line: 4, text: "Add a report" }]);
});

test("replacement rejects no-ops, very large writes, secrets, and mass deletion", () => {
  assert.equal(validateReplacement("a\nb\nc", "a\nb\nc"), false);
  assert.equal(validateReplacement("a\nb\nc", "a\nb\nc\nd"), true);
  assert.equal(validateReplacement("a\nb\nc\nd\ne\nf", "hello"), false);
  assert.equal(validateReplacement("old", "x".repeat(12001)), false);
  assert.equal(validateReplacement("old", "-----BEGIN PRIVATE KEY-----"), false);
  assert.equal(validateReplacement("old", "github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ"), false);
});

test("survey preserves source and issues with no permission promotion", async () => {
  const gh = async (method, resource, data, optional) => {
    if (resource.startsWith("/users/")) return [{ full_name: "MichaelWave369/Demo",
      owner: { login: "MichaelWave369" }, default_branch: "main", archived: false }];
    if (resource.endsWith("/issues?state=open&per_page=100")) return [
      { number: 7, title: "Fix docs", state: "open",
        labels: [{ name: "phibot-ready" }], body: "Target file: README.md",
        html_url: "https://github.com/MichaelWave369/Demo/issues/7" },
      { number: 8, title: "PR, not issue", state: "open",
        pull_request: {}, labels: [{ name: "phibot-ready" }], body: "Target file: README.md" }
    ];
    if (resource.endsWith("/contents/README.md")) return {
      type: "file", encoding: "base64", sha: "abc",
      content: Buffer.from("- [ ] Prepare follow-up\n").toString("base64")
    };
    if (resource.endsWith("/contents/docs/ROADMAP.md") && optional) return null;
    throw new Error("Unexpected mock request " + method + " " + resource);
  };
  const report = await survey(gh, 1);
  assert.equal(report.inspected, 1);
  assert.equal(report.reports[0].issues.length, 1);
  assert.equal(report.reports[0].issues[0].eligible, true);
  assert.equal(report.reports[0].tasks[0].text, "Prepare follow-up");
});

test("write mode refuses unless explicitly authorized, before touching network", async () => {
  const old = process.env.PHIBOT_ENABLE_DRAFT_PRS;
  try {
    delete process.env.PHIBOT_ENABLE_DRAFT_PRS;
    await assert.rejects(main(["run", "--max-repos", "0"]), /max-repos/);
    await assert.rejects(main(["run"]), /Draft candidates require|run requires/);
  } finally {
    if (old === undefined) delete process.env.PHIBOT_ENABLE_DRAFT_PRS;
    else process.env.PHIBOT_ENABLE_DRAFT_PRS = old;
  }
});


test("queue skips existing branches and reaches next eligible issue", async () => {
  const old = process.env.PHIBOT_REPO_ALLOWLIST;
  process.env.PHIBOT_REPO_ALLOWLIST = "MichaelWave369/Demo";
  const repo = { name: "MichaelWave369/Demo", defaultBranch: "main", issues: [
    { eligible: true, number: 1, target: "README.md" },
    { eligible: true, number: 2, target: "README.md" }
  ] };
  const calls = [];
  try {
    const gh = async (method, resource, data, optional) => {
      calls.push(resource);
      if (resource.endsWith("/git/ref/heads/phibot/issue-1")) return { ref: "existing" };
      if (resource.endsWith("/git/ref/heads/phibot/issue-2") && optional) return null;
      if (resource.endsWith("/issues/2")) return { number: 2, state: "open",
        labels: [{ name: "phibot-ready" }], body: "Target file: README.md" };
      if (resource.endsWith("/contents/README.md")) return { type: "file",
        encoding: "base64", sha: "abc", content: Buffer.from("Before").toString("base64") };
      throw new Error("Unexpected " + resource);
    };
    const selection = await selectPendingIssue(gh, { reports: [repo] });
    assert.equal(selection.selected.issue.number, 2);
    assert.equal(selection.skippedExisting, 1);
    assert.ok(!calls.some(path => path.includes("/issues/1")));
    assert.ok(calls.every(path => path.includes("/repos/")));
  } finally {
    if (old === undefined) delete process.env.PHIBOT_REPO_ALLOWLIST;
    else process.env.PHIBOT_REPO_ALLOWLIST = old;
  }
});

test("when all eligible branches exist the queue reports no work without trying generation", async () => {
  const old = process.env.PHIBOT_REPO_ALLOWLIST;
  process.env.PHIBOT_REPO_ALLOWLIST = "MichaelWave369/Demo";
  try {
    const selection = await selectPendingIssue(
      async () => ({ ref: "exists" }),
      { reports: [{ name: "MichaelWave369/Demo", issues: [
        { eligible: true, number: 6, target: "README.md" }
      ] }] }
    );
    assert.equal(selection.selected, null);
    assert.equal(selection.skippedExisting, 1);
  } finally {
    if (old === undefined) delete process.env.PHIBOT_REPO_ALLOWLIST;
    else process.env.PHIBOT_REPO_ALLOWLIST = old;
  }
});
