# PhiBot Field Qualification

The deterministic end-to-end acceptance harness proves the architecture integrates. Field qualification proves the same lifecycle on the target machine with its actual local Ollama provider.

## Qualification doctor

Run:

```bash
npm run qualify:doctor
```

The doctor now verifies four things:

- Node major version is at least 22
- Ollama is reachable
- exact `qwen3:4b` model tag is installed
- the model can actually complete a tiny bounded JSON inference request

The inference probe uses the same governed response posture as PhiBot:

- `think: false`
- JSON mode
- temperature 0
- bounded output
- `keep_alive: 10m`

That last check matters: seeing a model in `/api/tags` proves it exists, not that it can respond.

## Governed Ollama request profile

PhiBot control-stage requests are intentionally small. They do not need extended model reasoning.

The provider therefore defaults to:

```text
think        false
format       json
temperature  0
num_predict  256
keep_alive   10m
```

This keeps Qwen3 from spending the control-plane budget on hidden reasoning before returning a tiny JSON receipt.

The live acceptance timeout is now 120 seconds per provider stage by default and is written into the qualification record.

Override only when diagnosing unusually slow hardware:

```bash
npm run qualify -- --ollama-timeout-ms 180000
```

## Qualification command

```bash
npm run qualify
```

The CLI:

1. performs doctor preflight
2. warms the model with the bounded inference probe
3. automatically binds the current Git commit
4. runs strict Ollama full-lifecycle acceptance
5. writes hashed PASS or FAIL evidence

There is no deterministic fallback in live qualification.

## Evidence pack

```text
.phibot/qualification/<timestamp>/
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

The record includes preflight results, inference-probe latency, provider timeout, source commit, acceptance result, and SHA-256 metadata for durable runtime artifacts.

## Interpreting a timeout

A provider timeout is a field qualification failure, not proof that the architecture is broken.

The evidence pack separates:

- daemon/model discovery
- actual inference readiness
- governed lifecycle execution

That lets the next repair target the failing boundary instead of weakening unrelated governance checks.
