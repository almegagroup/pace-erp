# CODEX-GATE22-TASK-BRIEF — Procurement Planning View

**Gate:** 22
**Domain:** PROCUREMENT
**Authority:** Backend + Frontend
**Dependency:** Gate-21 VERIFIED ✅

---

## Overview

Gate-22 builds a read-only cross-plant procurement planning view. It answers:
**"What do I need to buy, for which plant, and how much?"**

One new BE handler, one new route, one new FE page. No DB migrations.

---

## Files to Create

**BE (create):**
- `supabase/functions/api/_core/procurement/planning.handlers.ts`

**FE (create):**
- `frontend/src/pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx`

## Files to Modify

**BE (modify):**
- `supabase/functions/api/_routes/procurement.routes.ts` — add 1 route

**FE (modify):**
- `frontend/src/pages/dashboard/procurement/procurementApi.js` — add `getProcurementPlanning(params)`
- `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` — add `PROC_PLANNING_VIEW`
- `frontend/src/router/AppRouter.jsx` — import + 1 route

---

## Backend — planning.handlers.ts

### File Header
```ts
/*
 * File-ID: 22.1
 * File-Path: supabase/functions/api/_core/procurement/planning.handlers.ts
 * Gate: 22
 * Phase: 22
 * Domain: PROCUREMENT
 * Purpose: Cross-plant procurement planning view — aggregates stock snapshot, open POs, in-transit CSNs, and safety stock.
 * Authority: Backend
 */
```

### Handler: `getProcurementPlanningHandler`

**Route:** `GET /api/procurement/planning`

**Query params:**
| Param | Type | Description |
|---|---|---|
| `company_id` | uuid (optional) | scoped to company, or take from ctx scope |
| `plant_id` | uuid (optional) | filter to one plant |
| `material_id` | uuid (optional) | filter to one material |
| `shortage_only` | `"true"` (optional) | only return rows where net_available < 0 |
| `limit` | int (default 200) | max rows |

**Algorithm — run 5 queries in parallel, combine in memory:**

#### Query 1 — Stock Snapshot (current stock by material+plant)
```sql
SELECT company_id, plant_id, material_id, stock_type_code, SUM(quantity) AS qty
FROM erp_inventory.stock_snapshot
WHERE company_id = $companyId   -- if scoped
GROUP BY company_id, plant_id, material_id, stock_type_code
```
From this, build per (company_id, plant_id, material_id):
- `unrestricted_qty` = sum where stock_type_code = 'UNRESTRICTED'
- `qa_qty` = sum where stock_type_code = 'QUALITY_INSPECTION'
- `blocked_qty` = sum where stock_type_code = 'BLOCKED' (for info only, not in formula)

#### Query 2 — Open PO Quantities
```sql
SELECT pol.material_id, po.plant_id, po.company_id,
       SUM(pol.open_qty) AS open_po_qty
FROM erp_procurement.purchase_order_line pol
JOIN erp_procurement.purchase_order po ON pol.po_id = po.id
WHERE po.status IN ('APPROVED', 'CONFIRMED')
  AND pol.line_status IN ('OPEN', 'PARTIALLY_RECEIVED')
  AND po.company_id = $companyId  -- if scoped
GROUP BY pol.material_id, po.plant_id, po.company_id
```
Only POs with `plant_id IS NOT NULL` contribute to plant-level planning.
If `po.plant_id IS NULL` → skip (cross-company PO, not plant-specific).

#### Query 3 — In-Transit Quantities (CSNs)
```sql
SELECT csn.material_id, po.plant_id, po.company_id,
       SUM(csn.dispatch_qty) AS in_transit_qty
FROM erp_procurement.consignment_note csn
JOIN erp_procurement.purchase_order po ON csn.po_id = po.id
WHERE csn.status = 'IN_TRANSIT'
  AND po.company_id = $companyId  -- if scoped
GROUP BY csn.material_id, po.plant_id, po.company_id
```

#### Query 4 — Safety Stock
```sql
SELECT material_id, plant_id, company_id,
       safety_stock_qty, reorder_point_qty, min_order_qty, lead_time_days
FROM erp_master.material_plant_ext
WHERE company_id = $companyId  -- if scoped
  AND status = 'ACTIVE'
```

#### Query 5 — Last GR Date
```sql
SELECT material_id, plant_id,
       MAX(posting_date) AS last_gr_date
FROM erp_inventory.stock_ledger
WHERE direction = 'IN'
  AND movement_type_code IN ('P101', 'P103', 'P561', 'P563', 'P565')
GROUP BY material_id, plant_id
```
(P101/P103 = GRN receipts, P561/P563/P565 = opening stock postings)

#### Query 6 — Material Master (code + name + uom)
```sql
SELECT id, material_code, material_name, base_uom_code
FROM erp_master.material_master
WHERE id = ANY($materialIds)
```
Build a Map<material_id → {code, name, uom}> from this.

---

### Combine in Memory

Collect all unique (company_id, plant_id, material_id) keys from queries 1–4.

For each key, build one row:
```ts
const unrestricted = snapshotMap.get(key)?.UNRESTRICTED ?? 0;
const qa = snapshotMap.get(key)?.QUALITY_INSPECTION ?? 0;
const openPo = poMap.get(key) ?? 0;
const inTransit = csnMap.get(key) ?? 0;
const safetyStock = safetyMap.get(key)?.safety_stock_qty ?? 0;

const netAvailable = unrestricted + qa + openPo + inTransit - safetyStock;
// Reserved / scheduled dispatch / planned production req = 0 (not built yet)

const suggestedPrQty = netAvailable < 0 ? Math.abs(netAvailable) : 0;
```

Apply filters:
- `plant_id` filter — if provided, only rows where plant_id matches
- `material_id` filter — if provided, only rows where material_id matches
- `shortage_only` — if `"true"`, only rows where netAvailable < 0

Sort by `net_available ASC` (shortages at top).

Apply `limit`.

---

### Response Shape
```json
{
  "items": [
    {
      "material_id": "uuid",
      "material_code": "RM001",
      "material_name": "Raw Material A",
      "base_uom_code": "KG",
      "plant_id": "uuid",
      "company_id": "uuid",
      "unrestricted_qty": 100.000000,
      "qa_qty": 20.000000,
      "blocked_qty": 0.000000,
      "open_po_qty": 50.000000,
      "in_transit_qty": 30.000000,
      "reserved_qty": 0,
      "scheduled_dispatch_qty": 0,
      "planned_production_req_qty": 0,
      "safety_stock_qty": 25.000000,
      "net_available": 175.000000,
      "last_gr_date": "2026-05-01",
      "suggested_pr_qty": 0,
      "reorder_point_qty": 50.000000,
      "min_order_qty": 100.000000,
      "lead_time_days": 30
    }
  ],
  "total": 42
}
```

---

### Route — procurement.routes.ts
```ts
// GET /api/procurement/planning
if (method === "GET" && path === "/api/procurement/planning") {
  return getProcurementPlanningHandler(req, ctx);
}
```
Import: `import { getProcurementPlanningHandler } from "../_core/procurement/planning.handlers.ts";`

---

## Frontend — ProcurementPlanningPage.jsx

### File Header
```js
/*
 * File-ID: 22.2
 * File-Path: frontend/src/pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx
 * Gate: 22
 * Phase: 22
 * Domain: PROCUREMENT
 * Purpose: Cross-plant procurement planning view — shortage identification
 * Authority: Frontend
 */
```

### API function — procurementApi.js
Add one function:
```js
export function getProcurementPlanning(params) {
  return fetchProcurement("GET", "/api/procurement/planning", undefined, params);
}
```

### Screen code — operationScreens.js
```js
PROC_PLANNING_VIEW: {
  screen_code: "PROC_PLANNING_VIEW",
  route: "/dashboard/procurement/planning",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},
```
Insert after `PROC_BLOCKED_IV_LIST`.

### AppRouter.jsx
Import:
```jsx
import ProcurementPlanningPage from "../pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx";
```
Route (after `procurement/accounts/blocked-ivs`):
```jsx
<Route
  path="procurement/planning"
  element={<ProcurementPlanningPage />}
/>
```

### Page Design

**Filters (top bar):**
- Material search (text input — filters by material_code or material_name client-side)
- Plant filter (select — populated from unique plant_ids in the data)
- Shortage Only toggle (checkbox/button) — if ON, re-fetches with `shortage_only=true` param

**Table columns:**
| Column | Field | Notes |
|---|---|---|
| Material | `material_code` + `material_name` | two-line cell |
| UOM | `base_uom_code` | |
| Unrestricted | `unrestricted_qty` | right-aligned, 3dp |
| QA | `qa_qty` | right-aligned, 3dp |
| Open PO | `open_po_qty` | right-aligned, 3dp |
| In-Transit | `in_transit_qty` | right-aligned, 3dp |
| Safety Stock | `safety_stock_qty` | right-aligned, 3dp |
| **Net Available** | `net_available` | right-aligned, **bold**, colour-coded |
| Suggested PR | `suggested_pr_qty` | right-aligned, 3dp — show "—" if 0 |
| Last GR Date | `last_gr_date` | show "—" if null |

**Row colour coding (background):**
- `net_available < 0` → `bg-rose-50` (shortage — needs attention)
- `net_available === 0` → `bg-amber-50` (borderline)
- `net_available > 0` → default (white/slate-50)

**Net Available cell text colour:**
- `< 0` → `text-rose-700 font-bold`
- `=== 0` → `text-amber-700 font-semibold`
- `> 0` → `text-emerald-700 font-semibold`

**Header summary strip (above table):**
Show 3 chips:
- Total materials shown: N
- Shortage count: X (rose badge)
- Borderline (= 0): Y (amber badge)

**Actions:**
- Refresh button (re-fetches)
- No create/edit — read-only page

**Loading + error states required.**

**No `openScreen` / navigate calls needed** — this is a terminal page, no row click navigation.

---

## Critical Rules

1. `planning.handlers.ts` — use `serviceRoleClient` for all DB queries (same as all other handlers)
2. Queries 1–5 should run in **parallel** (`Promise.all([...])`) — do not run sequentially
3. Material master query (Query 6) runs AFTER queries 1–4, using the collected materialIds as an `ANY($array)` filter
4. If `stock_snapshot` has no rows for a material+plant combination (zero stock), but that combination has open PO or in-transit → still include the row with unrestricted_qty=0, qa_qty=0
5. All numeric fields in response: use `Number(value.toFixed(6))` — 6 decimal places
6. `net_available` formula: `unrestricted + qa + openPo + inTransit - safetyStock` — reserved/dispatch/production = 0 for now
7. `openScreen()` before `navigate()` rule does not apply here — this page has no row-click navigation

---

## After Implementation

Update `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
Set Gate-22 items 22.1–22.5 → DONE with filenames.
