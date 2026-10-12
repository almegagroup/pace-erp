# Bulk DO Upload Reliability Audit

Status: P0 implemented and Dev-schema verified on 2026-10-12. P1 batching and
safe timing instrumentation are implemented locally; deployment-backed
benchmarking and P2 implementation remain deliberately gated by measurements. No measured
performance improvement is claimed until the revised API service is deployed
to Dev and exercised with a representative non-production workbook.

## Progress checklist

- [x] Repository, delivery-order architecture, ACL/company scope and dispatch design read.
- [x] Current frontend/backend request lifecycle traced.
- [x] Production incident evidence recorded without modifying Production.
- [x] P0 durable submission/group identity implemented.
- [x] P0 cross-user, same-payload DO idempotency added in Dev schema.
- [x] SO Map's shared normal/bulk atomic write serialized by its natural SO+FO identity.
- [x] SO01 Excel line submit moved behind an atomic, cross-user replay-safe writer.
- [x] SO02 concurrent PGI upload reconciles an already-posted winner without replaying PGI.
- [x] P0 duplicate/retry/reconciliation UI implemented.
- [x] Dev migration applied and isolated failure-path test run/cleaned up.
- [ ] P0 real successful-DO fixture and race test in Dev.
- [x] P1 bulk preview query reduction (benchmark pending Dev runtime deploy).
- [x] Save per-group timing instrumentation (P2 baseline prerequisite).
- [ ] P2 creation-path query reduction and benchmark.
- [x] P3 safety decision: retain serial execution pending dependency-safe benchmark evidence.
- [x] P4 architecture decision: no early background worker; synchronous reconciliation remains until an approved worker runtime exists.

## Verified current flow before P0

### Frontend state

`BulkDoUploadDrawer.jsx` parsed the workbook once, called preview, retained
the preview rows in component state, grouped ready rows by FO/SO, then posted
all ready groups to `/bulk/save`.  It retained the original rows after a
successful response and only displayed a result list.  As a result, the same
groups remained Create-eligible after success.

The drawer did not persist an upload identity or group result. Browser refresh,
network response loss, or a second click had no server-authoritative way to
tell whether the first request had created a DO.

### Preview processing

`previewDoBulkUploadHandler` is sequential by row. Each row calls
`resolveFoOrSo`, which issues two SO-map lookups concurrently and may issue a
Sales Order lookup. A Direct/VDC row then does allocation, SO-line, material,
and drawn-quantity reads; a Depot/DC row does SO-line, material, and
drawn-quantity reads. Every row additionally resolves transporter and storage
location. Finished-goods location options are fetched once per preview.

The code therefore has a confirmed N+1 pattern. Depending on source type and
whether FO resolution falls through, a duplicate row costs approximately
6–9+ database requests before its row-specific candidate data is built. This
is a code-audit count, not a runtime trace measurement.

### Save processing and transaction boundaries

`saveDoBulkUploadHandler` processes groups serially. For every group it
revalidates transporter, source SO, FO/SO resolution, every SO line, every
storage location, every allocation, and potentially creates a Depot mapping.
It then delegates to one of the established database transactions:

- DC/non-deferred: `save_delivery_order_unified_atomic` (stock and reservation
  validation remains in this established path).
- DD/VDC: `save_vdc_deferred_bulk_delivery_order_atomic` (commercial DO only;
  the later SO02/Pending Truck workflow performs physical reservation/PGI).

Before P0 the header patch (`is_bulk_uploaded`, deferred marker, document and
dispatch dates, Tally/inbound fields) occurred as a separate query *after*
the DO transaction. Thus a patch failure could leave a valid DO without its
bulk/deferred header metadata.

### Authorization and scope

Both preview and save call `assertCompanyScope` through `getCompanyScope` and
evaluate `PROC_DO_CREATE` from the active ACL snapshot. The route ACL registry
also gates the endpoints. The new reconciliation route is registered as
`PROC_DO_CREATE:VIEW`, repeats company-scope validation, and requires the
submission's actor to match the current actor.

### Confirmed P0 defects

1. No durable submission identity or per-group idempotency record existed.
2. The UI did not remove successful groups from its create payload.
3. The post-create header update was outside the DO transaction.
4. An uncertain request outcome could not be reconciled safely.

## P0 implementation

Migration `20261011205122_bulk_do_submission_idempotency.sql` adds:

- `bulk_do_submission`, scoped by company and submitting actor.
- `bulk_do_submission_group`, uniquely keyed by `(submission_id,
  client_group_key)` and with a unique `delivery_challan_id` association.
- a `SECURITY DEFINER` wrapper which invokes the existing DO atomic function,
  patches the bulk header, and records the resulting DO ID in one database
  transaction.
- a failure-recording function for failures that occur during prevalidation.

Completed groups are immutable for their submission identity. A failed group
without a DO may change its review values and retry under the same submission.
This preserves legitimate multiple-DO-per-FO cases because there is no unique
constraint on FO, SO, transporter, or DO date.

### Cross-user submission boundary

The original P0 submission ID is browser/user scoped.  Consequently, two
users could submit the same canonical DO group using two different submission
IDs.  Migration `20261012021756_global_upload_submission_idempotency.sql`
adds `bulk_do_business_result`, unique only on `(company_id,
payload_fingerprint)`.  The existing DO wrapper locks that business identity,
creates the DO and stores the business result in the *same* transaction.  A
racing request therefore waits for the first transaction and receives the
same DO ID instead of running the create path.  Each user's local submission
history may reference that one DO, so the old one-to-one group/DO uniqueness
constraint is removed.

The fingerprint is the canonical complete group payload—not FO number, SO
number, transporter, or date alone.  A later legitimate dispatch remains
possible whenever its business payload differs; there is deliberately no
blanket FO/SO uniqueness rule.

The same migration also puts a transaction-scoped advisory lock inside
`save_so_map_group_atomic`, which is the shared normal and Excel SO Map write
path.  Its natural identity is `(SO, external FO, source)`.  Two users saving
the same map cannot create competing groups or allocations; the second caller
runs after the first and applies the established idempotent allocation upsert.

The drawer now generates and session-persists one submission UUID plus one
stable group UUID, sends both on save, removes created groups immediately,
refreshes the DO list, preserves only actionable failures/unresolved rows,
and reconciles against `/bulk/submission-status` after a lost response or
browser recovery. A full successful submission closes only after the
reconciliation state has been updated.

## Verification performed

- Dev database migration applied successfully; Production was not targeted.
- Confirmed both new tables and both functions exist in Dev.
- Invoked the atomic wrapper with deliberately invalid empty VDC data. It
  returned `VDC_DEFERRED_DO_SOURCE_INVALID`, persisted exactly one `FAILED`
  group with no `delivery_challan_id`, and created no DO.
- Verified an actor mismatch is rejected with
  `DO_BULK_SUBMISSION_SCOPE_MISMATCH`.
- Verified a retry failure updates the same group record rather than creating
  another one; the isolated Dev test rows were deleted afterwards.
- Applied `20261012021756_global_upload_submission_idempotency.sql` to Dev;
  verified the global business-result table and both rewritten database
  functions exist.  An isolated invalid-payload wrapper test returned the
  expected VDC validation error and its Dev-only submission/group/business
  rows were verified deleted afterwards.
- Focused ESLint for the three changed frontend files and `npm.cmd run build`
  passed. Build still reports the pre-existing `GRNListPage.jsx` duplicate
  `emptyMessage` warning. Repository-wide lint remains blocked by unrelated
  existing errors in HR, master-data, layout, procurement and OM screens.
- `deno check do_bulk.handlers.ts` passed. Checking the entire procurement
  route transitively reports unrelated pre-existing type errors in document
  flow, gate entry, GRN, PO, physical-inventory, QA, RTV, sales-return, STO
  and session modules.

## Remaining risks and next measurements

### P1 implementation

`previewDoBulkUploadHandler` now extracts all distinct FO/SO identifiers and
fetches the following bounded, paginated sets once: active FO map groups,
matching SOs, mapped SOs, VDC allocations, source SO lines, material masters,
open DO draw quantities, active FG locations, and active transporters. Row
resolution happens in memory and still returns the original Excel row index.
This eliminates repeated reads for repeated FOs, SKUs, transporters and
locations. Direct FO rows now consistently resolve through their SO Map
allocation whether or not their separate DD flag is set; the DD flag only
controls deferred Invoice→PGI timing.

The response and structured backend log include only request ID, row count,
unique source count, and elapsed milliseconds—never spreadsheet values or
personal data.

### P2/P3/P4 safety decisions

- Save now logs actual total, average-group, and p95-group duration, plus
  created/failed counts. This establishes a deployment-side baseline before
  changing the commit path.
- Serial creation is deliberately retained. Groups can share SO allocations,
  FG stock and database locks; running them concurrently before measuring and
  partitioning those dependencies risks oversell or false failures.
- The repository constitution permits external cron/manual triggers but
  explicitly forbids early worker usage. No worker/queue has been provisioned
  or approved in the actual deployment topology, so a durable background job
  would be speculative and unsafe. The existing durable P0 submission result
  remains the authoritative timeout/refresh recovery mechanism.
- A synchronous request must show indeterminate processing rather than a fake
  percentage. Actual completion percentage requires an approved durable worker
  that claims and persists one group at a time.

### Deployment boundary verified on 2026-10-12

The API is a Render Node service, not a deployable Supabase Edge Function in
this repository. Render's `pace-erp-api-dev` service follows only the `dev`
branch; the production `pace-erp` service follows only `main`. Pull-request
previews are disabled. Consequently, this dedicated reliability branch cannot
be exercised against the Dev API until an approved merge to `dev` occurs. The
database migrations were applied only to the linked Dev Supabase project; no
Production schema or business data was changed. A search of the available
12-Oct Render logs found no existing `DO_BULK_SAVE_TIMING` event, so the
17-minute incident remains the only verified save-duration baseline. It would
be unsafe to claim a measured improvement, enable parallel creation, or
introduce a background worker before the Dev API is running this code and a
non-production representative workbook has been run.

### Other upload flows: current position

This repository contains three other transactional upload/post paths: SO01
Draft-SO Excel line insert, SO Map bulk allocation save, and SO02 VDC
Truck/Dispatch-to-PGI posting. SO Map is protected by the shared atomic lock
above. Migration `20261012023519_so01_excel_upload_submission_idempotency.sql`
adds `sales_order_excel_upload_result` and an atomic SO01 writer. It locks
each affected DRAFT Excel SO in a deterministic order, allocates line numbers
inside that lock, inserts the line and records the canonical line fingerprint
in one transaction. A cross-user replay returns the existing line reference
instead of adding another row.

SO02's final PGI was already guarded at the authoritative level: its existing
completion transaction changes each invoice from `DRAFT` to `POSTED` with a
conditional update in the same transaction as P601, reservation issuance and
DO status completion. The upload handler now recognises the loser of that
race by rereading invoice state: if all invoices are already `POSTED`, it
returns `ok: true, reused: true`; it never reruns PGI.

No route may gain a transactional Excel upload merely by adding a frontend
button. Its backend implementation must define a canonical company-scoped
business fingerprint and use an atomic writer that persists the business
record and outcome together (or reuse one of the established writers above).
A generic pre-flight claim is explicitly forbidden: a process failure between
that claim and a separate business write would make the outcome ambiguous.

### Required Dev benchmark before any further optimisation

1. Deploy this branch to Dev only.
2. Upload a non-production 543-row/approximately-465-group fixture.
3. Record the `DO_BULK_PREVIEW_TIMING` and `DO_BULK_SAVE_TIMING` structured
   logs (rows/groups, elapsed, average and p95).
4. Compare with the documented incident observation without presenting it as a
   controlled baseline.
5. Inspect query plans for the slowest save reads before adding indexes or
   considering bounded concurrency.
