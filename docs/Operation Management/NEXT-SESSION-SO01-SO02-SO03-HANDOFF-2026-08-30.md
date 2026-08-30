# SO01 / SO02 / SO03 Handoff - 2026-08-30

## Purpose

Continue the Sales Order, Delivery Order, and PGI/Invoice work safely from the
current `dev` worktree. Do not discard or overwrite existing uncommitted work.
The immediate priority is to make SO01, SO03, and SO02 document writes atomic.

## Mandatory Reading Before Any Change

Read these files first, in this order:

1. `C:\Users\cpalm\Documents\pace-erp\CLAUDE.md`
   - Read the recurring bug patterns, migration integrity rules, SU24/ACL
     requirements, company-scope rules, sequential-write cautions, and the
     MCP-vs-migration rule at approximately section 8A / line 1460.
2. `C:\Users\cpalm\Documents\pace-erp\docs\Operation Management\PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
   - SO01: sections 133.7 through 133.11, especially SO Map section 133.9.
   - SO03: section 133.12 and the DO/reservation lifecycle.
   - SO02: sections 133.13 through 133.16.
   - Plan Feed / FO / Packing PO allocation: sections 83.18 and 131.5.
   - FG SKU mismatch exception, DO/Reservation/Invoice lifecycle, and the
     Dispatch Reco section 133.14.
3. `C:\Users\cpalm\Documents\pace-erp\docs\Operation Management\implementation-specs\OM-IMPLEMENTATION-LOG.md`
   - Read the applicable implementation rules, particularly R-04 (MCP vs
     migration), and append a concise dated entry after the work is verified.
4. `C:\Users\cpalm\Documents\pace-erp\docs\PACE_ERP_MASTER_CONSTITUTION.md`
   - Use this for migration-first, security-definer, schema, and code-header
     rules.
5. `C:\Users\cpalm\Documents\pace-erp\docs\Operation Management\implementation-specs\CODEX-MM04-FG-CUSTOMER-REDESIGN-TASK-BRIEF.md`
   - Customer address, Parent Company, VDC/DC, same-state, and
     `customer_address.depot_code_id` rules.
6. `C:\Users\cpalm\Documents\pace-erp\docs\SESSION-HANDOFF-BRIEF-2026-08-13.md`
   - Existing SU24/ACL and OM implementation-log pointers.

Do not invent a separate document named "Migration Vs MCP Rules" or "OM
Implementation Rules". In this repository their authoritative rules are in
`CLAUDE.md` and `OM-IMPLEMENTATION-LOG.md`.

## Current Branch And Working Tree

- Branch: `dev`
- Last committed revision when this report was created: `4b9617f4`
  (`Fix SO02 queue source hydration scope`)
- The following changes are intentionally uncommitted and must be retained:
  - `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
  - `frontend/src/pages/dashboard/procurement/sales/PgiInvoiceGroupsCreatePage.jsx`
  - `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx`
  - `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx`
  - `supabase/functions/api/_core/procurement/do_unified.handlers.ts`
  - `supabase/functions/api/_core/procurement/sales_order.handlers.ts`
  - `supabase/migrations/20260830090000_reconcile_pgi_reservation_issue_status.sql`
  - `supabase/migrations/20260830100000_sales_invoice_freight_to_pay.sql`

Never use `git reset --hard`, `git checkout --`, or any bulk revert on this
worktree. Start by running `git status --short` and reading the diff.

## What Is Already Implemented

### SO01 - Sales Order And SO Map

- SO Map is destination-first and supports FO, customer-address, and depot
  mapping, including the FG MTO/HPS/MTEST mismatch confirmation exception.
- Active mappings are locked once a DO exists; unmap/release uses status
  `RELEASED`, never a hard delete.
- FO-mapped quantities use item-level capacity and the FO's assigned customer
  address; Packing PO/batch traceability is available in Plan Feed/DO.
- Existing SO01 work is functional, but SO Map group save and group release
  are not a single database transaction. See the atomicity gap below.

Key backend file:
`supabase/functions/api/_core/procurement/so_map.handlers.ts`

### SO03 - Delivery Order

- DO is truck-first, then SO/STO selection, then mapped-line selection and
  truck quantity/storage-location adjustment.
- One vehicle can contain multiple SO/STO sources and multiple Ship-To
  addresses. The stored DO line freezes Ship-To, Bill-To derivation inputs,
  material, batch, Packing PO, quantity, UOM, commercial values, and storage
  location needed by P601.
- Pick drawer is selection-only; quantity/storage location are edited in the
  picked-items grid. Batch and Packing PO resolve from FO/Packing PO.
- Net weight is the sum of selected base quantities. Driver field is driver
  name/number text plus contact number.
- `DO_SOURCE_LINE_NOT_FOUND` and source-link failures were previously fixed.
- DO create/edit is currently implemented through sequential service-role
  inserts/updates. It is not all-or-nothing yet.

Key backend file:
`supabase/functions/api/_core/procurement/do_unified.handlers.ts`

### SO02 - PGI And Invoice

- SO02 now starts with a DO selector, then renders a per-resulting-invoice
  grid. It does not expose an unnecessary nested DO-detail workflow.
- One resulting row is calculated per FO where applicable, or per non-FO
  Ship-To address where IBN is required. Multiple addresses in one DO can
  therefore create multiple invoice rows.
- Main grid includes source, SO/STO, compact line-broken Bill-To/Ship-To,
  Parent Company, VDC/DC, truck, transporter, LR details, IBN, Tally invoice
  number/date, status, and opening action.
- IBN, Tally number, and Tally date are entered on each invoice row; IBN is
  editable/required only where `ibn_required` is true.
- Enter/Open opens a center drawer with invoice preview, document name, batch,
  GST, freight, additional cost, round-off, and live total.
- Freight flow:
  - `FOR`: no freight controls.
  - Other freight terms: ask `To Pay?` first.
  - `To Pay = Yes`: customer pays freight; no freight amount/GST is added.
  - `To Pay = No`: ask `Other than Order Rate?`; then optional Ad Hoc or Rate
    x the current invoice group's net weight, with optional GST treatment.
  - `freight_to_pay` is persisted on the invoice header and shown on invoice
    detail. Do not remove the backend guard that ignores crafted freight
    amounts when `to_pay=true`.
- Additional Cost supports a reusable inline-creatable category, several
  removable flat amount lines, per-line GST treatment, live total, and stored
  `sales_invoice_additional_cost_line` rows.
- Posted invoice detail has a read-only Dispatch Reconciliation dense grid.
- Each individual invoice group's P601 movement, invoice rows, additional
  costs, Dispatch Reco rows, and reservation status update occur inside
  `erp_inventory.post_document`, so one invoice group is atomic.
- New reservation trigger derives `OPEN`, `PARTIAL`, or `FULLY_ISSUED` from
  all POSTED invoice lines for the same `dc_line_id`; cancellation is thereby
  corrected as well.

Key files:
- `frontend/src/pages/dashboard/procurement/sales/PgiInvoiceGroupsCreatePage.jsx`
- `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx`
- `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx`
- `supabase/functions/api/_core/procurement/do_unified.handlers.ts`
- `supabase/functions/api/_core/procurement/sales_order.handlers.ts`

## Dev Database State

Dev project: `ytapuwiqicmvpanmzelb` (`pace-erp-dev`). Do not apply anything to
production without explicit user approval and a normal PR/deploy path.

Already applied to Dev and verified:

1. `20260830090000_reconcile_pgi_reservation_issue_status.sql`
   - Trigger `trg_reconcile_pgi_reservation_issue_status` exists.
   - `service_role` has execute permission.
2. `20260830100000_sales_invoice_freight_to_pay.sql`
   - `erp_procurement.sales_invoice.freight_to_pay` exists, default `false`,
     non-null.
   - `SALES_INVOICE` posting registry points to
     `complete_pgi_invoice_action_with_freight_to_pay`.
   - `service_role` has execute permission.

No production schema or production business-data mutation was done for these
two changes.

## Critical Work Still Required: Atomicity

### 1. SO01 SO Map Atomicity

Current functions:
- `saveSoMapGroupHandler` at approximately line 679
- `releaseSoMapGroupById` at approximately line 713

Problem: group row and allocations are separately written; the save loop uses
compensating `RELEASED` updates on failure, which is not a real transaction.

Required outcome:
- A security-definer RPC/migration receives only already validated data.
- It inserts group plus all allocation rows in one transaction, or none.
- Release validates no DO link and releases group plus allocations together.
- Keep handler-side company scope and `PROC_SO_LIST`/SO Map ACL checks; the
  RPC is a write primitive, not an authorization bypass.
- Prevent concurrent allocation overrun with row locking or an equivalent
  database-side capacity check; client-side/pre-RPC checks alone are not
  enough.

### 2. SO03 DO Create/Edit Atomicity

Current functions:
- `createDeliveryOrderUnifiedHandler` at approximately line 892
- `updateDeliveryOrderUnifiedHandler` at approximately line 1027

Problem: header, `delivery_challan_source`, `delivery_challan_line`, and
`reservation_document` writes commit one by one. Edit first cancels
reservations, deletes old lines/sources, then builds replacements; a failure
can leave the DO half changed.

Required outcome:
- Create RPC: create header, source links, frozen lines, and reservations in
  one transaction.
- Edit RPC: lock the CREATED DO, cancel only its own reservations by
  `dc_line_id`, undo CSN dispatch as required, replace sources/lines, and
  create replacement reservations in one transaction.
- Preserve all current line fields: SO/STO/map allocation source, material,
  qty, UOM, storage location, batch, expiry, Packing PO, unit value, GST,
  line total, frozen Ship-To fields, and reservation source fields.
- Recheck balances/stock and Packing PO allocation under transaction locks;
  this is needed to prevent two concurrent trucks from consuming the same
  source balance.
- Preserve current ACL and company-scope checks in handlers. Do not add role
  name checks in frontend or backend.

### 3. SO02 Whole-DO PGI Atomicity

Current function:
- `postPgiInvoiceGroupsHandler` at approximately line 1883.

Problem: it loops each invoice group and calls `erp_inventory.post_document`
one at a time. Each group is atomic, but a five-row DO can post rows 1-2 then
fail on row 3. The code currently warns the user to reverse already posted
rows manually.

Required outcome:
- Build every validated invoice-group payload first.
- Add a database function that receives every group and calls the existing
  `erp_inventory.post_document` for every group inside one outer transaction.
- If any group fails, all P601 movements, invoice headers/lines, additional
  costs, Dispatch Reco rows, reservation updates, and the DO status must roll
  back together.
- Keep fresh server-side group calculation and exact submitted-key coverage.
- Keep the existing `is_final_group` behavior or replace it with a single
  final DO-status update only after all groups succeed.
- Do not use compensating reversals as the normal success/failure mechanism.

## Financial Reco Decision Still Needed

Do not silently modify existing Dispatch Reco amounts until the business owner
chooses one formula. Feasibility section 133.14 contains both:

1. `process_order_line_reco x packingPoRatio x invoiceRatio` for RM/INT and
   `packing_order_line_reco x invoiceRatio` for PM.
2. Separate `standardRatio`, `actualRatio`, and `apApprovedRatio` denominated
   by sums of the respective Standard/Actual/AP Approved values.

These can produce different results. Current code uses the first, two-level
formula but applies the same output ratio shape to all three values. The
read-only Dispatch Reco UI is implemented; financial recalculation/backfill is
not. Resolve this explicitly before changing historical or future Reco values.

## Accounts Journal Boundary

GST, taxable value, per-line CGST/SGST/IGST, freight GST, additional-cost GST,
round-off, invoice total, stock movements, and Dispatch Reco snapshots are
already persisted. There is no Accounts Journal/COA/debit-credit design yet.
Do not invent journal entries or backfill financial postings until that design
is approved. Future journal backfill can use these immutable invoice snapshots.

## SU24 / Security Requirements

- Inspect `supabase/functions/api/_acl/route-acl-registry.ts` before changing
  any route. Do not create a route unless it has an exact/pattern ACL entry.
- Existing SO02 routes use `PROC_INV_LIST` (`VIEW` for preview/detail,
  `WRITE` for PGI post). SO03 uses `PROC_DO_CREATE`; SO Map uses the existing
  `PROC_SO_LIST` decision. Preserve these unless the feasibility design says
  otherwise.
- Every handler must check company scope and ACL before invoking any RPC.
- Frontend gating is capability-driven only; backend stays authoritative.
- Validate ACL Master, Production, QA/MTEST access matrix when touching Plan
  Feed/SO Map. No raw role/department checks.

## Required Verification After Implementation

Run only defined repository scripts. On this Windows environment Node may need
elevated execution because sandboxed Node can fail `lstat C:\\Users\\cpalm`.

1. Static and migration checks:
   ```powershell
   node scripts/migration-integrity-check.mjs --list
   node scripts/migration-order-scan.mjs
   node scripts/migration-column-scan.mjs
   node scripts/route-acl-registry-guard.mjs
   node scripts/company-scope-write-acl-guard.mjs
   node scripts/hardcoded-role-check-guard.mjs
   node scripts/frontend-payload-guard.mjs
   git diff --check
   ```
   The migration scans currently report pre-existing historical candidates:
   three old table-order parser candidates and six old `plant_id` column
   candidates. Investigate any new result introduced by this work.
2. Backend import smoke test:
   ```powershell
   $env:SUPABASE_URL='http://localhost'
   $env:SUPABASE_SERVICE_ROLE_KEY='dummy-service-role-key'
   .\node_modules\.bin\tsx.cmd --eval "import './supabase/functions/api/_core/procurement/do_unified.handlers.ts'; import './supabase/functions/api/_core/procurement/so_map.handlers.ts'; import './supabase/functions/api/_core/procurement/sales_order.handlers.ts'; console.log('sales-import-ok')"
   ```
3. Frontend focused lint:
   ```powershell
   cd frontend
   npx.cmd eslint src/pages/dashboard/procurement/sales/PgiInvoiceGroupsCreatePage.jsx src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx
   ```
4. Frontend build:
   ```powershell
   cd frontend
   npm.cmd run build
   ```
   Current unrelated warning: duplicate `emptyMessage` in
   `frontend/src/pages/dashboard/procurement/grn/GRNListPage.jsx`.
5. Dev DB only, after code/tests are complete:
   ```powershell
   supabase db push --linked --include-all
   ```
   Verify migration history, RPC existence, grants, callback registry, and
   affected constraints/indexes. Do not apply to production without explicit
   approval.
6. End-to-end Dev scenarios:
   - Existing single-item FO and new multi-item FO.
   - Exact SKU mapping and allowed FG MTO/HPS/MTEST mismatch confirmation.
   - RM/PM/INT/SFG/MTS mismatch hard block.
   - One SO item split between FO and no-FO; several SO items to one destination.
   - FO mapping plus Packing PO/batch traceability.
   - DO with multiple SO/STO sources and multiple Ship-To addresses.
   - Multiple invoice rows per DO, per address/FO IBN/Tally input.
   - `To Pay`, Ad Hoc freight, Rate freight, GST inclusive/exclusive, and
     multiple additional cost lines.
   - Force a later group failure and prove no earlier SO02 group is posted.
   - Force SO01/SO03 RPC failure and prove no partial group/DO/reservation rows.
   - Invoice cancellation reopens reservation only to the correct cumulative
     state; cancelled/full-dispatched FO is absent from SO Map.
   - Unauthorized direct API mutation returns a controlled 403, never 500.

## Commit And Push Only After All Checks Pass

1. Review exact files:
   ```powershell
   git status --short
   git diff --check
   git diff --stat
   ```
2. Do not include unrelated files. Add only reviewed SO01/SO02/SO03, migration,
   feasibility, and OM-log files.
3. Commit with a concise message describing the atomic Sales workflow change.
4. Push only to `origin dev` after user approval/request.
5. Report: commit hash, pushed branch, Dev migration versions applied, test
   results, any known warning, and confirmation that production was untouched.
