import { createHash } from "node:crypto";
import type { RegisteredBot } from "./types.js";

const TAG = /^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/;
const ID = /^[A-Za-z0-9_.-]{1,80}$/;
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 128 * 1024;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, expected: string[]): boolean =>
  record(v) && Object.keys(v).sort().join(",") === [...expected].sort().join(",");

export interface ModelChangeProposal {
  schema: "phibot.crew.model-change.v1";
  botId: string;
  current: { provider: string; name: string; updatedAt: string };
  candidate: { provider: "ollama"; name: string };
  digest: string;
}

export function validateOllamaPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("MODEL_CHANGE_OLLAMA_PORT_INVALID");
  return port;
}

export function buildModelChange(bot: RegisteredBot, tag: string): ModelChangeProposal {
  if (!ID.test(bot.manifest.id) || !TAG.test(tag) ||
      bot.state !== "idle" || bot.activeRuns !== 0 ||
      !Number.isFinite(Date.parse(bot.updatedAt)))
    throw new Error("MODEL_CHANGE_BOT_INELIGIBLE");
  const base = {
    schema: "phibot.crew.model-change.v1" as const,
    botId: bot.manifest.id,
    current: {
      provider: bot.manifest.model.provider,
      name: bot.manifest.model.name,
      updatedAt: bot.updatedAt,
    },
    candidate: { provider: "ollama" as const, name: tag },
  };
  const digest = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  return { ...base, digest };
}

export function verifyModelChange(input: unknown): ModelChangeProposal {
  if (!keys(input, ["schema", "botId", "current", "candidate", "digest"]))
    throw new Error("MODEL_CHANGE_SHAPE_INVALID");
  const v = input as Record<string, unknown>;
  if (v.schema !== "phibot.crew.model-change.v1" ||
      typeof v.botId !== "string" || !ID.test(v.botId) ||
      !keys(v.current, ["provider", "name", "updatedAt"]) ||
      !keys(v.candidate, ["provider", "name"]) ||
      typeof v.digest !== "string" || !HEX.test(v.digest))
    throw new Error("MODEL_CHANGE_SHAPE_INVALID");
  const current = v.current as Record<string, unknown>;
  const candidate = v.candidate as Record<string, unknown>;
  if (typeof current.provider !== "string" || current.provider.length > 80 ||
      typeof current.name !== "string" || current.name.length > 100 ||
      typeof current.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(current.updatedAt)) ||
      candidate.provider !== "ollama" ||
      typeof candidate.name !== "string" || !TAG.test(candidate.name))
    throw new Error("MODEL_CHANGE_FIELDS_INVALID");
  const base = {
    schema: "phibot.crew.model-change.v1" as const,
    botId: v.botId as string,
    current: {
      provider: current.provider,
      name: current.name,
      updatedAt: current.updatedAt,
    },
    candidate: { provider: "ollama" as const, name: candidate.name },
  };
  const expected = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  if (expected !== v.digest) throw new Error("MODEL_CHANGE_DIGEST_MISMATCH");
  return { ...base, digest: expected };
}

export async function requireLocalOllamaTag(
  port: number, requested: string, fetchImpl: typeof fetch = fetch,
): Promise<void> {
  validateOllamaPort(port);
  if (!TAG.test(requested)) throw new Error("MODEL_CHANGE_TAG_INVALID");
  const response = await fetchImpl("http://127.0.0.1:" + port + "/api/tags", {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("application/json"))
    throw new Error("MODEL_CHANGE_OLLAMA_UNAVAILABLE");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BYTES))
    throw new Error("MODEL_CHANGE_CATALOG_OVERSIZE");
  if (!response.body) throw new Error("MODEL_CHANGE_EMPTY_CATALOG");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("MODEL_CHANGE_CATALOG_OVERSIZE");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new Error("MODEL_CHANGE_CATALOG_INVALID"); }
  if (!record(parsed) || !Array.isArray(parsed.models) || parsed.models.length > 128)
    throw new Error("MODEL_CHANGE_CATALOG_INVALID");
  const names: string[] = [];
  for (const entry of parsed.models) {
    if (!record(entry) || typeof entry.name !== "string" || !TAG.test(entry.name))
      throw new Error("MODEL_CHANGE_CATALOG_INVALID");
    names.push(entry.name);
  }
  if (new Set(names).size !== names.length) throw new Error("MODEL_CHANGE_CATALOG_INVALID");
  if (!names.includes(requested)) throw new Error("MODEL_CHANGE_TAG_NOT_INSTALLED");
}
