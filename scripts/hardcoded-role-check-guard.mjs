#!/usr/bin/env node
/*
 * Hardcoded Role-Check Guard — 11-bug-pattern #1 ("Hardcoded rank-check /
 * role-check bypass")
 *
 * কী করে: `_core/**​/*.handlers.ts` / `*.handler.ts` / `*.shared.ts` ফাইলে
 * `MANAGER_OR_SA_ROLES`-স্টাইলের hardcoded role list, বা
 * `assertManagerOrSARole`/`assertAdminOr...Role`-স্টাইলের local helper function
 * নতুন করে বসলে ধরে ফেলে।
 *
 * কেন দরকার: CLAUDE.md-র checklist #1 — "Never trust assertManagerOrSARole,
 * MANAGER_OR_SA_ROLES, or direct roleCode === ... checks as the real business
 * authority on an ACL page." এই session-এ opening_stock.handlers.ts আর
 * physical_inventory.handlers.ts থেকে ঠিক এই pattern সরানো হয়েছে (Task B),
 * আর StrokeMasterPage.jsx-এর bug-ও এর গায়েই ভর করেছিল (admin-only
 * list_companies.handler.ts-এর এই hardcoded check-এর কারণে business page
 * ভুলভাবে সেটা call করছিল)। Pattern-টা বারবার ফিরে আসে বলেই এটা 11-bug লিস্টে —
 * তাই একবার fix করে ছেড়ে দিলে চলবে না, নতুন করে বসা আটকাতে হবে।
 *
 * ⚠️ এই script শুধু এই EXACT naming convention ধরে (MANAGER_OR_SA_ROLES-style
 * constant, assertManagerOrSARole/assertAdminOr...Role-style function) —
 * generic `roleCode === "DIRECTOR"` তুলনা ধরে না, কারণ সেটা approver-chain
 * ইঞ্জিনের (workflow_scope.ts-ভিত্তিক) বৈধ DIRECTOR-fallback/self-approval-exempt
 * logic-এও থাকে (দেখো po.handlers.ts-এর assertProcurementHeadRole)। ওটাকে
 * flag করলে false-positive-এর ঝড় উঠবে আর আসল signal হারিয়ে যাবে। এই ঠিক
 * naming pattern-টাই এই repo-তে বারবার এই নির্দিষ্ট anti-pattern-এর জন্য
 * ব্যবহৃত হয়েছে (l2_masters.handlers.ts, production.shared.ts, om/shared.ts,
 * list_companies.handler.ts) — তাই high-precision, low-noise detection।
 *
 * BASELINE = আজকের (2026-08-03) known occurrence, প্রতিটার reason সহ। এটা একটা
 * ceiling — নতুন কোনো file এই pattern বসালে fail করবে; পুরনোগুলো audit করে
 * সরানো হলে baseline থেকেও সরিয়ে দাও (silently new file যোগ করলে চলবে না,
 * প্রতিটার সাথে one-line reason দিতে হবে — company-scope-guard.mjs-এর মতোই)।
 *
 * চালাও:  node scripts/hardcoded-role-check-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const BACKEND_SCAN_DIR = join(ROOT, "supabase", "functions", "api", "_core");
const FRONTEND_SCAN_DIR = join(ROOT, "frontend", "src");

// Matches: const QA_ALLOWED_ROLES = [...] / const QA_MANAGER_ROLE_CODES = new Set([...])
const ROLE_CONST_PATTERN = /\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*(?:_ROLES|_ROLE_CODES))\s*=\s*(?:new\s+Set\s*\(\s*)?\[/g;
// Matches: function assertManagerOrSARole(...)  /  export function assertAdminOrXRole(...)
const ROLE_FN_PATTERN = /\bfunction\s+assert(Manager|Admin)Or\w*Role\s*\(/;
const ROLE_LITERAL_HINT_PATTERN = /["'`](?:SA|GA|DIRECTOR|L[1-4]_[A-Z0-9_]+|[A-Z0-9_]*MANAGER|[A-Z0-9_]*HEAD|[A-Z0-9_]*OFFICER|[A-Z0-9_]*USER|[A-Z0-9_]*AUDITOR)["'`]/;

/*
 * BASELINE — আজকে (2026-08-03) live-code-এ যা পাওয়া গেছে, প্রতিটার reason সহ।
 * এগুলো এখনই ফিক্স করা হচ্ছে না (সেটা আলাদা, বড় audit কাজ, প্রতিটা page ধরে ধরে
 * "ACL এখানে governs করে কিনা" যাচাই লাগবে — Task B-তে opening_stock/physical_
 * inventory-র জন্য যেই রকম রিগর দরকার হয়েছিল)। এই guard শুধু নতুন করে এই
 * pattern বসা আটকাবে।
 */
const BASELINE = new Set([
  // Legitimate: SA-governance-only admin endpoint (SAMaterialMaster.jsx,
  // SAProductionBatchSeriesPage.jsx call it correctly). The 2026-08-03 bug
  // was a BUSINESS page (StrokeMasterPage.jsx) misusing this admin endpoint —
  // fixed on the frontend side (switched to buildTransactionCompanyList()),
  // not by removing this backend check, which stays correct for its real
  // SA-only callers. See CLAUDE.md "Wrong company source" note.
  "supabase/functions/api/_core/admin/company/list_companies.handler.ts",
  // Known violation, not yet fixed — flagged 2026-08-06 by the expanded guard.
  // See CLAUDE.md pattern #1/#12 for the fix pattern. Tracked follow-up only.
  "supabase/functions/api/_core/procurement/qa_test_method.handlers.ts",
  // Known violation, not yet fixed — flagged 2026-08-06 by the expanded guard.
  // See CLAUDE.md pattern #1/#12 for the fix pattern. Tracked follow-up only.
  "frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx",
  // Known violation, not yet fixed — flagged 2026-08-06 by the expanded guard.
  // See CLAUDE.md pattern #1/#12 for the fix pattern. Tracked follow-up only.
  "frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx",
  // Known violation, not yet fixed — flagged 2026-08-06 by the expanded guard.
  // See CLAUDE.md pattern #1/#12 for the fix pattern. Tracked follow-up only.
  "frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx",
  // Known violation, not yet fixed — flagged 2026-08-06 by the expanded guard.
  // See CLAUDE.md pattern #1/#12 for the fix pattern. Tracked follow-up only.
  "frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx",
]);

function walk(dir, matcher, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relPath(full);
    if (statSync(full).isDirectory()) {
      if (rel.startsWith("frontend/src/admin/")) continue;
      if (rel.includes("/__tests__/")) continue;
      walk(full, matcher, out);
    } else if (matcher(full, entry, rel)) {
      out.push(full);
    }
  }
  return out;
}

function relPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

function hasRoleArrayConstant(src) {
  ROLE_CONST_PATTERN.lastIndex = 0;
  let match;
  while ((match = ROLE_CONST_PATTERN.exec(src)) !== null) {
    const snippet = src.slice(match.index, match.index + 400);
    if (ROLE_LITERAL_HINT_PATTERN.test(snippet)) {
      return true;
    }
  }
  return false;
}

const backendViolations = [];
const frontendViolations = [];
let filesScanned = 0;

for (const [groupName, files] of [
  [
    "backend",
    walk(BACKEND_SCAN_DIR, (_full, entry) => /\.(handlers|handler|shared)\.ts$/.test(entry)),
  ],
  [
    "frontend",
    walk(
      FRONTEND_SCAN_DIR,
      (_full, entry, rel) => /\.(jsx|js)$/.test(entry) && !/\.test\.(jsx|js)$/.test(entry) && rel.startsWith("frontend/src/"),
    ),
  ],
]) {
  for (const file of files) {
    filesScanned += 1;
    const src = readFileSync(file, "utf8");
    const hasConst = hasRoleArrayConstant(src);
    const hasFn = ROLE_FN_PATTERN.test(src);
    if (!hasConst && !hasFn) continue;

    const rel = relPath(file);
    if (BASELINE.has(rel)) continue;
    const target = groupName === "backend" ? backendViolations : frontendViolations;
    target.push({ file: rel, hasConst, hasFn });
  }
}

const violationCount = backendViolations.length + frontendViolations.length;

console.log(`Hardcoded role-check guard — scanned ${filesScanned} file(s), ${violationCount} new hardcoded rank-check pattern(s) found`);

if (violationCount > 0) {
  console.error("\nFAIL — these files introduce a new hardcoded MANAGER_OR_SA_ROLES-style constant or assertManagerOrSARole-style function:");
  if (backendViolations.length > 0) {
    console.error("\nBackend:");
    for (const { file, hasConst, hasFn } of backendViolations) {
      console.error(`  ${file}${hasConst ? "  [role-array constant]" : ""}${hasFn ? "  [assert*Or*Role function]" : ""}`);
    }
  }
  if (frontendViolations.length > 0) {
    console.error("\nFrontend:");
    for (const { file, hasConst, hasFn } of frontendViolations) {
      console.error(`  ${file}${hasConst ? "  [role-array constant]" : ""}${hasFn ? "  [assert*Or*Role function]" : ""}`);
    }
  }
  console.error(`
This exact naming pattern is 11-bug-pattern #1 ("Hardcoded rank-check /
role-check bypass") — a local role-array/function that silently becomes the
REAL authority on a page instead of the ACL layer. If this page/action is
already ACL-governed, delete this and rely on the ACL decision (ctx.context
already carries it). If a genuine SA/GA-only admin endpoint truly needs this
(no ACL applies there by design), add the file path to BASELINE in this
script with a one-line reason — do not leave it unflagged silently.`);
  process.exit(1);
}

console.log("OK — no new hardcoded rank-check patterns found outside the documented baseline.");
