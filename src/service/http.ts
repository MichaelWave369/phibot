import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { requireLocalOllamaTag, validateOllamaPort, verifyModelChange } from "./model-change.js";
import type { PhiBotService } from "./service.js";
import type { PhiBotServiceHttpOptions } from "./types.js";

function json(
  response: import("node:http").ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

export async function startPhiBotHttpServer(
  service: PhiBotService,
  options: PhiBotServiceHttpOptions = {},
): Promise<Server> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 7369;
  const controlToken = options.modelControlToken;
  if (controlToken !== undefined &&
      (!/^[A-Za-z0-9_-]{32,256}$/.test(controlToken) || host !== "127.0.0.1"))
    throw new Error("MODEL_CONTROL_CONFIG_INVALID");
  const ollamaPort = validateOllamaPort(options.ollamaPort ?? 11434);

  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error(
      "PhiBot service HTTP surface is loopback-only in Rung 6.",
    );
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );

      if (request.url === "/crew/model" && request.method === "POST") {
        // This route is never available without opt-in and an independent secret.
        if (!controlToken) {
          json(response, 404, { error: "MODEL_CONTROL_NOT_ENABLED" }); return;
        }
        const address = server.address();
        const listeningPort = typeof address === "object" && address ? address.port : -1;
        if (request.socket.remoteAddress !== "127.0.0.1" ||
            request.headers.host !== "127.0.0.1:" + listeningPort ||
            request.headers.origin !== undefined ||
            request.headers.referer !== undefined ||
            request.headers["content-type"] !== "application/json") {
          json(response, 403, { error: "MODEL_CONTROL_LOCAL_CLI_ONLY" }); return;
        }
        const supplied = request.headers["x-phibot-control-token"];
        const suppliedValue = typeof supplied === "string" ? supplied : "";
        const left = Buffer.from(suppliedValue);
        const right = Buffer.from(controlToken);
        if (left.length !== right.length || !timingSafeEqual(left, right)) {
          json(response, 403, { error: "MODEL_CONTROL_AUTH_DENIED" }); return;
        }
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (Buffer.byteLength(raw, "utf8") > 3000)
            throw new Error("MODEL_CONTROL_BODY_TOO_LARGE");
        }
        const proposal = verifyModelChange(JSON.parse(raw) as unknown);
        await requireLocalOllamaTag(ollamaPort, proposal.candidate.name);
        const receipt = await service.changeBotModel(proposal);
        json(response, 200, receipt);
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        const snapshot = await service.snapshot();
        json(response, 200, {
          ok: snapshot.lifecycle === "running",
          lifecycle: snapshot.lifecycle,
          startedAt: snapshot.startedAt ?? null,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/bots") {
        json(response, 200, {
          bots: (await service.snapshot()).bots,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/events") {
        const limitRaw = url.searchParams.get("limit");
        const limit =
          limitRaw === null ? 100 : Math.max(1, Math.min(500, Number(limitRaw)));
        if (!Number.isFinite(limit)) {
          json(response, 400, { error: "invalid event limit" });
          return;
        }
        json(response, 200, {
          events: service.events.history(Math.floor(limit)),
        });
        return;
      }

      json(response, 404, { error: "not found" });
    } catch (error: unknown) {
      json(response, 422, { error: "MODEL_CONTROL_OR_SERVICE_REFUSED" });
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolvePromise();
    });
  });

  return server;
}
