# CODEX TASK BRIEF — Gate-12: erp_master Master Data Extensions

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 12
**Dependency status:** Gate-11 — VERIFIED ✅ (you may proceed)
**Your task:** Create 10 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First (Do Not Skip)

Before writing a single line of code, read the following files **in this order**:

1. `docs/Operation Management/implementation-specs/OM-GATE-12-MasterData-Spec.md`
   → Your primary instruction. Every table, column, constraint, seed row, and function is defined here. Follow it exactly. Do not improvise.

2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Confirm Gate-11 shows VERIFIED before starting. Then update this file as you complete each item.

Read both files completely before starting. Do not guess or infer — if something is in the spec, do it exactly as written.

---

## Step 2 — Understand What You Are Building

You are implementing **Gate-12** of PACE-ERP Operation Management.

**What Gate-12 is:**
Master data tables added to the **existing** `erp_master` schema. This includes: unit of measure master, material master, material UOM conversions, material company/plant extensions, material category groups, vendor master, vendor company mapping, vendor payment terms log, vendor-material info record (approved source list), customer master, and PACE code sequence tables + generator functions.

**What Gate-12 is NOT:**
- Not a new schema — all tables go into `erp_master` which already exists
- Not handlers or Edge Functions
- Not any UI components
- Not changes to any existing `erp_master` tables

**Existing erp_master tables you must NOT touch:**
`companies`, `projects`, `departments`
(and any other tables that existed before Gate-12)

**Schemas you must NOT touch at all:**
`public`, `erp_core`, `erp_acl`, `erp_audit`, `erp_meta`, `erp_inventory`, `erp_hr`

---

## Step 3 — Migration Files: Location and Naming

**Where to create files:**
```
supabase/migrations/
```

**Naming convention:**
```
20260509{HHMMSS}_gate12_{spec_id}_{short_description}.sql
```

The 10 files you must create, with their exact names from the spec:

| Spec Item | Filename |
|---|---|
| 12.1 | `20260509120000_gate12_12_1_create_uom_master.sql` |
| 12.2 | `20260509121000_gate12_12_2_create_material_master.sql` |
| 12.3 | `20260509122000_gate12_12_3_create_material_uom_conversion.sql` |
| 12.4 | `20260509123000_gate12_12_4_create_material_extensions.sql` |
| 12.5 | `20260509124000_gate12_12_5_create_material_category_group.sql` |
| 12.6 | `20260509125000_gate12_12_6_create_vendor_master.sql` |
| 12.7 | `20260509126000_gate12_12_7_create_vendor_payment_terms_log.sql` |
| 12.8 | `20260509127000_gate12_12_8_create_vendor_material_info.sql` |
| 12.9 | `20260509128000_gate12_12_9_create_customer_master.sql` |
| 12.10 | `20260509129000_gate12_12_10_create_pace_code_sequences.sql` |

---

## Step 4 — File Header Format

Every migration file must start with this header. Use `/* */` style:

```sql
/*
 * File-ID: 12.X
 * File-Path: supabase/migrations/20260509HHMMSS_gate12_12_X_description.sql
 * Gate: 12
 * Phase: 12
 * Domain: MASTER
 * Purpose: One sentence describing what this migration does.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules (Every Line Matters)

If you violate any of these, Claude will mark Gate-12 FAILED.

### Rule 1: NO payment_terms column on vendor_master
Do NOT add any column named `payment_terms`, `payment_terms_days`, `default_payment_terms`, or anything similar to the `vendor_master` table.

Payment terms are stored dynamically in `vendor_payment_terms_log` only. This is intentional by design. The spec will show you the correct structure — follow it without modification.

### Rule 2: vendor_material_info MUST have UNIQUE(vendor_id, material_id)
This table serves as the Approved Source List. A vendor can only have ONE info record per material. The UNIQUE constraint enforces this:
```sql
UNIQUE (vendor_id, material_id)
```
Do not omit this constraint.

### Rule 3: NO cross-schema FK constraints
`material_plant_ext` has a column `default_storage_location_id` that references `erp_inventory.storage_location_master`. Write it as plain `uuid NULL` with NO foreign key constraint. Cross-schema FK constraints are avoided in this project.

The same rule applies anywhere a column references a table in another schema. Comment what it references, but do not create the FK.

### Rule 4: material_master must have ALL columns from the spec
Including the FG-specific columns: `shade_code`, `pack_code`, `external_sku`.
Including QA columns: `qa_required_on_inward`, `qa_required_on_fg`.
Including batch columns: `batch_tracking_required`, `fifo_tracking_enabled`, `expiry_tracking_enabled`, `shelf_life_days`, `min_shelf_life_at_grn_days`.
Including production columns: `production_mode`, `bom_exists`, `delivery_tolerance_enabled`, `under_delivery_tolerance_pct`, `over_delivery_tolerance_pct`.

Do not abbreviate or skip any column. The spec is complete — copy it faithfully.

### Rule 5: material_code_sequence must be seeded with exactly 6 rows
One row per material type: RM, PM, INT, FG, TRA, CONS
Each with the correct prefix and padding=5.

### Rule 6: All three generator functions must be SECURITY DEFINER
- `erp_master.generate_material_pace_code(p_material_type text)`
- `erp_master.generate_vendor_code()`
- `erp_master.generate_customer_code()`

All three must include `SECURITY DEFINER` in the function declaration. Copy the function bodies exactly from the spec.

### Rule 7: vendor_code_sequence and customer_code_sequence are singletons
Each has a single row with `id = 1` and `last_number = 0`. The CHECK constraint `(id = 1)` enforces the singleton. Seed the row in the same migration.

### Rule 8: material_category_group_member needs a partial unique index
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcgm_one_primary
  ON erp_master.material_category_group_member (group_id)
  WHERE is_primary = true AND active = true;
```
This enforces only one primary material per group. Do not omit it.

### Rule 9: uom_master must be seeded in migration 12.1
Seed all 14 standard UOMs from the spec in the same migration that creates the table. Use `ON CONFLICT (code) DO NOTHING`.

### Rule 10: material_master.base_uom_code is a FK to uom_master
Same for `purchase_uom_code` and `issue_uom_code`. These are intra-schema FKs (both in erp_master) so they ARE required as foreign key constraints:
```sql
base_uom_code text NOT NULL REFERENCES erp_master.uom_master(code) ON DELETE RESTRICT
```

### Rule 11: Do NOT modify existing erp_master tables
Do not ALTER, DROP, or add columns to `companies`, `projects`, or `departments`. Read-only for those tables.

### Rule 12: vendor_master cc_email_list is text[] (array)
```sql
cc_email_list text[] NULL DEFAULT ARRAY[]::text[]
```
Not a text column. Not a JSON column. Must be `text[]`.

### Rule 13: vendor_payment_terms_log needs a DESC index
```sql
CREATE INDEX IF NOT EXISTS idx_vptl_vendor_company_latest
  ON erp_master.vendor_payment_terms_log (vendor_id, company_id, recorded_at DESC);
```
This DESC ordering is required for fast "latest terms" lookups.

---

## Step 6 — Self-Check Before Marking Done

Run this checklist mentally before updating the log:

```
[ ] Migration 12.1: uom_master created + 14 rows seeded (KG, G, MT, L, ML, NOS, MTR, BAG, DRM, PKT, BOX, CTN, CAN, SET)
[ ] Migration 12.2: material_master with ALL columns including FG-specific, batch, QA, production fields
[ ] Migration 12.2: material_master has status CHECK (DRAFT, PENDING_APPROVAL, ACTIVE, INACTIVE, BLOCKED)
[ ] Migration 12.2: base_uom_code, purchase_uom_code, issue_uom_code have FK to uom_master
[ ] Migration 12.3: material_uom_conversion with UNIQUE(material_id, from_uom_code, to_uom_code)
[ ] Migration 12.4: material_company_ext with UNIQUE(material_id, company_id)
[ ] Migration 12.4: material_plant_ext with UNIQUE(material_id, company_id, plant_id)
[ ] Migration 12.4: material_plant_ext.default_storage_location_id is plain uuid NULL — NO FK
[ ] Migration 12.5: material_category_group + material_category_group_member tables
[ ] Migration 12.5: partial unique index idx_mcgm_one_primary on group_id WHERE is_primary=true AND active=true
[ ] Migration 12.6: vendor_master with NO payment_terms column
[ ] Migration 12.6: vendor_master.cc_email_list is text[] with DEFAULT ARRAY[]::text[]
[ ] Migration 12.6: vendor_master.vendor_type CHECK IN ('DOMESTIC', 'IMPORT')
[ ] Migration 12.6: vendor_company_map with UNIQUE(vendor_id, company_id)
[ ] Migration 12.7: vendor_payment_terms_log with DESC index on (vendor_id, company_id, recorded_at)
[ ] Migration 12.8: vendor_material_info with UNIQUE(vendor_id, material_id)
[ ] Migration 12.8: vendor_material_info.status CHECK IN ('ACTIVE', 'INACTIVE')
[ ] Migration 12.9: customer_master + customer_company_map tables
[ ] Migration 12.10: material_code_sequence seeded with 6 rows (RM, PM, INT, FG, TRA, CONS)
[ ] Migration 12.10: vendor_code_sequence singleton (id=1, last_number=0)
[ ] Migration 12.10: customer_code_sequence singleton (id=1, last_number=0)
[ ] Migration 12.10: generate_material_pace_code() — SECURITY DEFINER, returns 'RM-00001' format
[ ] Migration 12.10: generate_vendor_code() — SECURITY DEFINER, returns 'V-00001' format
[ ] Migration 12.10: generate_customer_code() — SECURITY DEFINER, returns 'C-00001' format
[ ] NO tables created in public schema
[ ] All files have /* */ header with Gate: 12, Phase: 12, Domain: MASTER
[ ] No existing erp_master tables modified
```

---

## Step 7 — How to Update the Log

File to update: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After completing **each migration file**, update the corresponding row:

```markdown
| 12.1 | uom_master table | DONE | supabase/migrations/20260509120000_gate12_12_1_create_uom_master.sql | — | — |
```

After completing **all 10 files**, add at the bottom of the Gate-12 table:
```
Gate-12 implementation complete. All 10 migrations created. Awaiting Claude verification.
```

Update the log header:
```markdown
**Started:** 2026-05-09
**Completed:** 2026-05-09
```

---

## Step 8 — Hard Stop: Do NOT Start Gate-13

After completing Gate-12, update the log and stop. Claude must verify Gate-12 before Gate-13 begins.

Gate-13 spec does not exist yet. Do not create any Gate-13 files.

---

## Reference: Key Design Decisions (Read If You Have Any Doubt)

| Question | Answer |
|---|---|
| Where do vendor payment terms go? | `vendor_payment_terms_log` only. NEVER on `vendor_master`. |
| What is vendor_material_info? | It is both the info record AND the approved source list. One entity. UNIQUE(vendor_id, material_id). |
| Can a PO be raised if vendor_material_info.status = 'INACTIVE'? | No. Hard block at PO creation handler. (Handler is built in Gate-13, but this data structure must support it.) |
| Is there a separate Approved Source List table? | No. vendor_material_info IS the approved source list. |
| Does material_plant_ext.default_storage_location_id need a FK? | No. UUID reference without FK. Cross-schema FK avoided. |
| What is the material PACE code format? | RM-00001, PM-00001, INT-00001, FG-00001, TRA-00001, CONS-00001 |
| What is the vendor code format? | V-00001 |
| What is the customer code format? | C-00001 |
| Which schema do all Gate-12 tables go in? | erp_master (existing schema, do NOT create a new schema) |

---

*Task issued by Claude on 2026-05-09*
*Spec authority: OM-GATE-12-MasterData-Spec.md (FROZEN)*
*Gate-11 VERIFIED — you may proceed*
*Do not proceed to Gate-13 until Claude marks Gate-12 VERIFIED in OM-IMPLEMENTATION-LOG.md*
