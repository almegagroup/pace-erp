#!/usr/bin/env node
/*
 * Wrong Company Source Guard — 11-bug-pattern #11 ("Wrong company source /
 * single-company auto-resolution bypass")
 *
 * কী করে: `frontend/src/pages/**` business page-এ admin/global (unscoped)
 * company source ঢুকে গেলে ধরে ফেলে — `useCompaniesForOmQuery`,
 * `useAdminCompaniesQuery`, বা literal `"/api/admin/companies"` call।
 *
 * কেন দরকার: business page-এ company list অবশ্যই runtime ACL/company context
 * থেকে আসতে হবে (`useMenu().runtimeContext.availableCompanies` অথবা
 * TransactionCompanySelector path)। Admin/global source (`/api/admin/companies`)
 * সব company ফেরত দেয় — business page-এ এটা ঢুকলে single-company / scoped-user
 * অন্য company দেখতে বা pick করতে পারে, exact live bug pattern #11।
 *
 * Scope intentionally narrow: শুধু `frontend/src/pages/**` scan করে। Admin
 * screens (`frontend/src/admin/**`) exempt by design, আর shared components scan
 * করা হয় না যাতে TransactionCompanySelector-style internals false positive না দেয়।
 *
 * চালাও: node scripts/wrong-company-source-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const PAGES_DIR = join(ROOT, "frontend", "src", "pages");
const PAGE_HELPER_FILE_PATTERN = /(?:^|[\\/])[A-Za-z0-9_-]*Api\.js$/;

const FORBIDDEN_COMPANY_HOOKS = [
  "useCompaniesForOmQuery",
  "useAdminCompaniesQuery",
];

const ADMIN_COMPANIES_LITERAL = /\/api\/admin\/companies/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (
      /\.(jsx|js)$/.test(entry) &&
      !/\.test\.(jsx|js)$/.test(entry) &&
      !PAGE_HELPER_FILE_PATTERN.test(full)
    ) {
      out.push(full);
    }
  }
  return out;
}

function relPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

function collectHookViolations(src) {
  const violations = [];

  for (const hookName of FORBIDDEN_COMPANY_HOOKS) {
    const importPattern = new RegExp(String.raw`\bimport\s*\{[^}]*\b${hookName}\b[^}]*\}\s*from\s*["'][^"']+["']`, "s");
    const callPattern = new RegExp(String.raw`\b${hookName}\s*\(`);
    if (importPattern.test(src) && callPattern.test(src)) {
      violations.push(hookName);
    }
  }

  return violations;
}

function collectLiteralViolations(src) {
  const matches = src.match(ADMIN_COMPANIES_LITERAL) ?? [];
  return matches.length > 0 ? ["/api/admin/companies"] : [];
}

const violations = [];
let filesScanned = 0;

for (const file of walk(PAGES_DIR)) {
  filesScanned += 1;
  const src = readFileSync(file, "utf8");
  const uses = [
    ...collectHookViolations(src),
    ...collectLiteralViolations(src),
  ];
  if (uses.length === 0) continue;

  violations.push({
    file: relPath(file),
    uses,
  });
}

console.log(
  `Wrong company source guard — scanned ${filesScanned} business page file(s), ${violations.length} admin/global company source violation(s) found`,
);

if (violations.length > 0) {
  console.error("\nFAIL — business page uses an admin/global (unscoped) company source:");
  for (const { file, uses } of violations) {
    console.error(`  ${file}`);
    console.error(`    uses: ${uses.join(", ")}`);
    console.error("    fix: use useMenu()'s runtimeContext.availableCompanies, or render");
    console.error("         <TransactionCompanySelector /> directly — see");
    console.error("         frontend/src/components/inputs/TransactionCompanySelector.jsx");
  }
  console.error(`
Business pages must never read company options from admin/global sources like
/api/admin/companies or wrappers around it. Those sources are intentionally
unscoped for SA/GA/admin governance screens and bypass the canonical company
rule (single-company = locked display, multi-company = only allowed companies).

Fix the page to use the runtime-scoped company source from useMenu()
(runtimeContext.availableCompanies) or the shared
TransactionCompanySelector/buildTransactionCompanyList path instead.`);
  process.exit(1);
}

console.log("OK — no business page uses an admin/global company source.");
