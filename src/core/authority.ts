import type { PhiBotManifest, StageResult } from "./types.js";

export interface AuthorityDecision {
  allowed: boolean;
  gated: boolean;
  reason: string;
}

export function evaluateAuthority(
  manifest: PhiBotManifest,
  result: StageResult,
): AuthorityDecision {
  const action = result.action;
  if (!action) {
    return { allowed: true, gated: false, reason: "No action requested." };
  }

  if (!manifest.capabilities.includes(action.capability)) {
    return {
      allowed: false,
      gated: false,
      reason: `Capability not declared: ${action.capability}`,
    };
  }

  if (!action.external) {
    return { allowed: true, gated: false, reason: "Internal action." };
  }

  const mode = manifest.authority.write;
  if (mode === false) {
    return { allowed: false, gated: false, reason: "External writes are denied." };
  }
  if (mode === "gated") {
    return {
      allowed: false,
      gated: true,
      reason: "External write requires Reality Gate approval.",
    };
  }

  return { allowed: true, gated: false, reason: "External write authority granted." };
}
