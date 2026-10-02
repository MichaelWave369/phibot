# Governed PhiBot Spawning

Rung 7 lets Vessie assemble a specialist crew without granting arbitrary agent creation.

## Rule

```text
recurring pattern
      |
   evidence
      |
spawn proposal
      |
least-authority template
      |
ephemeral? -------- persistent?
   |                    |
 spawn             signed approval
   |                    |
   +--------- spawn ----+
              |
      temporary CommonLine crew
              |
             work
              |
        dissolve / retain
              |
           receipts
```

## Recurring-pattern evidence

A spawn proposal requires multiple distinct evidence records for the same pattern.

Default policy:

- minimum evidence records: 3
- maximum evidence age: 7 days
- proposal lifetime: 10 minutes

This prevents a single weird task from creating a permanent organizational chart, a behavior humans have already explored extensively.

Each accepted spawn proposal is also one-use. Its proposal ID is consumed through the durable replay store before registration, so the same evidence artifact cannot mint multiple bots.

## Least authority

A spawn template defines:

- allowed capabilities
- the registry action class of each capability
- authority ceilings
- provider/model
- memory scope
- escalation target

The proposal may request only a subset of the template capabilities.

The generated manifest enables only authority classes actually needed by those capabilities, plus proposal authority. It can never exceed the template ceiling.

Built-in code-repair bots have gated write authority and no deploy authority.

## Ephemeral spawning

Ephemeral bots do not require persistent-spawn approval.

They:

- receive a fixed lifetime
- register with the PhiBot service
- join a temporary CommonLine crew
- notify Vessie
- can be swept and dissolved when their lifetime expires

Default lifetime: 30 minutes.

## Persistent spawning

Persistent bots always require an explicit signed approval.

The approval is bound to:

- proposal ID
- exact generated manifest digest
- expiration time

The approval is one-use. Consumption is stored in the durable service replay store, so restart does not make it reusable. Approval shape/signature checks happen before proposal consumption, so a missing or malformed approval does not burn an otherwise valid proposal.

## Temporary crew

A spawned bot owns a temporary CommonLine group containing the requested already-registered crew members.

Unknown crew members reject the spawn.

The spawned bot also publishes a coordinator message to Vessie after successful registration.

If crew setup fails, registration is rolled back.

## Lifecycle receipts

Spawn activity uses `stage: "spawn"` receipts:

- proposal created
- persistent approval issued
- bot spawned
- bot dissolved

Service events also expose `bot.spawned` and `bot.dissolved` for PhiOS UI/status surfaces.

## Durable spawn records

Spawn records live beneath:

```text
.phibot/service/spawns/
```

They preserve lifetime, group linkage, approval linkage, and dissolution state across service restarts.
