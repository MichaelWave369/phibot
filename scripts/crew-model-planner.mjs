/**
 * PHIBOT-34: operator-review-only Ollama model and crew mission planner.
 * No inference, model switching, bot mutation, GitHub calls, or tool execution.
 * A provider tag list is only a local self-report, NOT an inference qualification.
 */
import { createHash } from "node:crypto";

const MODEL = /^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/;
const ID = /^[A-Za-z0-9_.-]{1,80}$/;
const MISSIONS = new Set(["scout", "patch", "skeptic", "test", "memory"]);
const MAX_BYTES = 128 * 1024;
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);

function strictKeys(value, keys) {
  return object(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function validatePort(value) {
  if (typeof value !== "string" || !/^[0-9]{1,5}$/.test(value)) throw Error("CREW_MODEL_PORT_INVALID");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("CREW_MODEL_PORT_INVALID");
  return port;
}
function normalizedModels(json) {
  if (!object(json) || !Array.isArray(json.models) ||
      json.models.length > 128) throw Error("CREW_MODEL_CATALOG_INVALID");
  const models = json.models.map(item => {
    if (!object(item) || typeof item.name !== "string" || !MODEL.test(item.name))
      throw Error("CREW_MODEL_TAG_INVALID");
    return item.name;
  });
  if (new Set(models).size !== models.length) throw Error("CREW_MODEL_DUPLICATE_TAG");
  return models.sort();
}
async function readLimitedResponse(url, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok || !(res.headers.get("content-type") || "").startsWith("application/json"))
    throw Error("CREW_MODEL_RESPONSE_INVALID");
  if (Number(res.headers.get("content-length") || 0) > MAX_BYTES)
    throw Error("CREW_MODEL_OVERSIZE");
  if (!res.body) throw Error("CREW_MODEL_BODY_MISSING");
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw Error("CREW_MODEL_OVERSIZE");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function readOllamaModels({ env = process.env, fetchImpl = fetch } = {}) {
  const raw = env.PHIBOT_CREW_OLLAMA_PORT;
  if (raw === undefined || raw === "") return {
    schema: "phibot.crew.models.v1", connected: false,
    status: "OLLAMA_NOT_CONFIGURED", models: [],
    qualification: "NOT_PROBED",
  };
  const port = validatePort(raw);
  // A fixed loopback GET only; no arbitrary hosts, network tools or secrets.
  const tags = await readLimitedResponse("http://127.0.0.1:" + port + "/api/tags", fetchImpl);
  return {
    schema: "phibot.crew.models.v1", connected: true,
    status: "LOCAL_OLLAMA_TAGS_SELF_REPORT",
    models: normalizedModels(tags),
    qualification: "TAGS_PRESENT_INFERENCE_NOT_TESTED",
  };
}

function canonical(botId, current, modelName, mission) {
  return {
    schema: "phibot.crew.assignment-proposal.v1",
    action: "REVIEW_ONLY_NO_EXECUTION",
    botId, current, candidate: { provider: "ollama", name: modelName },
    mission,
  };
}
function findEligible(crew, models, botId, modelName, mission) {
  if (!object(crew) || crew.connected !== true ||
      crew.schema !== "phibot.crew.live.v1" ||
      !Array.isArray(crew.bots) || !object(models) || models.connected !== true ||
      models.schema !== "phibot.crew.models.v1" || !Array.isArray(models.models))
    throw Error("CREW_PLANNER_SOURCES_REQUIRED");
  if (typeof botId !== "string" || !ID.test(botId) ||
      typeof modelName !== "string" || !MODEL.test(modelName) ||
      !MISSIONS.has(mission) || !models.models.includes(modelName))
    throw Error("CREW_PLANNER_SELECTION_DENIED");
  const bot = crew.bots.find(b => b.id === botId);
  if (!bot || bot.state !== "idle" || bot.activeRuns !== 0 ||
      !object(bot.model) || typeof bot.model.provider !== "string" ||
      typeof bot.model.name !== "string" ||
      typeof bot.updatedAt !== "string")
    throw Error("CREW_PLANNER_BOT_NOT_IDLE");
  return bot;
}

export function buildCrewAssignment({ crew, models, botId, modelName, mission }) {
  const bot = findEligible(crew, models, botId, modelName, mission);
  const payload = canonical(botId, {
    provider: bot.model.provider,
    name: bot.model.name, updatedAt: bot.updatedAt,
  }, modelName, mission);
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    ...payload, digest, verification: "INDEPENDENT_RECHECK_REQUIRED",
    limitation: "NO_MODEL_CHANGE_NO_MISSION_DISPATCH_NO_GRANT",
  };
}

/** Independently check schema, exact digest, model list and the live bot revision. */
export function verifyCrewAssignment(plan, crew, models) {
  if (!strictKeys(plan, [
    "schema", "action", "botId", "current", "candidate", "mission", "digest",
    "verification", "limitation",
  ]) || plan.schema !== "phibot.crew.assignment-proposal.v1" ||
      plan.action !== "REVIEW_ONLY_NO_EXECUTION" ||
      plan.verification !== "INDEPENDENT_RECHECK_REQUIRED" ||
      plan.limitation !== "NO_MODEL_CHANGE_NO_MISSION_DISPATCH_NO_GRANT" ||
      !strictKeys(plan.candidate, ["provider", "name"]) ||
      plan.candidate.provider !== "ollama" ||
      !strictKeys(plan.current, ["provider", "name", "updatedAt"]) ||
      typeof plan.digest !== "string" || !/^[a-f0-9]{64}$/.test(plan.digest))
    throw Error("CREW_PLAN_SCHEMA_INVALID");
  const bot = findEligible(crew, models, plan.botId, plan.candidate.name, plan.mission);
  if (plan.current.provider !== bot.model.provider ||
      plan.current.name !== bot.model.name ||
      plan.current.updatedAt !== bot.updatedAt)
    throw Error("CREW_PLAN_STALE_BOT");
  const expected = canonical(plan.botId, plan.current, plan.candidate.name, plan.mission);
  const digest = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  if (plan.digest !== digest) throw Error("CREW_PLAN_DIGEST_MISMATCH");
  return { verified: true, status: "REVIEW_ONLY_RECHECK_PASSED_NO_ACTION" };
}

export function validateCrewPlanInput(input) {
  if (!strictKeys(input, ["botId", "modelName", "mission"]) ||
      typeof input.botId !== "string" || !ID.test(input.botId) ||
      typeof input.modelName !== "string" || !MODEL.test(input.modelName) ||
      !MISSIONS.has(input.mission))
    throw Error("CREW_PLAN_INPUT_INVALID");
  return { botId: input.botId, modelName: input.modelName, mission: input.mission };
}
