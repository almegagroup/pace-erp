# CODEX PO11 Procurement Planning Workspace Task Brief

## Read First

Before implementing, re-read these sources:

1. `CLAUDE.md`
2. `docs/CODEX-COMBINED-PROMPT.md`
3. `docs/Operation Management/PROD-ACL-Access-Decisions.md`
4. `docs/Operation Management/ACL-Role-Assignment-Worksheet.md`
5. `docs/Operation Management/implementation-specs/PAGE-DEPENDENCY-MANIFEST.json`
6. `docs/Operation Management/implementation-specs/CODEX-GATE22-TASK-BRIEF.md`
7. `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
   - `35.6` to `35.16` are the locked PO11 redesign scope.

## Problem Statement

The current PO11 implementation is a Gate-22 read-only procurement shortage grid:

- `frontend/src/pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx`
- `supabase/functions/api/_core/procurement/planning.handlers.ts`

That implementation does not match the approved business requirement.

PO11 must now become a monthly RM / PM planning workspace for ADMIX and HPS with:
- month-scoped planning input
- live stock pipeline visibility
- planning storage-location grouping
- alternate-material item grouping
- month-end frozen archive snapshots
- SCM / Director full-access workflow

## Clarified Grouping Model (Locked From User Review)

The final intended business model is:

1. User creates one or more company-scoped `SLOC Group`.
2. Each `Item Group` is always dependent on exactly one `SLOC Group`.
3. User manages item membership from the chosen `SLOC Group` scope:
   - add item into an item group
   - remove item from an item group
   - move item from one item group to another
   - leave item as stand-alone
4. The same item cannot belong to more than one item group in the same month.
5. Membership is month-scoped, editable throughout the open month, and carried forward into the next month.
6. When a month is closed, the exact group structure, input values, and month-end EOD stock snapshot become frozen history.

Important correction:
- `Item Group` is not a free-floating company master by itself.
- `Item Group` must be created under a selected `SLOC Group`.
- The item-management UI must show the relevant item pool for that `SLOC Group`.

## Clarified UX Requirements (Locked From User Review)

### Monthly Plan Table

The monthly input table must itself be shown in grouped planning format, not as an unstructured flat maintenance list.

Expected behavior:
- columns include `Group Name`, `Row Type` / stand-alone vs member vs group total, and item details
- `RM / PM / All` selector must exist
- `SLOC Group` toggle/filter must exist at company scope
- user must be able to work on one SLOC group's planning slice or on all items together

### Group Calculation Rules

For a grouped block:
- member rows remain individually visible
- a `Group Total` row appears after the last member
- fields that must total:
  - monthly requirement
  - available stock
  - TRN
  - GE
  - In QA
  - total stock
- fields that must average:
  - safety days
  - processing time
  - lead time
  - replenishment days
- derived safety / replenishment calculations at group total level use:
  - total requirement
  - averaged day-based fields

### Month Carry-Forward Rules

When opening a new month:
- monthly planning input data carries forward from the previous month
- current stock-side columns do not carry forward; they must always show live current data
- user can edit the new month freely until that month is closed

### Edit / Freeze Rules

- open month: editable unlimited times
- closed past month: no further edits allowed
- history must show the frozen month-end snapshot

## Current Gap Summary (Locked From User Review)

The current implementation is still incomplete because:

1. `planning_item_group` is not tied to a `planning_sloc_group`.
2. There is no dedicated item-membership management model for the active month beyond direct line assignment.
3. Item-group management is not presented as `SLOC Group -> item pool -> member map/unmap`.
4. Monthly input is not yet rendered primarily in the intended grouped planning shape.
5. Report/dashboard does not yet behave as a company + SLOC-group toggleable planning slice.
6. The current implementation partially supports carry-forward and archive, but not the full corrected grouping workflow.
7. Grouped monthly requirement / fixed override semantics are still line-oriented in the current code path; exact-match implementation needs a dedicated month-scoped group-config layer so grouped totals are first-class planning inputs, not only derived sums.

## In Scope

### Business Scope

- Company-wise monthly RM / PM planning
- Separate monthly data per company
- Previous month carry-forward
- Live dashboard for active month
- Month-end frozen archive using month-end EOD stock state
- Planning Storage Location Group setup
- Planning Item Group setup
- Group-level and item-level visibility together
- Immediate inclusion of newly eligible items
- Zero-valued monthly inputs allowed
- Drawer / modal assisted maintenance UX

### Material Scope

- ADMIX RM / PM
- HPS RM / PM

### Authority Scope

PO11 report visibility:
- Everyone with page access can open the workspace
- Viewers can:
  - toggle month
  - toggle SLOC group
  - review grouped / standalone planning rows
  - use the standard company selector exactly like other company-scoped report pages

Company-scope rule:
- single-company users can only view their own company's data
- multi-company users can switch company and only see data for companies already available to them in the standard transaction company selector flow

Full PO11 maintenance authority for:
- SCM
- Director
- ACL Master

Do not accidentally widen operational write access beyond the approved ACL scope.

Audit note:
- Local route ACL wiring now maps PO11 setup/save/close writes under `PROC_PLANNING_VIEW` with `EDIT`.
- Local route ACL wiring already supports report-style reads separately under `VIEW`.
- Production ACL snapshot / role-data must still be reconciled during publish if prod currently shows PO11 as read-only for some roles.

## Out Of Scope

- Full MRP automation
- Auto PR generation from PO11 in this milestone
- Non-ADMIX / non-HPS planning modes unless already naturally supported by the shared logic without changing the approved scope

## Current-State Findings

### Frontend

`frontend/src/pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx`

Current page is:
- single-screen
- read-only
- shortage focused
- one company selector
- one material search
- one shortage-only toggle
- one dense grid

This must be replaced by a workspace shell with multiple tabs / maintenance flows.

### Backend

`supabase/functions/api/_core/procurement/planning.handlers.ts`

Current handler only aggregates:
- stock snapshot
- open PO
- in-transit CSN
- safety stock / reorder / MOQ / lead time from `erp_master.material_plant_ext`
- last GR date

It does not support:
- monthly planning data
- fixed override values
- processing time
- planning storage-location groups
- planning item groups
- archive snapshots
- carry-forward logic
- group summary logic
- GE pipeline column
- month-specific include / exclude behavior

### Dependency Manifest

Current manifest shows only:
- `GET /api/procurement/planning`

This must be expanded after implementation to include all new PO11 endpoints.

## Required Functional Design

### 1. Planning Dashboard Tab

Must show the selected company + month with live operational data:

- group name
- item rows
- monthly requirement
- safety days
- processing time
- lead time
- derived safety stock
- derived replenishment stock
- fixed safety stock
- fixed replenishment stock
- available stock
- TRN
- GE
- in QA
- total stock
- status highlighting
- batch / movement details only through drawer / modal if needed

Calculation rules:

1. `Daily Requirement = Monthly Requirement / Days In Month`
2. `Derived Safety Stock = Daily Requirement x Safety Days`
3. `Replenishment Days = Processing Time + Lead Time`
4. `Derived Replenishment Stock = Derived Safety Stock + (Daily Requirement x Replenishment Days)`
5. `Effective Safety Stock = Fixed Safety Stock if present else Derived Safety Stock`
6. `Effective Replenishment Stock = Fixed Replenishment Stock if present else Derived Replenishment Stock`
7. `Total Stock = Available + TRN + GE + In QA`

Visual rules:
- Warning when `Total Stock <= Effective Replenishment Stock`
- Critical when `Total Stock <= Effective Safety Stock`

### 2. Monthly Plan Input Tab

Must let users maintain month-specific planning values:

- monthly requirement
- safety days
- processing time
- lead time
- fixed safety stock
- fixed replenishment stock
- active / excluded state for planning within the month
- item group membership decisions for that month

Rules:
- Opening a new month preloads prior month values for the same company
- Users can adjust after carry-forward
- `0` is valid input

### 3. Planning SLOC Group Setup

Purpose:
- decide which storage locations contribute items to planning scope

Rules:
- items visible in PO11 come from selected planning storage-location groups
- new RM / PM item appearing in an included SLOC must automatically appear in the active month

### 4. Planning Item Group Setup

Purpose:
- define alternate / pooled items for planning review

Rules:
- monthly include / exclude / move decisions allowed
- group members still show individually
- stand-alone items remain visible

### 5. History / Archive

At month close:
- store frozen monthly input state
- store month-end last-date EOD stock state
- history must read snapshot data, not recompute from current live stock

## Required Schema Layer

Create new PO11-specific monthly planning structures.

Recommended table families:

### Master / Setup

- `erp_procurement.planning_sloc_group`
- `erp_procurement.planning_sloc_group_member`
- `erp_procurement.planning_item_group`

### Monthly Transactional

- `erp_procurement.procurement_monthly_plan`
- `erp_procurement.procurement_monthly_plan_line`
- `erp_procurement.procurement_monthly_plan_group_member`

### Archive / Snapshot

- `erp_procurement.procurement_monthly_plan_archive`
- `erp_procurement.procurement_monthly_plan_archive_line`

Final naming may differ, but the model must support:
- company + month header
- line-level monthly values
- month-specific grouping membership
- frozen archive copies

## Required Backend Layer

Expand `planning.handlers.ts` or split it cleanly if file size becomes unsafe.

Minimum endpoint families likely needed:

- dashboard fetch
- month bootstrap / carry-forward
- monthly plan line save
- planning SLOC group CRUD
- planning item group CRUD
- include / exclude / regroup action endpoints
- archive / history fetch
- month-close snapshot action

Potential route design:

- `GET /api/procurement/planning`
- `POST /api/procurement/planning/lines/bulk-upsert`
- `GET /api/procurement/planning/sloc-groups`
- `POST /api/procurement/planning/sloc-groups`
- `PUT /api/procurement/planning/sloc-groups/:id`
- `DELETE /api/procurement/planning/sloc-groups/:id`
- `GET /api/procurement/planning/item-groups`
- `POST /api/procurement/planning/item-groups`
- `PUT /api/procurement/planning/item-groups/:id`
- `DELETE /api/procurement/planning/item-groups/:id`
- `POST /api/procurement/planning/close`
- `GET /api/procurement/planning/history`

Exact paths can change, but the ACL/resource mapping must stay explicit.

## Required Frontend Layer

Replace the current single-grid page with a workspace shell under:

- `frontend/src/pages/dashboard/procurement/planning/`

Recommended FE structure:

- `ProcurementPlanningPage.jsx` as shell
- workspace tabs / tab panels
- dashboard table component
- plan input table component
- SLOC group setup drawer / modal
- item group setup drawer / modal
- history viewer component

State expectations:
- persist selected company in-session
- persist selected month / tab in-session when returning from child views where appropriate
- remove newly configured items from "pending assignment" lists immediately after save without requiring manual refresh

## ACL and Menu Design

Current menu code:
- `PROC_PLANNING_VIEW`
- tx code `PO11`

Need to decide whether to:

1. keep one menu resource and gate all writes under same resource with stronger action mapping, or
2. split setup / archive / workspace write resources

Minimum safe rule:
- no non-SCM / non-Director write path may remain exposed
- menu visibility must still match approved scope

Any new route must be added to:
- `supabase/functions/api/_acl/route-acl-registry.ts`
- dependency manifest
- relevant screen registry / router only if new route paths are introduced

## Dependency / Bug Pattern Checklist

Before closing the work:

1. Re-run page dependency review and update `PAGE-DEPENDENCY-MANIFEST.json`
2. Re-check ACL route coverage
3. Re-check company-scope validation on every new handler
4. Re-check no hardcoded role bypass
5. Re-check drawer / modal pages for missing `company_id` propagation
6. Re-check save flows for stale dropdown / stale list refresh regressions
7. Re-check month-close snapshot immutability
8. Re-check new-item auto-inclusion for active month
9. Re-check GE removal after GRN
10. Re-check group totals and highlight thresholds
11. Re-check carry-forward correctness
12. Re-check history snapshot correctness
13. Re-check SCM / Director-only authority in prod-style ACL logic

## Sequence-Wise Task Breakdown

### Phase 1 - Schema

1. Add PO11 planning setup + monthly + archive tables
2. Add indexes, status constraints, timestamps, audit fields
3. Add grants / RLS expectations consistent with service-role API usage

### Phase 2 - Backend

1. Build month bootstrap / carry-forward logic
2. Build live dashboard aggregation logic
3. Build item auto-inclusion logic from SLOC group scope
4. Build monthly line save logic
5. Build item-group / SLOC-group maintenance endpoints
6. Build month-close archive snapshot logic
7. Build history fetch

### Phase 3 - Frontend

1. Replace old PO11 shell
2. Add dashboard tab
3. Add monthly input tab
4. Add SLOC group setup UI
5. Add item group setup UI
6. Add archive tab
7. Add refresh and optimistic / immediate list sync behavior

### Phase 4 - ACL / Dependency / Verification

1. Wire ACL routes
2. Update dependency manifest
3. Verify menu access behavior
4. Run lint / build / import checks
5. Run targeted business-rule verification

## Success Criteria

PO11 is complete when:

- SCM / Director can open a month and maintain planning data
- previous month carry-forward works
- new eligible items show up immediately
- grouped and stand-alone items both display correctly
- total stock / safety / replenishment logic matches the locked feasibility formula
- month close creates frozen history snapshot using that month's final EOD stock state
- dependency manifest and ACL coverage are fully updated
- old read-only Gate-22 behavior is fully superseded by the approved workspace design
