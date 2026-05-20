# CODEX TASK BRIEF — Gate-11: erp_inventory Foundation DB

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 11
**Your task:** Create 13 SQL migration files. Nothing else.

---

## Step 1 — Read These Files First (Do Not Skip)

Before writing a single line of code, read the following files **in this order**:

1. `docs/Operation Management/implementation-specs/OM-GATE-11-Foundation-DB-Spec.md`
   → This is your primary instruction. Every table, every column, every constraint, every seed row is defined here. Follow it exactly. Do not improvise.

2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → This is where you log your progress. You will update this file as you complete each item.

Read both files completely before starting. If anything is unclear in the spec, check this brief again. Do not guess.

---

## Step 2 — Understand What You Are Building

You are implementing **Gate-11** of PACE-ERP Operation Management.

**What Gate-11 is:**
The inventory foundation layer — a new PostgreSQL schema called `erp_inventory` containing the core tables for stock movements, storage locations, document numbering, the stock ledger, and the stock snapshot. No business logic. No handlers. No frontend. Data structures only.

**What Gate-11 is NOT:**
- Not Gate-12 (master data — that comes after Claude verifies Gate-11)
- Not handlers or Edge Functions
- Not any UI components
- Not changes to any existing schema

**Existing schemas you must NOT touch:**
`public`, `erp_core`, `erp_acl`, `erp_audit`, `erp_meta`, `erp_master`, `erp_hr`

**New schema you are creating:**
`erp_inventory` — this does not exist yet. You create it in the first migration.

---

## Step 3 — Migration Files: Location and Naming

**Where to create files:**
```
supabase/migrations/
```
This folder already exists. All your new files go here.

**Naming convention (follow exactly):**
```
20260509{HHMMSS}_gate11_{spec_id}_{short_description}.sql
```

The 13 files you must create, with their exact names from the spec:

| Spec Item | Filename |
|---|---|
| 11.1 | `20260509100000_gate11_11_1_create_erp_inventory_schema.sql` |
| 11.2 | `20260509101000_gate11_11_2_create_movement_type_master.sql` |
| 11.3 | `20260509102000_gate11_11_3_create_stock_type_master.sql` |
| 11.4 | `20260509103000_gate11_11_4_seed_movement_types.sql` |
| 11.5 | `20260509104000_gate11_11_5_seed_stock_types.sql` |
| 11.6 | `20260509105000_gate11_11_6_create_storage_location_master.sql` |
| 11.7 | `20260509106000_gate11_11_7_create_storage_location_plant_map.sql` |
| 11.8 | `20260509107000_gate11_11_8_create_location_transfer_rule.sql` |
| 11.9 | `20260509108000_gate11_11_9_create_number_series_master.sql` |
| 11.10 | `20260509109000_gate11_11_10_create_number_series_counter.sql` |
| 11.11 | `20260509110000_gate11_11_11_create_stock_document.sql` |
| 11.12 | `20260509111000_gate11_11_12_create_stock_ledger.sql` |
| 11.13 | `20260509112000_gate11_11_13_create_stock_snapshot.sql` |

---

## Step 4 — File Header Format

Every migration file must start with this header. Use `/* */` style (matches existing project conventions):

```sql
/*
 * File-ID: 11.X
 * File-Path: supabase/migrations/20260509HHMMSS_gate11_11_X_description.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: One sentence describing what this migration does.
 * Authority: Backend
 */
```

**Important:** The spec shows `--` style headers but existing project files use `/* */` style. Use `/* */`. Check any existing migration in `supabase/migrations/` to confirm the format.

---

## Step 5 — Critical Rules (Read Every Line)

These are not suggestions. If you violate any of these, Claude will mark the gate FAILED and you must redo the affected files.

### On the schema:
- `erp_inventory` schema MUST be created in migration 11.1 before any table migrations run
- GRANT pattern for service_role MUST be in migration 11.1:
  ```sql
  GRANT USAGE ON SCHEMA erp_inventory TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
    GRANT ALL ON TABLES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA erp_inventory
    GRANT ALL ON SEQUENCES TO service_role;
  ```
- Do NOT put any `erp_inventory` tables in the `public` schema

### On the stock_ledger (Migration 11.12):
- `ledger_seq` column MUST be `bigserial`, not `uuid`, not `serial`
- BOTH of these rules MUST be created in the same migration file:
  ```sql
  CREATE OR REPLACE RULE stock_ledger_no_update AS
    ON UPDATE TO erp_inventory.stock_ledger DO INSTEAD NOTHING;
  CREATE OR REPLACE RULE stock_ledger_no_delete AS
    ON DELETE TO erp_inventory.stock_ledger DO INSTEAD NOTHING;
  ```
- **Do NOT use triggers for this** — use RULE exactly as shown above
- **Do NOT add UPDATE or DELETE triggers** — the ledger is append-only by design

### On stock_snapshot (Migration 11.13):
- The UNIQUE constraint MUST use COALESCE on batch_id:
  ```sql
  UNIQUE (company_id, plant_id, storage_location_id, material_id, stock_type_code,
          COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  ```
- Do NOT write `UNIQUE (company_id, plant_id, storage_location_id, material_id, stock_type_code, batch_id)` — this will not work correctly when batch_id is NULL

### On the generate_doc_number() function (Migration 11.10):
- MUST be created in schema `erp_inventory` (not public)
- MUST be declared `SECURITY DEFINER`
- Copy the function body exactly from the spec — do not simplify or rewrite it

### On cross-schema references:
- `storage_location_plant_map.company_id` references `erp_master.companies` — but write it as a plain `uuid NOT NULL` column with NO foreign key constraint (cross-schema FK constraints are avoided in this project)
- `storage_location_plant_map.plant_id` — same: plain `uuid NOT NULL`, no FK
- `number_series_master.company_id` — same: plain `uuid NOT NULL`, no FK
- Only create FK constraints that stay within the `erp_inventory` schema

### On movement type seed data (Migration 11.4):
- Copy every row exactly from the spec — do not add, remove, or change any values
- P901–P906 must have `role_restricted = true` AND `is_custom = true`
- P343 must have `role_restricted = true`
- `reversal_of` values must exactly match existing codes in the same INSERT statement — Postgres will validate the self-referencing FK on insert

### On migration order:
- Do NOT change the order. The timestamps enforce order. Run exactly as listed in Step 3 above.
- 11.1 (schema) → 11.2 (movement_type_master) → 11.3 (stock_type_master) → 11.4 (seed movements) → 11.5 (seed stock types) → 11.6 → 11.7 → 11.8 → 11.9 → 11.10 → 11.11 → 11.12 → 11.13

### On what NOT to build:
- Do NOT create any Edge Functions (handlers) in this gate
- Do NOT create any TypeScript files
- Do NOT create any frontend files
- Do NOT create RLS policies for `erp_inventory` — service_role access only, same as erp_hr
- Do NOT use `db.from("table_name")` anywhere — if you write any TypeScript, always use `db.schema("erp_inventory").from("table_name")` (but again, no TypeScript in this gate)
- Do NOT modify any existing migration file

---

## Step 6 — Self-Check Before Marking Done

Before you update the log, run this mental checklist on your own work:

```
[ ] Migration 11.1 creates erp_inventory schema + 3 GRANT statements
[ ] Migration 11.2 creates movement_type_master with all columns from spec
[ ] Migration 11.3 creates stock_type_master with all columns from spec
[ ] Migration 11.4 seeds ALL movement types — every row from the spec INSERT block
[ ] Migration 11.5 seeds exactly 5 stock types with exact flag values
[ ] Migration 11.6 creates storage_location_master with location_type CHECK constraint
[ ] Migration 11.7 creates storage_location_plant_map with partial unique index for is_default_grn_location
[ ] Migration 11.8 creates location_transfer_rule with ONE_STEP/TWO_STEP CHECK
[ ] Migration 11.9 creates number_series_master with UNIQUE(company_id, section_id, document_type)
[ ] Migration 11.10 creates number_series_counter + generate_doc_number() function (SECURITY DEFINER)
[ ] Migration 11.11 creates stock_document with all columns and indexes
[ ] Migration 11.12 creates stock_ledger with bigserial + BOTH no_update and no_delete RULES
[ ] Migration 11.13 creates stock_snapshot with COALESCE unique constraint + all indexes
[ ] Every file has correct /* */ header with Gate: 11, Phase: 11, Domain: INVENTORY
[ ] No file touches erp_master, erp_hr, erp_core, erp_acl, or public schema
```

---

## Step 7 — How to Update the Log

File to update: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After completing **each migration file**, change the corresponding row from PENDING to DONE and add the filename:

```markdown
| 11.1 | Create erp_inventory schema + service role grant | DONE | supabase/migrations/20260509100000_gate11_11_1_create_erp_inventory_schema.sql | — | — |
```

After completing **all 13 files**, add this note at the bottom of the Gate-11 table:
```
Gate-11 implementation complete. All 13 migrations created. Awaiting Claude verification.
```

Also update the log header fields:
```markdown
**Started:** 2026-05-09
**Completed:** 2026-05-09
```

---

## Step 8 — Hard Stop: Do NOT Start Gate-12

Gate-12 (Master Data — erp_master extensions) requires Claude to verify Gate-11 first.

**After you finish Gate-11:**
- Update the log as described in Step 7
- Stop working
- Wait for Claude to verify and mark Gate-11 as VERIFIED

Gate-12 spec file exists at:
`docs/Operation Management/implementation-specs/OM-GATE-12-MasterData-Spec.md`

**Do not read or implement it yet.** You will be given a separate task brief for Gate-12 after Claude verifies Gate-11.

---

## Reference: Project Conventions (Read If Uncertain)

**Existing schemas:** erp_core, erp_acl, erp_audit, erp_meta, erp_master, erp_hr
→ None of these should appear in your migration files except as UUID references

**Example of an existing migration header** (look at `supabase/migrations/20260403041000_gate8_1_1_precreate_erp_hr_schema.sql` if you want to see the project style)

**UUIDs everywhere** — All primary keys are `uuid DEFAULT gen_random_uuid()` except `ledger_seq` which is `bigserial`

**Timestamps** — All timestamp columns use `timestamptz NOT NULL DEFAULT now()` (not `timestamp`, not `timestamp without time zone`)

**Transaction wrapping** — Every migration file wraps its entire content in `BEGIN; ... COMMIT;`

**IF NOT EXISTS** — Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout

---

*Task issued by Claude on 2026-05-09*
*Spec authority: OM-GATE-11-Foundation-DB-Spec.md (FROZEN)*
*Do not proceed to Gate-12 until Claude marks Gate-11 VERIFIED in OM-IMPLEMENTATION-LOG.md*
