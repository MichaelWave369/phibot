#!/usr/bin/env node
/**
 * PHIBOT-24: durable local, immutable proposal handoff to the governed
 * source repair tool. This script never sends a GitHub write request.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateRepairInput } from "../dist/src/tools/repo-steward-repair-gated.js";
import { repairOne, parseRepairModels } from "./repo-steward-repair.mjs";
import { githubClient, receipt } from "./repo-steward.mjs";
import { parseVerificationPolicy } from "./repo-steward-verify.mjs";

const DEFAULT_DIR = resolve(".phibot", "repo-steward", "handoffs");
const sha256 = value => createHash("sha256").update(value).digest("hex");

function storageName(proposal) {
  return sha256(proposal.repository + "\n" + proposal.prNumber + "\n" +
    proposal.expectedHeadSha) + ".json";
}

function validPolicy(policy) {
  if (!policy || typeof policy.owner !== "string" || !Array.isArray(policy.repos) ||
      policy.repos.some(item => typeof item !== "string"))
    throw new Error("Handoff requires a validated explicit owner and repository allowlist");
  return new Set(policy.repos);
}

export async function storeHandoff({ proposal, review, policy }, dir = DEFAULT_DIR) {
  if (!review || review.risk !== "LOW" ||
      typeof review.reason !== "string" || review.reason.length < 12)
    throw new Error("Handoff refused: no explicit LOW-risk SkepticBot review");
  const candidate = validateRepairInput(proposal, policy.owner, validPolicy(policy));
  const file = resolve(dir, storageName(candidate));
  const body = JSON.stringify(candidate, null, 2) + "\n";
  const digest = sha256(body);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    // Exclusive create: never overwrite a candidate for the same PR/head SHA.
    await writeFile(file, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST")
      return { status: "HANDOFF_ALREADY_EXISTS_NO_OVERWRITE",
        repository: candidate.repository, pr: candidate.prNumber,
        oldHeadSha: candidate.expectedHeadSha, file };
    throw error;
  }
  // Read it back so the receipt describes the bytes persisted to disk.
  const saved = await readFile(file, "utf8");
  if (sha256(saved) !== digest) throw new Error("Stored handoff digest mismatch");
  await receipt({ status: "GOVERNED_REPAIR_HANDOFF_QUEUED", repo: candidate.repository,
    pr: candidate.prNumber, issue: candidate.issueNumber, headSha: candidate.expectedHeadSha,
    target: candidate.target, proposalDigest: digest, risk: review.risk });
  return { status: "QUEUED_FOR_HUMAN_GATE_REVIEW", repository: candidate.repository,
    pr: candidate.prNumber, target: candidate.target, oldHeadSha: candidate.expectedHeadSha,
    file, proposalDigest: digest, review: review.reason };
}

export async function listHandoffs(policy, dir = DEFAULT_DIR) {
  const allowed = validPolicy(policy);
  let files;
  try {
    files = (await readdir(dir)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "EMPTY", handoffs: [] };
    throw error;
  }
  if (files.length > 1000) throw new Error("Handoff directory has too many files to inspect safely");
  const handoffs = [];
  for (const name of files.sort()) {
    const path = join(dir, name);
    try {
      const body = await readFile(path, "utf8");
      if (Buffer.byteLength(body, "utf8") > 15000) throw new Error("oversize");
      const parsed = validateRepairInput(JSON.parse(body), policy.owner, allowed);
      if (storageName(parsed) !== name) throw new Error("identity mismatch");
      handoffs.push({ status: "AWAITING_HUMAN_REVIEW", repository: parsed.repository,
        pr: parsed.prNumber, target: parsed.target, headSha: parsed.expectedHeadSha,
        digest: sha256(body), file: path });
    } catch {
      handoffs.push({ status: "INVALID_LOCAL_HANDOFF", file: path });
    }
  }
  return { status: "LOCAL_INVENTORY_ONLY", handoffs };
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "list";
  if (!["list", "prepare"].includes(command) || argv.length !== 1)
    throw new Error("Usage: repo-steward-handoff.mjs [prepare|list]");
  if (command === "list") {
    const policy = { owner: process.env.PHIBOT_OWNER || "MichaelWave369",
      repos: (process.env.PHIBOT_REPO_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean) };
    const output = await listHandoffs(policy);
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return output;
  }
  const policy = parseVerificationPolicy();
  parseRepairModels();
  const output = await repairOne(githubClient(policy.token), policy, { handoff: storeHandoff });
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write("PhiBot handoff refused: " +
      (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
  });
}
