#!/usr/bin/env node
/*
 * Route/ACL Registry Guard — 11-bug-pattern #8 ("Route / ACL registry mismatch")
 *
 * কী করে: `_routes/*.routes.ts`-এ dispatch হওয়া every route central
 * route-acl-registry.ts-এ exact/pattern match পায় কিনা check করে। Support
 * routes (`ACL_SUPPORT_ROUTES`) আর runner-এর legacy HR fallback map exempt।
 *
 * কেন দরকার: route file-এ নতুন dispatch যোগ হয়ে registry update ভুলে গেলে
 * live request-এ গিয়ে ACL resolution fail করতে পারে। এই guard build-time-এই
 * exact missing route print করে fail করায়।
 *
 * Line-ending trap: route files mixed CRLF/LF, তাই সব file read করার পর আগে
 * normalize করা হয় (`\r\n`/`\r` -> `\n`)।
 *
 * চালাও: node scripts/route-acl-registry-guard.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const ROUTES_DIR = join(ROOT, "supabase", "functions", "api", "_routes");
const REGISTRY_FILE = join(ROOT, "supabase", "functions", "api", "_acl", "route-acl-registry.ts");
const RUNNER_FILE = join(ROOT, "supabase", "functions", "api", "_pipeline", "runner.ts");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const HTTP_METHOD_PATTERN = HTTP_METHODS.join("|");
// Non-capturing-group form — use this (not the bare HTTP_METHOD_PATTERN)
// anywhere the alternation is followed by more pattern content inside the
// same enclosing group (e.g. `(METHOD:path)`). `|` has the lowest regex
// precedence, so `(GET|POST|...|DELETE:[^"']+)` silently splits into
// "GET" / "POST" / "PUT" / "PATCH" / "DELETE:[^\"']+" — only the DELETE
// branch ever gets the suffix, and bare "GET"/"POST"/etc. never appear as
// literal strings anywhere in the source, so those branches never match
// either. Confirmed live 2026-08-06: this exact bug made
// extractExactRegistryRoutes/extractSetRouteKeys/extractLegacyHrRouteKeys
// return almost nothing, which is why the guard reported 369 false-positive
// "missing" routes on its first real run — not an actual backlog.
const HTTP_METHOD_GROUP = `(?:${HTTP_METHOD_PATTERN})`;

function relPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

function normalizeText(src) {
  return src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripComments(src) {
  let out = "";
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += "\n";
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      if (ch === "\n") {
        out += "\n";
      }
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
    }

    out += ch;

    if (ch === "\\" && (inSingleQuote || inDoubleQuote || inTemplate)) {
      out += next;
      i += 2;
      continue;
    }

    if (!inDoubleQuote && !inTemplate && ch === "'") {
      inSingleQuote = !inSingleQuote;
    } else if (!inSingleQuote && !inTemplate && ch === "\"") {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote && ch === "`") {
      inTemplate = !inTemplate;
    }

    i += 1;
  }

  return out;
}

function countChar(line, ch) {
  let count = 0;
  for (const current of line) {
    if (current === ch) count += 1;
  }
  return count;
}

function parseRegexLiteralAt(src, startIndex) {
  if (src[startIndex] !== "/") return null;

  let source = "";
  let i = startIndex + 1;
  let escaped = false;
  let inCharClass = false;

  while (i < src.length) {
    const ch = src[i];
    if (escaped) {
      source += ch;
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      source += ch;
      escaped = true;
      i += 1;
      continue;
    }
    if (ch === "[" && !inCharClass) {
      source += ch;
      inCharClass = true;
      i += 1;
      continue;
    }
    if (ch === "]" && inCharClass) {
      source += ch;
      inCharClass = false;
      i += 1;
      continue;
    }
    if (ch === "/" && !inCharClass) {
      let j = i + 1;
      while (/[a-z]/i.test(src[j] ?? "")) {
        j += 1;
      }
      return {
        source,
        endIndex: j,
      };
    }
    source += ch;
    i += 1;
  }

  return null;
}

function extractRegexSources(line) {
  const sources = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "/") continue;
    const literal = parseRegexLiteralAt(line, index);
    if (!literal) continue;
    if (line.slice(literal.endIndex).startsWith(".test(pathname)")) {
      sources.push(literal.source);
    }
    index = literal.endIndex - 1;
  }
  return sources;
}

function extractMethodChecks(line) {
  const methods = new Set();
  for (const match of line.matchAll(new RegExp(String.raw`req\.method\s*===\s*["'](${HTTP_METHOD_PATTERN})["']`, "g"))) {
    methods.add(match[1]);
  }
  for (const match of line.matchAll(new RegExp(String.raw`["'](${HTTP_METHOD_PATTERN})["']\s*===\s*req\.method`, "g"))) {
    methods.add(match[1]);
  }
  return [...methods];
}

function extractExactDispatchedRoutes(src, file) {
  const exactRoutes = [];
  const exactCasePattern = new RegExp(String.raw`case\s+["'](${HTTP_METHOD_PATTERN}):([^"']+)["']\s*:`, "g");
  for (const match of src.matchAll(exactCasePattern)) {
    exactRoutes.push({
      type: "exact",
      method: match[1],
      path: match[2].trim(),
      file,
    });
  }
  return exactRoutes;
}

function extractRegexDispatchedRoutes(src, file) {
  const routes = [];
  const lines = src.split("\n");
  let braceDepth = 0;
  let activePatternContexts = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const regexSources = extractRegexSources(line);
    const methods = extractMethodChecks(line);
    const openCount = countChar(line, "{");
    const closeCount = countChar(line, "}");
    const nextBraceDepth = braceDepth + openCount - closeCount;

    if (regexSources.length > 0 && methods.length > 0) {
      for (const patternSource of regexSources) {
        for (const method of methods) {
          routes.push({
            type: "pattern",
            method,
            patternSource,
            file,
          });
        }
      }
    }

    if (regexSources.length > 0 && methods.length === 0 && nextBraceDepth > braceDepth) {
      for (const patternSource of regexSources) {
        activePatternContexts.push({
          patternSource,
          depth: nextBraceDepth,
        });
      }
    }

    if (regexSources.length === 0 && methods.length > 0 && activePatternContexts.length > 0) {
      for (const context of activePatternContexts) {
        for (const method of methods) {
          routes.push({
            type: "pattern",
            method,
            patternSource: context.patternSource,
            file,
          });
        }
      }
    }

    braceDepth = nextBraceDepth;
    activePatternContexts = activePatternContexts.filter((context) => context.depth <= braceDepth);
  }

  return routes;
}

function extractDispatchedRoutes(file) {
  const normalized = normalizeText(readFileSync(file, "utf8"));
  const stripped = stripComments(normalized);
  return [
    ...extractExactDispatchedRoutes(stripped, relPath(file)),
    ...extractRegexDispatchedRoutes(stripped, relPath(file)),
  ];
}

function extractExactRegistryRoutes(src) {
  const routes = new Set();
  const pattern = new RegExp(String.raw`["'](${HTTP_METHOD_GROUP}:[^"']+)["']\s*:`, "g");
  for (const match of src.matchAll(pattern)) {
    routes.add(match[1].trim());
  }
  return routes;
}

function extractPatternRegistryRoutes(src) {
  const routes = new Map();
  const lines = src.split("\n");
  let currentPattern = null;
  let currentMethods = null;
  let entryDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (currentPattern === null && trimmed.startsWith("pattern: /")) {
      const slashIndex = line.indexOf("/", line.indexOf("pattern:"));
      const literal = parseRegexLiteralAt(line, slashIndex);
      if (!literal) continue;
      currentPattern = literal.source;
      currentMethods = new Set();
      entryDepth = 1 + countChar(line, "{") - countChar(line, "}");
      for (const methodMatch of line.matchAll(new RegExp(String.raw`\b(${HTTP_METHOD_PATTERN})\s*:`, "g"))) {
        currentMethods.add(methodMatch[1]);
      }
      continue;
    }

    if (currentPattern !== null) {
      entryDepth += countChar(line, "{") - countChar(line, "}");
      for (const methodMatch of line.matchAll(new RegExp(String.raw`\b(${HTTP_METHOD_PATTERN})\s*:`, "g"))) {
        currentMethods.add(methodMatch[1]);
      }
      if (entryDepth <= 0) {
        routes.set(currentPattern, currentMethods);
        currentPattern = null;
        currentMethods = null;
      }
    }
  }
  return routes;
}

function extractSetRouteKeys(src, setName) {
  const setBlockPattern = new RegExp(String.raw`const\s+${setName}\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)`, "m");
  const block = src.match(setBlockPattern)?.[1] ?? "";
  const routes = new Set();
  for (const match of block.matchAll(new RegExp(String.raw`["'](${HTTP_METHOD_GROUP}:[^"']+)["']`, "g"))) {
    routes.add(match[1].trim());
  }
  return routes;
}

function extractLegacyHrRouteKeys(src) {
  const hrBlockPattern = /const\s+hrRouteMeta:[^{]+\{([\s\S]*?)\n\s*\};/m;
  const block = src.match(hrBlockPattern)?.[1] ?? "";
  const routes = new Set();
  for (const match of block.matchAll(new RegExp(String.raw`["'](${HTTP_METHOD_GROUP}:[^"']+)["']\s*:`, "g"))) {
    routes.add(match[1].trim());
  }
  return routes;
}

const routeFiles = readdirSync(ROUTES_DIR)
  .filter((entry) => entry.endsWith(".routes.ts"))
  .map((entry) => join(ROUTES_DIR, entry))
  .sort();

const dispatchedRoutes = routeFiles.flatMap((file) => extractDispatchedRoutes(file));
const exactDispatches = [];
const patternDispatches = [];
const seenExactKeys = new Set();
const seenPatternKeys = new Set();

for (const route of dispatchedRoutes) {
  if (route.type === "exact") {
    const routeKey = `${route.method}:${route.path}`;
    if (seenExactKeys.has(routeKey)) continue;
    seenExactKeys.add(routeKey);
    exactDispatches.push({
      routeKey,
      method: route.method,
      path: route.path,
      file: route.file,
    });
    continue;
  }

  const patternKey = `${route.method}:/${route.patternSource}/`;
  if (seenPatternKeys.has(patternKey)) continue;
  seenPatternKeys.add(patternKey);
  patternDispatches.push({
    patternKey,
    method: route.method,
    patternSource: route.patternSource,
    file: route.file,
  });
}

const registrySource = stripComments(normalizeText(readFileSync(REGISTRY_FILE, "utf8")));
const runnerSource = stripComments(normalizeText(readFileSync(RUNNER_FILE, "utf8")));

const exactRegistryRoutes = extractExactRegistryRoutes(registrySource);
const patternRegistryRoutes = extractPatternRegistryRoutes(registrySource);
const supportRoutes = extractSetRouteKeys(runnerSource, "ACL_SUPPORT_ROUTES");
const legacyHrRoutes = extractLegacyHrRouteKeys(runnerSource);
// Gate-2 in resolveProtectedRouteAclMeta() (runner.ts) resolves this route's
// resourceCode dynamically from the workflow_requests row referenced by the
// request body — it can never have a static registry entry. Confirmed
// 2026-08-06 by reading runner.ts directly (search "Gate-2: Workflow
// decision").
const dynamicAclRoutes = new Set(["POST:/api/workflow/decision"]);
// KNOWN_UNAUTHORIZED_ROUTES — deliberately NOT registered, and must stay
// that way until each handler gets a real caller-side authorization check.
// Verified live 2026-08-06: none of these 8 handlers check the CALLING
// user's admin status anywhere in their body (grep + manual read of
// _core/auth/menu.handler.ts and _core/admin/signup/correct.handler.ts).
// previewUserHandler in particular only checks the TARGET user's
// profile.isAdmin, never ctx.context.isAdmin for the caller — meaning it
// would let any authenticated caller impersonate/preview as anyone.
// Right now these routes are only "safe" by accident: missing from the
// registry means Gate-6 throws ROUTE_ACL_NOT_REGISTERED before the handler
// ever runs. Registering any of these as skipAcl:true (the pattern used by
// every OTHER /api/admin/* route, which DOES self-gate on ctx.context.isAdmin)
// would open a real hole. Fix order: add ctx.context.isAdmin checks to each
// handler first, verify, THEN move its route out of this list into the
// registry as skipAcl:true — never the reverse.
const KNOWN_UNAUTHORIZED_ROUTES = new Set([
  "PATCH:/api/admin/signup-requests/correct", // correct.handler.ts — no auth check at all
  "GET:/api/admin/menu",                       // listMenuRegistryHandler — no auth check
  "POST:/api/admin/menu",                      // createMenuHandler — no auth check
  "PATCH:/api/admin/menu",                     // updateMenuHandler — no auth check
  "DELETE:/api/admin/menu",                    // deleteMenuHandler — no auth check
  "PATCH:/api/admin/menu/tree",                // updateMenuTreeHandler — no auth check
  "PATCH:/api/admin/menu/state",               // updateMenuStateHandler — no auth check
  "POST:/api/admin/preview-user",              // previewUserHandler — checks TARGET's isAdmin, never CALLER's
]);
const compiledPatternRegistryRoutes = [...patternRegistryRoutes.entries()].map(([patternSource, methods]) => ({
  patternSource,
  methods,
  regex: new RegExp(patternSource),
}));

const missingRoutes = [];
const knownUnauthorizedFindings = [];

for (const route of exactDispatches) {
  const isMatchedByPattern = compiledPatternRegistryRoutes.some(
    (entry) => entry.methods.has(route.method) && entry.regex.test(route.path),
  );
  if (exactRegistryRoutes.has(route.routeKey) || supportRoutes.has(route.routeKey) || legacyHrRoutes.has(route.routeKey) || dynamicAclRoutes.has(route.routeKey) || isMatchedByPattern) {
    continue;
  }
  if (KNOWN_UNAUTHORIZED_ROUTES.has(route.routeKey)) {
    knownUnauthorizedFindings.push({ label: route.routeKey, file: route.file });
    continue;
  }
  missingRoutes.push({
    kind: "exact",
    label: route.routeKey,
    file: route.file,
  });
}

for (const route of patternDispatches) {
  const registeredMethods = patternRegistryRoutes.get(route.patternSource);
  if (!registeredMethods) {
    missingRoutes.push({
      kind: "pattern",
      label: route.patternKey,
      file: route.file,
    });
    continue;
  }
  if (!registeredMethods.has(route.method)) {
    missingRoutes.push({
      kind: "pattern-method",
      label: route.patternKey,
      file: route.file,
    });
  }
}

const staleExactRoutes = [...exactRegistryRoutes]
  .filter((routeKey) => !seenExactKeys.has(routeKey))
  .sort();

const stalePatternRoutes = [];
for (const [patternSource, methods] of patternRegistryRoutes.entries()) {
  for (const method of methods) {
    const dispatchKey = `${method}:/${patternSource}/`;
    if (!seenPatternKeys.has(dispatchKey)) {
      stalePatternRoutes.push(`${method}:/${patternSource}/`);
    }
  }
}
stalePatternRoutes.sort();

console.log(
  `Route/ACL registry guard — scanned ${routeFiles.length} route file(s), ${exactDispatches.length} exact dispatch(es), ${patternDispatches.length} pattern dispatch(es), ${missingRoutes.length} missing registry match(es) found`,
);

if (missingRoutes.length > 0) {
  console.error("\nFAIL — route dispatched in _routes/*.routes.ts but NOT resolved by the ACL registry/runtime exemption set:");
  for (const route of missingRoutes) {
    console.error(`  ${route.label}`);
    console.error(`    source: ${route.file}`);
  }
  process.exit(1);
}

console.log("OK — every dispatched route resolves via EXACT_ROUTE_ACL, PATTERN_ROUTE_ACL, or a documented runner exemption.");

if (knownUnauthorizedFindings.length > 0) {
  console.log(`\nWARNING — ${knownUnauthorizedFindings.length} route(s) deliberately left unregistered because their handler has NO caller-side authorization check (KNOWN_UNAUTHORIZED_ROUTES). They currently 500 for everyone, which is the safe state — do not register them until the handler is fixed:`);
  for (const route of knownUnauthorizedFindings) {
    console.log(`  ${route.label}`);
    console.log(`    source: ${route.file}`);
  }
}

if (staleExactRoutes.length > 0 || stalePatternRoutes.length > 0) {
  console.log("\nINFO — registry entries with no current dispatch match (likely stale/dead config):");
  for (const routeKey of staleExactRoutes) {
    console.log(`  exact: ${routeKey}`);
  }
  for (const routeKey of stalePatternRoutes) {
    console.log(`  pattern: ${routeKey}`);
  }
}
