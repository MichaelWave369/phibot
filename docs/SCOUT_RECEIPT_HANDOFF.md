# PHIBOT-15: Operator-mediated read-only receipt handoff for Vessie

**This is NOT a live Vessie connection.** It is a format-compatible, sanitized JSON handoff that an operator can copy into future cockpit work. No new network endpoint, agent service, background monitor, credential, routing hint, memory admission, tool or Reality Gate grant is created.

## The milestone being handed off

The first real Windows/Ollama run of `npm.cmd run scout:field -- --ack-unverified-public --model qwen3:4b` produced:

- `PASS_LOCAL_SCOUT_SHADOW` using the installed `qwen3:4b` model.
- One logical governed local interpretation, with zero tool execution and no granted authority.
- A private receipt folder, `.phibot/scout-qualification/scout-J1h0Kv`, on the operator's Windows computer.
- A domain-separated SHA-256 receipt digest. This is **not** a signature or an independent attestation. Anyone able to modify both local files can recompute the digest.

## Windows command

After this PR is merged, from the local `PhiBot` folder:

```powershell
git pull origin main
npm.cmd test
npm.cmd run scout:handoff -- --receipt .phibot\scout-qualification\scout-J1h0Kv --ack-local-self-report
```

Use the actual receipt folder from your `scout:field` output if different.

This command checks two files inside that **exact direct child** of `.phibot/scout-qualification`:

`qualification.json` and `qualification.sha256`.

It rejects symlinks, arbitrary paths, extra files, malformed digest, changed source fields, unauthorized flags, stale-at-the-time qualification, future timestamps and noncanonical JSON. It reads no model prose, private task history, memory content or user files elsewhere. It makes **no network calls and no model calls**, and only emits a redacted JSON review.

## Semantics

- `qualification_result=PASS_LOCAL_SCOUT_SHADOW` documents a historical operator-run success.
- `review_freshness=CURRENT_WITHIN_SOURCE_WINDOW` means the source observation has not passed its declared expiry at review time; otherwise `HISTORICAL_EXPIRED_OR_NOT_YET_CURRENT`. **Even a current receipt cannot grant authority.**
- `integrity=DOMAIN_SEPARATED_DIGEST_MATCH` proves local file consistency, **not who wrote it** or whether the measurement was correct.
- `mode=MANUAL_OPERATOR_COPY_ONLY`, `vessie_connected=false` and `routing_influence=NONE` are explicit. No Vessie or FieldAccord integration is claimed here.
- `reality_gate_granted=false`, `agent_spawned=false`, `memory_admitted=false` and related fields must stay false.

The next, separately reviewed step is adding a Vessie UI panel that displays this manually imported **advisory evidence** without allowing it to mutate model routing, authority, shared memory or agent status.

**A local PASS is evidence of one governed shadow exercise, not autonomous agent deployment approval.**
