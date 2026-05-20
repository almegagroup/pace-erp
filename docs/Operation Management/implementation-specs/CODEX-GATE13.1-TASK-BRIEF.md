# CODEX TASK BRIEF — Gate-13.1: L2 Masters (erp_master)

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-11
**Gate:** 13.1
**Dependency status:** Gate-12 VERIFIED ✅ — proceed
**Your task:** Create 8 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-13.1-L2Masters-DB-Spec.md`
   → Complete spec. All SQL is written there. Copy exactly.

2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Update after each item. Gate-13.1 section is already added.

---

## Step 2 — What You Are Building

New master tables in the existing `erp_master` schema. These are prerequisites for all L2 procurement gates (13.2–13.9).

**Masters being created:**
```
payment_terms_master          → Structured payment terms (PT-001, PT-002...)
port_master                   → SEA/AIR/LAND ports
port_plant_transit_master     → Days from port to destination company
material_category_master      → Procurement planning categories (MC-0001...)
material_category_assignment  → Material → category mapping
lead_time_master_import       → Sail time + clearance days per vendor/category/port
lead_time_master_domestic     → Transit days per vendor/destination company
transporter_master            → INBOUND/OUTBOUND/BOTH direction flag
cha_master                    → Clearing agents
cha_port_map                  → CHA → port mapping
vendor_master ALTER           → Add indent_number_required flag
```

**This gate is DB structures only. No handlers. No frontend.**

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `20260511010000_gate13_1_13_1_1_create_payment_terms_master.sql` | Payment Terms Master + code sequence + generator |
| `20260511011000_gate13_1_13_1_2_create_port_master.sql` | Port Master + code sequence + generator |
| `20260511012000_gate13_1_13_1_3_create_port_plant_transit_master.sql` | Port-to-Plant transit days |
| `20260511013000_gate13_1_13_1_4_create_material_category_master.sql` | Material Category Master + assignment table |
| `20260511014000_gate13_1_13_1_5_create_lead_time_masters.sql` | Lead Time Import + Lead Time Domestic |
| `20260511015000_gate13_1_13_1_6_create_transporter_master.sql` | Transporter Master + code sequence |
| `20260511016000_gate13_1_13_1_7_create_cha_master.sql` | CHA Master + cha_port_map |
| `20260511017000_gate13_1_13_1_8_extend_vendor_master.sql` | ALTER vendor_master — add indent_number_required |

All go in: `supabase/migrations/`

---

## Step 4 — File Header (use this format exactly)

```sql
/*
 * File-ID: 13.1.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_1_13_1_X_description.sql
 * Gate: 13.1
 * Phase: 13
 * Domain: L2_MASTERS
 * Purpose: One sentence.
 * Authority: Backend
 */
```

---

## Step 5 — Critical Rules

### Rule 1: All tables in erp_master schema
Not public. Not erp_procurement. Not erp_inventory.

### Rule 2: Intra-schema FKs ARE allowed
These stay within erp_master so FK constraints are correct:
- `port_plant_transit_master.port_id` → `erp_master.port_master(id)`
- `port_plant_transit_master.company_id` → `erp_master.companies(id)`
- `material_category_assignment.material_id` → `erp_master.material_master(id)`
- `material_category_assignment.category_id` → `erp_master.material_category_master(id)`
- `lead_time_master_import.vendor_id` → `erp_master.vendor_master(id)`
- `lead_time_master_import.material_category_id` → `erp_master.material_category_master(id)`
- `lead_time_master_import.port_of_discharge_id` → `erp_master.port_master(id)`
- `lead_time_master_domestic.vendor_id` → `erp_master.vendor_master(id)`
- `lead_time_master_domestic.company_id` → `erp_master.companies(id)`
- `cha_port_map.cha_id` → `erp_master.cha_master(id)`
- `cha_port_map.port_id` → `erp_master.port_master(id)`

### Rule 3: port_master.default_cha_id is plain UUID — NO FK
CHA master is created in migration 13.1.7 (after port_master in 13.1.2). No FK to avoid ordering dependency. This is intentional.

### Rule 4: material_category_master ≠ material_category_group
Gate-12 created `erp_master.material_category_group` (groups functional substitutes). This gate creates `erp_master.material_category_master` (procurement planning categories). These are different tables with different purposes.

### Rule 5: material_category_assignment has UNIQUE(material_id)
Each material has exactly one planning category.

### Rule 6: transporter_master usage_direction CHECK
```sql
CHECK (usage_direction IN ('INBOUND', 'OUTBOUND', 'BOTH'))
```

### Rule 7: All code generators are SECURITY DEFINER functions

### Rule 8: Migration 13.1.8 is ALTER only
```sql
ALTER TABLE erp_master.vendor_master
  ADD COLUMN IF NOT EXISTS indent_number_required boolean NOT NULL DEFAULT false;
```
No CREATE TABLE in this migration.

### Rule 9: No handlers, no TypeScript, no frontend
DB only. If you find yourself writing anything other than SQL — stop.

---

## Step 6 — Self-Check

```
[ ] 8 migration files created in supabase/migrations/
[ ] All files have correct File-ID: 13.1.X headers
[ ] payment_terms_master: payment_method CHECK (6 values), lc_type CHECK (3 values)
[ ] port_master: port_type CHECK (SEA/AIR/LAND), default_cha_id is plain uuid NULL (no FK)
[ ] port_plant_transit_master: UNIQUE(port_id, company_id), transit_days CHECK >= 0
[ ] material_category_master: separate from material_category_group (Gate-12)
[ ] material_category_assignment: UNIQUE(material_id)
[ ] lead_time_master_import: sail_time_days + clearance_days both CHECK >= 0
[ ] lead_time_master_domestic: transit_days CHECK >= 0
[ ] transporter_master: usage_direction CHECK ('INBOUND','OUTBOUND','BOTH')
[ ] cha_master: cha_license_number NOT NULL
[ ] cha_port_map: UNIQUE(cha_id, port_id)
[ ] vendor_master: indent_number_required added with DEFAULT false
[ ] All 7 generator functions: SECURITY DEFINER
[ ] GRANT SELECT TO authenticated on all new tables
[ ] GRANT ALL TO service_role on all new tables and sequences
[ ] No tables in public schema
```

---

## Step 7 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file, update the Gate-13.1 table row:
```
| 13.1.X | item name | DONE | supabase/migrations/filename.sql | - | - |
```

After all 8 files:
```
Gate-13.1 implementation complete. All 8 migrations created. Awaiting Claude verification.
```

---

## Step 8 — Hard Stop

After Gate-13.1, stop. Claude verifies. Then Gate-13.2 (Purchase Order) brief will be issued.

Do not start Gate-13.2 until Claude marks Gate-13.1 VERIFIED.

---

*Task issued: 2026-05-11*
*Gate-12 VERIFIED ✅*
*Do not start Gate-13.2 until Claude marks Gate-13.1 VERIFIED.*
