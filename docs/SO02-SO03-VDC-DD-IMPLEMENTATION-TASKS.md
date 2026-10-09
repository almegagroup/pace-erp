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

## Phase 1 — Customer + Site + Transporter bulk resolution (SO Map Excel Upload)

- [ ] **T6.** Backend: bulk-resolve endpoint(s) for the SO Map Excel template rows
  (GST-based resolve/auto-create, name-based Choose-from-N/Create-New, VDC-scoped
  search) — driving **existing** `createCustomerHandler`/`createCustomerAddressHandler`
  (never duplicating their logic), ending in calls to **existing**
  `saveSoMapGroupHandler(source: "address")` per resolved row/group.
- [ ] **T7.** Backend: Transporter bulk-resolve (reuse existing `/procurement/transporters`
  search; add Choose-from-N/Create-New semantics matching Customer/Site pattern).
- [ ] **T8.** Backend: upload validation (duplicate key, changed-qty Confirm/Remove,
  out-of-SO SKU highlight, Qty-vs-balance hard check) per §6 point 12.
- [ ] **T9.** Frontend: "Bulk DD SO Map" button + template download inside the
  **existing** `SO01MapPage.jsx` (additive tab content, not a new page).
- [ ] **T10.** Frontend: Review Grid (SO Number/SKU resolved, DD Flagged column,
  Customer/Site resolve drawers, Save).
- [ ] **T11.** Verify against real data (a real VDC SO + a slice of the real Tally
  Excel), `deno check`/`eslint` clean, re-run all `.mjs` guards.

## Phase 2 — Bulk DO Upload (SO03)

- [ ] **T12.** Backend: bulk-resolve + validate endpoint for the Bulk DO Upload
  template (FO/SO type-mismatch check, Storage Location dropdown, Transporter
  resolve, stock-check/reservation per §6 point 18) — driving **existing**
  `createDeliveryOrderUnifiedHandler` per resolved FO/SO group, never new DO-write
  logic.
- [ ] **T13.** Frontend: "Bulk DO Upload" button + template on `DOListPage.jsx`
  (SO03), Review Grid, Save.
- [ ] **T14.** Verify against real data, guards, SU24.

## Phase 3 — Edit Transporter Details (pre-PGI, FO-keyed)

- [ ] **T15.** Backend: new endpoint, FO-Number-keyed, editing Transporter/LR
  Number/LR Date/Truck Number/Dispatch Date on a VDC DO **before** PGI (status
  still CREATED/invoice-only) — this is new, since `amendDispatchDetailsHandler`
  only works post-DISPATCHED. Decide: extend that RPC with a pre-PGI branch, or a
  parallel new RPC — pick whichever requires zero change to the existing
  post-DISPATCH amend path.
- [ ] **T16.** Frontend: "Edit Transporter Details" button on SO03, FO Number
  prompt, 5-field editor.

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
