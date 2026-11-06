/**
 * PHIBOT-41: this capability is NOT registered in builtins or the bot service.
 * Only the explicit, interactive local markdown operator CLI registers it.
 */
import type { ToolCapability } from "./types.js";
import type { ToolCapabilityRegistry } from "./registry.js";
import {
  applyLocalMarkdown, validateMarkdownApplyInput,
  type MarkdownApplyIntent, type MarkdownApplyResult,
} from "../crew-markdown-apply.js";

export const MARKDOWN_LOCAL_APPLY_CAPABILITY = "crew.markdown.apply-local" as const;

export function registerLocalMarkdownApply(
  registry: ToolCapabilityRegistry,
  options: {
    allowedRoots: string[];
    draftDir?: string;
    handoffRecordsDir?: string;
    reviewDir?: string;
  },
): ToolCapabilityRegistry {
  const capability: ToolCapability<MarkdownApplyIntent, MarkdownApplyResult> = {
    id: MARKDOWN_LOCAL_APPLY_CAPABILITY,
    description: "Apply one exact source-pinned Markdown draft to the local uncommitted Git worktree.",
    actionClass: "write",
    external: false,
    requiresGate: true,
    validate: validateMarkdownApplyInput,
    async execute(input) {
      return applyLocalMarkdown(input, options);
    },
  };
  return registry.register(capability);
}
