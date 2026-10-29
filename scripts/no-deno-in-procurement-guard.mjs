// Render runs the API on Node: a bare `Deno.` in procurement code compiles under Deno but crashes there with "Deno is not defined"
// (found live 2026-10-29, PO22 rolling plan + planning both 500). Tests (*.test.ts) may use Deno; production files may not.
import fs from "node:fs";
import path from "node:path";

const dir = "supabase/functions/api/_core/procurement";
const bad = [];
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
  const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n");
  lines.forEach((line, i) => { if (/\bDeno\./.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) bad.push(`${file}:${i + 1}: ${line.trim()}`); });
}
if (bad.length) {
  console.error("no-deno-in-procurement-guard: bare `Deno.` in production procurement code (crashes on the Node server):\n" + bad.join("\n"));
  process.exit(1);
}
console.log("no-deno-in-procurement-guard: OK");
