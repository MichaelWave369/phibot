import assert from "node:assert/strict";
import test from "node:test";
import { BrowserMarketLab, type BrowserTinyClient } from "../src/market/browser-lab.js";
import type { TemplateInspection } from "../src/market/inference-integrity.js";

const DATE = new Date("2026-10-29T07:25:23.712Z");
function client(log: string[], backend: "webgpu"|"wasm", rendered: boolean): BrowserTinyClient {
  let ready = false;
  let generating = false;
  return {
    getStatus: () => ({ready, phase:ready ? "ready" : "idle",
      model: "mock-smollm", device: backend, dtype: backend === "webgpu" ? "q4f16" : "q8"}),
    load: async () => {ready = true;},
    dispose: async () => {ready = false;},
    inspectPrompt: async prompt => {
      assert.equal(ready, true);
      assert.equal(generating, false);
      log.push("inspect:" + prompt);
      const result: TemplateInspection = {
        schema: "phibot.market.template-inspection.v1",
        status: rendered ? "TOKENIZER_RENDERED" : "API_UNAVAILABLE",
        method: "apply_chat_template", addGenerationPromptRequested: true,
        inputMessages: "VENDORED_SYSTEM_PLUS_USER",
        renderedPreview: rendered ? "<|user|>" + prompt + "<|assistant|>" : null,
        renderedLength: rendered ? prompt.length + 24 : null, previewClipped:false,
        exactGeneratorInputTokenSequenceVerified:false, errorClass:null,
      };
      return result;
    },
    generate: async (prompt, opts) => {
      assert.equal(ready, true);
      assert.equal(generating, false);
      generating = true;
      try {
        log.push("generate:" + prompt);
        assert.equal(opts.mode, "baseline");
        assert.equal(opts.maxNewTokens, 48);
        // A true SDK generation receipt is not a guarantee of a correct model result.
        return {text: prompt, receipt:{
          schema:"POCKETBRAIN_TINY_RUN_V2", model:"mock-smollm",
          backend, dtype:backend === "webgpu" ? "q4f16" : "q8",
          mode:"baseline", generation_wall_ms:18, observed_token_callback_events:5,
          prompt_char_count:prompt.length, output_char_count:prompt.length,
          time_to_first_token_callback_ms:7,
        }};
      } finally {generating = false;}
    },
  };
}
test("consent and loaded SDK required; exactly three sequential template inspections and generations", async () => {
  const logs: string[] = [];
  const lab = new BrowserMarketLab();
  await assert.rejects(lab.runInferenceIntegrity(1130717701, DATE), /Click Load/);
  assert.equal(logs.length, 0);
  await lab.loadWithConsent(true, async () => client(logs, "webgpu", true));
  const r = await lab.runInferenceIntegrity(1130717701, DATE);
  assert.equal(r.schema, "phibot.browser-inference-integrity.v1");
  assert.equal(r.attempts.length, 3);
  assert.deepEqual(logs.map(x=>x.split(":")[0]), [
    "inspect","generate","inspect","generate","inspect","generate",
  ]);
  assert.ok(r.attempts.every(x => x.templateInspection.status === "TOKENIZER_RENDERED"));
  assert.ok(r.attempts.every(x => x.review.receipt.sdkReceiptValid));
  assert.ok(r.attempts.every(x => x.review.disposition === "HELD_FOR_HUMAN_REVIEW"));
  assert.equal(r.attempts[0]?.review.receipt.generationWallMs, 18);
  assert.equal(r.sdkReportedBackend,"webgpu");
  assert.equal(r.sdkReportedDtype,"q4f16");
  assert.equal(r.computeBackendIndependentlyVerified,false);
  assert.equal(r.tokenizerRenderingEqualsActualInputTokensProven,false);
  assert.equal(r.modelAssetsIndependentlyVerified,false);
  assert.equal(r.authority,"READ_ONLY_ADVISORY");
  assert.equal(r.financialActionsAuthorized,false);
  assert.equal(lab.getIntegrityComparisons().length, 0);
});
test("same seed WebGPU then WASM builds observational comparison without persistence or attestation", async () => {
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async()=>client([], "webgpu", true));
  const first = await lab.runInferenceIntegrity(111, DATE);
  await lab.unload();
  await lab.loadWithConsent(true, async()=>client([], "wasm", false));
  const second = await lab.runInferenceIntegrity(111, DATE);
  assert.equal(first.attempts.length,3);
  assert.equal(second.attempts.length,3);
  assert.equal(second.attempts[0]?.templateInspection.status, "API_UNAVAILABLE");
  const matches = lab.getIntegrityComparisons();
  assert.equal(matches.length,1);
  assert.equal(matches[0]?.sameInputs,true);
  assert.equal(matches[0]?.sameSdkModelClaim,true);
  assert.equal(matches[0]?.outputsIdentical,true);
  assert.equal(matches[0]?.sameQuantization,false);
  assert.equal(matches[0]?.backendClaimsDiffer,true);
  assert.equal(matches[0]?.independentlyAttested,false);
  assert.equal(matches[0]?.numericalParityProven,false);
  const reportCopy = lab.getReports() as unknown as Array<{authority:string}>;
  reportCopy[0]!.authority = "BROKER_ALLOWED";
  assert.equal(lab.getReports()[0]?.authority, "READ_ONLY_ADVISORY");
});
test("bad seeds and clocks fail without poisoning loaded client", async () => {
  const lab = new BrowserMarketLab();
  await lab.loadWithConsent(true, async()=>client([], "webgpu", true));
  await assert.rejects(lab.runInferenceIntegrity(-1, DATE), /seed/);
  await assert.rejects(lab.runInferenceIntegrity(2, new Date("invalid")), /clock/);
  assert.equal(lab.getStatus().phase, "ready");
  assert.equal(lab.getStatus().reportCount,0);
});
