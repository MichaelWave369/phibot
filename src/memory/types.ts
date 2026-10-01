export type MemoryScope = "task" | "bot";

export type MemorySourceKind =
  | "user"
  | "provider"
  | "tool"
  | "system"
  | "memory";

export interface MemorySource {
  kind: MemorySourceKind;
  ref?: string;
}

export interface MemoryProvenance {
  source: MemorySource;
  parents: string[];
}

export interface MemoryRecord {
  schema: "phibot.memory.v1";
  memoryId: string;
  bubbleId: string;
  parentBubbleId?: string;
  botId: string;
  taskId?: string;
  scope: MemoryScope;
  content: string;
  contentDigest: string;
  tags: string[];
  salience: number;
  confidence: number;
  createdAt: string;
  expiresAt?: string;
  provenance: MemoryProvenance;
  promotedFrom?: string;
}

export interface MemoryWriteInput {
  content: string;
  tags?: string[];
  salience?: number;
  confidence?: number;
  source: MemorySource;
  parents?: string[];
  expiresInMs?: number;
}

export interface MemoryRetrieveOptions {
  tags?: string[];
  limit?: number;
}

export interface MemoryPolicy {
  taskTtlMs: number;
  botTtlMs: number;
  promotionMinSalience: number;
  promotionMinConfidence: number;
  maxTaskRecords: number;
  maxBotRecords: number;
  escalationLimit: number;
}

export interface MemoryCompactionResult {
  expiredRemoved: number;
  duplicateRemoved: number;
  overflowRemoved: number;
  remaining: number;
}

export interface MemoryEscalationRecord {
  memoryId: string;
  scope: MemoryScope;
  content: string;
  contentDigest: string;
  tags: string[];
  salience: number;
  confidence: number;
  provenance: MemoryProvenance;
  promotedFrom?: string;
}

export interface MemoryEscalationPacket {
  schema: "phibot.memory.escalation.v1";
  packetId: string;
  target: string;
  botId: string;
  taskId: string;
  createdAt: string;
  records: MemoryEscalationRecord[];
}
