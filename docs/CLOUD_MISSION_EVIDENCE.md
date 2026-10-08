# PHIBOT-08: Inspect fixed CloudWorker Scout observations

**Status:** OFFLINE / REVIEW-ONLY / NOT A DEPLOYED AGENT. This stage intentionally does not schedule, execute, register, spawn, or route PhiBots.

FieldCloudWorker FCW-03 proposes to publish an additional derived file at `docs/phibot_mission.json` after its next real GitHub Actions run. The existing worker performs public GitHub metadata observation and generates a fixed `phibot.cloud-mission-observation.v0.1` record. The file calls out that the **worker ran, not PhiBot's model runtime**.

PhiBot's new `inspectCloudMission(mission, sourceStatusBytes, nowMs)` is an offline inspection function. Its caller must supply both the mission JSON object and exact `status.json` bytes, fetched separately under review. The adapter checks the literal mission identity, fixed task, hard zero model/write budgets, digest, expiry, source-record matching, and internal receipt integrity. Only redacted metadata returns to the caller. A source digest proves byte consistency relative to supplied status, **not the source author or measurement truth**. The returned `provenance_authenticated`, `agent_identity_authenticated` and `independent_run_metadata_checked` fields remain false.

Status is one of `OBSERVED_OK_UNVERIFIED_PUBLIC`, `OBSERVED_ERROR_UNVERIFIED_PUBLIC`, or `STALE_UNVERIFIED_PUBLIC`. All dispositions explicitly refuse authority, action, memory admission, bot spawning and routing influence. No arbitrary task registration or external side-effect API is exposed.

### Qualification

- `npm test` executes new offline positive and negative tests and existing PhiBot suites.
- FCW-03 producer and PHIBOT-08 consumer require independent PR review and merge.
- Future: add a separately reviewed read-only acquisition adapter and an operator-approved local PhiBot runtime that can consume these observations without accepting embedded instructions. Never auto-register a bot because a public JSON file claims a bot identity.
- Real machine Ollama qualification, PhiOS process isolation and real-agent deployment remain separately required.

**Evidence ≠ identity ≠ authority.**
