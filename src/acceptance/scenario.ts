import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProviderBackedAdapter } from "../adapters/provider-backed.js";
import type { PhiBotManifest } from "../core/types.js";
import { PhiBotRuntime } from "../core/runtime.js";
import { DryRunProvider } from "../providers/dry-run.js";
import { OllamaProvider } from "../providers/ollama.js";
import { PhiBotService } from "../service/service.js";
import { SpawnGovernor } from "../spawn/governor.js";
import { ToolExecutor } from "../tools/executor.js";
import { ToolCapabilityRegistry } from "../tools/registry.js";
import type {
  AcceptanceChecks,
  AcceptanceOptions,
  AcceptanceReport,
} from "./types.js";

const HELPER_ID = "acceptance-helper";
const DEFAULT_OLLAMA_ACCEPTANCE_TIMEOUT_MS = 120_000;

function helperManifest(): PhiBotManifest {
  return {
    id: HELPER_ID,
    name: "Acceptance Helper",
    version: "1.0.0",
    role: "acceptance_observer",
    description: "Receives governed CommonLine acceptance handoffs.",
    model: { provider: "dry-run", name: "deterministic" },
    memory: { scope: "task", maxDepth: 2 },
    capabilities: [],
    authority: {
      read: true,
      propose: true,
      write: false,
      deploy: false,
    },
    escalation: {
      target: "vessie",
      confidenceBelow: 0.5,
    },
  };
}

function allChecksPass(checks: AcceptanceChecks): boolean {
  return Object.values(checks).every(Boolean);
}

async function receiptStages(stateDir: string): Promise<string[]> {
  const raw = await readFile(join(stateDir, "ledger.ndjson"), "utf8");
  const stages = new Set<string>();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const value = JSON.parse(line) as { stage?: unknown };
    if (typeof value.stage === "string") stages.add(value.stage);
  }

  return [...stages].sort();
}

export async function runAcceptanceScenario(
  options: AcceptanceOptions,
): Promise<AcceptanceReport> {
  const mode = options.mode ?? "deterministic";
  const clock = options.now ?? Date.now;
  const startedAt = new Date(clock()).toISOString();
  const service = new PhiBotService({
    stateDir: options.stateDir,
    now: clock,
  });

  const secret =
    options.secret ?? randomBytes(32).toString("hex");

  let spawnedBotId = "";
  let spawnId = "";
  let serviceRunId = "";
  let runtimeRunId = "";
  let commonLineGroupId = "";
  let handoffMessageId = "";
  let memoryPacketId = "";
  let gateRequestId = "";
  let gateGrantId = "";
  let providerIds: string[] = [];
  let providerModels: string[] = [];
  let providerTokens = 0;
  let toolCalls = 0;
  let spawnDissolved = false;
  let runActive = false;
  let helperRegistered = false;

  const checks: AcceptanceChecks = {
    spawnRegistered: false,
    leastAuthority: false,
    memoryPromoted: false,
    handoffDelivered: false,
    providerCompleted: false,
    gateRequired: false,
    grantExecutedOnce: false,
    grantReplayRejected: false,
    budgetTracked: false,
    receiptChainPresent: false,
    spawnDissolved: false,
  };

  await service.start();

  try {
    const helper = helperManifest();
    await service.registerBot(helper, true);
    helperRegistered = true;

    const governor = new SpawnGovernor({
      service,
      secret,
      now: clock,
    });

    const evidenceNow = clock();
    const proposal = await governor.propose({
      templateId: "code-repair",
      patternKey: "acceptance-recurring-repair",
      evidence: [0, 1, 2].map((index) => ({
        evidenceId: `acceptance-evidence-${index}`,
        patternKey: "acceptance-recurring-repair",
        observedAt: new Date(evidenceNow - index * 1000).toISOString(),
        taskRef: `acceptance-task-${index}`,
      })),
      requestedCapabilities: ["repo.patch", "repo.read", "tests.run"],
      lifetime: "ephemeral",
      crewMembers: [helper.id],
    });

    checks.leastAuthority =
      proposal.manifest.authority.read === true &&
      proposal.manifest.authority.propose === true &&
      proposal.manifest.authority.write === "gated" &&
      proposal.manifest.authority.deploy === false;

    const spawned = await governor.spawn(proposal);
    spawnId = spawned.spawnId;
    spawnedBotId = spawned.botId;
    commonLineGroupId = spawned.groupId ?? "";

    checks.spawnRegistered =
      (await service.registry.get(spawned.botId)) !== undefined;

    const spawnedRegistration = await service.registry.get(spawned.botId);
    if (!spawnedRegistration) {
      throw new Error("Acceptance spawn disappeared from registry.");
    }
    const manifest = spawnedRegistration.manifest;

    serviceRunId = `acceptance-${randomUUID()}`;
    await service.beginRun(manifest.id, serviceRunId);
    runActive = true;

    const pods = service.memoryPods(manifest);
    const taskId = "acceptance-task";
    const taskMemory = await pods.rememberTask(
      manifest,
      taskId,
      {
        content:
          "Acceptance fixture: a bounded README marker patch is required.",
        tags: ["acceptance", "repair"],
        salience: 0.95,
        confidence: 0.95,
        source: { kind: "system", ref: "acceptance-harness" },
      },
      serviceRunId,
    );
    const promoted = await pods.promoteTaskToBot(
      manifest,
      taskId,
      taskMemory.memoryId,
      serviceRunId,
    );
    checks.memoryPromoted =
      promoted.promotedFrom === taskMemory.memoryId &&
      promoted.provenance.parents.includes(taskMemory.memoryId);

    const packet = await pods.createEscalationPacket(
      manifest,
      taskId,
      serviceRunId,
    );
    memoryPacketId = packet.packetId;

    const handoff = await service.commonLine.handoff(
      manifest,
      {
        to: helper.id,
        text: "Acceptance handoff: inspect bounded repair context.",
        memoryPacket: packet,
      },
      serviceRunId,
    );
    handoffMessageId = handoff.messageId;

    const helperInbox = await service.commonLineTransport.listForBot(helper.id);
    checks.handoffDelivered = helperInbox.some(
      (message) =>
        message.messageId === handoff.messageId &&
        message.payload.memoryPacket?.packetId === packet.packetId,
    );

    const providerTimeoutMs =
      options.ollamaTimeoutMs ??
      DEFAULT_OLLAMA_ACCEPTANCE_TIMEOUT_MS;

    const provider =
      mode === "ollama"
        ? new OllamaProvider(manifest.model.name, {
            ...(options.ollamaHost === undefined
              ? {}
              : { baseUrl: options.ollamaHost }),
            timeoutMs: providerTimeoutMs,
            think: false,
            keepAlive: "10m",
            numPredict: 256,
          })
        : new DryRunProvider("acceptance-deterministic");

    const runtime = new PhiBotRuntime(
      manifest,
      new ProviderBackedAdapter(provider),
      service.ledger,
    );
    const runtimeResult = await runtime.run({
      task:
        "Inspect the acceptance repair context and propose the safest bounded next action.",
      context: {
        taskId,
        memoryPacketId: packet.packetId,
      },
    });
    runtimeRunId = runtimeResult.runId;

    providerIds = [
      ...new Set(
        runtimeResult.stages.flatMap((stage) =>
          stage.provider ? [stage.provider.provider] : [],
        ),
      ),
    ];
    providerModels = [
      ...new Set(
        runtimeResult.stages.flatMap((stage) =>
          stage.provider ? [stage.provider.model] : [],
        ),
      ),
    ];
    providerTokens = runtimeResult.stages.reduce(
      (total, stage) => total + (stage.provider?.totalTokens ?? 0),
      0,
    );

    checks.providerCompleted =
      runtimeResult.status === "completed" &&
      providerIds.length > 0 &&
      (mode === "ollama"
        ? providerIds.every((id) => id === "ollama")
        : providerIds.every((id) => id === "dry-run"));

    await service.recordProviderTokens(serviceRunId, providerTokens);

    const patchRegistry = new ToolCapabilityRegistry().register({
      id: "repo.patch",
      description:
        "Acceptance-only bounded patch fixture. Does not mutate the repository.",
      actionClass: "write",
      external: true,
      validate(input: unknown) {
        if (
          typeof input !== "object" ||
          input === null ||
          !("path" in input) ||
          !("patch" in input) ||
          typeof (input as { path?: unknown }).path !== "string" ||
          typeof (input as { patch?: unknown }).patch !== "string"
        ) {
          throw new Error("repo.patch acceptance input is invalid.");
        }
        return input as { path: string; patch: string };
      },
      async execute(input) {
        return {
          applied: true,
          path: input.path,
          patchDigestOnly: true,
        };
      },
    });

    const gate = service.realityGate(secret);
    const executor = new ToolExecutor(
      patchRegistry,
      service.ledger,
      {},
      gate,
    );
    const toolInput = {
      path: "README.md",
      patch: "acceptance-marker",
    };

    const gated = await executor.execute(
      manifest,
      {
        capability: "repo.patch",
        input: toolInput,
      },
      serviceRunId,
    );

    checks.gateRequired =
      gated.status === "gated" && gated.gateRequest !== undefined;

    if (!gated.gateRequest) {
      throw new Error("Acceptance tool call did not produce a gate request.");
    }
    gateRequestId = gated.gateRequest.requestId;

    const decision = await gate.decide(gated.gateRequest, {
      outcome: "approve",
    });
    if (!decision.grant) {
      throw new Error("Acceptance Reality Gate did not issue a grant.");
    }
    gateGrantId = decision.grant.grantId;

    const executed = await executor.execute(
      manifest,
      {
        capability: "repo.patch",
        input: toolInput,
        grant: decision.grant,
      },
      serviceRunId,
    );
    await service.recordToolCall(serviceRunId);
    toolCalls = 1;

    checks.grantExecutedOnce =
      executed.status === "executed" &&
      (executed.output as { applied?: unknown } | undefined)?.applied === true;

    const replay = await executor.execute(
      manifest,
      {
        capability: "repo.patch",
        input: toolInput,
        grant: decision.grant,
      },
      serviceRunId,
    );
    checks.grantReplayRejected =
      replay.status === "denied" &&
      (replay.error ?? "").toLowerCase().includes("replay");

    const finished = await service.finishRun(serviceRunId);
    runActive = false;
    checks.budgetTracked =
      finished.providerTokens === providerTokens &&
      finished.toolCalls === toolCalls;

    const dissolved = await governor.dissolve(
      spawnId,
      "acceptance_complete",
    );
    spawnDissolved = dissolved.status === "dissolved";
    checks.spawnDissolved =
      spawnDissolved &&
      (await service.registry.get(spawnedBotId)) === undefined;

    const stages = await receiptStages(service.stateDir);
    checks.receiptChainPresent = [
      "service",
      "spawn",
      "memory",
      "message",
      "gate",
      "tool",
      "observe",
      "interpret",
      "propose",
      "verify",
      "ledger",
    ].every((stage) => stages.includes(stage));

    return {
      schema: "phibot.acceptance.report.v1",
      mode,
      startedAt,
      finishedAt: new Date(clock()).toISOString(),
      stateDir: service.stateDir,
      spawnedBotId,
      helperBotId: helper.id,
      serviceRunId,
      runtimeRunId,
      commonLineGroupId,
      handoffMessageId,
      memoryPacketId,
      gateRequestId,
      gateGrantId,
      providerIds,
      providerModels,
      providerTokens,
      ...(mode === "ollama"
        ? { providerTimeoutMs }
        : {}),
      toolCalls,
      receiptStages: stages,
      checks,
      passed: allChecksPass(checks),
    };
  } finally {
    if (runActive && serviceRunId) {
      await service.finishRun(serviceRunId).catch(() => undefined);
    }

    if (!spawnDissolved && spawnId) {
      const governor = new SpawnGovernor({
        service,
        secret,
        now: clock,
      });
      await governor
        .dissolve(spawnId, "acceptance_cleanup")
        .catch(() => undefined);
    }

    if (helperRegistered) {
      await service.unregisterBot(HELPER_ID).catch(() => undefined);
    }

    await service.stop().catch(() => undefined);
  }
}

export { DEFAULT_OLLAMA_ACCEPTANCE_TIMEOUT_MS };
