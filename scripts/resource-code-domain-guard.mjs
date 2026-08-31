#!/usr/bin/env node
/*
 * Resource-Code Domain Guard — 11-bug-pattern #6 ("One resource code reused
 * for two different actions")
 *
 * কী করে: `route-acl-registry.ts`-এর প্রতিটা route entry থেকে "domain" বের করে
 * (path-এর `/api/<domain>/...` অংশ), তারপর একটা `resourceCode` যদি একাধিক
 * আলাদা domain-এ ব্যবহার হয় (যেমন `procurement` আর `production` দুটোতেই), সেটা
 * flag করে।
 *
 * কেন দরকার: CLAUDE.md checklist #6 — "Never let two semantically different
 * actions share one resource_code just because they look similar." একই
 * resource_code দুটো আলাদা business domain-এ ব্যবহার হওয়া মানে সম্ভবত সেটা
 * ভুলে copy-paste হয়েছে অথবা দুটো আলাদা feature কে একসাথে জুড়ে ফেলা হয়েছে —
 * পরে যখন একটার ACL grant বদলানো হবে, অজান্তেই আরেকটাও বদলে যাবে।
 *
 * ⚠️ এটা file-level static check, `route-acl-registry.ts` ছাড়া অন্য কিছু ছোঁয় না
 * — কোনো database লাগে না, তাই CI-তে নিরাপদে বসানো যায়।
 *
 * ⚠️ False-positive সম্ভাবনা: কিছু resource_code ইচ্ছাকৃতভাবেই একাধিক domain-এ
 * ব্যবহার হতে পারে (যেমন একটা shared master data resource, বা companion
 * screen)। প্রতিটা flag manually যাচাই করে হয় code ঠিক করো, নয়তো এখানে
 * BASELINE-এ reason সহ যোগ করো — company-scope-guard.mjs-এর মতোই।
 *
 * চালাও:  node scripts/resource-code-domain-guard.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REGISTRY_FILE = join(ROOT, "supabase", "functions", "api", "_acl", "route-acl-registry.ts");

/*
 * BASELINE — resourceCode-গুলো যেগুলো ইচ্ছাকৃতভাবে একাধিক domain-এ ব্যবহৃত হয়,
 * প্রতিটার reason সহ। আজ (2026-08-03) খালি — যা পাওয়া গেছে সব real bug হিসেবে
 * ধরা হয়েছে অথবা domain-detection নিজেই ভুল বুঝেছে এমন pattern বাদ দেওয়া হয়েছে।
 */
const BASELINE = new Map([
  // GET:/api/production/derived-opening-rate (§104.8 stroke-derived opening-rate
  // suggestion) deliberately rides IN05 Opening Stock's own resource instead of a
  // Production one — it's a helper endpoint *for* that page's SFG/INT entry flow,
  // not a separate feature. Documented inline at route-acl-registry.ts:304-305.
  ["PROC_OPENING_STOCK_LIST", "derived-opening-rate is a helper for IN05 Opening Stock's own entry flow, not a separate feature — see inline comment at the route"],
  // GET:/api/procurement/materials/uom-conversion is a pure erp_master.material_uom_conversion
  // lookup with no PO reference and no company scope in the handler — intentionally reused as-is
  // by procurement (PID, Opening Stock) via the Material Master's own resource, same "common
  // master-data screen shared across modules" shape this baseline already documents above. Was
  // PROC_PO_LIST before 2026-08-14, which silently 403'd it for any PID/Opening-Stock user without
  // PO List access — see inline comment at the route.
  ["OM_MATERIAL_LIST", "material_uom_conversion lookup is material-master data, intentionally shared by procurement pages (PID, Opening Stock) via OM's own resource — see inline comment at the route"],
  // GET:/api/production/ac06/approved-months exposes only approved month labels
  // to SO01's Costing Rate Month field. It deliberately uses SO Create authority:
  // an SO creator may choose a verified month but cannot view AC06 rates or rows.
  ["PROC_SO_CREATE", "approved AC06 month-label lookup is a read-only SO01 create-form dependency; it exposes no AC06 rates or material data — see inline comment at the route"],
]);

const src = readFileSync(REGISTRY_FILE, "utf8");
const lines = src.split("\n");

const DOMAIN_FROM_KEY = /"[A-Z]+:\/api\/([a-z0-9-]+)\//;
const DOMAIN_FROM_PATTERN = /pattern:\s*\/\^\\\/api\\\/([a-z0-9-]+)\\\//;
const RESOURCE_CODE = /resourceCode:\s*"([A-Z_]+)"/g;

let currentDomain = null;
const codeToDomains = new Map(); // resourceCode -> Set<domain>
const codeToLines = new Map(); // resourceCode -> [{domain, lineNo}]

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const keyMatch = DOMAIN_FROM_KEY.exec(line);
  if (keyMatch) currentDomain = keyMatch[1];
  const patternMatch = DOMAIN_FROM_PATTERN.exec(line);
  if (patternMatch) currentDomain = patternMatch[1];

  RESOURCE_CODE.lastIndex = 0;
  let m;
  while ((m = RESOURCE_CODE.exec(line))) {
    const code = m[1];
    if (!currentDomain) continue; // no domain context yet (shouldn't happen after first entry)
    if (!codeToDomains.has(code)) codeToDomains.set(code, new Set());
    codeToDomains.get(code).add(currentDomain);
    if (!codeToLines.has(code)) codeToLines.set(code, []);
    codeToLines.get(code).push({ domain: currentDomain, lineNo: i + 1 });
  }
}

const violations = [];
for (const [code, domains] of codeToDomains) {
  if (domains.size <= 1) continue;
  if (BASELINE.has(code)) continue;
  violations.push({ code, domains: [...domains].sort(), occurrences: codeToLines.get(code) });
}

console.log(`Resource-code domain guard — ${codeToDomains.size} distinct resourceCode(s) scanned, ${violations.length} spanning multiple domains`);

if (violations.length > 0) {
  console.error("\nFAIL — these resourceCodes are used across more than one route domain:");
  for (const { code, domains, occurrences } of violations) {
    console.error(`  ${code}  →  domains: ${domains.join(", ")}`);
    for (const { domain, lineNo } of occurrences) {
      console.error(`      route-acl-registry.ts:${lineNo}  (${domain})`);
    }
  }
  console.error(`
A resourceCode shared across unrelated route domains (e.g. both "procurement"
and "production") usually means either a copy-paste mistake or two genuinely
different features accidentally sharing one ACL gate — 11-bug-pattern #6.
When one of them later needs a narrower/different ACL grant, the change will
silently affect the other too.

Fix: give each domain's action its own resourceCode. If this is a real,
intentional shared resource (e.g. a common master data screen reused as-is
by two modules), add it to BASELINE in this script with a one-line reason —
do not leave it unflagged silently.`);
  process.exit(1);
}

console.log("OK — no resourceCode spans more than one route domain outside the documented baseline.");
