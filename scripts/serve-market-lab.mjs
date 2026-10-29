import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".market-host-dist");
const port = 4173;
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
]);

createServer(async (request, response) => {
  const fail = (code, message) => {
    response.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    response.end(message);
  };
  if (request.headers.host !== "127.0.0.1:4173" && request.headers.host !== "localhost:4173") {
    fail(403, "Untrusted host.");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    fail(405, "Only GET/HEAD are allowed.");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    fail(400, "Bad request.");
    return;
  }
  const target = resolve(join(root, pathname === "/" ? "index.html" : "." + pathname));
  if (target !== root && !target.startsWith(root + sep)) {
    fail(403, "Refused path traversal.");
    return;
  }
  try {
    if (!(await stat(target)).isFile()) throw new Error("Not a file.");
    const content = await readFile(target);
    response.writeHead(200, {
      "Content-Type": types.get(extname(target)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    fail(404, "Not found.");
  }
}).listen(port, "127.0.0.1", () => {
  console.log("PHIBOT-17 lab: http://127.0.0.1:" + port);
  console.log("SDK and model do not download unless you approve the checkbox and click Load.");
});
