import type { AnyToolCapability, ToolExecutionContext } from "./types.js";

export interface ToolSandboxOptions {
  timeoutMs?: number;
}

function cloneInput(value: unknown): unknown {
  return structuredClone(value);
}

export class ToolSandbox {
  private readonly timeoutMs: number;

  constructor(options: ToolSandboxOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async run(
    capability: AnyToolCapability,
    context: Omit<ToolExecutionContext, "signal">,
    input: unknown,
  ): Promise<{ output: unknown; durationMs: number }> {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `Tool execution timed out after ${this.timeoutMs}ms: ${capability.id}`,
          ),
        );
        controller.abort();
      }, this.timeoutMs);
    });

    try {
      const validated = capability.validate(cloneInput(input));
      const execution = capability.execute(validated, {
        ...context,
        signal: controller.signal,
      });
      const output = await Promise.race([execution, timeout]);
      return {
        output,
        durationMs: Date.now() - started,
      };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}
