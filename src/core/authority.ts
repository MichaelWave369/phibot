import type {
  AuthorityClass,
  AuthorityMode,
  PhiBotManifest,
  StageResult,
} from "./types.js";

export interface AuthorityDecision {
  allowed: boolean;
  gated: boolean;
  authorityClass: AuthorityClass;
  reason: string;
}

export function evaluateAuthorityMode(
  mode: AuthorityMode,
  authorityClass: AuthorityClass,
): AuthorityDecision {
  if (mode === false) {
    return {
      allowed: false,
      gated: false,
      authorityClass,
      reason: `${authorityClass} authority is denied.`,
    };
  }

  if (mode === "gated") {
    return {
      allowed: false,
      gated: true,
      authorityClass,
      reason: `${authorityClass} authority requires Reality Gate approval.`,
    };
  }

  return {
    allowed: true,
    gated: false,
    authorityClass,
    reason: `${authorityClass} authority granted.`,
  };
}

export function evaluateManifestAuthority(
  manifest: PhiBotManifest,
  authorityClass: AuthorityClass,
): AuthorityDecision {
  return evaluateAuthorityMode(manifest.authority[authorityClass], authorityClass);
}

export function evaluateAuthority(
  manifest: PhiBotManifest,
  result: StageResult,
): AuthorityDecision {
  const action = result.action;
  if (!action) {
    return {
      allowed: true,
      gated: false,
      authorityClass: "propose",
      reason: "No action requested.",
    };
  }

  if (!manifest.capabilities.includes(action.capability)) {
    return {
      allowed: false,
      gated: false,
      authorityClass: action.authority ?? (action.external ? "write" : "propose"),
      reason: `Capability not declared: ${action.capability}`,
    };
  }

  const authorityClass =
    action.authority ?? (action.external ? "write" : "propose");

  return evaluateManifestAuthority(manifest, authorityClass);
}
