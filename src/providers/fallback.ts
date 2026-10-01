import type { ProviderCompletion, ProviderRequest, PhiProvider } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FallbackProvider implements PhiProvider {
  readonly id: string;
  readonly model: string;

  constructor(
    private readonly primary: PhiProvider,
    private readonly fallbackProvider: PhiProvider,
  ) {
    this.id = primary.id;
    this.model = primary.model;
  }

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    try {
      return await this.primary.complete(request);
    } catch (error: unknown) {
      const fallback = await this.fallbackProvider.complete(request);
      return {
        ...fallback,
        fallback: true,
        fallbackReason: `${this.primary.id} failed: ${errorMessage(error)}`,
      };
    }
  }
}
