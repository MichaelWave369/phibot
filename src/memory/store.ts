import type { MemoryRecord } from "./types.js";

export interface MemoryStore {
  put(record: MemoryRecord): Promise<void>;
  get(memoryId: string): Promise<MemoryRecord | undefined>;
  listByBot(botId: string): Promise<MemoryRecord[]>;
  delete(memoryId: string): Promise<boolean>;
}

export class MemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, MemoryRecord>();

  async put(record: MemoryRecord): Promise<void> {
    this.records.set(record.memoryId, structuredClone(record));
  }

  async get(memoryId: string): Promise<MemoryRecord | undefined> {
    const record = this.records.get(memoryId);
    return record ? structuredClone(record) : undefined;
  }

  async listByBot(botId: string): Promise<MemoryRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.botId === botId)
      .map((record) => structuredClone(record));
  }

  async delete(memoryId: string): Promise<boolean> {
    return this.records.delete(memoryId);
  }
}
