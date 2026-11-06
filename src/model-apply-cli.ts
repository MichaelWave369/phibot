#!/usr/bin/env node
/**
 * PHIBOT-35: manual terminal-only consent for a single model-only change.
 * The service independently revalidates the exact proposal and Ollama tag.
 * Does not issue Reality Gate grants, run inference, or dispatch missions.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { buildModelChange, verifyModelChange } from "./service/model-change.js";
import type { RegisteredBot } from "./service/types.js";

interface Params { bot: string; model: string; port: number }
function parseArgs(argv: string[]): Params {
  const flags: Record<string, string> = {};
  if (argv.length !== 4 && argv.length !== 6)
    throw new Error("Usage: npm run model:apply -- --bot <id> --model <local-tag> [--port 7369]");
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], val = argv[i + 1];
    if (!flag || !val || !["--bot", "--model", "--port"].includes(flag) ||
        flags[flag] !== undefined)
      throw new Error("MODEL_APPLY_ARGUMENTS_INVALID");
    flags[flag] = val;
  }
  const bot = flags["--bot"], model = flags["--model"];
  if (!bot || !model || !/^[A-Za-z0-9_.-]{1,80}$/.test(bot) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,99}$/.test(model))
    throw new Error("MODEL_APPLY_ARGUMENTS_INVALID");
  const portRaw = flags["--port"] ?? "7369";
  if (!/^[0-9]{1,5}$/.test(portRaw) || Number(portRaw) < 1 ||
      Number(portRaw) > 65535) throw new Error("MODEL_APPLY_PORT_INVALID");
  return { bot, model, port: Number(portRaw) };
}
async function limitedBots(url: string): Promise<RegisteredBot[]> {
  const response = await fetch(url, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(2500),
  });
  if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("application/json"))
    throw new Error("MODEL_APPLY_SERVICE_UNAVAILABLE");
  if (!response.body) throw new Error("MODEL_APPLY_SERVICE_EMPTY");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128 * 1024) throw new Error("MODEL_APPLY_RESPONSE_OVERSIZE");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || !("bots" in parsed) ||
      !Array.isArray(parsed.bots) || parsed.bots.length > 64)
    throw new Error("MODEL_APPLY_BOTS_INVALID");
  return parsed.bots as RegisteredBot[];
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { bot, model, port } = parseArgs(argv);
  const token = process.env.PHIBOT_CREW_CONTROL_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw new Error("MODEL_APPLY_CONTROL_TOKEN_REQUIRED");
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error("MODEL_APPLY_INTERACTIVE_TTY_REQUIRED");

  const base = "http://127.0.0.1:" + port;
  const bots = await limitedBots(base + "/bots");
  const selected = bots.find(entry => entry?.manifest?.id === bot);
  if (!selected) throw new Error("MODEL_APPLY_BOT_NOT_FOUND");
  const proposal = verifyModelChange(buildModelChange(selected, model));
  const approval = "APPROVE " + proposal.digest.slice(0, 16);

  stdout.write([
    "",
    "PHIBOT-35 · MANUAL MODEL CONFIGURATION",
    "Bot: " + bot,
    "Previous: " + proposal.current.provider + " / " + proposal.current.name,
    "Candidate: " + proposal.candidate.provider + " / " + proposal.candidate.name,
    "Revision: " + proposal.current.updatedAt,
    "SHA-256 proposal: " + proposal.digest,
    "Scope: ONLY manifest.model. Authority, capabilities, identity, role and memory unchanged.",
    "Model inference readiness: NOT TESTED",
    "Mission execution / Reality Gate approval: NONE",
    "",
  ].join("\n") + "\n");

  const io = createInterface({ input: stdin, output: stdout });
  let answer = "";
  try { answer = await io.question("Type " + approval + " to apply: "); }
  finally { io.close(); }
  if (answer !== approval) throw new Error("MODEL_APPLY_OPERATOR_DECLINED");

  const response = await fetch(base + "/crew/model", {
    method: "POST", redirect: "error", cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-phibot-control-token": token,
    },
    body: JSON.stringify(proposal),
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error("MODEL_APPLY_REFUSED_OR_STALE_" + response.status);
  const result = await response.json() as Record<string, unknown>;
  if (result.status !== "MODEL_CHANGED_NO_INFERENCE" ||
      result.botId !== bot || result.digest !== proposal.digest)
    throw new Error("MODEL_APPLY_RECEIPT_MISMATCH");
  stdout.write("MODEL_CHANGED_NO_INFERENCE: " + bot + " now configured to " +
    proposal.candidate.name + ". Check the local ledger for the receipt.\n");
}
main().catch(error => {
  process.stderr.write("PhiBot model change refused: " +
    (error instanceof Error ? error.message : "unknown") + "\n");
  process.exitCode = 1;
});
