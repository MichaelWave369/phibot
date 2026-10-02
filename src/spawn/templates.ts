import type { SpawnTemplate } from "./types.js";

export class SpawnTemplateRegistry {
  private readonly templates = new Map<string, SpawnTemplate>();

  register(template: SpawnTemplate): this {
    const id = template.templateId.trim();
    if (!id) throw new Error("Spawn template ID cannot be empty.");
    if (this.templates.has(id)) {
      throw new Error(`Spawn template already registered: ${id}`);
    }

    const capabilityIds = template.capabilities.map((item) => item.id);
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      throw new Error(`Spawn template has duplicate capabilities: ${id}`);
    }

    this.templates.set(id, structuredClone(template));
    return this;
  }

  get(templateId: string): SpawnTemplate | undefined {
    const template = this.templates.get(templateId);
    return template ? structuredClone(template) : undefined;
  }

  list(): SpawnTemplate[] {
    return [...this.templates.values()]
      .sort((a, b) => a.templateId.localeCompare(b.templateId))
      .map((template) => structuredClone(template));
  }
}

export function createDefaultSpawnTemplates(): SpawnTemplateRegistry {
  return new SpawnTemplateRegistry()
    .register({
      schema: "phibot.spawn.template.v1",
      templateId: "research-scout",
      role: "research_scout",
      description: "Ephemeral specialist for bounded read-only investigation.",
      namePrefix: "Scout",
      model: { provider: "ollama", name: "qwen3:4b" },
      memory: { scope: "task", maxDepth: 4 },
      capabilities: [
        { id: "research.read", actionClass: "read" },
        { id: "repo.read", actionClass: "read" },
      ],
      authorityCeiling: {
        read: true,
        propose: true,
        write: false,
        deploy: false,
      },
      escalationTarget: "vessie",
      confidenceBelow: 0.7,
    })
    .register({
      schema: "phibot.spawn.template.v1",
      templateId: "code-repair",
      role: "code_repair",
      description: "Bounded code-repair specialist with gated writes.",
      namePrefix: "Patch",
      model: { provider: "ollama", name: "qwen3:4b" },
      memory: { scope: "repo", maxDepth: 4 },
      capabilities: [
        { id: "repo.read", actionClass: "read" },
        { id: "repo.patch", actionClass: "write" },
        { id: "tests.run", actionClass: "read" },
      ],
      authorityCeiling: {
        read: true,
        propose: true,
        write: "gated",
        deploy: false,
      },
      escalationTarget: "vessie",
      confidenceBelow: 0.72,
    });
}
