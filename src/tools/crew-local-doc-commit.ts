/** PHIBOT-42 CLI-only Reality Gate capability, never registered in builtins. */
import type { ToolCapability } from "./types.js";
import type { ToolCapabilityRegistry } from "./registry.js";
import {
  commitLocalDoc, validateLocalDocCommitIntent,
  type LocalDocCommitIntent, type LocalDocCommitResult,
} from "../crew-local-doc-commit.js";

export const LOCAL_DOC_COMMIT_CAPABILITY = "crew.markdown.commit-local" as const;

export function registerLocalDocCommit(
  registry: ToolCapabilityRegistry, allowedRoots: string[],
): ToolCapabilityRegistry {
  const capability: ToolCapability<LocalDocCommitIntent, LocalDocCommitResult> = {
    id: LOCAL_DOC_COMMIT_CAPABILITY,
    description: "Commit one previously approved Markdown worktree change locally. Never push.",
    actionClass: "write",
    external: false,
    requiresGate: true,
    validate: validateLocalDocCommitIntent,
    async execute(input) { return commitLocalDoc(input, allowedRoots); },
  };
  return registry.register(capability);
}
