import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AuthorityClass,
  AuthorityMode,
  LedgerReceipt,
  PhiBotManifest,
} from "../core/types.js";
import type { PhiBotService } from "../service/service.js";
import {
  digestSpawnManifest,
  signSpawnApproval,
  verifySpawnApprovalSignature,
} from "./crypto.js";
import { FileSpawnStore, type SpawnStore } from "./store.js";
import {
  createDefaultSpawnTemplates,
  SpawnTemplateRegistry,
} from "./templates.js";
import type {
  SpawnApproval,
  SpawnEvidence,
  SpawnPolicy,
  SpawnProposal,
  SpawnProposalInput,
  SpawnRecord,
  SpawnTemplate,
} from "./types.js";

export interface SpawnGovernorOptions {
  service: PhiBotService;
  secret: string;
  templates?: SpawnTemplateRegistry;
  store?: SpawnStore;
  policy?: Partial<SpawnPolicy>;
  now?: () => number;
}

export const DEFAULT_SPAWN_POLICY: SpawnPolicy = {
  minEvidenceCount: 3,
  maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000,
  proposalTtlMs: 10 * 60 * 1000,
  approvalTtlMs: 5 * 60 * 1000,
  ephemeralLifetimeMs: 30 * 60 * 1000,
  crewGroupTtlMs: 30 * 60 * 1000,
};

function assertPositiveIntegers(policy: SpawnPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Spawn policy ${name} must be a positive integer.`);
    }
  }
}

function authorityForTemplate(
  template: SpawnTemplate,
  requestedCapabilities: string[],
): PhiBotManifest["authority"] {
  const authority: Record<AuthorityClass, AuthorityMode> = {
    read: false,
    propose: template.authorityCeiling.propose,
    write: false,
    deploy: false,
  };

  const capabilityMap = new Map(
    template.capabilities.map((capability) => [
      capability.id,
      capability.actionClass,
    ]),
  );

  for (const capabilityId of requestedCapabilities) {
    const actionClass = capabilityMap.get(capabilityId);
    if (!actionClass) {
      throw new Error(
        `Capability ${capabilityId} is not allowed by spawn template ${template.templateId}.`,
      );
    }

    const ceiling = template.authorityCeiling[actionClass];
    if (ceiling === false) {
      throw new Error(
        `Spawn template ${template.templateId} forbids authority class ${actionClass}.`,
      );
    }
    authority[actionClass] = ceiling;
  }

  return authority;
}

function cleanCrewMembers(ids: string[] | undefined): string[] {
  return [...new Set(
    (ids ?? [])
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  )].sort();
}

function evidenceIdsAreUnique(evidence: SpawnEvidence[]): boolean {
  return new Set(evidence.map((item) => item.evidenceId)).size === evidence.length;
}

export class SpawnGovernor {
  readonly templates: SpawnTemplateRegistry;
  readonly store: SpawnStore;
  readonly policy: SpawnPolicy;
  private readonly service: PhiBotService;
  private readonly secret: string;
  private readonly now: () => number;

  constructor(options: SpawnGovernorOptions) {
    if (options.secret.length < 16) {
      throw new Error("Spawn governor secret must be at least 16 characters.");
    }

    this.service = options.service;
    this.secret = options.secret;
    this.templates = options.templates ?? createDefaultSpawnTemplates();
    this.store =
      options.store ??
      new FileSpawnStore(join(options.service.stateDir, "spawns"));
    this.policy = { ...DEFAULT_SPAWN_POLICY, ...options.policy };
    this.now = options.now ?? Date.now;
    assertPositiveIntegers(this.policy);
  }

  async propose(input: SpawnProposalInput): Promise<SpawnProposal> {
    const template = this.templates.get(input.templateId);
    if (!template) {
      throw new Error(`Unknown spawn template: ${input.templateId}`);
    }

    const patternKey = input.patternKey.trim();
    if (!patternKey) throw new Error("Spawn pattern key cannot be empty.");

    if (input.evidence.length < this.policy.minEvidenceCount) {
      throw new Error(
        `Spawn proposal requires at least ${this.policy.minEvidenceCount} evidence records.`,
      );
    }
    if (!evidenceIdsAreUnique(input.evidence)) {
      throw new Error("Spawn evidence IDs must be unique.");
    }

    const now = this.now();
    for (const evidence of input.evidence) {
      if (evidence.patternKey !== patternKey) {
        throw new Error("Spawn evidence pattern does not match proposal pattern.");
      }
      const observedAt = Date.parse(evidence.observedAt);
      if (!Number.isFinite(observedAt)) {
        throw new Error(`Invalid spawn evidence timestamp: ${evidence.evidenceId}`);
      }
      if (observedAt > now || now - observedAt > this.policy.maxEvidenceAgeMs) {
        throw new Error(
          `Spawn evidence is outside the allowed evidence window: ${evidence.evidenceId}`,
        );
      }
    }

    const requestedCapabilities = [...new Set(input.requestedCapabilities)].sort();
    if (requestedCapabilities.length === 0) {
      throw new Error("Spawn proposal requires at least one capability.");
    }

    const proposalId = randomUUID();
    const shortId = proposalId.slice(0, 8);
    const manifest: PhiBotManifest = {
      id: `${template.templateId}-${shortId}`,
      name: `${template.namePrefix}Bot-${shortId}`,
      version: "0.1.0",
      role: template.role,
      description: template.description,
      model: structuredClone(template.model),
      memory: structuredClone(template.memory),
      capabilities: requestedCapabilities,
      authority: authorityForTemplate(template, requestedCapabilities),
      escalation: {
        target: template.escalationTarget,
        confidenceBelow: template.confidenceBelow,
      },
    };

    const createdAt = new Date(now).toISOString();
    const proposal: SpawnProposal = {
      schema: "phibot.spawn.proposal.v1",
      proposalId,
      proposer: "vessie",
      templateId: template.templateId,
      patternKey,
      evidence: structuredClone(input.evidence),
      requestedCapabilities,
      crewMembers: cleanCrewMembers(input.crewMembers),
      lifetime: input.lifetime,
      createdAt,
      expiresAt: new Date(now + this.policy.proposalTtlMs).toISOString(),
      manifest,
      manifestDigest: digestSpawnManifest(manifest),
    };

    await this.receipt(
      "ok",
      "Vessie created governed PhiBot spawn proposal.",
      {
        event: "spawn.proposed",
        proposalId,
        templateId: proposal.templateId,
        patternKey,
        lifetime: proposal.lifetime,
        evidenceIds: proposal.evidence.map((item) => item.evidenceId),
        manifestDigest: proposal.manifestDigest,
        botId: manifest.id,
      },
    );

    return proposal;
  }

  async approvePersistent(
    proposal: SpawnProposal,
    reason?: string,
  ): Promise<SpawnApproval> {
    this.assertProposalValid(proposal);

    if (proposal.lifetime !== "persistent") {
      throw new Error("Spawn approval is only required for persistent bots.");
    }

    const issuedAtMs = this.now();
    const unsigned = {
      schema: "phibot.spawn.approval.v1" as const,
      approvalId: randomUUID(),
      proposalId: proposal.proposalId,
      manifestDigest: proposal.manifestDigest,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(
        issuedAtMs + this.policy.approvalTtlMs,
      ).toISOString(),
      ...(reason === undefined || reason.trim() === ""
        ? {}
        : { reason: reason.trim() }),
    };

    const approval: SpawnApproval = {
      ...unsigned,
      signature: signSpawnApproval(unsigned, this.secret),
    };

    await this.receipt(
      "ok",
      "Issued one-use persistent PhiBot spawn approval.",
      {
        event: "spawn.approved",
        proposalId: proposal.proposalId,
        approvalId: approval.approvalId,
        botId: proposal.manifest.id,
        manifestDigest: approval.manifestDigest,
        expiresAt: approval.expiresAt,
      },
    );

    return approval;
  }

  async spawn(
    proposal: SpawnProposal,
    approval?: SpawnApproval,
  ): Promise<SpawnRecord> {
    this.assertProposalValid(proposal);

    if (await this.service.registry.get(proposal.manifest.id)) {
      throw new Error(`Spawned bot already registered: ${proposal.manifest.id}`);
    }

    for (const memberId of proposal.crewMembers) {
      if (!(await this.service.registry.get(memberId))) {
        throw new Error(`Spawn crew member is not registered: ${memberId}`);
      }
    }

    let approvalId: string | undefined;
    if (proposal.lifetime === "persistent") {
      if (!approval) {
        throw new Error("Persistent PhiBot spawn requires explicit approval.");
      }
      this.verifyApproval(proposal, approval);
      const consumed = await this.service.replayStore.consume(
        `spawn:${approval.approvalId}`,
      );
      if (!consumed) {
        throw new Error("Spawn approval replay detected.");
      }
      approvalId = approval.approvalId;
    } else if (approval !== undefined) {
      throw new Error("Ephemeral PhiBot spawn does not accept persistent approval.");
    }

    await this.service.registerBot(proposal.manifest);

    let groupId: string | undefined;
    try {
      const group = await this.service.commonLine.createGroup(
        proposal.manifest,
        {
          name: `spawn-${proposal.manifest.id}`,
          members: proposal.crewMembers,
          ttlMs: this.policy.crewGroupTtlMs,
        },
        `spawn:${proposal.proposalId}`,
      );
      groupId = group.groupId;

      await this.service.commonLine.sendToVessie(
        proposal.manifest,
        {
          text: `Spawned ${proposal.manifest.id} for pattern ${proposal.patternKey}.`,
        },
        `spawn:${proposal.proposalId}`,
      );
    } catch (error: unknown) {
      await this.service.unregisterBot(proposal.manifest.id);
      throw error;
    }

    const spawnedAtMs = this.now();
    const record: SpawnRecord = {
      schema: "phibot.spawn.record.v1",
      spawnId: randomUUID(),
      proposalId: proposal.proposalId,
      botId: proposal.manifest.id,
      lifetime: proposal.lifetime,
      spawnedAt: new Date(spawnedAtMs).toISOString(),
      ...(proposal.lifetime === "ephemeral"
        ? {
            expiresAt: new Date(
              spawnedAtMs + this.policy.ephemeralLifetimeMs,
            ).toISOString(),
          }
        : {}),
      ...(groupId === undefined ? {} : { groupId }),
      ...(approvalId === undefined ? {} : { approvalId }),
      status: "active",
    };

    await this.store.put(record);
    this.service.events.publish("bot.spawned", {
      botId: record.botId,
      detail: {
        spawnId: record.spawnId,
        proposalId: record.proposalId,
        lifetime: record.lifetime,
        groupId: record.groupId ?? null,
      },
    });
    await this.receipt("ok", "Governed PhiBot spawned.", {
      event: "spawn.created",
      spawnId: record.spawnId,
      proposalId: record.proposalId,
      botId: record.botId,
      lifetime: record.lifetime,
      groupId: record.groupId ?? null,
      approvalId: record.approvalId ?? null,
      expiresAt: record.expiresAt ?? null,
    });

    return record;
  }

  async dissolve(
    spawnId: string,
    reason = "completed",
  ): Promise<SpawnRecord> {
    const record = await this.store.get(spawnId);
    if (!record) throw new Error(`Spawn record not found: ${spawnId}`);
    if (record.status === "dissolved") return record;

    const bot = await this.service.registry.get(record.botId);
    if (bot && bot.activeRuns > 0) {
      throw new Error(`Cannot dissolve spawned bot with active runs: ${record.botId}`);
    }

    if (record.groupId && bot) {
      await this.service.commonLine.dissolveGroup(
        bot.manifest,
        record.groupId,
        `spawn:${record.proposalId}`,
      );
    }

    if (bot) {
      await this.service.unregisterBot(record.botId);
    }

    const dissolved: SpawnRecord = {
      ...record,
      status: "dissolved",
      dissolvedAt: new Date(this.now()).toISOString(),
      dissolveReason: reason,
    };
    await this.store.put(dissolved);

    this.service.events.publish("bot.dissolved", {
      botId: dissolved.botId,
      detail: {
        spawnId: dissolved.spawnId,
        reason,
      },
    });
    await this.receipt("ok", "Governed PhiBot dissolved.", {
      event: "spawn.dissolved",
      spawnId: dissolved.spawnId,
      proposalId: dissolved.proposalId,
      botId: dissolved.botId,
      reason,
    });

    return dissolved;
  }

  async sweepExpired(): Promise<SpawnRecord[]> {
    const now = this.now();
    const dissolved: SpawnRecord[] = [];

    for (const record of await this.store.list()) {
      if (
        record.status === "active" &&
        record.lifetime === "ephemeral" &&
        record.expiresAt !== undefined &&
        Date.parse(record.expiresAt) <= now
      ) {
        dissolved.push(await this.dissolve(record.spawnId, "ephemeral_expired"));
      }
    }

    return dissolved;
  }

  private assertProposalValid(proposal: SpawnProposal): void {
    if (proposal.schema !== "phibot.spawn.proposal.v1") {
      throw new Error("Invalid spawn proposal schema.");
    }
    if (Date.parse(proposal.expiresAt) <= this.now()) {
      throw new Error("Spawn proposal expired.");
    }
    if (proposal.manifestDigest !== digestSpawnManifest(proposal.manifest)) {
      throw new Error("Spawn proposal manifest digest mismatch.");
    }
  }

  private verifyApproval(
    proposal: SpawnProposal,
    approval: SpawnApproval,
  ): void {
    if (approval.schema !== "phibot.spawn.approval.v1") {
      throw new Error("Invalid spawn approval schema.");
    }
    if (!verifySpawnApprovalSignature(approval, this.secret)) {
      throw new Error("Invalid spawn approval signature.");
    }
    if (Date.parse(approval.expiresAt) <= this.now()) {
      throw new Error("Spawn approval expired.");
    }
    if (approval.proposalId !== proposal.proposalId) {
      throw new Error("Spawn approval proposal mismatch.");
    }
    if (approval.manifestDigest !== proposal.manifestDigest) {
      throw new Error("Spawn approval manifest mismatch.");
    }
  }

  private async receipt(
    status: LedgerReceipt["status"],
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.service.ledger.append({
      schema: "phibot.receipt.v1",
      runId: "spawn",
      botId: "vessie",
      botVersion: "coordinator",
      stage: "spawn",
      timestamp: new Date(this.now()).toISOString(),
      status,
      summary,
      metadata,
    });
  }
}
