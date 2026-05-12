# CODEX TASK BRIEF — Gate-13.9 Sales / Dispatch (RM/PM Outward) DB

**Gate:** 13.9
**Spec File:** OM-GATE-13.9-SalesDispatch-DB-Spec.md (read this first — full column-level spec)
**Schema:** erp_procurement
**Dependency:** Gate-13.8 VERIFIED ✅

---

## What You Are Building

3 migration files. DB only. No handlers, no frontend.

**4 new tables:**
1. `erp_procurement.sales_order`
2. `erp_procurement.sales_order_line`
3. `erp_procurement.sales_invoice`
4. `erp_procurement.sales_invoice_line`

**Scope — READ CAREFULLY:**
- RM/PM outward sale to external customers ONLY
- FG (Finished Goods) dispatch is OUT OF SCOPE — separate Logistics module, not part of Phase-1
- `delivery_challan` + `gate_exit_outbound` already exist (Gate-13.7) — do NOT recreate them

---

## Files to Create

| File-ID | Filename | Content |
|---|---|---|
| 13.9.1 | `20260511090000_gate13_9_13_9_1_create_sales_order.sql` | sales_order + sales_order_line |
| 13.9.2 | `20260511091000_gate13_9_13_9_2_create_sales_invoice.sql` | sales_invoice + sales_invoice_line |
| 13.9.3 | `20260511092000_gate13_9_13_9_3_create_indexes.sql` | Indexes + GRANT on all 4 tables |

All files go in: `supabase/migrations/`

---

## Critical Rules — Do Not Deviate

### 1. Cross-Schema FK Rule
These columns must be plain `uuid` with NO `REFERENCES` clause:

| Column | Logical target |
|---|---|
| company_id | erp_master.companies |
| customer_id | erp_master.customer_master |
| payment_term_id | erp_master.payment_terms_master |
| material_id | erp_master.material_master |
| issue_storage_location_id | erp_inventory.storage_location_master |
| stock_document_id | erp_inventory.stock_document |
| stock_ledger_id | erp_inventory.stock_ledger |

### 2. Intra-Schema FKs Are Allowed
Tables inside erp_procurement can use `REFERENCES erp_procurement.xxx`. These are correct:
- `sales_order_line.so_id` → `sales_order(id)`
- `sales_invoice.dc_id` → `delivery_challan(id)` (already exists from Gate-13.7)
- `sales_invoice.so_id` → `sales_order(id)`
- `sales_invoice_line.invoice_id` → `sales_invoice(id)`
- `sales_invoice_line.so_line_id` → `sales_order_line(id)` (nullable)
- `sales_invoice_line.dc_line_id` → `delivery_challan_line(id)` (nullable)

### 3. Number Series
- SO number: `generate_doc_number('SO')` — 'SO' already seeded in Gate-13.2.1
- Sales invoice number: `generate_invoice_number()` — YYYYMM + incremental — already exists from Gate-13.2.1
- Do NOT add new seed rows or recreate functions

### 4. File Header (mandatory on every file)
```sql
/*
 * File-ID: 13.9.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_9_13_9_X_description.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: One sentence.
 * Authority: Backend
 */
```

### 5. Every file: `BEGIN;` … `COMMIT;`

---

## Table Specifications

### `sales_order`
```
id                    uuid PK DEFAULT gen_random_uuid()
so_number             text NOT NULL UNIQUE
so_date               date NOT NULL
system_created_at     timestamptz NOT NULL DEFAULT now()
company_id            uuid NOT NULL          -- plain uuid, NO FK
customer_id           uuid NOT NULL          -- plain uuid, NO FK
customer_po_number    text NOT NULL
customer_po_date      date NULL
delivery_address      text NULL
payment_term_id       uuid NULL              -- plain uuid, NO FK
status                text NOT NULL DEFAULT 'CREATED'
                        CHECK (status IN ('CREATED','ISSUED','INVOICED','CLOSED','CANCELLED'))
cancellation_reason   text NULL
cancelled_at          timestamptz NULL
cancelled_by          uuid NULL
remarks               text NULL
created_by            uuid NOT NULL
created_at            timestamptz NOT NULL DEFAULT now()
last_updated_at       timestamptz NULL
last_updated_by       uuid NULL
```

### `sales_order_line`
```
id                          uuid PK DEFAULT gen_random_uuid()
so_id                       uuid NOT NULL REFERENCES erp_procurement.sales_order(id) ON DELETE RESTRICT
line_number                 int NOT NULL
material_id                 uuid NOT NULL          -- plain uuid, NO FK (RM/PM only — handler enforces)
issue_storage_location_id   uuid NULL              -- plain uuid, NO FK
quantity                    numeric(20,6) NOT NULL CHECK (quantity > 0)
uom_code                    text NOT NULL
rate                        numeric(20,4) NOT NULL CHECK (rate > 0)
discount_pct                numeric(6,3) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100)
net_rate                    numeric(20,4) NOT NULL CHECK (net_rate > 0)
gst_rate                    numeric(6,2) NULL CHECK (gst_rate >= 0)
gst_amount                  numeric(20,4) NULL CHECK (gst_amount >= 0)
total_value                 numeric(20,4) NULL CHECK (total_value >= 0)
issued_qty                  numeric(20,6) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0)
balance_qty                 numeric(20,6) NOT NULL
line_status                 text NOT NULL DEFAULT 'OPEN'
                              CHECK (line_status IN ('OPEN','PARTIALLY_ISSUED','FULLY_ISSUED','KNOCKED_OFF','CANCELLED'))
knock_off_reason            text NULL
knocked_off_by              uuid NULL
knocked_off_at              timestamptz NULL
stock_document_id           uuid NULL              -- plain uuid, NO FK
stock_ledger_id             uuid NULL              -- plain uuid, NO FK
created_at                  timestamptz NOT NULL DEFAULT now()
last_updated_at             timestamptz NULL
UNIQUE (so_id, line_number)
```

### `sales_invoice`
```
id                      uuid PK DEFAULT gen_random_uuid()
invoice_number          text NOT NULL UNIQUE
invoice_date            date NOT NULL
system_created_at       timestamptz NOT NULL DEFAULT now()
company_id              uuid NOT NULL          -- plain uuid, NO FK
customer_id             uuid NOT NULL          -- plain uuid, NO FK
dc_id                   uuid NOT NULL REFERENCES erp_procurement.delivery_challan(id) ON DELETE RESTRICT
so_id                   uuid NULL REFERENCES erp_procurement.sales_order(id) ON DELETE RESTRICT
payment_term_id         uuid NULL              -- plain uuid, NO FK
gst_type                text NOT NULL CHECK (gst_type IN ('CGST_SGST','IGST'))   -- NO 'NONE'
total_taxable_value     numeric(20,4) NULL CHECK (total_taxable_value >= 0)
total_cgst_amount       numeric(20,4) NULL CHECK (total_cgst_amount >= 0)
total_sgst_amount       numeric(20,4) NULL CHECK (total_sgst_amount >= 0)
total_igst_amount       numeric(20,4) NULL CHECK (total_igst_amount >= 0)
total_gst_amount        numeric(20,4) NULL CHECK (total_gst_amount >= 0)
total_invoice_value     numeric(20,4) NULL CHECK (total_invoice_value >= 0)
status                  text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED'))
posted_by               uuid NULL
posted_at               timestamptz NULL
remarks                 text NULL
created_by              uuid NOT NULL
created_at              timestamptz NOT NULL DEFAULT now()
last_updated_at         timestamptz NULL
```

### `sales_invoice_line`
```
id              uuid PK DEFAULT gen_random_uuid()
invoice_id      uuid NOT NULL REFERENCES erp_procurement.sales_invoice(id) ON DELETE RESTRICT
line_number     int NOT NULL
so_line_id      uuid NULL REFERENCES erp_procurement.sales_order_line(id) ON DELETE RESTRICT
dc_line_id      uuid NULL REFERENCES erp_procurement.delivery_challan_line(id) ON DELETE RESTRICT
material_id     uuid NOT NULL          -- plain uuid, NO FK
quantity        numeric(20,6) NOT NULL CHECK (quantity > 0)
uom_code        text NOT NULL
rate            numeric(20,4) NOT NULL CHECK (rate > 0)
taxable_value   numeric(20,4) NOT NULL CHECK (taxable_value >= 0)
gst_rate        numeric(6,2) NULL CHECK (gst_rate >= 0)
cgst_amount     numeric(20,4) NULL CHECK (cgst_amount >= 0)
sgst_amount     numeric(20,4) NULL CHECK (sgst_amount >= 0)
igst_amount     numeric(20,4) NULL CHECK (igst_amount >= 0)
line_total      numeric(20,4) NOT NULL CHECK (line_total >= 0)
created_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (invoice_id, line_number)
```

---

## Migration 13.9.3 — Indexes + Grants

```sql
-- Sales Order indexes
CREATE INDEX IF NOT EXISTS idx_so_number      ON erp_procurement.sales_order (so_number);
CREATE INDEX IF NOT EXISTS idx_so_company     ON erp_procurement.sales_order (company_id);
CREATE INDEX IF NOT EXISTS idx_so_customer    ON erp_procurement.sales_order (customer_id);
CREATE INDEX IF NOT EXISTS idx_so_status      ON erp_procurement.sales_order (status);
CREATE INDEX IF NOT EXISTS idx_so_date        ON erp_procurement.sales_order (so_date);

CREATE INDEX IF NOT EXISTS idx_sol_so         ON erp_procurement.sales_order_line (so_id);
CREATE INDEX IF NOT EXISTS idx_sol_material   ON erp_procurement.sales_order_line (material_id);
CREATE INDEX IF NOT EXISTS idx_sol_status     ON erp_procurement.sales_order_line (line_status);

-- Open lines dashboard partial index
CREATE INDEX IF NOT EXISTS idx_sol_open
  ON erp_procurement.sales_order_line (so_id, line_status)
  WHERE line_status = 'OPEN';

-- Sales Invoice indexes
CREATE INDEX IF NOT EXISTS idx_si_number      ON erp_procurement.sales_invoice (invoice_number);
CREATE INDEX IF NOT EXISTS idx_si_company     ON erp_procurement.sales_invoice (company_id);
CREATE INDEX IF NOT EXISTS idx_si_customer    ON erp_procurement.sales_invoice (customer_id);
CREATE INDEX IF NOT EXISTS idx_si_dc          ON erp_procurement.sales_invoice (dc_id);
CREATE INDEX IF NOT EXISTS idx_si_so          ON erp_procurement.sales_invoice (so_id) WHERE so_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_si_status      ON erp_procurement.sales_invoice (status);
CREATE INDEX IF NOT EXISTS idx_si_date        ON erp_procurement.sales_invoice (invoice_date);

CREATE INDEX IF NOT EXISTS idx_sil_invoice    ON erp_procurement.sales_invoice_line (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sil_so_line    ON erp_procurement.sales_invoice_line (so_line_id) WHERE so_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sil_dc_line    ON erp_procurement.sales_invoice_line (dc_line_id) WHERE dc_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sil_material   ON erp_procurement.sales_invoice_line (material_id);

-- Grants
GRANT SELECT ON erp_procurement.sales_order          TO authenticated;
GRANT SELECT ON erp_procurement.sales_order_line     TO authenticated;
GRANT SELECT ON erp_procurement.sales_invoice        TO authenticated;
GRANT SELECT ON erp_procurement.sales_invoice_line   TO authenticated;

GRANT ALL    ON erp_procurement.sales_order          TO service_role;
GRANT ALL    ON erp_procurement.sales_order_line     TO service_role;
GRANT ALL    ON erp_procurement.sales_invoice        TO service_role;
GRANT ALL    ON erp_procurement.sales_invoice_line   TO service_role;
```

---

## After Implementation — Update Log

In `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`, update the Gate-13.9 section:
- 13.9.1: PENDING → DONE, add filename
- 13.9.2: PENDING → DONE, add filename
- 13.9.3: PENDING → DONE, add filename

Claude will verify and update 13.9.4.

---

## Verification Checklist (Claude will check these)

1. `sales_order.so_number` UNIQUE
2. `sales_order.status` CHECK exactly 5 values: CREATED/ISSUED/INVOICED/CLOSED/CANCELLED
3. `sales_order_line` UNIQUE(so_id, line_number)
4. `sales_order_line.discount_pct` CHECK (>= 0 AND <= 100)
5. `sales_order_line.balance_qty` column present (NOT NULL)
6. `sales_order_line.stock_document_id` + `stock_ledger_id` + `issue_storage_location_id` — plain uuid NULL (no REFERENCES)
7. `sales_invoice.invoice_number` UNIQUE
8. `sales_invoice.dc_id` REFERENCES `erp_procurement.delivery_challan(id)` NOT NULL
9. `sales_invoice.status` CHECK (DRAFT/POSTED)
10. `sales_invoice.gst_type` CHECK IN ('CGST_SGST','IGST') — exactly 2 values, NO 'NONE'
11. `sales_invoice_line` UNIQUE(invoice_id, line_number)
12. `sales_invoice_line.so_line_id` REFERENCES `erp_procurement.sales_order_line(id)` NULL
13. `sales_invoice_line.dc_line_id` REFERENCES `erp_procurement.delivery_challan_line(id)` NULL
14. `idx_sol_open` partial index WHERE line_status = 'OPEN'
15. GRANT SELECT authenticated + GRANT ALL service_role on all 4 tables

---

*Brief frozen: 2026-05-11*
