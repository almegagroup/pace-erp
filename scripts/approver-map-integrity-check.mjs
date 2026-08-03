#!/usr/bin/env node
/*
 * Approver-Map Integrity Check — 11-bug-pattern #9
 * ("acl.approver_map scope / uniqueness shape")
 *
 * কী করে: `acl.approver_map`-এর ভেতরের data নিয়ে ৩টা জিনিস চেক করে:
 *   1. Exact duplicate rows (একই company+resource+action+subject+approver+stage
 *      একাধিকবার — insert করার সময় ভুলে দুবার চালানো হলে হয়)
 *   2. একটা subject_role_code-এর approver হিসেবে তার নিজেকেই বসানো (self-loop —
 *      যেমন ভুল করে subject_role_code='L2_AUDITOR' আর approver_role_code=
 *      'L2_AUDITOR' একই row-এ, যেটা কখনো কার্যকর approve হতে দেবে না কারণ
 *      matchesXApprover-এ ওই role নিজের জন্যই approve করবে বলে মনে হবে অথচ
 *      বাস্তবে ওই role-এর কেউ নিজের creation approve করতে পারবে না)
 *   3. একটা (company, resource, action) জোড়ায় কোনো subject_role_code-এর জন্য
 *      একটাও approver row না থাকা, অথচ সেই resource-এ approver_map ব্যবহারই
 *      হচ্ছে (অন্য subject role-এর row আছে) — এটা মানে সেই নির্দিষ্ট rank-এর
 *      কেউ draft বানালে approve করার কেউ নেই (DIRECTOR bypass বাদে)।
 *
 * কেন দরকার: CLAUDE.md checklist #9 — approver_map-এর scope/uniqueness shape
 * নতুন design-এর সময় re-check করা লাগে, পুরনো shape নতুন design-এর জন্য সঠিক
 * এমন ধরে নেওয়া যাবে না।
 *
 * ⚠️ এই script কখনো database-এ সরাসরি connect করে না — শুধু SQL print করে,
 * MCP/SQL editor দিয়ে dev/prod-এ আলাদাভাবে চালাতে হবে। CI-তে বসানো হয়নি।
 *
 * চালাও:  node scripts/approver-map-integrity-check.mjs
 */

console.log(`-- Approver-map integrity check — run against dev AND prod separately.

-- 1. Exact duplicate rows
SELECT company_id, resource_code, action_code, scope_type, subject_role_code,
       subject_user_id, subject_work_context_id, approver_role_code, approver_user_id,
       approval_stage, count(*) AS dup_count
FROM acl.approver_map
GROUP BY company_id, resource_code, action_code, scope_type, subject_role_code,
         subject_user_id, subject_work_context_id, approver_role_code, approver_user_id,
         approval_stage
HAVING count(*) > 1;

-- 2. Self-loop rows (subject role = approver role at the same stage — this
--    role can never actually approve its own creation, since self-approval
--    is always blocked in code; a row like this is dead weight at best,
--    or a copy-paste mistake meant to point at a DIFFERENT approver)
SELECT approver_id, company_id, resource_code, subject_role_code, approver_role_code
FROM acl.approver_map
WHERE scope_type = 'SUBJECT_ROLE'
  AND subject_role_code IS NOT NULL
  AND subject_role_code = approver_role_code;

-- 3. Subject roles with zero configured approvers, where the SAME
--    (company, resource, action) already has approver_map rows for OTHER
--    subject roles (i.e. this resource clearly uses per-rank routing, but
--    one specific rank was left with nobody to approve it, other than the
--    DIRECTOR code-level bypass).
WITH resource_scopes AS (
  SELECT DISTINCT company_id, resource_code, action_code FROM acl.approver_map
),
role_catalog(role_code) AS (
  VALUES ('L1_USER'),('L2_USER'),('L3_USER'),('L4_USER'),
         ('L1_MANAGER'),('L2_MANAGER'),('L3_MANAGER'),('L4_MANAGER'),
         ('L1_AUDITOR'),('L2_AUDITOR')
),
expected AS (
  SELECT rs.company_id, rs.resource_code, rs.action_code, rc.role_code
  FROM resource_scopes rs
  CROSS JOIN role_catalog rc
  -- only check roles that appear as a subject SOMEWHERE for this resource
  -- (i.e. the resource is known to use per-rank subject routing at all)
  WHERE EXISTS (
    SELECT 1 FROM acl.approver_map am
    WHERE am.company_id = rs.company_id AND am.resource_code = rs.resource_code
      AND am.action_code = rs.action_code AND am.subject_role_code IS NOT NULL
  )
)
SELECT e.company_id, e.resource_code, e.action_code, e.role_code AS subject_role_with_no_approver
FROM expected e
WHERE NOT EXISTS (
  SELECT 1 FROM acl.approver_map am
  WHERE am.company_id = e.company_id AND am.resource_code = e.resource_code
    AND am.action_code = e.action_code AND am.subject_role_code = e.role_code
)
-- only flag roles that are plausible creators for this resource: i.e. the
-- role appears as a subject for AT LEAST ONE other resource anywhere (so we
-- don't flag e.g. L4_MANAGER for a resource that was only ever designed for
-- L1-L4_USER as creators)
AND EXISTS (
  SELECT 1 FROM acl.approver_map am2
  WHERE am2.resource_code = e.resource_code AND am2.subject_role_code = e.role_code
)
ORDER BY e.resource_code, e.company_id, e.role_code;`);
