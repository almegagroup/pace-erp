# OM-GATE-19 — Opening Stock Migration

**Spec Status:** FINAL
**Gate:** 19
**Domain:** PROCUREMENT / SA CONFIG
**Dependency:** Gate-18 VERIFIED ✅
**Date:** 2026-05-12

---

## Overview

One-time migration to load opening stock into PACE-ERP as of cut-off date (30 June 2026).
SA creates a document, adds lines (material + plant + storage_location + stock_type + qty + rate), approves and posts.
Posting calls `post_stock_movement()` per line → stock_ledger entry created.

**Movement type mapping:**
| Stock Type | Movement Type | Direction |
|---|---|---|
| UNRESTRICTED | P561 | IN |
| QUALITY_INSPECTION | P563 | IN |
| BLOCKED | P565 | IN |

---

## Gate-19.1 — DB Migrations

### Migration 19.1.1 — Seed P563 + P565 Movement Types

**File:** `20260512200000_gate19_19_1_1_seed_opening_stock_movement_types.sql`

```sql
BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, description, direction, source_stock_type, target_stock_type,
   requires_approval, document_category, reversal_of, reversal_code,
   role_restricted, sa_only, qa_only, active)
VALUES
  ('P563', 'Opening Stock — QA',      'IN',  NULL,  'QUALITY_INSPECTION', false, 'OPENING_STOCK', NULL,   'P564', false, true, false, true),
  ('P564', 'P563 Reversal',           'OUT', 'QUALITY_INSPECTION', NULL, false, 'OPENING_STOCK', 'P563', NULL,   false, true, false, true),
  ('P565', 'Opening Stock — Blocked', 'IN',  NULL,  'BLOCKED',            false, 'OPENING_STOCK', NULL,   'P566', false, true, false, true),
  ('P566', 'P565 Reversal',           'OUT', 'BLOCKED', NULL,             false, 'OPENING_STOCK', 'P565', NULL,   false, true, false, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
```

---

### Migration 19.1.2 — Opening Stock Tables

**File:** `20260512200100_gate19_19_1_2_create_opening_stock_tables.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.opening_stock_document (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number   text NOT NULL UNIQUE,
  company_id        uuid NOT NULL,
  plant_id          uuid NOT NULL,
  cut_off_date      date NOT NULL,
  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED')),
  notes             text NULL,
  created_by        uuid NOT NULL,
  submitted_by      uuid NULL,
  submitted_at      timestamptz NULL,
  approved_by       uuid NULL,
  approved_at       timestamptz NULL,
  posted_by         uuid NULL,
  posted_at         timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, plant_id, cut_off_date)
);

COMMENT ON TABLE erp_procurement.opening_stock_document IS
'One-time opening stock migration document per company+plant+cut_off_date.';

CREATE TABLE IF NOT EXISTS erp_procurement.opening_stock_line (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id               uuid NOT NULL
    REFERENCES erp_procurement.opening_stock_document(id) ON DELETE RESTRICT,
  line_number               int NOT NULL,
  material_id               uuid NOT NULL,
  storage_location_id       uuid NOT NULL,
  stock_type                text NOT NULL
                              CHECK (stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED')),
  quantity                  numeric(18,4) NOT NULL CHECK (quantity > 0),
  rate_per_unit             numeric(18,4) NOT NULL CHECK (rate_per_unit >= 0),
  total_value               numeric(18,4) GENERATED ALWAYS AS (quantity * rate_per_unit) STORED,
  movement_type_code        text NOT NULL,  -- P561 / P563 / P565 (derived on insert)
  posted_stock_document_id  uuid NULL,      -- set after post_stock_movement succeeds
  created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.opening_stock_line IS
'Lines for opening stock document. Each line posts one stock movement.';

CREATE INDEX IF NOT EXISTS idx_osd_company_status
  ON erp_procurement.opening_stock_document (company_id, status);

CREATE INDEX IF NOT EXISTS idx_osl_document_id
  ON erp_procurement.opening_stock_line (document_id);

GRANT ALL ON erp_procurement.opening_stock_document TO service_role;
GRANT ALL ON erp_procurement.opening_stock_line TO service_role;

-- Add OS to global document number series
INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('OS', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
```

---

## Gate-19.2 — Backend Handlers

**File:** `supabase/functions/api/_core/procurement/opening_stock.handlers.ts`

All handlers assert SA role. Non-SA → 403.

### movement_type derivation (internal helper):
```ts
function deriveMovementType(stockType: string): string {
  switch (stockType.toUpperCase()) {
    case "QUALITY_INSPECTION": return "P563";
    case "BLOCKED":            return "P565";
    default:                   return "P561"; // UNRESTRICTED
  }
}
```

### Handlers:

| Handler | Method + Path | Description |
|---|---|---|
| `createOpeningStockDocumentHandler` | `POST /api/procurement/opening-stock` | SA creates DRAFT. Generates document_number via `generate_doc_number('OS')`. UNIQUE(company+plant+cut_off_date) enforced. |
| `listOpeningStockDocumentsHandler` | `GET /api/procurement/opening-stock` | List all documents. Filter: company_id, status. |
| `getOpeningStockDocumentHandler` | `GET /api/procurement/opening-stock/:id` | Detail with lines. |
| `addOpeningStockLineHandler` | `POST /api/procurement/opening-stock/:id/lines` | Add line to DRAFT document. movement_type_code derived from stock_type. line_number auto-incremented. |
| `updateOpeningStockLineHandler` | `PUT /api/procurement/opening-stock/:id/lines/:lineId` | Update qty/rate/location (DRAFT only). |
| `removeOpeningStockLineHandler` | `DELETE /api/procurement/opening-stock/:id/lines/:lineId` | Remove line (DRAFT only). |
| `submitOpeningStockDocumentHandler` | `POST /api/procurement/opening-stock/:id/submit` | DRAFT → SUBMITTED. Requires at least 1 line. |
| `approveOpeningStockDocumentHandler` | `POST /api/procurement/opening-stock/:id/approve` | SUBMITTED → APPROVED. SA only. |
| `postOpeningStockDocumentHandler` | `POST /api/procurement/opening-stock/:id/post` | APPROVED → POSTED. Calls `post_stock_movement()` per line. All-or-nothing — if any line fails, full rollback. Sets posted_stock_document_id per line. |

### Post logic (per line):
```ts
await serviceRoleClient.schema("erp_inventory").rpc("post_stock_movement", {
  p_document_number:    document.document_number,
  p_document_date:      document.cut_off_date,
  p_posting_date:       document.cut_off_date,
  p_movement_type_code: line.movement_type_code,   // P561 / P563 / P565
  p_company_id:         document.company_id,
  p_plant_id:           document.plant_id,
  p_storage_location_id: line.storage_location_id,
  p_material_id:        line.material_id,
  p_quantity:           line.quantity,
  p_base_uom_code:      material.base_uom_code,
  p_unit_value:         line.rate_per_unit,
  p_stock_type_code:    line.stock_type,
  p_direction:          "IN",
  p_posted_by:          ctx.auth_user_id,
  p_reversal_of_id:     null,
});
```

### Routes to add in `procurement.routes.ts`:
```ts
POST   /api/procurement/opening-stock
GET    /api/procurement/opening-stock
GET    /api/procurement/opening-stock/:id
POST   /api/procurement/opening-stock/:id/lines
PUT    /api/procurement/opening-stock/:id/lines/:lineId
DELETE /api/procurement/opening-stock/:id/lines/:lineId
POST   /api/procurement/opening-stock/:id/submit
POST   /api/procurement/opening-stock/:id/approve
POST   /api/procurement/opening-stock/:id/post
```

---

## Gate-19.3 — Frontend

### API functions in `procurementApi.js`:
```js
export function listOpeningStockDocuments(params) {
  return fetchProcurement("GET", "/api/procurement/opening-stock", undefined, params);
}
export function createOpeningStockDocument(data) {
  return fetchProcurement("POST", "/api/procurement/opening-stock", data);
}
export function getOpeningStockDocument(id) {
  return fetchProcurement("GET", `/api/procurement/opening-stock/${encodeURIComponent(id)}`);
}
export function addOpeningStockLine(id, data) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines`, data);
}
export function updateOpeningStockLine(id, lineId, data) {
  return fetchProcurement("PUT", `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`, data);
}
export function removeOpeningStockLine(id, lineId) {
  return fetchProcurement("DELETE", `/api/procurement/opening-stock/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`);
}
export function submitOpeningStockDocument(id) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/submit`);
}
export function approveOpeningStockDocument(id) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/approve`);
}
export function postOpeningStockDocument(id) {
  return fetchProcurement("POST", `/api/procurement/opening-stock/${encodeURIComponent(id)}/post`);
}
```

### Files:
- `frontend/src/admin/sa/screens/SAOpeningStockListPage.jsx`
- `frontend/src/admin/sa/screens/SAOpeningStockDetailPage.jsx`

---

### SAOpeningStockListPage.jsx

```
eyebrow: "Super Admin"
title: "Opening Stock Migration"

Actions:
  [Create Document]  → opens create form or navigates to new detail

Grid columns:
  Document # | Company | Plant | Cut-off Date | Lines | Status | Action
  OS-000001  | CMP003  | PLANT-01 | 30/06/2026 | 45   | DRAFT  | [Open]

Filter: company_id dropdown, status dropdown
```

### SAOpeningStockDetailPage.jsx

**Header section:**
```
Document #, Company, Plant, Cut-off Date, Status (badge), Notes
```

**Status flow buttons (conditional):**
- Status = DRAFT → [Submit for Approval]
- Status = SUBMITTED → [Approve]
- Status = APPROVED → [Post Stock] (with confirm dialog: "This will post stock movements to the ledger. Cannot be undone.")
- Status = POSTED → read-only, show posted_at

**Lines grid:**
```
Line # | Material | Storage Location | Stock Type | Qty | Rate | Total Value | Movement | Action
1      | Calcium Carbonate | WH-A | UNRESTRICTED | 5000 | 25.00 | 125000.00 | P561 | [Edit] [Remove]
```
Edit/Remove only visible when status = DRAFT.

**Add Line form (DRAFT only):**
```
Material:          [combobox — material name search]
Storage Location:  [dropdown — filtered by plant]
Stock Type:        [dropdown: UNRESTRICTED / QUALITY_INSPECTION / BLOCKED]
Quantity:          [number input]
Rate per Unit:     [number input]
Total Value:       [auto-calculated, read-only = qty × rate]
                   [Add Line button]
```

**Summary footer:**
```
Total Lines: 45 | Total Value: ₹12,45,000.00
```

---

## Status Badge Tones
- DRAFT → slate
- SUBMITTED → amber
- APPROVED → sky
- POSTED → emerald

---

## Critical Points

- `UNIQUE(company_id, plant_id, cut_off_date)` — one document per company+plant+cut_off_date
- `total_value` is a GENERATED ALWAYS column — never set manually
- `movement_type_code` derived server-side from `stock_type` — client never sends movement type
- `postOpeningStockDocumentHandler` must be all-or-nothing — if any `post_stock_movement()` fails, stop and return error (lines already posted remain, but document stays APPROVED — retry allowed)
- All handlers assert SA role → 403 if not SA
- `p_plant_id` is passed to `post_stock_movement()` — unlike GRN which passes null
- Storage location dropdown in FE filtered by selected plant
- Material combobox shows `material_name (pace_code)` format
- Add Line disabled when document is not DRAFT

---

## Verification Checklist

- [ ] P563 + P564 + P565 + P566 seeded in movement_type_master
- [ ] `opening_stock_document` table — UNIQUE(company_id, plant_id, cut_off_date) ✓
- [ ] `opening_stock_line.total_value` — GENERATED ALWAYS AS (qty × rate)
- [ ] `opening_stock_line.movement_type_code` — derived server-side, not from client
- [ ] `document_number_series` — 'OS' seeded
- [ ] 9 handlers, all assert SA role
- [ ] `postOpeningStockDocumentHandler` — calls `post_stock_movement()` per line with correct params including `p_plant_id`
- [ ] 9 routes wired in procurement.routes.ts
- [ ] 9 procurementApi.js functions
- [ ] SAOpeningStockListPage — list + create action
- [ ] SAOpeningStockDetailPage — header + lines grid + add line form + status action buttons
- [ ] Add Line form: Total Value auto-calc read-only
- [ ] Post confirm dialog present
- [ ] Storage location dropdown filtered by plant
