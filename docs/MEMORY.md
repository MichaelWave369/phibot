# NBG Memory Pods

Rung 4 gives each PhiBot nested memory bubbles instead of one undifferentiated context bucket.

## Shape

```text
Bot Bubble
│
├── promoted durable memory
│
├── Task Bubble A
│   ├── observation
│   ├── tool result
│   └── candidate promotion
│
└── Task Bubble B
    ├── observation
    └── provider result
```

A task bubble is nested beneath a bot bubble. Retrieval checks the current task bubble first, then the parent bot bubble.

## Why explicit promotion

Task-local information does not silently become durable bot memory.

Promotion requires:

- the source record to belong to the current task bubble
- salience at or above the configured threshold
- confidence at or above the configured threshold
- an explicit promotion call

The promoted record retains a `promotedFrom` link and provenance parents.

## Provenance

Every record stores:

- source kind: user / provider / tool / system / memory
- optional source reference
- parent memory IDs
- SHA-256 content digest
- creation and expiry timestamps

Memory content is **not** copied into default ledger receipts. The ledger records IDs and digests.

## Expiry

Default policy:

- task memory: 1 hour
- bot memory: 7 days

These defaults are intentionally conservative and configurable.

## Compaction

Compaction is deterministic, not model-driven.

For each bubble it:

1. removes expired records
2. deduplicates identical content digests, retaining the strongest record
3. keeps only the configured maximum records ranked by salience, confidence, then recency

No LLM is allowed to rewrite history during compaction.

## Retrieval

Retrieval is bounded by `manifest.memory.maxDepth` unless a smaller or larger explicit limit is supplied.

Ranking prefers:

1. current task-bubble records
2. parent bot-bubble records

Within each bubble, records are ranked by salience and confidence.

Optional tags can narrow retrieval.

## Vessie escalation packet

A PhiBot can emit `phibot.memory.escalation.v1`.

The packet contains a bounded snapshot of relevant task and bot memories with provenance, digests, confidence, and salience. This lets Vessie receive the useful causal trail instead of the bot's entire memory heap.

## Storage seam

Rung 4 ships with `MemoryMemoryStore`, an in-memory implementation.

`MemoryStore` is intentionally abstract so PhiOS can later back it with SQLite, DuckDB, sqlite-vec, or an NBG-specific persistence layer without changing the memory semantics.
