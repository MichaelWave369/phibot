# PhiBot

**PhiBot** is a governed micro-agent runtime and local agent-service layer inspired by Vessie / PhiVessel.

The Rung 0-7 architecture is complete: local model providers, governed tools, Reality Gate, NBG memory, CommonLine, durable service state, governed spawning, end-to-end acceptance, and field qualification.

## Target-machine qualification

Check the machine first:

```bash
npm run qualify:doctor
```

Then run strict Ollama qualification:

```bash
npm run qualify
```

The doctor checks Node 22+, Ollama reachability/version, and the exact `qwen3:4b` model tag.

Qualification automatically records the current Git commit when available and writes a hashed PASS/FAIL evidence pack.

## Complete governed path

```text
Vessie
  |
recurring evidence
  |
least-authority spawn
  |
PhiOS Service
  |
NBG memory
  |
CommonLine crew
  |
local provider
  |
Reality Gate
  |
governed tool
  |
ledger
  |
dissolve / retain
  |
qualification evidence
```

## Service mode

```bash
npm run service -- --manifest bots/examples/local-scout.phibot.json
```

See [docs/FIELD_QUALIFICATION.md](docs/FIELD_QUALIFICATION.md), [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md), and [docs/ROADMAP.md](docs/ROADMAP.md).
