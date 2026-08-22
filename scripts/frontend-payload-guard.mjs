#!/usr/bin/env node
/*
 * Frontend Payload vs Backend Required-Field Guard — 13-bug-pattern #13
 * ("Frontend payload missing a backend-required field — not an ACL problem
 * at all")
 *
 * কী করে: একটা write (POST/PATCH/PUT) API-কে ব্যাকএন্ড handler যেসব field
 * mandatory ধরে (`if (!x) return errorResponse(..., 400, ...)` style guard),
 * সেই field frontend-এর কোনো call site যদি payload object literal-এ পাঠাতে
 * ভুলে যায়, সেটা ধরে। এই bug ACL-এর সাথে সম্পর্কহীন — full ACL grant থাকা
 * সত্ত্বেও শুধু payload-এ field মিসিং থাকার কারণে fail করে (real example:
 * Plan Feed-এর "+New Party" modal `createCustomer()` কে `company_id`/
 * `billing_state` ছাড়াই ডেকেছিল, P0062-এর ACL পুরো ঠিক ছিল, তাও fail করত)।
 *
 * এই repo-তে frontend plain JS/JSX, কোনো shared type/schema backend-এর
 * সাথে নেই — তাই আজ পর্যন্ত এই class-এর bug compile-time/lint-time কোনো
 * signal দেয় না, শুধু runtime-এ click করলে ধরা পড়ে। এই guard সেই gap-টা
 * build/CI-time-এ নিয়ে আসে।
 *
 * ⚠️ HEURISTIC, একটা real JS/TS parser নয় — house style অনুযায়ী (দেখো
 * hardcoded-role-check-guard.mjs, route-acl-registry-guard.mjs)।
 * নিচের সীমাবদ্ধতা গুলো ইচ্ছাকৃত, false-positive এড়ানোর জন্য (silent miss
 * থাকা মানে "spot-check, don't blindly trust" — কিন্তু silent false-FAIL
 * থাকলে developer-রা guard-টাকেই ignore করা শুরু করবে, যেটা আরও খারাপ):
 *
 *   1. শুধু SIMPLE `if (!<var>)` single-condition required-field check ধরে।
 *      Compound condition (`if ((!a && !b) || !c)`-এর মতো, যেমন Customer-এর
 *      "name OR vendor_id" OR-required shape) স্কিপ করা হয় — ওগুলো ধরতে
 *      real boolean-expression parsing লাগবে, false-positive-এর ঝুঁকি বেশি।
 *   2. শুধু object-literal payload call site ধরে (`fn({ a: 1, b: 2 })`)।
 *      কোনো call site যদি spread (`...something`) বা variable payload
 *      (`fn(payload)`, `fn(formState)`) পাঠায়, সেটা analyze করা সম্ভব না —
 *      SKIP করা হয়, INFO হিসেবে report হয়, FAIL না।
 *   3. শুধু 4টা business API wrapper file স্ক্যান করে (om/procurement/
 *      production/hr) — admin/SA-only API wrapper বাদ, কারণ SA universe-এ
 *      ACL/payload risk profile আলাদা (মানুষ কম, mistake-এর cost কম)।
 *
 * BASELINE = আজকের (2026-08-06) known gap, প্রতিটার reason সহ — অন্য guard
 * গুলোর মতোই একটা ceiling, নতুন gap বসলে FAIL করবে।
 *
 * চালাও:  node scripts/frontend-payload-guard.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

const API_FILES = [
  "frontend/src/pages/dashboard/om/omApi.js",
  "frontend/src/pages/dashboard/procurement/procurementApi.js",
  "frontend/src/pages/dashboard/production/prodApi.js",
  "frontend/src/pages/dashboard/hr/hrApi.js",
];

const ROUTES_DIR = "supabase/functions/api/_routes";
const CORE_DIR = "supabase/functions/api/_core";

const CALL_SITE_SCAN_ROOTS = ["frontend/src/pages", "frontend/src/admin", "frontend/src/components"];

/*
 * BASELINE — আজকে (2026-08-06) live-code-এ যা পাওয়া গেছে, প্রতিটার reason সহ।
 * নতুন করে এই pattern বসলে (নতুন call site যা কোনো required field মিস করে)
 * এই list-এ না থাকলে guard FAIL করবে।
 */
const BASELINE = new Set([
  // format: "callerFile::apiFunctionName::missingField"
  // Genuinely exempt (2026-08-22, feasibility doc §129.8) -- not an unfixed
  // gap. updateDepotCodeHandler treats parent_company_id/code as OPTIONAL
  // per-field updates (`if (body.field !== undefined)` gates, confirmed by
  // reading the handler directly), not unconditionally required -- this
  // guard's static heuristic can't tell "required only if this call intends
  // to change that field" from "always required". VdcParentCompanyMasterPage's
  // two call sites are each deliberately partial: the "Save" button edits a
  // VDC's own fields without touching parent_company_id, and the separate
  // "Map" button (the two-step unmap-then-map flow, §129's explicit design
  // correction) changes ONLY parent_company_id without touching code.
  "frontend/src/pages/dashboard/om/customer/VdcParentCompanyMasterPage.jsx::updateFgDepotCode::parent_company_id",
  "frontend/src/pages/dashboard/om/customer/VdcParentCompanyMasterPage.jsx::updateFgDepotCode::code",
]);

function readText(path) {
  return readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
}

function relPath(absOrRel) {
  const abs = absOrRel.startsWith(ROOT) ? absOrRel : join(ROOT, absOrRel);
  return relative(ROOT, abs).split(sep).join("/");
}

function walk(dir, filterRe, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, filterRe, out);
    else if (filterRe.test(entry)) out.push(full);
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Find the index of the `}` that matches the `{` at openIdx. */
function findMatchingBraceEnd(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Step 1 — parse each *Api.js file: exported function -> { method, path, hasBody }
// ---------------------------------------------------------------------------

function extractApiFunctions(apiRelPath) {
  const src = stripComments(readText(apiRelPath));
  const fns = [];
  const fnRe = /export\s+async\s+function\s+(\w+)\s*\(/g;
  let m;
  while ((m = fnRe.exec(src))) {
    const name = m[1];
    const parenStart = m.index + m[0].length - 1;
    let depth = 0;
    let i = parenStart;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const braceStart = src.indexOf("{", i);
    if (braceStart === -1) continue;
    const braceEnd = findMatchingBraceEnd(src, braceStart);
    if (braceEnd === -1) continue;
    const body = src.slice(braceStart, braceEnd + 1);

    const fetchMatch = body.match(/fetch(?:Json|AdminJsonSafe)?\s*\(\s*(?:`\$\{[^}]*\}([^`]*)`|["']([^"']+)["'])/);
    const methodMatch = body.match(/method\s*:\s*["'](\w+)["']/);
    if (!fetchMatch) continue;
    const path = (fetchMatch[1] ?? fetchMatch[2] ?? "").split("?")[0];
    const method = (methodMatch?.[1] ?? "GET").toUpperCase();
    if (!["POST", "PATCH", "PUT"].includes(method)) continue;
    if (!path) continue;

    fns.push({ name, method, path, file: apiRelPath });
  }
  return fns;
}

// ---------------------------------------------------------------------------
// Step 2 — resolve {method, path} -> handler function name -> handler file,
// by parsing _routes/*.routes.ts (exact "METHOD:/path" case + simple regex-if
// dispatch) and their top-of-file `import { a, b } from "../_core/x/y.ts"`.
// ---------------------------------------------------------------------------

function parseImportMap(routesSrc) {
  const map = new Map(); // handlerName -> core-relative file path
  const importRe = /import\s*\{([^}]+)\}\s*from\s*["'](\.\.\/_core\/[^"']+)["']/g;
  let m;
  while ((m = importRe.exec(routesSrc))) {
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const corePath = m[2].replace(/^\.\.\/_core\//, "").replace(/\.ts$/, ".ts");
    for (const n of names) map.set(n, `${CORE_DIR}/${corePath}`);
  }
  return map;
}

function extractDispatchedRoutes(routesSrc) {
  // exact: case "METHOD:/path": return await xHandler(
  const routes = [];
  const caseRe = /case\s+["'](\w+):(\/[^"']+)["']\s*:\s*[\s\S]{0,120}?(\w+Handler)\s*\(/g;
  let m;
  while ((m = caseRe.exec(routesSrc))) {
    routes.push({ method: m[1], path: m[2], handler: m[3] });
  }
  // if (/regex/.test(pathname) && req.method === "METHOD") { return await xHandler(
  const ifRe = /if\s*\(\s*\/(\^[^/]+\$)\/\.test\(pathname\)\s*&&\s*req\.method\s*===\s*["'](\w+)["']\s*\)\s*\{[\s\S]{0,200}?(\w+Handler)\s*\(/g;
  while ((m = ifRe.exec(routesSrc))) {
    routes.push({ method: m[2], pattern: m[1], handler: m[3] });
  }
  return routes;
}

function pathMatchesPattern(literalPath, patternSource) {
  try {
    const re = new RegExp(patternSource);
    return re.test(literalPath);
  } catch {
    return false;
  }
}

function resolveHandler(routesFiles, method, literalPath) {
  for (const rf of routesFiles) {
    const src = stripComments(readText(rf));
    const importMap = parseImportMap(src);
    const dispatched = extractDispatchedRoutes(src);
    for (const d of dispatched) {
      if (d.method !== method) continue;
      const matches = d.path ? d.path === literalPath : pathMatchesPattern(literalPath, d.pattern);
      if (matches && importMap.has(d.handler)) {
        return { handlerName: d.handler, handlerFile: importMap.get(d.handler) };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 3 — parse the handler's body for simple `if (!var) return ...400...`
// required-field checks, mapped back to the real `body.<field>` key.
// ---------------------------------------------------------------------------

function extractRequiredFields(handlerFile, handlerName) {
  let src;
  try {
    src = stripComments(readText(handlerFile));
  } catch {
    return null; // file not found — can't verify, caller should skip not fail
  }
  const fnRe = new RegExp(`(?:export\\s+)?async\\s+function\\s+${handlerName}\\s*\\(`);
  const m = fnRe.exec(src);
  if (!m) return null;
  const braceStart = src.indexOf("{", m.index);
  if (braceStart === -1) return null;
  const braceEnd = findMatchingBraceEnd(src, braceStart);
  if (braceEnd === -1) return null;
  const body = src.slice(braceStart, braceEnd + 1);

  // const fooVar = toTrimmedString(body.foo_field)   OR   const fooVar = body.foo_field
  const varToField = new Map();
  const assignRe = /const\s+(\w+)\s*=\s*(?:toTrimmedString\()?\s*body\.(\w+)/g;
  let am;
  while ((am = assignRe.exec(body))) {
    varToField.set(am[1], am[2]);
  }

  const required = new Set();
  // if (!fooVar) ... 400 ...   (single-condition only — see file header)
  const ifRe = /if\s*\(\s*!\s*(\w+)\s*\)\s*(?:\{|return)([\s\S]{0,200}?)(?:400|BAD_REQUEST)/g;
  let im;
  while ((im = ifRe.exec(body))) {
    const varName = im[1];
    const field = varToField.get(varName);
    if (field) required.add(field);
  }
  return required;
}

// ---------------------------------------------------------------------------
// Step 4 — scan frontend for call sites `apiFnName({ ...literal... })`
// ---------------------------------------------------------------------------

function extractTopLevelKeys(literalText) {
  const keys = [];
  let depth = 0;
  const keyRe = /(\w+)\s*:/g;
  for (let i = 0; i < literalText.length; i++) {
    const c = literalText[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
  }
  // depth-aware key scan (single pass, track depth as we go — redo properly)
  depth = 0;
  let i = 0;
  while (i < literalText.length) {
    const c = literalText[i];
    if (c === "{" || c === "[" || c === "(") { depth++; i++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; i++; continue; }
    if (depth === 1) {
      const rest = literalText.slice(i);
      // key: value  OR  ...spread  OR  shorthand `key,`/`key}`/`key ,`
      const kvMatch = /^(\w+)\s*:/.exec(rest);
      if (kvMatch) {
        keys.push(kvMatch[1]);
        i += kvMatch[0].length;
        continue;
      }
      const shorthandMatch = /^(\w+)\s*(,|\})/.exec(rest);
      if (shorthandMatch) {
        keys.push(shorthandMatch[1]);
        i += shorthandMatch[1].length; // advance past the identifier only, let the , or } be handled next loop
        continue;
      }
    }
    i++;
  }
  return keys;
}

function findCallSites(fileSrc, apiFnName) {
  const sites = [];
  const callRe = new RegExp(`\\b${apiFnName}\\s*\\(`, "g");
  let m;
  while ((m = callRe.exec(fileSrc))) {
    const argStart = m.index + m[0].length;
    // Only analyze if the very next non-whitespace char is `{` (object literal)
    let j = argStart;
    while (j < fileSrc.length && /\s/.test(fileSrc[j])) j++;
    if (fileSrc[j] !== "{") {
      sites.push({ kind: "non-literal", index: m.index });
      continue;
    }
    const braceEnd = findMatchingBraceEnd(fileSrc, j);
    if (braceEnd === -1) continue;
    const literal = fileSrc.slice(j, braceEnd + 1);
    if (literal.includes("...")) {
      sites.push({ kind: "spread", index: m.index });
      continue;
    }
    const keys = extractTopLevelKeys(literal);
    sites.push({ kind: "literal", index: m.index, keys });
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const routesFiles = walk(join(ROOT, ROUTES_DIR), /\.routes\.ts$/).map(relPath);
const callSiteFiles = CALL_SITE_SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r), /\.(jsx|js)$/)).map(relPath);

const failures = [];
const infoSkips = [];
let fnCount = 0;
let checkedCallSites = 0;

for (const apiFile of API_FILES) {
  let apiFns;
  try {
    apiFns = extractApiFunctions(apiFile);
  } catch (e) {
    console.error(`Could not read ${apiFile}: ${e.message}`);
    continue;
  }

  for (const fn of apiFns) {
    const resolved = resolveHandler(routesFiles, fn.method, fn.path);
    if (!resolved) continue; // couldn't resolve — not this guard's job (route-acl-registry-guard covers dispatch existence)
    const required = extractRequiredFields(resolved.handlerFile, resolved.handlerName);
    if (!required || required.size === 0) continue;
    fnCount += 1;

    for (const callerFile of callSiteFiles) {
      if (callerFile === apiFile) continue;
      const src = readText(callerFile);
      const importRe = new RegExp(`\\b${fn.name}\\b`);
      if (!importRe.test(src)) continue;
      const sites = findCallSites(src, fn.name);
      for (const site of sites) {
        if (site.kind !== "literal") {
          infoSkips.push({ callerFile, fn: fn.name, kind: site.kind });
          continue;
        }
        checkedCallSites += 1;
        const missing = [...required].filter((f) => !site.keys.includes(f));
        for (const field of missing) {
          const key = `${callerFile}::${fn.name}::${field}`;
          if (BASELINE.has(key)) continue;
          failures.push({ callerFile, apiFn: fn.name, field, handlerFile: resolved.handlerFile, handlerName: resolved.handlerName });
        }
      }
    }
  }
}

console.log(`Frontend payload guard — checked ${fnCount} write API function(s) with known required fields, ${checkedCallSites} object-literal call site(s), ${infoSkips.length} non-analyzable call site(s) skipped (spread/variable payload).`);

if (failures.length > 0) {
  console.error(`\nFAIL — ${failures.length} call site(s) construct a payload missing a backend-required field:`);
  for (const f of failures) {
    console.error(`  ${f.callerFile}\n    calls ${f.apiFn}() without required field "${f.field}"\n    (required by ${f.handlerName} in ${f.handlerFile})`);
  }
  console.error(`
This is 13-bug-pattern #13 ("Frontend payload missing a backend-required
field — not an ACL problem at all"). Either add the missing field to the
payload at this call site, or if this is a genuine, reviewed exception, add
"${failures[0].callerFile}::${failures[0].apiFn}::${failures[0].field}" to
BASELINE in this script with a one-line reason.`);
  process.exit(1);
}

console.log("OK — no write-API call site is missing a known backend-required field (outside documented baseline).");
