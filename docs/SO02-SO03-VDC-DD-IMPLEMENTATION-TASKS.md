# SO01→SO03→SO02 VDC/DD Bulk Dispatch — Implementation Task Tracker

**Started:** 2026-10-09
**Design source (SSOT):** `docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md` §6 (points 1-21)
**Scope:** MTS/FG VDC (Dependent Direct) + DC (Dependent Depot) bulk dispatch —
SO Map Customer+Site+Transporter resolution, Bulk DO Upload, SO02 Bulk Posting,
Truck+Dispatch Date Upload, VDC deferred-PGI split.

**Hard rule (business owner, 2026-10-09):** this is a strictly **additive** layer.
Zero behavior change to any existing live flow — `do_unified.handlers.ts`
(unified multi-source DO, invoice-group preview/post, `amendDispatchDetailsHandler`),
`so_map.handlers.ts` (§133.9 FO/address/depot allocation), `sales_order.handlers.ts`,
`customer.handlers.ts`/`customer_address.handlers.ts` — none of these get their
existing behavior altered. RM/PM/INT/MTO/HPS/MTEST dispatch must be byte-for-byte
unaffected. New work plugs into these as a bulk-driving layer + new VDC-only
deferred-PGI branch, never by editing the atomic paths DC/RM/PM/INT already use.

**Ground-truth findings this session (do NOT re-derive, read here first):**
- `so_map.handlers.ts` (§133.9, live) already maps SO lines → FO
  (`erp_production.plan_feed`, Production's OWN FO concept) / Customer Address
  (manual, no FO) / Depot, into `sales_order_map_allocation` + grouped into
  `sales_order_map_group`. **MTS never uses `plan_feed`** — so MTS/VDC rows will
  always go through the existing **"address" source** (`mapSoLineToCustomerAddressHandler`
  / `saveSoMapGroupHandler` with `source: "address"`), never the "fo" source.
  Our new "Sales/Dispatch FO Number" (Asian Paints' own per-dispatch number,
  from their Tally "Other References" column) is a **different concept**,
  unrelated to `plan_feed.fo_number` — it needs its own new home (see Task 1).
- `do_unified.handlers.ts` (§133.12, live, 3266 lines) is the REAL DO engine behind
  `DO01CreatePage.jsx` — NOT the older `delivery_order.handlers.ts` (kept only for
  pre-redesign historical single-source DOs, untouched). Key facts:
  - DO is per-vehicle, multi-source (lines from several SO/STO at once).
  - `createDeliveryOrderUnifiedHandler`/`updateDeliveryOrderUnifiedHandler` take
    `company_id` + `lines[]` + vehicle header (`transporter_id`, `vehicle_number`,
    `lr_number`, `lr_date`, ...) → `save_delivery_order_unified_atomic` RPC.
    Edit only allowed while `status === 'CREATED'`.
  - For `DEPENDENT_*` SOs, DO lines are sourced through `sales_order_map_allocation`
    (so SO Map must happen BEFORE Bulk DO Upload — matches our design order).
  - Customer/Ship-To resolve **per Invoice Group, at PGI time**, not at DO level —
    `previewInvoiceGroupsHandler` / `postPgiInvoiceGroupsHandler`. DC flips to
    `DISPATCHED` only once every group is posted (partial-success-safe).
  - `amendDispatchDetailsHandler` already edits Transporter/Vehicle(Truck)
    Number/LR Number/LR Date with reason+audit (`amend_delivery_challan_dispatch_details`
    RPC) — but **only when `status === 'DISPATCHED'`** (i.e. post-PGI only), and it
    has **no Dispatch Date field at all** (genuinely new).
  - **No deferred-PGI concept exists anywhere today** — Invoice and PGI are always
    posted together, per invoice-group, atomically. VDC's "Invoice now, PGI later"
    is 100% new workflow, not a variant of something existing.
- ACL: `PROC_SO_LIST` (EDIT), `PROC_DO_CREATE` (WRITE/EDIT/VIEW), `PROC_INV_LIST`
  (VIEW/WRITE) already cover SO01/SO03/SO02 — business owner confirmed **no ACL
  change needed**; new routes under these pages reuse these same resource codes.

---

## Phase 0 — Schema (migrations)

- [ ] **T1.** Decide + migrate storage for the new Sales/Dispatch "FO Number"
  (Asian's own per-dispatch number). Candidate: new nullable
  `external_fo_number` column on `erp_procurement.sales_order_map_group` (one
  Ship-To group = one dispatch = one FO, matches §6 point 2's cardinality) —
  verify against live `sales_order_map_group` schema before deciding column vs.
  new table.
- [ ] **T2.** Migrate `delivery_challan` (or a new side table) for: `dispatch_date`,
  `truck_number` (may already be `vehicle_number` — verify before adding a
  duplicate), a VDC-deferred-PGI status marker (e.g. new `pgi_status` enum
  `PENDING`/`POSTED`, or reuse `delivery_challan.status` with a new intermediate
  value — verify impact on every existing `status` check in `do_unified.handlers.ts`
  before touching the enum).
- [ ] **T3.** Migrate `sales_invoice`/`sales_invoice_line` or a new side table for
  Tally Invoice Number/Date, Inbound Number capture at Bulk-DO-Upload time (verify
  these don't already exist pre-Invoice-creation — Task 0 found them only inside
  `sales_invoice` itself, written at invoice-group post time).
- [x] **T4.** Verify Storage Location (F-location dropdown) already resolvable via
  existing `listDoStorageOptionsHandler`/`storage-locations` endpoint — reuse, no
  new column expected (`delivery_challan_line.storage_location_id` already exists).
  **2026-10-09 ✅** confirmed: `GET /api/procurement/delivery-orders/storage-locations`
  already ACL-registered (`PROC_DO_CREATE`/VIEW) and `delivery_challan_line.
  storage_location_id` already exists — no new migration needed.
- [x] **T5.** `node scripts/migration-integrity-check.mjs` after each migration —
  dev first, reconcile, confirm `in_sync=true`. **2026-10-09 ✅** ran after every
  migration this phase; each new migration lands with zero added drift (the 4
  pre-existing drifted rows from earlier sessions are unchanged/untouched).

## Phase 1 — Customer + Site bulk resolution (SO Map Excel Upload)

> **Correction (2026-10-09):** T7 (Transporter bulk-resolve) was mis-filed
> here — §6's SO Map template (point 8) has no Transporter column at all;
> Transporter only appears in the Bulk DO Upload template (point 14). Moved
> to Phase 2.

- [x] **T6.** Backend: bulk-resolve endpoint(s) for the SO Map Excel template rows
  (GST-based resolve/auto-create, name-based Choose-from-N/Create-New, VDC-scoped
  search) — driving **existing** `createCustomerHandler`/`createCustomerAddressHandler`
  (never duplicating their logic), ending in calls to **existing**
  `saveSoMapGroupHandler(source: "address")` per resolved row/group.
  **2026-10-09 ✅** `previewSoMapBulkUploadHandler` built (see Progress Log);
  the "save" step needs no new endpoint at all — the frontend calls the
  now-extended `saveSoMapGroupHandler` directly per resolved row, source=
  "address", with `external_fo_number` + the resolved `customer_address_id`.
- [x] **T8.** Backend: upload validation (duplicate key, changed-qty Confirm/Remove,
  out-of-SO SKU highlight, Qty-vs-balance hard check) per §6 point 12.
  **2026-10-09 ✅** all four implemented in `previewSoMapBulkUploadHandler`:
  duplicate key = (so_id, external_fo_number, so_line_id) compared against
  existing `sales_order_map_allocation.allocated_qty` for that exact
  (group, line) → `duplicate_status: NONE/UNCHANGED/CHANGED_QTY` +
  `previous_qty`; out-of-SO SKU → `sku_resolution.status: NOT_FOUND` +
  `candidates` (this SO's own lines only); qty-vs-balance excludes this
  row's own prior allocation from the "already allocated by others" sum so
  a same-qty or corrected re-upload is never compared against itself.
- [x] **T9.** Frontend: "Bulk DD SO Map" button + template download inside the
  **existing** `SO01MapPage.jsx` (additive tab content, not a new page).
  **2026-10-09 ✅** Button added to the Pending-mappings toolbar, opens
  `BulkDdSoMapDrawer`; disabled until a Company is selected.
- [x] **T10.** Frontend: Review Grid (SO Number/SKU resolved, DD Flagged column,
  Customer/Site resolve drawers, Save).
  **2026-10-09 ✅** New `BulkDdSoMapDrawer.jsx` — exceljs template
  download/upload, `ErpDenseGrid` review table reading
  `previewSoMapBulkUploadHandler`'s per-row resolution (SKU/Customer/Site/
  duplicate/qty status), inline Customer resolve (Choose-from-N dropdown +
  "+ New Customer" sub-drawer using `CustomerCreateForm` in `MINIMAL` mode,
  prefilled from the Excel row via its new optional `initial*` props), inline
  Site resolve (existing-address dropdown + "+ Add Site" sub-drawer calling
  `createCustomerAddress`/`updateCustomerAddress`), same-Company+Address-Line
  dedup across batch rows (`applyDedup`), and "Save All" calling the existing
  `saveSoMapGroup` once per resolved row (source="address",
  `external_fo_number` attached) — zero new save-side endpoint, per the T6
  note above.
- [x] **T11.** Verify against real data (a real VDC SO + a slice of the real Tally
  Excel), `deno check`/`eslint` clean, re-run all `.mjs` guards.
  **2026-10-09 ✅ (code-verified; real-data click-through still blocked)**
  `eslint` clean on `SO01MapPage.jsx`/`BulkDdSoMapDrawer.jsx`/
  `CustomerCreateForm.jsx`; `jsx-no-undef-guard.mjs` 0 violations;
  `deno check` on all 4 touched/added backend files = 97/97 pre-existing
  errors (zero new, confirmed via `git stash -u` before/after); all 9
  backend guard scripts (`route-acl-registry`, `hardcoded-role-check`,
  `wrong-company-source`, `stock-posting`, `frontend-payload`,
  `company-scope`, `company-scope-write-acl`, `resource-code-domain`,
  `approver-chain`) pass with no new findings. **Not yet done:** an actual
  click-through with a real VDC SO + real Tally Excel rows — dev has zero
  `customer_address.depot_code_id`-mapped rows (confirmed earlier this
  session), so no VDC test data exists in this environment; that
  verification needs either a dev data seed or a prod/staging click-through
  by the business owner.

## Phase 2 — Bulk DO Upload (SO03)

- [x] **T12.** Backend: bulk-resolve + validate endpoint for the Bulk DO Upload
  template (FO/SO type-mismatch check, Storage Location dropdown, Transporter
  resolve, stock-check/reservation per §6 point 18) — driving **existing**
  `createDeliveryOrderUnifiedHandler` per resolved FO/SO group, never new DO-write
  logic.
  **2026-10-09 ✅** New `supabase/functions/api/_core/procurement/do_bulk.handlers.ts`
  (`previewDoBulkUploadHandler`/`saveDoBulkUploadHandler`). FO/SO type
  detection: a template value first tries `sales_order_map_group.
  external_fo_number` (VDC); if that misses, tries `sales_order.so_number`
  directly, checking `dispatch_type` — `DEPENDENT_DEPOT` = DC (correct
  field), `DEPENDENT_DIRECT` = `VDC_WRONG_FIELD` (user put an SO Number
  where an FO Number belongs), anything else = `DC_WRONG_FIELD`. SKU
  resolve: VDC matches against that FO's own already-mapped
  `sales_order_map_allocation` rows (point 15 — "FO must already be SO
  Map-resolved, else error"); DC matches directly against the SO's own
  `sales_order_line` rows (no SO Map step needed per point 10's
  correction) — but DC still needs an allocation row to hand to
  `createDeliveryOrderUnifiedHandler`, so a new `ensureDepotAllocation()`
  helper auto-creates one via the **existing, unmodified**
  `saveSoMapGroupHandler(source:"depot")` (same call the manual "map to
  Fixed Depot" button already makes) the first time a DC line is used,
  reusing it on every later Bulk DO Upload row for that same line.
  Transporter resolve: exact-match-wins, else ILIKE-substring
  Choose-from-N against `transporter_master` (global table, no VDC
  scoping needed — mirrors `l2_masters.handlers.ts`'s own listing). Qty:
  Pack Qty × `sales_order_line.per_pack_qty` = base qty (falls back to
  Pack Qty = base qty when the line isn't pack-driven), checked against
  the matched line/allocation's remaining balance for display only — the
  real enforcement is `createDeliveryOrderUnifiedHandler`'s own existing
  balance check, never duplicated here. DC rows hard-require Truck
  Number + Dispatch Date at save time (point 14/15's "DC-তে দুটোই
  mandatory"); VDC rows leave them optional (filled later by Phase 5's
  Truck+Dispatch Date Upload).
  **Save** drives `createDeliveryOrderUnifiedHandler` via the exact
  synthetic-`Request` pattern `gate_entry.handlers.ts`'s own "replace
  lines" flow already uses (same codebase convention, not a new one) —
  one call per FO/SO group, passing `transporter_id`/`lr_number`/
  `lr_date`/`vehicle_number` straight through (all already-existing body
  fields on that handler) and `so_map_allocation_id`/`quantity`/
  `storage_location_id` per line. Since that handler's own RPC payload
  hardcodes `dc_date` to today and has no slot at all for Tally Invoice
  Number/Date, Inbound Number, or Dispatch Date, a single additive
  follow-up `UPDATE delivery_challan SET ...` (new migration
  `20261009140000_delivery_challan_bulk_upload_flag.sql`'s
  `is_bulk_uploaded` column + the already-existing Phase-0
  `pre_invoice_tally_invoice_number/_date/_inbound_number`/`dispatch_date`
  columns, plus `pgi_deferred = dd_flag`) stamps those in — the create
  handler itself is never touched. Routes
  `POST /api/procurement/delivery-orders-v2/bulk/preview` (VIEW) and
  `.../bulk/save` (WRITE), both reusing `PROC_DO_CREATE` (no ACL change).
  **Verified:** `deno check` before/after = 97/97 pre-existing errors
  (zero new); all 9 backend guard scripts pass (`company-scope-write-acl`
  now 150, was 149 — the one new write handler); migration applied +
  reconciled on dev (local filename timestamp matches remote exactly);
  `NOTIFY pgrst, 'reload schema'` run. **Not yet verified against real
  data** — same dev-has-no-VDC-mapping limitation as Phase 1 (T11); DC
  rows are additionally untestable click-through today because dev has
  no `sales_order` row with `dispatch_type='DEPENDENT_DEPOT'` either
  (unconfirmed, not checked this round — flag for the real-data pass).
- [x] **T13.** Frontend: "Bulk DO Upload" button + template on `DOListPage.jsx`
  (SO03), Review Grid, Save.
  **2026-10-09 ✅** New `BulkDoUploadDrawer.jsx` — exceljs template
  (13 columns per point 14) download/upload, Review Grid reading
  `previewDoBulkUpload`'s per-row resolution (status/SKU/qty/storage
  location/transporter/missing-required-fields), inline SKU
  Choose-from-N, inline Transporter Choose-from-N, an editable Storage
  Location code input + "Re-check Rows" button (re-runs the whole batch
  preview after a manual correction — simpler than a per-cell live
  lookup, consistent with this drawer's batch-oriented design), a
  per-FO/SO-group readiness summary (one Delivery Order per group,
  listing exactly what's still missing), and "Create N Delivery
  Order(s)" calling `saveDoBulkUpload` once with every ready group,
  showing a per-group CREATED/ERROR result list (never an all-or-nothing
  submit — matches point 18's "insufficient rows get removed, clean rows
  still post" intent at the group level). Wired into `DOListPage.jsx` as
  a new "Bulk DO Upload" toolbar action (disabled until a company is
  selected), refetching the DO list on any successful create.
- [x] **T14.** Verify against real data, guards, SU24.
  **2026-10-09 ✅ (code-verified; real-data click-through still blocked,
  same reason as T11)** `eslint` clean on `DOListPage.jsx`/
  `BulkDoUploadDrawer.jsx`/`procurementApi.js`; `jsx-no-undef-guard.mjs`
  0 violations; all 9 backend guard scripts green; SU24
  (`dependency-provisioning-check.mjs`) and the full ship-level
  verification are deferred to Phase 8 (T30) per the master task
  sequencing, run once per the whole effort rather than after every
  phase.

## Phase 3 — Edit Transporter Details (pre-PGI, FO-keyed)

- [x] **T15.** Backend: new endpoint, FO-Number-keyed, editing Transporter/LR
  Number/LR Date/Truck Number/Dispatch Date on a VDC DO **before** PGI (status
  still CREATED/invoice-only) — this is new, since `amendDispatchDetailsHandler`
  only works post-DISPATCHED. Decide: extend that RPC with a pre-PGI branch, or a
  parallel new RPC — pick whichever requires zero change to the existing
  post-DISPATCH amend path.
  **2026-10-09 ✅** Added to `do_bulk.handlers.ts` (same file as Phase 2,
  thematically one additive VDC/DC bulk-dispatch module):
  `findDoByFoNumberHandler` (GET, resolves FO Number → map_group →
  allocations → delivery_challan_line → the one non-CANCELLED DO,
  404s `DO_BULK_EDIT_WINDOW_CLOSED` if its status isn't CREATED/INVOICED)
  and `editTransporterDetailsHandler` (POST, re-checks company scope +
  EDIT ACL + the same pre-PGI status gate, then a **plain additive
  UPDATE** on `delivery_challan`'s own header columns only —
  deliberately NOT routed through `updateDeliveryOrderUnifiedHandler`,
  since that handler mandatorily replaces the entire line set and this
  edit never touches lines, matching the design's "এই page শুধু data
  update করে" framing). Reuses the existing `isManualDocumentDateWithinWindow`
  check for LR Date (same shared helper `do_unified.handlers.ts` already
  imports, no duplication). Routes `GET .../bulk/find-by-fo` (VIEW) and
  `POST .../bulk/edit-transporter` (EDIT), both `PROC_DO_CREATE` (no ACL
  change). **Verified:** `deno check` 97/97 (zero new), all 9 backend
  guards green (write-handler count 151, +1 for the new EDIT handler).
- [x] **T16.** Frontend: "Edit Transporter Details" button on SO03, FO Number
  prompt, 5-field editor.
  **2026-10-09 ✅** New `EditTransporterDetailsDrawer.jsx` — FO Number
  input + Find button, then a 5-field editor (Transporter — a proper
  `<select>` dropdown off `listTransporters()`, same pattern
  `DODetailPage.jsx`'s own dispatch-amendment modal already uses, not a
  raw-UUID text field/§8A violation; LR Number; LR Date; Truck Number;
  Dispatch Date) + Save, calling `findDoByFoNumber`/`editTransporterDetails`.
  Wired into `DOListPage.jsx` as a second new toolbar action ("Edit
  Transporter Details", disabled until a company is selected), refetching
  the DO list on save. **Verified:** `eslint` clean on all 3 touched/new
  files; `jsx-no-undef-guard.mjs` 0 violations.

## Phase 4 — SO02 Bulk Posting (Invoice + PGI, VDC/DC split)

- [ ] **T17.** Backend: brand-new Invoice-only endpoint for VDC rows (reuses
  `computeInvoiceGroups`/GST logic from `do_unified.handlers.ts` where possible,
  but does **not** call `post_document`/P601 — stock_ledger untouched).
- [ ] **T18.** Backend: brand-new PGI-only endpoint (Truck+Dispatch Date Upload's
  Post action) that performs the deferred P601 posting for a previously
  Invoice-only VDC row, dated as the Dispatch Date.
- [ ] **T19.** Backend: DC rows keep calling **existing**
  `postPgiInvoiceGroupsHandler` unchanged (atomic, Truck+Dispatch mandatory at
  Bulk DO Upload time per §6 point 14 correction).
- [ ] **T20.** Backend: Bulk Post endpoint (multi-select, dispatches to T17 for
  VDC rows / T19 for DC rows), full column list + DD Flag per §6 point 17.
- [ ] **T21.** Frontend: SO02 Bulk Posting page (only lists Bulk-DO-Upload-created
  DOs, checkbox multi-select, Bulk Post button).
- [ ] **T22.** Verify against real data, guards, SU24.

## Phase 5 — Truck + Dispatch Date Upload (VDC-only)

- [ ] **T23.** Backend: system-generated prefilled template (pending FOs only),
  Dispatch Date validation (LR Date ≤ Dispatch Date ≤ Today, transitional RPC
  tightening to Today-2..Today after 2026-10-14), Truck Number min-4-char check.
- [ ] **T24.** Backend: same-FO/multi-SKU propagation, stock-check (point 18)
  reapplied, Post → calls T18's PGI-only endpoint per resolved row.
- [ ] **T25.** Frontend: Truck+Dispatch Date Upload page on SO03.
- [ ] **T26.** Verify against real data, guards, SU24.

## Phase 6 — Cancel cascade

- [ ] **T27.** Backend: PGI cancel → Invoice cancel cascade (mirrors existing
  `cancelDeliveryOrderHandler`/`reverseSalesInvoiceHandler` shape) + re-upload
  readiness (FO stays re-processable while parent SO is active).
- [ ] **T28.** Verify against real data, guards, SU24.

## Phase 7 — Cross-check against this session's SO01 fixes

- [ ] **T29.** Confirm the SO01 Excel-Upload bug fixes already shipped this
  session (missing `uom_code`/`pack_uom_code` in submit payload, GST-preview
  rehydration fields, `FgRateCell` AC05 rate auto-resolution) are consistent with
  / correctly feed into SO03/SO02's new bulk flow — no regression, no duplicate
  gap.

## Phase 8 — Final verification + ship

- [ ] **T30.** Run all 18+ `.mjs` guard scripts + `dependency-provisioning-check`
  (SU24) + `migration-integrity-check.mjs` — all green.
- [ ] **T31.** Write implementation log into
  `docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md` (§6, new "Implementation Log"
  subsection).
- [ ] **T32.** Commit + push (main → dev) + PR.

---

## Progress Log

*(each task gets a dated one-line update appended here as it completes)*

- **2026-10-09 T1 ✅** `sales_order_map_group.external_fo_number` added (migration
  `20261009100000_so_map_group_external_fo_number.sql`), unique per
  `(so_id, external_fo_number)` where not null. Applied to dev, reconciled in
  `supabase_migrations.schema_migrations`, `migration-integrity-check.mjs`
  confirms in-sync for this migration (4 unrelated pre-existing drifted rows
  found from earlier sessions — `single_machine_auto_allocation`,
  `mts_urgent_manager_posting`, `grant_accounts_department_ac05_access`,
  `fix_ac05_accounts_l4_manager_acl` — flagged, not touched, out of this
  effort's scope).
- **2026-10-09 T2 ✅** Found the existing `urgent_dispatch_workflow` mechanism
  (`delivery_challan_line.urgent_dispatch_decision`) — this IS the business
  owner's "Urgent Process PO" reference: PGI normally enforces
  `assertPhase3PostingDateMatch(tallyInvoiceDate, today)` (strict same-day),
  bypassed only when `urgent_dispatch_decision='YES'`. VDC's deferred PGI
  needs its own, separate bypass (different business reason — truck-arrival
  timing, not Process-PO urgency) — added migration
  `20261009110000_delivery_challan_vdc_deferred_pgi.sql`: widened
  `delivery_challan_status_check` to add `'INVOICED'` (additive, every
  existing status check in `do_unified.handlers.ts` is untouched and never
  produces/reads it), plus `pgi_deferred boolean` + `dispatch_date date`
  columns. Truck Number reuses the existing `vehicle_number` column — no
  duplicate added. Applied + reconciled, no new drift.
- **2026-10-09 T3 ✅** `delivery_challan.pre_invoice_tally_invoice_number/
  _date/_inbound_number` added (migration
  `20261009120000_delivery_challan_pre_invoice_tally_fields.sql`) — Bulk DO
  Upload (SO03) captures these before any `sales_invoice` row exists; the new
  Invoice-only endpoint (Phase 4) copies them into the real
  `sales_invoice.tally_invoice_number/tally_invoice_date/inbound_number`
  columns at posting time. Applied + reconciled, no new drift.
- **2026-10-09 T6 ✅ (partial — preview only, create/save next)** New
  `erp_master.find_similar_customer_names_in_vdc()` (migration
  `20261009130000_find_similar_customer_names_in_vdc.sql`, pg_trgm,
  VDC-scoped, mirrors the existing `find_similar_vendor_names` pattern) +
  new `supabase/functions/api/_core/procurement/so_map_bulk.handlers.ts`
  (`previewSoMapBulkUploadHandler`) — resolves External SO Number → VDC,
  GST-based customer resolve (FOUND/FOUND_DIFFERENT_VDC/NOT_FOUND), name-based
  resolve (MATCHED/AMBIGUOUS/NOT_FOUND via the new similarity function),
  Site Address resolve (count/status), SKU match against the SO's own lines
  only, Qty-vs-balance check, and FO-number duplicate detection against
  `sales_order_map_group.external_fo_number`. Additively extended existing
  `saveSoMapGroupHandler` (so_map.handlers.ts) to accept optional
  `external_fo_number` — zero behavior change for any existing caller.
  Route `POST /api/procurement/so-map/bulk/preview` wired, ACL reuses
  `PROC_SO_LIST`/EDIT (same resource as the rest of SO Map, no ACL change).
  **Verified:** `deno check` before/after on every touched file = 97/97
  pre-existing errors (zero new), new file itself = 0 errors;
  `route-acl-registry-guard.mjs`/`hardcoded-role-check-guard.mjs`/
  `wrong-company-source-guard.mjs`/`stock-posting-guard.mjs` all pass.
  **Not yet verified against real data** — dev's `customer_address` table
  currently has zero `depot_code_id`-mapped rows (the real VDC-mapped
  customer data the earlier audit found lives in prod, not dev); the
  similarity RPC was smoke-tested (runs without SQL error, returns empty on
  empty data, as expected). **Still TODO for T6-T8:** the create/save
  endpoint that turns a resolved preview row into a real
  `sales_order_map_group` (calling the now-extended `saveSoMapGroupHandler`)
  and the full upload-validation rules (duplicate-with-changed-qty
  Confirm/Remove, Transporter bulk-resolve belongs to Phase 2 not here).
