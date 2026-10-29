import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = path => readFile(join(root, path), "utf8");

test("PhiPots is exposed as a separate crew screen", async () => {
  const app = await source("src/App.jsx");
  assert.match(app, /import PhiPots from "\.\/PhiPots\.jsx"/);
  assert.match(app, /\["crew","cpu","PhiPots/);
  assert.match(app, /tab==="crew" && <PhiPots\/>/);
});

test("six named crew roles are a design preview, never live bots", async () => {
  const crew = await source("src/PhiPots.jsx");
  for (const role of ["IdeaBot", "BuilderBot", "TestBot", "AuditBot", "DeployBot", "LedgerBot"]) {
    assert.match(crew, new RegExp('name: "' + role + '"'));
  }
  assert.match(crew, /DESIGN PREVIEW/);
  assert.match(crew, /No agent is spawned/);
  assert.match(crew, /PROPOSED/);
  assert.match(crew, /cannot|Cannot/);
  assert.doesNotMatch(crew, /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(/);
  assert.doesNotMatch(crew, /localhost:43969|api\/(enqueue|run-once|state)/);
});

test("crew design preserves exact human approval and evidence boundaries", async () => {
  const doc = await readFile(join(root, "..", "docs", "PHIPOTS_CREW.md"), "utf8");
  assert.match(doc, /single-use.*Reality Gate/);
  assert.match(doc, /UNVERIFIED/);
  assert.match(doc, /no automatic publish\/merge/);
  assert.match(doc, /zero write authority/i);
  assert.match(doc, /PUBLIC DESIGN SHOWCASE \+ LOCAL DETERMINISTIC REHEARSAL/);
});
