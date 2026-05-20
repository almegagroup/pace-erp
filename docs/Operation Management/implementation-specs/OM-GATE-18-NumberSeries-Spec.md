# OM-GATE-18 — Number Series Overhaul

**Spec Status:** FINAL  
**Gate:** 18  
**Domain:** PROCUREMENT / SA CONFIG  
**Dependency:** Gate-17.9 VERIFIED ✅  
**Date:** 2026-05-12  

---

## Overview

Fix the number series system to match SAP discipline:

- **PO + STO** → Company + FY based. Prefix freely set by SA. Format: `{prefix}/{FY}/{padded_number}`. Resets every FY. SA sets starting number per FY.
- **All other documents** → Global numeric. No prefix. No FY. Single global counter per document type. SA sets starting number once.

---

## Current State (Problems to Fix)

| Problem | Detail |
|---|---|
| PO number broken | Handler calls `generate_doc_number('PO')` but 'PO' not in seed → runtime error |
| STO is global | STO in `document_number_series` → should be Company+FY |
| Sales Invoice YYYYMM format | `generate_invoice_number()` returns `202605000001` → should be simple global numeric |
| SA screen disconnected | `SAOmNumberSeries.jsx` reads `erp_inventory.number_series_master` but handlers use `erp_procurement` tables |
| No starting number config | SA cannot set starting number for global series |

---

## Gate-18.1 — DB Migrations

### Migration 18.1.1 — Fix `document_number_series`

**File:** `20260512100000_gate18_18_1_1_fix_document_number_series.sql`

```sql
BEGIN;

-- Add starting_number so SA can configure where each series begins
ALTER TABLE erp_procurement.document_number_series
  ADD COLUMN IF NOT EXISTS starting_number bigint NOT NULL DEFAULT 1;

-- Remove STO (moves to company+FY system)
DELETE FROM erp_procurement.document_number_series WHERE doc_type = 'STO';

-- Add SALES_INVOICE (replaces YYYYMM invoice_number_series)
INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('SALES_INVOICE', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

-- Update existing rows to have starting_number = 1 (default)
UPDATE erp_procurement.document_number_series
SET starting_number = 1
WHERE starting_number IS NULL;

COMMIT;
```

**Result:** Global series contains: CSN, GE, GEX, GXO, GRN, QA, DC, RTV, DN, EXR, IV, LC, SO, SALES_INVOICE. STO removed.

---

### Migration 18.1.2 — Company+FY Series Tables

**File:** `20260512100100_gate18_18_1_2_create_company_doc_number_series.sql`

```sql
BEGIN;

-- Series config per company + document type
-- SA creates one row per company per doc type
CREATE TABLE IF NOT EXISTS erp_procurement.company_doc_number_series (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  document_type    text NOT NULL,         -- 'PO' or 'STO'
  prefix           text NOT NULL,         -- SA types freely e.g. 'PO/CMP003'
  number_padding   int NOT NULL DEFAULT 5,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NULL,

  UNIQUE (company_id, document_type)
);

COMMENT ON TABLE erp_procurement.company_doc_number_series IS
'SA-configurable prefix per company+document_type. Used for PO and STO.';

-- Counter per company + document type + FY
-- SA creates one row per FY to set starting number
CREATE TABLE IF NOT EXISTS erp_procurement.company_doc_number_counter (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  document_type    text NOT NULL,
  financial_year   text NOT NULL,         -- e.g. '25-26'
  starting_number  bigint NOT NULL DEFAULT 1,   -- SA sets this
  last_number      bigint NOT NULL DEFAULT 0,   -- system increments
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NULL,

  UNIQUE (company_id, document_type, financial_year)
);

COMMENT ON TABLE erp_procurement.company_doc_number_counter IS
'Counter per company+doc_type+FY. SA sets starting_number. System increments last_number.';

GRANT ALL ON erp_procurement.company_doc_number_series TO service_role;
GRANT ALL ON erp_procurement.company_doc_number_counter TO service_role;

COMMIT;
```

---

### Migration 18.1.3 — Functions

**File:** `20260512100200_gate18_18_1_3_create_company_doc_number_functions.sql`

```sql
BEGIN;

-- ── generate_company_doc_number ────────────────────────────────────────
-- Called by PO and STO handlers.
-- Returns: {prefix}/{FY}/{padded_number}  e.g. PO/CMP003/25-26/00001
-- FY is calculated from current date (April start).
-- If no counter exists for current FY, creates one using starting_number from series config.
-- If no series config exists for company+doc_type → raises exception.
CREATE OR REPLACE FUNCTION erp_procurement.generate_company_doc_number(
  p_company_id  uuid,
  p_doc_type    text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_series  erp_procurement.company_doc_number_series%ROWTYPE;
  v_counter erp_procurement.company_doc_number_counter%ROWTYPE;
  v_fy      text;
  v_month   int;
  v_year    int;
  v_next    bigint;
  v_padded  text;
BEGIN
  -- 1. Find active series for this company+doc_type
  SELECT * INTO v_series
  FROM erp_procurement.company_doc_number_series
  WHERE company_id   = p_company_id
    AND document_type = p_doc_type
    AND active        = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_DOC_SERIES_NOT_FOUND: company=%, doc_type=%',
      p_company_id, p_doc_type;
  END IF;

  -- 2. Calculate current FY (April start)
  v_month := EXTRACT(MONTH FROM current_date);
  v_year  := EXTRACT(YEAR  FROM current_date);
  IF v_month >= 4 THEN
    v_fy := LPAD((v_year - 2000)::text, 2, '0') || '-' ||
            LPAD((v_year - 2000 + 1)::text, 2, '0');
  ELSE
    v_fy := LPAD((v_year - 2000 - 1)::text, 2, '0') || '-' ||
            LPAD((v_year - 2000)::text, 2, '0');
  END IF;

  -- 3. Get or create counter for this FY
  -- starting_number comes from company_doc_number_counter if SA pre-created it,
  -- otherwise defaults to 1
  INSERT INTO erp_procurement.company_doc_number_counter
    (company_id, document_type, financial_year, starting_number, last_number)
  VALUES
    (p_company_id, p_doc_type, v_fy, 1, 1)
  ON CONFLICT (company_id, document_type, financial_year)
  DO UPDATE SET
    last_number = erp_procurement.company_doc_number_counter.last_number + 1
  RETURNING last_number INTO v_next;

  -- If this was a fresh insert (last_number = 1), check if SA set a starting_number
  IF v_next = 1 THEN
    SELECT starting_number INTO v_next
    FROM erp_procurement.company_doc_number_counter
    WHERE company_id    = p_company_id
      AND document_type = p_doc_type
      AND financial_year = v_fy;
    -- Update last_number to starting_number
    UPDATE erp_procurement.company_doc_number_counter
    SET last_number = v_next
    WHERE company_id    = p_company_id
      AND document_type = p_doc_type
      AND financial_year = v_fy;
  END IF;

  -- 4. Format: {prefix}/{FY}/{padded_number}
  v_padded := LPAD(v_next::text, v_series.number_padding, '0');
  RETURN v_series.prefix || '/' || v_fy || '/' || v_padded;
END;
$$;

GRANT EXECUTE ON FUNCTION erp_procurement.generate_company_doc_number(uuid, text)
  TO service_role;

-- ── Drop old invoice_number_series infrastructure ──────────────────────
-- Sales Invoice now uses generate_doc_number('SALES_INVOICE') instead.
DROP FUNCTION IF EXISTS erp_procurement.generate_invoice_number();
-- Note: keep invoice_number_series table for now (data audit), just stop using it.

COMMIT;
```

---

## Gate-18.2 — Backend Handler Changes

### Files to update:

**1. `supabase/functions/api/_core/procurement/po.handlers.ts`**

Replace:
```ts
const poNumber = await generateProcurementDocNumber("PO");
```
With:
```ts
const poNumber = await generateCompanyDocNumber(ctx.companyId, "PO");
```

Add helper (alongside `generateProcurementDocNumber`):
```ts
async function generateCompanyDocNumber(companyId: string, docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_company_doc_number", {
      p_company_id: companyId,
      p_doc_type: docType,
    });
  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }
  return String(data);
}
```

**2. `supabase/functions/api/_core/procurement/sto.handlers.ts`**

Same pattern — replace `generateProcurementDocNumber("STO")` with `generateCompanyDocNumber(ctx.companyId, "STO")`.

**3. `supabase/functions/api/_core/procurement/sales_order.handlers.ts`**

Replace `generate_invoice_number()` RPC call with `generateProcurementDocNumber("SALES_INVOICE")`.

---

### New SA Handlers

**File:** `supabase/functions/api/_core/procurement/number_series.handlers.ts`

SA-only. All handlers assert SA role.

| Handler | Method + Path | Description |
|---|---|---|
| `listGlobalSeriesHandler` | `GET /api/procurement/number-series/global` | List all global doc types with current + starting number |
| `updateGlobalStartingHandler` | `PATCH /api/procurement/number-series/global/:doc_type` | SA updates starting_number (only allowed if last_number = 0, i.e. unused) |
| `listCompanySeriesHandler` | `GET /api/procurement/number-series/company` | List company+FY series. Filter by company_id optional |
| `createCompanySeriesHandler` | `POST /api/procurement/number-series/company` | SA creates series config (company + doc_type + prefix + padding) |
| `listCompanyCountersHandler` | `GET /api/procurement/number-series/company/:company_id/:doc_type/counters` | List FY counters for a series |
| `createCompanyCounterHandler` | `POST /api/procurement/number-series/company/:company_id/:doc_type/counters` | SA creates FY counter with starting_number |

**Route file:** Add to `supabase/functions/api/_routes/procurement.routes.ts`

```ts
// Number Series (SA only)
if (method === "GET"  && path === "/api/procurement/number-series/global")
  return listGlobalSeriesHandler(ctx);
if (method === "PATCH" && pathParts[4] === "global" && pathParts[5])
  return updateGlobalStartingHandler(ctx, pathParts[5]);
if (method === "GET"  && path === "/api/procurement/number-series/company")
  return listCompanySeriesHandler(ctx);
if (method === "POST" && path === "/api/procurement/number-series/company")
  return createCompanySeriesHandler(ctx);
if (method === "GET"  && pathParts[6] === "counters")
  return listCompanyCountersHandler(ctx, pathParts[4], pathParts[5]);
if (method === "POST" && pathParts[6] === "counters")
  return createCompanyCounterHandler(ctx, pathParts[4], pathParts[5]);
```

---

## Gate-18.3 — Frontend: `SAOmNumberSeries.jsx` Rebuild

**File:** `frontend/src/admin/sa/screens/SAOmNumberSeries.jsx`

Complete rebuild. Two sections on one page.

### API functions to add in `procurementApi.js`:

```js
export function listGlobalNumberSeries() {
  return fetchProcurement("GET", "/api/procurement/number-series/global");
}
export function updateGlobalStartingNumber(docType, data) {
  return fetchProcurement("PATCH", `/api/procurement/number-series/global/${encodeURIComponent(docType)}`, data);
}
export function listCompanyNumberSeries(params) {
  return fetchProcurement("GET", "/api/procurement/number-series/company", undefined, params);
}
export function createCompanyNumberSeries(data) {
  return fetchProcurement("POST", "/api/procurement/number-series/company", data);
}
export function listCompanyCounters(companyId, docType) {
  return fetchProcurement("GET", `/api/procurement/number-series/company/${encodeURIComponent(companyId)}/${encodeURIComponent(docType)}/counters`);
}
export function createCompanyCounter(companyId, docType, data) {
  return fetchProcurement("POST", `/api/procurement/number-series/company/${encodeURIComponent(companyId)}/${encodeURIComponent(docType)}/counters`, data);
}
```

### Screen Layout:

**Section 1 — Global Series**
```
eyebrow: "Global Document Numbers"
title: "System-wide counters (no company, no FY)"

Grid columns:
  Doc Type | Starting # | Current # | Action
  GRN      | 100001     | 100045    | [Edit Starting]  ← only if last_number = 0
  GE       | 200001     | 200012    | —
  ...

Edit Starting: inline number input + Save button
Note: "Starting number can only be changed before first document is generated."
```

**Section 2 — Company + FY Series**
```
eyebrow: "Company + FY Document Numbers"
title: "PO and STO — per company, resets each FY"

Filter: Company dropdown

Grid columns:
  Company | Doc Type | Prefix | Padding | Active

Create Series form:
  Company (dropdown, required)
  Document Type (PO / STO dropdown, required)
  Prefix (text input, required) ← SA types freely
  Padding (number input, default 5)
  [Create Series]

FY Counters (shown when a series row is selected / expanded):
  FY    | Starting # | Current # | 
  25-26 | 1          | 247       |
  26-27 | —          | —         | [Create Counter]

Create Counter form:
  Financial Year (text input, e.g. 26-27)
  Starting Number (number input, default 1)
  [Create]
```

---

## Critical Points

- `generate_company_doc_number()` must be SECURITY DEFINER + GRANT to service_role only
- SA screen: "Edit Starting" button only visible when `last_number = 0` (series never used)
- `createCompanyCounterHandler`: reject if counter for that FY already exists
- PO handler must pass `ctx.companyId` — not nullable for PO/STO
- STO handler must pass `ctx.companyId` from the STO's `sending_company_id`
- All 6 SA handler routes must assert SA role — reject with 403 if not SA
- `document_number_series` seed already has correct global docs after Migration 18.1.1

---

## Verification Checklist

- [ ] `document_number_series`: STO removed, SALES_INVOICE added, starting_number column present
- [ ] `company_doc_number_series` table exists with UNIQUE(company_id, document_type)
- [ ] `company_doc_number_counter` table exists with UNIQUE(company_id, document_type, financial_year)
- [ ] `generate_company_doc_number()` returns correct `prefix/FY/padded` format
- [ ] PO handler uses `generate_company_doc_number` — not global
- [ ] STO handler uses `generate_company_doc_number` — not global
- [ ] Sales Invoice handler uses `generate_doc_number('SALES_INVOICE')`
- [ ] 6 SA number series routes wired in procurement.routes.ts
- [ ] All SA handlers assert SA role
- [ ] SAOmNumberSeries.jsx: Global section shows doc_type + starting + current
- [ ] SAOmNumberSeries.jsx: Company+FY section shows series + FY counters
- [ ] Prefix is free text input — no format validation
- [ ] "Edit Starting" disabled after first document generated
