# PhiBot Field Qualification

The deterministic end-to-end acceptance harness proves the architecture integrates. Field qualification proves the same lifecycle on the target machine with its actual local Ollama provider.

## Qualification command

Default mode is strict Ollama:

```bash
ollama serve
ollama pull qwen3:4b
npm run qualify
```

A timestamped evidence directory is created under:

```text
.phibot/qualification/
```

For an explicit location:

```bash
npm run qualify -- \
  --output-dir .phibot/qualification/field-001 \
  --source-commit <git-commit-sha>
```

Custom Ollama endpoint:

```bash
npm run qualify -- \
  --ollama-host http://127.0.0.1:11434
```

## Evidence pack

A completed run contains:

```text
field-001/
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
- environment metadata
- optional source commit
- complete acceptance report on success
- failure name/message on failure
- SHA-256 and byte size for every runtime evidence file

`qualification.sha256` is the detached SHA-256 of the exact qualification record bytes.

## PASS criteria

A field record is PASS only when strict Ollama acceptance returns `passed: true`.

There is no deterministic fallback in the Ollama path.

A failure still produces a record whenever the qualification runner itself can continue, so a failed provider or governed lifecycle attempt leaves evidence instead of vanishing into terminal history.

## CI qualification test

CI uses:

```bash
npm test
```

The qualification unit test runs the same evidence-pack writer around deterministic full-lifecycle acceptance. This validates record construction, artifact hashing, and overwrite protection without pretending GitHub has access to the target Ollama machine.

## Safety and provenance

- output directories must be empty
- the runner never deletes a user-specified directory
- signing secrets are not written to the record
- runtime artifacts are hashed after the lifecycle completes
- the record hash is detached to avoid self-referential hashing
- this qualifies the PhiBot application/service lifecycle, not PhiOS kernel isolation

## PhiOS handoff

A PASS evidence pack is the artifact to carry into the PhiOS integration track.

That lets PhiOS integration consume a qualified service contract rather than changing the already-qualified OS release chain merely to discover whether the agent runtime works.
