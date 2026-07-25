#!/usr/bin/env node
/*
 * Company Scope Guard — feasibility doc Section 112
 *
 * কী করে: কোনো handler caller-এর body থেকে আসা `company_id` নিয়ে সরাসরি
 * insert/update/action করছে অথচ পাশে কোনো company-scope guard call নেই কিনা
 * পাহারা দেয় (Section 112.2 Shape 1 — Create action leak, সবচেয়ে বেশি occurrence
 * পাওয়া গিয়েছিল বলে সবচেয়ে নির্ভরযোগ্যভাবে regex দিয়ে ধরা যায়)।
 *
 * কেন দরকার: `_pipeline/context.ts`-এর `stepContext()` শুধু session-এর active
 * company validate করে, POST/PATCH body-র ভেতরের company_id স্পর্শই করে না।
 * প্রতিটা handler-কে নিজে থেকে caller-এর company scope চেক করতে হয় — ভুলে
 * গেলে single-company user অন্য company-র data touch করতে পারে (live bug,
 * 2026-07-25-এ P0003-এর Company dropdown-এ ৪টা company দেখা দিয়ে ধরা পড়ে)।
 *
 * Detection: `_core/**​/*.handlers.ts` ফাইলে `body.company_id` literal থাকলে,
 * সেই একই ফাইলে অন্তত একটা `assert*CompanyScope(...)` call থাকতেই হবে —
 * শেয়ার্ড `assertCompanyScope` (companyScope.ts) হোক বা কোনো per-file local
 * variant (assertPackingCompanyScope, assertPackBomCompanyScope,
 * assertPartialReversalCompanyScope, assertOpeningStockCompanyScope, ...) —
 * সবগুলোই একই shape: ctx + companyId নিয়ে erp_map.user_companies চেক করে।
 *
 * ⚠️ সীমাবদ্ধতা (ইচ্ছাকৃতভাবে সহজ রাখা হয়েছে, §8D stock-posting-guard.mjs-এর
 * মতোই একটা blunt-but-honest instrument): এটা শুধু Shape 1 (Create action,
 * body.company_id) ধরে — Shape 2 (act-on-existing, fetched record-এর নিজের
 * company_id) আর Shape 3 (plain read) ফাইল-ভিত্তিক regex দিয়ে নির্ভরযোগ্যভাবে
 * আলাদা করা যায় না (company_id column reference তো read-only/display context-এও
 * থাকে)। Shape 2/3 নতুন handler লেখার সময় CLAUDE.md §112-এর discipline দিয়েই
 * ধরতে হবে — code review-এ active গ্রেপ করো।
 *
 * এই script শুধু Shape 1-কে **রিগ্রেশন-প্রুফ** করে: আজ (2026-07-25) সব
 * known Shape-1 handler ঠিক করা হয়েছে (§112.7), তাই baseline **শূন্য** —
 * ভবিষ্যতে নতুন কোনো handler body.company_id পড়লে কিন্তু scope guard
 * বসাতে ভুলে গেলে, এই check ধরে ফেলবে, build fail করবে।
 *
 * চালাও:  node scripts/company-scope-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "supabase", "functions", "api", "_core");

const BODY_COMPANY_ID_PATTERN = /body\.company_id\b/g;
// Generic on purpose: matches the shared assertCompanyScope AND any
// per-file local variant (assertPackingCompanyScope, assertPackBomCompanyScope,
// assertPartialReversalCompanyScope, assertOpeningStockCompanyScope, ...) —
// every one of these follows the same "assert*CompanyScope(ctx, companyId)"
// naming/shape, so a new local helper is recognised without editing this list.
const SCOPE_GUARD_PATTERN = /\bassert\w*CompanyScope\s*\(/;

/*
 * BASELINE — যেসব handler file body.company_id পড়ে কিন্তু (script-এর জানা)
 * কোনো scope-guard call ছাড়াই থাকার কথা, deliberate exception হিসেবে।
 * আজ (2026-07-25) খালি — §112.7-এর ধাপ ৩ সব known handler ঠিক করে দিয়েছে।
 * নতুন কোনো সত্যিকারের exception (company-scope প্রযোজ্যই না এমন resource)
 * থাকলে এখানে file path + reason কমেন্ট সহ যোগ করো — silent add নয়।
 */
const BASELINE = new Set([]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".handlers.ts")) out.push(full);
  }
  return out;
}

function relPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

const violations = [];
let filesWithBodyCompanyId = 0;

for (const file of walk(SCAN_DIR)) {
  const src = readFileSync(file, "utf8");
  const bodyMatches = src.match(BODY_COMPANY_ID_PATTERN);
  if (!bodyMatches) continue;
  filesWithBodyCompanyId += 1;

  const hasGuard = SCOPE_GUARD_PATTERN.test(src);
  const rel = relPath(file);
  if (!hasGuard && !BASELINE.has(rel)) {
    violations.push({ file: rel, count: bodyMatches.length });
  }
}

console.log(
  `Company scope guard — ${filesWithBodyCompanyId} handler file(s) read body.company_id, ${violations.length} without a scope guard`,
);

if (violations.length > 0) {
  console.error("\nFAIL — these handler files read body.company_id but call no company-scope guard:");
  for (const { file, count } of violations) {
    console.error(`  ${file}  (body.company_id x${count})`);
  }
  console.error(`
A handler that inserts/mutates using a caller-supplied company_id must verify
that company_id is one of the caller's own erp_map.user_companies rows first
— otherwise a single-company user can create or touch another company's data
just by passing a different company_id in the request body.

Fix: call assertCompanyScope(ctx, companyId) from
supabase/functions/api/_shared/companyScope.ts right after validating the
body and before any insert/update. See feasibility doc Section 112.5 for the
three call shapes (Create / Act-on-existing / Read).

If body.company_id here is genuinely not a security-relevant field (e.g. a
read-only filter already scoped another way), add the file path to BASELINE
in this script with a one-line reason — do not leave it unguarded silently.`);
  process.exit(1);
}

console.log("OK — every handler reading body.company_id verifies caller company scope.");
