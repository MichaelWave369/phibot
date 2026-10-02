import assert from "node:assert/strict";
import test from "node:test";
import {
  BudgetExceededError,
  ResourceBudgetManager,
} from "../src/service/budget.js";

test("enforces concurrent runs and provider/tool budgets", () => {
  const budgets = new ResourceBudgetManager({
    maxConcurrentRuns: 1,
    maxRunsPerWindow: 10,
    windowMs: 60_000,
    maxProviderTokensPerRun: 10,
    maxToolCallsPerRun: 2,
  });

  const first = budgets.acquire("bot-a", "run-a");

  assert.throws(
    () => budgets.acquire("bot-a", "run-b"),
    (error: unknown) =>
      error instanceof BudgetExceededError && error.code === "concurrency",
  );

  assert.equal(
    budgets.recordProviderTokens(first.runId, 6).providerTokens,
    6,
  );

  assert.throws(
    () => budgets.recordProviderTokens(first.runId, 5),
    (error: unknown) =>
      error instanceof BudgetExceededError &&
      error.code === "provider_tokens",
  );

  budgets.recordToolCall(first.runId);
  budgets.recordToolCall(first.runId);

  assert.throws(
    () => budgets.recordToolCall(first.runId),
    (error: unknown) =>
      error instanceof BudgetExceededError && error.code === "tool_calls",
  );

  const released = budgets.release(first.runId);
  assert.equal(released.providerTokens, 6);
  assert.equal(released.toolCalls, 2);
  assert.equal(budgets.active().length, 0);
});

test("enforces starts-per-window", () => {
  let now = 1_000;
  const budgets = new ResourceBudgetManager(
    {
      maxConcurrentRuns: 2,
      maxRunsPerWindow: 1,
      windowMs: 100,
      maxProviderTokensPerRun: 10,
      maxToolCallsPerRun: 2,
    },
    () => now,
  );

  budgets.acquire("bot-a", "run-1");
  budgets.release("run-1");

  assert.throws(
    () => budgets.acquire("bot-a", "run-2"),
    (error: unknown) =>
      error instanceof BudgetExceededError && error.code === "run_rate",
  );

  now += 101;
  assert.equal(budgets.acquire("bot-a", "run-3").runId, "run-3");
});
