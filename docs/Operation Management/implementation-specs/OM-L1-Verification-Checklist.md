# OM-L1 Verification Checklist
# PACE-ERP Operation Management — Gate-11 & Gate-12 Verification

**Verifier:** Claude
**Implementer:** Codex
**Purpose:** Step-by-step checklist Claude follows after Codex marks Gate-11 or Gate-12 DONE.
**Authority:** This checklist overrides generic review. If it passes here, mark VERIFIED. If any check fails, mark FAILED and log in Failure Register.

---

## How to Use This Checklist

1. Wait for Codex to mark all items in a gate as DONE in `OM-IMPLEMENTATION-LOG.md`
2. Run each SQL block in the Supabase SQL editor (service role)
3. Compare output to expected result
4. Mark each check ✅ PASS or ❌ FAIL
5. If all checks pass → mark gate VERIFIED in the log
6. If any check fails → mark gate FAILED, add to Failure Register with reason

**SQL environment:** Run all queries as `service_role` (Supabase SQL editor or direct psql). Queries use schema-qualified names.

---

## GATE-11 VERIFICATION — erp_inventory Schema

**Prerequisite:** Codex has updated OM-IMPLEMENTATION-LOG.md items 11.1–11.14 to DONE.

---

### CHECK 11-A — Schema Exists

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name = 'erp_inventory';
```

**Expected:** 1 row — `erp_inventory`
**Fail means:** Migration 11.1 did not run or failed silently.

---

### CHECK 11-B — Schema Grants

```sql
SELECT grantee, privilege_type
FROM information_schema.role_usage_grants
WHERE object_schema = 'erp_inventory'
  AND grantee = 'service_role';
```

**Expected:** At least 1 row with `grantee = service_role`, `privilege_type = USAGE`
**Fail means:** GRANT USAGE ON SCHEMA erp_inventory TO service_role was not executed.

---

### CHECK 11-C — All Expected Tables Exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'erp_inventory'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

**Expected — exactly these 10 tables (order doesn't matter):**
```
location_transfer_rule
movement_type_master
number_series_counter
number_series_master
stock_document
stock_ledger
stock_snapshot
stock_type_master
storage_location_master
storage_location_plant_map
```

**Fail means:** One or more tables missing. Note which ones.

---

### CHECK 11-D — Movement Type Count + P-Prefix Validation

```sql
-- Total count
SELECT COUNT(*) AS total_movement_types
FROM erp_inventory.movement_type_master;

-- Any non-P-prefix codes?
SELECT code
FROM erp_inventory.movement_type_master
WHERE code NOT LIKE 'P%'
ORDER BY code;
```

**Expected:**
- Total = 46 rows (count of all seeded movement types from Migration 11.4)
- Second query = 0 rows (all codes must start with P)

**Fail means:** Seed data missing or incorrect codes inserted.

> **Reference count breakdown:** GRN/Procurement: 8, Stock Type Transfers: 8, Location Transfers: 2, Plant Transfer: 4, Production: 2, Dispatch: 2, Customer Returns: 8, Physical Inventory: 4, Scrap: 6, FOR_REPROCESS: 6 = 50 total... **recount from spec:**
>
> Check exact count against Migration 11.4 INSERT list. Count every VALUES row. If count differs, run:
> ```sql
> SELECT code, name FROM erp_inventory.movement_type_master ORDER BY code;
> ```
> and compare line by line against the spec.

---

### CHECK 11-E — Critical Movement Types Present

```sql
SELECT code, name, direction, role_restricted, is_custom
FROM erp_inventory.movement_type_master
WHERE code IN (
  'P101','P102','P261','P262','P321','P322',
  'P343','P561','P562','P701','P702',
  'P901','P902','P903','P904','P905','P906'
)
ORDER BY code;
```

**Expected:** All 17 codes present with correct attributes:
- `P901`–`P906`: `role_restricted = true`, `is_custom = true`
- `P343`: `role_restricted = true`
- `P561`, `P562`: `approval_required = true`
- `P701`, `P702`: `approval_required = true`

---

### CHECK 11-F — Reversal Pairs Consistency

```sql
-- Every movement with reversal_of set must point to an existing code
SELECT m.code, m.reversal_of
FROM erp_inventory.movement_type_master m
WHERE m.reversal_of IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM erp_inventory.movement_type_master r WHERE r.code = m.reversal_of
  );
```

**Expected:** 0 rows
**Fail means:** A reversal_of reference points to a code that doesn't exist — FK violation (logical, not DB-enforced).

---

### CHECK 11-G — Stock Types Seeded (Exactly 5)

```sql
SELECT code, name, available_for_issue, available_for_dispatch,
       requires_approval_to_move, is_system_type, active
FROM erp_inventory.stock_type_master
ORDER BY code;
```

**Expected exactly 5 rows:**

| code | available_for_issue | available_for_dispatch | requires_approval_to_move | is_system_type | active |
|---|---|---|---|---|---|
| BLOCKED | false | false | true | true | true |
| FOR_REPROCESS | false | false | true | true | true |
| IN_TRANSIT | false | false | false | true | true |
| QUALITY_INSPECTION | false | false | false | true | true |
| UNRESTRICTED | true | true | false | true | true |

**Fail means:** Missing stock types or wrong flag values.

---

### CHECK 11-H — storage_location_master Table Structure

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'erp_inventory'
  AND table_name = 'storage_location_master'
ORDER BY ordinal_position;
```

**Expected columns (check all present):**
`id`, `code`, `name`, `location_type`, `is_transit_location`, `dispatch_allowed`, `qa_hold_flag`, `active`, `created_at`, `created_by`

**Fail means:** Column missing or wrong name.

---

### CHECK 11-I — storage_location_plant_map Partial Unique Index

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'erp_inventory'
  AND tablename = 'storage_location_plant_map'
  AND indexname = 'idx_slpm_one_default_grn';
```

**Expected:** 1 row. The `indexdef` must contain `WHERE ((is_default_grn_location = true) AND (active = true))`
**Fail means:** The partial unique index for "one default GRN location per plant" is missing.

---

### CHECK 11-J — number_series_master UNIQUE Constraint

```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'erp_inventory'
  AND table_name = 'number_series_master'
  AND constraint_type = 'UNIQUE';
```

**Expected:** At least 1 UNIQUE constraint (on company_id, section_id, document_type)

---

### CHECK 11-K — generate_doc_number() Function Exists

```sql
SELECT routine_name, routine_schema, security_type
FROM information_schema.routines
WHERE routine_schema = 'erp_inventory'
  AND routine_name = 'generate_doc_number';
```

**Expected:** 1 row, `security_type = DEFINER`
**Fail means:** Function not created or wrong schema.

---

### CHECK 11-L — stock_ledger Append-Only Rules

```sql
-- Check that both NO UPDATE and NO DELETE rules exist
SELECT rulename, ev_type, is_instead
FROM pg_rules
WHERE schemaname = 'erp_inventory'
  AND tablename = 'stock_ledger'
ORDER BY rulename;
```

**Expected — exactly 2 rows:**
- `stock_ledger_no_delete` — `ev_type = D` (DELETE), `is_instead = true`
- `stock_ledger_no_update` — `ev_type = U` (UPDATE), `is_instead = true`

**Fail means:** Append-only enforcement is missing. This is a critical data integrity failure. Gate-11 cannot be VERIFIED until this passes.

---

### CHECK 11-M — stock_ledger Has bigserial Column

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'erp_inventory'
  AND table_name = 'stock_ledger'
  AND column_name = 'ledger_seq';
```

**Expected:** `data_type = bigint`
**Fail means:** ledger_seq missing or wrong type. Cannot sort ledger entries correctly.

---

### CHECK 11-N — stock_snapshot UNIQUE Constraint

```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'erp_inventory'
  AND table_name = 'stock_snapshot'
  AND constraint_type = 'UNIQUE';
```

**Expected:** 1 UNIQUE constraint. Then verify columns:
```sql
SELECT indexdef
FROM pg_indexes
WHERE schemaname = 'erp_inventory'
  AND tablename = 'stock_snapshot'
  AND indexname LIKE '%unique%' OR indexname LIKE '%stock_snapshot%';
```

The index definition must include `COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid)` — this handles NULL batch_id in the uniqueness check.

**Fail means:** Without this COALESCE, two rows with batch_id = NULL would violate the intent (NULL ≠ NULL in SQL).

---

### CHECK 11-O — All Required Indexes Exist

```sql
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'erp_inventory'
ORDER BY tablename, indexname;
```

**Minimum expected indexes:**

| Table | Index Name |
|---|---|
| stock_document | idx_sd_company_plant |
| stock_document | idx_sd_material |
| stock_document | idx_sd_movement_type |
| stock_document | idx_sd_posting_date |
| stock_document | idx_sd_ref_doc |
| stock_document | idx_sd_status |
| stock_ledger | idx_sl_batch |
| stock_ledger | idx_sl_company_plant_material |
| stock_ledger | idx_sl_location_stock_type |
| stock_ledger | idx_sl_posting_date |
| stock_ledger | idx_sl_seq |
| stock_ledger | idx_sl_stock_document |
| stock_snapshot | idx_ss_company_plant_material |
| stock_snapshot | idx_ss_location_type |
| stock_snapshot | idx_ss_material_all_plants |
| storage_location_plant_map | idx_slpm_one_default_grn |
| vendor_payment_terms_log | idx_vptl_vendor_company_latest |

**Fail means:** Missing indexes will not block business logic but will cause slow queries. Log the specific missing indexes in the Failure Register.

---

### CHECK 11-P — Migration File Headers Spot Check

Open 3 migration files at random in `supabase/migrations/`. Each must contain:

```
-- File-ID: <something>
-- File-Path: supabase/migrations/<filename>.sql
-- Gate: 11
-- Phase: 11
-- Domain: INVENTORY
-- Purpose: <single sentence>
-- Authority: Backend
```

**Fail means:** Header missing or wrong Gate/Domain values.

---

### CHECK 11-Q — Migration File Naming Convention

All Gate-11 files must match: `20260509{HHMMSS}_gate11_{id}_{description}.sql`

```powershell
# Run in the supabase/migrations directory
Get-ChildItem -Filter "*gate11*" | Select-Object Name | Sort-Object Name
```

**Expected:** 13 files, all starting with `20260509`, containing `gate11` in name.

---

### GATE-11 VERIFICATION SUMMARY

After running all checks above:

| Check | Description | Result |
|---|---|---|
| 11-A | Schema exists | |
| 11-B | Schema grants correct | |
| 11-C | All 10 tables present | |
| 11-D | Movement type count + P-prefix | |
| 11-E | Critical movement types correct | |
| 11-F | Reversal pairs consistent | |
| 11-G | 5 stock types seeded correctly | |
| 11-H | storage_location_master structure | |
| 11-I | Partial unique index for GRN location | |
| 11-J | number_series_master unique constraint | |
| 11-K | generate_doc_number() function (SECURITY DEFINER) | |
| 11-L | stock_ledger append-only rules | |
| 11-M | stock_ledger bigserial column | |
| 11-N | stock_snapshot COALESCE unique constraint | |
| 11-O | All indexes present | |
| 11-P | Migration file headers correct | |
| 11-Q | Migration file naming correct | |

**If all PASS → Update OM-IMPLEMENTATION-LOG.md:**
- Item 11.15 → VERIFIED
- Gate-11 Completed date = today
- Verification Log: add row with date, gate=11, result=VERIFIED
- Gate-12 can now begin

**If any FAIL → Update OM-IMPLEMENTATION-LOG.md:**
- Item 11.15 → FAILED
- Failure Register: add each failed check with reason
- Codex must fix before Gate-12 starts

---
---

## GATE-12 VERIFICATION — erp_master Extensions

**Prerequisite:** Gate-11 must be VERIFIED before running Gate-12 checks.

---

### CHECK 12-A — All Expected New Tables in erp_master

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'erp_master'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

**Gate-12 must have added these new tables (check they appear in the result):**
```
customer_code_sequence
customer_company_map
customer_master
material_category_group
material_category_group_member
material_code_sequence
material_company_ext
material_master
material_plant_ext
material_uom_conversion
uom_master
vendor_code_sequence
vendor_company_map
vendor_material_info
vendor_master
vendor_payment_terms_log
```

**Must NOT have modified or dropped:** `companies`, `projects`, `departments` (pre-existing Gate-6 tables)

**Fail means:** Tables missing or pre-existing tables altered.

---

### CHECK 12-B — uom_master Seeded Correctly

```sql
SELECT code, name, uom_type, active
FROM erp_master.uom_master
ORDER BY uom_type, code;
```

**Expected: 14 rows**

| code | name | uom_type |
|---|---|---|
| KG | Kilogram | WEIGHT |
| G | Gram | WEIGHT |
| MT | Metric Tonne | WEIGHT |
| L | Litre | VOLUME |
| ML | Millilitre | VOLUME |
| NOS | Numbers/Pieces | COUNT |
| SET | Set | COUNT |
| MTR | Metre | LENGTH |
| BAG | Bag | PACKING |
| BOX | Box | PACKING |
| CAN | Can | PACKING |
| CTN | Carton | PACKING |
| DRM | Drum | PACKING |
| PKT | Packet | PACKING |

All rows: `active = true`

---

### CHECK 12-C — vendor_master Has NO payment_terms Column

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'erp_master'
  AND table_name = 'vendor_master'
  AND column_name ILIKE '%payment%';
```

**Expected: 0 rows**
**Fail means:** Codex added a static payment_terms column despite the explicit instruction not to. This is a design violation — vendor payment terms must live only in `vendor_payment_terms_log`.

---

### CHECK 12-D — vendor_master Required Columns Present

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'erp_master'
  AND table_name = 'vendor_master'
ORDER BY ordinal_position;
```

**Must contain (minimum):**
`id`, `vendor_code`, `vendor_name`, `vendor_type`, `bin_number`, `tin_number`, `gst_number`, `gst_category`, `iec_code`, `import_license`, `registered_address`, `correspondence_address`, `primary_contact_person`, `phone`, `primary_email`, `cc_email_list`, `bank_name`, `bank_branch`, `bank_account_number`, `bank_routing_number`, `currency_code`, `status`, `created_at`, `created_by`, `approved_by`, `approved_at`, `last_updated_at`, `last_updated_by`

**Critical checks:**
- `vendor_type` CHECK constraint: `IN ('DOMESTIC', 'IMPORT')` — verify:
```sql
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'erp_master'
  AND check_clause LIKE '%DOMESTIC%'
  AND check_clause LIKE '%IMPORT%';
```

- `cc_email_list` must be `text[]` type:
```sql
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'erp_master'
  AND table_name = 'vendor_master'
  AND column_name = 'cc_email_list';
```
Expected: `data_type = ARRAY`, `udt_name = _text`

---

### CHECK 12-E — vendor_material_info UNIQUE Constraint

```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'erp_master'
  AND table_name = 'vendor_material_info'
  AND constraint_type = 'UNIQUE';
```

**Then verify which columns:**
```sql
SELECT kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'erp_master'
  AND tc.table_name = 'vendor_material_info'
  AND tc.constraint_type = 'UNIQUE'
ORDER BY kcu.ordinal_position;
```

**Expected columns:** `vendor_id`, `material_id`
**Fail means:** UNIQUE constraint missing — duplicate vendor+material records become possible, which violates the Approved Source List design.

---

### CHECK 12-F — vendor_material_info status CHECK Constraint

```sql
SELECT check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_column_usage ccu
  ON cc.constraint_name = ccu.constraint_name
WHERE ccu.table_schema = 'erp_master'
  AND ccu.table_name = 'vendor_material_info'
  AND ccu.column_name = 'status';
```

**Expected:** `check_clause` contains `ACTIVE` and `INACTIVE`
**Fail means:** Status constraint missing — invalid status values can be inserted.

---

### CHECK 12-G — material_master Required Fields

```sql
-- Check FG-specific columns exist
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'erp_master'
  AND table_name = 'material_master'
  AND column_name IN ('shade_code', 'pack_code', 'external_sku',
                      'batch_tracking_required', 'fifo_tracking_enabled',
                      'expiry_tracking_enabled', 'shelf_life_days',
                      'qa_required_on_inward', 'qa_required_on_fg',
                      'valuation_method', 'production_mode', 'bom_exists',
                      'delivery_tolerance_enabled');
```

**Expected: 13 rows** (all listed columns present)

```sql
-- Check valuation_method constraint
SELECT check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_column_usage ccu
  ON cc.constraint_name = ccu.constraint_name
WHERE ccu.table_schema = 'erp_master'
  AND ccu.table_name = 'material_master'
  AND ccu.column_name = 'valuation_method';
```
**Expected:** Contains `WEIGHTED_AVERAGE` and `DIRECT_BATCH_COST`

---

### CHECK 12-H — material_master status Lifecycle Constraint

```sql
SELECT check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_column_usage ccu
  ON cc.constraint_name = ccu.constraint_name
WHERE ccu.table_schema = 'erp_master'
  AND ccu.table_name = 'material_master'
  AND ccu.column_name = 'status';
```

**Expected:** Contains all 5 values: `DRAFT`, `PENDING_APPROVAL`, `ACTIVE`, `INACTIVE`, `BLOCKED`

---

### CHECK 12-I — material_plant_ext Has No Cross-Schema FK

```sql
-- Confirm default_storage_location_id has NO foreign key
SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
       ccu.table_schema AS referenced_schema, ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_schema = 'erp_master'
  AND tc.table_name = 'material_plant_ext'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'default_storage_location_id';
```

**Expected: 0 rows**
**Fail means:** A cross-schema FK was added. This creates dependency between erp_master and erp_inventory migrations that can cause deployment order issues. Remove the FK and use UUID reference only.

---

### CHECK 12-J — PACE Code Sequence Tables Seeded

```sql
-- Material sequences: must have 6 rows
SELECT material_type, prefix, padding, last_number
FROM erp_master.material_code_sequence
ORDER BY material_type;
```

**Expected 6 rows:**
| material_type | prefix | padding | last_number |
|---|---|---|---|
| CONS | CONS- | 5 | 0 |
| FG | FG- | 5 | 0 |
| INT | INT- | 5 | 0 |
| PM | PM- | 5 | 0 |
| RM | RM- | 5 | 0 |
| TRA | TRA- | 5 | 0 |

```sql
-- Vendor sequence: must have 1 row (singleton)
SELECT id, last_number FROM erp_master.vendor_code_sequence;
```
**Expected:** 1 row, `id = 1`, `last_number = 0`

```sql
-- Customer sequence: must have 1 row (singleton)
SELECT id, last_number FROM erp_master.customer_code_sequence;
```
**Expected:** 1 row, `id = 1`, `last_number = 0`

---

### CHECK 12-K — PACE Code Generator Functions Exist + Are SECURITY DEFINER

```sql
SELECT routine_name, routine_schema, security_type
FROM information_schema.routines
WHERE routine_schema = 'erp_master'
  AND routine_name IN (
    'generate_material_pace_code',
    'generate_vendor_code',
    'generate_customer_code'
  )
ORDER BY routine_name;
```

**Expected: 3 rows, all `security_type = DEFINER`**
**Fail means:** Functions missing or wrong security context — calling user's permissions would be used instead of owner's.

---

### CHECK 12-L — Function Output Format Test

```sql
-- Test material code generation (this WILL increment the counter)
-- Only run this test if you are OK with last_number going from 0 to 1
-- Reset after test: UPDATE erp_master.material_code_sequence SET last_number = 0 WHERE material_type = 'RM';
SELECT erp_master.generate_material_pace_code('RM');
```
**Expected output:** `RM-00001`

```sql
SELECT erp_master.generate_vendor_code();
```
**Expected output:** `V-00001`

```sql
SELECT erp_master.generate_customer_code();
```
**Expected output:** `C-00001`

**After test — reset counters:**
```sql
UPDATE erp_master.material_code_sequence SET last_number = 0 WHERE material_type = 'RM';
UPDATE erp_master.vendor_code_sequence SET last_number = 0;
UPDATE erp_master.customer_code_sequence SET last_number = 0;
```

---

### CHECK 12-M — material_category_group One-Primary-Per-Group Index

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'erp_master'
  AND tablename = 'material_category_group_member'
  AND indexname = 'idx_mcgm_one_primary';
```

**Expected:** 1 row. The `indexdef` must contain `WHERE ((is_primary = true) AND (active = true))`
**Fail means:** Multiple materials can be set as primary in the same group.

---

### CHECK 12-N — vendor_payment_terms_log Index for Latest Terms

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'erp_master'
  AND tablename = 'vendor_payment_terms_log'
  AND indexname = 'idx_vptl_vendor_company_latest';
```

**Expected:** 1 row. The `indexdef` must include `recorded_at DESC`
**Fail means:** Fetching "latest payment terms" requires a full table scan — will be slow.

---

### CHECK 12-O — Constitution: No Public Schema Tables

```sql
-- None of the new tables should be in public schema
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'uom_master', 'material_master', 'material_uom_conversion',
    'material_company_ext', 'material_plant_ext',
    'material_category_group', 'material_category_group_member',
    'vendor_master', 'vendor_company_map', 'vendor_payment_terms_log',
    'vendor_material_info', 'customer_master', 'customer_company_map',
    'material_code_sequence', 'vendor_code_sequence', 'customer_code_sequence'
  );
```

**Expected: 0 rows**
**Fail means:** One or more tables landed in public schema — critical mistake.

---

### CHECK 12-P — Migration File Headers Spot Check

Open 3 Gate-12 migration files at random. Each must contain:

```
-- File-ID: <something>
-- File-Path: supabase/migrations/<filename>.sql
-- Gate: 12
-- Phase: 12
-- Domain: MASTER
-- Purpose: <single sentence>
-- Authority: Backend
```

**Fail means:** Wrong Gate, Phase, or Domain in header.

---

### CHECK 12-Q — Pre-Existing erp_master Tables Untouched

```sql
-- Confirm these tables were not altered (column counts should be same as Gate-6 left them)
SELECT table_name, COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'erp_master'
  AND table_name IN ('companies', 'projects', 'departments')
GROUP BY table_name
ORDER BY table_name;
```

Cross-reference against Gate-6 spec to confirm column counts are unchanged.
**Fail means:** Codex modified a pre-existing table it was instructed not to touch.

---

### GATE-12 VERIFICATION SUMMARY

| Check | Description | Result |
|---|---|---|
| 12-A | All 16 new tables in erp_master | |
| 12-B | uom_master seeded (14 rows, all correct) | |
| 12-C | vendor_master has NO payment_terms column | |
| 12-D | vendor_master cc_email_list is text[] | |
| 12-E | vendor_material_info UNIQUE(vendor_id, material_id) | |
| 12-F | vendor_material_info status CHECK (ACTIVE/INACTIVE) | |
| 12-G | material_master FG-specific columns present | |
| 12-H | material_master status CHECK (5 values) | |
| 12-I | material_plant_ext has NO cross-schema FK | |
| 12-J | material_code_sequence seeded (6 rows) | |
| 12-K | All 3 generator functions exist (SECURITY DEFINER) | |
| 12-L | Function output format correct (RM-00001, V-00001, C-00001) | |
| 12-M | material_category_group_member one-primary index | |
| 12-N | vendor_payment_terms_log latest-terms index | |
| 12-O | No tables in public schema | |
| 12-P | Migration file headers correct (Gate: 12, Domain: MASTER) | |
| 12-Q | Pre-existing erp_master tables untouched | |

**If all PASS → Update OM-IMPLEMENTATION-LOG.md:**
- Item 12.14 → VERIFIED
- Gate-12 Completed date = today
- Verification Log: add row with date, gate=12, result=VERIFIED
- L1 Foundation complete — Gate-13 (Procurement Cycle) can begin design

**If any FAIL → Update OM-IMPLEMENTATION-LOG.md:**
- Item 12.14 → FAILED
- Failure Register: add each failed check with reason
- Gate-13 spec must NOT be given to Codex until Gate-12 is VERIFIED

---

## Post-Verification: Log Template

After completing Gate-11 verification, add this row to the Verification Log in `OM-IMPLEMENTATION-LOG.md`:

```
| 2026-05-XX | 11 | 11.15 | VERIFIED | Claude | All 17 checks passed. erp_inventory schema correct. |
```

After completing Gate-12 verification:
```
| 2026-05-XX | 12 | 12.14 | VERIFIED | Claude | All 17 checks passed. erp_master extensions correct. No payment_terms column on vendor_master. |
```

If FAILED, add to Failure Register:
```
| 2026-05-XX | 11 | 11-L | stock_ledger append-only rules missing | — |
```

---

## Business Rule Smoke Test (Run After Both Gates Pass)

These are manual tests — run only if both Gate-11 and Gate-12 are VERIFIED. They test that the data structures support the business rules correctly.

### Smoke Test 1 — UOM FK Chain Works

```sql
-- Insert a test material and verify UOM FK
-- (Use only test/dev environment — never run on production)
INSERT INTO erp_master.material_master (
  pace_code, material_name, short_name, material_type,
  base_uom_code, purchase_uom_code, issue_uom_code,
  created_by
) VALUES (
  'RM-TEST-01', 'Test Material', 'TEST', 'RM',
  'KG', 'BAG', 'KG',
  '00000000-0000-0000-0000-000000000001'
);
```
**Expected:** Succeeds (KG and BAG exist in uom_master)

```sql
-- Clean up
DELETE FROM erp_master.material_master WHERE pace_code = 'RM-TEST-01';
```

---

### Smoke Test 2 — Vendor Without Approved Source Cannot Link Material

This is an APPLICATION-LEVEL check (not DB enforced). Document it here for handler-phase reference:

> When Gate-13 PO handler is built, the handler must query:
> ```sql
> SELECT status FROM erp_master.vendor_material_info
> WHERE vendor_id = $vendor_id AND material_id = $material_id;
> ```
> If result is not `ACTIVE` (or no row), reject PO line with error: `VENDOR_NOT_APPROVED_FOR_MATERIAL`

---

### Smoke Test 3 — stock_ledger Append-Only Works

```sql
-- First insert a test ledger row (will fail if stock_document doesn't exist yet,
-- so this is just verifying the RULE blocks UPDATE/DELETE)

-- Try to delete from stock_ledger -- should silently do nothing (INSTEAD NOTHING rule)
-- This cannot be tested until Gate-13 posts the first real ledger entry.
-- Document this for Gate-13 verification.
```

Note: Full ledger append-only test runs in Gate-13 verification after first real posting.

---

*Checklist version: 1.0*
*Created: 2026-05-09*
*Reference specs: OM-GATE-11-Foundation-DB-Spec.md, OM-GATE-12-MasterData-Spec.md*
*Next update: After Gate-11 + Gate-12 first verification run — add any missed checks found during actual verification*
