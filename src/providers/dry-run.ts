import type { ProviderCompletion, ProviderRequest, PhiProvider } from "./types.js";

export class DryRunProvider implements PhiProvider {
  readonly id = "dry-run";

  constructor(readonly model = "deterministic") {}

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const { manifest, input, stage, prior } = request;
    const proposal = prior.find((item) => item.stage === "propose");
    const capability = manifest.capabilities[0];

    let payload: Record<string, unknown>;

    switch (stage) {
      case "observe":
        payload = {
          summary: `${manifest.name} received task: ${input.task}`,
          confidence: 0.95,
        };
        break;
      case "interpret":
        payload = {
          summary: `Role ${manifest.role} mapped task to declared capabilities.`,
          confidence: 0.9,
        };
        break;
      case "propose":
        payload = capability
          ? {
              summary: `Proposed bounded use of ${capability} for: ${input.task}`,
              confidence: 0.84,
              action: {
                capability,
                external: false,
                description: `Dry-run proposal using ${capability}`,
              },
            }
          : {
              summary: "No capability available; propose escalation.",
              confidence: 0.2,
            };
        break;
      case "verify":
        payload = proposal?.action
          ? {
              summary: `Verified proposal remains inside ${manifest.name}'s declared capability boundary.`,
              confidence: 0.88,
              action: proposal.action,
            }
          : {
              summary: "No actionable proposal was produced.",
              confidence: 0.35,
            };
        break;
    }

    return {
      provider: this.id,
      model: this.model,
      content: JSON.stringify(payload),
      fallback: false,
      metrics: {
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };
  }
}
