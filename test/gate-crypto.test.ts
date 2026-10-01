import assert from "node:assert/strict";
import test from "node:test";
import { digestInput, signGrant, verifyGrantSignature } from "../src/gate/crypto.js";
import type { RealityGrant } from "../src/gate/types.js";

test("canonical input digest ignores object key order", () => {
  assert.equal(
    digestInput({ b: 2, a: 1 }),
    digestInput({ a: 1, b: 2 }),
  );
});

test("grant signature detects tampering", () => {
  const unsigned = {
    schema: "phibot.gate.grant.v1" as const,
    grantId: "grant-1",
    requestId: "request-1",
    runId: "run-1",
    botId: "bot-1",
    capability: "repo.patch",
    actionClass: "write" as const,
    inputDigest: digestInput({ patch: "x" }),
    issuedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:01:00.000Z",
    maxUses: 1 as const,
    decision: "approve" as const,
  };

  const grant: RealityGrant = {
    ...unsigned,
    signature: signGrant(unsigned, "0123456789abcdef"),
  };

  assert.equal(
    verifyGrantSignature(grant, "0123456789abcdef"),
    true,
  );

  assert.equal(
    verifyGrantSignature(
      { ...grant, capability: "repo.delete" },
      "0123456789abcdef",
    ),
    false,
  );
});
