#!/usr/bin/env node
/**
 * PHIBOT-36: operator-triggered, bounded Ollama inference qualification.
 * Does not modify a bot, grant privileges or dispatch any missions.
 */
import {
  runCrewReadiness, readCrewReadiness, validateCrewProbeInput,
} from "./qualification/crew-readiness.js";

function parse(argv: string[]): {
  command: "probe" | "list";
  model?: string;
  port: number;
  timeoutMs: number;
} {
  const command = argv[0];
  if (command !== "probe" && command !== "list")
    throw new Error("Usage: model:qualify -- --model <tag> [--port 11434] [--timeout-ms 90000] | model:status");
  const args: Record<string, string> = {};
  const rest = argv.slice(1);
  if (rest.length % 2 !== 0) throw new Error("CREW_PROBE_ARGS_INVALID");
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (key === undefined || value === undefined ||
        !["--model", "--port", "--timeout-ms"].includes(key) ||
        args[key] !== undefined)
      throw new Error("CREW_PROBE_ARGS_INVALID");
    args[key] = value;
  }
  const model = args["--model"];
  if (command === "list") {
    if (rest.length !== 0) throw new Error("CREW_PROBE_LIST_TAKES_NO_ARGS");
    return { command, port: 11434, timeoutMs: 90000 };
  }
  if (model === undefined) throw new Error("CREW_PROBE_MODEL_REQUIRED");
  const rawPort = args["--port"] ?? "11434";
  const rawTimeout = args["--timeout-ms"] ?? "90000";
  if (!/^[0-9]{1,5}$/.test(rawPort) || !/^[0-9]{4,6}$/.test(rawTimeout))
    throw new Error("CREW_PROBE_NUMBER_INVALID");
  const port = Number(rawPort), timeoutMs = Number(rawTimeout);
  validateCrewProbeInput(model, port, timeoutMs);
  return { command, model, port, timeoutMs };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parse(argv);
  if (args.command === "list") {
    const view = await readCrewReadiness();
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  const model = args.model;
  if (model === undefined) throw new Error("CREW_PROBE_MODEL_REQUIRED");
  console.log("PHIBOT-36: Explicit local Ollama provider probe. No bot or tool actions.");
  const { record, path } = await runCrewReadiness({
    model, port: args.port, timeoutMs: args.timeoutMs,
  });
  console.log(JSON.stringify({
    status: record.status, model: record.model,
    checkedAt: record.checkedAt, checks: record.checks,
    inferenceLatencyMs: record.inferenceLatencyMs,
    inferenceAttempts: record.inferenceAttempts,
    digest: record.digest, receiptPath: path,
    classification: record.source,
    authority: "NO_MISSION_DISPATCH_NO_GRANTS",
  }, null, 2));
  if (record.status !== "PASS") process.exitCode = 2;
}

main().catch(error => {
  console.error("PhiBot readiness refused: " +
    (error instanceof Error ? error.message : "unknown failure"));
  process.exitCode = 1;
});
