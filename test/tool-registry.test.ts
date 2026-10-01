import assert from "node:assert/strict";
import test from "node:test";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";

test("lists typed built-in capabilities", () => {
  const registry = createBuiltinToolRegistry();
  const capabilities = registry.list();

  assert.deepEqual(
    capabilities.map((item) => item.id),
    ["math.add", "utility.echo"],
  );
  assert.equal(
    capabilities.find((item) => item.id === "math.add")?.actionClass,
    "read",
  );
});
