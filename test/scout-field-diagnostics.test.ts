import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseScoutFieldFailure } from "../src/qualification/scout-diagnostics.js";

test("public source failures show a stable code, never raw response",()=>{
  const x=diagnoseScoutFieldFailure(new Error("PHIBOT_PUBLIC_SOURCE_BYTES"),"PUBLIC_READ");
  assert.equal(x.code,"PHIBOT_PUBLIC_SOURCE_BYTES");
  assert.equal(x.phase,"PUBLIC_READ");
  assert.match(x.next_check,/cloud:inspect/);
});
test("unclassified public errors do not leak an arbitrary secret or endpoint",()=>{
  const secret="token-this-should-not-appear";
  const x=diagnoseScoutFieldFailure(new Error("GET request failed "+secret),"PUBLIC_READ");
  assert.equal(x.code,"PHIBOT_SCOUT_FIELD_PUBLIC_FETCH_REFUSED");
  assert.ok(!JSON.stringify(x).includes(secret));
});
test("Ollama local timeouts and 404 get actionable safe codes",()=>{
  const t=diagnoseScoutFieldFailure(new Error("Ollama request timed out after 60000ms."),"LOCAL_OLLAMA");
  assert.equal(t.code,"PHIBOT_SCOUT_FIELD_OLLAMA_TIMEOUT");
  const model=diagnoseScoutFieldFailure(new Error("Ollama request failed with HTTP 404: leaked-model-name"),"LOCAL_OLLAMA");
  assert.equal(model.code,"PHIBOT_SCOUT_FIELD_OLLAMA_MODEL_OR_ROUTE_MISSING");
  assert.ok(!JSON.stringify(model).includes("leaked-model-name"));
});
test("provider raw HTTP error text cannot escape diagnostic projection",()=>{
  const body="private-inference-text";
  const x=diagnoseScoutFieldFailure(new Error("Ollama request failed with HTTP 500: "+body),"LOCAL_OLLAMA");
  assert.equal(x.code,"PHIBOT_SCOUT_FIELD_OLLAMA_HTTP_REFUSED");
  assert.ok(!JSON.stringify(x).includes(body));
});
test("model proposed action and invalid contract are distinct fail-closed codes",()=>{
  const action=diagnoseScoutFieldFailure(new Error("PHIBOT_SHADOW_MODEL_PROPOSED_ACTION"),"LOCAL_OLLAMA");
  assert.equal(action.code,"PHIBOT_SHADOW_MODEL_PROPOSED_ACTION");
  const contract=diagnoseScoutFieldFailure(new Error("Provider contract violation: invalid JSON text 'secret'"),"LOCAL_OLLAMA");
  assert.equal(contract.code,"PHIBOT_SCOUT_FIELD_MODEL_RESPONSE_INVALID");
  assert.ok(!JSON.stringify(contract).includes("secret"));
});
test("transport failures are not mistaken for public-source errors",()=>{
  const x=diagnoseScoutFieldFailure(new TypeError("fetch failed"),"LOCAL_OLLAMA");
  assert.equal(x.code,"PHIBOT_SCOUT_FIELD_LOCAL_OLLAMA_CONNECTION");
  assert.equal(x.model_executed,"UNKNOWN_NOT_ASSERTED");
  assert.equal(x.authority_granted,false);
});
test("qualification and local save have their own safe phases",()=>{
  const q=diagnoseScoutFieldFailure(new Error("PHIBOT_SCOUT_FIELD_REVIEW_SCOPE"),"QUALIFICATION");
  const s=diagnoseScoutFieldFailure(new Error("EACCES: /private/path"),"LOCAL_SAVE");
  assert.equal(q.code,"PHIBOT_SCOUT_FIELD_REVIEW_SCOPE");
  assert.equal(s.code,"PHIBOT_SCOUT_FIELD_LOCAL_SAVE_REFUSED");
  assert.match(s.next_check,/qualification/);
});
test("untrusted fake code or oversized code cannot echo a payload",()=>{
  for (const e of [new Error("PHIBOT_SHADOW_LOWERcase"),
    new Error("PHIBOT_SHADOW_"+"X".repeat(300)),
    "PHIBOT_SHADOW_MODEL_PROPOSED_ACTION",
    new Error("PHIBOT_SHADOW_CODE\nTOKEN=verysecret")
  ]) {
    const x=diagnoseScoutFieldFailure(e,"LOCAL_OLLAMA");
    assert.equal(x.code,"PHIBOT_SCOUT_FIELD_LOCAL_MODEL_REFUSED");
    assert.equal(x.authority_granted,false);
  }
});
