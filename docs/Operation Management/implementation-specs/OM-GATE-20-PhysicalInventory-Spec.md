# OM-GATE-20 — Physical Inventory Document (PID)

**Spec Status:** FINAL
**Gate:** 20
**Domain:** PROCUREMENT / INVENTORY
**Dependency:** Gate-19 VERIFIED ✅
**Date:** 2026-05-12

---

## Overview

SAP-style Physical Inventory (MI cycle) for RM, PM, and Intermediate materials.
HO creates a PI document per plant+storage_location, plant-level users enter physical counts,
HO posts differences to the stock ledger.

**Scope:** RM, PM, Intermediate only. FG (Admix, Powder) — deferred pending FG design.

**Status flow:** `OPEN → COUNTED → POSTED`
- OPEN: document created, items loaded, counting in progress
- COUNTED: every item has physical_qty entered (auto-transitions when last item counted)
- POSTED: all differences posted to stock ledger

**Posting Block:** Creating a PI document sets a block on every material+plant+sloc in the document.
All movement-generating handlers (GRN post, STO dispatch, SO issue, RTV post) must reject if a block exists.
Block is released per-item when that item is posted.

---

## Gate-20.1 — DB Migrations

### Migration 20.1.1 — Seed PI Movement Types

**File:** `20260512210000_gate20_20_1_1_seed_pi_movement_types.sql`

```sql
BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, description, direction, source_stock_type, target_stock_type,
   requires_approval, document_category, reversal_of, reversal_code,
   role_restricted, sa_only, qa_only, active)
VALUES
  -- Surplus IN
  ('P701', 'PI Surplus — Unrestricted',         'IN',  NULL,                 'UNRESTRICTED',       false, 'PHYSICAL_INVENTORY', NULL,   'P711', false, false, false, true),
  ('P703', 'PI Surplus — Quality Inspection',   'IN',  NULL,                 'QUALITY_INSPECTION', false, 'PHYSICAL_INVENTORY', NULL,   'P713', false, false, false, true),
  ('P705', 'PI Surplus — Blocked',              'IN',  NULL,                 'BLOCKED',            false, 'PHYSICAL_INVENTORY', NULL,   'P715', false, false, false, true),
  -- Deficit OUT
  ('P702', 'PI Deficit — Unrestricted',         'OUT', 'UNRESTRICTED',       NULL,                 false, 'PHYSICAL_INVENTORY', NULL,   'P712', false, false, false, true),
  ('P704', 'PI Deficit — Quality Inspection',   'OUT', 'QUALITY_INSPECTION', NULL,                 false, 'PHYSICAL_INVENTORY', NULL,   'P714', false, false, false, true),
  ('P706', 'PI Deficit — Blocked',              'OUT', 'BLOCKED',            NULL,                 false, 'PHYSICAL_INVENTORY', NULL,   'P716', false, false, false, true),
  -- Reversals
  ('P711', 'P701 Reversal', 'OUT', 'UNRESTRICTED',       NULL,                 false, 'PHYSICAL_INVENTORY', 'P701', NULL, false, false, false, true),
  ('P712', 'P702 Reversal', 'IN',  NULL,                 'UNRESTRICTED',       false, 'PHYSICAL_INVENTORY', 'P702', NULL, false, false, false, true),
  ('P713', 'P703 Reversal', 'OUT', 'QUALITY_INSPECTION', NULL,                 false, 'PHYSICAL_INVENTORY', 'P703', NULL, false, false, false, true),
  ('P714', 'P704 Reversal', 'IN',  NULL,                 'QUALITY_INSPECTION', false, 'PHYSICAL_INVENTORY', 'P704', NULL, false, false, false, true),
  ('P715', 'P705 Reversal', 'OUT', 'BLOCKED',            NULL,                 false, 'PHYSICAL_INVENTORY', 'P705', NULL, false, false, false, true),
  ('P716', 'P706 Reversal', 'IN',  NULL,                 'BLOCKED',            false, 'PHYSICAL_INVENTORY', 'P706', NULL, false, false, false, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
```

---

### Migration 20.1.2 — PI Tables + Posting Block + Document Series

**File:** `20260512210100_gate20_20_1_2_create_pi_tables.sql`

```sql
BEGIN;

-- Physical Inventory Document (header)
CREATE TABLE IF NOT EXISTS erp_procurement.physical_inventory_document (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number       text NOT NULL UNIQUE,
  plant_id              uuid NOT NULL,
  storage_location_id   uuid NOT NULL,
  count_date            date NOT NULL,
  posting_date          date NOT NULL,
  mode                  text NOT NULL CHECK (mode IN ('LOCATION_WISE', 'ITEM_WISE')),
  status                text NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN', 'COUNTED', 'POSTED')),
  notes                 text NULL,
  created_by            uuid NOT NULL,
  posted_by             uuid NULL,
  posted_at             timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_procurement.physical_inventory_document IS
'Physical inventory count document per plant+storage_location. SAP MI01 equivalent.';

-- Physical Inventory Item (one row per material+stock_type in the count)
CREATE TABLE IF NOT EXISTS erp_procurement.physical_inventory_item (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id               uuid NOT NULL
    REFERENCES erp_procurement.physical_inventory_document(id) ON DELETE RESTRICT,
  line_number               int NOT NULL,
  material_id               uuid NOT NULL,
  stock_type                text NOT NULL
                              CHECK (stock_type IN ('UNRESTRICTED', 'QUALITY_INSPECTION', 'BLOCKED')),
  book_qty                  numeric(18,4) NOT NULL,           -- snapshot at document creation
  base_uom_code             text NOT NULL,                    -- snapshot at document creation
  physical_qty              numeric(18,4) NULL,               -- entered by plant user; NULL = not yet counted
  difference_qty            numeric(18,4) GENERATED ALWAYS AS (physical_qty - book_qty) STORED,
  is_recount_requested      boolean NOT NULL DEFAULT false,
  posted_stock_document_id  uuid NULL,                        -- set after post_stock_movement; NULL for zero-diff items = not yet posted
  counted_by                uuid NULL,
  counted_at                timestamptz NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),

  UNIQUE (document_id, material_id, stock_type)               -- one row per material+stock_type per document
);

COMMENT ON TABLE erp_procurement.physical_inventory_item IS
'Line items for physical inventory document. SAP MI04 count entry target.';

-- Posting Block (erp_inventory schema — inventory control layer)
CREATE TABLE IF NOT EXISTS erp_inventory.physical_inventory_block (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id           uuid NOT NULL,
  plant_id              uuid NOT NULL,
  storage_location_id   uuid NOT NULL,
  pi_document_id        uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (material_id, plant_id, storage_location_id)         -- one active block per material+plant+sloc
);

COMMENT ON TABLE erp_inventory.physical_inventory_block IS
'Posting block set on material+plant+sloc when a PI item is active. Cleared per-item on post.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pid_plant_status
  ON erp_procurement.physical_inventory_document (plant_id, status);

CREATE INDEX IF NOT EXISTS idx_pii_document_id
  ON erp_procurement.physical_inventory_item (document_id);

CREATE INDEX IF NOT EXISTS idx_pii_material
  ON erp_procurement.physical_inventory_item (material_id);

CREATE INDEX IF NOT EXISTS idx_pib_material_plant_sloc
  ON erp_inventory.physical_inventory_block (material_id, plant_id, storage_location_id);

-- Grants
GRANT ALL ON erp_procurement.physical_inventory_document TO service_role;
GRANT ALL ON erp_procurement.physical_inventory_item     TO service_role;
GRANT ALL ON erp_inventory.physical_inventory_block       TO service_role;

-- Add PI to global document number series
INSERT INTO erp_procurement.document_number_series (doc_type, pad_width, starting_number)
VALUES ('PI', 6, 1)
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
```

---

## Gate-20.2 — Backend

### File: `supabase/functions/api/_core/procurement/physical_inventory.handlers.ts`

#### Movement type derivation (internal helper):
```ts
function derivePIMovementType(stockType: string, difference: number): string {
  const isSurplus = difference > 0;
  switch (stockType.toUpperCase()) {
    case "QUALITY_INSPECTION": return isSurplus ? "P703" : "P704";
    case "BLOCKED":            return isSurplus ? "P705" : "P706";
    default:                   return isSurplus ? "P701" : "P702"; // UNRESTRICTED
  }
}
```

#### Book qty query (internal helper):
Query `erp_inventory.stock_ledger` to get current balance for a given material+plant+storage_location+stock_type:
```ts
// Sum IN movements minus OUT movements from stock_ledger
// GROUP BY material_id, plant_id, storage_location_id, stock_type_code
// WHERE balance > 0
```
Use the same stock_ledger query pattern already established in existing GRN/STO handlers.

#### Item "fully processed" definition (used internally):
An item is considered fully processed when:
- `physical_qty IS NOT NULL` AND (`difference_qty = 0` OR `posted_stock_document_id IS NOT NULL`)

Document is POSTED when ALL items are fully processed.

---

### Handlers:

| Handler | Method + Path | Description |
|---------|--------------|-------------|
| `createPIDHandler` | `POST /api/procurement/physical-inventory` | Create PI document. LOCATION_WISE: auto-load all material+stock_type with balance > 0 in plant+sloc. ITEM_WISE: items from request body `[{material_id, stock_type}]`. For each item: check no active block (409 if conflict). Snapshot book_qty + base_uom_code. Insert items. Set posting blocks. |
| `listPIDsHandler` | `GET /api/procurement/physical-inventory` | List documents. Filter: plant_id, status. Include item_count + counted_count per document. |
| `getPIDHandler` | `GET /api/procurement/physical-inventory/:id` | Detail with all items. |
| `addPIItemHandler` | `POST /api/procurement/physical-inventory/:id/items` | Add item to OPEN document (ITEM_WISE mode or physically-found-but-not-in-system case). Check conflict. Snapshot book_qty (may be 0 if not in stock). Set posting block. |
| `enterCountHandler` | `PUT /api/procurement/physical-inventory/:id/items/:itemId/count` | Plant user enters physical_qty (>= 0). Sets counted_by, counted_at, is_recount_requested = false. After update: if ALL items in document have physical_qty IS NOT NULL → auto-set document status = COUNTED. Document must be OPEN or COUNTED. |
| `requestRecountHandler` | `POST /api/procurement/physical-inventory/:id/items/:itemId/recount` | Clear physical_qty, counted_by, counted_at. Set is_recount_requested = true. If document was COUNTED → set back to OPEN. |
| `postDifferencesHandler` | `POST /api/procurement/physical-inventory/:id/post` | Document must be OPEN or COUNTED (not POSTED). For each item where physical_qty IS NOT NULL AND not yet fully processed: if difference_qty != 0 → call post_stock_movement; if difference_qty = 0 → mark as done (no movement needed, just release block). Release posting block for each processed item. After all: if ALL items fully processed → set status = POSTED, posted_by, posted_at. Partial posting is allowed — document stays OPEN/COUNTED if some items still unprocessed. |

#### postDifferencesHandler — post_stock_movement call per item (difference ≠ 0):
```ts
await serviceRoleClient.schema("erp_inventory").rpc("post_stock_movement", {
  p_document_number:     document.document_number,
  p_document_date:       document.count_date,
  p_posting_date:        document.posting_date,      // ← backdated posting supported
  p_movement_type_code:  derivePIMovementType(item.stock_type, Number(item.difference_qty)),
  p_company_id:          storageLocation.company_id, // resolved from storage_location_id
  p_plant_id:            document.plant_id,
  p_storage_location_id: document.storage_location_id,
  p_material_id:         item.material_id,
  p_quantity:            Math.abs(Number(item.difference_qty)),
  p_base_uom_code:       item.base_uom_code,
  p_unit_value:          0,                          // PI differences carry no valuation in Phase 1
  p_stock_type_code:     item.stock_type,
  p_direction:           Number(item.difference_qty) > 0 ? "IN" : "OUT",
  p_posted_by:           ctx.auth_user_id,
  p_reversal_of_id:      null,
});
```

#### Posting block check helper (used in existing handlers):
```ts
// Check before any stock movement in GRN / STO / SO / RTV handlers:
async function checkPostingBlock(
  materialId: string,
  plantId: string,
  storageLocationId: string
): Promise<boolean> {
  const { data } = await serviceRoleClient
    .schema("erp_inventory")
    .from("physical_inventory_block")
    .select("id")
    .eq("material_id", materialId)
    .eq("plant_id", plantId)
    .eq("storage_location_id", storageLocationId)
    .maybeSingle();
  return !!data?.id;
}
```

---

### Files to modify (posting block check):

#### `grn.handlers.ts` — `postGRNHandler`
Before calling `post_stock_movement` for each GRN line, check posting block using material_id + plant_id + storage_location_id from the line. If blocked → return 409 `MATERIAL_POSTING_BLOCKED`.

#### `sto.handlers.ts` — `dispatchSTOHandler`
Before dispatching stock out, check posting block for each STO line material. If blocked → 409 `MATERIAL_POSTING_BLOCKED`.

#### `sales_order.handlers.ts` — `issueSOStockHandler`
Before issuing stock for each SO line, check posting block. If blocked → 409 `MATERIAL_POSTING_BLOCKED`.

#### `rtv.handlers.ts` — `postRTVHandler`
Before posting RTV movements, check posting block for each line. If blocked → 409 `MATERIAL_POSTING_BLOCKED`.

---

### Routes to add in `procurement.routes.ts`:
```
POST   /api/procurement/physical-inventory
GET    /api/procurement/physical-inventory
GET    /api/procurement/physical-inventory/:id
POST   /api/procurement/physical-inventory/:id/items
PUT    /api/procurement/physical-inventory/:id/items/:itemId/count
POST   /api/procurement/physical-inventory/:id/items/:itemId/recount
POST   /api/procurement/physical-inventory/:id/post
```

---

## Gate-20.3 — Frontend

### API functions to add in `procurementApi.js`:
```js
export function listPIDocuments(params) {
  return fetchProcurement("GET", "/api/procurement/physical-inventory", undefined, params);
}
export function createPIDocument(data) {
  return fetchProcurement("POST", "/api/procurement/physical-inventory", data);
}
export function getPIDocument(id) {
  return fetchProcurement("GET", `/api/procurement/physical-inventory/${encodeURIComponent(id)}`);
}
export function addPIItem(id, data) {
  return fetchProcurement("POST", `/api/procurement/physical-inventory/${encodeURIComponent(id)}/items`, data);
}
export function enterPICount(id, itemId, data) {
  return fetchProcurement("PUT", `/api/procurement/physical-inventory/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/count`, data);
}
export function requestPIRecount(id, itemId) {
  return fetchProcurement("POST", `/api/procurement/physical-inventory/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/recount`);
}
export function postPIDifferences(id) {
  return fetchProcurement("POST", `/api/procurement/physical-inventory/${encodeURIComponent(id)}/post`);
}
```

### Screen codes to add in `operationScreens.js`:
```js
PROC_PI_LIST: {
  screen_code: "PROC_PI_LIST",
  route: "/procurement/physical-inventory",
  ...
},
PROC_PI_DETAIL: {
  screen_code: "PROC_PI_DETAIL",
  route: "/procurement/physical-inventory/:id",
  ...
},
```

### Files:
- `frontend/src/pages/dashboard/procurement/inventory/PIDocumentListPage.jsx`
- `frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx`

---

### PIDocumentListPage.jsx

```
eyebrow: "Procurement"
title: "Physical Inventory"

Filters: plant_id dropdown, status dropdown

Grid columns:
  Document # | Plant | Storage Location | Count Date | Posting Date | Mode | Items | Counted | Status | Action
  PI-000001  | PLANT-01 | WH-A | 31/03/2026 | 31/03/2026 | LOCATION_WISE | 45 | 45/45 | COUNTED | [Open]

Create form (side panel):
  Plant:            [dropdown]
  Storage Location: [dropdown — filtered by plant]
  Mode:             [LOCATION_WISE / ITEM_WISE toggle]
  Count Date:       [date — default today]
  Posting Date:     [date — default = count_date, editable for backdated posting]
  Notes:            [textarea]
  [Create Document button]
```

### PIDocumentDetailPage.jsx

**Header:**
```
Document # | Plant | Storage Location | Count Date | Posting Date | Mode | Status badge | Notes
```

**Status action buttons (conditional):**
- Status = OPEN or COUNTED → [Post Differences] button (posts all currently-counted items)
  - Confirm dialog: "This will post stock differences to the inventory ledger. Cannot be undone."
- Status = POSTED → read-only, show posted_at

**Progress summary:**
```
Items: 45 | Counted: 43/45 | Pending: 2 | Zero Diff: 12 | Surplus: 18 | Deficit: 13
```

**Items grid:**
```
Line # | Material | Stock Type | Book Qty | Physical Qty | Difference | UoM | Status | Action
1      | Calcium Carbonate (RM-001) | UNRESTRICTED | 5000.0000 | 4980.0000 | -20.0000 | KG | COUNTED | [Recount]
2      | Packing Box (PM-014)       | UNRESTRICTED | 200.0000  | [__input__] | —       | EA | OPEN    | —
```

- Physical Qty column: if not yet counted → inline number input (Enter to save). If counted → show value (click to re-enter, or use Recount button).
- Difference column: auto-calculated = physical_qty − book_qty (shown in real time from input). Red if negative, green if positive, grey if zero.
- Recount button: only on counted items — clears count, sets is_recount_requested.
- Posted items: show posted_stock_document_id (truncated), no edit allowed.

**Add Item section (OPEN document only — for ITEM_WISE or add-missing-material):**
```
Material: [combobox]
Stock Type: [dropdown: UNRESTRICTED / QUALITY_INSPECTION / BLOCKED]
[Add Item button]
```

---

## Status Badge Tones
- OPEN → slate
- COUNTED → amber
- POSTED → emerald

## Item Row Tones
- Uncounted (physical_qty NULL) → default
- Zero difference → slate
- Surplus (difference > 0) → emerald
- Deficit (difference < 0) → rose

---

## Critical Points

- `difference_qty GENERATED ALWAYS AS (physical_qty - book_qty)` — NULL when physical_qty not entered
- `book_qty` is a **frozen snapshot** at PI document creation — does not change even if stock moves (for other materials not under block)
- `posting_date` is independent of `count_date` — enables year-end backdated posting (e.g., count on 1 Apr, post to 31 Mar)
- **Posting Block** is at `erp_inventory.physical_inventory_block`. All four handlers (GRN post, STO dispatch, SO issue, RTV post) must check this before any stock movement. Error code: `MATERIAL_POSTING_BLOCKED`.
- Block released per-item on post, not for the whole document at once
- **Partial posting** — postDifferencesHandler processes all currently-counted unposted items; document status only becomes POSTED when ALL items fully processed
- **Conflict check** on create/addItem — UNIQUE constraint on `physical_inventory_block` (material+plant+sloc) enforces this at DB level; handler should give a clean 409 error
- Auto-transition to COUNTED: after every `enterCountHandler` call, check `COUNT(*) WHERE physical_qty IS NULL = 0` for the document — if zero, set status = COUNTED
- **Zero-difference items**: no post_stock_movement call needed; block is released immediately when postDifferences runs
- **company_id for post_stock_movement**: resolve from `erp_master.storage_location_master` using `storage_location_id`
- `p_unit_value = 0` for PI differences in Phase 1 (no financial valuation)

---

## Verification Checklist

- [ ] 12 PI movement types seeded (P701–P706 + P711–P716)
- [ ] `physical_inventory_document` table — all columns, status check constraint
- [ ] `physical_inventory_item` — `difference_qty` GENERATED ALWAYS AS, UNIQUE(document_id, material_id, stock_type)
- [ ] `erp_inventory.physical_inventory_block` — UNIQUE(material_id, plant_id, storage_location_id)
- [ ] 'PI' seeded in document_number_series
- [ ] 7 handlers implemented
- [ ] LOCATION_WISE create: auto-loads stock > 0 from stock_ledger grouped by material+stock_type
- [ ] ITEM_WISE create: loads from request body, book_qty snapshotted
- [ ] Posting blocks set on create / addItem
- [ ] Auto-COUNTED transition after last item counted
- [ ] Partial posting works — document stays OPEN if items still uncounted
- [ ] Zero-diff items: block released, no post_stock_movement call
- [ ] postDifferencesHandler uses `posting_date` (not count_date) for p_posting_date
- [ ] 4 existing handlers modified with posting block check (GRN, STO, SO, RTV)
- [ ] 7 routes wired in procurement.routes.ts
- [ ] 7 procurementApi.js functions
- [ ] PIDocumentListPage — create form with backdated posting_date support
- [ ] PIDocumentDetailPage — inline count entry, recount button, progress summary, post confirm dialog
- [ ] openScreen() before every navigate() in both FE pages
- [ ] Screen codes added in operationScreens.js
- [ ] Routes wired in AppRouter.jsx
