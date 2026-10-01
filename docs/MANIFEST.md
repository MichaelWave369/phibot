# PhiBot Manifest v0

A PhiBot manifest is a JSON identity and governance contract.

| Field | Meaning |
| --- | --- |
| `id` | Stable machine identity |
| `name` | Human-readable bot name |
| `version` | Bot contract version |
| `role` | Narrow specialty |
| `description` | Intended behavior |
| `model` | Provider and model binding |
| `memory` | Scope and depth policy |
| `capabilities` | Operations the bot knows how to request |
| `authority` | Operations the bot may perform |
| `escalation` | Where uncertain or gated work goes |

## Authority modes

- `true`: permitted by the local manifest
- `false`: denied
- `"gated"`: requires an external approval boundary

A future manifest revision should add explicit capability schemas, tool constraints, resource budgets, signed policy bundles, and memory retention rules.
