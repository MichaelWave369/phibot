# PhiBot Field Qualification

The deterministic end-to-end acceptance harness proves the architecture integrates. Field qualification proves the same lifecycle on the target machine with its actual local Ollama provider.

## One-command readiness check

Before running qualification:

```bash
npm run qualify:doctor
```

The doctor verifies:

- Node major version is at least 22
- Ollama is reachable
- Ollama reports its version
- exact required model tag `qwen3:4b` is installed

Custom endpoint/model:

```bash
npm run qualify:doctor -- \
  --ollama-host http://127.0.0.1:11434 \
  --model qwen3:4b
```

## Qualification command

Default mode is strict Ollama:

```bash
npm run qualify
```

The qualification command now performs the same preflight automatically. If preflight fails, it writes a hashed FAIL record and does not begin the governed lifecycle.

When run from a Git checkout, the CLI automatically binds the record to:

```bash
git rev-parse HEAD
```

You can still override it explicitly:

```bash
npm run qualify -- --source-commit <git-commit-sha>
```

A timestamped evidence directory is created beneath:

```text
.phibot/qualification/
```

## Evidence pack

A completed run contains:

```text
<qualification-dir>/
├── qualification.json
├── qualification.sha256
└── runtime/
    ├── registry.json
    ├── ledger.ndjson
    ├── replay/
    ├── memory/
    ├── commonline/
    └── spawns/
```

`qualification.json` contains:

- PASS / FAIL
- Node/platform/architecture
- provider mode
- auto-detected or explicit source commit
- complete preflight result
- Ollama host/version/model inventory when applicable
- complete acceptance report on success
- failure details on failure
- SHA-256 and byte size for every runtime evidence artifact

## PASS criteria

A field record is PASS only when:

1. preflight passes
2. strict Ollama acceptance returns `passed: true`

There is no deterministic fallback in Ollama qualification mode.

## If doctor reports the model missing

Install exactly the tag required by the built-in spawn template:

```bash
ollama pull qwen3:4b
```

Then rerun:

```bash
npm run qualify:doctor
npm run qualify
```

## CI qualification test

CI uses deterministic qualification and mocked Ollama doctor responses. This validates preflight logic, evidence-pack construction, hashing, and FAIL preservation without pretending GitHub has access to the target machine.

## Safety and provenance

- output directories must be empty
- user-selected evidence directories are never overwritten
- signing secrets are not written to qualification records
- runtime artifacts are hashed after lifecycle completion
- qualification record gets a detached SHA-256
- preflight failure still leaves a hashed record
- this qualifies the PhiBot application/service lifecycle, not PhiOS kernel isolation

## PhiOS handoff

A PASS evidence pack is the artifact to carry into the PhiOS integration track. That lets PhiOS consume a qualified service contract without perturbing the already-qualified OS release chain merely to discover whether the agent runtime works.
