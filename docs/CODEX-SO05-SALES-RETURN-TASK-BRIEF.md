# CODEX TASK — SO05 Sales Return (Return Receipt + Repack + Pending Strokes/Entries)

## Read first

1. `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
   **Section 134** (just rewritten 2026-09-25) — this is the locked design this brief implements.
   Read it in full before touching any code; this brief is the "how", §134 is the "what and why".
   §134.13 lists what is explicitly **out of scope** for this first pass — do not build those items
   even if they look easy.
2. `CLAUDE.md` — specifically:
   - The 15 recurring bug patterns checklist. Pattern #2 (company-scope gap) and #11 (wrong company
     source) are directly relevant — Return Receipt resolves a Sending Location across 5 different
     shapes (§134.3-A), get this wrong and it silently leaks across companies. Pattern #15
     (API-client double-unwrap) — check whichever `fetchProd`/`fetchOm`-style wrapper you call from
     the new frontend pages actually returns what you assume.
   - §8A (no raw UUIDs in any response/UI you touch — every Prodshade/Stroke/Batch/SKU/Transporter
     reference must resolve to a human-readable label).
   - §8B (batch vs sequential loop rule) — the Pending Strokes/Pending Entries aggregation queries
     (§134.8/§134.9) must batch-fetch, not loop.
   - §8C/§8D (stock posting engine) — P651 posting from Return Receipt Save must go through
     `post_document()` (the same transactional gate Process PO Verify/PGI Invoice already use, see
     `complete_process_po_verify`/`complete_pgi_invoice_action` in migrations
     `20260719180000`/`20260731150000` as worked templates), **not** a bare
     `post_stock_movement()` call from TypeScript — `scripts/stock-posting-guard.mjs`'s ratchet will
     fail the build if you add a new direct call site.
   - §8E (`fetchInChunks`) — if any Pending-button query does an `.in()` over an id list derived from
     company/date-range filters (unbounded), chunk it.
   - The "acl.menu_master.menu_code MUST = erp_menu.menu_master.resource_code" rule and the 4-step
     ACL-provisioning MCP sequence (§8) — you are wiring a **new** page into ACL, not editing a live
     one, so use `capture_acl_version_source` → `generate_acl_snapshot` → `rebuild_acl_menu_snapshot`
     in both dev and prod.
3. Existing worked examples to copy the pattern from, not reinvent:
   - `sales_order.handlers.ts`'s `resolveBillToShipTo()` — the exact 5-way Sending Location resolver
     to reuse for §134.3-A (Return Type → address). Confirmed live `sales_order.dispatch_type` enum
     values: `DEPENDENT_DIRECT`, `DEPENDENT_DEPOT`, `INDEPENDENT_PARTY`,
     `INDEPENDENT_PARTY_ASIAN_BILLED`, `DEPENDENT_NO_INBOUND` (drop this last one — §134.3-A already
     excludes it). `bill_to_type` enum: `VDC`, `DEPOT`, `CUSTOMER`, `PARENT_COMPANY`. There is no
     `STO` value in `sales_order.dispatch_type` — the STO return type resolves Sending Company
     directly from the `companies` master, model it as its own literal (`STO`) on the new
     `return_type` column, not shoehorned into `dispatch_type`'s existing enum.
   - `SO01CreatePage.jsx` (`makeLine()`, `strokeCheckStatus()` around line 303-309 and 601-613) — the
     Item row template and the red-dot component (green/rose 2px dot + tooltip) to reuse verbatim
     for §134.5's Stroke Number and Batch Number dots.
   - `prepareUnifiedSoLine()` (`sales_order.handlers.ts`) — required-field-by-material-type validation
     pattern to mirror for the new Sales Return Item handler.
   - `DO01CreatePage.jsx`'s `TransporterPicker` + `goToTransporterMasterPreservingForm()` — already
     has the keyboard-nav fix and the context-preservation fix (§134.3-B) — copy this exact component,
     do not resurrect the pre-fix mouse-only/state-losing version from before that fix landed.
   - `deriveSalesInvoiceGstType()` — the GST CGST+SGST-vs-IGST state-comparison logic to reuse for
     Invoice-level GST (§134.5, tick-ON fields).
   - `pack_bom.handlers.ts` / `prodshade_pack_config` usage in `plan_feed`/`pack_bom` handlers — the
     SKU→Prodshade derivation (`shade_code`+`pack_code` → `prodshade_pack_config` → `material_id`)
     needed for both the Batch Number lookup (§134.5 step 3) and the Repack target-SKU dropdown
     (§134.6, Prodshade→other-pack-code-SKU, the *reverse* direction — you will need a new query for
     this reverse lookup, the existing helpers only do SKU→Prodshade).
   - `erp_production.process_order` — confirmed live schema has `company_id`, `material_id`,
     `po_type`, `batch_number`, `status` — the exact columns the Batch Number typeahead
     (§134.5 step 3) queries against. PR22 writes real rows into this same table (no separate
     genealogy table exists) so one query naturally covers both real and PR22-declared batches.
   - `RTV`/`erp_procurement.debit_note`'s status-lifecycle shape (`sent_at`/`acknowledged_at`/
     `settled_at`, no running balance) — reference for when Return Payable eventually gets built
     (§134.10), **not building it now**, just keep the shape in mind for any placeholder status you
     do add to the new Invoice table.
   - `stock_reports.handlers.ts`'s `buildOpeningStockLotMap()`/`resolveLotRefStrict()`/
     `resolveLotRef()` (~line 160-350) — the existing, proven "Packing PO Number" resolution chain
     IN02/IN03 already share. Work Stream F extends this with a `SALES_RETURN` case rather than
     inventing a new mechanism; read it in full before touching it, and `grep -n "resolveLotRef("`
     in that file to find every call site you need to update.

## Hard scope boundary — read this twice

**In scope for this pass:**
- New tables (Work Stream A below).
- Return Receipt: Page 1 (Sending Location + Transporter, merged, §134.3-A/134.3-B) and Page 2
  (nested Invoice tick ON/OFF + Item entry + Repack sub-rows, §134.5/§134.6).
- P651 posting to Blocked stock on Return Receipt Save (§134.6's posting rules), through
  `post_document()`.
- Invoice Posting **queue UI** (Accounts tab, §134.7) — list tick-OFF invoices, let Accounts fill
  the deferred fields and Save them onto the Invoice row.
- Pending Strokes button on Stroke Master (§134.8).
- Pending Entries button on PR22 and PR23 (§134.9), including PR23's `packing_order_id` backfill.
- SO05 menu rename + ACL wiring (§134.2), dev and prod.
- IN02/IN03 Packing PO Number resolution for `SALES_RETURN`-tagged postings (Work Stream F).

**Explicitly OUT of scope — do not build, even partially (per §134.13):**
- Return Payable document (any ledger/payable table, any "book the payable" logic on Invoice-Posting
  Save). When Invoice Posting Save runs, persist the filled fields onto the Invoice row and set its
  status to something like `DETAIL_CAPTURED` — **do not** create any downstream payable/ledger
  record. Leave a `-- TODO §134.10` comment at that exact point.
- To-Pay Freight resolution mechanism (Invoice-level Freight = To Pay is selectable as a value, but
  no resolution workflow behind it yet — just store the choice).
- Invoice "Values" fields beyond a single Amount field.
- Additional Fields category-based extensible-field mechanism.
- SO05 Total Table "genealogy missing" status column.
- Any change to PR19 itself (§134.11 — it already works; wiring Sales Return's salvage action to
  invoke it is a **separate, later** task once Return Payable and the salvage UX are designed. Do
  not add a "Salvage" button to SO05 in this pass.)

Before opening a PR, run `deno check` on every backend file touched, `eslint` on every frontend file
touched, every CI guard script under `scripts/` (especially `stock-posting-guard.mjs`,
`route-acl-registry-guard.mjs`, `company-scope-guard.mjs`, `company-scope-write-acl-guard.mjs`,
`frontend-payload-guard.mjs`, `jsx-no-undef-guard.mjs`), and
`node scripts/migration-integrity-check.mjs`'s printed SQL against dev, confirming `in_sync=true`.

---

## Work Stream A — Migration: new tables

All new tables live in `erp_procurement` (Sales Return is a Sales-module concept per §134.2,
matching where `sales_order`/`delivery_challan`/`debit_note` already live). Follow the codebase's
existing convention: `gen_random_uuid()` PK, `created_at`/`created_by`, RLS left disabled to match
every other `erp_procurement`/`erp_production` transactional table (service-role-only access, same
as `sales_order_line`/`process_order` etc. — this is the established pattern here, not a gap to fix
in this task).

### A.1 `erp_procurement.sales_return_receipt` (header — Page 1)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| receipt_number | text not null | new global doc-number range per §8 (`SRET`?), confirm free band with SA before hardcoding — do not reuse another type's range |
| receipt_date | date not null | |
| company_id | uuid not null | |
| return_type | text not null | `DEPENDENT_DIRECT` / `DEPENDENT_DEPOT` / `INDEPENDENT_PARTY` / `INDEPENDENT_PARTY_ASIAN_BILLED` / `STO` — mirrors `sales_order.dispatch_type` minus `DEPENDENT_NO_INBOUND`, plus the new `STO` literal |
| sending_parent_company_id | uuid nullable | Dependent Direct/Depot/Asian-Billed |
| sending_vdc_id | uuid nullable | Dependent Direct, or Asian-Billed's VDC choice |
| sending_depot_id | uuid nullable | Dependent Depot, or Asian-Billed's Depot choice |
| sending_customer_id | uuid nullable | Independent Party (both plain and Asian-Billed) |
| sending_customer_address_id | uuid nullable | the specific Customer Address row picked |
| sending_company_id | uuid nullable | STO type — another PACE company |
| sending_name / sending_address / sending_state / sending_gst_number | text nullable | **resolved snapshot**, frozen at save time (same pattern as `delivery_challan.ship_to_*`) |
| asian_side_choice | text nullable | `VDC` / `DC` / `NONE` — Independent Party (Asian Billed) only |
| asian_side_name / address / state / gst_number | text nullable | resolved snapshot for the Asian-side address, Asian-Billed only |
| vehicle_number, transporter_id, transporter_name_freetext, lr_number, lr_date, gross_weight, net_weight, driver_number, driver_contact_number | same types as `delivery_challan`'s equivalent columns | Page 1 Transporter fields, §134.3-B |
| status | text not null default `'DRAFT'` | `DRAFT` → `POSTED` (Blocked stock posted) — keep it simple, no multi-stage workflow was locked |
| remarks | text nullable | |
| created_by, created_at, last_updated_by, last_updated_at | | |

### A.2 `erp_procurement.sales_return_invoice` (nested — Page 2, child of receipt)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| receipt_id | uuid not null fk → sales_return_receipt | |
| tick_on | boolean not null default false | ON = full detail captured now |
| invoice_number | text not null | mandatory in both tick states |
| invoice_date | date nullable | mandatory only when tick_on |
| reference_document_number | text nullable | captured when tick_on = false |
| amount | numeric nullable | |
| gst_treatment | text nullable | `INCLUSIVE` / `EXCLUSIVE` |
| gst_rate | numeric nullable | |
| gst_amount | numeric nullable | |
| state | text nullable | resolved same way as `deriveSalesInvoiceGstType()`'s state comparison |
| freight_term | text nullable | `FOR` / `TO_PAY` |
| detail_status | text not null default `'PENDING'` | `PENDING` → `DETAIL_CAPTURED` (Accounts tab Save, §134.7) — **never** progresses further in this task, no payable booking (§134.10 deferred) |
| created_at | | |

### A.3 `erp_procurement.sales_return_item` (child of invoice)

Mirror `sales_order_line`'s already-verified column set where the concept is identical, so the
red-dot component and any shared validation logic can be reused with minimal adaptation:

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| invoice_id | uuid not null fk → sales_return_invoice | |
| line_number | integer not null | |
| line_material_type | text not null | `RM`/`PM`/`INT`/`SFG`/`FG` |
| fg_type | text nullable | `MTO`/`HPS`/`MTEST`/`MTS`, FG/SFG only |
| material_id | uuid nullable | |
| manual_sku_name | text nullable | fallback when SKU not in Material Master |
| declared_stroke_number | text nullable | **same column name/semantics as `sales_order_line.declared_stroke_number`**, red-dot source |
| batch_number | text nullable | typed/looked-up per §134.5 step 3 |
| batch_resolved | boolean not null default false | server-computed at save time (does this batch_number resolve against `process_order` for this Prodshade+company+po_type?) — drives the item's own red dot on reload, and is what PR22's Pending Entries query (§134.9) filters on |
| packing_order_id | uuid nullable fk → `erp_production.packing_order` | **FG lines under MTO/HPS/MTEST only** (§134.5 point 6) — auto-derived at save time from `(company_id, material_id, batch_number)` against `packing_order`; NULL if unresolved (non-blocking) or ambiguous-and-not-yet-picked. This is a **stored FK, not just a text match** — IN02/IN03's `resolveLotRefStrict()` joins through it (§134.5 point 6's "how this shows up in IN02/IN03" note), and PR23's Pending-Entries save step explicitly backfills it (§134.9's PR23 half) |
| expiry_date | date nullable | |
| num_packs | numeric nullable | |
| per_pack_qty | numeric nullable | |
| quantity | numeric not null | derived `num_packs × per_pack_qty`, base UOM |
| uom_code | text not null | |
| is_repacked | boolean not null default false | |
| stock_document_id | uuid nullable | set after P651 posting |
| stock_ledger_id | uuid nullable | idempotency guard column, §8D pattern — check before posting |
| created_at | | |

Batch-mandatory-by-type validation (§134.5 matrix) is a handler-level check
(`MTO`/`HPS`/`MTEST`/`SFG` → hard-require `batch_number`; `MTS`/`RM`/`PM`/`INT` → optional) — do not
enforce it via a DB CHECK constraint, mirror how `sales_order_line`'s equivalent per-type rules live
in `prepareUnifiedSoLine()`, not in the schema.

### A.4 `erp_procurement.sales_return_repack_line` (child of item, only when `is_repacked = true`)

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| item_id | uuid not null fk → sales_return_item | |
| target_material_id | uuid nullable | |
| target_manual_sku_name | text nullable | fallback |
| num_packs | numeric nullable | |
| per_pack_qty | numeric nullable | auto-filled read-only when target SKU's pack_code is `bom_required=true` (read from `pack_code_master`/Pack BOM conversion factor); manual otherwise |
| quantity | numeric not null | |
| uom_code | text not null | |
| stock_document_id | uuid nullable | set after P651 posting (posts for the target SKU, §134.6) |
| stock_ledger_id | uuid nullable | idempotency guard |
| created_at | | |

**Reconciliation constraint (handler-level, not DB-level):** `SUM(sales_return_repack_line.quantity)
WHERE item_id = X` must equal `sales_return_item.quantity` for that item before the receipt can be
saved/posted, whenever `is_repacked = true`.

---

## Work Stream B — Backend handlers

New file `supabase/functions/api/_core/procurement/sales_return.handlers.ts` (or under a `sales/`
subfolder matching wherever `sales_order.handlers.ts`/`delivery_order.handlers.ts` currently live —
check first, follow existing convention, don't invent a new folder layout).

- `listSalesReturnReceiptsHandler` — company-scoped list (§8A: resolve every FK to a label; §8E:
  chunk any `.in()` over ids from a broad filter).
- `createSalesReturnReceiptHandler` — Page 1+2 combined create (or split create-draft/save-items,
  match whatever pattern `sales_order.handlers.ts`'s create+update-lines split already uses — do not
  invent a different shape without a reason). Validates: Sending Location resolves per
  `return_type` (reuse `resolveBillToShipTo()`'s logic, generalized to the 5 return types incl.
  `STO`); per-item batch-mandatory matrix (§134.5); per-repack-group quantity reconciliation
  (§134.6).
- **Posting** — on Save/Post, for every item: if not repacked, post P651 for the item's own
  `material_id`/`quantity`; if repacked, post P651 once per repack sub-row for its
  `target_material_id`/`quantity`, **never** for the parent item's own material. Route this through
  `post_document()` inside one transaction per receipt (§8D pattern — see
  `complete_pgi_invoice_action` migration as the template for a multi-line, one-transaction posting
  function). Idempotency guard: skip any item/repack-line that already has `stock_ledger_id` set
  (§8D §3's pattern), in case of retry. **Every P651 posting must tag
  `reference_document_type='SALES_RETURN'`, `reference_document_id=<sales_return_item.id>` (or the
  repack sub-row's id, if repacked), `reference_document_number=<receipt_number>`** on the resulting
  `stock_document` row (§106 Phase-2 pattern, §134.5 point 6) — this is what Work Stream F below
  needs to resolve Packing PO Number correctly in IN02/IN03.
- **Before posting, attempt to auto-resolve `packing_order_id`** for every FG item under
  MTO/HPS/MTEST (§134.5 point 6): query `erp_production.packing_order` on
  `(company_id, material_id, batch_number)`. Zero matches → leave NULL, don't block. One match →
  set it. Multiple matches → surface the choices to the frontend for the user to pick one before
  Save completes (this is a real UI step, not silently picking the first match).
- `resolveBatchNumberOptionsHandler` (typeahead) — `company_id` + derived Prodshade + `po_type` +
  `batch_number ILIKE` against `erp_production.process_order`, per §134.5 step 3.
- `listRepackTargetSkuOptionsHandler` — Prodshade → other-pack-code SKUs (the reverse lookup called
  out under "Read first" above — new query, not an existing helper).
- `listPendingReturnInvoicesHandler` + `saveReturnInvoiceDetailHandler` — the Accounts-tab queue
  (§134.7). Save only sets `detail_status='DETAIL_CAPTURED'` and stores the fields — **no** payable
  document creation (§134.10 out of scope, leave the `-- TODO §134.10` marker at this exact spot).
- `listPendingStrokesHandler` (Stroke Master's new button, §134.8) — union declared_stroke_number
  from `sales_order_line` (SO01) and `sales_return_item` (SO05), left-join `stroke_master` on
  `{prodshade_material_id, po_type, stroke_number}`, filter to unresolved, dedupe. Batch this query
  (§8B), do not loop per declared stroke.
- `listPendingGenealogyEntriesHandler` (PR22/PR23's new button, §134.9) — **two distinct queries,
  not one shared one** (they filter/group differently, per §134.9's PR22 vs PR23 halves):
  - PR22 half: `sales_return_item` rows with `batch_resolved=false`, grouped by
    `{prodshade, description, stroke}`, `SUM(quantity)` in base UOM.
  - PR23 half: `sales_return_item` rows with `line_material_type='FG'` AND `fg_type IN
    ('MTO','HPS','MTEST')` AND `packing_order_id IS NULL`, grouped by
    `{prodshade, description, stroke, material_id/SKU}` (material-specific, per §134.9) — **not**
    just `batch_resolved`, since a line can have a resolved batch but still an unresolved Packing PO.
- **PR23's own create/save handler must backfill `packing_order_id`** (§134.9's PR23 half,
  §134.5 point 6): after inserting the new `packing_order` row, `UPDATE sales_return_item SET
  packing_order_id = <new row's id> WHERE material_id = <new row's material_id> AND batch_number =
  <new row's batch_number> AND packing_order_id IS NULL`. This is the **one** place in this whole
  feature where an explicit write-after-the-fact on `sales_return_item` is required — do not skip
  it, IN02/IN03's Packing PO column depends on it (Work Stream F).

## Work Stream C — Frontend

- `SO05CreatePage.jsx` (or whatever name matches the renamed route from §134.2) — Page 1 (merged
  Sending Location resolver + Transporter picker, reusing the fixed `TransporterPicker`) → Page 2
  (nested Invoice cards, each with tick ON/OFF revealing/hiding the extra fields, and a per-Invoice
  `ErpDenseGrid` of Items with the SO01-style red-dot Stroke/Batch cells and inline Repack sub-rows).
- `SO05ListPage.jsx` — list/search, company-scoped, §8A-compliant (resolve every FK).
- Accounts tab / `SO05InvoicePostingPage.jsx` (or a tab within the same screen, match whichever
  pattern `SalesInvoiceListPage.jsx`/`PgiInvoiceCreatePage.jsx` (§113.15) used for their own
  pending-queue-then-detail-page split) — "Show all invoices" toggle, column search bar, row → fill
  deferred fields → Save.
- Stroke Master page — add "Pending Strokes" button + drawer/modal with `ErpDenseGrid`, disabled
  when the list is empty (§134.8).
- PR22 (`OldProcessPoPage.jsx`) and PR23 — add "Pending Entries" button, same pattern (§134.9).

Use `useQuery` everywhere (never `useEffect`+`setState` for data fetching, per §8A's "back-and-forth
navigation" rule), and invalidate/update the relevant query keys after every mutation (Return Receipt
save, Invoice Posting save, Pending Strokes resolving as strokes get approved elsewhere).

## Work Stream D — ACL / menu wiring

1. Rename the existing prod+dev `erp_menu.menu_master` row (`id=7fb7ad07-...`, currently
   `menu_code=PROC_FG_RETURN_LIST`, `title="FG Return"`) → `menu_code`/`resource_code` =
   `PROC_SALES_RETURN_LIST`, `title` = `"Sales Return"`, `route_path` =
   `/dashboard/procurement/sales/sales-return`. Update the matching `acl.menu_master` row identically
   (§8's hard rule: the two `menu_code`s must match).
2. Add route-ACL-registry entries for every new endpoint in Work Stream B
   (`route-acl-registry-guard.mjs` will fail the build otherwise).
3. Decide the capability — likely extends whichever capability already grants Sales module access
   (check what SO01/SO03/SO04 use) rather than inventing a new one, unless the business owner wants
   Sales Return separately gate-able. Confirm before hardcoding.
4. Run the §8 4-step MCP sequence (`capture_acl_version_source` → `generate_acl_snapshot` →
   `rebuild_acl_menu_snapshot`) in **dev first**, verify the page appears in a real user's menu
   snapshot, then repeat in **prod** alongside the code deploy.
5. Pending Strokes / Pending Entries buttons need no new ACL resource — they live inside pages
   (Stroke Master, PR22, PR23) whose ACL is already wired; just gate the button's visibility the same
   way the rest of that page already is (no new hardcoded role list — pattern #1/#12 in CLAUDE.md's
   bug checklist).

## Work Stream E — Document number range (✅ LOCKED — global, not company-scoped, 2026-09-25)

**`receipt_number` MUST use the global doc-number engine** —
`erp_procurement.document_number_series` + `generate_doc_number()`, exactly like every row in §8's
table (GE, GRN, SO, DC, PROC_PO, ...). **Do not** use
`erp_procurement.company_doc_number_series`/`generate_company_doc_number()` (the per-company,
FY-prefixed counter, format like `ASCPROC2627-0001`).

This is an explicit repeat-mistake warning: §8 documents that Process PO/Packing PO were originally
built against the company-scoped counter by mistake during Gate-27, and had to be migrated onto the
global range afterward (§8's "PROC_PO/PACK_PO correction" note, migration + old rows deactivated).
Sales Return must go global from day one — a 10-digit band, business owner confirmed, no
per-company/per-FY prefix.

Register a new band in `document_number_series` (dev via MCP first, then a migration + matching MCP
row in prod, per §8's existing convention for this table). Confirm the exact prefix/leading-digit
band with the business owner or SA before hardcoding — do not reuse or overlap an existing type's
band (see §8's table for what is already taken).

## Work Stream F — IN02/IN03: Packing PO Number resolution for Sales Return rows (✅ LOCKED — 2026-09-25)

**In scope for this pass** (small, well-defined, and without it the Packing PO reference the rest
of this brief builds is invisible in the two reports that matter most — do not defer this to a
follow-up task).

`supabase/functions/api/_core/procurement/stock_reports.handlers.ts` already has a proven,
shared-by-IN02-and-IN03 mechanism for exactly this class of problem — read
`buildOpeningStockLotMap()` (~line 220) and `resolveLotRefStrict()`/`resolveLotRef()` (~line 290)
in full before touching either. Do not invent a parallel mechanism.

1. Add `buildSalesReturnLotMap(docs: JsonRecord[]): Promise<Map<string, string>>`, mirroring
   `buildOpeningStockLotMap()`'s shape exactly:
   - Filter `docs` to `reference_document_type === 'SALES_RETURN'`, collect
     `reference_document_id` values (these are `sales_return_item.id`s, per Work Stream B's posting
     tag — **note this is simpler than `buildOpeningStockLotMap()`**, which has to key by
     `document_id::material::batch` because Opening Stock's `reference_document_id` points at the
     document *header* with many lines; Sales Return's `reference_document_id` points straight at
     the *line*, so the map only needs to be keyed by `reference_document_id` itself).
   - Fetch those `sales_return_item` rows, `.not("packing_order_id", "is", null)`.
   - Resolve `packing_order_id → packing_order.po_number` (chunk both `.in()` calls, §8E).
   - Return `Map<sales_return_item.id, po_number>`.
2. In `resolveLotRefStrict()`, add a new branch alongside the existing `PACK_PO`/`OS` cases:
   ```ts
   if (toTrimmedString(doc.reference_document_type) === "SALES_RETURN") {
     const poNumber = salesReturnLotMap.get(toTrimmedString(doc.reference_document_id));
     if (poNumber) return poNumber;
   }
   ```
   Thread a new `salesReturnLotMap` parameter through `resolveLotRefStrict()` and `resolveLotRef()`
   the same way `openingLotMap` is already threaded — every call site of `resolveLotRef()` (there
   are several across IN02/IN03/`fgStockBreakdownHandler` per the grep in "Read first") needs the
   new map built and passed alongside the existing `openingLotMap`/`batchPoMap` args. Find every
   call site with `grep -n "resolveLotRef(" stock_reports.handlers.ts` — do not miss one.
3. **Do not** add a `SALES_RETURN` case to the `source_lot_ref`-producing trigger
   (`derive_source_lot_ref()`, migration `20260719210000`) — that trigger is deliberately scoped to
   real production postings (`reference_document_type='PACK_PO'` + P101 + IN) per its own existing
   design; Sales Return's resolution path is the `reference_document_type` branch in
   `resolveLotRefStrict()`, a separate and simpler mechanism, not an extension of the trigger.
4. Verify: create a test Sales Return receipt in dev with an unresolved Packing PO (a batch/SKU with
   no existing `packing_order` row), confirm IN02/IN03 show the fallback (inherited from
   `batchPoMap` if another row resolves it, else the receipt's own `receipt_number`) — then create a
   matching PR23 entry, confirm the backfill (Work Stream B) ran, and confirm the **same** IN02/IN03
   query now shows the real Packing PO number **without re-posting anything**.

---

## Open questions to raise with the business owner before/while building (do not guess)

- Exact `receipt_number` prefix/band (Work Stream E).
- Which capability should gate SO05 (Work Stream D.3).
- Confirm the STO return-type's Sending Company resolution UI (single company picker from
  `companies` master — no existing SO01 precedent to copy since `sales_order.dispatch_type` has no
  `STO` value at all, this is genuinely new for Sales Return).
