#!/usr/bin/env node
import { loadManifest } from "./core/manifest.js";
import { startPhiBotHttpServer } from "./service/http.js";
import { PhiBotService } from "./service/service.js";

interface Args {
  stateDir?: string;
  host?: string;
  port?: number;
  manifests: string[];
  replaceExistingManifests?: boolean;
}

function requireValue(
  argv: string[],
  index: number,
  flag: string,
): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { manifests: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--state-dir") {
      args.stateDir = requireValue(argv, ++index, "--state-dir");
    } else if (value === "--host") {
      args.host = requireValue(argv, ++index, "--host");
    } else if (value === "--port") {
      const raw = requireValue(argv, ++index, "--port");
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Service port must be an integer from 1 to 65535.");
      }
      args.port = port;
    } else if (value === "--manifest") {
      args.manifests.push(requireValue(argv, ++index, "--manifest"));
    } else if (value === "--replace-existing-manifests") {
      args.replaceExistingManifests = true;
    } else if (value !== undefined) {
      throw new Error(`Unknown service argument: ${value}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const service = new PhiBotService({
    ...(args.stateDir === undefined ? {} : { stateDir: args.stateDir }),
  });

  await service.start();

  // Existing registered manifests remain authoritative by default, including
  // manually reviewed model selections. Replacing one is a separate explicit action.
  for (const path of args.manifests) {
    const manifest = await loadManifest(path);
    const existing = await service.registry.get(manifest.id);
    if (!existing || args.replaceExistingManifests)
      await service.registerBot(manifest, !!existing);
  }

  const controlEnabled = process.env.PHIBOT_CREW_MODEL_CONTROL === "1";
  const controlToken = process.env.PHIBOT_CREW_CONTROL_TOKEN;
  if (controlEnabled && (!controlToken ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(controlToken)))
    throw new Error("MODEL_CONTROL_TOKEN_REQUIRED");
  if (controlEnabled && args.host !== undefined && args.host !== "127.0.0.1")
    throw new Error("MODEL_CONTROL_REQUIRES_IPV4_LOOPBACK");
  const ollamaPortRaw = process.env.PHIBOT_CREW_OLLAMA_PORT ?? "11434";
  if (controlEnabled && (!/^[0-9]{1,5}$/.test(ollamaPortRaw) ||
      Number(ollamaPortRaw) < 1 || Number(ollamaPortRaw) > 65535))
    throw new Error("MODEL_CONTROL_OLLAMA_PORT_INVALID");

  const server = await startPhiBotHttpServer(service, {
    ...(args.host === undefined ? {} : { host: args.host }),
    ...(args.port === undefined ? {} : { port: args.port }),
    ...(controlEnabled ? { modelControlToken: controlToken,
      ollamaPort: Number(ollamaPortRaw) } : {}),
  });

  const address = server.address();
  console.log(
    JSON.stringify(
      {
        service: "phibot",
        state: "running",
        address,
        stateDir: service.stateDir,
        bots: (await service.snapshot()).bots.map((bot) => bot.manifest.id),
      },
      null,
      2,
    ),
  );

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolvePromise) =>
      server.close(() => resolvePromise()),
    );
    await service.stop();
  };

  process.once("SIGINT", () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
  });

  process.once("SIGTERM", () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
