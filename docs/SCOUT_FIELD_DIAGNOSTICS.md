# PHIBOT-13: Safe field-failure diagnostics

A successfully built PhiBot on Windows can still refuse the operator's first live Scout field run for **different** reasons: public GET/source evidence, local Ollama reachability, structured model response, strict qualification scope, or local receipt-save permissions. The old CLI emitted only `PHIBOT_SCOUT_FIELD_REFUSED` for most failures, hiding which stage failed.

This fix preserves every fail-closed validation and **does not retry, fall back, fetch additional URLs, print raw source data, output Ollama responses, persist errors, grant permissions, or spawn an agent**. Its sole change to the live path is a bounded diagnostic JSON projection with `phase`, stable `code`, a fixed `next_check` command, and `model_executed=UNKNOWN_NOT_ASSERTED`.

## Windows first-time triage

With Node.js 22+ and an existing local Ollama model, from `C:\Users\<user>\PhiBot`:

```powershell
git pull origin main
npm.cmd install
npm.cmd run cloud:inspect
ollama list
npm.cmd run scout:field -- --ack-unverified-public --model qwen3:4b
```

`cloud:inspect` tests the exact four public GitHub reads without involving Ollama, memory or tools. If it fails, inspect the error code. If it passes but `scout:field` fails, the new diagnostic's `phase` points to local Ollama, receipt checks, or saving.

| `phase` | Interpretation | Suggested next check |
| --- | --- | --- |
| `PUBLIC_READ` | Public source unavailable, stale, or failed hash/run/format checks | `npm.cmd run cloud:inspect` |
| `LOCAL_OLLAMA` | Ollama unreachable, timed out, model absent, schema invalid, or action proposed | `ollama list`, `npm.cmd run qualify:doctor -- --model qwen3:4b` |
| `QUALIFICATION` | Public + local evidence did not meet strict receipt contract | Refresh public observation and recheck scope |
| `LOCAL_SAVE` | Couldn't write metadata receipt safely | Check `.phibot/scout-qualification/` permissions |
| `ARGUMENTS` | Missing required acknowledgement or invalid model argument | `npm.cmd run scout:field -- --help` |

Do **not** assume `LOCAL_OLLAMA` failure proves that a model ran. A connection error may occur before any inference. Never paste secrets or raw inference logs into public issues.

**No change to trust boundaries:** passing CI is not a PASS from the actual Windows/Ollama field trial.
