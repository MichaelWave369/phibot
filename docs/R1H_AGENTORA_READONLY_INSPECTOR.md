# PhiBot R1-H · Offline inspection of Agentora's toy coding-task envelope

**Review-only. No code execution, Github API calls, agent spawning, token acquisition, draft-PR creation, source writes, merge, or deploy.**

This is a separate, deliberately **non-write-compatible** inspector, not PhiBot's `repo.steward.draft` Reality-Gated capability. It accepts a single exact schema `agentora.devboard.r1h.readonly-coding-task.v1`, one fixed toy target in Agentora, and only one exact before/after source preview. Even a PASS cannot unlock the existing write gate.

## Browser-only steps

After both the Agentora producer and PhiBot consumer PRs merge:

1. In [Agentora Cloud Trial](https://github.com/MichaelWave369/Agentora/actions/workflows/development-board-cloud-trial.yml), run **`draft_review`** (not `design_cpu`).
2. Download the run's artifact bundle and open `phibot-review-packet.base64url.txt`. It contains one short, single-line copy string generated from the fixed toy packet.
3. In [PhiBot R1-H Inspection](https://github.com/MichaelWave369/PhiBot/actions/workflows/r1h-readonly-inspection.yml), click **Run workflow**, paste that exact line into `packet_b64`, and submit.
4. The PhiBot Actions job runs Node 22 from its hosted runner using `contents: read`; `npm install` is unnecessary. When the run succeeds, download `phibot-r1h-readonly-inspection-<run>` and examine `phibot-r1h-inspection.json`.

**No computer-side installations.** Both workflows are deliberately manual; the human carries this fixed, public toy data between runs. Do not paste credentials or private code. GitHub workflow inputs are logged/reviewable to users with appropriate repository access.

## Verified fields and honest limits

- Exact `MichaelWave369/Agentora` repo, `examples/development-board/r1h-demo-label.py` target, `R1H-TOY-LABEL-TYPE-GUARD` work item and 40-character claimed source commit.
- Exact committed toy Python source and fixed change preview; SHA-256 of both, exact acceptance statements.
- Exact field set and required false flags for GitHub writes, issues, PRs, merge, deploy, authenticated human approval and PhiBot runtime execution.
- Domain-separated SHA-256 of canonical packet, strict base64url and JSON. This confirms data consistency, **not source authenticity**.
- No external GitHub GET is performed to authenticate the claimed SHA or repo state. No Python source or model-generated code is executed. A PASS is `INSPECTED_EXACT_TOY_SCOPE_REVIEW_ONLY`, not qualified automation or approval.

The inspector prints/upload **metadata only**. It never includes the raw Python source or the pasted packet in the receipt. Invalid inputs fail with a short fixed refusal code and no accepted artifact.

## Future rung

Once this exact contract is field-tested, add **manual, read-only pinned source acquisition** with explicit provenance, and only later consider an independently reviewed interface to PhiBot's separate Reality Gate. Never reinterpret this receipt as a grant or automatically turn it into PhiBot's seven-field write request.

**Ledger Above Ego: reading an untrusted plan is not permission to execute it.**
