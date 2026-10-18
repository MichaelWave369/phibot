# PhiBot Repo Steward: opt-in autonomous draft-PR candidate (v0.1)

PhiBot can now **survey owned public GitHub repositories** for explicit work and, after one-time operator configuration, ask a **local Ollama model** to attempt one narrow issue and create a **draft pull request**. No subscription inference, unlimited repo access, autonomous merging, deployment, or runtime sandbox is claimed.

This is an **isolated candidate runner**, not yet a tool capability registered with PhiBot's Reality Gate. Its own static guards and GitHub credential scope limit authority; integrating with the main tool registry and Reality Gate is a later milestone. Do not describe this as a fully qualified autonomous PhiBot crew.

## What it does

1. Read the first N recently updated public, owned, nonarchived repositories from GitHub. Default N=30, maximum 300.
2. Observe open GitHub issues plus unchecked items in README.md and docs/ROADMAP.md. Roadmap items are advisory evidence, **not authorization**.
3. Select one open issue with the literal label **phibot-ready**, an explicit **Target file:** line and a repository in the operator's comma-separated allowlist.
4. Re-read the issue and validate its eligibility before attempting a change.
5. Ask Ollama on **127.0.0.1/localhost** for one complete-file replacement using schema-constrained JSON. Reject no-ops, large files, major shrinkage, obvious secrets, unsafe paths and malformed output.
6. With explicit write enablement, create a dedicated branch and **draft PR** in the target repo. Never merge, approve, close the issue, publish, deploy or execute commands from the target repo.
7. Append a metadata-only receipt to .phibot/repo-steward/ledger.ndjson on the local machine.

The runner neither promises the generated patch is correct nor verifies tests; existing target-repo CI may run when a PR opens. Verify checks and diff before merge.

## Preparation (Windows PowerShell, Node 22+ and Ollama)

From a local clone of the PhiBot repository:

~~~powershell
git pull origin main
npm.cmd install
npm.cmd test
ollama list
~~~

Create an open issue in **one** allowed repository. Apply label **phibot-ready** and include a task with acceptance criteria and exactly one target:

~~~text
Title: Document the new configuration option

Acceptance:
- The README describes the option and its default.
- Existing behavior remains unchanged.

Target file: README.md
~~~

The file must already exist. Valid targets are README.md, docs/*, src/*, or test/* with supported text extensions; sensitive files, path escapes, workflow files and root configs are excluded. Multi-file work is not eligible. The label is human-assigned authorization to *attempt a draft candidate*, not a grant to merge it.

## Discover next steps without writing

~~~powershell
npm.cmd run steward:scan -- --max-repos 50
~~~

This only reads. It emits JSON with repository provenance, checkbox line numbers, issues and explicit eligibility. A missing or unsupported repository results in an error record instead of a claim that it was inspected successfully.

## Trial one locally generated edit without writing to GitHub

Authenticate with a **fine-grained GitHub token** scoped to selected repositories. Grant the least permissions necessary: Metadata read; Contents read/write; Issues read; Pull requests read/write. Keep it in a secure local credential store or short-lived process environment. Do not commit it, copy it into an issue, or paste it into chats.

~~~powershell
$env:PHIBOT_GITHUB_TOKEN = "<locally retrieved credential>"
$env:PHIBOT_REPO_ALLOWLIST = "MichaelWave369/Domistika,MichaelWave369/phibot"
$env:PHIBOT_MODEL = "qwen3.5:9b"
npm.cmd run steward:dry -- --max-repos 100
~~~

The dry run invokes the local model and validates its returned replacement but makes no GitHub writes. This is not a semantic patch verification or test run.

## Enable unattended draft PRs after examining dry-run output

~~~powershell
$env:PHIBOT_ENABLE_DRAFT_PRS = "1"
npm.cmd run steward:run -- --max-repos 100
~~~

Schedule that command using Windows Task Scheduler on the PC that hosts Ollama (e.g. daily). Use a dedicated task account with the minimum GitHub access. Arrange secure token retrieval in that account's session; never embed the token in a scheduled-task argument, repo file, transcript, or plaintext startup script. Schedule setup is **not** installed by this PR. The PC and Ollama must be awake and available.

The run can open **at most one draft PR**. Re-running for an issue whose phibot/issue-N branch already exists does not overwrite it. Keep owner/repo allowlists short initially and expand only after qualification.

## Limitations and next gates

- Public user-repository discovery is used; private repos are not scanned by this version even with a token.
- Issue and roadmap discovery only examines up to 100 open issues and two documentation files per inspected repo. It does not infer every possible next step from commits, PR review threads or broken builds.
- Only one existing file may change. No multi-file refactor, local test execution, dependency installation, CI verification or PR merge.
- AI-authored code can still be wrong or unsafe. Draft PRs need CI and independent review.
- The bounded source filter is **not** an OS sandbox or robust prompt-injection defense. Use a low-privilege local account, narrow token and ideally a disposable VM/container before wider trials.
- The first eligible issue is selected by scan order, not semantic priority. Re-run after review, or remove the ready label if the task is unsuitable.
- Next rung: attach repo.read, repo.patch and tests.run to the main PhiBot registry/Reality Gate, add per-repo policy and sandboxed tests, GitHub check gates, repeat protection, automatic risk scoring, and a two-bot reviewer. Only later consider policy-based auto-merge for a narrowly permitted low-risk class.

**Ledger above ego: source text is evidence, proposed changes are proposals, and green CI is not the same as correct behavior.**
