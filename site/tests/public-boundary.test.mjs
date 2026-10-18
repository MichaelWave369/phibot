import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const text = async path => readFile(join(root, path), "utf8");

test("GitHub project subpath base prevents missing assets", async () => {
  const config = await text("vite.config.js");
  assert.match(config, /base:\s*["']\/phibot\/["']/);
  const html = await text("index.html");
  assert.match(html, /\/src\/main\.jsx/);
  assert.match(html, /Demo data only|Demo|demo/);
});

test("public React components must not access localhost queue or GitHub APIs", async () => {
  const sources = await readdir(join(root, "src"));
  for (const filename of sources) {
    const body = await text("src/" + filename);
    for (const forbidden of [
      /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\s*\(/,
      /\bEventSource\s*\(/, /\bnavigator\.sendBeacon\b/,
      /\bprocess\.env\b/, /\bimport\.meta\.env\b/,
      /api\/(enqueue|run-once|state|session)/, /localhost:43969/,
      /127\.0\.0\.1:43969/, /github_pat_[a-z0-9_]+/i,
    ]) {
      assert.doesNotMatch(body, forbidden, filename + " has forbidden public capability");
    }
  }
});

test("public interface prominently labels browser-only sample data", async () => {
  const app = await text("src/App.jsx");
  assert.match(app, /DEMO DATA · NO LIVE ACCESS/);
  assert.match(app, /browser-only sample state/);
  assert.match(app, /Run simulated pass/);
  assert.match(app, /No GitHub data is fetched/);
  assert.match(app, /No write authority in public preview/);
  assert.match(app, /href=\{GITHUB\}/);
  const main = await text("src/main.jsx");
  assert.match(main, /createRoot/);
});

test("separate local operator CLI and GitHub Pages remain isolated", async () => {
  const pkg = JSON.parse(await text("package.json"));
  assert.equal(pkg.private, true);
  assert.ok(pkg.dependencies.react && pkg.dependencies["react-dom"]);
  assert.ok(pkg.devDependencies.vite);
  assert.ok(!pkg.scripts["queue:run-once"]);
  const config = await text("vite.config.js");
  assert.doesNotMatch(config, /server:\s*\{[^}]*0\.0\.0\.0/);
});
