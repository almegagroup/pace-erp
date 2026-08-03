#!/usr/bin/env node
/*
 * ACL Version Capture Drift Check — 11-bug-pattern #4
 * ("capture_acl_version_source() one-time trap")
 *
 * কী করে: প্রতি company-র active `acl_versions` row-এর `source_captured_at`
 * এর *পরে* যদি কোনো live grant table-এ নতুন row বসে থাকে (নতুন capability_menu_
 * actions/role_capabilities/role_menu_permissions/user_overrides/company_module_
 * map/work_context_capabilities), সেটা মানে — কেউ live data বদলেছে কিন্তু একটা
 * নতুন ACL version capture+generate+activate করেনি। ফলে সেই নতুন grant
 * `precomputed_acl_view`-তে কখনো পৌঁছায়নি, page/action চুপচাপ অদৃশ্য থেকে যায়।
 *
 * কেন দরকার: `acl.capture_acl_version_source()` bootstrap-only — একই
 * acl_version_id-তে দ্বিতীয়বার call করলে সম্পূর্ণ no-op (silent, কোনো error
 * ছাড়াই)। এই সেশনেই AC04/PR22/PR23-এর মতো কয়েকটা real incident এই ভুলে হয়েছিল
 * (CLAUDE.md §8 "দ্বিতীয় সংশোধন" নোট দেখো)।
 *
 * ⚠️ এই script কখনো database-এ সরাসরি connect করে না — শুধু SQL print করে,
 * সেটা তুমি MCP/SQL editor দিয়ে target project-এ (dev বা prod) চালাবে।
 * migration-integrity-check.mjs-এর মতোই pattern — তাই কোনো credential এই
 * script-এ থাকে না, আর এটা CI-তে বসানো হয়নি (build কখনো আটকাবে না)।
 *
 * ⚠️ সীমাবদ্ধতা: এই ৬টা table-এর কোনোটাতেই `updated_at` নেই, শুধু `created_at` —
 * তাই এই check শুধু "নতুন row বসেছে" ধরতে পারে, কোনো existing row TOGGLE/EDIT
 * হওয়া (যেমন allowed=true থেকে false) ধরতে পারে না। এই সীমাবদ্ধতা মাথায় রেখেই
 * ব্যবহার করো — "flag কিছু দেখায়নি" মানেই "কিছু বদলায়নি" না।
 *
 * চালাও:  node scripts/acl-version-capture-drift-check.mjs
 */

console.log(`-- ACL version capture drift check — run against dev AND prod separately.
-- For each company's ACTIVE acl_version, lists any live grant rows created
-- AFTER that version's source_captured_at. A non-empty result means live ACL
-- data changed since the last capture, but was never folded into a new
-- version — those grants are invisible to precomputed_acl_view today.
--
-- Known limitation: only catches NEW rows (created_at), not toggled/edited
-- existing ones (none of these 6 tables track updated_at).

WITH active_versions AS (
  SELECT av.acl_version_id, av.company_id, c.company_code, av.version_number, av.source_captured_at
  FROM acl.acl_versions av
  JOIN erp_master.companies c ON c.id = av.company_id
  WHERE av.is_active = true
),
drift AS (
  SELECT av.company_code, av.version_number, 'capability_menu_actions' AS live_table, count(*) AS new_rows
  FROM acl.capability_menu_actions t
  JOIN active_versions av ON true
  WHERE t.created_at > av.source_captured_at
  GROUP BY av.company_code, av.version_number
  UNION ALL
  SELECT av.company_code, av.version_number, 'role_capabilities', count(*)
  FROM acl.role_capabilities t
  JOIN active_versions av ON true
  WHERE t.created_at > av.source_captured_at
  GROUP BY av.company_code, av.version_number
  UNION ALL
  SELECT av.company_code, av.version_number, 'role_menu_permissions', count(*)
  FROM acl.role_menu_permissions t
  JOIN active_versions av ON true
  WHERE t.created_at > av.source_captured_at
  GROUP BY av.company_code, av.version_number
  UNION ALL
  SELECT av.company_code, av.version_number, 'user_overrides', count(*)
  FROM acl.user_overrides t
  JOIN active_versions av ON t.company_id = av.company_id
  WHERE t.created_at > av.source_captured_at
  GROUP BY av.company_code, av.version_number
  UNION ALL
  SELECT av.company_code, av.version_number, 'company_module_map', count(*)
  FROM acl.company_module_map t
  JOIN active_versions av ON t.company_id = av.company_id
  WHERE t.created_at > av.source_captured_at
  GROUP BY av.company_code, av.version_number
  UNION ALL
  SELECT av.company_code, av.version_number, 'work_context_capabilities', count(*)
  FROM acl.work_context_capabilities t
  JOIN active_versions av ON true
  WHERE t.created_at > av.source_captured_at
  GROUP BY av.company_code, av.version_number
)
SELECT * FROM drift WHERE new_rows > 0 ORDER BY company_code, live_table;`);
