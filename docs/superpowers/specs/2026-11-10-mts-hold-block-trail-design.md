# MTS FG Hold & Block Trail (IN15) — Design

Status: approved in conversation by the business owner (2026-11-10), written for implementation.

## Goal
One report that shows the full life of every MTS finished-good (SKU) quantity that was put into
**Quality Inspection (QI)** or **Blocked**: who decided, what, why, and what happened to it afterwards
(moved back to Unrestricted, reversed, ...). Quantity that went straight to Unrestricted at Verify is **not**
in the report. The report has an Excel export, is company-scoped, and every user with a work context can open it.

## Menu / identity
| | |
|---|---|
| Page name | MTS FG Hold & Block Trail |
| TX code | **IN15** (docs list IN01–IN14; IN15 is free — re-verify against dev DB before registering) |
| Menu group | Quality (`GRP_ACL_QA`), next to IN13 |
| Screen code / ACL resource | `PROD_MTS_HOLD_TRAIL` (new resource — never reuse another resource, bug pattern #6) |
| Route | `/dashboard/production/mts-hold-trail` |
| API | `GET /api/production/mts-hold-trail` (production domain, same family as PR24's `mts-register`) |
| Column-layout report code | `MTS_HOLD_TRAIL` |
| Access | VIEW only, `CAP_EVERYONE_REPORTS`, company-scoped (same "Everyone" pattern as PR21 / PR24 / PO18). ACL-MASTER (P0076) checked explicitly (pattern #5). |

## Data sources (existing tables, no duplicate "trail" table)
1. **HOLD events** — `erp_production.mts_verify_hold_allocation` (one row per hold per batch, written by MTS Verify):
   Process PO, Packing PO, SKU, batch (+ from/to range), target status, declared / held bags, kg, `created_by`, `created_at`.
   Only holds exist here (`held_pack_qty > 0`), so Unrestricted-at-Verify never appears.
   **New column `reason text`** (see "Reason capture").
2. **STATUS CHANGE events** — `erp_inventory.stock_status_change_posting` (IN13), restricted to MTS aggregate SKU stock:
   material type FG, `packing_po_number IS NULL`, `batch_number IS NULL` (IN13 rejects a batch on aggregate MTS stock,
   which also separates these rows from the rows MTS Verify itself writes, which carry the batch), and
   `from_stock_type` or `to_stock_type` is QUALITY_INSPECTION / BLOCKED.
   Gives from → to, kg, reason (compulsory in IN13), created_by/at, approved_by/at, status (PENDING_APPROVAL / POSTED / REVERSED).
3. **Process PO status** — `erp_production.process_order.status = REVERSED` marks a HOLD as "Reversed with Process PO".

Release is **not** linked to a batch/hold (business decision): IN13 stays aggregate, the user explains in the remarks
(reason). The report therefore shows releases as their own events and a SKU-level balance — never a batch-level one.

## Page 1 — Filters (kept minimal)
Company (scoped: single-company user = locked read-only, multi = own allowed companies only; `TransactionCompanySelector`),
date range **Event Date From/To** (default last 30 days), SKU (multi-select, company-scoped material picker),
Status (QI / Blocked checkboxes; none ticked = both). Search = button + F8.

## Page 2 — Output
Same shell as IN03 / Gate Entry Report: Back to Filters (Esc), Columns (shared `useColumnLayouts`, no fixed column),
Search all columns, "X of Y rows", Export Excel (visible columns, filtered rows, criteria preamble), Search Again.

Grid, one row per event, newest first. Columns (all pickable):
Event Date-time, Event (HOLD / STATUS CHANGE), SKU (name, `document_name`/external code — never `pace_code` in a label),
Process PO, Packing PO, Batch, From status, To status, Bags, Qty (KG), By (employee code — name),
Approved By, Reason / Remarks, Document (SSC number where it exists), State
(Active / Reversed with Process PO / Pending approval / Posted / Reversed).

A summary strip above the grid, per SKU: **Held in QI (KG)**, **Held in Blocked (KG)** =
Σ over IN13/Verify `stock_status_change_posting` rows (`status = POSTED`, `reversal_of_posting_id IS NULL`,
material = the SKU) of signed movement into minus out of QI / Blocked. Rows with `status = REVERSED` and their
reversal rows are both left out so a reversed posting never counts twice. SKU level only.

## Reason capture (the one write-path change)
- Verify page (`ProductionPOVerifyPage.jsx`, MTS QA Verify): each hold block gets a **compulsory Reason** textbox.
- Backend `runMtsProcessOrderVerify`: `holds[].reason` required (non-empty, ≤ 500 chars) → `PROD_MTS_HOLD_REASON_REQUIRED` (422);
  copied onto every `hold_allocations[]` row and onto the merged `status_postings[]` group
  (distinct reasons of merged holds joined with `; `).
- Urgent flow: `body.holds` is stored verbatim in `mts_urgent_verify_request.holds` and replayed on manager approval, so the reason
  travels with it with no extra change; an urgent submit without a reason is rejected the same way.
- Migration: `ALTER TABLE ... ADD COLUMN reason text` on `mts_verify_hold_allocation`; `CREATE OR REPLACE` of
  `complete_process_po_verify` (from its **live** definition, never from an old migration file) writing
  `reason` into the hold row and replacing the hard-coded `'MTS Verify QA stock allocation'` in the SSC row with the hold reason
  (fallback to the old text only when the reason is missing). Old holds keep `reason = NULL` → shown as "—" (legacy).
- After applying: `NOTIFY pgrst, 'reload schema'`, reconcile `schema_migrations`, `node scripts/migration-integrity-check.mjs` (dev).

## Backend report handler
New `mts_hold_trail.handlers.ts` (production domain, pattern of `mts_production_register.handlers.ts`):
company scope via `resolveAllowedCompanyIds` + `scopeCompanyIds` (a denied company returns nothing, never "all" — pattern #2); pure row/summary logic in `mts_hold_trail.logic.ts` with unit tests, every id-list read via `fetchInChunks` (§8E),
no `.catch(() => [])` swallowing — a failed read returns an error, never an empty/"released" looking row (the Sand lesson),
bulk-resolve all names (§8A: no raw UUIDs), response `{ items, summary, total }`.
Route in `_routes/production.routes.ts` + `route-acl-registry.ts` (`GET:/api/production/mts-hold-trail` → `PROD_MTS_HOLD_TRAIL`:`VIEW`; pattern #8).

## Frontend
`MtsHoldTrailPage.jsx` under `pages/dashboard/production/`, API fn `getMtsHoldTrail` in `prodApi.js`, `operationScreens.js` entry,
`AppRouter.jsx` route. `useQuery` only (§8A). Material picker company-scoped (same as IN03).

## Menu / ACL (dev, via MCP; prod re-run later by the owner)
`erp_menu.menu_master` + `acl.menu_master` (resource_code = menu_code) + `erp_menu.menu_tree` (parent `GRP_ACL_QA`),
`(CAP_EVERYONE_REPORTS, PROD_MTS_HOLD_TRAIL, VIEW)` in `acl.capability_menu_actions`, then a **new `acl_versions` row**
(never re-capture an already-captured version — pattern #4), `capture_acl_version_source`, `generate_acl_snapshot`,
`rebuild_acl_menu_snapshot`, and `scripts/acl-master-drift-check.mjs` for P0076.

## Verification
`deno check` before/after (identical error set), `eslint`, all CI guards (`route-acl-registry`, `wrong-company-source`,
`jsx-no-undef`, `frontend-payload`, `hardcoded-role-check`, `stock-posting`), `vite build`, and DB-level checks on dev inside
rolled-back transactions for the migration function. Click-through needs a login this environment does not have — stated, not claimed.

## Known issue found while designing (out of scope, reported separately)
Live `complete_process_po_verify` (dev) has **no `mts_reverse` branch**: migration `20261007050015` redefined the function from a
pre-`20260921181000` body and dropped it. MTS CORS reverse therefore cannot mark the Process PO / holds REVERSED. The report reads
`process_order.status`, so "Reversed with Process PO" becomes correct once that is fixed. The migration for this feature must
build on the live definition and must not make this worse.

## Out of scope
Batch-level attribution of releases, IN13 changes, hold quantity edits, prod rollout (menu/ACL/migration on prod are the owner's call).
