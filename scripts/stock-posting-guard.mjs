#!/usr/bin/env node
/*
 * Stock Posting Guard — CLAUDE.md 8D / feasibility 107
 *
 * কী করে: কোনো handler `post_stock_movement` RPC **সরাসরি** ডাকছে কিনা পাহারা দেয়।
 *
 * কেন দরকার: সরাসরি ডাকা মানে প্রতিটা movement আলাদা transaction-এ বসে। ৮ লাইনের
 * Process PO = ~৩১টা আলাদা commit — মাঝপথে server মরলে **অর্ধেক posting** বসে থাকে,
 * আর retry করলে ইতিমধ্যে বসা গুলো **দ্বিতীয়বার** বসে। গুদামের পিছনের দরজা দিয়ে
 * একটা একটা করে মাল বের করার মতো।
 *
 * আসল সমাধান হলো একটাই transactional RPC (`post_document`) দিয়ে পুরো document
 * একবারে বসানো — এক gate pass, হয় পুরোটা নয় কিছুই না।
 *
 * ⚠️ কিন্তু আজ ১২টা handler-ই সরাসরি ডাকে, তাই "সব বন্ধ" করলে আজই build ভাঙবে।
 * তাই এটা **ratchet**: নিচের baseline-ই সর্বোচ্চ সীমা।
 *   - নতুন file ডাকলে              -> FAIL
 *   - পুরনো file-এ call বাড়লে      -> FAIL
 *   - call কমলে (migrate হলে)      -> FAIL, baseline নামাতে বলবে
 *
 * শেষেরটা ইচ্ছাকৃত: baseline হাতে না নামালে migrate করা handler আবার নীরবে
 * পুরনো পথে ফিরে যেতে পারত। সংখ্যা শুধু **নামতেই** পারে, কখনো উঠতে নয়।
 *
 * লক্ষ্য: baseline খালি হওয়া। তখন post_stock_movement থেকে service_role-এর
 * EXECUTE grant তুলে নেওয়া যাবে — অর্থাৎ পিছনের দরজায় তালা, আর কোনো নতুন
 * module ভুল পথে যেতেই পারবে না (8D ধাপ ৪)।
 *
 * চালাও:  node scripts/stock-posting-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "supabase", "functions");
const CALL_PATTERN = /\.rpc\(\s*["']post_stock_movement["']/g;

/*
 * BASELINE — বর্তমানে যারা সরাসরি ডাকে, file প্রতি কতবার।
 * 2026-07-19-এ মাপা। একটা handler `post_document`-এ migrate করলে এখানকার
 * সংখ্যা কমাও (বা লাইনটা মুছে দাও)। **কখনো বাড়িও না।**
 */
const BASELINE = {
  "supabase/functions/api/_core/procurement/grn.handlers.ts": 3,
  "supabase/functions/api/_core/procurement/inward_qa.handlers.ts": 1,
  "supabase/functions/api/_core/procurement/opening_stock.handlers.ts": 1,
  "supabase/functions/api/_core/procurement/physical_inventory.handlers.ts": 1,
  "supabase/functions/api/_core/procurement/pto.handlers.ts": 1,
  "supabase/functions/api/_core/procurement/rtv.handlers.ts": 3,
  "supabase/functions/api/_core/procurement/sales_order.handlers.ts": 1,
  "supabase/functions/api/_core/procurement/sto.handlers.ts": 1,
  "supabase/functions/api/_core/production/packing_order.handlers.ts": 1,
  "supabase/functions/api/_core/production/partial_reversal.handlers.ts": 1,
  "supabase/functions/api/_core/production/process_order.handlers.ts": 1,
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function countCalls(file) {
  const matches = readFileSync(file, "utf8").match(CALL_PATTERN);
  return matches ? matches.length : 0;
}

const actual = {};
for (const file of walk(SCAN_DIR)) {
  const n = countCalls(file);
  if (n > 0) actual[relative(ROOT, file).split(sep).join("/")] = n;
}

const newCallers = [];
const increased = [];
const decreased = [];

for (const [file, count] of Object.entries(actual)) {
  const allowed = BASELINE[file];
  if (allowed === undefined) newCallers.push({ file, count });
  else if (count > allowed) increased.push({ file, count, allowed });
  else if (count < allowed) decreased.push({ file, count, allowed });
}
const removed = Object.keys(BASELINE).filter((f) => !(f in actual));

const total = Object.values(actual).reduce((a, b) => a + b, 0);
const cap = Object.values(BASELINE).reduce((a, b) => a + b, 0);
console.log(`Stock posting guard — ${total} direct post_stock_movement call(s), baseline ${cap}`);

let failed = false;

if (newCallers.length) {
  failed = true;
  console.error("\nFAIL — these files call post_stock_movement directly but are not in the baseline:");
  for (const { file, count } of newCallers) console.error(`  ${file}  (${count})`);
  console.error(`
A direct call posts each movement in its own transaction, so an interrupted save
leaves stock half-posted and a retry double-posts it. Build the write as ONE
transactional RPC instead — see CLAUDE.md 8D / feasibility Section 107.

If this genuinely cannot be done yet, adding the file to BASELINE in this script
is a deliberate, reviewable decision — not a default.`);
}

if (increased.length) {
  failed = true;
  console.error("\nFAIL — direct calls increased:");
  for (const { file, count, allowed } of increased) {
    console.error(`  ${file}  ${allowed} -> ${count}`);
  }
  console.error("\nThe baseline is a ceiling that may only come down. Do not raise it.");
}

if (decreased.length || removed.length) {
  failed = true;
  console.error("\nFAIL — direct calls went DOWN, which is good, but the baseline must be lowered to match:");
  for (const { file, count, allowed } of decreased) console.error(`  ${file}  ${allowed} -> ${count}`);
  for (const file of removed) console.error(`  ${file}  removed entirely`);
  console.error(`
Edit BASELINE in scripts/stock-posting-guard.mjs to the new numbers. This is
enforced so a migrated handler cannot quietly drift back to the old path later.`);
}

if (failed) process.exit(1);

if (total === 0) {
  console.log("\nBaseline is empty — every write now goes through the transactional path.");
  console.log("Next: REVOKE EXECUTE on post_stock_movement from service_role so the old path is gone for good.");
} else {
  console.log("OK — no new direct callers.");
}
