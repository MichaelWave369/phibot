import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { LedgerReceipt } from "./types.js";

export interface Ledger {
  append(receipt: LedgerReceipt): Promise<void>;
}

export class MemoryLedger implements Ledger {
  readonly receipts: LedgerReceipt[] = [];

  async append(receipt: LedgerReceipt): Promise<void> {
    this.receipts.push(receipt);
  }
}

export class FileLedger implements Ledger {
  constructor(private readonly path = ".phibot/ledger.ndjson") {}

  async append(receipt: LedgerReceipt): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(receipt)}\n`, "utf8");
  }
}
