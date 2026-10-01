import type { CommonLineGroup } from "./types.js";

export interface CommonLineGroupStore {
  put(group: CommonLineGroup): Promise<void>;
  get(groupId: string): Promise<CommonLineGroup | undefined>;
  delete(groupId: string): Promise<boolean>;
  listForBot(botId: string): Promise<CommonLineGroup[]>;
}

export class MemoryCommonLineGroupStore implements CommonLineGroupStore {
  private readonly groups = new Map<string, CommonLineGroup>();

  async put(group: CommonLineGroup): Promise<void> {
    this.groups.set(group.groupId, structuredClone(group));
  }

  async get(groupId: string): Promise<CommonLineGroup | undefined> {
    const group = this.groups.get(groupId);
    return group ? structuredClone(group) : undefined;
  }

  async delete(groupId: string): Promise<boolean> {
    return this.groups.delete(groupId);
  }

  async listForBot(botId: string): Promise<CommonLineGroup[]> {
    return [...this.groups.values()]
      .filter(
        (group) =>
          group.ownerBotId === botId || group.members.includes(botId),
      )
      .map((group) => structuredClone(group));
  }
}
