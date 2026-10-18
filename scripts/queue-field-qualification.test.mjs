import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { enqueue, runQueue } from "./work-queue.mjs";
import {
  buildFieldReport, saveFieldReceipt, verifyFieldReceipt,
} from "./queue-field-qualification.mjs";

const repository = "MichaelWave369/Demo";
const policy = { owner: "MichaelWave369", repos: [repository] };
const jobSpec = { capability: "repo.steward.discover", input: { repository } };
const sha256 = x => createHash("sha256").update(x).digest("hex");
const fakeTool = async req => ({
  status: "executed",
  output: req.capability === "repo.steward.discover"
    ? { tasks: Array.from({length:16},(_,n)=>({
      text: n === 0 ? "sensitive source must never appear in receipts" : "Task " + n,
    })), issues: [], status: "READ_ONLY" }
    : { status: "CHECKS_PENDING", headSha: "b".repeat(40),
      untrustedBody: "sensitive CI log must never appear in receipts" },
});
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "phi-field-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function goodJob(dir, spec = jobSpec, executor = fakeTool) {
  const added = await enqueue(spec, policy, dir);
  const result = await runQueue({ dir, policy, execute: executor });
  assert.equal(result.completed, 1);
  return added.id;
}
const jobPath = (dir,id) => join(dir, "jobs", id+".json");
const eventPath = dir => join(dir, "events.ndjson");
const receiptPath = (dir,id) => join(dir, "qualification", id+".json");

test("qualifies the 16-task zero-issue discovery observation exactly as a local self-report", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    const report = await buildFieldReport({ dir, policy });
    assert.equal(report.classification, "LOCAL_SELF_REPORTED_READ_OBSERVED");
    assert.equal(report.subject.jobId, id);
    assert.equal(report.subject.attempts, 1);
    assert.equal(report.subject.repository, repository);
    assert.equal(report.localEvidence.observation.tasks, 16);
    assert.equal(report.localEvidence.observation.issues, 0);
    assert.deepEqual(report.localEvidence.transitions.map(e=>e.type),
      ["ENQUEUED","LEASED","OBSERVED"]);
    assert.equal(report.executionContext.independentRemoteVerification, false);
    assert.equal(report.executionContext.remoteWritesVerified, false);
    assert.ok(report.remainingQualificationGates.includes(
      "HUMAN_GATED_WRITE_FIELD_QUALIFICATION"));
    assert.ok(!JSON.stringify(report).includes("sensitive source must never appear"));
    const written = await saveFieldReceipt({ dir, policy });
    assert.equal(written.status, "FIELD_RECEIPT_SAVED_LOCAL_SELF_REPORT");
    assert.match(written.digest, /^[a-f0-9]{64}$/);
    assert.equal(written.jobId, id);
    const saved = JSON.parse(await readFile(receiptPath(dir,id), "utf8"));
    assert.equal(saved.receiptDigest, written.digest);
    assert.equal(saved.localEvidence.observation.tasks, 16);
    const verification = await verifyFieldReceipt({ dir, jobId:id });
    assert.equal(verification.status, "LOCAL_RECEIPT_SELF_HASH_MATCHES");
    assert.equal(verification.qualification, "LOCAL_SELF_REPORT_NOT_INDEPENDENT_ATTESTATION");
  });
});

test("existing immutable receipt is never overwritten or double-written", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    await saveFieldReceipt({ dir, policy, jobId:id });
    const before = await readFile(receiptPath(dir,id),"utf8");
    const again = await saveFieldReceipt({ dir, policy, jobId:id });
    assert.equal(again.status, "FIELD_RECEIPT_ALREADY_EXISTS_NO_OVERWRITE");
    assert.equal(before, await readFile(receiptPath(dir,id),"utf8"));
    assert.equal((await readdir(join(dir,"qualification"))).length,1);
  });
});

test("tampered receipt fails digest verification and cannot be silently overwritten", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    await saveFieldReceipt({ dir, policy, jobId:id });
    const path = receiptPath(dir,id);
    const saved = JSON.parse(await readFile(path,"utf8"));
    saved.localEvidence.observation.tasks = 99;
    await writeFile(path,JSON.stringify(saved));
    await assert.rejects(verifyFieldReceipt({dir,jobId:id}),/DIGEST_MISMATCH/);
    await assert.rejects(saveFieldReceipt({dir,policy,jobId:id}),/DIGEST_MISMATCH/);
  });
});

test("missing, queued, invalid job ID or ambiguous success refuses qualification", async () => {
  await fixture(async dir => {
    await assert.rejects(buildFieldReport({dir,policy}),/FIELD_SELECT_EXACT_JOB_ID/);
    const added = await enqueue(jobSpec,policy,dir);
    await assert.rejects(buildFieldReport({dir,policy,jobId:added.id}),/COMPLETED_READ_REQUIRED/);
    await assert.rejects(buildFieldReport({dir,policy,jobId:"bad"}),/JOB_ID_INVALID/);
    await runQueue({dir,policy,execute:fakeTool});
    const second = await goodJob(dir,{capability:"repo.steward.inspect",
      input:{repository,prNumber:5,requiredChecks:["test"]}});
    await assert.rejects(buildFieldReport({dir,policy}),/FIELD_SELECT_EXACT_JOB_ID/);
    const report = await buildFieldReport({dir,policy,jobId:second});
    assert.equal(report.localEvidence.observation.checkStatus, "CHECKS_PENDING");
    assert.equal(report.localEvidence.observation.headSha,"b".repeat(40));
    assert.ok(!JSON.stringify(report).includes("sensitive CI log"));
  });
});

test("missing journal, corrupted journal, and wrong chronology refuse qualification", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    const saved = await readFile(eventPath(dir),"utf8");
    await writeFile(eventPath(dir),"");
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/SIZE_OR_TYPE_INVALID/);
    await writeFile(eventPath(dir),saved.slice(0,-1));
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/JOURNAL_NOT_COMPLETE/);
    await writeFile(eventPath(dir),"{oops}\n");
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/JOURNAL_LINE_INVALID/);
    await writeFile(eventPath(dir),saved.replace('"event":"OBSERVED"','"event":"RETRY_QUEUED"'));
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/EVENT_SEQUENCE_INVALID|JOB_EVENTS_DISAGREE/);
  });
});

test("edited observation digest or fabricated evidence is rejected", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    const path = jobPath(dir,id);
    const raw = JSON.parse(await readFile(path,"utf8"));
    raw.evidence.digest = "f".repeat(64);
    await writeFile(path,JSON.stringify(raw));
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/EVENT_SEQUENCE_INVALID/);
  });
});

test("event tampering or duplicated observed marker is refused", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    const journal = await readFile(eventPath(dir),"utf8");
    const lines = journal.trimEnd().split("\n").map(s=>JSON.parse(s));
    const observed = lines.at(-1);
    await writeFile(eventPath(dir),journal+JSON.stringify(observed)+"\n");
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/EVENT_SEQUENCE_INVALID/);
    lines.at(-1).evidence.tasks += 1;
    await writeFile(eventPath(dir),lines.map(x=>JSON.stringify(x)).join("\n")+"\n");
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/EVENT_SEQUENCE_INVALID/);
  });
});

test("a successful second attempt is receipted but its failed first attempt remains visible", async () => {
  await fixture(async dir => {
    let count = 0;
    const id = (await enqueue(jobSpec,policy,dir)).id;
    const execute=async()=>++count===1?
      ({status:"failed",error:"secret-not-for-ledger"}):fakeTool(jobSpec);
    const first = await runQueue({dir,policy,execute});
    assert.equal(first.retryable,1);
    const second = await runQueue({dir,policy,execute});
    assert.equal(second.completed,1);
    const report = await buildFieldReport({dir,policy,jobId:id});
    assert.equal(report.subject.attempts,2);
    assert.deepEqual(report.localEvidence.transitions.map(e=>e.type),
      ["ENQUEUED","LEASED","RETRY_QUEUED","LEASED","OBSERVED"]);
    assert.ok(!JSON.stringify(report).includes("secret-not-for-ledger"));
  });
});

test("worker lock prevents qualification while a pass could still be changing evidence", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    await writeFile(join(dir,"worker.lock"),JSON.stringify({pid:1234,expiresMs:Date.now()+10000}));
    await assert.rejects(buildFieldReport({dir,policy,jobId:id}),/WORKER_LOCK_PRESENT/);
  });
});

test("read-only qualification never invokes tool, network, queue writer or GitHub", async () => {
  await fixture(async dir => {
    const id = await goodJob(dir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async()=>{throw new Error("QUALIFICATION_MUST_NOT_FETCH");};
    try {
      const beforeJob=sha256(await readFile(jobPath(dir,id),"utf8"));
      const beforeEvents=sha256(await readFile(eventPath(dir),"utf8"));
      await buildFieldReport({dir,policy,jobId:id});
      await saveFieldReceipt({dir,policy,jobId:id});
      assert.equal(beforeJob,sha256(await readFile(jobPath(dir,id),"utf8")));
      assert.equal(beforeEvents,sha256(await readFile(eventPath(dir),"utf8")));
    } finally {globalThis.fetch = originalFetch;}
  });
});
