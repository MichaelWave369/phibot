#!/usr/bin/env node
/**
 * PHIBOT-26: localhost-only, explicitly operator-triggered queue console.
 * Only invokes PHIBOT-25's two allowlisted READ capabilities. There is no
 * scheduler, model call, GitHub mutation, gate approval, or shell execution.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { open, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  QUEUE_HOME, enqueue, inspectQueue, queueBudget, queuePolicy, runQueue,
} from "./work-queue.mjs";

const LOOPBACK = "127.0.0.1";
const PORT = 43969;
const EVENT_KINDS = new Set([
  "ENQUEUED", "LEASED", "OBSERVED", "STALE_LEASE_RECOVERED",
  "ATTEMPTS_EXHAUSTED", "RETRY_QUEUED",
]);
const HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const isRecord = v => v !== null && typeof v === "object" && !Array.isArray(v);

function json(res, status, data) {
  res.writeHead(status, { ...HEADERS, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data) + "\n");
}
function fixedError(res, status, code) {
  json(res, status, { status: "REFUSED", code });
}
function validTimestamp(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s)) ? s : null;
}
async function lastEvents(dir) {
  const file = join(dir, "events.ndjson");
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    const take = Math.min(size, 128 * 1024);
    const bytes = Buffer.alloc(take);
    await handle.read(bytes, 0, take, size - take);
    const lines = bytes.toString("utf8").split("\n");
    if (size > take) lines.shift();
    return lines.slice(-250).flatMap(line => {
      if (!line || line.length > 4000) return [];
      try {
        const raw = JSON.parse(line);
        if (!isRecord(raw) || raw.schema !== "phibot.queue.event.v1" ||
            !EVENT_KINDS.has(raw.event) ||
            typeof raw.id !== "string" || !/^[a-f0-9]{64}$/.test(raw.id)) return [];
        return [{ event: raw.event, id: raw.id.slice(0, 12),
          at: validTimestamp(raw.timestamp),
          attempts: Number.isInteger(raw.attempts) && raw.attempts >= 0
            ? Math.min(raw.attempts, 2) : null }];
      } catch { return []; }
    }).slice(-32).reverse();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  } finally { await handle?.close(); }
}
async function workerStatus(dir) {
  const file = join(dir, "worker.lock");
  try {
    if ((await stat(file)).size > 1024)
      return { state: "UNKNOWN_LOCK", expiry: null };
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return { state: "LOCK_PRESENT", expiry:
      Number.isFinite(parsed?.expiresMs) ? new Date(parsed.expiresMs).toISOString() : null };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "NO_LOCK", expiry: null };
    return { state: "UNKNOWN_LOCK", expiry: null };
  }
}
async function readBody(req) {
  const type = req.headers["content-type"];
  if (type !== "application/json") throw new Error("INVALID_CONTENT_TYPE");
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data, "utf8") > 3000)
      throw new Error("BODY_TOO_LARGE");
  }
  let parsed;
  try { parsed = JSON.parse(data); }
  catch { throw new Error("INVALID_JSON"); }
  if (!isRecord(parsed)) throw new Error("INVALID_BODY");
  return parsed;
}
function requestAllowed(req, expectedHost) {
  // Prevent both remote use and DNS rebinding. Bind only to 127.0.0.1.
  return req.headers.host === expectedHost &&
    req.socket.remoteAddress === LOOPBACK;
}
function authorizePost(req, origin, token) {
  const source = req.headers.origin;
  return source === origin &&
    req.headers["x-phibot-session"] === token &&
    (req.headers["sec-fetch-site"] === undefined ||
      req.headers["sec-fetch-site"] === "same-origin");
}
function makeReadOnlyExecutor(dir) {
  return async request => {
    const { createBuiltinToolRegistry } = await import("../dist/src/tools/builtins.js");
    const { ToolExecutor } = await import("../dist/src/tools/executor.js");
    const { FileLedger } = await import("../dist/src/core/ledger.js");
    const { validateManifest } = await import("../dist/src/core/manifest.js");
    const manifest = validateManifest({
      id: "queue-dashboard-scout", name: "Queue Dashboard Scout", version: "0.1.0",
      role: "manual_read_only_queue_dashboard",
      description: "Operator-requested GitHub read-only observations",
      model: { provider: "dry-run", name: "deterministic" },
      memory: { scope: "task", maxDepth: 1 },
      capabilities: ["repo.steward.discover", "repo.steward.inspect"],
      authority: { read: true, propose: false, write: false, deploy: false },
      escalation: { target: "human", confidenceBelow: 0.9 },
    });
    const executor = new ToolExecutor(createBuiltinToolRegistry(),
      new FileLedger(join(dir, "tool-receipts.ndjson")),
      { timeoutMs: 30000 });
    return executor.execute(manifest, request);
  };
}

const assets = new Map([
  ["/", ["text/html; charset=utf-8", "queue-dashboard/index.html"]],
  ["/app.js", ["text/javascript; charset=utf-8", "queue-dashboard/app.js"]],
  ["/style.css", ["text/css; charset=utf-8", "queue-dashboard/style.css"]],
]);

export async function startQueueDashboard({
  env = process.env, dir = QUEUE_HOME, port,
  actionsEnabled = env.PHIBOT_QUEUE_DASHBOARD_ACTIONS === "1",
  execute,
} = {}) {
  const policy = queuePolicy(env);
  const budget = queueBudget(env);
  const requestedPort = port ?? (env.PHIBOT_QUEUE_DASHBOARD_PORT === undefined
    ? PORT : Number(env.PHIBOT_QUEUE_DASHBOARD_PORT));
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)
    throw new Error("DASHBOARD_PORT_INVALID");
  let busy = false;
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (req, res) => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : requestedPort;
    const origin = "http://" + LOOPBACK + ":" + actualPort;
    const host = LOOPBACK + ":" + actualPort;
    if (!requestAllowed(req, host)) return fixedError(res, 403, "LOCAL_HOST_ONLY");
    const url = req.url;
    if (!url || url.length > 120 || url.includes("?") || url.includes("#"))
      return fixedError(res, 404, "ROUTE_NOT_FOUND");
    if (req.method === "GET") {
      if (url === "/api/session")
        return json(res, 200, { actionsEnabled, token: actionsEnabled ? token : null,
          mode: "LOCAL_OPERATOR_SESSION" });
      if (url === "/api/state") {
        try {
          const inventory = await inspectQueue(policy, dir);
          const [worker, events] = await Promise.all([workerStatus(dir), lastEvents(dir)]);
          return json(res, 200, { ...inventory,
            worker, events, budget, busy, allowlist: policy.repos,
            mode: "READ_ONLY_TOOL_CATALOG", actionsEnabled });
        } catch {
          return fixedError(res, 422, "QUEUE_STATE_UNAVAILABLE");
        }
      }
      const asset = assets.get(url);
      if (asset) {
        try {
          const file = new URL("./" + asset[1], import.meta.url);
          const body = await readFile(file);
          res.writeHead(200, { ...HEADERS, "content-type": asset[0] });
          return res.end(body);
        } catch { return fixedError(res, 500, "DASHBOARD_ASSET_UNAVAILABLE"); }
      }
      return fixedError(res, 404, "ROUTE_NOT_FOUND");
    }
    if (req.method !== "POST" ||
        !["/api/enqueue", "/api/run-once"].includes(url))
      return fixedError(res, 405, "METHOD_NOT_ALLOWED");
    if (!actionsEnabled) return fixedError(res, 403, "ACTIONS_DISABLED_BY_DEFAULT");
    if (!authorizePost(req, origin, token))
      return fixedError(res, 403, "SESSION_OR_ORIGIN_DENIED");
    if (busy) return fixedError(res, 409, "OPERATION_ALREADY_RUNNING");
    busy = true;
    try {
      const input = await readBody(req);
      if (url === "/api/run-once") {
        if (Object.keys(input).length !== 0)
          return fixedError(res, 400, "RUN_EXPECTS_EMPTY_INPUT");
        const result = await runQueue({
          policy, dir, budget, execute: execute ?? makeReadOnlyExecutor(dir),
        });
        return json(res, 200, result);
      }
      if (Object.keys(input).sort().join(",") !== "capability,input")
        return fixedError(res, 400, "ENQUEUE_EXPECTS_EXACT_INPUT");
      const result = await enqueue({
        capability: input.capability, input: input.input,
      }, policy, dir);
      return json(res, 200, result);
    } catch {
      return fixedError(res, 422, "ACTION_REFUSED_CHECK_POLICY_OR_QUEUE");
    } finally { busy = false; }
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(requestedPort, LOOPBACK, () => {
      server.off("error", fail); ok();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("DASHBOARD_LISTEN_FAILED");
  return {
    server,
    url: "http://" + LOOPBACK + ":" + address.port + "/",
    actionsEnabled,
    close: () => new Promise((ok, fail) => server.close(error => error ? fail(error) : ok())),
  };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length) throw new Error("Usage: npm run queue:dashboard (no arguments)");
  const started = await startQueueDashboard();
  process.stdout.write(JSON.stringify({
    dashboard: started.url, actionsEnabled: started.actionsEnabled,
    policy: "LOCALHOST_ONLY_NO_AUTONOMY",
  }, null, 2) + "\n");
  const shutdown = async () => { await started.close(); };
  process.once("SIGINT", () => { shutdown().catch(() => { process.exitCode = 1; }); });
  process.once("SIGTERM", () => { shutdown().catch(() => { process.exitCode = 1; }); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write("Queue dashboard refused: " +
      (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  });
}
