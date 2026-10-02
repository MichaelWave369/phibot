# PhiBot

**PhiBot** is a governed micro-agent runtime and local agent-service layer inspired by Vessie / PhiVessel.

The Rung 0-7 architecture is complete. Current work is target-machine field qualification.

## Field qualification

```bash
npm run qualify:doctor
npm run qualify
```

The doctor now runs a representative PhiBot provider request rather than a toy probe.

Governed Ollama stages use:

- thinking disabled
- JSON Schema structured output
- bounded generation
- warm model retention
- one narrowly scoped retry for Ollama's token-repeat abort

Every other provider failure remains fail-closed.

See [docs/FIELD_QUALIFICATION.md](docs/FIELD_QUALIFICATION.md), [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
