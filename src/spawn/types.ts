import type {
  AuthorityClass,
  AuthorityMode,
  PhiBotManifest,
} from "../core/types.js";

export type SpawnLifetime = "ephemeral" | "persistent";

export interface SpawnCapability {
  id: string;
  actionClass: AuthorityClass;
}

export interface SpawnTemplate {
  schema: "phibot.spawn.template.v1";
  templateId: string;
  role: string;
  description: string;
  namePrefix: string;
  model: PhiBotManifest["model"];
  memory: PhiBotManifest["memory"];
  capabilities: SpawnCapability[];
  authorityCeiling: Record<AuthorityClass, AuthorityMode>;
  escalationTarget: string;
  confidenceBelow: number;
}

export interface SpawnEvidence {
  evidenceId: string;
  patternKey: string;
  observedAt: string;
  taskRef?: string;
}

export interface SpawnProposalInput {
  templateId: string;
  patternKey: string;
  evidence: SpawnEvidence[];
  requestedCapabilities: string[];
  lifetime: SpawnLifetime;
  crewMembers?: string[];
}

export interface SpawnProposal {
  schema: "phibot.spawn.proposal.v1";
  proposalId: string;
  proposer: "vessie";
  templateId: string;
  patternKey: string;
  evidence: SpawnEvidence[];
  requestedCapabilities: string[];
  crewMembers: string[];
  lifetime: SpawnLifetime;
  createdAt: string;
  expiresAt: string;
  manifest: PhiBotManifest;
  manifestDigest: string;
}

export interface SpawnApproval {
  schema: "phibot.spawn.approval.v1";
  approvalId: string;
  proposalId: string;
  manifestDigest: string;
  issuedAt: string;
  expiresAt: string;
  reason?: string;
  signature: string;
}

export interface SpawnRecord {
  schema: "phibot.spawn.record.v1";
  spawnId: string;
  proposalId: string;
  botId: string;
  lifetime: SpawnLifetime;
  spawnedAt: string;
  expiresAt?: string;
  groupId?: string;
  approvalId?: string;
  status: "active" | "dissolved";
  dissolvedAt?: string;
  dissolveReason?: string;
}

export interface SpawnPolicy {
  minEvidenceCount: number;
  maxEvidenceAgeMs: number;
  proposalTtlMs: number;
  approvalTtlMs: number;
  ephemeralLifetimeMs: number;
  crewGroupTtlMs: number;
}
