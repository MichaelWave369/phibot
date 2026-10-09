# PHIBOT-14: Fix first Windows Scout action-refusal

## Evidence
On the operator's Windows machine, PhiBot installed successfully, Node v24.12.0 is available, `qwen3:4b` is installed, and **93 existing offline tests passed**. The real `cloud:inspect` command returned `OBSERVED_OK_UNVERIFIED_PUBLIC`. Then `scout:field` refused with:

```text
phase: LOCAL_OLLAMA
code: PHIBOT_SHADOW_MODEL_PROPOSED_ACTION
```

This is a **correct refusal**, not evidence of an unauthorized action being executed. The model returned an action-shaped field despite the shadow Scout having zero capabilities.

## Cause and fix
Before this patch, `OllamaProvider` always sent the general governed `STAGE_FORMAT`, which included an optional `action` object. This is suitable for proposal stages but too permissive for the strictly advisory Scout.

This patch adds explicit `responseMode: "advisory-only"`, selected **only** by `scout:field` and `scout:shadow`. This mode:

- Sends a JSON schema with `additionalProperties: false` and exactly two fields, `summary` (max 240 chars) and `confidence` (0–1).
- Uses an advisory-only system prompt that forbids action proposals, commands, tool calls and authority claims.
- Strictly validates model JSON before parsing the normal payload. It refuses any `action` key including null, and all unknown fields, even if a model ignores Ollama's schema.
- Keeps the ordinary PhiBot general `STAGE_FORMAT` unchanged, so normal governed execution and field doctors are unaffected.
- Preserves the one logical model-backed stage, existing limited Ollama transport retry, and every existing refusal/memory/tool/approval boundary.
- Adds deterministic offline tests checking the schema used on the wire and action-injection negatives.

No second chance is granted for a model-generated action; an invalid advisory is rejected rather than silently cleaned.

## Local Windows check
After the PR is merged, in PowerShell:

```powershell
cd $HOME\PhiBot
git pull origin main
npm.cmd test
npm.cmd run scout:field -- --ack-unverified-public --model qwen3:4b
```

A successful run prints `PASS_LOCAL_SCOUT_SHADOW` and saves a redacted local field receipt. Until that happens, **Windows model qualification remains unproven**.

If the old public Scout receipt expires (original expiry **2026-10-09 06:09 UTC**, October 8 at 11:09 PM PT), run the FieldCloudWorker Observation Pilot manually to refresh it and rerun the qualification.

No autonomous cloud PhiBot, signed identity, tool execution or operator action grant is introduced.
