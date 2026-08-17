# CODEX-IN10-IN11-LOCATION-TRANSFER-MB21-MIGO-TASK-BRIEF

**Domain:** INVENTORY
**Reference:** feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
Section **121** in full. Read it first, then read `CLAUDE.md`, `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`, and `docs/Operation Management/PROD-ACL-Access-Decisions.md` before touching code.

**Mission:** build a proper SAP-inspired internal location-transfer flow:

- `IN10` = MB21/MB22-style request/reservation maintenance
- `IN11` = MIGO-style posting/reversal workbench

This is **not** the existing PTO flow, and it is **not** the current direct `/api/procurement/sloc-transfer` shortcut.

---

## 0. Non-negotiable rules

1. Follow `CLAUDE.md` migration rules exactly.
2. Follow the OM Implementation Log rules exactly.
3. Use the ACL decision doc's dependency taxonomy and post-implementation checklist exactly.
4. Use SAP screen logic, but build with existing PACE ERP shell/components.
5. Do not improvise a simpler design because a shortcut already exists in code.
6. Do not collapse the whole transaction into one giant page. Use staged pages/full-page workspaces exactly as locked in feasibility §121.7 and §121.7.1.

---

## 1. Current-state audit you must confirm before implementing

Verify these claims in the live repo before writing code:

1. Existing direct location transfer lives in `supabase/functions/api/_core/procurement/pto.handlers.ts` and immediately posts `P311`.
2. Existing PTO is approval-based and stored in `erp_procurement.plant_transfer_order`, so it is not the right document model for IN10/IN11.
3. `erp_production.reservation_document` already supports `source_type = 'LOCATION_TRANSFER'`.
4. `erp_inventory.stock_document` already has `reference_document_*`, `reversal_document_id`, `source_lot_ref`, `document_number`, and `document_year`.
5. Live stock grain differs by family:
   - RM/PM/INT generic pool
   - SFG batch-specific
   - FG often needs `batch_number + source_lot_ref`

If any one of these is false in code/DB by the time you start, stop and correct the brief assumptions in the log first.

---

## 2. DB work

### 2.1 New migration(s)

Create new local migration file(s), never edit an already-pushed migration.

### 2.2 New tables

Add:

1. `erp_inventory.location_transfer_request`
2. `erp_inventory.location_transfer_request_line`
3. `erp_inventory.location_transfer_posting`

### 2.3 Required fields

`location_transfer_request`

- `id`
- `ltr_number` unique
- `company_id`
- `status` check in `('OPEN','PARTIALLY_POSTED','POSTED','CANCELLED')`
- `request_date`
- `required_by_date`
- `remarks`
- `created_by`, `created_at`
- `last_updated_by`, `last_updated_at`
- `cancelled_by`, `cancelled_at`, `cancellation_reason`

`location_transfer_request_line`

- `id`
- `request_id`
- `line_no`
- `source_storage_location_id`
- `target_storage_location_id`
- `material_id`
- `requested_qty`
- `uom_code`
- `stock_type_code`
- `batch_number` nullable
- `source_lot_ref` nullable
- `posted_qty` default 0
- `status` check in `('OPEN','PARTIALLY_POSTED','POSTED','CANCELLED')`
- `remarks`
- `created_by`, `created_at`
- `last_updated_by`, `last_updated_at`

`location_transfer_posting`

- `id`
- `request_id`
- `request_line_id`
- `movement_type_code` check in `('P311','P312')`
- `posted_qty`
- `uom_code`
- `batch_number` nullable
- `source_lot_ref` nullable
- `material_doc_number`
- `material_doc_year`
- `stock_document_id_out`
- `stock_document_id_in`
- `reversal_of_posting_id` nullable
- `posted_by`, `posted_at`
- `remarks`

### 2.4 Extend existing reservation model

Add nullable `source_lot_ref` to `erp_production.reservation_document`.

Reason:

- FG exact identity cannot always be modeled by `batch_number` alone.
- IN10 reservation must match the same identity grain that IN11 will post.

### 2.5 Constraints and indexes

Add sane indexes for:

- request header company/status/date
- request line request/material/source/target/status
- posting request_line / reversal_of_posting_id
- reservation_document lookup by source_type/source_id/source_line_id
- reservation_document batch + source_lot_ref lookup

### 2.6 Number series

Decide the business document type for `ltr_number` and seed its number range through migration, not MCP.

Do not reuse PTO numbering.

### 2.7 Migration integrity

After dev apply:

1. reconcile migration history if needed
2. run `node scripts/migration-integrity-check.mjs`
3. do not proceed if `in_sync != true`

---

## 3. Backend work

### 3.1 New handlers

Build inventory-owned handlers for:

1. `listLocationTransferRequestsHandler`
2. `createLocationTransferRequestHandler`
3. `getLocationTransferRequestHandler`
4. `updateLocationTransferRequestHandler`
5. `cancelLocationTransferRequestHandler`
6. `searchLocationTransferPostingWorkbenchHandler`
7. `postLocationTransferHandler`
8. `reverseLocationTransferHandler`

### 3.2 Handler rules

`IN10 create/update`

- validate company scope on every call
- validate source and target sloc belong to the same company
- hard-block same source and target sloc
- validate material belongs to company scope
- hard-block requested/reserved quantity above currently available quantity
- if any single line is above available quantity, reject the whole save/update
- determine identity rule by material family:
  - RM/PM/INT = generic pool
  - SFG = batch-specific
  - FG = batch + source_lot_ref when present
- create/update matching `reservation_document` rows
- no stock movement here

`IN11 post`

- load request + line + remaining open qty
- validate company scope again
- validate reservation still consistent with line
- re-check live source-side available quantity before posting
- hard-block post quantity above live available quantity, even if the older reservation was once valid
- post real `P311` OUT+IN pair
- write `location_transfer_posting`
- update line/header status
- update reservation `issued_qty`, `balance_qty`, status
- do all of the above atomically

`IN11 reverse`

- load original posting event
- validate still reversible
- post real `P312`
- write reversal posting row
- update line/header status and reservation balances atomically

### 3.3 Availability helper

Write one shared helper for IN10 preview and hard-block logic:

- RM/PM/INT -> key by material + source sloc + stock type
- SFG -> add `batch_number`
- FG -> add `batch_number + source_lot_ref` when required

The helper must subtract open reservations, not just look at raw stock.

This helper governs **both**:

- IN10 reservation save/update hard-block
- IN11 actual posting hard-block

### 3.4 Reuse policy

You may reuse the low-level posting primitive from the current sloc-transfer path if it helps, but:

- do not reuse PTO authority logic
- do not reuse PTO status machine
- do not expose PTO-flavored errors/messages/resource codes

### 3.5 Routes

Add dedicated Inventory routes.

Do not piggyback on PTO routes.

### 3.6 ACL registry

Use separate resource codes:

1. `PROC_LOC_TRANSFER_REQ`
2. `PROC_LOC_TRANSFER_POST`
3. `PROC_LOC_TRANSFER_REVERSE`

Do not collapse them into one shared resource.

### 3.7 Raw UUID rule

Every list/detail response must resolve:

- material label
- storage location code/name
- user display names
- document numbers

Never show raw UUIDs in UI payload fields meant for rendering.

---

## 4. Frontend work

### 4.1 IN10

Build or rebuild as a proper transaction:

1. selection/list page using `ErpSelectionScreen`
2. create/change/detail workspace
3. line grid as the main work area using `ErpDenseGrid`

Do not stack all three states on one scrolling page.

Required filters:

- company
- status
- request number
- source sloc
- target sloc
- material
- request date range

Required actions:

- new request
- open/change existing request
- save
- cancel request
- refresh

### 4.2 IN10 UX shape

Use compact shell:

- dense header
- small summary cards
- editable line table visible above the fold

Do not make the page top-heavy with oversized read-only cards.
Use separate states/pages for:

- selection
- result list
- create/change workspace
- detail/history

In the create/change workspace:

- each row must show available quantity
- any row with `requested_qty > available_qty` must be visibly invalid
- if even one row is invalid, the page-level `Save` button stays disabled/inactive
- frontend disable is mandatory UX, but backend hard-block is still mandatory as the final authority

### 4.3 IN11

Build as full-page posting workbench:

1. selection screen first
2. execute opens full-page workspace
3. same page supports post and reverse actions

Do not keep the selection form permanently stacked above the posting grid once the workspace is open. `Change Criteria` should take the user back to the criteria state.

Required selection inputs:

- company
- action (`POST_TRANSFER`, `REVERSE_TRANSFER`)
- reference/request number

Required workspace behavior:

- show line identity and remaining qty
- show exact batch/lot identity where relevant
- post/reverse action bar in SAP-like shell rhythm

### 4.4 PACE component rule

Use existing PACE pieces:

- `ErpSelectionScreen`
- `ErpDenseGrid`
- transaction shell
- standard shortcut/action bar

No hand-rolled giant table layout unless a proven component gap forces it.

`ErpDenseGrid` is mandatory for:

- IN10 result list
- IN10 editable request line workspace
- IN10 detail/history grids
- IN11 posting/reversal workspace
- IN11 posted-result/document-detail grids

### 4.5 Keyboard flow

Follow the better PID pages:

- tab should skip read-only fields
- enter/save rhythm should be fast
- page up/down behavior where grid pagination exists

### 4.6 Company source rule

For company selection, use runtime-scoped available companies, not admin/global company sources.

---

## 5. ACL and menu work

This task includes code-side ACL wiring and menu/resource registration preparation, but remember:

- schema/code changes -> migration / repo code
- live ACL data snapshots/menu rebuild -> MCP operational step later

### 5.1 TX codes

- `IN10` = Location Transfer Request
- `IN11` = Goods Movement Workbench

### 5.2 Current business decision

Current access is:

- company-scoped
- L1_USER to L3_MANAGER full operational access
- no approval step

### 5.3 Future-safe split

Even though current users share access, create/post/reverse must be grantable separately later.

### 5.4 Dependency taxonomy pass

Check the Page Dependency Manifest and classify each dependency:

- material lookup -> Type খ
- sloc lookup -> Type খ
- batch/lot lookup -> Type খ

No Type গ should sneak in accidentally.

### 5.5 Post-implementation ACL checklist

When the build reaches the ACL rollout phase, follow the ACL decision doc's ordered checklist:

1. premise re-check
2. 13 bug pass
3. dependency check
4. capability/menu wiring
5. new ACL version
6. capture + generate
7. verify `precomputed_acl_view`
8. `user_overrides` check
9. ACL-MASTER drift check
10. menu snapshot rebuild

---

## 6. Explicit bug-check pass you must document

Before calling this complete, record the pass against all recurring bug patterns:

1. hardcoded role bypass
2. company-scope gap
3. blanket capability leak
4. `capture_acl_version_source()` one-time trap
5. ACL-MASTER drift
6. shared resource-code leak
7. fake maker-checker leftovers
8. route-registry mismatch
9. wrong company source in FE
10. stale/hidden menu registration assumptions
11. FE-only authority assumption
12. local hardcoded role arrays
13. backend-required field missing from FE payload

---

## 7. Verification checklist

### 7.1 DB / backend

1. Create request with multiple lines.
2. Confirm reservation rows are created at the correct source identity grain.
3. Try to reserve above available quantity and confirm hard-block.
4. In the UI, make one row invalid while other rows are valid and confirm `Save` stays disabled.
5. Confirm no stock movement is posted at IN10 save.
6. Post through IN11 and confirm `P311` OUT+IN material documents.
7. Reduce live availability after reservation, then try IN11 post and confirm hard-block.
8. Confirm line/header/reservation balances update exactly.
9. Reverse through IN11 and confirm `P312` plus balance rollback.
10. Confirm request-cancel works only before effective posting.

### 7.2 Identity tests

1. RM/PM/INT generic pool case
2. SFG batch-specific case
3. FG batch + `source_lot_ref` case

### 7.3 Scope/security

1. single-company user cannot request another company
2. multi-company user can only work inside allowed companies
3. route ACL registry matches actual routes
4. ACL-MASTER drift check clean

### 7.4 Frontend

1. IN10 list uses selection-screen pattern
2. IN10 line workspace stays above the fold
3. IN11 opens full-page workbench
4. keyboard flow skips read-only fields
5. no raw UUIDs visible anywhere

### 7.5 Dependency / repo checks

1. run the dependency scan/report process the team already uses
2. run relevant lint/check commands
3. update OM implementation log after each implementation step

---

## 8. Deliverables

By the end of the implementation pass, the repo should contain:

1. migration file(s)
2. backend handlers/routes/ACL-registry entries
3. frontend IN10 page(s)
4. frontend IN11 page(s)
5. doc updates if any assumption changes
6. implementation-log entry

---

## 9. Out of scope

1. PTO redesign
2. inter-company / GST-heavy plant transfer approval flow
3. generic MIGO for every movement type
4. new approval inbox
5. MIGO-based cancellation rights split in ACL data right now

Future-proof for those, but do not silently expand scope into them.
