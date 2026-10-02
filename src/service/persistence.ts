import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  CommonLineEnvelope,
  CommonLineGroup,
} from "../commonline/types.js";
import type { CommonLineGroupStore } from "../commonline/groups.js";
import { compareMessages, type CommonLineTransport } from "../commonline/transport.js";
import type { ReplayStore } from "../gate/replay.js";
import type { MemoryRecord } from "../memory/types.js";
import type { MemoryStore } from "../memory/store.js";

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await ensureDir(join(path, ".."));
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, path);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
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

async function jsonFiles(path: string): Promise<string[]> {
  try {
    return (await readdir(path))
      .filter((name) => name.endsWith(".json"))
      .sort();
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

function safeFileId(id: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error(`Unsafe persistent object id: ${id}`);
  }
  return id;
}

export class FileReplayStore implements ReplayStore {
  private loaded = false;
  private readonly consumed = new Set<string>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.path, "utf8");
      for (const line of raw.split("\n")) {
        const id = line.trim();
        if (id) this.consumed.add(id);
      }
    } catch (error: unknown) {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        throw error;
      }
    }
    this.loaded = true;
  }

  async consume(grantId: string): Promise<boolean> {
    await this.load();
    if (this.consumed.has(grantId)) return false;
    this.consumed.add(grantId);

    this.writeChain = this.writeChain.then(async () => {
      await ensureDir(join(this.path, ".."));
      await appendFile(this.path, `${grantId}\n`, "utf8");
    });
    await this.writeChain;
    return true;
  }
}

export class FileMemoryStore implements MemoryStore {
  constructor(private readonly dir: string) {}

  private path(memoryId: string): string {
    return join(this.dir, `${safeFileId(memoryId)}.json`);
  }

  async put(record: MemoryRecord): Promise<void> {
    await atomicJson(this.path(record.memoryId), record);
  }

  async get(memoryId: string): Promise<MemoryRecord | undefined> {
    return readJson<MemoryRecord>(this.path(memoryId));
  }

  async listByBot(botId: string): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = [];
    for (const name of await jsonFiles(this.dir)) {
      const record = await readJson<MemoryRecord>(join(this.dir, name));
      if (record?.botId === botId) records.push(record);
    }
    return records;
  }

  async delete(memoryId: string): Promise<boolean> {
    try {
      await unlink(this.path(memoryId));
      return true;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
}

export class FileCommonLineTransport implements CommonLineTransport {
  constructor(private readonly dir: string) {}

  private path(messageId: string): string {
    return join(this.dir, `${safeFileId(messageId)}.json`);
  }

  async publish(message: CommonLineEnvelope): Promise<void> {
    if (await this.get(message.messageId)) {
      throw new Error(`Message already exists: ${message.messageId}`);
    }
    await atomicJson(this.path(message.messageId), message);
  }

  async get(messageId: string): Promise<CommonLineEnvelope | undefined> {
    return readJson<CommonLineEnvelope>(this.path(messageId));
  }

  async listThread(threadId: string): Promise<CommonLineEnvelope[]> {
    const messages = await this.all();
    return messages
      .filter((message) => message.threadId === threadId)
      .sort(compareMessages);
  }

  async listForBot(botId: string): Promise<CommonLineEnvelope[]> {
    const messages = await this.all();
    return messages
      .filter((message) =>
        message.recipients.some(
          (recipient) => recipient.kind === "bot" && recipient.id === botId,
        ),
      )
      .sort(compareMessages);
  }

  private async all(): Promise<CommonLineEnvelope[]> {
    const result: CommonLineEnvelope[] = [];
    for (const name of await jsonFiles(this.dir)) {
      const message = await readJson<CommonLineEnvelope>(join(this.dir, name));
      if (message) result.push(message);
    }
    return result;
  }
}

export class FileCommonLineGroupStore implements CommonLineGroupStore {
  constructor(private readonly dir: string) {}

  private path(groupId: string): string {
    return join(this.dir, `${safeFileId(groupId)}.json`);
  }

  async put(group: CommonLineGroup): Promise<void> {
    await atomicJson(this.path(group.groupId), group);
  }

  async get(groupId: string): Promise<CommonLineGroup | undefined> {
    return readJson<CommonLineGroup>(this.path(groupId));
  }

  async delete(groupId: string): Promise<boolean> {
    try {
      await unlink(this.path(groupId));
      return true;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  async listForBot(botId: string): Promise<CommonLineGroup[]> {
    const result: CommonLineGroup[] = [];
    for (const name of await jsonFiles(this.dir)) {
      const group = await readJson<CommonLineGroup>(join(this.dir, name));
      if (
        group &&
        (group.ownerBotId === botId || group.members.includes(botId))
      ) {
        result.push(group);
      }
    }
    return result;
  }
}

export function persistentFileName(path: string): string {
  return basename(path);
}
