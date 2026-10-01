import type { LedgerReceipt, PhiBotManifest } from "../core/types.js";
import type { GateRequest, RealityGrant } from "../gate/types.js";

export interface ToolExecutionContext {
  botId: string;
  runId: string;
  signal: AbortSignal;
}

export interface ToolCapability<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  actionClass: "read" | "propose" | "write" | "deploy";
  external: boolean;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolExecutionRequest {
  capability: string;
  input: unknown;
  grant?: RealityGrant;
}

export interface ToolExecutionResult<TOutput = unknown> {
  status: "executed" | "denied" | "gated" | "failed";
  capability: string;
  output?: TOutput;
  error?: string;
  gateRequest?: GateRequest;
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
