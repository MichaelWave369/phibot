import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { RealityGrant } from "./types.js";

function canonicalize(value: unknown): string {
  if (value === null) return "null";

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("Cannot canonicalize non-finite number.");
      }
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys
        .filter((key) => record[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
        .join(",")}}`;
    }
    default:
      throw new Error(`Cannot canonicalize value of type ${typeof value}.`);
  }
}

export function digestInput(input: unknown): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

export type UnsignedRealityGrant = Omit<RealityGrant, "signature">;

export function signGrant(
  grant: UnsignedRealityGrant,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalize(grant))
    .digest("hex");
}

export function verifyGrantSignature(
  grant: RealityGrant,
  secret: string,
): boolean {
  const { signature, ...unsigned } = grant;
  const expected = signGrant(unsigned, secret);

  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (
    actualBuffer.length === 0 ||
    actualBuffer.length !== expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export { canonicalize };
