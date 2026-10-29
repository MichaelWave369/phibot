import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTinyMessages, extractTinyReply, createTinyRunner } from "../web/market-lab/vendor/pocketbrain-tiny.mjs";
import { createPocketBrainTinyClient } from "../web/market-lab/vendor/sdk/v0.1/index.mjs";
import { selectTinyGeneration } from "../web/market-lab/vendor/pocketbrain-tiny-metrics.mjs";
const read = path => readFileSync(path, "utf8");

test("restored lab does not automatically import a mutable remote PocketBrain SDK", () => {
  const app = read("web/market-lab/app.mjs");
  const html = read("web/market-lab/index.html");
  assert.match(app, /new URL\("\.\/vendor\/sdk\/v0\.1\/index\.mjs", import\.meta\.url\)/);
  assert.doesNotMatch(app, /import\(\s*["'`]https?:\/\//);
  assert.match(app, /loadButton\.addEventListener\("click"/);
  assert.match(app, /lab\.loadWithConsent\(true/);
  assert.match(app, /externalRuntimeAndModelAttestation: "NOT_ATTESTED"/);
  assert.match(html, /id="consent"/);
  assert.match(html, /SYNTHETIC FIXTURE ONLY/);
  assert.match(html, /No real prices/);
  assert.match(html, /id="run-dynamic"/);
  assert.match(app, /crypto\.getRandomValues/);
  assert.match(app, /runDynamicChallenge/);
  assert.match(app, /phibot\.browser-market-lab-export\.v6/);
  assert.match(app, /runInferenceIntegrity/);
  assert.match(html, /id="run-integrity"/);
  assert.match(app, /runCapabilityLadder/);
  assert.match(html, /id="run-ladder"/);
  assert.match(html, /id="ladder-seed"/);
  assert.match(app, /runAdaptiveChallenge/);
  assert.match(html, /id="run-adaptive"/);
});

test("bundled first-party SDK is inert until explicit load", () => {
  const sdk = read("web/market-lab/vendor/sdk/v0.1/index.mjs");
  const runtime = read("web/market-lab/vendor/pocketbrain-tiny.mjs");
  const metrics = read("web/market-lab/vendor/pocketbrain-tiny-metrics.mjs");
  assert.match(sdk, /POCKETBRAIN_TINY_SDK_VERSION = '0\.1\.0-experimental'/);
  assert.match(sdk, /createPocketBrainTinyClient/);
  assert.match(sdk, /\.\.\/\.\.\/pocketbrain-tiny\.mjs/);
  assert.match(runtime, /await import\(TINY_RUNTIME_URL\)/);
  assert.match(runtime, /@huggingface\/transformers@3\.8\.1/);
  assert.match(metrics, /TINY_RUN_SCHEMA = 'POCKETBRAIN_TINY_RUN_V2'/);
  assert.match(read("web/market-lab/vendor/LICENSE"), /MIT License/);
});

test("model loader is shipped only as a separately reviewed public lab", () => {
  const build = read("scripts/build-market-lab.mjs");
  const pages = read(".github/workflows/pages.yml");
  assert.match(build, /vendor\/sdk\/v0\.1\/index\.mjs/);
  assert.match(build, /reality-check\.js/);
  assert.match(build, /dynamic-challenge\.js/);
  assert.match(build, /adaptive-challenge\.js/);
  assert.match(build, /capability-ladder\.js/);
  assert.match(build, /inference-integrity\.js/);
  assert.match(build, /vendor\/pocketbrain-tiny-metrics\.mjs/);
  assert.match(pages, /market:build/);
  assert.match(pages, /site\/dist\/market-lab/);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["market:build"]);
  assert.ok(pkg.scripts["market:serve"]);
});

test("source-inspected SDK wraps prompt with system and user messages, not bare text", () => {
  const messages = buildTinyMessages(" Compute 3 + 4. ");
  assert.deepEqual(messages, [
    {role: "system", content: "You are PocketBrain, a concise assistant."},
    {role: "user", content: "Compute 3 + 4."},
  ]);
  const options = selectTinyGeneration("baseline", 48, 96);
  assert.equal(options.options.return_full_text, false);
  assert.equal(options.options.max_new_tokens, 48);
  assert.equal(options.options.do_sample, false);
  assert.equal(extractTinyReply([{generated_text: [
    {role: "system", content: "system"}, {role: "user", content: "Echo input"},
    {role: "assistant", content: " 7 "},
  ]}]), "7");
  const source = read("web/market-lab/vendor/pocketbrain-tiny.mjs");
  assert.match(source, /await generator\(messages, \{ \.\.\.options, streamer \}\)/);
  assert.match(source, /extractTinyReply\(output\)/);
  // The final tokenizer chat template and physical model execution are NOT independently audited here.
});


test("tokenizer renders local chat after load; no generation, no remote runtime", async () => {
  const events = [];
  const fake = async (messages) => {
    events.push("generate");
    assert.deepEqual(messages.map(x => x.role), ["system", "user"]);
    return [{generated_text:[{role:"assistant", content:"7"}]}];
  };
  fake.tokenizer = {apply_chat_template: async (messages, opts) => {
    events.push("render");
    assert.deepEqual(messages.map(x=>x.role), ["system","user"]);
    assert.equal(opts.tokenize,false);
    assert.equal(opts.add_generation_prompt,true);
    return "<|system|>You are PocketBrain<|user|>" + messages[1].content + "<|assistant|>";
  }};
  class MockStreamer {constructor(tokenizer, options) {
    assert.ok(tokenizer);
    assert.equal(options.skip_prompt,true);
  }}
  let clock = 0;
  const runner = createTinyRunner({
    generator:fake, TextStreamer:MockStreamer, model:"mock",
    device:"wasm",dtype:"q8", now:()=>++clock,
  });
  const loaded = createPocketBrainTinyClient({loadRuntime:async()=>runner});
  await assert.rejects(loaded.inspectPrompt("Compute 3 + 4"),/loaded/);
  assert.equal(events.length,0);
  await loaded.load({preferredDevice:"wasm"});
  const rendered = await loaded.inspectPrompt("Compute 3 + 4");
  assert.equal(rendered.status,"TOKENIZER_RENDERED");
  assert.match(rendered.renderedPreview,/Compute 3 \+ 4/);
  assert.equal(rendered.exactGeneratorInputTokenSequenceVerified,false);
  assert.deepEqual(events, ["render"]);
  const actual = await loaded.generate("Compute 3 + 4", {maxNewTokens:48});
  assert.equal(actual.text,"7");
  assert.equal(actual.receipt.schema, "POCKETBRAIN_TINY_RUN_V2");
  assert.equal(actual.receipt.mode, "baseline");
  assert.equal(actual.receipt.decode.max_new_tokens,48);
  assert.deepEqual(events, ["render","generate"]);
  await loaded.dispose();
});

test("tokenizer lacking API or throwing is recorded as unavailable/error, never a fake render", async () => {
  class Streamer {}
  const noApi = async () => [{generated_text:[{role:"assistant",content:"7"}]}];
  noApi.tokenizer = {};
  const runner = createTinyRunner({generator:noApi,TextStreamer:Streamer,
    device:"wasm",dtype:"q8",now:()=>1});
  const unavail = await runner.inspectPrompt("Compute 3 + 4");
  assert.equal(unavail.status,"API_UNAVAILABLE");
  assert.equal(unavail.renderedPreview,null);
  noApi.tokenizer.apply_chat_template = () => {throw new Error("bad template");};
  const err = await runner.inspectPrompt("Compute 3 + 4");
  assert.equal(err.status,"RENDER_ERROR");
  assert.equal(err.errorClass,"Error");
  assert.equal(err.renderedPreview,null);
});
