/**
 * PHIBOT-31: operator-invoked, local-only PhiPots crew template rehearsal.
 *
 * Uses six actual PhiBotRuntime stage lifecycles, but NO reasoning model,
 * tool registry, GitHub client, queue, scheduler or file-backed ledger.
 * The outputs are canned role templates, not accomplished agent work.
 */
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import type { PhiBotAdapter } from "../adapters/dry-run.js";
import { MemoryLedger } from "../core/ledger.js";
import { loadManifest } from "../core/manifest.js";
import { PhiBotRuntime } from "../core/runtime.js";
import type { BotInput, PhiBotManifest, StageResult } from "../core/types.js";

export interface CrewRole {
  id: string;
  name: string;
  deliverable: string;
}

export const PHIPOT_ROLES: readonly CrewRole[] = Object.freeze([
  { id: "idea", name: "IdeaBot", deliverable: "Draft scope, requirements, open questions and acceptance criteria for human review." },
  { id: "builder", name: "BuilderBot", deliverable: "Outline an original, minimal implementation plan; do not edit source." },
  { id: "test", name: "TestBot", deliverable: "Propose tests and enumerate missing CI evidence; do not assert test success." },
  { id: "audit", name: "AuditBot", deliverable: "Challenge scope, dependency trust, permissions and unsupported assumptions." },
  { id: "deploy", name: "DeployBot", deliverable: "Prepare a hypothetical release and rollback checklist; do not publish." },
  { id: "ledger", name: "LedgerBot", deliverable: "Summarize provenance and explicit unverified gates; do not certify outcomes." },
]);

export interface PhiPotsRoleReport {
  role: string;
  name: string;
  classification: "DETERMINISTIC_TEMPLATE_ONLY";
  proposedHandoff: string;
  runtimeStatus: "completed";
  stageCount: number;
  receiptCount: number;
  actionCount: 0;
  runId: string;
}

export interface PhiPotsDryReport {
  schema: "phibot.phipots.local-dry-run.v1";
  classification: "LOCAL_TEMPLATE_NOT_AGENT_EXECUTION";
  ideaSha256: string;
  policy: {
    roles: 6;
    modelCalls: 0;
    toolCalls: 0;
    githubWrites: 0;
    deployments: 0;
    persistentMemoryWrites: 0;
  };
  roles: PhiPotsRoleReport[];
  outcome: "HUMAN_REVIEW_REQUIRED_NO_ACTIONS";
}

function fail(): never {
  // No raw input, credentials or source excerpts in diagnostic codes.
  throw new Error("PHIPOTS_MANIFEST_DENIED");
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.join("|") === [...expected].sort().join("|");
}

/** PhiBot's general manifest validator permits role-specific extensions.
 * This crew boundary deliberately narrows ALL manifest authority to zero.
 */
export function assertPhiPotManifest(manifest: PhiBotManifest, role: CrewRole): void {
  if (!exactKeys(manifest, ["id", "name", "version", "role", "description", "model", "memory", "capabilities", "authority", "escalation"]) ||
      manifest.id !== "phipot-" + role.id ||
      manifest.name !== role.name ||
      manifest.role !== "phipots_" + role.id ||
      manifest.version !== "0.1.0" ||
      !exactKeys(manifest.model, ["provider", "name"]) ||
      manifest.model.provider !== "dry-run" ||
      manifest.model.name !== "deterministic" ||
      !exactKeys(manifest.memory, ["scope", "maxDepth"]) ||
      manifest.memory.scope !== "task" ||
      manifest.memory.maxDepth !== 0 ||
      !Array.isArray(manifest.capabilities) ||
      manifest.capabilities.length !== 0 ||
      !exactKeys(manifest.authority, ["read", "propose", "write", "deploy"]) ||
      manifest.authority.read !== false ||
      manifest.authority.propose !== false ||
      manifest.authority.write !== false ||
      manifest.authority.deploy !== false ||
      !exactKeys(manifest.escalation, ["target", "confidenceBelow"]) ||
      manifest.escalation.target !== "human" ||
      manifest.escalation.confidenceBelow !== 0.75) fail();
}

class CrewTemplateAdapter implements PhiBotAdapter {
  constructor(
    private readonly role: CrewRole,
    private readonly digestPrefix: string,
  ) {}

  async observe(_manifest: PhiBotManifest, _input: BotInput): Promise<StageResult> {
    return {
      stage: "observe",
      summary: "Local idea digest " + this.digestPrefix + " accepted for TEMPLATE rehearsal only.",
      confidence: 0.92,
    };
  }

  async interpret(): Promise<StageResult> {
    return {
      stage: "interpret",
      summary: "Role " + this.role.name + " selected; no sources, tools or models consulted.",
      confidence: 0.92,
    };
  }

  async propose(): Promise<StageResult> {
    return {
      stage: "propose",
      summary: "TEMPLATE ONLY: " + this.role.deliverable,
      confidence: 0.92,
      // Deliberately no action or capability, even a harmless-looking one.
    };
  }

  async verify(): Promise<StageResult> {
    return {
      stage: "verify",
      summary: "Checked template-stage shape only. No task, code, CI or security result verified.",
      confidence: 0.92,
    };
  }
}

export async function runPhiPotsDryRun(
  idea: string,
  rootDir: string = process.cwd(),
): Promise<PhiPotsDryReport> {
  if (typeof idea !== "string") throw new Error("PHIPOTS_IDEA_INVALID");
  const normalized = idea.trim();
  if (normalized.length < 8 || normalized.length > 400 ||
      /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new Error("PHIPOTS_IDEA_INVALID");
  }
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  const roles: PhiPotsRoleReport[] = [];

  // Load and validate every role BEFORE starting the first runtime.
  const manifests: PhiBotManifest[] = [];
  for (const role of PHIPOT_ROLES) {
    const file = join(resolve(rootDir), "bots", "phipots", role.id + ".phibot.json");
    const manifest = await loadManifest(file);
    assertPhiPotManifest(manifest, role);
    manifests.push(manifest);
  }

  for (let index = 0; index < PHIPOT_ROLES.length; index++) {
    const role = PHIPOT_ROLES[index];
    const manifest = manifests[index];
    if (!role || !manifest) throw new Error("PHIPOTS_ROLE_INVARIANT_FAILED");

    const ledger = new MemoryLedger();
    const runtime = new PhiBotRuntime(
      manifest, new CrewTemplateAdapter(role, digest.slice(0, 12)), ledger,
    );
    // Neither the idea nor any raw source content enters the stage receipt.
    // This text is only a local digest-bound stand-in for a real handoff.
    const run = await runtime.run({ task: "local template rehearsal " + digest });
    if (run.status !== "completed" ||
        run.stages.length !== 4 ||
        run.receipts.length !== 5 ||
        ledger.receipts.length !== 5 ||
        run.stages.some(stage => stage.action !== undefined) ||
        run.receipts.some(receipt => receipt.status !== "ok")) {
      throw new Error("PHIPOTS_RUNTIME_INVARIANT_FAILED");
    }
    roles.push({
      role: role.id,
      name: role.name,
      classification: "DETERMINISTIC_TEMPLATE_ONLY",
      proposedHandoff: role.deliverable,
      runtimeStatus: "completed",
      stageCount: run.stages.length,
      receiptCount: run.receipts.length,
      actionCount: 0,
      runId: run.runId,
    });
  }

  if (roles.length !== 6) throw new Error("PHIPOTS_ROLE_INVARIANT_FAILED");
  return {
    schema: "phibot.phipots.local-dry-run.v1",
    classification: "LOCAL_TEMPLATE_NOT_AGENT_EXECUTION",
    ideaSha256: digest,
    policy: {
      roles: 6,
      modelCalls: 0,
      toolCalls: 0,
      githubWrites: 0,
      deployments: 0,
      persistentMemoryWrites: 0,
    },
    roles,
    outcome: "HUMAN_REVIEW_REQUIRED_NO_ACTIONS",
  };
}
