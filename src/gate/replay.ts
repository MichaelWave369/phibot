export interface ReplayStore {
  consume(grantId: string): Promise<boolean>;
}

export class MemoryReplayStore implements ReplayStore {
  private readonly consumed = new Set<string>();

  async consume(grantId: string): Promise<boolean> {
    if (this.consumed.has(grantId)) return false;
    this.consumed.add(grantId);
    return true;
  }
}
