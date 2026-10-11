# Bulk DO Upload Reliability Audit

Status: P0 implemented and Dev-schema verified on 2026-10-12. P1-P4 remain
separate follow-on work; no performance improvement is claimed by this P0
change.

## Progress checklist

- [x] Repository, delivery-order architecture, ACL/company scope and dispatch design read.
- [x] Current frontend/backend request lifecycle traced.
- [x] Production incident evidence recorded without modifying Production.
- [x] P0 durable submission/group identity implemented.
- [x] P0 duplicate/retry/reconciliation UI implemented.
- [x] Dev migration applied and isolated failure-path test run/cleaned up.
- [ ] P0 real successful-DO fixture and race test in Dev.
- [ ] P1 bulk preview query reduction and benchmark.
- [ ] P2 creation-path query reduction and benchmark.
- [ ] P3 bounded-concurrency safety experiment.
- [ ] P4 durable asynchronous-job architecture decision/implementation.

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
- Focused ESLint for the three changed frontend files and `npm.cmd run build`
  passed. Build still reports the pre-existing `GRNListPage.jsx` duplicate
  `emptyMessage` warning. Repository-wide lint remains blocked by unrelated
  existing errors in HR, master-data, layout, procurement and OM screens.
- `deno check do_bulk.handlers.ts` passed. Checking the entire procurement
  route transitively reports unrelated pre-existing type errors in document
  flow, gate entry, GRN, PO, physical-inventory, QA, RTV, sales-return, STO
  and session modules.

## Remaining risks and next measurements

- P0 intentionally does not add concurrency; processing remains serial.
- A synchronous HTTP request cannot expose truthful durable in-progress
  percentage for work that is still inside one database transaction. P4 needs
  a job runner before progress can be reported as actual completed groups.
- The 543-row/465-group production timing is an incident observation, not a
  reproducible benchmark. No before/after performance claim is made here.
- P1 must batch immutable reference resolution but still revalidate mutable
  allocation and stock facts at commit. P2 must measure exact query time and
  RPC time before changing serial processing. P3 must not parallelize groups
  sharing stock/allocation dependencies.
