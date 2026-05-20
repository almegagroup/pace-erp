# CODEX-GATE24-TASK-BRIEF

**Gate:** 24
**Domain:** PROCUREMENT / INVENTORY
**Title:** Core Stock Reports
**Dependency:** Gate-23 VERIFIED
**Scope:** Three read-only report endpoints + three FE pages: Stock Ledger (movement history), Current Stock (MMBE-style snapshot grid), Stock Valuation (aggregated value by material+plant).

---

## Files to Create

| File-ID | Path | Type |
|---|---|---|
| 24.1 | `supabase/functions/api/_core/procurement/stock_reports.handlers.ts` | Backend — 3 handlers |
| 24.2 | `frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx` | FE page |
| 24.3 | `frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx` | FE page |
| 24.4 | `frontend/src/pages/dashboard/procurement/reports/StockValuationPage.jsx` | FE page |

## Files to Modify

| File | What to Add |
|---|---|
| `supabase/functions/api/_routes/procurement.routes.ts` | Import 3 handlers; add 3 switch-case routes |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | Add 3 API functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | Add 3 screen entries after `PROC_PLANT_TRANSFER_DETAIL` |
| `frontend/src/router/AppRouter.jsx` | Import 3 pages; add 3 routes after `procurement/transfer/:id` |

---

## Critical Rules — Read Before Writing Any Code

1. **serviceRoleClient only** — all DB queries use `serviceRoleClient` from `../../_shared/serviceRoleClient.ts`.
2. **Response helpers** — always `okResponse(payload)` / `errorResponse(code, 400)` from `../response.ts`.
3. **Schema** — `stock_ledger` and `stock_snapshot` are in schema `erp_inventory`. Use `.schema("erp_inventory")` or the table name with schema prefix as the codebase does it (check existing handlers for the exact pattern).
4. **Read-only** — all 3 handlers are GET with no DB mutations.
5. **No openScreen navigation in FE** — these are standalone report pages with no row-click navigation to a detail page.
6. **File-ID header** — every new file must start with the standard comment block (File-ID, File-Path, Gate, Phase, Domain, Purpose, Authority).
7. **procurementApi.js** — add new functions at the end of the file (after `postPIDifferences`).
8. **operationScreens.js** — insert after `PROC_PLANT_TRANSFER_DETAIL` entry.
9. **AppRouter.jsx** — insert imports with the other procurement imports block; insert routes after `procurement/transfer/:id`.

---

## 24.1 — Backend: `stock_reports.handlers.ts`

### Shared types / imports

```typescript
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type StockReportHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
```

---

### Handler 1: `getStockLedgerReportHandler`

**Route:** `GET /api/procurement/stock-ledger`

**Query params:**
- `material_id` (UUID string) — **required**; return 400 with code `STOCK_LEDGER_MATERIAL_REQUIRED` if missing/blank
- `plant_id` (UUID string) — optional filter
- `company_id` (UUID string) — optional filter
- `date_from` (ISO date string `YYYY-MM-DD`) — optional; applied as `posting_date >= date_from`
- `date_to` (ISO date string `YYYY-MM-DD`) — optional; applied as `posting_date <= date_to`
- `limit` (integer, default 200, max 500)
- `offset` (integer, default 0)

**DB query** (table `erp_inventory.stock_ledger`):
- `.select("*", { count: "exact" })` — select all columns
- `.eq("material_id", material_id)` — always applied
- `.eq("plant_id", plant_id)` — only if plant_id provided
- `.eq("company_id", company_id)` — only if company_id provided
- `.gte("posting_date", date_from)` — only if date_from provided
- `.lte("posting_date", date_to)` — only if date_to provided
- `.order("ledger_seq", { ascending: true })`
- `.range(offset, offset + limit - 1)`

**Signed quantity computation** (done in handler before returning):
For each row add a `signed_qty` field:
```typescript
signed_qty = row.direction === "IN" ? Number(row.quantity) : -Number(row.quantity)
```
This is a convenience field. The FE uses it to compute running balance by accumulating `signed_qty` in order.

**Response shape:**
```json
{ "ok": true, "data": { "data": [...rowsWithSignedQty], "total": 1234, "offset": 0, "limit": 200 } }
```

---

### Handler 2: `getCurrentStockHandler`

**Route:** `GET /api/procurement/current-stock`

**Query params (all optional):**
- `plant_id` — filter
- `company_id` — filter
- `material_id` — filter
- `stock_type_code` — filter (e.g. `UNRESTRICTED`, `QA`, `BLOCKED`, `IN_TRANSIT`)
- `show_zero` — boolean string `"true"`/`"false"`, default `"false"`

**DB query** (table `erp_inventory.stock_snapshot`):
- `.select("*")` — select all columns
- Apply optional filters: `.eq("plant_id", ...)`, `.eq("company_id", ...)`, `.eq("material_id", ...)`, `.eq("stock_type_code", ...)` — only when provided
- If `show_zero !== "true"`: `.gt("quantity", 0)` — filter out zero/negative rows
- `.order("material_id", { ascending: true })` then `.order("plant_id", { ascending: true })`

**Response shape:**
```json
{ "ok": true, "data": { "data": [...snapshotRows], "total": N } }
```
Where `total` is the length of the returned array (no server-side pagination for current stock — it's already a snapshot, so typically small per plant/material).

---

### Handler 3: `getStockValuationHandler`

**Route:** `GET /api/procurement/stock-valuation`

**Query params (all optional):**
- `plant_id` — filter
- `company_id` — filter
- `material_id` — filter

**DB query** (table `erp_inventory.stock_snapshot`):
- `.select("material_id, plant_id, company_id, base_uom_code, quantity, value")`
- Apply optional filters: `.eq("plant_id", ...)`, `.eq("company_id", ...)`, `.eq("material_id", ...)` — only when provided
- `.gt("quantity", 0)` — only rows with positive quantity

**JS aggregation** (in handler, after DB fetch):
Group fetched rows by `material_id + "__" + plant_id`. For each group:
```typescript
type ValuationRow = {
  material_id: string;
  plant_id: string;
  company_id: string;
  base_uom_code: string;
  total_qty: number;
  total_value: number;
  weighted_avg_rate: number; // total_value / total_qty, or 0 if total_qty === 0
};
```
Compute:
- `total_qty` = sum of all `quantity` values in the group (all stock types)
- `total_value` = sum of all `value` values in the group
- `weighted_avg_rate` = `total_qty > 0 ? total_value / total_qty : 0`

Sort result by `material_id ASC`, then `plant_id ASC`.

**Response shape:**
```json
{ "ok": true, "data": { "data": [...valuationRows], "total": N, "grand_total_value": 99999.99 } }
```
Where `grand_total_value` = sum of all `total_value` in the result (rounded to 2 decimal places).

---

## Routes to Add in `procurement.routes.ts`

### Imports (add to import block)
```typescript
import {
  getCurrentStockHandler,
  getStockLedgerReportHandler,
  getStockValuationHandler,
} from "../_core/procurement/stock_reports.handlers.ts";
```

### Switch cases (add after `case "GET:/api/procurement/planning":`)
```typescript
case "GET:/api/procurement/stock-ledger":
  return await getStockLedgerReportHandler(req, ctx);
case "GET:/api/procurement/current-stock":
  return await getCurrentStockHandler(req, ctx);
case "GET:/api/procurement/stock-valuation":
  return await getStockValuationHandler(req, ctx);
```

No regex routes needed — all 3 are simple collection GETs with no `:id` segments.

---

## procurementApi.js — 3 New Functions (append at end)

```javascript
export function getStockLedgerReport(params) {
  return fetchProcurement("GET", "/api/procurement/stock-ledger", undefined, params);
}

export function getCurrentStock(params) {
  return fetchProcurement("GET", "/api/procurement/current-stock", undefined, params);
}

export function getStockValuation(params) {
  return fetchProcurement("GET", "/api/procurement/stock-valuation", undefined, params);
}
```

---

## 24.2 — FE: `StockLedgerReportPage.jsx`

**File-ID:** 24.2
**Route:** `/dashboard/procurement/reports/stock-ledger`
**Screen code:** `PROC_STOCK_LEDGER`

### State
- `materialId` (string) — controlled input, required
- `plantId`, `companyId`, `dateFrom`, `dateTo` — optional filter inputs
- `limit` — select: `"100"`, `"200"`, `"500"` (default `"200"`)
- `rows` (array, default `[]`)
- `total` (number)
- `offset` (number, default 0)
- `loading`, `error` (string)

### Behaviour
- Fetch is triggered only when user clicks **"Run Report"** button (not on mount)
- `material_id` is required: show error `"Material ID is required"` if blank on Run
- Call `getStockLedgerReport({ material_id: materialId, plant_id: plantId, company_id: companyId, date_from: dateFrom, date_to: dateTo, limit, offset })`
- Response: `{ data, total }` — store rows and total
- Compute **running balance** in render: iterate rows in order, accumulate `signed_qty`. Add as `runningBalance` per row (purely in render, not stored in state).
- No pagination controls needed for Gate-24 (just show up to limit rows)

### Layout (`ErpScreenScaffold`)
- `eyebrow="Inventory Reports"`, `title="Stock Ledger"`
- Action: `{ key: "run", label: loading ? "Running..." : "Run Report", tone: "primary", onClick: handleRun, disabled: loading }`

### Filter section (above table)
A card or inline filter bar with:
- **Material ID** (text input, required, placeholder "Material UUID")
- **Plant ID** (text input, optional)
- **Company ID** (text input, optional)
- **Date From** (date input)
- **Date To** (date input)
- **Rows** (select: 100/200/500)

### Table columns
| Column | Source | Notes |
|---|---|---|
| Seq | `row.ledger_seq` | Monotonic ID |
| Posting Date | `row.posting_date` | |
| Movement Type | `row.movement_type_code` | |
| Direction | `row.direction` | Tone: `"IN"` → emerald chip, `"OUT"` → rose chip |
| Stock Type | `row.stock_type_code` | |
| Qty | `row.signed_qty` | Show `+` prefix for positive, format 6 decimal places |
| UOM | `row.base_uom_code` | |
| Value | `row.value` | Numeric, 2 dp |
| Val. Rate | `row.valuation_rate` | Numeric, 6 dp |
| Running Bal | computed | Accumulated `signed_qty`, 6 dp |

Show row count: `Showing {rows.length} of {total} movements`

---

## 24.3 — FE: `CurrentStockPage.jsx`

**File-ID:** 24.3
**Route:** `/dashboard/procurement/reports/current-stock`
**Screen code:** `PROC_CURRENT_STOCK`

### State
- `plantId`, `companyId`, `materialId`, `stockTypeCode` — filter inputs (all optional)
- `showZero` (boolean, default false) — checkbox
- `rows` (array, default `[]`)
- `loading`, `searched` (boolean — true after first fetch), `error`

### Behaviour
- Fetch on "Search" button click
- Call `getCurrentStock({ plant_id: plantId, company_id: companyId, material_id: materialId, stock_type_code: stockTypeCode, show_zero: showZero ? "true" : "false" })`
- Store returned `data` array

### Layout
- `eyebrow="Inventory Reports"`, `title="Current Stock"`
- Action: `{ key: "search", label: loading ? "Searching..." : "Search", tone: "primary", onClick: handleSearch, disabled: loading }`

### Filter bar
- Plant ID (text input)
- Company ID (text input)
- Material ID (text input)
- Stock Type (select: blank/"All", `UNRESTRICTED`, `QA`, `BLOCKED`, `IN_TRANSIT`)
- Show Zero Stock (checkbox)

### Table columns
| Column | Source |
|---|---|
| Material ID | `row.material_id` |
| Plant ID | `row.plant_id` |
| SLOC ID | `row.storage_location_id` |
| Stock Type | `row.stock_type_code` — colored chip |
| Batch ID | `row.batch_id ?? "—"` |
| Quantity | `row.quantity` (6 dp) |
| UOM | `row.base_uom_code` |
| Value | `row.value` (2 dp) |
| Val. Rate | `row.valuation_rate` (6 dp) |

Stock type chip tones: `UNRESTRICTED` → emerald, `QA` → amber, `BLOCKED` → rose, `IN_TRANSIT` → violet, other → slate.

Before first search: show a dashed info box "Set filters and click Search to view current stock."

---

## 24.4 — FE: `StockValuationPage.jsx`

**File-ID:** 24.4
**Route:** `/dashboard/procurement/reports/stock-valuation`
**Screen code:** `PROC_STOCK_VALUATION`

### State
- `plantId`, `companyId`, `materialId` — filter inputs (all optional)
- `rows` (array, default `[]`)
- `grandTotalValue` (number, default 0)
- `loading`, `searched` (boolean), `error`

### Behaviour
- Fetch on "Run" button click
- Call `getStockValuation({ plant_id: plantId, company_id: companyId, material_id: materialId })`
- Response shape: `{ data, total, grand_total_value }` — but since `fetchProcurement` unwraps `payload.data` when `total` is present, it returns the full object. Handle as:
  ```javascript
  const response = await getStockValuation(...);
  // response is { data: [...], total: N, grand_total_value: X } because fetchProcurement
  // sees "data" and "total" keys and returns the full payload object
  setRows(Array.isArray(response?.data) ? response.data : []);
  setGrandTotalValue(Number(response?.grand_total_value ?? 0));
  ```

### Layout
- `eyebrow="Inventory Reports"`, `title="Stock Valuation"`
- Action: `{ key: "run", label: loading ? "Running..." : "Run", tone: "primary", onClick: handleRun, disabled: loading }`

### Filter bar
- Plant ID (text input)
- Company ID (text input)
- Material ID (text input)

### Table columns
| Column | Source |
|---|---|
| Material ID | `row.material_id` |
| Plant ID | `row.plant_id` |
| Company ID | `row.company_id` |
| Total Qty | `row.total_qty` (6 dp) |
| UOM | `row.base_uom_code` |
| Wtd Avg Rate | `row.weighted_avg_rate` (6 dp) |
| Total Value | `row.total_value` (2 dp) |

**Summary row** below table (only when rows.length > 0):
```
Grand Total Value: {grandTotalValue.toFixed(2)}
```
Display in a right-aligned styled div.

Before first run: show dashed info box "Set filters and click Run to compute stock valuation."

---

## operationScreens.js — 3 New Entries

Insert after `PROC_PLANT_TRANSFER_DETAIL` block:

```javascript
PROC_STOCK_LEDGER: {
  screen_code: "PROC_STOCK_LEDGER",
  route: "/dashboard/procurement/reports/stock-ledger",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},

PROC_CURRENT_STOCK: {
  screen_code: "PROC_CURRENT_STOCK",
  route: "/dashboard/procurement/reports/current-stock",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},

PROC_STOCK_VALUATION: {
  screen_code: "PROC_STOCK_VALUATION",
  route: "/dashboard/procurement/reports/stock-valuation",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},
```

---

## AppRouter.jsx — Imports + Routes

### Imports (add after PlantTransferDetailPage import line)
```jsx
import StockLedgerReportPage from "../pages/dashboard/procurement/reports/StockLedgerReportPage.jsx";
import CurrentStockPage from "../pages/dashboard/procurement/reports/CurrentStockPage.jsx";
import StockValuationPage from "../pages/dashboard/procurement/reports/StockValuationPage.jsx";
```

### Routes (add after `procurement/transfer/:id` route)
```jsx
<Route
  path="procurement/reports/stock-ledger"
  element={<StockLedgerReportPage />}
/>
<Route
  path="procurement/reports/current-stock"
  element={<CurrentStockPage />}
/>
<Route
  path="procurement/reports/stock-valuation"
  element={<StockValuationPage />}
/>
```

---

## Key Logic Notes for Codex

### Stock Ledger — `signed_qty` computation
```typescript
const rowsWithSignedQty = (data ?? []).map((row: Record<string, unknown>) => ({
  ...row,
  signed_qty: row.direction === "IN"
    ? Number(row.quantity)
    : -Number(row.quantity),
}));
```

### Stock Valuation — JS aggregation pattern
```typescript
type ValuationAgg = {
  material_id: string;
  plant_id: string;
  company_id: string;
  base_uom_code: string;
  total_qty: number;
  total_value: number;
  weighted_avg_rate: number;
};

const aggMap = new Map<string, ValuationAgg>();

for (const row of data ?? []) {
  const key = `${row.material_id}__${row.plant_id}`;
  if (!aggMap.has(key)) {
    aggMap.set(key, {
      material_id: String(row.material_id),
      plant_id: String(row.plant_id),
      company_id: String(row.company_id),
      base_uom_code: String(row.base_uom_code),
      total_qty: 0,
      total_value: 0,
      weighted_avg_rate: 0,
    });
  }
  const agg = aggMap.get(key)!;
  agg.total_qty += Number(row.quantity);
  agg.total_value += Number(row.value);
}

const result: ValuationAgg[] = [];
for (const agg of aggMap.values()) {
  agg.weighted_avg_rate = agg.total_qty > 0
    ? agg.total_value / agg.total_qty
    : 0;
  result.push(agg);
}

result.sort((a, b) => a.material_id.localeCompare(b.material_id) || a.plant_id.localeCompare(b.plant_id));

const grandTotalValue = result.reduce((sum, r) => sum + r.total_value, 0);

return okResponse({
  data: result,
  total: result.length,
  grand_total_value: Math.round(grandTotalValue * 100) / 100,
});
```

### fetchProcurement unwrap behaviour (important for StockValuationPage)
`fetchProcurement` in `procurementApi.js` does:
```javascript
if (payload && typeof payload === "object" && "data" in payload) {
  if ("total" in payload) {
    return payload;          // ← returns full object when both "data" and "total" keys exist
  }
  return payload.data;
}
return payload;
```
So `getStockValuation(...)` returns `{ data: [...], total: N, grand_total_value: X }`.
`getStockLedgerReport(...)` similarly returns `{ data: [...], total: N, offset, limit }`.
`getCurrentStock(...)` returns `{ data: [...], total: N }`.
All three FE pages must handle accordingly.

---

## Component Imports

All 3 pages use:
```jsx
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
```

Import the relevant API functions from `../procurementApi.js`.

No `openScreen` / `useNavigate` needed in any of the 3 pages (pure report pages, no navigation).

---

## Summary Checklist for Codex

- [ ] `stock_reports.handlers.ts` — 3 handlers, File-ID 24.1
- [ ] `StockLedgerReportPage.jsx` — File-ID 24.2
- [ ] `CurrentStockPage.jsx` — File-ID 24.3
- [ ] `StockValuationPage.jsx` — File-ID 24.4
- [ ] `procurement.routes.ts` — 3 imports + 3 switch cases
- [ ] `procurementApi.js` — 3 new functions appended
- [ ] `operationScreens.js` — 3 new screen entries after PROC_PLANT_TRANSFER_DETAIL
- [ ] `AppRouter.jsx` — 3 imports + 3 routes after procurement/transfer/:id
