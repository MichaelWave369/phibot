import { randomUUID } from "node:crypto";
import type { Ledger } from "../core/ledger.js";
import type { LedgerReceipt, PhiBotManifest } from "../core/types.js";
import type { MemoryEscalationPacket } from "../memory/types.js";
import {
  MemoryCommonLineGroupStore,
  type CommonLineGroupStore,
} from "./groups.js";
import {
  MemoryCommonLineTransport,
  type CommonLineTransport,
} from "./transport.js";
import type {
  CommonLineAddress,
  CommonLineCoordinatorInput,
  CommonLineEnvelope,
  CommonLineGroup,
  CommonLineGroupSendInput,
  CommonLineHandoffInput,
  CommonLineMessageKind,
  CommonLinePayload,
  CommonLineSendInput,
  CreateGroupInput,
} from "./types.js";

export interface CommonLineOptions {
  transport?: CommonLineTransport;
  groups?: CommonLineGroupStore;
  ledger: Ledger;
  defaultGroupTtlMs?: number;
  maxGroupTtlMs?: number;
  now?: () => number;
}

const DEFAULT_GROUP_TTL_MS = 30 * 60 * 1000;
const MAX_GROUP_TTL_MS = 24 * 60 * 60 * 1000;

function cleanText(text: string): string {
  const value = text.trim();
  if (!value) throw new Error("CommonLine message text cannot be empty.");
  return value;
}

function cleanBotId(botId: string): string {
  const value = botId.trim();
  if (!value) throw new Error("CommonLine bot ID cannot be empty.");
  return value;
}

function uniqueBotIds(ids: string[]): string[] {
  return [...new Set(ids.map(cleanBotId))].sort();
}

export class CommonLine {
  readonly transport: CommonLineTransport;
  readonly groups: CommonLineGroupStore;
  private readonly ledger: Ledger;
  private readonly defaultGroupTtlMs: number;
  private readonly maxGroupTtlMs: number;
  private readonly now: () => number;

  constructor(options: CommonLineOptions) {
    this.transport = options.transport ?? new MemoryCommonLineTransport();
    this.groups = options.groups ?? new MemoryCommonLineGroupStore();
    this.ledger = options.ledger;
    this.defaultGroupTtlMs =
      options.defaultGroupTtlMs ?? DEFAULT_GROUP_TTL_MS;
    this.maxGroupTtlMs = options.maxGroupTtlMs ?? MAX_GROUP_TTL_MS;
    this.now = options.now ?? Date.now;

    if (
      !Number.isInteger(this.defaultGroupTtlMs) ||
      this.defaultGroupTtlMs < 1 ||
      !Number.isInteger(this.maxGroupTtlMs) ||
      this.maxGroupTtlMs < this.defaultGroupTtlMs
    ) {
      throw new Error("CommonLine group TTL configuration is invalid.");
    }
  }

  private sender(manifest: PhiBotManifest) {
    return {
      kind: "bot" as const,
      botId: manifest.id,
      botVersion: manifest.version,
      role: manifest.role,
    };
  }

  private async receipt(
    manifest: PhiBotManifest,
    runId: string,
    status: LedgerReceipt["status"],
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.ledger.append({
      schema: "phibot.receipt.v1",
      runId,
      botId: manifest.id,
      botVersion: manifest.version,
      stage: "message",
      timestamp: new Date(this.now()).toISOString(),
      status,
      summary,
      metadata,
    });
  }

  private validateMemoryPacket(
    manifest: PhiBotManifest,
    packet: MemoryEscalationPacket | undefined,
  ): void {
    if (!packet) return;
    if (packet.botId !== manifest.id) {
      throw new Error(
        "CommonLine memory packet sender does not match the sending bot.",
      );
    }
  }

  private async publish(
    manifest: PhiBotManifest,
    kind: CommonLineMessageKind,
    recipients: CommonLineAddress[],
    payload: CommonLinePayload,
    options: {
      runId: string;
      threadId?: string;
      replyTo?: string;
      handoffFrom?: string;
    },
  ): Promise<CommonLineEnvelope> {
    if (recipients.length === 0) {
      throw new Error("CommonLine message requires at least one recipient.");
    }

    this.validateMemoryPacket(manifest, payload.memoryPacket);

    const message: CommonLineEnvelope = {
      schema: "phibot.commonline.message.v1",
      messageId: randomUUID(),
      threadId: options.threadId ?? randomUUID(),
      kind,
      sender: this.sender(manifest),
      recipients: structuredClone(recipients),
      createdAt: new Date(this.now()).toISOString(),
      ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
      ...(options.handoffFrom === undefined
        ? {}
        : { handoffFrom: options.handoffFrom }),
      payload: structuredClone(payload),
    };

    await this.transport.publish(message);
    await this.receipt(
      manifest,
      options.runId,
      kind === "coordinator" ? "escalate" : "ok",
      `Published CommonLine ${kind} message.`,
      {
        commonline: {
          event: "publish",
          messageId: message.messageId,
          threadId: message.threadId,
          kind: message.kind,
          recipients: message.recipients,
          ...(message.replyTo === undefined
            ? {}
            : { replyTo: message.replyTo }),
          ...(message.handoffFrom === undefined
            ? {}
            : { handoffFrom: message.handoffFrom }),
          memoryPacketId: message.payload.memoryPacket?.packetId ?? null,
        },
      },
    );

    return message;
  }

  async send(
    manifest: PhiBotManifest,
    input: CommonLineSendInput,
    runId: string = randomUUID(),
  ): Promise<CommonLineEnvelope> {
    return this.publish(
      manifest,
      "message",
      [{ kind: "bot", id: cleanBotId(input.to) }],
      {
        text: cleanText(input.text),
        ...(input.data === undefined ? {} : { data: input.data }),
      },
      {
        runId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      },
    );
  }

  async reply(
    manifest: PhiBotManifest,
    messageId: string,
    text: string,
    runId: string = randomUUID(),
    data?: unknown,
  ): Promise<CommonLineEnvelope> {
    const parent = await this.transport.get(messageId);
    if (!parent) throw new Error(`CommonLine message not found: ${messageId}`);

    return this.publish(
      manifest,
      "reply",
      [{ kind: "bot", id: parent.sender.botId }],
      {
        text: cleanText(text),
        ...(data === undefined ? {} : { data }),
      },
      {
        runId,
        threadId: parent.threadId,
        replyTo: parent.messageId,
      },
    );
  }

  async handoff(
    manifest: PhiBotManifest,
    input: CommonLineHandoffInput,
    runId: string = randomUUID(),
  ): Promise<CommonLineEnvelope> {
    this.validateMemoryPacket(manifest, input.memoryPacket);

    return this.publish(
      manifest,
      "handoff",
      [{ kind: "bot", id: cleanBotId(input.to) }],
      {
        text: cleanText(input.text),
        ...(input.data === undefined ? {} : { data: input.data }),
        ...(input.memoryPacket === undefined
          ? {}
          : { memoryPacket: input.memoryPacket }),
      },
      {
        runId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        ...(input.handoffFrom === undefined
          ? {}
          : { handoffFrom: input.handoffFrom }),
      },
    );
  }

  async sendToVessie(
    manifest: PhiBotManifest,
    input: CommonLineCoordinatorInput,
    runId: string = randomUUID(),
  ): Promise<CommonLineEnvelope> {
    this.validateMemoryPacket(manifest, input.memoryPacket);

    if (
      input.memoryPacket &&
      input.memoryPacket.target.toLowerCase() !== "vessie"
    ) {
      throw new Error(
        "Coordinator memory packet target must be Vessie.",
      );
    }

    return this.publish(
      manifest,
      "coordinator",
      [{ kind: "coordinator", id: "vessie" }],
      {
        text: cleanText(input.text),
        ...(input.data === undefined ? {} : { data: input.data }),
        ...(input.memoryPacket === undefined
          ? {}
          : { memoryPacket: input.memoryPacket }),
      },
      {
        runId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      },
    );
  }

  async createGroup(
    manifest: PhiBotManifest,
    input: CreateGroupInput,
    runId: string = randomUUID(),
  ): Promise<CommonLineGroup> {
    const name = input.name.trim();
    if (!name) throw new Error("CommonLine group name cannot be empty.");

    const members = uniqueBotIds([manifest.id, ...input.members]);
    const ttlMs = input.ttlMs ?? this.defaultGroupTtlMs;

    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > this.maxGroupTtlMs) {
      throw new Error(
        `CommonLine group TTL must be between 1 and ${this.maxGroupTtlMs}ms.`,
      );
    }

    const createdAtMs = this.now();
    const group: CommonLineGroup = {
      schema: "phibot.commonline.group.v1",
      groupId: randomUUID(),
      name,
      ownerBotId: manifest.id,
      members,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
    };

    await this.groups.put(group);
    await this.receipt(
      manifest,
      runId,
      "ok",
      "Created temporary CommonLine group.",
      {
        commonline: {
          event: "group_create",
          groupId: group.groupId,
          ownerBotId: group.ownerBotId,
          members: group.members,
          expiresAt: group.expiresAt,
        },
      },
    );

    return group;
  }

  async sendToGroup(
    manifest: PhiBotManifest,
    input: CommonLineGroupSendInput,
    runId: string = randomUUID(),
  ): Promise<CommonLineEnvelope> {
    const group = await this.groups.get(input.groupId);

    if (!group) {
      throw new Error(`CommonLine group not found: ${input.groupId}`);
    }

    if (Date.parse(group.expiresAt) <= this.now()) {
      await this.groups.delete(group.groupId);
      throw new Error(`CommonLine group expired: ${group.groupId}`);
    }

    if (!group.members.includes(manifest.id)) {
      throw new Error(
        `Sending bot is not a member of CommonLine group: ${group.groupId}`,
      );
    }

    return this.publish(
      manifest,
      "message",
      [{ kind: "group", id: group.groupId }],
      {
        text: cleanText(input.text),
        ...(input.data === undefined ? {} : { data: input.data }),
      },
      {
        runId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      },
    );
  }

  async dissolveGroup(
    manifest: PhiBotManifest,
    groupId: string,
    runId: string = randomUUID(),
  ): Promise<boolean> {
    const group = await this.groups.get(groupId);
    if (!group) return false;

    if (group.ownerBotId !== manifest.id) {
      throw new Error("Only the CommonLine group owner may dissolve it.");
    }

    const deleted = await this.groups.delete(groupId);
    if (deleted) {
      await this.receipt(
        manifest,
        runId,
        "ok",
        "Dissolved temporary CommonLine group.",
        {
          commonline: {
            event: "group_dissolve",
            groupId,
          },
        },
      );
    }

    return deleted;
  }
}

export {
  DEFAULT_GROUP_TTL_MS,
  MAX_GROUP_TTL_MS,
};
