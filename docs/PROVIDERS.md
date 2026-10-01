# Provider Layer

Rung 1 separates **governance** from **inference**.

The five-stage vessel loop remains the runtime contract. A provider supplies the model response for a stage; it does not decide whether the resulting action is authorized.

```text
PhiBot Runtime
     |
ProviderBackedAdapter
     |
Provider Registry
   /       \
Ollama   dry-run
   \       /
 deterministic fallback
```

## Provider contract

Every provider receives:

- current vessel stage
- bot manifest
- task input and bounded context
- prior stage results

Every provider returns:

- provider id
- model id
- JSON content
- fallback flag
- latency
- optional token counts
- optional provider-reported timing

The adapter validates the JSON content before turning it into a `StageResult`.

## Structured result

Providers must return one JSON object:

```json
{
  "summary": "Observed the requested repository boundary.",
  "confidence": 0.91,
  "action": {
    "capability": "repo.read",
    "external": false,
    "description": "Inspect repository metadata."
  }
}
```

`action` is optional. Returning an action never grants authority to execute it.

## Ollama

The built-in Ollama provider uses:

```text
POST /api/chat
stream: false
format: json
temperature: 0
```

Default host:

```text
http://127.0.0.1:11434
```

Override with `OLLAMA_HOST`.

## Deterministic fallback

The CLI wraps non-deterministic providers with `dry-run` fallback by default.

If Ollama is offline, times out, or returns an HTTP error, the stage is completed by the deterministic provider and the receipt records:

- `fallback: true`
- actual provider/model used
- failure reason

Set `PHIBOT_PROVIDER_FALLBACK=none` to disable fallback.

Fallback is for provider availability, not authority. A fallback result still travels through verification, authority checks, escalation, and the ledger.

## Resource receipts

Every provider-backed stage stores provider metadata in its ledger receipt. The final ledger receipt aggregates:

- calls
- fallback calls
- wall-clock provider latency
- input tokens
- output tokens
- total tokens
- provider ids
- model ids

This makes model routing observable before more complicated scheduling is introduced.
