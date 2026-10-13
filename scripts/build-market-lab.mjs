import { cp, mkdir, rm, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".market-host-dist");
const compiled = join(root, "dist", "src", "market");

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "market"), { recursive: true });

const sources = [
  [join(root, "web", "market-lab", "index.html"), join(out, "index.html")],
  [join(root, "web", "market-lab", "styles.css"), join(out, "styles.css")],
  [join(root, "web", "market-lab", "app.mjs"), join(out, "app.mjs")],
  [join(compiled, "browser-lab.js"), join(out, "market", "browser-lab.js")],
  [join(compiled, "observation.js"), join(out, "market", "observation.js")],
  [join(compiled, "pocketbrain-tiny.js"), join(out, "market", "pocketbrain-tiny.js")],
];
for (const [from, to] of sources) {
  await cp(from, to);
}
const host = await readFile(join(out, "app.mjs"), "utf8");
if (!host.includes('import { BrowserMarketLab } from "./market/browser-lab.js"')) {
  throw new Error("Market host import is not aligned with built output.");
}
console.log("Built PHIBOT-17 browser lab at .market-host-dist/ (no model downloaded).");
