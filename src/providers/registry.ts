import { DryRunProvider } from "./dry-run.js";
import { FallbackProvider } from "./fallback.js";
import { OllamaProvider, type OllamaProviderOptions } from "./ollama.js";
import type { PhiProvider, ProviderFactory } from "./types.js";

export interface ProviderResolutionOptions {
  fallbackProvider?: string;
  fallbackModel?: string;
}

export interface DefaultProviderRegistryOptions extends OllamaProviderOptions {}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  register(id: string, factory: ProviderFactory): this {
    const normalized = id.trim().toLowerCase();
    if (!normalized) throw new Error("Provider id cannot be empty.");
    if (this.factories.has(normalized)) {
      throw new Error(`Provider already registered: ${normalized}`);
    }
    this.factories.set(normalized, factory);
    return this;
  }

  has(id: string): boolean {
    return this.factories.has(id.trim().toLowerCase());
  }

  create(
    providerId: string,
    model: string,
    options: ProviderResolutionOptions = {},
  ): PhiProvider {
    const normalized = providerId.trim().toLowerCase();
    const factory = this.factories.get(normalized);
    if (!factory) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const primary = factory(model);
    const fallbackId = options.fallbackProvider?.trim().toLowerCase();

    if (!fallbackId || fallbackId === normalized) return primary;

    const fallbackFactory = this.factories.get(fallbackId);
    if (!fallbackFactory) {
      throw new Error(`Unknown fallback provider: ${options.fallbackProvider}`);
    }

    const fallback = fallbackFactory(options.fallbackModel ?? "deterministic");
    return new FallbackProvider(primary, fallback);
  }
}

export function createDefaultProviderRegistry(
  options: DefaultProviderRegistryOptions = {},
): ProviderRegistry {
  return new ProviderRegistry()
    .register("dry-run", (model) => new DryRunProvider(model))
    .register(
      "ollama",
      (model) =>
        new OllamaProvider(model, {
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        }),
    );
}
