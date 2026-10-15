# Historical Operations Data — Architecture Audit

Date: 2026-10-15
Scope: CMP003, CMP005 and CMP011; historical cutover through 2026-09-30.

## Decision

`erp_planning` remains the owner of customer-plan inputs and planning-only
configuration.  Historical actuals belong in a separate, private
`erp_history` schema.  They are read by Planning; they must never create or
alter inventory, stock ledger, valuation, GL, production orders, delivery
orders or invoices.

## Authoritative operational actuals from 2026-10-01

| Actual | Authoritative lifecycle | Explicitly not sufficient |
| --- | --- | --- |
| Production | `erp_production.process_order`: `po_type = 'MTS'`, `status = 'VERIFIED'`, `actual_qty`, `production_date`.  Planned quantity is not used. | Created, final, cancelled or reversed process orders; `planned_qty`. |
| FG dispatch | Append-only `erp_inventory.stock_ledger` issued by a posted `P601` sales-invoice stock document, with a `P602` reversal represented as the opposing event. | Invoice draft/posted status alone, delivery challan, truck/dispatch entry, or dispatch recommendation. |

The current production source records a ProdShade material.  It must not be
invented into a particular SKU when several pack SKUs can correspond to that
ProdShade.  The unified result therefore retains both material identity and
its identity level (`SKU` or `PRODSHADE`).

## Existing architecture

- Backend is a Supabase Edge Function/Deno request router, not Fastify.
  Procurement routes are in `supabase/functions/api/_routes/procurement.routes.ts`.
- The existing planning page is
  `frontend/src/pages/dashboard/procurement/planning/MtsCustomerPlanPage.jsx`.
  It uses `PROC_MTS_CUSTOMER_PLAN:VIEW`, company-scoped handlers and React
  Query.  New actuals reads reuse this page resource and the same company
  scope checks.
- `erp_planning.mts_company_skus()` resolves customer-plan SKU/ProdShade
  relationships.  It is useful for presentation only; it is not evidence
  that a process-order quantity belongs to one particular packed SKU.
- `erp_master.material_master.external_sku` is text and is the ERP mapping
  target.  Historical external SKU input must be text too, so leading zeroes
  survive.  Company eligibility is verified via `material_company_ext`.
- `erp_master.material_uom_conversion` is the verified conversion source.
  Only fixed, active conversions directly to KG are acceptable; missing or
  variable conversions are quarantined.
- PACE has no independent plant master in this flow: the legacy
  `material_plant_ext.plant_id` is a project reference.  Historical plant
  values are therefore retained as source references, never manufactured as
  a false ERP plant FK.

## Data-quality and source risks

1. The discovered historical production Google Sheet is a monthly matrix.
   It does not prove an individual production day or a verified UOM.  The
   importer requires a valid source date and a verified KG conversion; it
   will quarantine rows that lack either instead of allocating a month or
   guessing a factor.
2. The production mapping document does not identify a historical FG-dispatch
   source.  The import service is source-agnostic but a real dispatch file
   must provide its file/sheet/row identity before backfill.
3. Historical SKU `00000000000` is always recorded as an exception and never
   mapped automatically.
4. A cancelled historical dispatch is retained for traceability but excluded
   from dispatched KG.  `CROSS CHECK = 1` is never treated as cancellation
   evidence.
5. ERP reversals are append-only P602 events.  The live read exposes them as
   negative dispatch events on their posting date rather than rewriting a
   previously posted P601 event.

## Cutover and ACL

- Historical queries use dates `< DATE '2026-10-01'`; live ERP queries use
  dates `>= DATE '2026-10-01'`.  Source values are `date` columns, so the
  business boundary follows the ERP Asia/Kolkata calendar date rather than a
  browser timestamp.
- Every endpoint resolves and checks the selected company before query or
  write. PO21 actuals remain gated by the MTS planning page resource. POTMP
  import commit/dry-run uses the separate
  `PROC_HISTORICAL_OPERATIONS_IMPORT:WRITE` resource, so a planning-maintenance
  grant cannot accidentally authorise historical ingestion.
- `docs/mts-planning/acl/HISTORICAL-OPERATIONS-IMPORT-ACL-PROVISIONING.sql`
  contains the required operational ACL/menu configuration. The dependency
  manifest records the POTMP routes for CI verification.

### Access verification on 2026-10-15

Read-only production ACL checks confirmed that the existing MTS Planning
resources are active for all three companies: CMP003 has 18 `VIEW` and 18
`WRITE` grants on `PROC_MTS_CUSTOMER_PLAN` and 8 maintain-write grants;
CMP005 has 10/10/7 respectively; CMP011 has 13/13/7 respectively. POTMP does
not reuse those broader grants: apply its dedicated provisioning script and
generate fresh ACL snapshots before enabling its import routes for a user.

The DEV ACL data is not equivalent: CMP003/CMP005 have no MTS resource
grants, and CMP011 is absent.  This blocks an authenticated human-role DEV
endpoint test until the separate ACL-provisioning process aligns DEV.  It is
not safe for this feature to invent or widen those grants, so no DEV ACL data
was changed.

## Verification boundary

This delivery contains schema, controlled import endpoints, unified read,
Planning UI, tests and runbook only.  It does not run a historical import,
mutate production data, or deploy to PROD.  Backfill remains a separately
authorised operation after migration review and deployment.

The DEV migration was applied only to validate DDL.  It contains zero import
batches, production rows, dispatch rows and exceptions; production,
inventory, stock-ledger, GL and operational-document data were not changed.

## DEV migration reconciliation completed

The previously missing `20261012130000_mts_machine_bucket_reservation_scope`
and `20261013090000_l3_manager_subordinate_scope_sync` migrations were
reviewed and applied to DEV, then their migration-history timestamps were
reconciled to the repository filenames.  The already-applied
`20261015041335_dd_do_reservation_on_truck_dispatch` file was restored from
its original commit, preventing accidental replay.  The DEV migration
integrity checksum now matches exactly: 672 migrations,
`c0ab2a6ca729992182220aef6cec5769`.
