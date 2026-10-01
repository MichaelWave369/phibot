import type { AnyToolCapability, ToolCapability } from "./types.js";

export class ToolCapabilityRegistry {
  private readonly capabilities = new Map<string, AnyToolCapability>();

  register<TInput, TOutput>(
    capability: ToolCapability<TInput, TOutput>,
  ): this {
    const id = capability.id.trim();
    if (!id) throw new Error("Capability id cannot be empty.");
    if (this.capabilities.has(id)) {
      throw new Error(`Capability already registered: ${id}`);
    }

    this.capabilities.set(id, capability as AnyToolCapability);
    return this;
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  get(id: string): AnyToolCapability | undefined {
    return this.capabilities.get(id);
  }

  list(): ReadonlyArray<{
    id: string;
    description: string;
    actionClass: AnyToolCapability["actionClass"];
    external: boolean;
  }> {
    return [...this.capabilities.values()]
      .map(({ id, description, actionClass, external }) => ({
        id,
        description,
        actionClass,
        external,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
