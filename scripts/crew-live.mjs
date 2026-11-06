/**
 * PHIBOT-27: optional, read-only LIVE PhiBot service observer.
 * The service is separately started by the operator. No discovery, spawning,
 * model calls, permissions, Reality Gate grants, or actions are performed here.
 */
const EVENT_TYPES = new Set([
  "service.started", "service.stopped", "bot.registered", "bot.unregistered",
  "bot.state", "bot.spawned", "bot.dissolved", "run.started", "run.finished",
  "budget.blocked", "budget.updated",
]);
const BOT_STATES = new Set(["idle", "running", "disabled", "error"]);
const ID = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_BYTES = 128 * 1024;
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);

function label(value, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new Error("CREW_FIELD_INVALID");
  return value;
}
function timestamp(value) {
  if (typeof value !== "string" || value.length > 40 ||
      !Number.isFinite(Date.parse(value))) throw new Error("CREW_TIMESTAMP_INVALID");
  return value;
}
function botId(value) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error("CREW_ID_INVALID");
  return value;
}

export function projectCrew(botsPayload, eventsPayload) {
  if (!record(botsPayload) || !Array.isArray(botsPayload.bots) ||
      botsPayload.bots.length > 64 || !record(eventsPayload) ||
      !Array.isArray(eventsPayload.events) || eventsPayload.events.length > 50)
    throw new Error("CREW_SOURCE_INVALID");

  const bots = botsPayload.bots.map(item => {
    if (!record(item) || !record(item.manifest) || !record(item.manifest.model) ||
        !BOT_STATES.has(item.state) || !Number.isSafeInteger(item.activeRuns) ||
        item.activeRuns < 0 || item.activeRuns > 100)
      throw new Error("CREW_BOT_INVALID");
    return {
      id: botId(item.manifest.id),
      name: label(item.manifest.name, 100),
      role: label(item.manifest.role, 100),
      model: {
        provider: label(item.manifest.model.provider, 80),
        name: label(item.manifest.model.name, 100),
        verifiedAvailable: false,
      },
      state: item.state, activeRuns: item.activeRuns,
      updatedAt: timestamp(item.updatedAt),
    };
  });
  if (new Set(bots.map(x => x.id)).size !== bots.length)
    throw new Error("CREW_DUPLICATE_BOTS");

  const events = eventsPayload.events.map(item => {
    if (!record(item) || item.schema !== "phibot.service.event.v1" ||
        !EVENT_TYPES.has(item.type))
      throw new Error("CREW_EVENT_INVALID");
    return {
      type: item.type,
      timestamp: timestamp(item.timestamp),
      botId: item.botId === undefined ? null : botId(item.botId),
    };
  });
  return {
    schema: "phibot.crew.live.v1",
    status: "LIVE_SERVICE_SELF_REPORT_NOT_ATTESTED",
    connected: true,
    bots, events,
    authority: "READ_ONLY_NO_ACTIONS",
    modelStatus: "CONFIGURED_NOT_PROBED",
  };
}

async function readJsonBounded(url, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok || !(response.headers.get("content-type") || "")
      .startsWith("application/json"))
    throw new Error("CREW_SERVICE_RESPONSE_INVALID");
  const sizeHeader = Number(response.headers.get("content-length") || 0);
  if (!Number.isFinite(sizeHeader) || sizeHeader > MAX_BYTES)
    throw new Error("CREW_SERVICE_RESPONSE_OVERSIZE");
  if (!response.body) throw new Error("CREW_SERVICE_BODY_MISSING");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("CREW_SERVICE_RESPONSE_OVERSIZE");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function readCrewService({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.PHIBOT_CREW_SERVICE_PORT === undefined ||
      env.PHIBOT_CREW_SERVICE_PORT === "") {
    return {
      schema: "phibot.crew.live.v1", status: "SERVICE_NOT_CONFIGURED",
      connected: false, bots: [], events: [],
      authority: "READ_ONLY_NO_ACTIONS", modelStatus: "NOT_PROBED",
    };
  }
  const port = Number(env.PHIBOT_CREW_SERVICE_PORT);
  if (!/^[0-9]{1,5}$/.test(env.PHIBOT_CREW_SERVICE_PORT) ||
      !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("CREW_SERVICE_PORT_INVALID");

  // Fixed loopback host only. No arbitrary URL, redirects, user credentials,
  // headers from the browser, or non-GET methods.
  const base = "http://127.0.0.1:" + port;
  const [bots, events] = await Promise.all([
    readJsonBounded(base + "/bots", fetchImpl),
    readJsonBounded(base + "/events?limit=24", fetchImpl),
  ]);
  return projectCrew(bots, events);
}
