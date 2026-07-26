# CODEX-GATE27.15-PR16-PR17-REBUILD-TASK-BRIEF

**Gate:** 27.15
**Domain:** PRODUCTION
**Title:** Rebuild PR16 QA Queue to the full locked expandable-queue design; build the real PR17 Batch Number Release page (does not exist yet)
**Scope:** backend (list payload + new PR17 endpoints) + frontend (`QAQueuePage.jsx` rebuild + new `BatchNumberReleasePage.jsx`)
**Dependency:** Gate-27.6 (done)
**Reference doc:** feasibility §83.4 (PR16 QA Approval Queue, PR17 Batch Number Release, Batch Number State Machine)

---

## 0. Critical correction — read before doing anything

**`frontend/src/pages/dashboard/production/BatchReleasePage.jsx` is NOT PR17.** It's a differently-purposed page (a Manager-triggered Start Batch action). Do not touch it, do not rename it, do not try to make it "PR17-compliant." **PR17 does not exist anywhere in this repo yet** — you are building it from scratch as a new page + new backend support. This mistake was already made once by an earlier unreviewed draft brief; do not repeat it.

---

## 1. Backend — PR16 payload (extend `listProcessOrdersHandler` in `process_order.handlers.ts`)

The collapsed-row list already returns `po_type, material, stroke_number, machine_id, planned_qty, batch_number, status, created_by_display` (from Gate-27.5/27.6). Add:
- Batch # already present as `batch_number` — confirm it shows `null`/`"—"` at QA_PENDING/QA_APPROVED status (correct, not yet generated) and populates once `BATCH_STARTED`.
- Resolve `machine` display (code+name) the same batched way `stroke_number`/`created_by_display` are already resolved — reuse that pattern, one more batched `.in()` against `erp_master.machine_master`.
- Sort order: `.order("status", ...)` isn't enough — implement "pending/newest sink to top, resolved sink down" by ordering **client-side or via a computed rank**: rank `QA_PENDING` above `QA_APPROVED`/`QA_REJECTED`, then `created_at DESC` within each rank. Simplest: keep the existing `created_at DESC` DB order, then have the frontend do a stable secondary sort (`status === 'STANDARD' /* pending */ first, then rest`) — do this in the frontend to avoid a fragile DB `CASE` order-by; note which approach you chose in the log.

For the expanded-row component grid, `getProcessOrderHandler`'s existing `lines` response (from `fetchOrderLines`) already carries `material`, `dosage_pct`, `actual_material`, `registered_alternate_material`, `issue_storage_location`, `planned_qty` — sufficient, no change needed there.

## 2. Frontend — PR16 rebuild (`QAQueuePage.jsx`)

Rebuild to the locked CSN-tracker-style expandable queue:
- **Collapsed row:** PO Number | Batch # (`—` if not yet generated) | Prodshade | Stroke | Machine | Target Qty | Created By | Status.
- **Click to expand** (not a separate drawer — inline expand, matching "CSN Tracker-style" per the doc) showing the full component grid: Formulation Material | Dosage% | Actual Material | Dosage% | Planned Qty (all read-only, reuse the existing drawer's line-rendering logic, just move it inline).
- **Role-based actions**, same screen: `QA_APPROVE` capability sees Approve/Reject on `QA_PENDING`(=`STANDARD`) rows; a `PRODUCTION_START` capability sees `[Start Batch]` on `QA_APPROVED` rows. If this codebase's capability-check pattern for conditionally showing buttons by capability isn't already established elsewhere in production pages, default to showing both action sets to any user who can already reach this page (existing `assertManagerOrSARole`-gated actions) rather than inventing a new capability-check UI pattern — note this simplification in the log if taken.
- Sort: pending (`STANDARD`) rows first, each group by `created_at` descending.
- Keep `po_type_in: "MTO,HPS"` filter from Gate-27.6 (MTS/INT/MTEST correctly excluded, unchanged).
- Keep `useQuery` + the existing 30s `refetchInterval`.

## 3. Backend — new PR17 (Batch Number Release)

Per §83.4 PR17 design, this is entirely new. Add to `batch_series.handlers.ts` (or a new `batch_release.handlers.ts` file, your choice — keep it in the production domain):

- `GET /api/production/batch-numbers?company_id=&status=VOIDED` — list batch numbers with `status = 'VOIDED'` scoped to the company, returning: batch_number, po_type, voided_date, previous prodshade (resolved display), previous stroke number, machine name (resolved display), status, released_by_display (null until released), reason (null until released). **You need to check what the current schema actually stores for a VOIDED batch's prior context** (which table holds batch-number rows — likely something tied to `process_order`'s own `batch_number` text field plus a status, or a dedicated batch-number ledger from `batch_series.handlers.ts`/the batch series migration). Inspect the real schema before designing the query; do not assume a table structure — if no dedicated batch-number-instance table exists yet (only a running counter in a batch-series-config table), you will need a new migration to add one (a `batch_number_instance` style table: company_id, po_type, prodshade_material_id nullable, batch_number, status ACTIVE/VOIDED/RELEASED, source process_order_id, voided_at, released_by, released_at, release_reason). Check `20260710183331_gate27_batch_series_mts_rename_drop_fy_reset.sql` and `batch_series.handlers.ts` first to see what already exists before adding anything.
- `POST /api/production/batch-numbers/:batchNumber/release` (or by an instance id if you add the table above) — Manager-only (`assertManagerOrSARole`), body `{ reason }` mandatory (400 if missing), transitions VOIDED → RELEASED, stores `released_by`, `released_at`, `reason`.
- `startBatchHandler` (existing, in `process_order.handlers.ts`) must be extended: before auto-generating a new sequential number, check for a `RELEASED` (not `ACTIVE`) batch number for the same **Company + PO Type** (not Prodshade — per the doc, this was deliberately corrected earlier: "Prodshade was wrong, that's why the PO was voided in the first place"). If any exist, this should surface to the frontend as a choice (see below) rather than silently auto-picking one.
- Add a new response shape or a preceding `GET` the frontend can call before showing the Start Batch confirmation, so the user can pick a RELEASED number or skip (auto-generate). Wire whichever shape is simplest given the existing `startBatchHandler` contract — note your choice in the log.

## 4. Frontend — new PR17 page (`frontend/src/pages/dashboard/production/BatchNumberReleasePage.jsx`, new file)

Table: Batch Number | PO Type | Voided Date | Previous Prodshade | Previous Stroke | Machine Name | Status (VOIDED/RELEASED) | Released By | Reason. Only `VOIDED` rows are selectable. Action: select row → `[Release]` button → modal with mandatory Reason textarea → Confirm → row updates in place (status/released-by/reason populate), **does not disappear** from the table. Company-filtered (Manager sees own company only). Add the corresponding `prodApi.js` wrapper functions and route/ACL registration (copy the ACL pattern from the nearest sibling Manager-gated production route).

## 5. Start Batch drawer — RELEASED reuse (frontend)

Wherever `[Start Batch]` is triggered from PR16 (now inline in the rebuilt queue), before calling `startBatch`, check for available RELEASED numbers for that Company+PO Type (via the new GET from §3) and, if any exist, show a small picker (drawer or inline list) letting the user pick one or skip to auto-generate. Keep this minimal — a simple list + "Skip, generate new" button is enough, no need for elaborate UI.

---

## Hard rules
1. Do not touch `BatchReleasePage.jsx` — unrelated page, leave it exactly as-is.
2. Inspect real schema/handlers before assuming a batch-number-instance table exists — this brief explicitly allows you to add one if genuinely missing, but only after confirming it's missing.
3. R-01 everywhere — no raw UUIDs.
4. `useQuery`, batched reads, ACL registration for every new route.
5. Reason mandatory for batch-number release, same pattern as CORS/Prune reason enforcement already in this codebase.

## Verification
1. Confirm `BatchReleasePage.jsx` diff is empty (untouched).
2. Confirm new routes are ACL-registered (grep for duplicate patterns, per the Gate-27.1 lesson).
3. `deno check` on touched backend files.
4. Confirm PR16 rebuild removes the old separate-drawer pattern in favor of inline expand, matches CSN-tracker style, sorts pending-first.

## Log + commit
Append one `docs/Codex-Log.md` entry. If a new migration was needed for a batch-number-instance table, say so explicitly and list its exact columns. **Do not run git commands.**
