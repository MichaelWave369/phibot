import assert from "node:assert/strict";
import test from "node:test";
import { ToolCapabilityRegistry } from "../src/tools/registry.js";
import { ToolSandbox } from "../src/tools/sandbox.js";

test("times out a tool that does not finish", async () => {
  const registry = new ToolCapabilityRegistry().register({
    id: "fixture.slow",
    description: "slow fixture",
    actionClass: "read",
    external: false,
    validate(input: unknown) {
      return input;
    },
    async execute(_input, context) {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return "late";
    },
  });

  const capability = registry.get("fixture.slow");
  assert.ok(capability);

  const sandbox = new ToolSandbox({ timeoutMs: 5 });

  await assert.rejects(
    () =>
      sandbox.run(
        capability,
        { botId: "toolbot", runId: "run-timeout" },
        {},
      ),
    /timed out/,
  );
});
