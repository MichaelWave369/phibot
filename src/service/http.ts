import { createServer, type Server } from "node:http";
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
      json(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
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
