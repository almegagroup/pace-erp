#!/usr/bin/env node
/*
 * SU24-Style Dependency Provisioning Check
 *
 * কী করে: frontend screen registry + AppRouter + PAGE-DEPENDENCY-MANIFEST.json
 * cross-join করে বের করে কোন real page (menu_visible=true VIEW access) আর কোন
 * ACL-gated dependency resource/action-এর উপর নির্ভর করে। তারপর সেই mapping
 * embed করে SQL print করে, যেটা dev/prod-এ আলাদা করে চালিয়ে gap report পাওয়া
 * যাবে: যে department/page access রাখে, সে department কি page-এর নিজস্ব
 * dependency grant-গুলোও রাখে?
 *
 * SAP SU24-এর মতো intent: page add/ACL design হওয়ার পর human guess না করে
 * code-verified dependency list থেকে missing companion grants ধরা।
 *
 * ⚠️ এই script কখনো database-এ connect করে না — শুধু computed mapping + SQL print
 * করে। SQL আলাদা করে MCP/SQL editor দিয়ে dev/prod-এ চালাতে হবে।
 *
 * ⚠️ এই script কিছুই auto-apply করে না। LOW/MEDIUM gap-এর জন্য helper SQL
 * generator print করে, but apply সবসময় আলাদা explicit ACL/version workflow।
 *
 * Future-automation hooks (intentionally kept stable):
 * 1. resource_code -> page file lookup is computed generically, not hardcoded
 * 2. dependency triples are emitted as structured JSON for review/reuse
 * 3. SQL embeds a normalized dependency_map CTE that a future auto-provisioner
 *    can reuse for draft capability creation / approval flow
 *
 * চালাও: node scripts/dependency-provisioning-check.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cwdRoot = process.cwd();
const fileDerivedRoot = path.resolve(__dirname, "..");
const repoRoot = fs.existsSync(path.join(cwdRoot, "frontend", "package.json"))
  ? cwdRoot
  : fileDerivedRoot;
// Vendored, not required from frontend/node_modules -- CI never runs `npm
// install`, so a live node_modules path would MODULE_NOT_FOUND there (found
// live 2026-08-21, on this guard's first real PR run). See
// scripts/vendor/babel-parser/README.md for what/why.
const requireModule = createRequire(import.meta.url);
const { parse } = requireModule(
  path.join(__dirname, "vendor", "babel-parser", "index.js"),
);

const TARGET_COMPANIES = [
  { id: "c04f0a8b-ecf0-48ee-becc-174fc377723e", code: "CMP003" },
  { id: "88240088-9af7-46f5-86af-c4e635d3c9cd", code: "CMP006" },
];

const EXCLUDED_WORK_CONTEXTS = [
  "ACL-MASTER",
  "DIRECTOR",
  "DIRECTOR-REPORTS",
  "MANAGEMENT-REPORTS",
];

const MANIFEST_PATH = path.join(
  repoRoot,
  "docs",
  "Operation Management",
  "implementation-specs",
  "PAGE-DEPENDENCY-MANIFEST.json",
);
const ROUTER_PATH = path.join(repoRoot, "frontend", "src", "router", "AppRouter.jsx");
const SCREEN_ROOT = path.join(repoRoot, "frontend", "src", "navigation", "screens");
const SAFE_MODES = new Set(["report", "summary", "triples-json", "gap-sql", "suggest-sql"]);
const DEFAULT_MODE = "report";
const STRICT_WARNING_EXIT_CODE = 2;

function parseArgs(argv) {
  const options = {
    mode: DEFAULT_MODE,
    strictManifest: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--strict-manifest") {
      options.strictManifest = true;
      continue;
    }
    if (arg === "--mode") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --mode");
      }
      options.mode = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = arg.split("=", 2)[1];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!SAFE_MODES.has(options.mode)) {
    throw new Error(`Unsupported mode "${options.mode}". Supported modes: ${[...SAFE_MODES].join(", ")}`);
  }

  return options;
}

function buildHelpText() {
  return [
    "Usage: node scripts/dependency-provisioning-check.mjs [options]",
    "",
    "Read-only SU24-style dependency provisioning helper.",
    "This script never connects to a DB and never applies ACL changes.",
    "",
    "Options:",
    "  --mode report         Full human-readable report (default)",
    "  --mode summary        Header + counts + warnings only",
    "  --mode triples-json   Machine-readable dependency map / warnings / stats",
    "  --mode gap-sql        Only the gap-detection SQL",
    "  --mode suggest-sql    Only the helper SQL for LOW/MEDIUM draft suggestions",
    "  --strict-manifest     Exit non-zero if manifest is stale or routed pages are missing manifest coverage",
    "  --help                Show this help text",
  ].join("\n");
}

function parseModule(filePath) {
  return parse(fs.readFileSync(filePath, "utf8"), {
    sourceType: "module",
    plugins: ["jsx"],
  });
}

function walk(node, visitor) {
  if (!node || typeof node !== "object") {
    return;
  }
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, visitor);
      }
    } else if (value && typeof value === "object" && value.type) {
      walk(value, visitor);
    }
  }
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function resolveImport(importerPath, sourceValue) {
  const base = path.resolve(path.dirname(importerPath), sourceValue);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeRoute(routePath) {
  if (!routePath) {
    return "/";
  }
  let normalized = routePath.replace(/\\/g, "/").trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  normalized = normalized.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function joinRoute(parentPath, childPath) {
  if (!childPath) {
    return normalizeRoute(parentPath || "/");
  }
  if (childPath.startsWith("/")) {
    return normalizeRoute(childPath);
  }
  const parent = normalizeRoute(parentPath || "/");
  if (parent === "/") {
    return normalizeRoute(`/${childPath}`);
  }
  return normalizeRoute(`${parent}/${childPath}`);
}

function getStringAttributeValue(attribute) {
  if (!attribute?.value) {
    return null;
  }
  if (attribute.value.type === "StringLiteral") {
    return attribute.value.value;
  }
  if (
    attribute.value.type === "JSXExpressionContainer" &&
    attribute.value.expression?.type === "StringLiteral"
  ) {
    return attribute.value.expression.value;
  }
  return null;
}

function getRouteElementComponent(attribute) {
  if (
    attribute?.value?.type !== "JSXExpressionContainer" ||
    attribute.value.expression?.type !== "JSXElement"
  ) {
    return null;
  }
  const opening = attribute.value.expression.openingElement;
  if (opening?.name?.type === "JSXIdentifier") {
    return opening.name.name;
  }
  return null;
}

function getJsxName(node) {
  if (!node?.openingElement?.name) {
    return null;
  }
  const { name } = node.openingElement;
  if (name.type === "JSXIdentifier") {
    return name.name;
  }
  return null;
}

function readAllScreenFiles(rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readAllScreenFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith("Screens.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function readScreenRegistry(screenFile) {
  const ast = parseModule(screenFile);
  const entries = [];

  for (const node of ast.program.body) {
    if (node.type !== "ExportNamedDeclaration" || node.declaration?.type !== "VariableDeclaration") {
      continue;
    }
    for (const declarator of node.declaration.declarations) {
      if (declarator.init?.type !== "CallExpression") {
        continue;
      }
      if (
        declarator.init.callee?.type !== "MemberExpression" &&
        declarator.init.callee?.type !== "Identifier"
      ) {
        continue;
      }
      const objectArg = declarator.init.arguments?.[0];
      if (objectArg?.type !== "ObjectExpression") {
        continue;
      }
      for (const property of objectArg.properties) {
        if (property.type !== "ObjectProperty" || property.value?.type !== "ObjectExpression") {
          continue;
        }
        let screenCode = null;
        let route = null;
        for (const nested of property.value.properties) {
          if (nested.type !== "ObjectProperty") {
            continue;
          }
          const keyName =
            nested.key.type === "Identifier"
              ? nested.key.name
              : nested.key.type === "StringLiteral"
                ? nested.key.value
                : null;
          if (!keyName) {
            continue;
          }
          if (keyName === "screen_code" && nested.value.type === "StringLiteral") {
            screenCode = nested.value.value;
          }
          if (keyName === "route" && nested.value.type === "StringLiteral") {
            route = nested.value.value;
          }
        }
        if (screenCode && route) {
          entries.push({
            screenCode,
            route: normalizeRoute(route),
            sourceFile: toRepoRelative(screenFile),
          });
        }
      }
    }
  }

  return entries;
}

function findAppRouterFunction(ast) {
  for (const node of ast.program.body) {
    if (
      node.type === "ExportDefaultDeclaration" &&
      (node.declaration?.type === "FunctionDeclaration" || node.declaration?.type === "ArrowFunctionExpression")
    ) {
      return node.declaration;
    }
    if (node.type === "FunctionDeclaration" && node.id?.name === "AppRouter") {
      return node;
    }
  }
  return null;
}

function collectImports(ast, routerFile) {
  const imports = new Map();
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") {
      continue;
    }
    const resolved = resolveImport(routerFile, node.source.value);
    if (!resolved) {
      continue;
    }
    for (const specifier of node.specifiers) {
      if (!specifier.local?.name) {
        continue;
      }
      imports.set(specifier.local.name, toRepoRelative(resolved));
    }
  }
  return imports;
}

function findRoutesJsx(functionNode) {
  let routesJsx = null;
  walk(functionNode.body, (node) => {
    if (routesJsx || node.type !== "JSXElement") {
      return;
    }
    if (getJsxName(node) === "Routes") {
      routesJsx = node;
    }
  });
  return routesJsx;
}

function collectRouteMappingsFromJsx(routesNode) {
  const routeToComponent = new Map();

  function processChild(node, parentPath = "/") {
    if (!node || node.type !== "JSXElement" || getJsxName(node) !== "Route") {
      return;
    }

    const attributes = new Map();
    for (const attribute of node.openingElement.attributes || []) {
      if (attribute.type === "JSXAttribute" && attribute.name?.name) {
        attributes.set(attribute.name.name, attribute);
      }
    }

    const rawPath = getStringAttributeValue(attributes.get("path"));
    const componentName = getRouteElementComponent(attributes.get("element"));
    const currentPath = rawPath ? joinRoute(parentPath, rawPath) : normalizeRoute(parentPath);

    if (rawPath && componentName) {
      routeToComponent.set(currentPath, componentName);
    }

    const childBasePath = rawPath ? currentPath : parentPath;
    for (const child of node.children || []) {
      processChild(child, childBasePath);
    }
  }

  for (const child of routesNode.children || []) {
    processChild(child, "/");
  }

  return routeToComponent;
}

function collectRouterMappings(routerFile) {
  const ast = parseModule(routerFile);
  const imports = collectImports(ast, routerFile);
  const appRouterFn = findAppRouterFunction(ast);
  if (!appRouterFn) {
    throw new Error("Could not locate AppRouter function in AppRouter.jsx");
  }
  const routesJsx = findRoutesJsx(appRouterFn);
  if (!routesJsx) {
    throw new Error("Could not locate <Routes> tree in AppRouter.jsx");
  }
  const routeToComponent = collectRouteMappingsFromJsx(routesJsx);
  const routeToFile = new Map();
  for (const [routePath, componentName] of routeToComponent.entries()) {
    const filePath = imports.get(componentName);
    if (filePath) {
      routeToFile.set(routePath, filePath);
    }
  }
  return { imports, routeToComponent, routeToFile };
}

function dedupeDependencies(deps) {
  const unique = new Map();
  for (const dep of deps) {
    const key = `${dep.resourceCode}::${dep.action}`;
    if (!unique.has(key)) {
      unique.set(key, dep);
    }
  }
  return [...unique.values()];
}

function computeManifestFreshness(manifestPath) {
  const manifestStat = fs.statSync(manifestPath);
  let latestPagesCommit = null;
  try {
    latestPagesCommit = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", "frontend/src/pages"],
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
  } catch {
    latestPagesCommit = null;
  }

  if (!latestPagesCommit) {
    return {
      warning: "Manifest freshness could not be checked from git log.",
    };
  }

  const manifestTime = manifestStat.mtime;
  const latestPagesTime = new Date(latestPagesCommit);
  const diffDays = Math.floor((latestPagesTime - manifestTime) / (1000 * 60 * 60 * 24));
  if (diffDays > 21) {
    return {
      warning: `Manifest may be stale: latest frontend/src/pages git change is ${latestPagesCommit}, manifest file mtime is ${manifestTime.toISOString()} (${diffDays} days older).`,
    };
  }
  return {
    ok: `Manifest freshness looks acceptable: latest frontend/src/pages git change ${latestPagesCommit}, manifest mtime ${manifestTime.toISOString()}.`,
  };
}

function requiresManifestCoverage(pageFile) {
  const normalized = String(pageFile || "").replace(/\\/g, "/");
  return normalized.startsWith("frontend/src/pages/dashboard/");
}

function buildDependencyData() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const manifestByPage = new Map(manifest.map((entry) => [entry.page, entry]));

  const screenEntries = readAllScreenFiles(SCREEN_ROOT).flatMap(readScreenRegistry);
  const routeToResource = new Map(screenEntries.map((entry) => [entry.route, entry.screenCode]));
  const { routeToComponent, routeToFile } = collectRouterMappings(ROUTER_PATH);

  const resourceToFile = new Map();
  const joinWarnings = [];
  for (const entry of screenEntries) {
    const filePath = routeToFile.get(entry.route);
    if (filePath) {
      resourceToFile.set(entry.screenCode, filePath);
    }
  }

  for (const entry of screenEntries) {
    if (!routeToFile.has(entry.route)) {
      joinWarnings.push(
        `No AppRouter file match for ${entry.screenCode} route ${entry.route} (registry source ${entry.sourceFile})`,
      );
    }
  }

  const pageResources = new Set(resourceToFile.keys());
  const dependencyRows = [];
  const resourcesMissingManifest = [];

  for (const [owningResourceCode, pageFile] of resourceToFile.entries()) {
    const manifestEntry = manifestByPage.get(pageFile);
    if (!manifestEntry) {
      if (requiresManifestCoverage(pageFile)) {
        resourcesMissingManifest.push(`${owningResourceCode} -> ${pageFile}`);
      }
      continue;
    }
    const deps = dedupeDependencies(
      (manifestEntry.deps || []).filter(
        (dep) =>
          dep &&
          dep.resourceCode &&
          dep.resourceCode !== "UNRESOLVED" &&
          dep.skipAcl !== true &&
          dep.resourceCode !== owningResourceCode,
      ),
    );
    for (const dep of deps) {
      const dependencyIsPage = pageResources.has(dep.resourceCode);
      const riskFlag =
        dep.action === "VIEW"
          ? "LOW"
          : dep.action === "WRITE" || dep.action === "EDIT"
            ? dependencyIsPage
              ? "HIGH"
              : "MEDIUM"
            : dep.action === "DELETE" || dep.action === "APPROVE"
              ? "HIGH"
              : dependencyIsPage
                ? "HIGH"
                : "MEDIUM";

      dependencyRows.push({
        owningResourceCode,
        owningPage: pageFile,
        dependencyResourceCode: dep.resourceCode,
        dependencyAction: dep.action,
        dependencyFn: dep.fn || "",
        dependencyMethod: dep.method || "",
        dependencyPath: dep.path || "",
        dependencyIsPage,
        riskFlag,
      });
    }
  }

  dependencyRows.sort((a, b) =>
    `${a.owningResourceCode}:${a.dependencyResourceCode}:${a.dependencyAction}`.localeCompare(
      `${b.owningResourceCode}:${b.dependencyResourceCode}:${b.dependencyAction}`,
    ),
  );

  return {
    manifest,
    routeToResource,
    routeToComponent,
    routeToFile,
    resourceToFile,
    dependencyRows,
    pageResources,
    joinWarnings,
    resourcesMissingManifest,
  };
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildDependencyMapValues(rows) {
  return rows
    .map((row) =>
      [
        sqlString(row.owningResourceCode),
        sqlString(row.owningPage),
        sqlString(row.dependencyResourceCode),
        sqlString(row.dependencyAction),
        sqlString(row.dependencyFn),
        sqlString(row.dependencyMethod),
        sqlString(row.dependencyPath),
        row.dependencyIsPage ? "TRUE" : "FALSE",
        sqlString(row.riskFlag),
      ].join(", "),
    )
    .map((tuple) => `    (${tuple})`)
    .join(",\n");
}

function buildSql(rows) {
  const dependencyValues = buildDependencyMapValues(rows);
  const companyValues = TARGET_COMPANIES.map(
    (company) => `    ('${company.id}'::uuid, '${company.code}')`,
  ).join(",\n");
  const excludedValues = EXCLUDED_WORK_CONTEXTS.map((name) => `    (${sqlString(name)})`).join(",\n");

  const gapQuery = `-- SU24-style dependency provisioning gap report
-- Run this whole SQL script against dev or prod separately.
-- Result set 1 = page-owning department has standalone page access but misses one
-- or more of that page's own ACL-gated dependencies.
-- Result set 2 = suggested SQL generator for LOW/MEDIUM gaps only.
--
-- HIGH risk rows are intentionally report-only: they need explicit business-owner
-- confirmation (Type গ) before any ACL change is even proposed.

WITH target_companies (company_id, company_code) AS (
  VALUES
${companyValues}
),
excluded_work_contexts (work_context_name) AS (
  VALUES
${excludedValues}
),
dependency_map (
  owning_resource_code,
  owning_page,
  dependency_resource_code,
  dependency_action,
  dependency_fn,
  dependency_method,
  dependency_path,
  dependency_is_page,
  risk_flag
) AS (
  VALUES
${dependencyValues}
),
active_versions AS (
  SELECT av.acl_version_id, av.company_id
  FROM acl.acl_versions av
  JOIN target_companies tc ON tc.company_id = av.company_id
  WHERE av.is_active = TRUE
),
active_acl AS (
  SELECT
    pav.acl_version_id,
    pav.company_id,
    tc.company_code,
    pav.work_context_id,
    wc.work_context_name,
    pav.resource_code,
    pav.action_code,
    pav.decision,
    pav.menu_visible
  FROM acl.precomputed_acl_view pav
  JOIN active_versions av
    ON av.acl_version_id = pav.acl_version_id
   AND av.company_id = pav.company_id
  JOIN target_companies tc
    ON tc.company_id = pav.company_id
  JOIN erp_acl.work_contexts wc
    ON wc.work_context_id = pav.work_context_id
),
owning_allow AS (
  SELECT DISTINCT
    aa.acl_version_id,
    aa.company_id,
    aa.company_code,
    aa.work_context_id,
    aa.work_context_name,
    dm.owning_resource_code,
    dm.owning_page
  FROM active_acl aa
  JOIN dependency_map dm
    ON dm.owning_resource_code = aa.resource_code
  LEFT JOIN excluded_work_contexts ewc
    ON ewc.work_context_name = aa.work_context_name
  WHERE aa.action_code = 'VIEW'
    AND aa.decision = 'ALLOW'
    AND aa.menu_visible = TRUE
    AND ewc.work_context_name IS NULL
),
gaps AS (
  SELECT
    oa.acl_version_id,
    oa.company_id,
    oa.company_code,
    oa.work_context_id,
    oa.work_context_name,
    dm.owning_resource_code,
    dm.owning_page,
    dm.dependency_resource_code,
    dm.dependency_action,
    dm.dependency_fn,
    dm.dependency_method,
    dm.dependency_path,
    dm.dependency_is_page,
    dm.risk_flag
  FROM owning_allow oa
  JOIN dependency_map dm
    ON dm.owning_resource_code = oa.owning_resource_code
  WHERE NOT EXISTS (
    SELECT 1
    FROM active_acl dep
    WHERE dep.company_id = oa.company_id
      AND dep.work_context_id = oa.work_context_id
      AND dep.resource_code = dm.dependency_resource_code
      AND dep.action_code = dm.dependency_action
      AND dep.decision = 'ALLOW'
  )
)
SELECT
  company_code,
  work_context_name,
  owning_resource_code,
  dependency_resource_code,
  dependency_action,
  risk_flag,
  CASE
    WHEN risk_flag = 'LOW' THEN 'Likely Type খ — safe hidden VIEW companion candidate.'
    WHEN risk_flag = 'MEDIUM' THEN 'Likely Type ক — confirm inline embedded write, then hidden companion candidate.'
    ELSE 'Possible Type গ — do not auto-suggest; needs explicit business-owner confirmation.'
  END AS triage_note,
  owning_page,
  dependency_fn,
  dependency_method,
  dependency_path
FROM gaps
ORDER BY company_code, work_context_name, owning_resource_code, dependency_resource_code, dependency_action;
`;

  const suggestionQuery = `-- Suggested dependency capability helper SQL
-- LOW/MEDIUM only. Review manually before any ACL version workflow.

WITH target_companies (company_id, company_code) AS (
  VALUES
${companyValues}
),
excluded_work_contexts (work_context_name) AS (
  VALUES
${excludedValues}
),
dependency_map (
  owning_resource_code,
  owning_page,
  dependency_resource_code,
  dependency_action,
  dependency_fn,
  dependency_method,
  dependency_path,
  dependency_is_page,
  risk_flag
) AS (
  VALUES
${dependencyValues}
),
active_versions AS (
  SELECT av.acl_version_id, av.company_id
  FROM acl.acl_versions av
  JOIN target_companies tc ON tc.company_id = av.company_id
  WHERE av.is_active = TRUE
),
active_acl AS (
  SELECT
    pav.acl_version_id,
    pav.company_id,
    tc.company_code,
    pav.work_context_id,
    wc.work_context_name,
    pav.resource_code,
    pav.action_code,
    pav.decision,
    pav.menu_visible
  FROM acl.precomputed_acl_view pav
  JOIN active_versions av
    ON av.acl_version_id = pav.acl_version_id
   AND av.company_id = pav.company_id
  JOIN target_companies tc
    ON tc.company_id = pav.company_id
  JOIN erp_acl.work_contexts wc
    ON wc.work_context_id = pav.work_context_id
),
owning_allow AS (
  SELECT DISTINCT
    aa.acl_version_id,
    aa.company_id,
    aa.company_code,
    aa.work_context_id,
    aa.work_context_name,
    dm.owning_resource_code,
    dm.owning_page
  FROM active_acl aa
  JOIN dependency_map dm
    ON dm.owning_resource_code = aa.resource_code
  LEFT JOIN excluded_work_contexts ewc
    ON ewc.work_context_name = aa.work_context_name
  WHERE aa.action_code = 'VIEW'
    AND aa.decision = 'ALLOW'
    AND aa.menu_visible = TRUE
    AND ewc.work_context_name IS NULL
),
gaps AS (
  SELECT
    oa.acl_version_id,
    oa.company_id,
    oa.company_code,
    oa.work_context_id,
    oa.work_context_name,
    dm.owning_resource_code,
    dm.owning_page,
    dm.dependency_resource_code,
    dm.dependency_action,
    dm.dependency_fn,
    dm.risk_flag
  FROM owning_allow oa
  JOIN dependency_map dm
    ON dm.owning_resource_code = oa.owning_resource_code
  WHERE NOT EXISTS (
    SELECT 1
    FROM active_acl dep
    WHERE dep.company_id = oa.company_id
      AND dep.work_context_id = oa.work_context_id
      AND dep.resource_code = dm.dependency_resource_code
      AND dep.action_code = dm.dependency_action
      AND dep.decision = 'ALLOW'
  )
),
low_medium_gaps AS (
  SELECT *
  FROM gaps
  WHERE risk_flag IN ('LOW', 'MEDIUM')
),
acl_menu_resource_map AS (
  SELECT
    amm.id AS menu_id,
    COALESCE(emr.resource_code, emc.resource_code, amm.menu_code) AS resource_code
  FROM acl.menu_master amm
  LEFT JOIN erp_menu.menu_master emr
    ON emr.resource_code = amm.menu_code
  LEFT JOIN erp_menu.menu_master emc
    ON emc.menu_code = amm.menu_code
),
source_capabilities AS (
  SELECT DISTINCT
    lmg.acl_version_id,
    lmg.company_id,
    lmg.company_code,
    lmg.work_context_id,
    lmg.work_context_name,
    lmg.owning_resource_code,
    vwcc.capability_code
  FROM low_medium_gaps lmg
  JOIN acl.version_work_context_capabilities vwcc
    ON vwcc.acl_version_id = lmg.acl_version_id
   AND vwcc.work_context_id = lmg.work_context_id
  JOIN acl.version_capability_menu_actions vcma
    ON vcma.acl_version_id = lmg.acl_version_id
   AND vcma.capability_code = vwcc.capability_code
   AND vcma.allowed = TRUE
   AND vcma.menu_visible = TRUE
   AND vcma.action = 'VIEW'
  JOIN acl_menu_resource_map arm
    ON arm.menu_id = vcma.menu_id
   AND arm.resource_code = lmg.owning_resource_code
),
source_capability_choice AS (
  SELECT
    sc.*,
    COUNT(*) OVER (
      PARTITION BY sc.company_id, sc.work_context_id, sc.owning_resource_code
    ) AS source_capability_count,
    ROW_NUMBER() OVER (
      PARTITION BY sc.company_id, sc.work_context_id, sc.owning_resource_code
      ORDER BY sc.capability_code
    ) AS rn
  FROM source_capabilities sc
),
source_roles AS (
  SELECT
    scc.acl_version_id,
    scc.company_id,
    scc.company_code,
    scc.work_context_id,
    scc.work_context_name,
    scc.owning_resource_code,
    scc.capability_code AS source_capability_code,
    scc.source_capability_count,
    ARRAY_AGG(DISTINCT vrc.role_code ORDER BY vrc.role_code) AS role_codes
  FROM source_capability_choice scc
  JOIN acl.version_role_capabilities vrc
    ON vrc.acl_version_id = scc.acl_version_id
   AND vrc.capability_code = scc.capability_code
  WHERE scc.rn = 1
  GROUP BY
    scc.acl_version_id,
    scc.company_id,
    scc.company_code,
    scc.work_context_id,
    scc.work_context_name,
    scc.owning_resource_code,
    scc.capability_code,
    scc.source_capability_count
),
grouped_suggestions AS (
  SELECT
    lmg.acl_version_id,
    lmg.company_id,
    lmg.company_code,
    lmg.work_context_id,
    lmg.work_context_name,
    lmg.owning_resource_code,
    sr.source_capability_code,
    sr.source_capability_count,
    sr.role_codes,
    ARRAY_AGG(
      DISTINCT (lmg.dependency_resource_code || ':' || lmg.dependency_action)
      ORDER BY (lmg.dependency_resource_code || ':' || lmg.dependency_action)
    ) AS dependency_pairs
  FROM low_medium_gaps lmg
  LEFT JOIN source_roles sr
    ON sr.acl_version_id = lmg.acl_version_id
   AND sr.company_id = lmg.company_id
   AND sr.work_context_id = lmg.work_context_id
   AND sr.owning_resource_code = lmg.owning_resource_code
  GROUP BY
    lmg.acl_version_id,
    lmg.company_id,
    lmg.company_code,
    lmg.work_context_id,
    lmg.work_context_name,
    lmg.owning_resource_code,
    sr.source_capability_code,
    sr.source_capability_count,
    sr.role_codes
)
SELECT
  company_code,
  work_context_name,
  owning_resource_code,
  source_capability_code,
  dependency_pairs,
  CASE
    WHEN source_capability_code IS NULL THEN
      '-- MANUAL: could not identify a visible owning capability for '
      || work_context_name || ' / ' || owning_resource_code
      || '. Pick the source capability manually, then clone its role list.'
    WHEN source_capability_count <> 1 THEN
      '-- MANUAL: ambiguous source capability for '
      || work_context_name || ' / ' || owning_resource_code
      || ' (found ' || source_capability_count || '). Review before generating dependency capability.'
    ELSE
      '-- Suggested dependency capability for ' || company_code || ' / ' || work_context_name || E'\\n'
      || '-- Source capability: ' || source_capability_code || E'\\n'
      || '-- Suggested capability code: ' || source_capability_code || '_DEPENDENCY' || E'\\n'
      || '-- Role list copied from source capability: '
      || array_to_string(role_codes, ', ') || E'\\n'
      || '-- Review before running; this is a printed helper, not auto-apply.' || E'\\n'
      || 'BEGIN;' || E'\\n'
      || 'INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system) VALUES (' || E'\\n'
      || '  ' || quote_literal(source_capability_code || '_DEPENDENCY') || ',' || E'\\n'
      || '  ' || quote_literal(source_capability_code || ' Dependency') || ',' || E'\\n'
      || '  ' || quote_literal('Suggested hidden dependency companion for ' || work_context_name || ' on ' || owning_resource_code) || ',' || E'\\n'
      || '  FALSE' || E'\\n'
      || ') ON CONFLICT (capability_code) DO NOTHING;' || E'\\n'
      || E'\\n'
      || 'INSERT INTO acl.role_capabilities (role_code, capability_code)' || E'\\n'
      || 'SELECT rc.role_code, ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\\n'
      || 'FROM acl.role_capabilities rc' || E'\\n'
      || 'WHERE rc.capability_code = ' || quote_literal(source_capability_code) || E'\\n'
      || 'ON CONFLICT DO NOTHING;' || E'\\n'
      || E'\\n'
      || 'INSERT INTO acl.work_context_capabilities (work_context_id, capability_code) VALUES (' || E'\\n'
      || '  ' || quote_literal(work_context_id::text) || '::uuid,' || E'\\n'
      || '  ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\\n'
      || ') ON CONFLICT DO NOTHING;' || E'\\n'
      || E'\\n'
      || 'INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)' || E'\\n'
      || 'SELECT ' || quote_literal(source_capability_code || '_DEPENDENCY') || ', mm.id, dep.action_code, TRUE, FALSE' || E'\\n'
      || 'FROM (VALUES' || E'\\n'
      || (
        SELECT string_agg(
          '  (' || quote_literal(split_part(dep_pair, ':', 1)) || ', ' || quote_literal(split_part(dep_pair, ':', 2)) || ')',
          ',' || E'\\n'
          ORDER BY dep_pair
        )
        FROM unnest(dependency_pairs) AS dep_pair
      ) || E'\\n'
      || ') AS dep(resource_code, action_code)' || E'\\n'
      || 'JOIN acl.menu_master mm ON mm.menu_code = dep.resource_code' || E'\\n'
      || 'ON CONFLICT DO NOTHING;' || E'\\n'
      || E'\\n'
      || 'INSERT INTO acl.version_role_capabilities (acl_version_id, role_code, capability_code)' || E'\\n'
      || 'SELECT ' || quote_literal(acl_version_id::text) || '::uuid, rc.role_code, ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\\n'
      || 'FROM acl.role_capabilities rc' || E'\\n'
      || 'WHERE rc.capability_code = ' || quote_literal(source_capability_code) || E'\\n'
      || 'ON CONFLICT DO NOTHING;' || E'\\n'
      || E'\\n'
      || 'INSERT INTO acl.version_work_context_capabilities (acl_version_id, work_context_id, capability_code) VALUES (' || E'\\n'
      || '  ' || quote_literal(acl_version_id::text) || '::uuid,' || E'\\n'
      || '  ' || quote_literal(work_context_id::text) || '::uuid,' || E'\\n'
      || '  ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\\n'
      || ') ON CONFLICT DO NOTHING;' || E'\\n'
      || E'\\n'
      || 'INSERT INTO acl.version_capability_menu_actions (acl_version_id, capability_code, menu_id, action, allowed, menu_visible)' || E'\\n'
      || 'SELECT ' || quote_literal(acl_version_id::text) || '::uuid, ' || quote_literal(source_capability_code || '_DEPENDENCY') || ', mm.id, dep.action_code, TRUE, FALSE' || E'\\n'
      || 'FROM (VALUES' || E'\\n'
      || (
        SELECT string_agg(
          '  (' || quote_literal(split_part(dep_pair, ':', 1)) || ', ' || quote_literal(split_part(dep_pair, ':', 2)) || ')',
          ',' || E'\\n'
          ORDER BY dep_pair
        )
        FROM unnest(dependency_pairs) AS dep_pair
      ) || E'\\n'
      || ') AS dep(resource_code, action_code)' || E'\\n'
      || 'JOIN acl.menu_master mm ON mm.menu_code = dep.resource_code' || E'\\n'
      || 'ON CONFLICT DO NOTHING;' || E'\\n'
      || 'COMMIT;'
  END AS suggested_sql
FROM grouped_suggestions
ORDER BY company_code, work_context_name, owning_resource_code;`;

  return { gapQuery, suggestionQuery };
}

function buildStats(data) {
  const byRisk = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const row of data.dependencyRows) {
    byRisk[row.riskFlag] = (byRisk[row.riskFlag] || 0) + 1;
  }
  return {
    matched_screen_routes: data.resourceToFile.size,
    dependency_triples: data.dependencyRows.length,
    by_risk: byRisk,
    join_warning_count: data.joinWarnings.length,
    missing_manifest_count: data.resourcesMissingManifest.length,
  };
}

function buildWarningsPayload(freshness, data) {
  return {
    manifest_freshness: freshness.warning
      ? { status: "warning", message: freshness.warning }
      : { status: "ok", message: freshness.ok },
    route_without_file_match: data.joinWarnings,
    routed_page_without_manifest_entry: data.resourcesMissingManifest,
  };
}

function shouldStrictFail(freshness, data) {
  return Boolean(freshness.warning || data.resourcesMissingManifest.length > 0);
}

function buildOutput(options) {
  const freshness = computeManifestFreshness(MANIFEST_PATH);
  const data = buildDependencyData();
  const stats = buildStats(data);
  const warnings = buildWarningsPayload(freshness, data);
  const sql = buildSql(data.dependencyRows);

  const reviewTriples = data.dependencyRows.map((row) => ({
    owning_resource_code: row.owningResourceCode,
    dependency_resource_code: row.dependencyResourceCode,
    dependency_action: row.dependencyAction,
    risk_flag: row.riskFlag,
    dependency_is_page: row.dependencyIsPage,
    owning_page: row.owningPage,
    fn: row.dependencyFn,
    method: row.dependencyMethod,
    path: row.dependencyPath,
  }));

  const headerLines = [
    "-- SU24-style dependency provisioning report",
    `-- Generated at: ${new Date().toISOString()}`,
    `-- Mode: ${options.mode}`,
    `-- Target companies: ${TARGET_COMPANIES.map((company) => company.code).join(", ")}`,
    freshness.warning ? `-- WARNING: ${freshness.warning}` : `-- ${freshness.ok}`,
    `-- Screen routes with file match: ${stats.matched_screen_routes}`,
    `-- Dependency triples: ${stats.dependency_triples}`,
    `-- Risk counts: LOW=${stats.by_risk.LOW}, MEDIUM=${stats.by_risk.MEDIUM}, HIGH=${stats.by_risk.HIGH}`,
  ];

  if (data.joinWarnings.length > 0) {
    headerLines.push(`-- WARNING: ${data.joinWarnings.length} screen route(s) had no AppRouter file match.`);
  }
  if (data.resourcesMissingManifest.length > 0) {
    headerLines.push(
      `-- WARNING: ${data.resourcesMissingManifest.length} routed page resource(s) had no manifest entry.`,
    );
  }

  const reportOutput = [
    headerLines.join("\n"),
    "",
    "-- Computed dependency triples (review this mapping before trusting the SQL)",
    JSON.stringify(reviewTriples, null, 2),
    "",
    "-- Join warnings",
    JSON.stringify(warnings, null, 2),
    "",
    sql.gapQuery,
    "",
    sql.suggestionQuery,
  ].join("\n");

  const summaryOutput = [
    headerLines.join("\n"),
    "",
    "-- Summary",
    JSON.stringify(
      {
        stats,
        warnings,
        next_step:
          "Run the printed gap SQL in dev/prod, review HIGH-risk rows manually, and use suggest-sql output only for LOW/MEDIUM hidden companion candidates.",
      },
      null,
      2,
    ),
  ].join("\n");

  const triplesJsonOutput = JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      target_companies: TARGET_COMPANIES,
      stats,
      warnings,
      dependency_triples: reviewTriples,
    },
    null,
    2,
  );

  const outputs = {
    report: reportOutput,
    summary: summaryOutput,
    "triples-json": triplesJsonOutput,
    "gap-sql": sql.gapQuery,
    "suggest-sql": sql.suggestionQuery,
  };

  return {
    output: outputs[options.mode],
    strictFailure: options.strictManifest && shouldStrictFail(freshness, data),
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(buildHelpText());
    process.exit(0);
  }

  const result = buildOutput(options);
  console.log(result.output);
  if (result.strictFailure) {
    process.exit(STRICT_WARNING_EXIT_CODE);
  }
} catch (error) {
  console.error(`dependency-provisioning-check: ${error.message}`);
  process.exit(1);
}
