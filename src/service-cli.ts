#!/usr/bin/env node
import { loadManifest } from "./core/manifest.js";
import { startPhiBotHttpServer } from "./service/http.js";
import { PhiBotService } from "./service/service.js";

interface Args {
  stateDir?: string;
  host?: string;
  port?: number;
  manifests: string[];
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

  for (const path of args.manifests) {
    await service.registerBot(await loadManifest(path), true);
  }

  const server = await startPhiBotHttpServer(service, {
    ...(args.host === undefined ? {} : { host: args.host }),
    ...(args.port === undefined ? {} : { port: args.port }),
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
