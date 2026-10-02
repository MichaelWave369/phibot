# PhiBot Field Qualification

Field qualification proves the complete governed lifecycle on the target machine with its actual local Ollama provider.

## What the field runs taught us

The first live run exposed a 60-second inference timeout.

The second run proved the no-think path was fast, then exposed Ollama's `prediction aborted, token repeat limit reached` failure during a real governed stage.

Recent Ollama reports describe this as output degeneration/repetition, and newer releases surface the repeat guard as an HTTP 500.

PhiBot now handles that boundary explicitly instead of hiding it.

## Governed structured-output profile

PhiBot uses an actual JSON Schema through Ollama's `format` field rather than generic JSON mode.

Normal attempt:

```text
think          false
format         PhiBot stage JSON Schema
temperature    0
num_predict    160
keep_alive     10m
```

If and only if Ollama returns HTTP 500 containing:

```text
token repeat limit reached
```

PhiBot retries exactly once with:

```text
temperature    0.2
repeat_penalty 1.1
repeat_last_n  64
```

Every other error still fails immediately.

The retry is recorded in provider metrics as:

```text
attempts     2
retryReason token_repeat_limit
```

## Representative qualification doctor

```bash
npm run qualify:doctor
```

The doctor now exercises the actual PhiBot provider contract:

- same provider class
- same structured schema
- same no-think profile
- same bounded generation
- same repeat-limit recovery

That closes the gap where a toy JSON probe could pass while a real governed stage failed.

## Run qualification

```bash
npm run qualify
```

Default provider timeout remains 120 seconds per attempt.

For diagnostics only:

```bash
npm run qualify -- --ollama-timeout-ms 180000
```

There is no deterministic fallback in live qualification.

## Evidence

PASS and FAIL records remain preserved beneath:

```text
.phibot/qualification/<timestamp>/
```

Keep every failed field pack. They document which boundary failed and are part of the qualification history, not disposable noise.
