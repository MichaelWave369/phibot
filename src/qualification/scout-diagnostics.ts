/**
 * PHIBOT-13: stable, payload-free diagnostics for operator field qualification.
 *
 * The command must never echo arbitrary provider errors because Ollama/HTTP
 * errors can include raw model text, user data, URLs or secret-bearing context.
 * Errors are interpreted only as known bounded classes. No transport is added.
 */
export type ScoutFieldPhase =
  | "ARGUMENTS"
  | "PUBLIC_READ"
  | "LOCAL_OLLAMA"
  | "QUALIFICATION"
  | "LOCAL_SAVE";

export interface ScoutFieldDiagnostic {
  schema: "phibot.scout-field-diagnostic.v0.1";
  outcome: "REFUSED";
  phase: ScoutFieldPhase;
  code: string;
  next_check: string;
  model_executed: "UNKNOWN_NOT_ASSERTED";
  authority_granted: false;
}

function strictCode(value: string, prefix: string): boolean {
  return value.startsWith(prefix) &&
    value.length <= 90 &&
    /^[A-Z][A-Z0-9_]*$/.test(value);
}

/** Return only a fixed code and known local command, never an exception body. */
export function diagnoseScoutFieldFailure(
  error: unknown,
  phase: ScoutFieldPhase
): ScoutFieldDiagnostic {
  const message = error instanceof Error ? error.message : "";
  let code: string;
  let next_check: string;
  if (phase === "ARGUMENTS") {
    code = strictCode(message, "PHIBOT_SCOUT_FIELD_") ?
      message : "PHIBOT_SCOUT_FIELD_ARGUMENTS_REFUSED";
    next_check = "Run npm.cmd run scout:field -- --help";
  } else if (phase === "PUBLIC_READ") {
    code = strictCode(message, "PHIBOT_PUBLIC_") ||
      strictCode(message, "PHIBOT_CLOUD_") ?
      message : "PHIBOT_SCOUT_FIELD_PUBLIC_FETCH_REFUSED";
    next_check = "Run npm.cmd run cloud:inspect to isolate the public source read";
  } else if (phase === "LOCAL_OLLAMA") {
    if (strictCode(message, "PHIBOT_SHADOW_")) {
      code = message;
    } else if (/^Ollama request timed out after \d+ms\.$/.test(message)) {
      code = "PHIBOT_SCOUT_FIELD_OLLAMA_TIMEOUT";
    } else if (/^Ollama request failed with HTTP 404(?:\b|:)/.test(message)) {
      code = "PHIBOT_SCOUT_FIELD_OLLAMA_MODEL_OR_ROUTE_MISSING";
    } else if (/^Ollama request failed with HTTP \d{3}(?:\b|:)/.test(message)) {
      code = "PHIBOT_SCOUT_FIELD_OLLAMA_HTTP_REFUSED";
    } else if (/^Ollama returned an invalid chat response\.$/.test(message) ||
      message.startsWith("Provider contract violation:")) {
      code = "PHIBOT_SCOUT_FIELD_MODEL_RESPONSE_INVALID";
    } else if (error instanceof TypeError ||
      /^(?:fetch failed|connect ECONNREFUSED|ECONNREFUSED)/.test(message)) {
      code = "PHIBOT_SCOUT_FIELD_LOCAL_OLLAMA_CONNECTION";
    } else {
      code = "PHIBOT_SCOUT_FIELD_LOCAL_MODEL_REFUSED";
    }
    next_check = "Run ollama list, then npm.cmd run qualify:doctor -- --model qwen3:4b";
  } else if (phase === "QUALIFICATION") {
    code = strictCode(message, "PHIBOT_SCOUT_FIELD_") ?
      message : "PHIBOT_SCOUT_FIELD_QUALIFICATION_REFUSED";
    next_check = "Check the public receipt age and local shadow qualification scope";
  } else {
    code = strictCode(message, "PHIBOT_SCOUT_FIELD_") ?
      message : "PHIBOT_SCOUT_FIELD_LOCAL_SAVE_REFUSED";
    next_check = "Check write permissions under .phibot/scout-qualification";
  }
  return Object.freeze({
    schema: "phibot.scout-field-diagnostic.v0.1",
    outcome: "REFUSED",
    phase,
    code,
    next_check,
    model_executed: "UNKNOWN_NOT_ASSERTED",
    authority_granted: false,
  });
}
