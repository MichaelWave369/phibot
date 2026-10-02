import type {
  AcceptanceProviderMode,
  AcceptanceReport,
} from "../acceptance/types.js";

export type QualificationStatus = "PASS" | "FAIL";

export interface QualificationArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface QualificationEnvironment {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  providerMode: AcceptanceProviderMode;
  ollamaHost?: string;
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
  sourceCommit?: string;
  secret?: string;
  now?: () => number;
}
