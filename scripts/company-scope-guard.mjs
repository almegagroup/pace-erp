#!/usr/bin/env node
/*
 * Company Scope Guard — feasibility doc Section 112
 *
 * কী করে: কোনো handler caller-এর body (Shape 1 — Create) বা GET query string
 * (Shape 3 — plain read) থেকে আসা `company_id` নিয়ে সরাসরি insert/update/action/
 * filter করছে অথচ পাশে কোনো company-scope guard call নেই কিনা পাহারা দেয়।
 *
 * কেন দরকার: `_pipeline/context.ts`-এর `stepContext()` শুধু session-এর active
 * company validate করে, POST/PATCH body বা GET query string-এর ভেতরের
 * company_id স্পর্শই করে না। প্রতিটা handler-কে নিজে থেকে caller-এর company
 * scope চেক করতে হয় — ভুলে গেলে single-company user অন্য company-র data touch
 * করতে পারে (live bug, 2026-07-25-এ P0003-এর Company dropdown-এ ৪টা company
 * দেখা দিয়ে ধরা পড়ে)।
 *
 * ⚠️ ইতিহাস (এই script নিজেই একবার এই class-এর bug miss করেছিল): প্রথম সংস্করণ
 * শুধু Shape 1 (`body.company_id`) ধরত — Shape 3 (`searchParams.get("company_id")`)
 * ইচ্ছাকৃতভাবে "file-based regex দিয়ে নির্ভরযোগ্যভাবে আলাদা করা যায় না" বলে বাদ
 * রাখা হয়েছিল। এর ফলে `stock_reports.handlers.ts`, `gate_entry.handlers.ts`
 * সহ ~১০টা procurement handler file-এ একটা misleadingly-named `getCompanyScope()`
 * helper (শুধু fallback resolve করত, validate করত না) মাসের পর মাস ধরা পড়েনি —
 * এমনকি এই script pass করার পরেও। ধরা পড়ে ২০২৬-০৭-২৬-এ, business owner-এর
 * "সব ঠিক করো, কোনো loophole থাকবে না" চ্যালেঞ্জে ফিরে গিয়ে Inventory page
 * review করার সময়। এখন প্রতিটা local helper নিজের ভেতরেই `assertCompanyScope`
 * ডাকে, তাই Shape 3-ও একই file-level heuristic দিয়ে নিরাপদে ধরা যায়।
 *
 * Detection (দুটো shape-ই, একই heuristic): `_core/**​/*.handlers.ts` ফাইলে
 * `body.company_id` অথবা `searchParams.get("company_id")` literal থাকলে, সেই
 * একই ফাইলে অন্তত একটা `assert*CompanyScope(...)` call থাকতেই হবে — শেয়ার্ড
 * `assertCompanyScope` (companyScope.ts) হোক বা কোনো per-file local variant
 * (assertPackingCompanyScope, assertPackBomCompanyScope,
 * assertPartialReversalCompanyScope, assertOpeningStockCompanyScope, ...) —
 * সবগুলোই একই shape: ctx + companyId নিয়ে erp_map.user_companies চেক করে।
 *
 * ⚠️ এখনো একটা সীমাবদ্ধতা আছে (ইচ্ছাকৃতভাবে সহজ রাখা, §8D
 * stock-posting-guard.mjs-এর মতোই blunt-but-honest instrument): এটা
 * file-level heuristic, function-level না — একটা ফাইলে যদি ১০টা handler থাকে
 * আর একটাতেও assertCompanyScope থাকে, বাকি ৯টা company_id read করলেও pass
 * করবে। Shape 2 (act-on-existing, fetched record-এর company_id) এখনো এই
 * script ধরে না। নতুন handler লেখার সময় CLAUDE.md §112-এর discipline দিয়েই
 * ধরতে হবে — code review-এ active গ্রেপ করো, শুধু এই script-এর উপর ভরসা কোরো না।
 *
 * এই script Shape 1 + Shape 3 দুটোকেই **রিগ্রেশন-প্রুফ** করে: আজ (2026-07-26)
 * সব known handler ঠিক করা হয়েছে, তাই baseline **শূন্য** — ভবিষ্যতে নতুন কোনো
 * handler company_id পড়লে কিন্তু scope guard বসাতে ভুলে গেলে, এই check ধরে
 * ফেলবে, build fail করবে।
 *
 * চালাও:  node scripts/company-scope-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "supabase", "functions", "api", "_core");

const BODY_COMPANY_ID_PATTERN = /body\.company_id\b/g;
const QUERY_COMPANY_ID_PATTERN = /searchParams\.get\(\s*["']company_id["']\s*\)/g;
// Generic on purpose: matches the shared assertCompanyScope AND any
// per-file local variant (assertPackingCompanyScope, assertPackBomCompanyScope,
// assertPartialReversalCompanyScope, assertOpeningStockCompanyScope, ...) —
// every one of these follows the same "assert*CompanyScope(ctx, companyId)"
// naming/shape, so a new local helper is recognised without editing this list.
const SCOPE_GUARD_PATTERN = /\bassert\w*CompanyScope\s*\(/;

/*
 * BASELINE — যেসব handler file company_id read করে কিন্তু (script-এর জানা)
 * কোনো scope-guard call ছাড়াই থাকার কথা, deliberate exception হিসেবে।
 * আজ (2026-07-26) খালি — সব known handler ঠিক করে দেওয়া হয়েছে।
 * নতুন কোনো সত্যিকারের exception (company-scope প্রযোজ্যই না এমন resource,
 * যেমন SA/GA-only admin endpoint) থাকলে এখানে file path + reason কমেন্ট সহ
 * যোগ করো — silent add নয়।
 */
const BASELINE = new Set([
  // admin/* — every handler here gates on ctx.context.isAdmin === true
  // (verified 2026-07-26: SA/GA universe only, see assertAdmin() in each file).
  // SA/GA bypass company scope entirely by design (CLAUDE.md §8 "SA/GA always
  // full access — cannot be denied"), so a company_id here is a cross-company
  // admin operation, not a leak.
  "supabase/functions/api/_core/admin/acl/activate_acl_version.handler.ts",
  "supabase/functions/api/_core/admin/acl/create_acl_version.handler.ts",
  "supabase/functions/api/_core/admin/acl/delete_acl_version.handler.ts",
  "supabase/functions/api/_core/admin/acl/disable_company_module.handler.ts",
  "supabase/functions/api/_core/admin/acl/enable_company_module.handler.ts",
  "supabase/functions/api/_core/admin/acl/list_acl_versions.handler.ts",
  "supabase/functions/api/_core/admin/acl/list_company_modules.handler.ts",
  "supabase/functions/api/_core/admin/acl/list_governance_summary_report.handler.ts",
  "supabase/functions/api/_core/admin/acl/list_work_contexts.handler.ts",
  "supabase/functions/api/_core/admin/acl/rollback_acl_version.handler.ts",
  "supabase/functions/api/_core/admin/acl/upsert_user_override.handler.ts",
  "supabase/functions/api/_core/admin/acl/upsert_work_context.handler.ts",
  "supabase/functions/api/_core/admin/approval/upsert_approver_rule.handler.ts",
  "supabase/functions/api/_core/admin/approval/upsert_report_viewer_rule.handler.ts",
  "supabase/functions/api/_core/admin/company/update_company_address.handler.ts",
  "supabase/functions/api/_core/admin/company/update_company_state.handler.ts",
  "supabase/functions/api/_core/admin/department/create_department.handler.ts",
  "supabase/functions/api/_core/admin/department/list_departments.handler.ts",
  "supabase/functions/api/_core/admin/group/map_company_to_group.handler.ts",
  "supabase/functions/api/_core/admin/project/create_project.handler.ts",
  "supabase/functions/api/_core/admin/project/list_projects.handler.ts",
  "supabase/functions/api/_core/admin/project/map_company_to_project.handler.ts",
  "supabase/functions/api/_core/admin/project/unmap_company_project.handler.ts",
  "supabase/functions/api/_core/admin/project/update_project_state.handler.ts",
  "supabase/functions/api/_core/admin/user/list_user_scope_report.handler.ts",
  "supabase/functions/api/_core/admin/user/set_primary_company.handler.ts",
  // HR — explicitly out of scope for this pass (feasibility doc §112.6a):
  // HR uses a SEPARATE tenant boundary (erp_map.user_parent_companies,
  // "Parent Company"), not erp_map.user_companies — assertCompanyScope is the
  // wrong check here entirely. Deferred to the future HR redesign/distribution
  // session, which must build the parallel assertParentCompanyScope() and
  // audit these two files then — not silently ignored, tracked in the doc.
  "supabase/functions/api/_core/hr/leave.handlers.ts",
  "supabase/functions/api/_core/hr/out_work.handlers.ts",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".handlers.ts") || entry.endsWith(".handler.ts")) out.push(full);
  }
  return out;
}

function relPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

const violations = [];
let filesWithCompanyId = 0;

for (const file of walk(SCAN_DIR)) {
  const src = readFileSync(file, "utf8");
  const bodyMatches = src.match(BODY_COMPANY_ID_PATTERN) ?? [];
  const queryMatches = src.match(QUERY_COMPANY_ID_PATTERN) ?? [];
  const totalMatches = bodyMatches.length + queryMatches.length;
  if (totalMatches === 0) continue;
  filesWithCompanyId += 1;

  const hasGuard = SCOPE_GUARD_PATTERN.test(src);
  const rel = relPath(file);
  if (!hasGuard && !BASELINE.has(rel)) {
    violations.push({ file: rel, bodyCount: bodyMatches.length, queryCount: queryMatches.length });
  }
}

console.log(
  `Company scope guard — ${filesWithCompanyId} handler file(s) read company_id (body or query), ${violations.length} without a scope guard`,
);

if (violations.length > 0) {
  console.error("\nFAIL — these handler files read company_id but call no company-scope guard:");
  for (const { file, bodyCount, queryCount } of violations) {
    console.error(`  ${file}  (body.company_id x${bodyCount}, searchParams.get("company_id") x${queryCount})`);
  }
  console.error(`
A handler that inserts/mutates/filters using a caller-supplied company_id
(from POST/PATCH body OR a GET query string) must verify that company_id is
one of the caller's own erp_map.user_companies rows first — otherwise a
single-company user can create, touch, or simply VIEW another company's data
just by passing a different company_id.

Fix: call assertCompanyScope(ctx, companyId) from
supabase/functions/api/_shared/companyScope.ts right after resolving the
company_id and before any insert/update/query. See feasibility doc Section
112.5 for the three call shapes (Create / Act-on-existing / Read). For list/
report endpoints where an EMPTY company_id should scope to the caller's own
companies rather than every company, mirror the allowedCompanyIds pattern
used in listProcessOrdersHandler / resolveCompanyScope (stock_reports.handlers.ts).

If company_id here is genuinely not a security-relevant field (e.g. an
SA/GA-only admin endpoint), add the file path to BASELINE in this script with
a one-line reason — do not leave it unguarded silently.`);
  process.exit(1);
}

console.log("OK — every handler reading company_id (body or query) verifies caller company scope.");
