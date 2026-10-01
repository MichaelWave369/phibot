import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolCapabilityRegistry } from "../src/tools/registry.js";

function manifest(
  capabilities: string[],
  authority: PhiBotManifest["authority"] = {
    read: true,
    propose: true,
    write: false,
    deploy: false,
  },
): PhiBotManifest {
  return {
    id: "toolbot",
    name: "ToolBot",
    version: "0.3.0",
    role: "test",
    description: "tool executor fixture",
    model: { provider: "dry-run", name: "deterministic" },
    memory: { scope: "task", maxDepth: 1 },
    capabilities,
    authority,
    escalation: { target: "vessie", confidenceBelow: 0.5 },
  };
}

test("executes declared registered capability and receipts it", async () => {
  const ledger = new MemoryLedger();
  const executor = new ToolExecutor(createBuiltinToolRegistry(), ledger);

  const result = await executor.execute(
    manifest(["math.add"]),
    {
      capability: "math.add",
      input: { values: [3, 6, 9] },
    },
    "run-1",
  );

  assert.equal(result.status, "executed");
  assert.deepEqual(result.output, { total: 18 });
  assert.equal(result.receipt.stage, "tool");
  assert.equal(result.receipt.status, "ok");
  assert.equal(ledger.receipts.length, 1);
});

test("denies capability that bot did not declare", async () => {
  const executor = new ToolExecutor(
    createBuiltinToolRegistry(),
    new MemoryLedger(),
  );

  const result = await executor.execute(manifest([]), {
    capability: "math.add",
    input: { values: [1, 2] },
  });

  assert.equal(result.status, "denied");
  assert.match(result.error ?? "", /not declared/);
});

test("denies unknown tools even when manifest names them", async () => {
  const executor = new ToolExecutor(
    createBuiltinToolRegistry(),
    new MemoryLedger(),
  );

  const result = await executor.execute(manifest(["mystery.tool"]), {
    capability: "mystery.tool",
    input: {},
  });

  assert.equal(result.status, "denied");
  assert.match(result.error ?? "", /not registered/);
});

test("registry-owned action class can force Reality Gate", async () => {
  const registry = new ToolCapabilityRegistry().register({
    id: "repo.patch",
    description: "fixture write",
    actionClass: "write",
    external: true,
    validate(input: unknown) {
      return input;
    },
    async execute() {
      throw new Error("must never execute before gate");
    },
  });

  const executor = new ToolExecutor(registry, new MemoryLedger());
  const result = await executor.execute(
    manifest(
      ["repo.patch"],
      {
        read: true,
        propose: true,
        write: "gated",
        deploy: false,
      },
    ),
    {
      capability: "repo.patch",
      input: { patch: "x" },
    },
  );

  assert.equal(result.status, "gated");
  assert.match(result.error ?? "", /Reality Gate/);
});

test("invalid capability arguments fail before execution", async () => {
  const executor = new ToolExecutor(
    createBuiltinToolRegistry(),
    new MemoryLedger(),
  );

  const result = await executor.execute(manifest(["math.add"]), {
    capability: "math.add",
    input: { values: ["nope"] },
  });

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /math\.add requires/);
});
