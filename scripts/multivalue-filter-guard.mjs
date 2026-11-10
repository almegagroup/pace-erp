#!/usr/bin/env node
/*
 * MultiValueFilterField value-shape guard -- found live 2026-11-10.
 *
 * Bug: <MultiValueFilterField value={X} onChange={setX} /> keeps an array of { value, label } ENTRY OBJECTS, not strings.
 * A page that did `X.join(",")` sent "[object Object]" to the API, so any chosen Material / SKU matched nothing and the
 * report came back empty (Gate Entry Report and IN15, prod, October "Fine Sand"). Plain JS has no types, ESLint cannot
 * see it, and the page still renders -- only a real click-through shows it.
 *
 * Rule: in a file that renders <MultiValueFilterField>, the state variable passed as `value={X}` must be turned into
 * ids with `X.map((entry) => entry.value)` before it is joined or searched. This guard fails on a DIRECT `X.join(` or
 * `X.includes(` (a `.map(...)` first puts a `)` before `.join`, so the correct form never matches).
 *
 * Scope is deliberately narrow (high precision over completeness, like the other guards): only the variables that are
 * literally bound to a MultiValueFilterField `value` prop in the same file, only `.join(` / `.includes(` / `.indexOf(`.
 * Pure Node built-ins -- CI runs no npm install.
 *
 * BASELINE: every pre-existing hit goes here with a one-line reason; the list may only shrink.
 *
 * Run: node scripts/multivalue-filter-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "frontend", "src");
const SKIP_DIRS = new Set(["node_modules", "dist"]);

// "<file relative to repo root>::<variable>" -> why it is allowed to stay. Empty = zero tolerance.
const BASELINE = new Map([]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".jsx")) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const violations = [];
let scanned = 0;
let bound = 0;

for (const file of walk(SRC_DIR)) {
  const raw = readFileSync(file, "utf8");
  if (!raw.includes("<MultiValueFilterField")) continue;
  scanned += 1;
  const source = stripComments(raw);
  const rel = relative(ROOT, file).split(sep).join("/");

  const variables = new Set();
  for (const element of source.matchAll(/<MultiValueFilterField\b([\s\S]*?)\/>/g)) {
    const valueProp = /\bvalue=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(element[1]);
    if (valueProp) variables.add(valueProp[1]);
  }
  bound += variables.size;

  for (const name of variables) {
    const misuse = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*\\.\\s*(join|includes|indexOf)\\s*\\(`, "g");
    for (const hit of source.matchAll(misuse)) {
      const key = `${rel}::${name}`;
      if (BASELINE.has(key)) continue;
      const line = source.slice(0, hit.index).split("\n").length;
      violations.push({ key, rel, name, method: hit[1], line });
    }
  }
}

console.log(`MultiValueFilterField guard -- scanned ${scanned} file(s), ${bound} value-bound variable(s), ${violations.length} violation(s).`);
if (violations.length > 0) {
  for (const v of violations) {
    console.error(`  ${v.rel}:~${v.line}  ${v.name}.${v.method}(...)  -- ${v.name} holds [{ value, label }] objects; use ${v.name}.map((entry) => entry.value) first`);
  }
  console.error("\nFAIL -- joining / searching the entry objects sends \"[object Object]\" and every chosen filter value matches nothing.");
  process.exit(1);
}
console.log("OK -- every MultiValueFilterField value is mapped to ids before it is joined or searched.");
