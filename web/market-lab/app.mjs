import { BrowserMarketLab } from "./market/browser-lab.js";

const SDK_URL = new URL("./vendor/sdk/v0.1/index.mjs", import.meta.url).href;
const EXPECTED_SDK_VERSION = "0.1.0-experimental";
const lab = new BrowserMarketLab();
const element = (id) => document.getElementById(id);
const consent = element("consent");
const backend = element("backend");
const loadButton = element("load");
const unloadButton = element("unload");
const runButton = element("run");
const exportButton = element("export");
const reportsEl = element("reports");
const messageEl = element("message");

function message(text) {
  messageEl.textContent = text;
}

function render() {
  const { phase, model, sdkPhase, sdkReportedBackend, sdkReportedDtype, reportCount, error } = lab.getStatus();
  element("phase").textContent = phase.toUpperCase();
  const pill = element("phase").parentElement;
  pill.className = "status " + phase;
  loadButton.disabled = !consent.checked || !["idle", "error"].includes(phase);
  unloadButton.disabled = !["ready", "error"].includes(phase);
  runButton.disabled = phase !== "ready";
  exportButton.disabled = reportCount === 0;
  consent.disabled = !["idle", "error"].includes(phase);
  backend.disabled = !["idle", "error"].includes(phase);
  element("environment").textContent =
    "WebGPU API present: " + Boolean(navigator.gpu) +
    " · SDK model: " + (model ?? "not loaded") +
    " · SDK phase: " + (sdkPhase ?? "none") +
    " · SDK-reported backend: " + (sdkReportedBackend ?? "not reported") +
    " · SDK-reported dtype: " + (sdkReportedDtype ?? "not reported") +
    " · This does not prove model inference.";
  if (error) message("Load error: " + error);
}

function appendReport(result) {
  reportsEl.replaceChildren();
  const observation = document.createElement("div");
  observation.className = "bot-report";
  const summary = document.createElement("h3");
  summary.textContent = "Receipt · " + result.runId;
  const detail = document.createElement("p");
  detail.textContent = "Synthetic +" + result.observation.movePct.toFixed(2) +
    "% move · " + result.observation.checkedAt + "\n" +
    "Source: synthetic fixture · independently verified: NO" +
    "\nSDK-reported compute backend: " + (result.sdkReportedBackend ?? "NOT REPORTED") +
    " · independent attestation: NO" +
    "\nRestrictive output matches: " + result.restrictedMatchCount + "/2";
  observation.append(summary, detail);
  reportsEl.append(observation);
  for (const session of result.sessions) {
    const review = result.realityChecks.find(item => item.botId === session.botId);
    const card = document.createElement("div");
    card.className = "bot-report";
    const title = document.createElement("h3");
    title.textContent = session.botId;
    const status = document.createElement("small");
    status.textContent = "SDK receipt: " + session.status +
      " · Reality Check: " + (review?.disposition ?? "HELD_FOR_HUMAN_REVIEW") +
      " · Codes: " + (review?.reasonCodes.join(", ") || "none") +
      " · Backend (SDK claim): " + (review?.sdkReportedBackend ?? "not reported") +
      " · NO ACTION AUTHORITY";
    const contents = document.createElement("p");
    contents.textContent = "FIXTURE-ONLY DETERMINISTIC STATEMENT (not model output):\n" +
      (review?.fixtureStatement ?? "Unavailable") +
      "\n\nUNTRUSTED ORIGINAL MODEL OUTPUT (review only; may be false):\n" +
      (review?.rawText ?? ("No valid advisory: " + ("reason" in session ? session.reason : "unknown")));
    card.append(title, status, contents);
    reportsEl.append(card);
  }
}

consent.addEventListener("change", render);
loadButton.addEventListener("click", async () => {
  if (!consent.checked) return;
  message("Explicit load requested. Importing the experimental SDK and then loading the model.");
  try {
    const task = lab.loadWithConsent(true, async () => {
      // The only external SDK import is inside the consent-affirmed click flow.
      // The first-party SDK is committed locally; runtime/model downloads are still external and unpinned.
      const sdk = await import(SDK_URL);
      if (sdk.POCKETBRAIN_TINY_SDK_VERSION !== EXPECTED_SDK_VERSION ||
          typeof sdk.createPocketBrainTinyClient !== "function") {
        throw new Error("Unexpected PocketBrain Tiny SDK revision or interface.");
      }
      return sdk.createPocketBrainTinyClient();
    }, backend.value);
    render();
    await task;
    message("PocketBrain reported ready. Run the synthetic crew to qualify actual inference.");
  } catch (error) {
    message("SDK/model load failed: " + (error instanceof Error ? error.message : String(error)));
  }
  render();
});

runButton.addEventListener("click", async () => {
  message("Running two isolated bot requests sequentially on one Tiny client…");
  try {
    const task = lab.runSyntheticCrew(SDK_URL);
    render();
    const result = await task;
    appendReport(result);
    const valid = result.sessions.filter((s) => s.status === "advisory").length;
    message(valid + "/2 valid SDK advisory receipts; " + result.restrictedMatchCount +
      "/2 restrictive text matches. HELD means human review, not a failed model download. " +
      "Matching is NOT factuality proof, compute attestation, or trade authorization.");
  } catch (error) {
    message("Crew run failed: " + (error instanceof Error ? error.message : String(error)));
  }
  render();
});

unloadButton.addEventListener("click", async () => {
  try {
    await lab.unload();
    message("Model disposed. Previous reports remain only in this tab's memory until reload.");
  } catch (error) {
    message("Unload failed: " + (error instanceof Error ? error.message : String(error)));
  }
  render();
});

exportButton.addEventListener("click", () => {
  const reports = lab.getReports();
  if (!reports.length) return;
  const evidence = {
    schema: "phibot.browser-market-lab-export.v2",
    exportTime: new Date().toISOString(),
    hostOrigin: location.origin,
    sdkOrigin: new URL(SDK_URL).origin,
    distinctOrigin: location.origin !== new URL(SDK_URL).origin,
    sdkUrl: SDK_URL,
    sdkVersionClaim: EXPECTED_SDK_VERSION,
    webGpuInterfacePresent: Boolean(navigator.gpu),
    sdkReportedBackend: lab.getStatus().sdkReportedBackend,
    sdkReportedDtype: lab.getStatus().sdkReportedDtype,
    backendIndependentlyVerified: false,
    realityCheckMeaning: "NARROW_SYNTHETIC_STRING_MATCH_NOT_GENERAL_FACT_CHECK",
    independentParity: "NOT_TESTED",
    sdkSource: "VENDORED_FIRST_PARTY_IN_PHIBOT_COMMIT",
    externalRuntimeAndModelAttestation: "NOT_ATTESTED",
    browserQualification: "OPERATOR_REVIEW_REQUIRED",
    reports,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "phibot-17-r21-reality-check-evidence.json";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  message("Report exported locally. No report was uploaded.");
});

element("origin").textContent = "Host origin: " + location.origin +
  " · SDK origin: " + new URL(SDK_URL).origin +
  (location.origin === new URL(SDK_URL).origin ? " (same browser origin)" : " (distinct browser origin)");
render();
