import assert from "node:assert/strict";
import test from "node:test";
import { CommonLine } from "../src/commonline/commonline.js";
import { MemoryLedger } from "../src/core/ledger.js";
import type { PhiBotManifest } from "../src/core/types.js";

const manifest: PhiBotManifest = {
  id: "receiptbot",
  name: "ReceiptBot",
  version: "0.6.0",
  role: "test",
  description: "receipt fixture",
  model: { provider: "dry-run", name: "deterministic" },
  memory: { scope: "task", maxDepth: 2 },
  capabilities: [],
  authority: {
    read: true,
    propose: true,
    write: false,
    deploy: false,
  },
  escalation: { target: "vessie", confidenceBelow: 0.5 },
};

test("message receipts contain linkage metadata but not message text", async () => {
  const ledger = new MemoryLedger();
  const line = new CommonLine({ ledger });

  const message = await line.send(
    manifest,
    {
      to: "otherbot",
      text: "sensitive message body",
      data: { secretish: "not for ledger" },
    },
    "run-receipt",
  );

  const receipt = ledger.receipts.at(-1);
  assert.equal(receipt?.stage, "message");

  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("sensitive message body"), false);
  assert.equal(serialized.includes("not for ledger"), false);
  assert.equal(serialized.includes(message.messageId), true);
  assert.equal(serialized.includes(message.threadId), true);
});
