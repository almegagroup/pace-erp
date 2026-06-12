# ACL Setup Progress Log

**Last Updated:** 2026-05-26  
**Dev Supabase Project:** `ytapuwiqicmvpanmzelb`  
**Status:** erp_menu complete ✅ | acl setup pending 🔴

---

## কেন এই কাজ করা হচ্ছে

PACE ERP-তে navigation sidebar dynamically generate হয় user-এর ACL থেকে। এই পুরো chain কাজ করতে হলে database-এর বেশ কয়েকটা layer properly populated থাকতে হবে।

**Goal:** প্রতিটা screen-এর জন্য ACL properly set করা, যাতে:
- User login করলে শুধু তার permitted screens দেখায়
- Role-based access কাজ করে (DIRECTOR → L1_USER)
- `generate_menu_snapshot()` সঠিক sidebar generate করে

---

## ACL Chain (Full Flow)

```
acl.menu_master  ←── এখানেই critical gap আছে
    ↓  (menu_code = resource_code join)
erp_menu.menu_master
    ↓
acl.capability_menu_actions  (menu → capability link)
    ↓
acl.capabilities  (capability packs)
    ↓
acl.work_context_capabilities  (work context → capability link)
    ↓
erp_acl.work_contexts
    ↓
acl.user_work_contexts  (user → work context)
    ↓
acl.capture_acl_version_source(version_id)
    ↓
acl.generate_acl_snapshot(version_id)  →  acl.precomputed_acl_view
    ↓  (WHERE decision='ALLOW' AND action_code='VIEW')
erp_menu.generate_menu_snapshot(user_id)  →  erp_menu.user_menu_snapshots
    ↓
Frontend Sidebar
```

**Critical join rule:**
- `acl.menu_master.menu_code` MUST = `erp_menu.menu_master.resource_code`
- এটা match না করলে ACL generate হবে না

---

## এই Session এ কী কী করা হয়েছে

### ১. Group 9 (Attendance) — Menu DB Setup ✅
- `erp_menu.menu_master`-এ ৯টা Attendance page insert
- `erp_menu.menu_tree`-এ ৯টা tree entry insert
- **Final count:** ৯টা group · ৬৪টা page · ৬৪টা tree entry

### ২. Screen Count Analysis ✅
| File | Total | Navigable | Companion |
|------|-------|-----------|-----------|
| `operationScreens.js` | 62 | 43 | 19 |
| `hrScreens.js` | 26 | 21 | 5 |
| **Total** | **88** | **64** | **24** |

Companion screens (detail/results pages) → menu_master-এ নেই, `routeIndex.js`-এর `buildRouteIndex()` দিয়ে route হয় ✅

### ৩. MCP (Supabase Access) Setup ✅
Claude → Supabase access: `@supabase/mcp-server-supabase@latest` with PAT  
PAT name: `pace-erp-claude-mcp`  
Config files: ৪টা (CLAUDE.md-এ list দেখো)

---

## Current DB State

### erp_menu.menu_master — 64 pages ✅
9 groups এর সব navigable pages:
| Group | Pages |
|-------|-------|
| Dashboard | 1 |
| Operation Management | ~8 |
| Procurement | ~27 |
| HR Leave | ~6 |
| HR Out-Work | ~4 |
| HR Attendance | 9 |
| Payroll | ~4 |
| Admin | ~3 |
| System | ~2 |

### acl.menu_master — 10 wrong entries 🔴
পুরনো `menu_code` values যেগুলো `erp_menu.menu_master.resource_code` এর সাথে মিলে না।
উদাহরণ: `HR_LEAVE_APPLY` আছে, কিন্তু erp_menu তে আছে `ACL_LV_APPLY`।

### Other ACL tables — all empty 🔴
- `acl.capabilities`: empty
- `acl.capability_menu_actions`: empty
- `erp_acl.work_contexts`: empty
- `acl.work_context_capabilities`: empty
- `erp_master.departments`: empty
- `erp_master.projects`: empty
- `erp_map.company_projects`: empty
- `acl.module_registry`: empty
- `acl.module_resource_map`: empty

---

## Next Steps — 16-Step ACL Full Setup

### 🔴 Step 1: `acl.menu_master` Fix (সবচেয়ে আগে)

```sql
-- ১. আগে দেখো কী আছে
SELECT menu_code, menu_name FROM acl.menu_master;

-- ২. acl.menu_master এর exact columns দেখো
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'acl' AND table_name = 'menu_master';

-- ৩. erp_menu থেকে navigable pages দেখো
SELECT resource_code, menu_label, menu_group 
FROM erp_menu.menu_master 
ORDER BY display_order;

-- ৪. পুরনো entries delete করো
DELETE FROM acl.menu_master;

-- ৫. erp_menu থেকে সব 64টা page insert করো
-- (exact SQL: column structure দেখার পর বানাতে হবে)
INSERT INTO acl.menu_master (menu_code, menu_name, ...)
SELECT resource_code, menu_label, ...
FROM erp_menu.menu_master
WHERE ... -- navigable filter
```

> ⚠️ এটা শেষ না হলে বাকি সব কাজ বৃথা।

---

### Step 2: `erp_master.projects`

```sql
-- OPERATION MANAGEMENT project insert
INSERT INTO erp_master.projects (project_code, project_name, is_active)
VALUES ('OM', 'Operation Management', true);

-- অন্যান্য projects (HR, Procurement etc.) confirm করো
```

---

### Step 3: `erp_map.company_projects`

কোন কোন company কোন project পাবে — user input দরকার:
- কোন companies আছে? (ASCL, MCPL, ACPL?)
- প্রতিটা company কোন কোন project পাবে?

---

### Step 4: `acl.module_registry`

```sql
-- modules: HR, Operation, Procurement, Payroll, Admin, System
INSERT INTO acl.module_registry (module_code, module_name, project_id) VALUES
('MOD_HR', 'Human Resources', <hr_project_id>),
('MOD_OM', 'Operation Management', <om_project_id>),
('MOD_PROC', 'Procurement', <proc_project_id>),
...
```

---

### Step 5: `acl.module_resource_map`

প্রতিটা module এর অন্তর্গত resource_code গুলো map করো:
```sql
-- উদাহরণ: HR module → সব HR resource_codes
INSERT INTO acl.module_resource_map (module_code, resource_code)
SELECT 'MOD_HR', resource_code 
FROM erp_menu.menu_master 
WHERE menu_group IN ('HR Leave', 'HR Out-Work', 'HR Attendance', 'Payroll');
```

---

### Step 6: `acl.capabilities`

Capability packs তৈরি:
```sql
INSERT INTO acl.capabilities (cap_code, cap_name, description) VALUES
('CAP_HR_FULL', 'HR Full Access', 'All HR screens'),
('CAP_HR_VIEWER', 'HR View Only', 'HR screens view only'),
('CAP_OM_FULL', 'Operation Full Access', 'All OM screens'),
('CAP_PROC_FULL', 'Procurement Full Access', 'All procurement screens'),
('CAP_ADMIN', 'Admin Access', 'Admin and system screens');
```

---

### Step 7: `acl.capability_menu_actions`

প্রতিটা capability কোন screens এ VIEW দেবে:
```sql
-- উদাহরণ: CAP_HR_FULL → সব HR resource_codes এ VIEW
INSERT INTO acl.capability_menu_actions (cap_code, resource_code, action_code)
SELECT 'CAP_HR_FULL', resource_code, 'VIEW'
FROM erp_menu.menu_master
WHERE menu_group IN ('HR Leave', 'HR Out-Work', 'HR Attendance', 'Payroll');
```

---

### Step 8: `acl.role_capabilities`

কোন role কোন capability পাবে:
```sql
INSERT INTO acl.role_capabilities (role_code, cap_code) VALUES
('DIRECTOR', 'CAP_HR_FULL'),
('DIRECTOR', 'CAP_OM_FULL'),
('DIRECTOR', 'CAP_PROC_FULL'),
('L4_MANAGER', 'CAP_HR_FULL'),
-- ... etc
```

---

### Step 9: `erp_master.departments` ⚠️ User Input দরকার

কোন কোন company আছে এবং প্রতিটায় কী কী department?
উদাহরণ:
- ASCL: HR, Production, Stores, Finance
- MCPL: HR, Production, QA

---

### Step 10: `erp_acl.work_contexts` ⚠️ User Input দরকার

Work context হলো runtime functional responsibility।
উদাহরণ:
- `WC_HR_OPS` → HR Operations
- `WC_PLANT_HEAD` → Plant Head
- `WC_STORE` → Store Controller
- `WC_PROD_OP` → Production Operator

---

### Step 11: `acl.work_context_capabilities`

```sql
INSERT INTO acl.work_context_capabilities (wc_code, cap_code) VALUES
('WC_HR_OPS', 'CAP_HR_FULL'),
('WC_PLANT_HEAD', 'CAP_OM_FULL'),
('WC_PLANT_HEAD', 'CAP_PROC_FULL'),
-- ...
```

---

### Step 12: `acl.acl_versions`

প্রতিটা company-র জন্য একটা করে version:
```sql
INSERT INTO acl.acl_versions (company_id, version_label, is_active)
VALUES (<ascl_id>, 'v1.0', true);
```

---

### Step 13: ACL Compute

```sql
SELECT acl.capture_acl_version_source(<version_id>);
SELECT acl.generate_acl_snapshot(<version_id>);

-- Verify:
SELECT resource_code, decision, action_code 
FROM acl.precomputed_acl_view 
LIMIT 20;
```

---

### Step 14: User Assignment

```sql
-- User → company, role, work context assign করো
INSERT INTO acl.user_work_contexts (user_id, wc_code, company_id)
VALUES (<user_id>, 'WC_HR_OPS', <company_id>);
```

---

### Step 15: Menu Snapshot Generate

```sql
SELECT erp_menu.generate_menu_snapshot(<user_id>);

-- Verify:
SELECT * FROM erp_menu.user_menu_snapshots 
WHERE user_id = <user_id>;
```

---

### Step 16: Login Test ✅

User login করে sidebar দেখো — শুধু permitted screens দেখালে সফল।

---

## New Session Prompt

```
pace-erp ACL setup continue করো।
CLAUDE.md এবং docs/ACL_SETUP_PROGRESS.md পড়ো।
MCP test করো তারপর Step 1 (acl.menu_master fix) থেকে শুরু করো।
Dev project: ytapuwiqicmvpanmzelb
```

---

## Session History

| Date | কাজ |
|------|-----|
| 2026-05-26 | Group 9 (Attendance) menu DB insert · Screen count analysis · MCP PAT rotation · CLAUDE.md + this file created |
