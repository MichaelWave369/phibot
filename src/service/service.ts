import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CommonLine } from "../commonline/commonline.js";
import { FileLedger } from "../core/ledger.js";
import type { PhiBotManifest } from "../core/types.js";
import { RealityGate } from "../gate/reality-gate.js";
import { NbgMemoryPods } from "../memory/pods.js";
import { ResourceBudgetManager, BudgetExceededError } from "./budget.js";
import { ServiceEventBus } from "./events.js";
import {
  FileCommonLineGroupStore,
  FileCommonLineTransport,
  FileMemoryStore,
  FileReplayStore,
} from "./persistence.js";
import { LocalBotRegistry } from "./registry.js";
import type {
  PhiBotServiceOptions,
  PhiBotServiceSnapshot,
  RunBudgetUsage,
  ServiceLifecycle,
} from "./types.js";

const SERVICE_BOT_ID = "phibot-service";
const SERVICE_BOT_VERSION = "0.7.0";

export class PhiBotService {
  readonly stateDir: string;
  readonly ledger: FileLedger;
  readonly registry: LocalBotRegistry;
  readonly events: ServiceEventBus;
  readonly budgets: ResourceBudgetManager;
  readonly replayStore: FileReplayStore;
  readonly memoryStore: FileMemoryStore;
  readonly commonLineTransport: FileCommonLineTransport;
  readonly commonLineGroups: FileCommonLineGroupStore;
  readonly commonLine: CommonLine;

  private lifecycle: ServiceLifecycle = "stopped";
  private startedAt: string | undefined;
  private readonly now: () => number;

  constructor(options: PhiBotServiceOptions = {}) {
    this.stateDir = resolve(options.stateDir ?? ".phibot/service");
    this.now = options.now ?? Date.now;
    this.ledger = new FileLedger(join(this.stateDir, "ledger.ndjson"));
    this.registry = new LocalBotRegistry(
      join(this.stateDir, "registry.json"),
      this.now,
    );
    this.events = new ServiceEventBus(this.now);
    this.budgets = new ResourceBudgetManager(options.budgets, this.now);
    this.replayStore = new FileReplayStore(
      join(this.stateDir, "replay", "consumed-grants.ndjson"),
    );
    this.memoryStore = new FileMemoryStore(join(this.stateDir, "memory"));
    this.commonLineTransport = new FileCommonLineTransport(
      join(this.stateDir, "commonline", "messages"),
    );
    this.commonLineGroups = new FileCommonLineGroupStore(
      join(this.stateDir, "commonline", "groups"),
    );
    this.commonLine = new CommonLine({
      ledger: this.ledger,
      transport: this.commonLineTransport,
      groups: this.commonLineGroups,
      now: this.now,
    });
  }

  async start(): Promise<void> {
    if (this.lifecycle === "running") return;
    await mkdir(this.stateDir, { recursive: true });

    for (const bot of await this.registry.list()) {
      if (bot.state === "running" || bot.activeRuns !== 0) {
        await this.registry.setState(bot.manifest.id, "idle", 0);
      }
    }

    this.lifecycle = "running";
    this.startedAt = new Date(this.now()).toISOString();
    this.events.publish("service.started", {
      detail: { stateDir: this.stateDir },
    });
    await this.serviceReceipt("ok", "PhiBot service started.", {
      event: "service.started",
      stateDir: this.stateDir,
    });
  }

  async stop(): Promise<void> {
    if (this.lifecycle === "stopped") return;
    if (this.budgets.active().length > 0) {
      throw new Error("Cannot stop PhiBot service while runs are active.");
    }
    this.lifecycle = "stopped";
    this.events.publish("service.stopped");
    await this.serviceReceipt("ok", "PhiBot service stopped.", {
      event: "service.stopped",
    });
  }

  async registerBot(
    manifest: PhiBotManifest,
    replace = false,
  ): Promise<void> {
    this.requireRunning();
    const bot = await this.registry.register(manifest, replace);
    this.events.publish("bot.registered", {
      botId: manifest.id,
      detail: { version: manifest.version, role: manifest.role },
    });
    await this.serviceReceipt("ok", `Registered PhiBot ${manifest.id}.`, {
      event: "bot.registered",
      botId: bot.manifest.id,
      botVersion: bot.manifest.version,
    });
  }

  async unregisterBot(botId: string): Promise<boolean> {
    this.requireRunning();
    if (this.budgets.active(botId).length > 0) {
      throw new Error(`Cannot unregister bot with active runs: ${botId}`);
    }
    const removed = await this.registry.unregister(botId);
    if (removed) {
      this.events.publish("bot.unregistered", { botId });
      await this.serviceReceipt("ok", `Unregistered PhiBot ${botId}.`, {
        event: "bot.unregistered",
        botId,
      });
    }
    return removed;
  }

  async beginRun(
    botId: string,
    runId?: string,
  ): Promise<RunBudgetUsage> {
    this.requireRunning();
    const bot = await this.registry.get(botId);
    if (!bot) throw new Error(`Bot not registered: ${botId}`);
    if (bot.state === "disabled") {
      throw new Error(`Bot is disabled: ${botId}`);
    }

    try {
      const usage =
        runId === undefined
          ? this.budgets.acquire(botId)
          : this.budgets.acquire(botId, runId);
      const active = this.budgets.active(botId).length;
      await this.registry.setState(botId, "running", active);
      this.events.publish("run.started", {
        botId,
        runId: usage.runId,
      });
      return usage;
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        this.events.publish("budget.blocked", {
          botId,
          ...(runId === undefined ? {} : { runId }),
          detail: { code: error.code, message: error.message },
        });
        await this.serviceReceipt("blocked", error.message, {
          event: "budget.blocked",
          botId,
          ...(runId === undefined ? {} : { runId }),
          code: error.code,
        });
      }
      throw error;
    }
  }

  async recordProviderTokens(
    runId: string,
    tokens: number,
  ): Promise<RunBudgetUsage> {
    return this.recordBudgetUpdate(runId, () =>
      this.budgets.recordProviderTokens(runId, tokens),
    );
  }

  async recordToolCall(
    runId: string,
    count = 1,
  ): Promise<RunBudgetUsage> {
    return this.recordBudgetUpdate(runId, () =>
      this.budgets.recordToolCall(runId, count),
    );
  }

  async finishRun(runId: string): Promise<RunBudgetUsage> {
    this.requireRunning();
    const usage = this.budgets.release(runId);
    const active = this.budgets.active(usage.botId).length;
    await this.registry.setState(
      usage.botId,
      active > 0 ? "running" : "idle",
      active,
    );
    this.events.publish("run.finished", {
      botId: usage.botId,
      runId,
      detail: {
        providerTokens: usage.providerTokens,
        toolCalls: usage.toolCalls,
      },
    });
    return usage;
  }

  async disableBot(botId: string): Promise<void> {
    this.requireRunning();
    if (this.budgets.active(botId).length > 0) {
      throw new Error(`Cannot disable bot with active runs: ${botId}`);
    }
    await this.registry.setState(botId, "disabled", 0);
    this.events.publish("bot.state", {
      botId,
      detail: { state: "disabled" },
    });
  }

  async enableBot(botId: string): Promise<void> {
    this.requireRunning();
    await this.registry.setState(botId, "idle", 0);
    this.events.publish("bot.state", {
      botId,
      detail: { state: "idle" },
    });
  }

  memoryPods(_manifest: PhiBotManifest): NbgMemoryPods {
    return new NbgMemoryPods({
      store: this.memoryStore,
      ledger: this.ledger,
      now: this.now,
    });
  }

  realityGate(secret: string): RealityGate {
    return new RealityGate({
      secret,
      ledger: this.ledger,
      replayStore: this.replayStore,
      now: this.now,
    });
  }

  async snapshot(): Promise<PhiBotServiceSnapshot> {
    return {
      schema: "phibot.service.snapshot.v1",
      lifecycle: this.lifecycle,
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
      stateDir: this.stateDir,
      bots: await this.registry.list(),
      activeRuns: this.budgets.active(),
      budgets: { ...this.budgets.config },
      eventCount: this.events.history().length,
    };
  }

  private async recordBudgetUpdate(
    runId: string,
    operation: () => RunBudgetUsage,
  ): Promise<RunBudgetUsage> {
    this.requireRunning();
    try {
      const usage = operation();
      this.events.publish("budget.updated", {
        botId: usage.botId,
        runId,
        detail: {
          providerTokens: usage.providerTokens,
          toolCalls: usage.toolCalls,
        },
      });
      return usage;
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        const usage = this.budgets
          .active()
          .find((item) => item.runId === runId);
        this.events.publish("budget.blocked", {
          ...(usage?.botId === undefined ? {} : { botId: usage.botId }),
          runId,
          detail: { code: error.code, message: error.message },
        });
        await this.serviceReceipt("blocked", error.message, {
          event: "budget.blocked",
          runId,
          code: error.code,
        });
      }
      throw error;
    }
  }

  private requireRunning(): void {
    if (this.lifecycle !== "running") {
      throw new Error("PhiBot service is not running.");
    }
  }

  private async serviceReceipt(
    status: "ok" | "blocked" | "escalate",
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.ledger.append({
      schema: "phibot.receipt.v1",
      runId: "service",
      botId: SERVICE_BOT_ID,
      botVersion: SERVICE_BOT_VERSION,
      stage: "service",
      timestamp: new Date(this.now()).toISOString(),
      status,
      summary,
      metadata,
    });
  }
}
