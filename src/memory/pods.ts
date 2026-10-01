import { randomUUID } from "node:crypto";
import type { Ledger } from "../core/ledger.js";
import type { LedgerReceipt, PhiBotManifest } from "../core/types.js";
import { digestInput } from "../gate/crypto.js";
import type { MemoryStore } from "./store.js";
import type {
  MemoryCompactionResult,
  MemoryEscalationPacket,
  MemoryPolicy,
  MemoryRecord,
  MemoryRetrieveOptions,
  MemoryScope,
  MemoryWriteInput,
} from "./types.js";

export interface NbgMemoryPodsOptions {
  store: MemoryStore;
  ledger: Ledger;
  policy?: Partial<MemoryPolicy>;
  now?: () => number;
}

const DEFAULT_POLICY: MemoryPolicy = {
  taskTtlMs: 60 * 60 * 1000,
  botTtlMs: 7 * 24 * 60 * 60 * 1000,
  promotionMinSalience: 0.75,
  promotionMinConfidence: 0.7,
  maxTaskRecords: 64,
  maxBotRecords: 128,
  escalationLimit: 12,
};

function assertUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(
    tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0),
  )].sort();
}

function botBubbleId(botId: string): string {
  return `bot:${botId}`;
}

function taskBubbleId(botId: string, taskId: string): string {
  return `task:${botId}:${taskId}`;
}

function score(record: MemoryRecord): number {
  return record.salience * 0.6 + record.confidence * 0.4;
}

function newestFirst(a: MemoryRecord, b: MemoryRecord): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

export class NbgMemoryPods {
  private readonly store: MemoryStore;
  private readonly ledger: Ledger;
  private readonly policy: MemoryPolicy;
  private readonly now: () => number;

  constructor(options: NbgMemoryPodsOptions) {
    this.store = options.store;
    this.ledger = options.ledger;
    this.now = options.now ?? Date.now;
    this.policy = {
      ...DEFAULT_POLICY,
      ...options.policy,
    };

    assertUnitInterval(
      "promotionMinSalience",
      this.policy.promotionMinSalience,
    );
    assertUnitInterval(
      "promotionMinConfidence",
      this.policy.promotionMinConfidence,
    );

    for (const [name, value] of Object.entries({
      taskTtlMs: this.policy.taskTtlMs,
      botTtlMs: this.policy.botTtlMs,
      maxTaskRecords: this.policy.maxTaskRecords,
      maxBotRecords: this.policy.maxBotRecords,
      escalationLimit: this.policy.escalationLimit,
    })) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer.`);
      }
    }
  }

  private async recordReceipt(
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
      stage: "memory",
      timestamp: new Date(this.now()).toISOString(),
      status,
      summary,
      metadata,
    });
  }

  private buildRecord(
    manifest: PhiBotManifest,
    scope: MemoryScope,
    taskId: string | undefined,
    input: MemoryWriteInput,
    promotedFrom?: string,
  ): MemoryRecord {
    const content = input.content.trim();
    if (!content) throw new Error("Memory content cannot be empty.");

    const salience = input.salience ?? 0.5;
    const confidence = input.confidence ?? 0.5;
    assertUnitInterval("salience", salience);
    assertUnitInterval("confidence", confidence);

    const ttl =
      input.expiresInMs ??
      (scope === "task" ? this.policy.taskTtlMs : this.policy.botTtlMs);

    if (!Number.isInteger(ttl) || ttl < 1) {
      throw new Error("Memory expiry must be a positive integer.");
    }

    const createdAtMs = this.now();
    const bubbleId =
      scope === "task"
        ? taskBubbleId(manifest.id, taskId as string)
        : botBubbleId(manifest.id);

    return {
      schema: "phibot.memory.v1",
      memoryId: randomUUID(),
      bubbleId,
      ...(scope === "task"
        ? {
            parentBubbleId: botBubbleId(manifest.id),
            taskId: taskId as string,
          }
        : {}),
      botId: manifest.id,
      scope,
      content,
      contentDigest: digestInput(content),
      tags: normalizeTags(input.tags),
      salience,
      confidence,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + ttl).toISOString(),
      provenance: {
        source: structuredClone(input.source),
        parents: [...new Set(input.parents ?? [])],
      },
      ...(promotedFrom === undefined ? {} : { promotedFrom }),
    };
  }

  async rememberTask(
    manifest: PhiBotManifest,
    taskId: string,
    input: MemoryWriteInput,
    runId = randomUUID(),
  ): Promise<MemoryRecord> {
    if (!taskId.trim()) throw new Error("taskId cannot be empty.");

    const record = this.buildRecord(manifest, "task", taskId, input);
    await this.store.put(record);
    await this.recordReceipt(
      manifest,
      runId,
      "ok",
      "Stored task-bubble memory.",
      {
        memory: {
          event: "store",
          memoryId: record.memoryId,
          bubbleId: record.bubbleId,
          scope: record.scope,
          contentDigest: record.contentDigest,
          expiresAt: record.expiresAt,
        },
      },
    );
    return record;
  }

  async rememberBot(
    manifest: PhiBotManifest,
    input: MemoryWriteInput,
    runId = randomUUID(),
  ): Promise<MemoryRecord> {
    const record = this.buildRecord(manifest, "bot", undefined, input);
    await this.store.put(record);
    await this.recordReceipt(
      manifest,
      runId,
      "ok",
      "Stored bot-bubble memory.",
      {
        memory: {
          event: "store",
          memoryId: record.memoryId,
          bubbleId: record.bubbleId,
          scope: record.scope,
          contentDigest: record.contentDigest,
          expiresAt: record.expiresAt,
        },
      },
    );
    return record;
  }

  async promoteTaskToBot(
    manifest: PhiBotManifest,
    taskId: string,
    memoryId: string,
    runId = randomUUID(),
  ): Promise<MemoryRecord> {
    const source = await this.store.get(memoryId);

    if (
      !source ||
      source.botId !== manifest.id ||
      source.scope !== "task" ||
      source.taskId !== taskId
    ) {
      throw new Error("Promotion source is not in the requested task bubble.");
    }

    if (source.salience < this.policy.promotionMinSalience) {
      throw new Error(
        `Memory salience ${source.salience} is below promotion threshold ${this.policy.promotionMinSalience}.`,
      );
    }

    if (source.confidence < this.policy.promotionMinConfidence) {
      throw new Error(
        `Memory confidence ${source.confidence} is below promotion threshold ${this.policy.promotionMinConfidence}.`,
      );
    }

    const promoted = this.buildRecord(
      manifest,
      "bot",
      undefined,
      {
        content: source.content,
        tags: source.tags,
        salience: source.salience,
        confidence: source.confidence,
        source: {
          kind: "memory",
          ref: source.memoryId,
        },
        parents: [...source.provenance.parents, source.memoryId],
      },
      source.memoryId,
    );

    await this.store.put(promoted);
    await this.recordReceipt(
      manifest,
      runId,
      "ok",
      "Promoted task memory to bot bubble.",
      {
        memory: {
          event: "promote",
          fromMemoryId: source.memoryId,
          toMemoryId: promoted.memoryId,
          fromBubbleId: source.bubbleId,
          toBubbleId: promoted.bubbleId,
          contentDigest: promoted.contentDigest,
        },
      },
    );

    return promoted;
  }

  async retrieve(
    manifest: PhiBotManifest,
    taskId: string,
    options: MemoryRetrieveOptions = {},
  ): Promise<MemoryRecord[]> {
    const now = this.now();
    const tags = normalizeTags(options.tags);
    const limit = options.limit ?? manifest.memory.maxDepth;

    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Memory retrieval limit must be a positive integer.");
    }

    const all = (await this.store.listByBot(manifest.id)).filter(
      (record) =>
        Date.parse(record.expiresAt ?? "9999-12-31T23:59:59.999Z") > now &&
        (record.scope === "bot" ||
          (record.scope === "task" && record.taskId === taskId)) &&
        (tags.length === 0 ||
          tags.some((tag) => record.tags.includes(tag))),
    );

    const task = all
      .filter((record) => record.scope === "task")
      .sort((a, b) => score(b) - score(a) || newestFirst(a, b));
    const bot = all
      .filter((record) => record.scope === "bot")
      .sort((a, b) => score(b) - score(a) || newestFirst(a, b));

    return [...task, ...bot].slice(0, limit).map((record) => structuredClone(record));
  }

  async compact(
    manifest: PhiBotManifest,
    runId = randomUUID(),
  ): Promise<MemoryCompactionResult> {
    const now = this.now();
    const records = await this.store.listByBot(manifest.id);

    let expiredRemoved = 0;
    let duplicateRemoved = 0;
    let overflowRemoved = 0;

    const live: MemoryRecord[] = [];
    for (const record of records) {
      if (Date.parse(record.expiresAt ?? "9999-12-31T23:59:59.999Z") <= now) {
        await this.store.delete(record.memoryId);
        expiredRemoved += 1;
      } else {
        live.push(record);
      }
    }

    const byBubble = new Map<string, MemoryRecord[]>();
    for (const record of live) {
      const bucket = byBubble.get(record.bubbleId) ?? [];
      bucket.push(record);
      byBubble.set(record.bubbleId, bucket);
    }

    for (const [bubbleId, bucket] of byBubble) {
      const ranked = [...bucket].sort(
        (a, b) => score(b) - score(a) || newestFirst(a, b),
      );
      const seenDigests = new Set<string>();
      const deduped: MemoryRecord[] = [];

      for (const record of ranked) {
        if (seenDigests.has(record.contentDigest)) {
          await this.store.delete(record.memoryId);
          duplicateRemoved += 1;
          continue;
        }
        seenDigests.add(record.contentDigest);
        deduped.push(record);
      }

      const cap = bubbleId.startsWith("task:")
        ? this.policy.maxTaskRecords
        : this.policy.maxBotRecords;

      for (const record of deduped.slice(cap)) {
        await this.store.delete(record.memoryId);
        overflowRemoved += 1;
      }
    }

    const remaining = (await this.store.listByBot(manifest.id)).length;
    const result = {
      expiredRemoved,
      duplicateRemoved,
      overflowRemoved,
      remaining,
    };

    await this.recordReceipt(
      manifest,
      runId,
      "ok",
      "Compacted NBG memory bubbles.",
      {
        memory: {
          event: "compact",
          ...result,
        },
      },
    );

    return result;
  }

  async createEscalationPacket(
    manifest: PhiBotManifest,
    taskId: string,
    runId = randomUUID(),
  ): Promise<MemoryEscalationPacket> {
    const records = await this.retrieve(manifest, taskId, {
      limit: this.policy.escalationLimit,
    });

    const packet: MemoryEscalationPacket = {
      schema: "phibot.memory.escalation.v1",
      packetId: randomUUID(),
      target: manifest.escalation.target,
      botId: manifest.id,
      taskId,
      createdAt: new Date(this.now()).toISOString(),
      records: records.map((record) => ({
        memoryId: record.memoryId,
        scope: record.scope,
        content: record.content,
        contentDigest: record.contentDigest,
        tags: [...record.tags],
        salience: record.salience,
        confidence: record.confidence,
        provenance: structuredClone(record.provenance),
        ...(record.promotedFrom === undefined
          ? {}
          : { promotedFrom: record.promotedFrom }),
      })),
    };

    await this.recordReceipt(
      manifest,
      runId,
      "escalate",
      `Created memory escalation packet for ${packet.target}.`,
      {
        memory: {
          event: "escalation_packet",
          packetId: packet.packetId,
          target: packet.target,
          recordIds: packet.records.map((record) => record.memoryId),
          recordCount: packet.records.length,
        },
      },
    );

    return packet;
  }
}

export { DEFAULT_POLICY, botBubbleId, taskBubbleId };
