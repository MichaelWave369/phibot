import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { SpawnRecord } from "./types.js";

export interface SpawnStore {
  put(record: SpawnRecord): Promise<void>;
  get(spawnId: string): Promise<SpawnRecord | undefined>;
  list(): Promise<SpawnRecord[]>;
}

export class MemorySpawnStore implements SpawnStore {
  private readonly records = new Map<string, SpawnRecord>();

  async put(record: SpawnRecord): Promise<void> {
    this.records.set(record.spawnId, structuredClone(record));
  }

  async get(spawnId: string): Promise<SpawnRecord | undefined> {
    const record = this.records.get(spawnId);
    return record ? structuredClone(record) : undefined;
  }

  async list(): Promise<SpawnRecord[]> {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`Unsafe spawn record ID: ${value}`);
  }
  return value;
}

export class FileSpawnStore implements SpawnStore {
  constructor(private readonly dir: string) {}

  private path(spawnId: string): string {
    return join(this.dir, `${safeId(spawnId)}.json`);
  }

  async put(record: SpawnRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.path(record.spawnId);
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify(record, null, 2), "utf8");
    await rename(temp, path);
  }

  async get(spawnId: string): Promise<SpawnRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.path(spawnId), "utf8")) as SpawnRecord;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async list(): Promise<SpawnRecord[]> {
    try {
      const result: SpawnRecord[] = [];
      for (const name of (await readdir(this.dir)).filter((item) =>
        item.endsWith(".json"),
      )) {
        const record = JSON.parse(
          await readFile(join(this.dir, name), "utf8"),
        ) as SpawnRecord;
        result.push(record);
      }
      return result.sort((a, b) => a.spawnedAt.localeCompare(b.spawnedAt));
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }
}
