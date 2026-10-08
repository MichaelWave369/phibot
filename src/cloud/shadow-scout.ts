/**
 * PHIBOT-11: local-only, operator-initiated Scout shadow analysis.
 * Exactly one reasoning-provider call; zero tools, writes, memory promotion,
 * CommonLine messages, execution grants, or autonomous bot spawns.
 */
import type { PhiBotAdapter } from "../adapters/dry-run.js";
import { parseProviderPayload } from "../adapters/provider-backed.js";
import { MemoryLedger } from "../core/ledger.js";
import { PhiBotRuntime } from "../core/runtime.js";
import type { BotInput, PhiBotManifest, StageResult, ProviderTrace } from "../core/types.js";
import type { PhiProvider } from "../providers/types.js";
import type { CloudScoutPublicReview } from "./public-acquisition.js";

const TASK = "Interpret a single public CloudWorker Scout observation as an unverified signal. Report only an advisory health assessment. No instructions, tools, actions or authority grants.";
const MAX_SUMMARY = 240;
const MODEL_TAG = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,79}$/;
const TTL_MS = 8 * 60 * 60 * 1000;

function assert(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error("PHIBOT_SHADOW_" + code);
}
export interface ShadowScoutReport {
  schema: "phibot.local-scout-shadow.v0.1";
  mode: "OPERATOR_MANUAL_LOCAL_SHADOW";
  agent_identity: "local-scout-shadow";
  source_mission_id: "phibot.scout.public-repo-health.v1";
  source_run_id: string;
  source_epistemic: "UNVERIFIED_PUBLIC";
  input_disposition: "OBSERVED_OK_UNVERIFIED_PUBLIC";
  status: "completed";
  advisory_summary: string;
  model_provider: string;
  model_name: string;
  model_calls: 1;
  model_input_class: "ENUMS_ONLY_NO_RAW_SOURCE";
  network_reads: 4;
  provider_fallback: false;
  runtime_stages: 4;
  tool_calls: 0;
  cloud_model_calls: 0;
  memory_admitted: false;
  actions_executed: false;
  bot_spawned: false;
  source_authenticated: false;
  identity_authenticated: false;
  authority_granted: false;
  phios_isolation_qualified: false;
}
function assertFresh(review: CloudScoutPublicReview, now: number): void {
  assert(Number.isSafeInteger(now) && now > 0, "CLOCK");
  assert(review && review.schema === "phibot.cloud-mission-public-review.v0.1" &&
    review.acquisition_kind === "OPERATOR_INITIATED_PUBLIC_GITHUB_GET" &&
    review.github_run_metadata_correlated === true &&
    review.independent_prior_source_pin_verified === false &&
    review.operator_identity_authenticated === false &&
    review.measurement_truth_authenticated === false &&
    review.source_authorship_authenticated === false &&
    review.scheduled_fetch_enabled === false &&
    review.agent_runtime_executed === false &&
    review.model_calls_executed === false &&
    review.authority_granted === false &&
    review.action_executed === false &&
    review.memory_admitted === false &&
    review.bot_spawned === false, "SOURCE_AUTHORITY");
  const r = review.review;
  assert(r?.schema === "phibot.cloud-mission-review.v0.1" &&
    r.mission_id === "phibot.scout.public-repo-health.v1" &&
    r.agent_identity_ref === "phibot.scout.cloud-review.v1" &&
    r.disposition === "OBSERVED_OK_UNVERIFIED_PUBLIC" &&
    r.task_id === "github_repo_metrics" &&
    r.source_epistemic === "UNVERIFIED_PUBLIC" &&
    r.integrity_hash_matched === true &&
    r.provenance_authenticated === false &&
    r.agent_identity_authenticated === false &&
    r.bot_runtime_executed === false &&
    r.independent_run_metadata_checked === false &&
    r.authority_granted === false &&
    r.action_executed === false &&
    r.memory_admitted === false &&
    r.spawn_authorized === false &&
    r.routing_influence === "NONE", "MISSION_SCOPE");
  const observed = Date.parse(r.observed_at), expires = Date.parse(r.expires_at);
  assert(Number.isFinite(observed) && Number.isFinite(expires) &&
    expires - observed === TTL_MS && now >= observed - 5 * 60 * 1000 &&
    now <= expires, "EXPIRED");
  assert(/^[1-9][0-9]{0,18}$/.test(r.run_id) && Number.isSafeInteger(Number(r.run_id)), "RUN_ID");
}
function scopedManifest(provider: PhiProvider): PhiBotManifest {
  assert(provider && typeof provider.id === "string" &&
    typeof provider.model === "string" && MODEL_TAG.test(provider.model), "MODEL");
  return {
    id: "local-scout-shadow",
    name: "Local Scout Shadow",
    version: "0.1.0",
    role: "public_observation_advisory_only",
    description: "One-call offline-safe interpretation of fixed enum-only public evidence.",
    model: { provider: provider.id, name: provider.model },
    memory: { scope: "none", maxDepth: 0 },
    capabilities: [],
    authority: { read: false, propose: false, write: false, deploy: false },
    escalation: { target: "human-operator", confidenceBelow: 0 },
  };
}
class SingleCallShadowAdapter implements PhiBotAdapter {
  private count = 0;
  private latest?: { summary: string; provider: ProviderTrace };
  constructor(private readonly provider: PhiProvider) {}
  get calls(): number { return this.count; }
  get interpretation(): { summary: string; provider: ProviderTrace } {
    assert(this.latest, "INTERPRETATION_MISSING");
    return this.latest;
  }
  async observe(): Promise<StageResult> {
    return { stage: "observe", summary: "Only a sanitized public GitHub status enum was received.", confidence: 1 };
  }
  async interpret(manifest: PhiBotManifest, input: BotInput): Promise<StageResult> {
    assert(this.count === 0, "PROVIDER_BUDGET");
    this.count++;
    const completion = await this.provider.complete({
      stage: "interpret", manifest, input,
      prior: [], // never feed previous model output or external text back in
    });
    assert(completion.provider === this.provider.id &&
      completion.model === this.provider.model && completion.fallback === false,
      "PROVIDER_IDENTITY_OR_FALLBACK");
    const parsed = parseProviderPayload(completion.content);
    assert(parsed.action === undefined, "MODEL_PROPOSED_ACTION");
    assert(parsed.summary.length <= MAX_SUMMARY &&
      !/[\u0000-\u001f\u007f]/.test(parsed.summary), "ADVISORY_TEXT");
    const summary = parsed.summary.trim();
    assert(summary.length > 0, "ADVISORY_EMPTY");
    const trace: ProviderTrace = {
      provider: completion.provider,
      model: completion.model,
      fallback: false,
      latencyMs: completion.metrics.latencyMs,
      ...(completion.metrics.totalTokens === undefined ? {} :
        { totalTokens: completion.metrics.totalTokens }),
      ...(completion.metrics.inputTokens === undefined ? {} :
        { inputTokens: completion.metrics.inputTokens }),
      ...(completion.metrics.outputTokens === undefined ? {} :
        { outputTokens: completion.metrics.outputTokens }),
      ...(completion.metrics.attempts === undefined ? {} :
        { attempts: completion.metrics.attempts }),
    };
    this.latest = { summary, provider: trace };
    return {stage:"interpret",summary,confidence:parsed.confidence,provider:trace};
  }
  async propose(): Promise<StageResult> {
    return {stage:"propose",summary:"Shadow mode prohibits proposing an executable action.",confidence:1};
  }
  async verify(): Promise<StageResult> {
    return {stage:"verify",summary:"No action was requested or executed.",confidence:1};
  }
}

export async function runLocalScoutShadow(
  publicReview: CloudScoutPublicReview, provider: PhiProvider, nowMs = Date.now()
): Promise<ShadowScoutReport> {
  // Validate before invoking any provider. Public data never defines a task,
  // model, capability, system prompt, or memory instruction.
  assertFresh(publicReview, nowMs);
  const manifest = scopedManifest(provider);
  const adapter = new SingleCallShadowAdapter(provider);
  const ledger = new MemoryLedger(); // transient only, never filesystem / NBG
  const runtime = new PhiBotRuntime(manifest, adapter, ledger);
  const result = await runtime.run({
    task: TASK,
    context: {
      task_id: "github_repo_metrics",
      observation_state: "OBSERVED_OK_UNVERIFIED_PUBLIC",
      source_epistemic: "UNVERIFIED_PUBLIC",
      actions_permitted: false,
      memory_permitted: false,
    },
  });
  assert(result.status === "completed" && result.stages.length === 4 &&
    adapter.calls === 1 && result.stages.every(s => s.action === undefined),
    "RUNTIME_BOUNDARY");
  const interpretation = adapter.interpretation;
  assert(ledger.receipts.every(r => r.stage !== "tool" && r.stage !== "gate" &&
    r.stage !== "memory" && r.stage !== "spawn"), "LEDGER_BOUNDARY");
  return Object.freeze({
    schema: "phibot.local-scout-shadow.v0.1",
    mode: "OPERATOR_MANUAL_LOCAL_SHADOW",
    agent_identity: "local-scout-shadow",
    source_mission_id: "phibot.scout.public-repo-health.v1",
    source_run_id: publicReview.review.run_id,
    source_epistemic: "UNVERIFIED_PUBLIC",
    input_disposition: "OBSERVED_OK_UNVERIFIED_PUBLIC",
    status: "completed",
    advisory_summary: interpretation.summary,
    model_provider: interpretation.provider.provider,
    model_name: interpretation.provider.model,
    model_calls: 1,
    model_input_class: "ENUMS_ONLY_NO_RAW_SOURCE",
    network_reads: 4,
    provider_fallback: false,
    runtime_stages: 4,
    tool_calls: 0,
    cloud_model_calls: 0,
    memory_admitted: false,
    actions_executed: false,
    bot_spawned: false,
    source_authenticated: false,
    identity_authenticated: false,
    authority_granted: false,
    phios_isolation_qualified: false,
  });
}
