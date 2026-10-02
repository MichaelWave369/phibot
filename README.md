# PhiBot

**PhiBot** is a governed micro-agent runtime and local agent-service layer inspired by Vessie / PhiVessel.

The Rung 0-7 architecture is complete: local model providers, governed tools, Reality Gate, NBG memory, CommonLine, durable service state, governed spawning, end-to-end acceptance, and field qualification.

## Target-machine qualification

Check the machine and actual inference path:

```bash
npm run qualify:doctor
```

Then run strict Ollama qualification:

```bash
npm run qualify
```

For governed control stages, PhiBot explicitly disables model thinking, bounds JSON generation, and keeps the local model warm between stages.

Default live provider timeout is 120 seconds per stage. An override is available for diagnostics:

```bash
npm run qualify -- --ollama-timeout-ms 180000
```

Qualification records the current Git commit, preflight/inference readiness, provider timeout, and hashed PASS/FAIL evidence.

See [docs/FIELD_QUALIFICATION.md](docs/FIELD_QUALIFICATION.md), [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
