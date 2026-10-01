import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuthority } from "../src/core/authority.js";
import type { PhiBotManifest } from "../src/core/types.js";

const manifest: PhiBotManifest = {
  id: "patchbot",
  name: "PatchBot",
  version: "0.1.0",
  role: "code_repair",
  description: "fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "repo", maxDepth: 3 },
  capabilities: ["repo.patch"],
  authority: { read: true, propose: true, write: "gated", deploy: false },
  escalation: { target: "vessie", confidenceBelow: 0.7 }
};

test("gates declared external writes", () => {
  const decision = evaluateAuthority(manifest, {
    stage: "verify",
    summary: "patch ready",
    confidence: 0.9,
    action: {
      capability: "repo.patch",
      external: true,
      description: "write patch"
    }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.gated, true);
});

test("blocks undeclared capabilities", () => {
  const decision = evaluateAuthority(manifest, {
    stage: "verify",
    summary: "deploy ready",
    confidence: 0.9,
    action: {
      capability: "deploy.production",
      external: true,
      description: "deploy"
    }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.gated, false);
});
