import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PhiBotManifest } from "../core/types.js";
import type {
  BotServiceState,
  RegisteredBot,
} from "./types.js";

interface RegistryFile {
  schema: "phibot.service.registry.v1";
  bots: RegisteredBot[];
}

async function readRegistry(path: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    if (parsed.schema !== "phibot.service.registry.v1" || !Array.isArray(parsed.bots)) {
      throw new Error("Invalid PhiBot service registry file.");
    }
    return parsed;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { schema: "phibot.service.registry.v1", bots: [] };
    }
    throw error;
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, path);
}

export class LocalBotRegistry {
  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  async register(
    manifest: PhiBotManifest,
    replace = false,
  ): Promise<RegisteredBot> {
    const file = await readRegistry(this.path);
    const existingIndex = file.bots.findIndex(
      (bot) => bot.manifest.id === manifest.id,
    );

    if (existingIndex >= 0 && !replace) {
      throw new Error(`Bot already registered: ${manifest.id}`);
    }

    const timestamp = new Date(this.now()).toISOString();
    const existing = existingIndex >= 0 ? file.bots[existingIndex] : undefined;

    const bot: RegisteredBot = {
      manifest: structuredClone(manifest),
      registeredAt: existing?.registeredAt ?? timestamp,
      updatedAt: timestamp,
      state: existing?.state ?? "idle",
      activeRuns: existing?.activeRuns ?? 0,
    };

    if (existingIndex >= 0) file.bots[existingIndex] = bot;
    else file.bots.push(bot);

    file.bots.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
    await atomicWrite(this.path, file);
    return structuredClone(bot);
  }

  async unregister(botId: string): Promise<boolean> {
    const file = await readRegistry(this.path);
    const next = file.bots.filter((bot) => bot.manifest.id !== botId);
    if (next.length === file.bots.length) return false;
    file.bots = next;
    await atomicWrite(this.path, file);
    return true;
  }

  async get(botId: string): Promise<RegisteredBot | undefined> {
    const file = await readRegistry(this.path);
    const bot = file.bots.find((item) => item.manifest.id === botId);
    return bot ? structuredClone(bot) : undefined;
  }

  async list(): Promise<RegisteredBot[]> {
    const file = await readRegistry(this.path);
    return file.bots.map((bot) => structuredClone(bot));
  }

  async setState(
    botId: string,
    state: BotServiceState,
    activeRuns: number,
  ): Promise<RegisteredBot> {
    if (!Number.isInteger(activeRuns) || activeRuns < 0) {
      throw new Error("activeRuns must be a non-negative integer.");
    }

    const file = await readRegistry(this.path);
    const index = file.bots.findIndex((bot) => bot.manifest.id === botId);
    if (index < 0) throw new Error(`Bot not registered: ${botId}`);

    const current = file.bots[index] as RegisteredBot;
    const next: RegisteredBot = {
      ...current,
      state,
      activeRuns,
      updatedAt: new Date(this.now()).toISOString(),
    };
    file.bots[index] = next;
    await atomicWrite(this.path, file);
    return structuredClone(next);
  }
}
