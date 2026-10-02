import type {
  AcceptanceProviderMode,
  AcceptanceReport,
} from "../acceptance/types.js";

export type QualificationStatus = "PASS" | "FAIL";
export type QualificationCheckStatus = "pass" | "fail";

export interface QualificationArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface QualificationPreflightCheck {
  name: string;
  status: QualificationCheckStatus;
  detail: string;
}

export interface QualificationPreflight {
  schema: "phibot.qualification.preflight.v1";
  checkedAt: string;
  providerMode: AcceptanceProviderMode;
  ollamaHost?: string;
  requiredModel?: string;
  ollamaVersion?: string;
  inferenceLatencyMs?: number;
  availableModels: string[];
  checks: QualificationPreflightCheck[];
  passed: boolean;
}

export interface QualificationEnvironment {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  providerMode: AcceptanceProviderMode;
  ollamaHost?: string;
  ollamaTimeoutMs?: number;
  sourceCommit?: string;
}

export interface QualificationFailure {
  name: string;
  message: string;
}

export interface QualificationRecord {
  schema: "phibot.qualification.record.v1";
  qualificationId: string;
  status: QualificationStatus;
  startedAt: string;
  finishedAt: string;
  environment: QualificationEnvironment;
  preflight: QualificationPreflight;
  runtimeStateDir: string;
  acceptance?: AcceptanceReport;
  failure?: QualificationFailure;
  artifacts: QualificationArtifact[];
}

export interface QualificationResult {
  record: QualificationRecord;
  recordPath: string;
  digestPath: string;
  recordSha256: string;
}

export interface QualificationOptions {
  outputDir: string;
  mode?: AcceptanceProviderMode;
  ollamaHost?: string;
  ollamaTimeoutMs?: number;
  requiredModel?: string;
  sourceCommit?: string;
  secret?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}
