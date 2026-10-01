import type { AuthorityClass, LedgerReceipt, PhiBotManifest } from "../core/types.js";

export interface ToolExecutionContext {
  botId: string;
  runId: string;
  signal: AbortSignal;
}

export interface ToolCapability<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  actionClass: AuthorityClass;
  external: boolean;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolExecutionRequest {
  capability: string;
  input: unknown;
}

export interface ToolExecutionResult<TOutput = unknown> {
  status: "executed" | "denied" | "gated" | "failed";
  capability: string;
  output?: TOutput;
  error?: string;
  receipt: LedgerReceipt;
}

export interface ToolExecutorOptions {
  timeoutMs?: number;
}

export type AnyToolCapability = ToolCapability<unknown, unknown>;

export interface ToolExecutionEnvelope {
  manifest: PhiBotManifest;
  request: ToolExecutionRequest;
  runId?: string;
}
