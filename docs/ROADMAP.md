# PhiBot Roadmap

The initial rung ladder is complete. Work now moves through integration and qualification tracks.

## Rungs 0-7

- [x] governed core
- [x] provider interfaces and local Ollama
- [x] governed tool capability registry
- [x] Reality Gate
- [x] NBG memory pods
- [x] CommonLine
- [x] PhiOS local service layer
- [x] governed PhiBot spawning

## Acceptance and qualification track

- [x] deterministic full-lifecycle acceptance harness
- [x] spawn -> NBG -> CommonLine -> provider -> Gate -> tool -> dissolve
- [x] receipt-chain acceptance assertion
- [x] resource-budget acceptance assertion
- [x] Reality Gate replay rejection assertion
- [x] strict local Ollama acceptance mode
- [x] field qualification evidence-pack writer
- [x] SHA-256 artifact manifest + detached record digest
- [x] FAIL records preserve available evidence
- [x] overwrite protection for qualification destinations
- [x] target-machine qualification doctor
- [x] exact Ollama model-tag readiness check
- [x] automatic Git source-commit binding
- [ ] run and preserve PASS qualification on target Ollama machine

## PhiOS integration track

- [ ] PhiOS-native process isolation
- [ ] PhiOS-native key custody
- [ ] PhiOS-native IPC adapter
- [ ] service startup/package integration in PhiOS image
- [ ] PhiOS UI crew/status surface

## Ecosystem integration track

- [ ] connect standalone CommonLine transport
- [ ] connect Vessie spawn-policy UI
- [ ] connect real repository read/patch/test tools behind Reality Gate
