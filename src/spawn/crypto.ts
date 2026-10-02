import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalize, digestInput } from "../gate/crypto.js";
import type { SpawnApproval } from "./types.js";

export type UnsignedSpawnApproval = Omit<SpawnApproval, "signature">;

export function digestSpawnManifest(value: unknown): string {
  return digestInput(value);
}

export function signSpawnApproval(
  approval: UnsignedSpawnApproval,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalize(approval))
    .digest("hex");
}

export function verifySpawnApprovalSignature(
  approval: SpawnApproval,
  secret: string,
): boolean {
  const { signature, ...unsigned } = approval;
  const expected = signSpawnApproval(unsigned, secret);
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return (
    actualBuffer.length > 0 &&
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
