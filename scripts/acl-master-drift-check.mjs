#!/usr/bin/env node
/*
 * ACL-MASTER Drift Check — 11-bug-pattern #5
 * ("ACL-MASTER (P0076) maintenance drift")
 *
 * কী করে: ACL-MASTER (P0076, বা যেই user_code SA দিয়ে চালানো হয়) এর
 * `precomputed_acl_view` decision-এর সাথে সেই একই company-র বাকি সব ইউজারের
 * decision মিলিয়ে দেখে — যদি কারো (resource_code, action_code) ALLOW থাকে কিন্তু
 * ACL-MASTER-এর সেটা না থাকে, সেটা flag করে।
 *
 * কেন দরকার: CLAUDE.md checklist #5 — "P0076 is not SA/GA. It is maintenance-
 * based full access... Every new page/capability/route family must be checked
 * against ACL-MASTER explicitly, or P0076 can silently miss it." এই session-এই
 * এই ঠিক bug-টা ২ বার ধরা পড়েছে (P0076-এর company-mapping miss, আর Task C-তে
 * DIRECTOR সরাসরি approve করতে না পারা)।
 *
 * ⚠️ এই script কখনো database-এ সরাসরি connect করে না — শুধু SQL print করে,
 * MCP/SQL editor দিয়ে dev/prod-এ আলাদাভাবে চালাতে হবে। CI-তে বসানো হয়নি।
 *
 * ⚠️ ACL-MASTER user_code এখানে hardcoded নয় — নিচের SQL নিজেই company-ভিত্তিক
 * "সবচেয়ে বেশি resource+action ALLOW আছে এমন non-SA/GA ইউজার"-কে ACL-MASTER
 * হিসেবে ধরে নেয় (P0076-কে prod-এ ঠিক এভাবেই শনাক্ত করা হয়েছিল এই session-এ)।
 * একাধিক company-তে ACL-MASTER আলাদা ইউজার হলে, ফলাফল company-ভিত্তিক আলাদা
 * সারিতে আসবে।
 *
 * ⚠️ ২০২৬-০৮-০৬ prod-এ প্রথমবার চালিয়ে একটা false-positive পাওয়া গেছে:
 * `ACC_CONVERSION_COST:EDIT` — তখন ধরা হয়েছিল ইচ্ছাকৃত business-exclusivity
 * (`version_user_overrides.override_reason`: "AC04 create/edit exclusive to
 * Soni (business owner 2026-07-27)" — শুধু P0010-কে দেওয়া, ACL-MASTER-কেও না)।
 * **সংশোধন, ২০২৬-০৮-২৫ (business owner-এর directive): এই পুরো ধারণাটাই ভুল
 * ছিল।** এই ERP-তে কোনো "নির্দিষ্ট ব্যক্তির জন্য exclusive" grant বলে কিছু নেই —
 * সবকিছুই role/rank-ভিত্তিক। যাচাই করে দেখা গেল `CAP_CONVCOST_AUDITOR` capability
 * আগে থেকেই VIEW+WRITE দেয় L1_AUDITOR/L2_AUDITOR/DIRECTOR role-কে (AUDIT work
 * context-এ, CMP003+CMP006) — personal override-টা ছিল সম্পূর্ণ redundant, শুধু
 * P0010-কে একটা অতিরিক্ত (আর অস্তিত্বহীন) `EDIT` action দিচ্ছিল যেটা
 * `capability_menu_actions`-এ কোনো route-ই কখনো check করে না। ৯টা live
 * `user_overrides` row revoke করা হয়েছে (soft-delete, audit trail বহাল), তাই
 * `KNOWN_INTENTIONAL_EXCLUSIONS` CTE এখন খালি — নতুন কোনো *সত্যিকারের*
 * role-based-না-হওয়া exclusive-grant design এলে (যেটা এখন পর্যন্ত এই ERP-তে
 * কখনো হয়নি) তবেই এক লাইন যোগ করো, নাহলে খালি রাখো।
 * (একই session-এ `PROC_OPENING_STOCK_APPROVAL:WRITE` ধরা পড়েছিল আর real gap
 * প্রমাণিত হয়ে fix হয়েছে — P0076 CAP_OPENING_STOCK_AUDITOR পায়নি, capability
 * ভুলটা `acl.menu_master`/`erp_menu.menu_master` দুটো আলাদা table, ভুল টেবিলে
 * join করলে empty আসে বলে প্রথমে ধরা কঠিন হয়েছিল — capability_menu_actions সবসময়
 * `acl.menu_master.id` refer করে, `erp_menu.menu_master.id` না।)
 *
 * চালাও:  node scripts/acl-master-drift-check.mjs
 */

console.log(`-- ACL-MASTER drift check — run against dev AND prod separately.
-- Per company, finds the non-SA/GA user with the most ALLOW decisions (the
-- de-facto ACL-MASTER / maintenance-full-access user), then lists every
-- (resource_code, action_code) that at least one OTHER user in that company
-- has ALLOW on, but the ACL-MASTER user does not. Non-empty result = a real
-- gap: some page/action was added to another role's grants but never checked
-- against ACL-MASTER.
--
-- KNOWN_INTENTIONAL_EXCLUSIONS = documented business decisions to deny
-- ACL-MASTER a specific grant on purpose. Empty as of 2026-08-25 — this
-- ERP has no named-person-exclusive grants; everything is role/rank-based
-- (see the header comment above for the ACC_CONVERSION_COST correction that
-- emptied this list). Do not add an entry without the same rigor: verify
-- against acl.version_user_overrides AND confirm the grant genuinely cannot
-- be expressed as a role_capabilities row first.

WITH known_intentional_exclusions (resource_code, action_code, reason) AS (
  SELECT NULL::text, NULL::text, NULL::text WHERE FALSE
),
ranked AS (
  SELECT pav.company_id, c.company_code, pav.auth_user_id, u.user_code,
         count(*) FILTER (WHERE pav.decision = 'ALLOW') AS allow_count,
         row_number() OVER (
           PARTITION BY pav.company_id
           ORDER BY count(*) FILTER (WHERE pav.decision = 'ALLOW') DESC
         ) AS rnk
  FROM acl.precomputed_acl_view pav
  JOIN erp_core.users u ON u.auth_user_id = pav.auth_user_id
  JOIN erp_master.companies c ON c.id = pav.company_id
  LEFT JOIN erp_acl.user_roles ur ON ur.auth_user_id = pav.auth_user_id
  WHERE COALESCE(ur.role_code, '') NOT IN ('SA', 'GA')
  GROUP BY pav.company_id, c.company_code, pav.auth_user_id, u.user_code
),
acl_master AS (
  SELECT company_id, company_code, auth_user_id, user_code
  FROM ranked
  WHERE rnk = 1
),
everyone_else_allow AS (
  SELECT DISTINCT pav.company_id, pav.resource_code, pav.action_code
  FROM acl.precomputed_acl_view pav
  JOIN acl_master am ON am.company_id = pav.company_id AND am.auth_user_id <> pav.auth_user_id
  WHERE pav.decision = 'ALLOW'
),
acl_master_allow AS (
  SELECT pav.company_id, pav.resource_code, pav.action_code
  FROM acl.precomputed_acl_view pav
  JOIN acl_master am ON am.company_id = pav.company_id AND am.auth_user_id = pav.auth_user_id
  WHERE pav.decision = 'ALLOW'
)
SELECT am.company_code, am.user_code AS acl_master_user, e.resource_code, e.action_code
FROM everyone_else_allow e
JOIN acl_master am ON am.company_id = e.company_id
WHERE NOT EXISTS (
  SELECT 1 FROM acl_master_allow ma
  WHERE ma.company_id = e.company_id AND ma.resource_code = e.resource_code AND ma.action_code = e.action_code
)
AND NOT EXISTS (
  SELECT 1 FROM known_intentional_exclusions kie
  WHERE kie.resource_code = e.resource_code AND kie.action_code = e.action_code
)
ORDER BY am.company_code, e.resource_code, e.action_code;`);
