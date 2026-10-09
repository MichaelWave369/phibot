import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderRequest } from "../src/providers/types.js";
import {
  OllamaProvider,
  STAGE_FORMAT,
  ADVISORY_ONLY_FORMAT,
} from "../src/providers/ollama.js";

const request: ProviderRequest = {
  stage: "observe",
  manifest: {
    id: "ollama-test",
    name: "Ollama Test",
    version: "1",
    role: "test",
    description: "provider fixture",
    model: { provider: "ollama", name: "qwen3:4b" },
    memory: { scope: "task", maxDepth: 2 },
    capabilities: ["repo.read"],
    authority: {
      read: true,
      propose: true,
      write: false,
      deploy: false,
    },
    escalation: {
      target: "vessie",
      confidenceBelow: 0.5,
    },
  },
  input: { task: "inspect" },
  prior: [],
};

function successResponse(): Response {
  return new Response(
    JSON.stringify({
      model: "qwen3:4b",
      message: {
        role: "assistant",
        content: '{"summary":"ok","confidence":0.9}',
      },
      prompt_eval_count: 20,
      eval_count: 8,
      total_duration: 10_000_000,
      load_duration: 1_000_000,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

test("Ollama governed contract disables thinking and uses JSON schema", async () => {
  let body: Record<string, unknown> | undefined;

  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return successResponse();
  }) as typeof fetch;

  const provider = new OllamaProvider("qwen3:4b", {
    fetchImpl,
  });
  const completion = await provider.complete(request);

  assert.equal(completion.provider, "ollama");
  assert.equal(completion.metrics.attempts, 1);
  assert.equal(body?.think, false);
  assert.equal(body?.keep_alive, "10m");
  assert.deepEqual(body?.format, STAGE_FORMAT);

  const options = body?.options as Record<string, unknown>;
  assert.equal(options.temperature, 0);
  assert.equal(options.num_predict, 160);
});

test("Ollama retries once on token repeat limit with anti-repeat sampling", async () => {
  const bodies: Array<Record<string, unknown>> = [];

  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    bodies.push(
      JSON.parse(String(init?.body)) as Record<string, unknown>,
    );

    if (bodies.length === 1) {
      return new Response(
        '{"error":"prediction aborted, token repeat limit reached"}',
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return successResponse();
  }) as typeof fetch;

  const provider = new OllamaProvider("qwen3:4b", {
    fetchImpl,
  });
  const completion = await provider.complete(request);

  assert.equal(bodies.length, 2);
  assert.equal(completion.metrics.attempts, 2);
  assert.equal(completion.metrics.retryReason, "token_repeat_limit");

  const firstOptions = bodies[0]?.options as Record<string, unknown>;
  const retryOptions = bodies[1]?.options as Record<string, unknown>;

  assert.equal(firstOptions.temperature, 0);
  assert.equal(retryOptions.temperature, 0.2);
  assert.equal(retryOptions.repeat_penalty, 1.1);
  assert.equal(retryOptions.repeat_last_n, 64);
  assert.deepEqual(bodies[1]?.format, STAGE_FORMAT);
});

test("Ollama does not retry unrelated HTTP errors", async () => {
  let calls = 0;

  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{"error":"out of memory"}', {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const provider = new OllamaProvider("qwen3:4b", {
    fetchImpl,
  });

  await assert.rejects(
    () => provider.complete(request),
    /out of memory/,
  );
  assert.equal(calls, 1);
});

test("Scout advisory-only Ollama schema has no action field or execution-oriented prompt", async()=>{
  let body: Record<string,unknown> | undefined;
  const fetchImpl=(async(_input: string | URL | Request,init?: RequestInit)=>{
    body=JSON.parse(String(init?.body)) as Record<string,unknown>;
    return successResponse();
  }) as typeof fetch;
  const provider=new OllamaProvider("qwen3:4b",{fetchImpl,responseMode:"advisory-only"});
  await provider.complete({
    ...request,stage:"interpret",
    manifest:{...request.manifest,
      capabilities:[],
      authority:{read:false,propose:false,write:false,deploy:false}
    },
  });
  assert.deepEqual(body?.format,ADVISORY_ONLY_FORMAT);
  const schema=body?.format as Record<string,unknown>;
  assert.equal((schema.properties as Record<string,unknown>).action,undefined);
  const messages=body?.messages as Array<{role:string;content:string}>;
  assert.ok(messages[0]?.content.includes("Never include an action field"));
  assert.ok(!messages[0]?.content.includes("Only include action when"));
  assert.equal(body?.think,false);
});

test("Scout advisory-only schema survives narrow Ollama token-repeat retry",async()=>{
  const bodies: Array<Record<string,unknown>>=[];
  const fetchImpl=(async(_input: string | URL | Request,init?: RequestInit)=>{
    bodies.push(JSON.parse(String(init?.body)) as Record<string,unknown>);
    return bodies.length===1 ?
      new Response('{"error":"prediction aborted, token repeat limit reached"}',{status:500}) :
      successResponse();
  }) as typeof fetch;
  const provider=new OllamaProvider("qwen3:4b",{fetchImpl,responseMode:"advisory-only"});
  await provider.complete({...request,stage:"interpret"});
  assert.equal(bodies.length,2);
  for(const body of bodies)assert.deepEqual(body.format,ADVISORY_ONLY_FORMAT);
});
