import { readFile } from "node:fs/promises";
import type { PhiBotManifest } from "./types.js";

function fail(message: string): never {
  throw new Error(`Invalid PhiBot manifest: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateManifest(value: unknown): PhiBotManifest {
  if (!isRecord(value)) fail("root must be an object");

  const requiredStrings = ["id", "name", "version", "role", "description"] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      fail(`${key} must be a non-empty string`);
    }
  }

  if (!isRecord(value.model)) fail("model must be an object");
  if (typeof value.model.provider !== "string" || typeof value.model.name !== "string") {
    fail("model.provider and model.name must be strings");
  }

  if (!isRecord(value.memory)) fail("memory must be an object");
  if (typeof value.memory.scope !== "string") fail("memory.scope must be a string");
  if (
    typeof value.memory.maxDepth !== "number" ||
    !Number.isInteger(value.memory.maxDepth) ||
    value.memory.maxDepth < 0
  ) {
    fail("memory.maxDepth must be a non-negative integer");
  }

  if (
    !Array.isArray(value.capabilities) ||
    value.capabilities.some((capability) => typeof capability !== "string")
  ) {
    fail("capabilities must be an array of strings");
  }

  if (!isRecord(value.authority)) fail("authority must be an object");
  for (const key of ["read", "propose", "write", "deploy"] as const) {
    const mode = value.authority[key];
    if (mode !== true && mode !== false && mode !== "gated") {
      fail(`authority.${key} must be true, false, or "gated"`);
    }
  }

  if (!isRecord(value.escalation)) fail("escalation must be an object");
  if (typeof value.escalation.target !== "string" || value.escalation.target.trim() === "") {
    fail("escalation.target must be a non-empty string");
  }
  if (
    typeof value.escalation.confidenceBelow !== "number" ||
    value.escalation.confidenceBelow < 0 ||
    value.escalation.confidenceBelow > 1
  ) {
    fail("escalation.confidenceBelow must be between 0 and 1");
  }

  return value as unknown as PhiBotManifest;
}

export async function loadManifest(path: string): Promise<PhiBotManifest> {
  const raw = await readFile(path, "utf8");
  return validateManifest(JSON.parse(raw) as unknown);
}
