# CODEX-GATE23-TASK-BRIEF — Plant Transfer

**Gate:** 23
**Domain:** PROCUREMENT / INVENTORY
**Authority:** DB + Backend + Frontend
**Dependency:** Gate-22 VERIFIED ✅

---

## Overview

Gate-23 implements plant-to-plant stock transfer (Section 65 of the feasibility doc).

Two transfer modes:
- **ONE_STEP** — immediate transfer, no in-transit period (Movement P301 at source + P301 at target)
- **TWO_STEP** — physical transport involved, stock goes through IN_TRANSIT bucket (P303 issue → P305 receipt)

Plus a separate **SLOC transfer** endpoint — storage location change within same plant (P311), no document, direct posting.

New document: **Plant Transfer Order (PTO)** for ONE_STEP and TWO_STEP.
P301/P302 movement types are missing from Gate-11 seed — add them here.

---

## Files to Create

**DB:**
- `supabase/migrations/20260520000000_gate23_23_1_create_plant_transfer_order.sql`
- `supabase/migrations/20260520001000_gate23_23_2_seed_p301_p302.sql`

**BE:**
- `supabase/functions/api/_core/procurement/pto.handlers.ts`

**FE:**
- `frontend/src/pages/dashboard/procurement/transfer/PlantTransferListPage.jsx`
- `frontend/src/pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx`

## Files to Modify

**BE:**
- `supabase/functions/api/_routes/procurement.routes.ts` — add 9 PTO routes

**FE:**
- `frontend/src/pages/dashboard/procurement/procurementApi.js` — add 9 PTO functions
- `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` — add `PROC_PLANT_TRANSFER_LIST`, `PROC_PLANT_TRANSFER_DETAIL`
- `frontend/src/router/AppRouter.jsx` — add 2 imports + 2 routes

---

## Migration 1 — plant_transfer_order table + PT number series

### File Header
```sql
/*
 * File-ID: 23.1
 * File-Path: supabase/migrations/20260520000000_gate23_23_1_create_plant_transfer_order.sql
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: Plant Transfer Order document — supports ONE_STEP and TWO_STEP inter-plant stock transfers.
 * Authority: Backend
 */
```

### Table DDL
```sql
BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.plant_transfer_order (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System-generated number: PT000001
  pto_number                  text NOT NULL UNIQUE,

  -- ONE_STEP: P301 atomic, no in-transit. TWO_STEP: P303 issue → P305 receipt.
  transfer_type               text NOT NULL
    CHECK (transfer_type IN ('ONE_STEP', 'TWO_STEP')),

  -- DRAFT → APPROVED → ISSUED → [IN_TRANSIT (TWO_STEP only)] → CLOSED | CANCELLED
  status                      text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'ISSUED', 'IN_TRANSIT', 'CLOSED', 'CANCELLED')),

  -- Source (cross-schema plain uuid — NO FK)
  source_company_id           uuid NOT NULL,
  source_plant_id             uuid NOT NULL,
  source_sloc_id              uuid NOT NULL,   -- erp_inventory.storage_location_master

  -- Target (cross-schema plain uuid — NO FK)
  target_company_id           uuid NOT NULL,
  target_plant_id             uuid NOT NULL,
  target_sloc_id              uuid NOT NULL,   -- erp_inventory.storage_location_master

  -- GST placeholder fields (Phase-1: stored, not automated)
  source_gstin                text NULL,
  target_gstin                text NULL,
  gst_applicable              boolean NOT NULL DEFAULT false,
  tax_document_required       boolean NOT NULL DEFAULT false,

  -- Material (cross-schema plain uuid — NO FK)
  material_id                 uuid NOT NULL,
  transfer_qty                numeric(20,6) NOT NULL CHECK (transfer_qty > 0),
  uom_code                    text NOT NULL,

  -- Valuation — set at issue time from stock_snapshot.valuation_rate
  valuation_rate              numeric(20,6) NULL,
  transfer_value              numeric(20,6) NULL,
  transfer_price_type         text NOT NULL DEFAULT 'AT_COST'
    CHECK (transfer_price_type IN ('AT_COST', 'AT_AGREED_PRICE')),

  -- Transport fields
  transport_required          boolean NOT NULL DEFAULT false,
  vehicle_number              text NULL,
  transporter_name            text NULL,
  lr_number                   text NULL,
  expected_dispatch_date      date NULL,
  expected_receipt_date       date NULL,

  -- GST / e-way bill placeholder (Phase-1: stored but not auto-populated)
  eway_bill_reference         text NULL,
  gst_invoice_reference       text NULL,

  -- Approval
  approved_by                 uuid NULL,
  approved_at                 timestamptz NULL,

  -- Issue tracking
  issued_by                   uuid NULL,
  issued_at                   timestamptz NULL,

  -- Receipt tracking (TWO_STEP only)
  received_by                 uuid NULL,
  received_at                 timestamptz NULL,
  actual_receipt_date         date NULL,

  -- Stock document references (plain uuid — NO FK to erp_inventory cross-schema)
  issue_stock_document_id     uuid NULL,    -- stock_document created on P301/P303 posting
  receipt_stock_document_id   uuid NULL,    -- stock_document created on P301-target/P305 posting

  cancellation_reason         text NULL,
  remarks                     text NULL,
  created_by                  uuid NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  last_updated_by             uuid NULL,
  last_updated_at             timestamptz NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pto_source_company
  ON erp_procurement.plant_transfer_order (source_company_id);

CREATE INDEX IF NOT EXISTS idx_pto_target_company
  ON erp_procurement.plant_transfer_order (target_company_id);

CREATE INDEX IF NOT EXISTS idx_pto_status
  ON erp_procurement.plant_transfer_order (status);

CREATE INDEX IF NOT EXISTS idx_pto_material
  ON erp_procurement.plant_transfer_order (material_id);

CREATE INDEX IF NOT EXISTS idx_pto_created_at
  ON erp_procurement.plant_transfer_order (created_at DESC);

-- Grant
GRANT SELECT, INSERT, UPDATE ON erp_procurement.plant_transfer_order TO service_role;

-- PT number series
INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('PT', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
```

---

## Migration 2 — Seed P301 and P302 movement types

### File Header
```sql
/*
 * File-ID: 23.2
 * File-Path: supabase/migrations/20260520001000_gate23_23_2_seed_p301_p302.sql
 * Gate: 23
 * Phase: 23
 * Domain: INVENTORY
 * Purpose: Add missing P301 (one-step plant transfer) and P302 (reversal) movement types.
 * Authority: Backend
 */
```

### Seed SQL
```sql
BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES
  ('P301', 'Plant Transfer (One-Step)',    'TRANSFER', 'UNRESTRICTED', 'UNRESTRICTED', true, 'PLANT_TRANSFER_ORDER', NULL,   'P302', false, true,  false, true),
  ('P302', 'P301 Reversal',               'TRANSFER', 'UNRESTRICTED', 'UNRESTRICTED', true, 'PLANT_TRANSFER_ORDER', 'P301', NULL,   false, true,  false, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
```

---

## Backend — pto.handlers.ts

### File Header
```ts
/*
 * File-ID: 23.3
 * File-Path: supabase/functions/api/_core/procurement/pto.handlers.ts
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: Plant Transfer Order — ONE_STEP (P301) and TWO_STEP (P303/P305) handlers + SLOC transfer (P311).
 * Authority: Backend
 */
```

### Helper: `generateProcurementDocNumber`
Copy exact pattern from sto.handlers.ts:
```ts
async function generateProcurementDocNumber(docType: string): Promise<string> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: docType });
  if (error || !data) {
    throw new Error("PROCUREMENT_DOC_NUMBER_FAILED");
  }
  return String(data);
}
```

### Helper: `todayIsoDate`
```ts
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
```

### Helper: `postStockMovement`
```ts
async function postStockMovement(params: {
  documentNumber: string;
  movementTypeCode: string;
  companyId: string;
  plantId: string;
  storageLocationId: string;
  materialId: string;
  quantity: number;
  uomCode: string;
  unitValue: number;
  stockTypeCode: string;
  direction: "IN" | "OUT";
  postedBy: string;
  reversalOfId?: string;
}): Promise<{ stockDocumentId: string; stockLedgerId: string }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .rpc("post_stock_movement", {
      p_document_number:      params.documentNumber,
      p_document_date:        todayIsoDate(),
      p_posting_date:         todayIsoDate(),
      p_movement_type_code:   params.movementTypeCode,
      p_company_id:           params.companyId,
      p_plant_id:             params.plantId,
      p_storage_location_id:  params.storageLocationId,
      p_material_id:          params.materialId,
      p_quantity:             params.quantity,
      p_base_uom_code:        params.uomCode,
      p_unit_value:           params.unitValue,
      p_stock_type_code:      params.stockTypeCode,
      p_direction:            params.direction,
      p_posted_by:            params.postedBy,
      p_reversal_of_id:       params.reversalOfId ?? null,
    });
  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error("PTO_STOCK_POSTING_FAILED");
  }
  return {
    stockDocumentId: String((data[0] as Record<string, unknown>).stock_document_id),
    stockLedgerId:   String((data[0] as Record<string, unknown>).stock_ledger_id),
  };
}
```

### Helper: `fetchSnapshot`
```ts
async function fetchSnapshot(
  companyId: string,
  plantId: string,
  slocId: string,
  materialId: string,
  stockTypeCode: string,
): Promise<{ quantity: number; valuation_rate: number } | null> {
  const { data, error } = await serviceRoleClient
    .schema("erp_inventory")
    .from("stock_snapshot")
    .select("quantity, valuation_rate")
    .eq("company_id", companyId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", slocId)
    .eq("material_id", materialId)
    .eq("stock_type_code", stockTypeCode)
    .is("batch_id", null)
    .maybeSingle();
  if (error) {
    throw new Error("PTO_SNAPSHOT_FETCH_FAILED");
  }
  if (!data) return null;
  return {
    quantity: Number((data as Record<string, unknown>).quantity ?? 0),
    valuation_rate: Number((data as Record<string, unknown>).valuation_rate ?? 0),
  };
}
```

---

### Handler 1: `createPTOHandler`

**Route:** `POST /api/procurement/ptos`

**Body fields:**
```
transfer_type          — "ONE_STEP" | "TWO_STEP" (required)
source_company_id      — uuid (required)
source_plant_id        — uuid (required)
source_sloc_id         — uuid (required)
target_company_id      — uuid (required)
target_plant_id        — uuid (required)
target_sloc_id         — uuid (required)
material_id            — uuid (required)
transfer_qty           — number > 0 (required)
uom_code               — text (required)
transfer_price_type    — "AT_COST" | "AT_AGREED_PRICE" (default "AT_COST")
gst_applicable         — boolean (default false)
tax_document_required  — boolean (default false)
transport_required     — boolean (default false)
vehicle_number         — text (optional)
transporter_name       — text (optional)
lr_number              — text (optional)
expected_dispatch_date — date string (optional)
expected_receipt_date  — date string (optional)
source_gstin           — text (optional)
target_gstin           — text (optional)
eway_bill_reference    — text (optional)
gst_invoice_reference  — text (optional)
remarks                — text (optional)
```

**Validation:**
- `transfer_type` must be ONE_STEP or TWO_STEP
- `transfer_qty` must be > 0
- All required uuid fields must be non-empty strings

**Logic:**
1. Parse and validate body
2. `pto_number = await generateProcurementDocNumber("PT")`
3. Insert into `erp_procurement.plant_transfer_order` with `status = 'DRAFT'`
4. Return inserted row

---

### Handler 2: `listPTOsHandler`

**Route:** `GET /api/procurement/ptos`

**Query params:**
| Param | Default |
|---|---|
| `company_id` | optional — filters source_company_id OR target_company_id |
| `status` | optional |
| `transfer_type` | optional |
| `limit` | 100 |
| `offset` | 0 |

**Logic:**
- Query `erp_procurement.plant_transfer_order` with filters
- If `company_id` provided: `.or("source_company_id.eq.{id},target_company_id.eq.{id}")`
- Order by `created_at DESC`
- Return `{ items, total }`

---

### Handler 3: `getPTOHandler`

**Route:** `GET /api/procurement/ptos/:id`

Extract `:id` from `new URL(req.url).pathname` using regex `/^\/api\/procurement\/ptos\/([^/]+)$/`.

Return the full row. If not found → 404 with code `PTO_NOT_FOUND`.

---

### Handler 4: `approvePTOHandler`

**Route:** `POST /api/procurement/ptos/:id/approve`

**Logic:**
1. Fetch PTO by id — 404 if not found
2. Guard: `status` must be `'DRAFT'` → 400 `PTO_INVALID_STATUS`
3. Update: `status = 'APPROVED'`, `approved_by = ctx.auth_user_id`, `approved_at = now()`
4. Return updated row

---

### Handler 5: `oneStepTransferHandler` (P301)

**Route:** `POST /api/procurement/ptos/:id/one-step`

Used for ONE_STEP transfers only.

**Logic:**
1. Fetch PTO — 404 if not found
2. Guard: `status` must be `'APPROVED'` → 400 `PTO_INVALID_STATUS`
3. Guard: `transfer_type` must be `'ONE_STEP'` → 400 `PTO_WRONG_TRANSFER_TYPE`
4. Fetch stock snapshot at source: `fetchSnapshot(source_company_id, source_plant_id, source_sloc_id, material_id, 'UNRESTRICTED')`
5. Guard: snapshot must exist and `snapshot.quantity >= transfer_qty` → 400 `INSUFFICIENT_STOCK`
6. `valuationRate = snapshot.valuation_rate`
7. **Posting Call 1 — source deduction:**
   ```
   postStockMovement({
     documentNumber: pto.pto_number,
     movementTypeCode: 'P301',
     companyId: pto.source_company_id,
     plantId: pto.source_plant_id,
     storageLocationId: pto.source_sloc_id,
     materialId: pto.material_id,
     quantity: pto.transfer_qty,
     uomCode: pto.uom_code,
     unitValue: valuationRate,
     stockTypeCode: 'UNRESTRICTED',
     direction: 'OUT',
     postedBy: ctx.auth_user_id,
   })
   ```
8. **Posting Call 2 — target addition:**
   ```
   postStockMovement({
     documentNumber: pto.pto_number,
     movementTypeCode: 'P301',
     companyId: pto.target_company_id,
     plantId: pto.target_plant_id,
     storageLocationId: pto.target_sloc_id,
     materialId: pto.material_id,
     quantity: pto.transfer_qty,
     uomCode: pto.uom_code,
     unitValue: valuationRate,
     stockTypeCode: 'UNRESTRICTED',
     direction: 'IN',
     postedBy: ctx.auth_user_id,
   })
   ```
9. Update PTO:
   ```
   status = 'CLOSED'
   issued_by = ctx.auth_user_id
   issued_at = now()
   valuation_rate = valuationRate
   transfer_value = Number((pto.transfer_qty * valuationRate).toFixed(6))
   issue_stock_document_id = result1.stockDocumentId
   receipt_stock_document_id = result2.stockDocumentId
   last_updated_by = ctx.auth_user_id
   last_updated_at = now()
   ```
10. Return updated PTO

---

### Handler 6: `issueTransferHandler` (P303)

**Route:** `POST /api/procurement/ptos/:id/issue`

Used for TWO_STEP transfers only. Issues stock from source → IN_TRANSIT.

**Logic:**
1. Fetch PTO — 404 if not found
2. Guard: `status` must be `'APPROVED'` → 400 `PTO_INVALID_STATUS`
3. Guard: `transfer_type` must be `'TWO_STEP'` → 400 `PTO_WRONG_TRANSFER_TYPE`
4. Fetch source snapshot: `fetchSnapshot(source_company_id, source_plant_id, source_sloc_id, material_id, 'UNRESTRICTED')`
5. Guard: snapshot exists and `qty >= transfer_qty` → 400 `INSUFFICIENT_STOCK`
6. `valuationRate = snapshot.valuation_rate`
7. **Posting Call 1 — deduct UNRESTRICTED at source:**
   ```
   postStockMovement({
     movementTypeCode: 'P303',
     companyId: source_company_id,
     plantId: source_plant_id,
     storageLocationId: source_sloc_id,
     stockTypeCode: 'UNRESTRICTED',
     direction: 'OUT',
     ...rest same as above
   })
   ```
8. **Posting Call 2 — add IN_TRANSIT at source (tracks in-transit bucket):**
   ```
   postStockMovement({
     movementTypeCode: 'P303',
     companyId: source_company_id,
     plantId: source_plant_id,
     storageLocationId: source_sloc_id,
     stockTypeCode: 'IN_TRANSIT',
     direction: 'IN',
     ...rest same
   })
   ```
9. Update PTO:
   ```
   status = 'IN_TRANSIT'
   issued_by = ctx.auth_user_id
   issued_at = now()
   valuation_rate = valuationRate
   transfer_value = Number((pto.transfer_qty * valuationRate).toFixed(6))
   issue_stock_document_id = result1.stockDocumentId
   ```
10. Return updated PTO

---

### Handler 7: `receiveTransferHandler` (P305)

**Route:** `POST /api/procurement/ptos/:id/receive`

**Body:** `actual_receipt_date` (optional date string)

**Logic:**
1. Fetch PTO — 404 if not found
2. Guard: `status` must be `'IN_TRANSIT'` → 400 `PTO_INVALID_STATUS`
3. `valuationRate = pto.valuation_rate` (rate locked at issue time)
4. **Posting Call 1 — clear IN_TRANSIT at source:**
   ```
   postStockMovement({
     movementTypeCode: 'P305',
     companyId: source_company_id,
     plantId: source_plant_id,
     storageLocationId: source_sloc_id,
     stockTypeCode: 'IN_TRANSIT',
     direction: 'OUT',
     unitValue: valuationRate,
     ...
   })
   ```
5. **Posting Call 2 — add UNRESTRICTED at target:**
   ```
   postStockMovement({
     movementTypeCode: 'P305',
     companyId: target_company_id,
     plantId: target_plant_id,
     storageLocationId: target_sloc_id,
     stockTypeCode: 'UNRESTRICTED',
     direction: 'IN',
     unitValue: valuationRate,
     ...
   })
   ```
6. Update PTO:
   ```
   status = 'CLOSED'
   received_by = ctx.auth_user_id
   received_at = now()
   actual_receipt_date = body.actual_receipt_date || todayIsoDate()
   receipt_stock_document_id = result2.stockDocumentId
   ```
7. Return updated PTO

---

### Handler 8: `cancelPTOHandler`

**Route:** `POST /api/procurement/ptos/:id/cancel`

**Body:** `cancellation_reason` (optional text)

**Logic:**
1. Fetch PTO — 404 if not found
2. Guard: `status` must be `'DRAFT'` or `'APPROVED'` — cannot cancel ISSUED, IN_TRANSIT, CLOSED → 400 `PTO_CANNOT_CANCEL`
3. Update: `status = 'CANCELLED'`, `cancellation_reason`, `last_updated_by`, `last_updated_at`
4. Return updated PTO

---

### Handler 9: `storageLocationTransferHandler` (P311)

**Route:** `POST /api/procurement/sloc-transfer`

No PTO document. Direct posting only.

**Body:**
```
company_id       — uuid (required)
plant_id         — uuid (required)
source_sloc_id   — uuid (required)
target_sloc_id   — uuid (required)
material_id      — uuid (required)
transfer_qty     — number > 0 (required)
uom_code         — text (required)
remarks          — text (optional)
```

**Logic:**
1. Parse and validate body
2. Guard: `source_sloc_id !== target_sloc_id` → 400 `PTO_SAME_SLOC`
3. Guard: `transfer_qty > 0`
4. Fetch snapshot: `fetchSnapshot(company_id, plant_id, source_sloc_id, material_id, 'UNRESTRICTED')`
5. Guard: snapshot exists and `qty >= transfer_qty` → 400 `INSUFFICIENT_STOCK`
6. `valuationRate = snapshot.valuation_rate`
7. Generate a document reference number: `await generateProcurementDocNumber("PT")` (for ledger reference)
8. **Posting Call 1 — OUT from source sloc:**
   ```
   postStockMovement({
     movementTypeCode: 'P311',
     companyId: company_id, plantId: plant_id,
     storageLocationId: source_sloc_id,
     stockTypeCode: 'UNRESTRICTED', direction: 'OUT',
     ...
   })
   ```
9. **Posting Call 2 — IN to target sloc:**
   ```
   postStockMovement({
     movementTypeCode: 'P311',
     companyId: company_id, plantId: plant_id,
     storageLocationId: target_sloc_id,
     stockTypeCode: 'UNRESTRICTED', direction: 'IN',
     ...
   })
   ```
10. Return `{ ok: true, source_stock_document_id: result1.stockDocumentId, target_stock_document_id: result2.stockDocumentId }`

---

## Routes — procurement.routes.ts

Add import at top:
```ts
import {
  approvePTOHandler,
  cancelPTOHandler,
  createPTOHandler,
  getPTOHandler,
  issueTransferHandler,
  listPTOsHandler,
  oneStepTransferHandler,
  receiveTransferHandler,
  storageLocationTransferHandler,
} from "../_core/procurement/pto.handlers.ts";
```

Add to switch block (before the `default: break` line):
```ts
case "POST:/api/procurement/ptos":
  return await createPTOHandler(req, ctx);
case "GET:/api/procurement/ptos":
  return await listPTOsHandler(req, ctx);
case "POST:/api/procurement/sloc-transfer":
  return await storageLocationTransferHandler(req, ctx);
```

Add to regex block (after existing regex routes, before `return null`):
```ts
if (/^\/api\/procurement\/ptos\/[^/]+$/.test(pathname) && req.method === "GET") {
  return await getPTOHandler(req, ctx);
}
if (/^\/api\/procurement\/ptos\/[^/]+\/approve$/.test(pathname) && req.method === "POST") {
  return await approvePTOHandler(req, ctx);
}
if (/^\/api\/procurement\/ptos\/[^/]+\/one-step$/.test(pathname) && req.method === "POST") {
  return await oneStepTransferHandler(req, ctx);
}
if (/^\/api\/procurement\/ptos\/[^/]+\/issue$/.test(pathname) && req.method === "POST") {
  return await issueTransferHandler(req, ctx);
}
if (/^\/api\/procurement\/ptos\/[^/]+\/receive$/.test(pathname) && req.method === "POST") {
  return await receiveTransferHandler(req, ctx);
}
if (/^\/api\/procurement\/ptos\/[^/]+\/cancel$/.test(pathname) && req.method === "POST") {
  return await cancelPTOHandler(req, ctx);
}
```

---

## Frontend — procurementApi.js

Add 9 functions after `listBlockedIVs` or at the end of the file:
```js
export function listPTOs(params) {
  return fetchProcurement("GET", "/api/procurement/ptos", undefined, params);
}

export function getPTO(id) {
  return fetchProcurement("GET", `/api/procurement/ptos/${encodeURIComponent(id)}`);
}

export function createPTO(data) {
  return fetchProcurement("POST", "/api/procurement/ptos", data);
}

export function approvePTO(id) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/approve`);
}

export function oneStepTransfer(id) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/one-step`);
}

export function issueTransfer(id) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/issue`);
}

export function receiveTransfer(id, data) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/receive`, data);
}

export function cancelPTO(id, data) {
  return fetchProcurement("POST", `/api/procurement/ptos/${encodeURIComponent(id)}/cancel`, data);
}

export function slocTransfer(data) {
  return fetchProcurement("POST", "/api/procurement/sloc-transfer", data);
}
```

---

## Frontend — operationScreens.js

Insert after `PROC_PLANNING_VIEW`:
```js
PROC_PLANT_TRANSFER_LIST: {
  screen_code: "PROC_PLANT_TRANSFER_LIST",
  route: "/dashboard/procurement/transfer",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},
PROC_PLANT_TRANSFER_DETAIL: {
  screen_code: "PROC_PLANT_TRANSFER_DETAIL",
  route: "/dashboard/procurement/transfer/:id",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},
```

---

## Frontend — AppRouter.jsx

**Imports** (after ProcurementPlanningPage import):
```jsx
import PlantTransferListPage from "../pages/dashboard/procurement/transfer/PlantTransferListPage.jsx";
import PlantTransferDetailPage from "../pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx";
```

**Routes** (after `procurement/planning` route):
```jsx
<Route
  path="procurement/transfer"
  element={<PlantTransferListPage />}
/>
<Route
  path="procurement/transfer/:id"
  element={<PlantTransferDetailPage />}
/>
```

---

## Frontend — PlantTransferListPage.jsx

### File Header
```js
/*
 * File-ID: 23.4
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/PlantTransferListPage.jsx
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: List plant transfer orders — ONE_STEP and TWO_STEP
 * Authority: Frontend
 */
```

### Filters (top bar)
- Search input — client-side filter on `pto_number`
- Status select — ALL / DRAFT / APPROVED / ISSUED / IN_TRANSIT / CLOSED / CANCELLED
- Transfer type select — ALL / ONE_STEP / TWO_STEP

### Table columns
| Column | Field | Notes |
|---|---|---|
| PTO Number | `pto_number` | |
| Type | `transfer_type` | badge: ONE_STEP=sky, TWO_STEP=violet |
| Status | `status` | badge colour (see below) |
| Source Plant | `source_plant_id` | uuid display |
| Target Plant | `target_plant_id` | uuid display |
| Material | `material_id` | uuid display |
| Transfer Qty | `transfer_qty` | right-aligned, 3dp |
| UOM | `uom_code` | |
| Created | `created_at` | |

**Status badge colours:**
- DRAFT → amber
- APPROVED → sky
- ISSUED / IN_TRANSIT → violet
- CLOSED → emerald
- CANCELLED → rose

**Actions (top bar):**
- Refresh button
- "Create PTO" button → opens form modal OR navigate to a create route (use navigate approach — see below)

**Row click:** `openScreen(OPERATION_SCREENS.PROC_PLANT_TRANSFER_DETAIL.screen_code)` then `navigate("/dashboard/procurement/transfer/" + encodeURIComponent(row.id))`

**No create page needed** — implement create as an inline modal/form using `useState` on the list page directly (same pattern as other list pages that have inline forms). Show the create form as a section card above the list when `showCreate` state is true.

### Create form fields (inline section card, visible when "Create PTO" is clicked)
- Transfer Type: select ONE_STEP / TWO_STEP (required)
- Source Company ID: text input (required)
- Source Plant ID: text input (required)
- Source SLOC ID: text input (required)
- Target Company ID: text input (required)
- Target Plant ID: text input (required)
- Target SLOC ID: text input (required)
- Material ID: text input (required)
- Transfer Qty: number input (required)
- UOM Code: text input (required)
- Expected Dispatch Date: date input (optional)
- Expected Receipt Date: date input (optional)
- Transport Required: checkbox
- Vehicle Number: text (optional, shown if transport_required=true)
- Transporter Name: text (optional, shown if transport_required=true)
- LR Number: text (optional, shown if transport_required=true)
- Remarks: text input (optional)
- Submit button "Create PTO" + Cancel button

On submit: call `createPTO(formData)` → on success: reload list + navigate to new PTO detail

---

## Frontend — PlantTransferDetailPage.jsx

### File Header
```js
/*
 * File-ID: 23.5
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: View and action plant transfer order detail
 * Authority: Frontend
 */
```

### Imports
```js
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { approvePTO, getPTO, issueTransfer, oneStepTransfer, receiveTransfer, cancelPTO } from "../procurementApi.js";
```

### Status badge tone helper
```js
function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "APPROVED": return "sky";
    case "ISSUED":
    case "IN_TRANSIT": return "violet";
    case "CLOSED": return "emerald";
    case "CANCELLED": return "rose";
    case "DRAFT":
    default: return "amber";
  }
}
```

### Data loading
```js
const { id = "" } = useParams();
// loadDetail: fetches getPTO(id)
// state: detail, loading, saving, error, notice
```

### Action buttons — status-gated (rendered in `actions` prop of ErpScreenScaffold)

| Status | Transfer Type | Action Button | API call |
|---|---|---|---|
| DRAFT | any | "Approve" | `approvePTO(id)` |
| APPROVED | ONE_STEP | "Execute Transfer" | `oneStepTransfer(id)` |
| APPROVED | TWO_STEP | "Issue Stock" | `issueTransfer(id)` |
| IN_TRANSIT | TWO_STEP | "Receive Stock" | `receiveTransfer(id, { actual_receipt_date })` |
| DRAFT or APPROVED | any | "Cancel" | `cancelPTO(id, { cancellation_reason })` |
| CLOSED / CANCELLED | — | no action buttons | — |

Each action: `window.confirm` guard → API call → reload detail → show notice.

For "Receive Stock": show a simple `actual_receipt_date` input (date) using local state. Default = today.

For "Cancel": prompt for reason via `window.prompt("Cancellation reason:")` — use the entered value as `cancellation_reason`.

### Section cards

**Header section** — eyebrow "Header", title = `detail.pto_number`
Fields (grid 3-col md, 5-col xl):
- Status (with tone)
- Transfer Type (badge: ONE_STEP=sky, TWO_STEP=violet)
- Source Plant ID
- Target Plant ID
- Material ID
- Transfer Qty + UOM
- Valuation Rate (show "—" if null)
- Transfer Value (show "—" if null)
- Transfer Price Type

**Source & Target section** — eyebrow "Locations", title "Source and target details"
Fields in 2-col grid:
- Source Company ID
- Source Plant ID
- Source SLOC ID
- Source GSTIN (show "—" if null)
- Target Company ID
- Target Plant ID
- Target SLOC ID
- Target GSTIN (show "—" if null)

**Transport section** — eyebrow "Transport", title "Transport and logistics"
Fields:
- Transport Required
- Vehicle Number
- Transporter Name
- LR Number
- Expected Dispatch Date
- Expected Receipt Date
- E-way Bill Reference (show "—" if null)

**Lifecycle section** — eyebrow "Lifecycle", title "Transfer milestones"
Fields:
- Approved At
- Issued At
- Received At
- Actual Receipt Date

**Remarks section** — eyebrow "Remarks", title "Notes"
- Div with `detail.remarks || "—"`

### Back navigation
```js
function goBack() {
  openScreen(OPERATION_SCREENS.PROC_PLANT_TRANSFER_LIST.screen_code);
  navigate("/dashboard/procurement/transfer");
}
```

---

## Critical Rules

1. **`serviceRoleClient` for all DB queries** — same as every other handler
2. **`post_stock_movement` engine only accepts `direction: 'IN' | 'OUT'`** — never pass `'TRANSFER'`. Always call twice (OUT at source, IN at target)
3. **Valuation rate locked at issue time** — `receiveTransferHandler` uses `pto.valuation_rate` stored at issue, NOT a fresh snapshot lookup
4. **IN_TRANSIT tracking**: `issueTransferHandler` posts TWO calls — OUT UNRESTRICTED at source + IN IN_TRANSIT at source. `receiveTransferHandler` posts OUT IN_TRANSIT at source + IN UNRESTRICTED at target. Both use source_sloc_id for the IN_TRANSIT postings (IN_TRANSIT is held logically at source).
5. **SLOC transfer** — same plant, different sloc, same company. Source sloc ≠ target sloc guard is mandatory.
6. **P301/P302 movement types in seed** — `direction='TRANSFER'` in movement_type_master is just metadata. The posting engine is called with `'IN'` or `'OUT'` explicitly by the handler.
7. **`openScreen()` before `navigate()`** — mandatory on all FE navigation calls
8. **No row-click navigation on PlantTransferListPage needed for SLOC transfer** — SLOC transfer is a separate endpoint (`POST /api/procurement/sloc-transfer`), not a document. No list/detail page for SLOC transfer in Gate-23.
9. **Number series doc type is `"PT"`** — `generateProcurementDocNumber("PT")` for both PTO and SLOC transfer reference numbers

---

## After Implementation

Update `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
Set Gate-23 items 23.1–23.8 → DONE with filenames.
