# PHIBOT-41: one human-authorized local Markdown edit

PHIBOT-41 introduces a **new, separately registered Reality Gate write capability** for an exact PHIBOT-40 Markdown draft. It is present ONLY inside an explicitly run local operator CLI. It does not become a built-in PhiBot tool, an API route, a bot permission, or a GitHub automation. An approved operation changes **one tracked Markdown file in the local Git working tree only**, never a commit, push, PR, merge or deployment.

## Gates

The workflow is a chain of **separate operator decisions**:

1. PHIBOT-38 Scout/Patch/Skeptic reads one exact allowlisted Markdown Git blob and produces three unverified advisories.
2. PHIBOT-39 human acknowledges one pinned advisory packet. This is not write permission.
3. PHIBOT-40 a human authors one replacement and explicitly records its exact checksum/diff under ignored local state. This is not write permission.
4. **PHIBOT-41 requires an additional, newly minted Reality Gate one-use grant** bound to the exact local-worktree change intent. It never reuses prior acknowledgements as grants.
5. The operator runs a separate local byte-verification command. A passing byte hash check is not a CI test or safety certification.

## Windows 11 workflow

Prerequisites: Node 22+, Git, local PhiBot clone, an actual source-pinned PHIBOT-38 review, PHIBOT-39 human handoff and PHIBOT-40 recorded Markdown draft, all still tied to the **current checkout HEAD**. No Ollama model is invoked by this rung. The earlier model readiness and review runs are prerequisites whose receipts remain on your PC.

In PowerShell from your local clone:

```powershell
git pull origin main
npm.cmd install
npm.cmd test
$env:PHIBOT_CREW_REPO_ALLOWLIST = (Resolve-Path .).Path
npm.cmd run crew:drafts
```

Choose a real PHIBOT-40 draft **ID** printed by the inventory. Then opt into the local edit **only for this PowerShell session**:

```powershell
$draft = '<actual-PHIBOT-40-draft-UUID>'
$env:PHIBOT_ENABLE_MARKDOWN_LOCAL_APPLY = '1'
# Set PHIBOT_REALITY_GATE_SECRET to a unique randomly generated 32+ character
# locally stored secret. Do not put the secret in a repo, chat, screenshot,
# command history, CI logs, or documentation.
npm.cmd run crew:apply -- --draft $draft --repo .
```

The CLI will refuse noninteractive stdin/stdout, missing opt-in, bad secret length, unauthorized repo paths and invalid/stale evidence. It will display the **entire small proposed diff** with the exact repo root, commit, filename, original and proposed SHA-256, and the Reality Gate input digest. The operator must type **`APPLY <first 16 hex characters of the Reality Gate digest>`**. Any different input denies the grant and leaves the source untouched.

Once applied, independently check the actual filesystem bytes:

```powershell
npm.cmd run crew:apply:verify -- --draft $draft --repo .
git diff -- docs/CREW_TRIAL.md
git diff --check
npm.cmd test
```

Replace `docs/CREW_TRIAL.md` with the actual target path from the displayed receipt. The separate verification command checks the local one-attempt fence, validated result receipt, matching head commit, safe regular file, exact proposed SHA-256, and an unstaged local Git modification. It intentionally reports `LOCAL_FILE_HASH_VERIFIED_CI_NOT_RUN`; this does not mean GitHub Actions or the documentation content is correct.

**Do not expect an automatic Git commit or pull request.** Evaluate the diff and tests yourself. Any later commit, branch or push requires a separate user decision outside this workflow.

## Security and failure handling

- The capability ID is `crew.markdown.apply-local`, with `actionClass=write` and `requiresGate=true`. It is registered only by the operator CLI. No bot manifest or built-in tool registry is expanded. The operator manifest grants `write: gated` and `deploy: false`.
- The Reality Gate uses the repository's existing grant-signing, short TTL, exact tool-input SHA-256, one-use replay protection and local receipt ledger. The secret must be at least 32 characters and is never returned or logged. It is only as safe as the local account and process environment.
- Before gate issuance, the target must be an explicitly allowed **canonical local Git repository**, with a full pinned commit SHA, original blob SHA/SHA-256, matching handoff/review/draft self-hashes, and clean target file. Only root `README.md` or ordinary `docs/**/*.md` are eligible. No arbitrary paths or Git remote names.
- The replacement stays inside the PHIBOT-40 6144-byte/160-line, 16-changed-lines-per-side, and small byte-delta bounds. The exact existing unified-style diff is independently regenerated from the pinned source; wrong or tampered diffs are refused.
- A local file must be a regular, single-link non-executable file. Symlinked target or parent directories, noncanonical parent paths, unsafe file modes and mismatched existing SHA-256 are refused.
- After a grant is approved and consumed, the capability **revalidates every linked receipt and pinned source**. It persists a uniquely named one-attempt intent file in `.phibot/crew-markdown-applies/` before changing any source. Repeated attempts for that draft are refused with no overwrite.
- A uniquely named temporary file is created adjacent to the target with exclusive-create permissions, its bytes are flushed, and the Git head/source identity and actual target inode/metadata/hash are rechecked immediately before a single rename. The resulting bytes are separately read and checked against the planned SHA-256.
- After a successful write, another exclusive-create result receipt is stored under ignored local state and a normal PhiBot ToolExecutor/Reality Gate event is appended to the local ledger. Both status and receipt explicitly state **UNCOMMITTED** and **CI UNVERIFIED**.
- **Important:** there is no general multi-process lock and no OS-level transaction across the Git target, receipt file and ledger. Another local process may race these steps. A crash after the intent fence, a failed rename/postwrite check, or a receipt write failure can leave a partially completed operation. In that case **do not retry blindly**; inspect the target bytes, `.phibot/crew-markdown-applies/`, the ledger, and `git diff` manually. There is intentionally no automatic rollback or cleanup of the one-attempt fence.
- A self-hash is not an independently authenticated signature. A malicious process with write access to the local files can rewrite both receipt and checksum. The temporary-file swap does not provide a hardened cross-user security boundary.
- No tests or external verification are automatically run as part of the apply operation. The separate `crew:apply:verify` command only verifies the local SHA-256 and working-tree state. Run local tests manually, then separately review any CI results after a later, human-controlled Git push.

## Developer acceptance

`test/crew-markdown-apply.test.ts` constructs real temporary Git repositories and full simulated PHIBOT-38 → 39 → 40 evidence, then tests: no tool execution without a grant, exact one-use Reality Gate approval, actual local file replacement, separate hash verification, refusal of stale/dirty/unauthorized source, forged authority, altered local receipts, symlink attacks, tampered postwrite bytes and exclusive one-attempt replay. CI mocks model output and cannot qualify your Windows hardware or secret custody.

**Ledger Above Ego. An approved, locally verified byte change is still not a Git commit or CI success.**
