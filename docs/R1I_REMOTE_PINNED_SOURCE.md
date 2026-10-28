# PhiBot R1-I · Remote exact-commit source verification

**Manual, browser-only, READ-ONLY.** This rung extends the successful R1-H operator-carried Agentora → PhiBot packet inspection. Unlike R1-H's purely offline inspector, R1-I **independently reads GitHub's API** to verify the packet's claimed source at the pinned commit. It does not use or activate PhiBot's `repo.steward.draft` or Reality Gate.

## Browser-only field trial

If you still have the one-line `phibot-review-packet.base64url.txt` from the successful Agentora R1-H `draft_review` run, **reuse it**. If not, rerun [Agentora's manual cloud trial](https://github.com/MichaelWave369/Agentora/actions/workflows/development-board-cloud-trial.yml) with `draft_review`; no local installs or model download.

After merging this PhiBot PR:

1. Open [PhiBot R1-I Pinned Agentora Source Verification](https://github.com/MichaelWave369/PhiBot/actions/workflows/r1i-pinned-source-verification.yml).
2. Select **Run workflow** on `main`. Paste the **same single line** into `packet_b64`.
3. Run the workflow. It performs a preliminary strict R1-H packet check, then exactly three GitHub **GET** requests:
   - `GET /repos/MichaelWave369/Agentora/commits/{exact-packet-40-hex-sha}`, checking that the returned full SHA matches exactly and references a valid commit/tree.
   - `GET /repos/MichaelWave369/Agentora/contents/examples/development-board/r1h-demo-label.py?ref={exact-sha}`, checking file type, path, exact UTF-8 source **bytes**, SHA-256 of those bytes, and independently calculated Git blob SHA-1.
   - `GET /repos/MichaelWave369/Agentora/branches/main` to check that `main` **still equals the packet commit** at inspection time.
4. On success, the run emits `REMOTE_EXACT_SOURCE_VERIFIED_REVIEW_ONLY`. Download its `phibot-r1i-pinned-source-...` artifact and inspect `phibot-r1i-pinned-source-review.json`.

If **`MAIN_HAS_MOVED_REGENERATE_PACKET`** appears, nothing has been approved or changed. Rerun Agentora's `draft_review` on current `main` and use its new packet. A stale but historically correct commit is not called current.

## Hard limits

- Public, fixed repository and fixed toy path only; no arbitrary owner/repo, URL, ref or target. The SHA is constrained to 40 lowercase hex. No user-directed Internet browsing.
- Three bounded HTTPS GETs to `api.github.com`, rejecting redirects, non-JSON, unexpected HTTP status, excessive responses and timeouts. A read-only GitHub Actions token is passed to the request step; the checkout does not persist credentials. No repository mutation API is called.
- The workflow executes **no Python source**, runs **no model**, creates no issues, PRs, commits or deployments and cannot issue Reality Gate grants.
- Output contains only review metadata (SHA values, statuses and denied-authority flags), never the copied source text, workflow input or token.
- Correlating a pinned commit and GitHub-served content is **source corroboration**, not proof of code safety, commit signing, an authenticated human, completed tests, or independent cryptographic attestation of the Actions runner. No merge permission follows from green.
- A GitHub failure, rate limit, changed branch or malformed API evidence produces a **red HELD run**, not a fabricated green status.
- This does not generalize to a privileged code-writing agent. A future task may introduce a *separately approved*, narrowly scoped, disposable test environment and an independent review process.

## Automated qualification vs live qualification

`npm test` includes `scripts/r1i-pinned-source.test.mjs` with an injected fake GitHub GET transport. It verifies exact endpoint ordering, packet/schema denial, immutable commit matching, remote content and blob checksum binding, main freshness and failure handling. **Tests do not make real GitHub requests**. The first actual run of `r1i-pinned-source-verification.yml` after merging is the live cloud qualification.

**Ledger Above Ego. Exact evidence before authority.**
