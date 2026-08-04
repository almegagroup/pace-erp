# CODEX-IN03-CURRENT-STOCK-REDESIGN-TASK-BRIEF

**Domain:** PROCUREMENT / INVENTORY (Reports)
**Reference:** feasibility doc `PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
§116 (read that first — this brief is the implementation checklist, §116 has the full reasoning
and the real dev-data proof behind every decision below). Also read CLAUDE.md §8A (never show raw
UUIDs), §8B (batch vs sequential loops).

**Not in scope for this brief:** the "FG Block/QI (pack-count-based)" page noted in §116.8. That
page does not exist today and is explicitly flagged as a future, separately-designed piece — do
not build it here. This brief covers **IN03 (Current Stock) only**: `getCurrentStockHandler` in
`supabase/functions/api/_core/procurement/stock_reports.handlers.ts` and
`frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx`, plus two small new
backend endpoints and one new reusable frontend component.

**⚠️ Correction, read before touching Change 3 (Company filter) — if you have already built the
Company multi-value filter using `useCompaniesForOmQuery`/`listCompaniesForOm`, stop and fix it
before doing anything else.** That hook calls `GET /api/admin/companies`, which is registered
`{ skipAcl: true }` in `route-acl-registry.ts` — it returns **every company in the system**, with
no scoping to the caller's own `erp_map.user_companies`, because it exists for SA/admin screens
(e.g. Material Master plant-extension) that legitimately need the full list. Using it for a
regular business report's Company filter is a company-scope leak (CLAUDE.md bug pattern #2) — a
single-company user would be able to type/paste a foreign company's code into the filter and see
that company's stock. See Change 3 below for the corrected source.

---

## Status check (read before touching anything)

Current `getCurrentStockHandler` (stock_reports.handlers.ts, ~line 185-330) reads only from
`erp_inventory.stock_snapshot`, filtered by single `company_id`/`material_id`/`stock_type_code`.
Current `CurrentStockPage.jsx` renders a flat grid including a **dead** `batch_id` column (the
field does not exist anywhere in the response — `stock_snapshot` has no batch split, confirmed in
§116.1) and forces company selection through `TransactionCompanySelector` (`mode="required"`,
single company only). None of this is reused as-is; this is a near-full rewrite of both files.

Do not touch `stock_ledger`, `stock_snapshot`, `post_stock_movement()`, or any other module's
files. No schema/migration changes are needed anywhere in this brief.

---

## Change 1 — Backend: rewrite `getCurrentStockHandler`

File: `supabase/functions/api/_core/procurement/stock_reports.handlers.ts`

### 1a. New query params (all optional; arrays passed as repeated `key=value` query params or
comma-separated — pick whichever pattern this codebase's other multi-value list endpoints already
use, for consistency — check `listProcessOrdersHandler`/`listPackingOrdersHandler` for the
existing convention before inventing a new one)

- `company_ids` (replaces the old singular `company_id` — keep accepting a single value too for
  backward compatibility, but support an array)
- `material_types` — subset of `RM/PM/INT/SFG/FG`
- `material_ids` (replaces singular `material_id`)
- `storage_location_ids` — **new filter, did not exist before**
- `batch_numbers` — new filter
- `packing_po_numbers` — new filter
- `stock_types` — subset of `UNRESTRICTED/QUALITY_INSPECTION/BLOCKED` only (do **not** add
  `IN_TRANSIT`/`FOR_REPROCESS` — deliberately deferred, §116.2)
- `show_zero` (unchanged, boolean)

Company scoping: keep using `assertCompanyScope`/the existing `resolveCompanyScope` pattern in
this file — when `company_ids` has entries, validate each against the caller's
`erp_map.user_companies` scope (SA/GA/admin bypass unchanged); when empty, fall back to the
caller's full allowed-company list exactly as today.

### 1b. Three-path data assembly (this is the core of the rewrite — §116.4)

Determine, per requested `material_types` (or all 5 if unfiltered), which of three paths applies:

**Path A — blended (RM, PM, INT, and FG rows whose `packing_order.source_po_type = 'MTS'`):**
Read straight from `stock_snapshot`, filtered by the resolved company/material/storage-location
scope, `stock_type_code IN (...)`. Group is (company_id, material_id, storage_location_id). Pivot
`stock_type_code` into three numeric columns instead of one row per stock type (§116.3 — this is
the MB52-style change: one row per material+location, `unrestricted_qty`/`qi_qty`/`blocked_qty`
columns, not three separate rows). `batch_number` and `packing_po_number` are always `null` for
these rows.

To find which FG materials are MTS-typed: join through the same
`stock_ledger → stock_document → packing_order` chain as Path C below, read
`packing_order.source_po_type`, and route `'MTS'` rows into Path A's blended bucket instead of
Path C's per-PO bucket. Do not use `material_master`/`stroke_master`-level po_type inference — the
correction in §116.4 is explicit that this is a `packing_order.source_po_type` decision, and it
must be re-checked per row, not assumed at the material level (a material could in principle have
stock from more than one PO type, though not expected in practice — check the actual PO, don't
shortcut).

**Path B — SFG, every po_type (batch-level, never blended — §116.4, this is the one place the
session almost got wrong twice, see the correction note there):**
Read from `stock_ledger`, grouped by (company_id, material_id, storage_location_id,
batch_number, stock_type_code), net quantity = `SUM(CASE WHEN direction='IN' THEN quantity ELSE
-quantity END)`, filtered to non-zero (unless `show_zero`). Pivot stock_type into the three
columns same as Path A. `packing_po_number` is always `null` for SFG rows.

**Path C — FG, `source_po_type IN ('MTO','HPS','MTEST')` (batch + Packing-PO level):**
Read from `stock_ledger` grouped by (company_id, material_id, storage_location_id, batch_number,
`resolved_po_number`, stock_type_code), same net-quantity computation as Path B. Resolve
`resolved_po_number` per ledger row using **the exact same fallback chain already implemented in
`fgStockBreakdownHandler`'s `resolveLotRef()`** (`packing_order.handlers.ts`, ~line 818): prefer
`stock_document.source_lot_ref`, else if `reference_document_type='PACK_PO'` use
`reference_document_number`, else fall back to `stock_document.document_number` (this is the
legacy-row case — a real dev example exists: batch `EV02602`'s Packing PO resolves to `940005`,
its own old-style document number, because it predates §106's reference tagging). Do not
reimplement this logic differently — either extract `resolveLotRef` into a shared helper both
handlers import, or copy it verbatim with a comment pointing at the original. Once you have
`resolved_po_number`, join to `erp_production.packing_order` on `po_number` to pull
`num_packs`, `fill_qty_per_pack`, and confirm `source_po_type` (to route MTS rows to Path A as
described above).

### 1c. Primary Quantity / UOM column (§116.5)

- Path A and Path B rows: `primary_qty` = the row's own base-UOM quantity, `uom_code` = the
  material's `base_uom_code`. No conversion.
- Path C rows: `primary_qty` = that row's `packing_order.num_packs`, `uom_code` =
  `pack_code_master.outer_uom_code` (join via `material_master.pack_code` → `pack_code_master`,
  same join `getCurrentStockHandler`'s existing alt-UOM logic already does for the old
  `alt_uom_code`/`alt_quantity` fields — reuse that join, don't add a second one). Do **not** use
  `material_uom_conversion` for FG rows at all — the whole point of §116.5's correction is that
  the per-PO `num_packs`/`fill_qty_per_pack` replaces any need for a material-level conversion
  factor, for both fixed-pack and variable-fill (599/000/001) SKUs alike. Remove the existing
  `alt_uom_code`/`alt_quantity` §110 Phase C logic from this handler entirely for FG rows — it no
  longer applies; you can leave it in place for RM/PM (Path A) rows if other consumers still
  depend on it, but check first whether anything outside this handler reads those two fields
  before deciding to keep or drop them for non-FG rows too (grep the frontend for
  `alt_uom_code`/`alt_quantity` usage — if `CurrentStockPage.jsx` is the only consumer, and this
  brief is rewriting that page anyway, it's simplest to drop the fields entirely, everywhere).

### 1d. Material column resolution (§116.3)

Bulk-resolve `material_master` rows (existing pattern in this handler) and select
`pace_code, external_code, material_name, document_name, material_type, pack_code`. Response's
`material_label` = `document_name`, falling back to `material_name` when `document_name` is
null/empty (real example: `SFG-00006` has `document_name = null`). `external_code` is returned
raw, no fallback (blank stays blank, per §8A — do not substitute `pace_code` or `material_name`
into a blank `external_code`). Also return `document_name` raw (unfallen-back) as its own field —
the frontend needs both the resolved `material_label` (for the default "Material" column) and the
raw `document_name` (for the separate, default-hidden "Document Name" column, §116.3 row 5) —
these are two different columns showing overlapping but not identical data, don't collapse them
into one field.

### 1e. Reserved / Net Available (§116.6)

Query `erp_production.reservation_document` where `status = 'OPEN'`, sum `balance_qty`, grouped
by the same key as the row's own grain:
- Path A rows (no batch) → group by `material_id, storage_location_id`
- Path B/C rows (have batch) → group by `material_id, storage_location_id, batch_number`

Do this as one bulk query per path (fetch all relevant OPEN reservations for the resolved
material/location scope in one round trip, then match in-memory — §8B, this is an INDEPENDENT
lookup, not a per-row query loop). Do **not** return `source_type` or any per-reservation detail
in the response — only the summed total (business owner: "reserved source ato detail venge
dekhanor dorkar nei", §116.6). `net_available_qty = unrestricted_qty - reserved_qty`.

### 1f. Storage Location resolution

Bulk-resolve `storage_location_master` (existing pattern), return `code` only in the row (no
`name` — §116.3 row 7, business owner explicitly does not want the name shown, code alone is
enough).

### 1g. Remove entirely from the response

`value`, `valuation_rate` (§116.3 — Rate/Value dropped completely, unlike the old IN03).

---

## Change 2 — Two new backend endpoints (autocomplete, §116.7)

Add to the same file (`stock_reports.handlers.ts`) or a nearby helper — match whatever this
file's existing naming/registration convention is.

1. `GET /api/procurement/current-stock/batch-search?q=&company_id=` — distinct
   `stock_ledger.batch_number` values where `batch_number ILIKE '%q%'` (or prefix match, your
   call — just be consistent with how other type-ahead endpoints in this codebase already work,
   if any exist; if none do, prefix match is fine), scoped by `company_id` when given, else the
   caller's allowed companies. Cap results (e.g. `LIMIT 50`) — this is a type-ahead, not a full
   list.
2. `GET /api/procurement/current-stock/po-search?q=&company_id=` — same shape, distinct
   `erp_production.packing_order.po_number` values.

Register both in `procurement.routes.ts` next to the existing `current-stock` route, with
`route-acl-registry.ts` entries mirroring the existing
`"GET:/api/procurement/current-stock": { skipAcl: false, resourceCode: "PROC_CURRENT_STOCK", action: "VIEW" }`
line — same `resourceCode`/`action`, these are sub-features of the same report, not a new ACL
resource (checklist item #6, do not invent a new resource_code for what is functionally the same
page's autocomplete helper).

---

## Change 3 — New reusable frontend component: multi-value filter (§116.2)

No existing component in this codebase does this (checked — nothing under
`frontend/src/components` matches `multi-select`/`chip-input`/`tag-input`). Build one, e.g.
`frontend/src/components/inputs/MultiValueFilterField.jsx`, with this exact interaction model
(mirrors SAP's "multiple selection" popup, per business owner's explicit description — do not
substitute a generic multi-select dropdown, that was explicitly rejected):

- A field showing "N values selected" (or a placeholder when empty) that opens a modal/popup on
  click.
- Inside the popup: a text input. Typing triggers an autocomplete dropdown (debounced query
  against whatever `optionsQuery`/`searchFn` prop is passed in — for Material/Storage Location
  this is the existing `useMaterialOptionsQuery`/`useStorageLocationOptionsQuery` hooks; for
  Batch Number/Packing PO Number it's the two new endpoints from Change 2, called via a debounced
  fetch as the user types).
- Pasting a delimited block of text (newline, comma, or tab separated — handle all three) into
  the input auto-splits it into multiple chips/tags immediately, without requiring one-by-one
  autocomplete selection.
- Selected values render as removable chips inside the popup.
- A confirm action closes the popup and returns the full value list to the parent.

Build this once, parameterized (label, options-query-or-search-fn, value, onChange), and use it
for four of the five multi-value filters (Material, Storage Location, Batch Number, Packing PO
Number) on the new Page 1. Material Type is a plain checkbox group (5 fixed values), not this
component.

**Company is a fifth, special case — do not source it from `useCompaniesForOmQuery`.** Use
`useMenu()`'s `runtimeContext.availableCompanies` instead (the same source
`TransactionCompanySelector`/`buildTransactionCompanyList` already use elsewhere) — this list is
already pre-scoped server-side to the caller's own `erp_map.user_companies` (or every company for
SA/GA/admin), so there is no way to see a foreign company through it. Mirror
`TransactionCompanySelector`'s existing read-only rule
(`workspaceMode !== "MULTI" || availableCompanies.length <= 1`): when the caller has only one
available company, render Company as a fixed, non-editable label (not the popup at all) — when
they have more than one, render the same `MultiValueFilterField` popup as the other four filters,
but its option list must come only from `availableCompanies`, never a live search endpoint. Do
not add a `company-search` backend endpoint for this — it isn't needed and would reopen the same
scope leak in a new form.

---

## Change 4 — `CurrentStockPage.jsx` full rewrite

File: `frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx`

### Page 1 (filters, top of page)

Replace the current single-value `TransactionCompanySelector` + single `ErpComboboxField`
(Material) + single stock-type `<select>` with:
- `MultiValueFilterField` × 5 (Company, Material, Storage Location, Batch Number, Packing PO
  Number) — per Change 3.
- Material Type checkbox group (RM/PM/INT/SFG/FG).
- Stock Type checkbox group (Unrestricted / Quality Inspection / Blocked only — no In-Transit, no
  For-Reprocess, §116.2).
- "Show Zero Stock" checkbox (unchanged from today).
- Search button (unchanged behavior — fetches on click, not on every filter change).

**Do not put a company-required guard on this page** — unlike a transaction page, an empty
Company filter is valid here and means "all my allowed companies" (matches the backend's existing
`resolveCompanyScope` fallback). Do not reuse `TransactionCompanySelector` for this field at all;
it enforces exactly the single-company/`mode="required"` behavior this redesign is explicitly
moving away from.

### Page 2 (grid + Columns button)

- `ErpDenseGrid` with the 14 columns from §116.3, in that order. Column 3 ("Material") renders
  the response's `material_label` field (already-resolved with document_name→material_name
  fallback, Change 1d). Column 5 ("Document Name") renders the raw `document_name` field.
- A "Columns" button above/beside the grid. Clicking opens a drawer (reuse whatever drawer
  primitive this codebase already uses elsewhere — check `DOCreatePage.jsx`'s source-picker
  drawer or similar for the existing pattern) listing all 14 columns as checkboxes, all checked
  except "Document Name". Toggling updates a local `visibleColumns` state; the grid's `columns`
  prop filters against it. This is entirely client-side — no new API call on toggle.
- Remove the old "Batch ID" column entirely (it never worked, §116.1 — do not try to "fix" it by
  wiring it to the new `batch_number` field; that field already has its own proper column at
  position 8).
- Remove Rate/Value columns entirely (Change 1g removed them from the response too).

---

## Hard rules

1. Do not touch `stock_ledger`, `stock_snapshot`, `post_stock_movement()`, `reservation_document`
   writes, or any handler outside `stock_reports.handlers.ts` — this is a **read-only report**
   rewrite. If you find yourself wanting to write to any table, stop and re-read §116 — nothing
   in this brief should require a write.
2. §8A: never show a raw UUID anywhere in the response or the grid — every ID (`material_id`,
   `storage_location_id`, `company_id`) must resolve to a human-readable label
   (`material_label`/`external_code`, `location_code`, `company_code`) exactly as the existing
   handler already partially does; extend the same pattern, don't regress it.
3. §8B: the Reserved-quantity lookup (1e) and the Material/SLoc bulk-resolve (1d/1f) must each be
   one batched `.in()`-style query per path, not a per-row loop.
4. Do not invent a new ACL resource_code for the two new autocomplete endpoints (Change 2) — reuse
   `PROC_CURRENT_STOCK`/`VIEW`, per the existing route.
5. This brief does not change who can access IN03 — ACL/department decisions for IN01-IN06/PR21
   are a separate, still-open session (`NEXT-SESSION-PROMPT-Inventory-ACL-Design.md`). Don't touch
   `acl.*` tables or `route-acl-registry.ts` beyond registering the two new routes under the
   existing resource code.

---

## Verification

1. `deno check` on `stock_reports.handlers.ts` and any new/touched backend files — clean (or only
   pre-existing `.range()`/`.or()` typing noise, confirm via `git diff --stat` that any remaining
   errors predate this change).
2. `eslint` on `CurrentStockPage.jsx` and the new `MultiValueFilterField.jsx` — clean.
3. Manual/MCP-level sanity check against dev (`ytapuwiqicmvpanmzelb`) using the real examples
   already verified in §116:
   - Material `SFG-00004` at `S003`, CMP003 → should return **two rows** (batch `EV02602` with
     QI=10060/Unrestricted=5000, batch `EV02609` with Unrestricted=5000 only) — not one blended
     row.
   - Material `FG-00008` at `F003`, CMP003 → should return **two rows** (Packing PO `940005`,
     22 BBL; Packing PO `9400000002`, 25 BBL) with "Show Zero" off, and a **third** zero-balance
     row for PO `9400000001` when "Show Zero" is turned on.
   - Material `RM-00020` at `R003`, CMP003 → Unrestricted 1902.32, Reserved 40.36 (sum of a
     Process PO reservation + a Sales Order reservation), Net Available 1861.96.
4. Confirm no `batch_id` field/column exists anywhere in the new response or grid.
5. Confirm the Company filter left empty returns stock across every company the logged-in user is
   allowed to see (not just one), for a multi-company test user.

## Log + commit

- Append entries to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md` (new entry, reference this
  brief and feasibility §116).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
