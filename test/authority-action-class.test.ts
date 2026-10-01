import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuthority } from "../src/core/authority.js";
import type { PhiBotManifest } from "../src/core/types.js";

const manifest: PhiBotManifest = {
  id: "authoritybot",
  name: "AuthorityBot",
  version: "0.3.0",
  role: "test",
  description: "authority fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 1 },
  capabilities: ["repo.read"],
  authority: {
    read: true,
    propose: true,
    write: "gated",
    deploy: false,
  },
  escalation: { target: "vessie", confidenceBelow: 0.5 },
};

test("proposal can carry an explicit action class", () => {
  const decision = evaluateAuthority(manifest, {
    stage: "verify",
    summary: "request write",
    confidence: 0.9,
    action: {
      capability: "repo.read",
      external: false,
      description: "fixture",
      authority: "write",
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.gated, true);
  assert.equal(decision.authorityClass, "write");
});
