import type { BotInput, PhiBotManifest, StageResult } from "../core/types.js";

export interface PhiBotAdapter {
  observe(manifest: PhiBotManifest, input: BotInput): Promise<StageResult>;
  interpret(
    manifest: PhiBotManifest,
    input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult>;
  propose(
    manifest: PhiBotManifest,
    input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult>;
  verify(
    manifest: PhiBotManifest,
    input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult>;
}

export class DryRunAdapter implements PhiBotAdapter {
  async observe(manifest: PhiBotManifest, input: BotInput): Promise<StageResult> {
    return {
      stage: "observe",
      summary: `${manifest.name} received task: ${input.task}`,
      confidence: 0.95,
    };
  }

  async interpret(manifest: PhiBotManifest): Promise<StageResult> {
    return {
      stage: "interpret",
      summary: `Role ${manifest.role} mapped task to declared capabilities.`,
      confidence: 0.9,
    };
  }

  async propose(manifest: PhiBotManifest, input: BotInput): Promise<StageResult> {
    const capability = manifest.capabilities[0];
    return {
      stage: "propose",
      summary: capability
        ? `Proposed bounded use of ${capability} for: ${input.task}`
        : "No capability available; propose escalation.",
      confidence: capability ? 0.84 : 0.2,
      ...(capability
        ? {
            action: {
              capability,
              external: false,
              description: `Dry-run proposal using ${capability}`,
            },
          }
        : {}),
    };
  }

  async verify(
    manifest: PhiBotManifest,
    _input: BotInput,
    prior: StageResult[],
  ): Promise<StageResult> {
    const proposed = prior.find((stage) => stage.stage === "propose");
    return {
      stage: "verify",
      summary: proposed?.action
        ? `Verified proposal remains inside ${manifest.name}'s declared capability boundary.`
        : "No actionable proposal was produced.",
      confidence: proposed?.action ? 0.88 : 0.35,
      ...(proposed?.action ? { action: proposed.action } : {}),
    };
  }
}
