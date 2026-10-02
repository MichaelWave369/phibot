import { randomUUID } from "node:crypto";
import type {
  ResourceBudgetConfig,
  RunBudgetUsage,
} from "./types.js";

export const DEFAULT_RESOURCE_BUDGETS: ResourceBudgetConfig = {
  maxConcurrentRuns: 2,
  maxRunsPerWindow: 60,
  windowMs: 60_000,
  maxProviderTokensPerRun: 32_768,
  maxToolCallsPerRun: 100,
};

export class BudgetExceededError extends Error {
  constructor(
    readonly code:
      | "concurrency"
      | "run_rate"
      | "provider_tokens"
      | "tool_calls",
    message: string,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

interface BotBudgetState {
  starts: number[];
  activeRuns: Set<string>;
}

interface MutableRunUsage extends RunBudgetUsage {
  startedAtMs: number;
}

export class ResourceBudgetManager {
  readonly config: ResourceBudgetConfig;
  private readonly botState = new Map<string, BotBudgetState>();
  private readonly runs = new Map<string, MutableRunUsage>();

  constructor(
    config: Partial<ResourceBudgetConfig> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.config = { ...DEFAULT_RESOURCE_BUDGETS, ...config };

    for (const [name, value] of Object.entries(this.config)) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Resource budget ${name} must be a positive integer.`);
      }
    }
  }

  private stateFor(botId: string): BotBudgetState {
    const existing = this.botState.get(botId);
    if (existing) return existing;
    const state = { starts: [], activeRuns: new Set<string>() };
    this.botState.set(botId, state);
    return state;
  }

  acquire(botId: string, runId: string = randomUUID()): RunBudgetUsage {
    if (this.runs.has(runId)) {
      throw new Error(`Run already exists: ${runId}`);
    }

    const now = this.now();
    const state = this.stateFor(botId);
    state.starts = state.starts.filter(
      (started) => now - started < this.config.windowMs,
    );

    if (state.activeRuns.size >= this.config.maxConcurrentRuns) {
      throw new BudgetExceededError(
        "concurrency",
        `Bot ${botId} reached maxConcurrentRuns=${this.config.maxConcurrentRuns}.`,
      );
    }

    if (state.starts.length >= this.config.maxRunsPerWindow) {
      throw new BudgetExceededError(
        "run_rate",
        `Bot ${botId} reached maxRunsPerWindow=${this.config.maxRunsPerWindow}.`,
      );
    }

    const usage: MutableRunUsage = {
      runId,
      botId,
      startedAt: new Date(now).toISOString(),
      startedAtMs: now,
      providerTokens: 0,
      toolCalls: 0,
    };

    state.starts.push(now);
    state.activeRuns.add(runId);
    this.runs.set(runId, usage);
    return this.publicUsage(usage);
  }

  recordProviderTokens(runId: string, tokens: number): RunBudgetUsage {
    if (!Number.isInteger(tokens) || tokens < 0) {
      throw new Error("Provider token usage must be a non-negative integer.");
    }
    const usage = this.requireRun(runId);
    if (
      usage.providerTokens + tokens >
      this.config.maxProviderTokensPerRun
    ) {
      throw new BudgetExceededError(
        "provider_tokens",
        `Run ${runId} would exceed maxProviderTokensPerRun=${this.config.maxProviderTokensPerRun}.`,
      );
    }
    usage.providerTokens += tokens;
    return this.publicUsage(usage);
  }

  recordToolCall(runId: string, count = 1): RunBudgetUsage {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Tool call count must be a positive integer.");
    }
    const usage = this.requireRun(runId);
    if (usage.toolCalls + count > this.config.maxToolCallsPerRun) {
      throw new BudgetExceededError(
        "tool_calls",
        `Run ${runId} would exceed maxToolCallsPerRun=${this.config.maxToolCallsPerRun}.`,
      );
    }
    usage.toolCalls += count;
    return this.publicUsage(usage);
  }

  release(runId: string): RunBudgetUsage {
    const usage = this.requireRun(runId);
    this.stateFor(usage.botId).activeRuns.delete(runId);
    this.runs.delete(runId);
    return this.publicUsage(usage);
  }

  active(botId?: string): RunBudgetUsage[] {
    return [...this.runs.values()]
      .filter((usage) => botId === undefined || usage.botId === botId)
      .sort((a, b) => a.startedAtMs - b.startedAtMs)
      .map((usage) => this.publicUsage(usage));
  }

  private requireRun(runId: string): MutableRunUsage {
    const usage = this.runs.get(runId);
    if (!usage) throw new Error(`Unknown active run: ${runId}`);
    return usage;
  }

  private publicUsage(usage: MutableRunUsage): RunBudgetUsage {
    return {
      runId: usage.runId,
      botId: usage.botId,
      startedAt: usage.startedAt,
      providerTokens: usage.providerTokens,
      toolCalls: usage.toolCalls,
    };
  }
}
