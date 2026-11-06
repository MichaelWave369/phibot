# PHIBOT-38: Source-pinned, read-only crew review

PHIBOT-38 allows a manually triggered local Scout → Patch → Skeptic advisory review of **one real, explicitly selected Markdown file at one exact local Git commit**. No bot gets a repository client, shell, filesystem access, tokens, or write authority. The program itself uses read-only Git commands to retrieve the chosen committed blob, then sends a bounded excerpt to local Ollama.

## Preconditions

Node 22+, Git, and Ollama running locally on 127.0.0.1:11434 are required. First qualify the exact local model with `npm.cmd run model:qualify -- --model qwen3:4b`. The readiness receipt must report a recent PASS for the same model and port. A PASS remains a local self-report, not independent attestation, competence certification or permission to run tools.

Your working clone must have an explicit **repository root allowlist**. This prevents selecting arbitrary local Git repositories, even though this rung only reads documentation. The caller must provide a full 40-character SHA-1 commit hash. Branch names, moving HEAD references, abbreviated SHAs and remote URLs are refused.

## PowerShell quick start

From the local PhiBot clone, after reviewing and merging PR #57:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
npm.cmd run model:qualify -- --model qwen3:4b
$env:PHIBOT_CREW_REPO_ALLOWLIST = (Resolve-Path .).Path
$pin = git rev-parse HEAD
npm.cmd run crew:pinned -- --repo . --commit $pin --file docs/CREW_TRIAL.md --model qwen3:4b
npm.cmd run crew:pinned:list
```

For another local clone, point `--repo` to its exact root and set `PHIBOT_CREW_REPO_ALLOWLIST` to the same resolved absolute root. Separate multiple permitted roots with a semicolon, not a comma. The model and port must match a valid recent PHIBOT-36 receipt. Optional `--port` (numeric, default 11434) and `--timeout-ms` (5000..90000 per step, default 45000) can be supplied.

## Source provenance limits

- Only `README.md` or ordinary `.md` blobs under `docs/` are eligible. Nested simple ASCII directory paths are accepted. No dotfiles, traversal, executable paths, symlinks, submodules, remote fetch or arbitrary Git object specifications.
- The Git repo root must resolve to one explicitly allowlisted real filesystem path. `git -C` runs with a fixed executable, fixed argument vectors, no shell interpolation, 3-second timeout and bounded output. The only commands are `rev-parse`, `ls-tree` and `cat-file`.
- Readable UTF-8 content must be 1..6144 bytes and at most 160 lines. Binary/control data is refused. Dirty worktree edits are ignored because the blob comes from the full pinned commit.
- The local object hash (Git blob SHA) and SHA-256 of the exact blob bytes are retained along with the commit SHA, repo basename, relative file path, timestamp and recent readiness receipt digest.
- Git pinning establishes a reproducible **local** object snapshot, not remote provenance, authorship, code correctness or trust. Untrusted document content is clearly treated as data, not instructions for the reviewer.

## Collaboration and receipt

Scout reviews a single inconsistency supported by the source; Patch proposes a prose-only documentation clarification; Skeptic critiques both against the same exact source. These are three sequential Ollama calls to the same model, with role-specific no-authority manifests. Because they share a model, the Skeptic response is not an independent external fact check.

Every role manifest has empty capabilities and `read=false`, `propose=false`, `write=false`, `deploy=false`. The program never offers a tool call to any of them. Output must be strict advisory JSON with exactly `summary` (<=240 chars) and numeric `confidence` (0..1), with matching echoed model identity, no fallback and no retry. Any failure stops the rest of the pipeline.

The result is stored with exclusive-create semantics under ignored `.phibot/crew-pinned-reviews/`. The self-hashed JSON receipt contains only bounded advice and source identifiers, **not the raw Markdown bytes**. Model summaries can quote or paraphrase the source, so do not submit confidential content. File hashes detect incidental edits but are not digital signatures. A hostile local process could rewrite both the file and its hash.

Completion is labeled `THREE_ADVISORIES_UNVERIFIED`; failure is `FAILED_INCOMPLETE_NO_APPROVAL`. Neither means verified, approved, qualified for live code repair or ready to merge. There are **no GitHub API calls, writes to the reviewed repo, commits, PRs, source patch generation, grants, scheduling, cross-process delegation, or actual code execution** in this rung.

## Tests and field qualification

`npm test` includes temporary real-Git-repository tests for exact pins, dirty working tree exclusion, repository allowlist refusal, traversal rejection, symlinks, oversized content, no-authority manifests, strict structured output, stale local readiness and tamper-evident receipts. CI uses mocked Ollama. It cannot establish that a real local model successfully completed a three-role review on your Windows computer.

**Ledger Above Ego. A pinned source gives the crew evidence, not permission.**
