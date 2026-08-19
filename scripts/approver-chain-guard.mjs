#!/usr/bin/env node
/*
 * Approver-Chain Guard — 11-bug-pattern #7 ("Maker-checker empty /
 * fallback-only behavior")
 *
 * কী করে: `_core/**​/*.handlers.ts` / `*.handler.ts` ফাইলে কোনো
 * `approve...Handler`/`...ApproveHandler`-স্টাইলের exported function থাকলে,
 * সেই একই ফাইলে `pickScopedApproverRules` (shared `_shared/workflow_scope.ts`
 * ইঞ্জিন — creator-vs-approver routing + self-approval block) ব্যবহার হচ্ছে
 * কিনা চেক করে।
 *
 * কেন দরকার: Task C-তে ধরা পড়েছিল — Opening Stock/AC05/AC06-এর Approve বাটন
 * আসলে শুধু status flip করত, কে creator কে approver সেটা কখনো চেক করত না,
 * নিজের বানানো জিনিস নিজেই approve করা যেত (self-approve)। "ACL-এ APPROVE
 * action আছে" এটা প্রমাণ করে না যে real approver-routing কাজ করছে — সেটাই
 * এই bug pattern-এর মূল কথা (CLAUDE.md checklist #7)। এই script সেই একই ভুল
 * ভবিষ্যতে নতুন কোনো approve handler-এ চুপচাপ ফিরে আসা আটকায়।
 *
 * ⚠️ File-level heuristic (function-level না) — company-scope-guard.mjs আর
 * stock-posting-guard.mjs-এর মতোই ইচ্ছাকৃতভাবে সহজ রাখা হয়েছে। একটা ফাইলে
 * একাধিক approve handler থাকলে, একটাতেও pickScopedApproverRules থাকলে পুরো
 * ফাইল pass করবে। এটা perfect না, কিন্তু "কোনো approve handler-ই কোনোদিন এই
 * ইঞ্জিন ছোঁয়নি" — এই সবচেয়ে খারাপ কেসটা নিশ্চিতভাবে ধরে।
 *
 * ⚠️ প্রতিটা approve handler-এর real maker-checker দরকার — এমন কোনো দাবি এই
 * script করে না। কিছু approve action সত্যিই role-gated single-step (যেমন QA
 * approval যেখানে "approver" মানেই একটা নির্দিষ্ট role, creator-নির্ভর routing
 * দরকার নেই — সেটা একটা সচেতন design সিদ্ধান্ত)। এই script শুধু "কেউ কখনো এই
 * প্রশ্নটা জিজ্ঞেসই করেনি" কেসটা ধরে — BASELINE-এ থাকা মানে "এখনো audit হয়নি
 * বা ইচ্ছাকৃতভাবে অন্য pattern", "নিরাপদ" নয়।
 *
 * চালাও:  node scripts/approver-chain-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "supabase", "functions", "api", "_core");

// Matches: export async function approveXyzHandler(...)  /  export async function xyzApproveHandler(...)
const APPROVE_HANDLER_PATTERN = /export\s+async\s+function\s+\w*[Aa]pprove\w*Handler\s*\(/;
const ENGINE_USAGE_PATTERN = /\bpickScopedApproverRules\s*\(/;

/*
 * BASELINE — আজকে (2026-08-03) approve-handler-নাম-ওয়ালা ফাইল যেগুলোতে এখনো
 * pickScopedApproverRules নেই, প্রতিটার reason সহ। এখনই সব fix করা হচ্ছে না —
 * প্রতিটার জন্য Task B/C-র মতো নিজস্ব audit লাগবে (এই page-এ কি সত্যিই
 * creator-vs-approver routing দরকার, নাকি ইচ্ছাকৃত single-step role-gate)।
 * এই guard শুধু নতুন করে কোনো approve handler এই প্রশ্ন না জিজ্ঞেস করে চুপচাপ
 * merge হওয়া আটকায়।
 */
const BASELINE = new Set([
  // Admin/SA scope — these manage the approver_map CONFIG itself (upsert/
  // list/delete approver rules), not a business document's approve action.
  // Different domain entirely, no creator/approver routing applicable.
  "supabase/functions/api/_core/admin/approval/delete_approver_rule.handler.ts",
  "supabase/functions/api/_core/admin/approval/list_approver_rules.handler.ts",
  "supabase/functions/api/_core/admin/approval/upsert_approver_rule.handler.ts",
  // Admin/SA scope — signup-request approval, a one-off account-provisioning
  // flow (not a recurring business document with a creator/approver split).
  "supabase/functions/api/_core/admin/signup/approve.handler.ts",
  // Not yet audited against "does this need creator-vs-approver routing" —
  // flagged for a future pass, same rigor as Task C.
  "supabase/functions/api/_core/production/pack_bom.handlers.ts",
  "supabase/functions/api/_core/production/pack_config.handlers.ts",
  "supabase/functions/api/_core/production/process_order.handlers.ts",
  "supabase/functions/api/_core/production/stroke_change_request.handlers.ts",
  // IN13 Stock Status Change (feasibility §126.3, locked 2026-08-19) —
  // intentionally a single-step role-gate, not a configured approver_map
  // routing: eligibility is the ACL capability grant itself (CAP_QA_TIER_L3MGR
  // / CAP_QA_PLANTHEAD, APPROVE action, checked via canMaintainCompanyResource
  // in assertScopedCompanyAccess), not a per-creator-role routing table —
  // there is no "different approver for different creator" requirement here,
  // unlike PO/STO. Self-approval is still explicitly blocked
  // (created_by === ctx.auth_user_id -> SSC_APPROVE_SELF_FORBIDDEN).
  "supabase/functions/api/_core/procurement/stock_status_change.handlers.ts",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(handlers|handler)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

function relPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

const violations = [];
let filesWithApproveHandler = 0;

for (const file of walk(SCAN_DIR)) {
  const src = readFileSync(file, "utf8");
  if (!APPROVE_HANDLER_PATTERN.test(src)) continue;
  filesWithApproveHandler += 1;

  const hasEngine = ENGINE_USAGE_PATTERN.test(src);
  const rel = relPath(file);
  if (!hasEngine && !BASELINE.has(rel)) {
    violations.push({ file: rel });
  }
}

console.log(`Approver-chain guard — ${filesWithApproveHandler} file(s) export an approve-style handler, ${violations.length} without the real approver-routing engine`);

if (violations.length > 0) {
  console.error("\nFAIL — these files export an approve-style handler but never call pickScopedApproverRules (_shared/workflow_scope.ts):");
  for (const { file } of violations) {
    console.error(`  ${file}`);
  }
  console.error(`
An "approve" action that only flips a status (SUBMITTED -> APPROVED) with no
creator-vs-approver check lets whoever created a document also approve it
themselves — 11-bug-pattern #7 (maker-checker empty/fallback-only), the exact
gap found and fixed in Opening Stock/AC05/AC06 this session (Task C).

Fix: wire a real approver-check using acl.approver_map + pickScopedApproverRules
from _shared/workflow_scope.ts, mirroring po.handlers.ts's
assertProcurementHeadRole (SA/GA bypass, SUBJECT_ROLE match, DIRECTOR fallback
when unconfigured, self-approval forbidden except for DIRECTOR).

If this specific approve action is intentionally a single-step role-gate (no
creator/approver split needed by design — document that reasoning), add the
file path to BASELINE in this script with a one-line reason — do not leave it
unflagged silently.`);
  process.exit(1);
}

console.log("OK — every approve-style handler either uses the real approver-routing engine or is a documented baseline exception.");
