# CODEX-GATE27.6-PROCESSPO-FULL-CHAIN-TASK-BRIEF

**Gate:** 27.6 (supersedes the separate 27.6–27.10 stub rows in `GATE27-CODEX-DRIVER-GUIDE.md` — this ONE brief now covers all of them)
**Domain:** PRODUCTION
**Title:** Process PO full chain — Standard Create → QA Approval → PR10 Edit → Start Batch → Final → Verify (QI hold + auto-release + Reco commit) → CORS reversal — DB + Backend + Frontend, 100% to locked design
**Scope:** 1 migration + backend (create/qa-approve/qa-reject/start-batch/**new edit**/**new complete-int**/finalize/verify/reverse) + frontend (PR09/PR10/PR11/PR12/Reversal pages)
**Dependency:** Gate-27.3 (create works), Gate-27.4 (reservation+prune), Gate-27.5 (QA queue display)
**Reference doc:** feasibility §83.3 (substitution registry on `stroke_line.alternate_material_id`), §83.4 (the whole Process PO lifecycle — Phases 1–5, PR10, PR15/CORS, Storage Location Integration, P321 usage decision), §83.5 (Reservation, stock-check severity, INT simple cycle, two-layer Stock-vs-Reco, `process_order_line_reco`), §83.7 (batch number), §83.9 (Machine Master); `PACE_ERP_MASTER_CONSTITUTION.md` §9 (File Header), §10/§16 (migration/schema-first), Part 1B Rule 1 (no raw UUID) & Rule 5 (ErpSelectionScreen / criteria-first for PO create); `CLAUDE.md` §8A/§8B/§8C.

**User-confirmed decision (2026-07-11):** INT and MTEST, once their single-action completion runs, set `process_order.status = 'VERIFIED'` (reuse the existing terminal status — no new status value). This is now locked; do not deviate.

---

## 0. Ground facts already verified live (do NOT re-derive, just use them)

- `erp_master.machine_master` columns: `id, company_id, machine_code, machine_name, machine_type, capacity_per_batch, capacity_uom_code, description, active, cost_center_id`. **No segment_code** — filter machines by `company_id` only. Existing list endpoint: `GET /api/om/machines` (`machine.handlers.ts` → `listMachinesHandler`, routed in `om.routes.ts`). **Reuse this endpoint from the frontend — do not build a new one.**
- `erp_production.stroke_line.alternate_material_id` **already exists** — this IS the "registered alternate" registry §83.4's substitution feature needs. One alternate per formulation line (matches the doc's UI: one Actual-Material dropdown, one alternate).
- `erp_inventory.movement_type_master` already has **P321** (`QA → Unrestricted`, TRANSFER, source=QUALITY_INSPECTION, target=UNRESTRICTED) and **P322** (`Unrestricted → QA`, TRANSFER, source=UNRESTRICTED, target=QUALITY_INSPECTION) — both pre-existing (from Inward QA usage-decision). **Do not create or seed these codes.**
- **Exact working calling pattern for P321** (copy this, do not guess): `supabase/functions/api/_core/procurement/inward_qa.handlers.ts` line ~754 calls the shared `postStockMovement` wrapper with `movementTypeCode: "P321", stockTypeCode: "UNRESTRICTED", direction: "IN"` — **a single call**, no paired OUT call. `post_stock_movement()` internally knows to draw down `QUALITY_INSPECTION` from the movement type's own `source_stock_type`. By symmetry, the reverse (P322) is a single call with `movementTypeCode: "P322", stockTypeCode: "UNRESTRICTED", direction: "OUT"` (draws down UNRESTRICTED, RPC internally credits QUALITY_INSPECTION per P322's `target_stock_type`). This matches how `process_order.handlers.ts` already calls P261/P262/P101/P102 today — always ONE call per movement, never a manual paired IN+OUT.
- `process_order` status CHECK already includes `CANCELLED` (added in Gate-27.4). `reservation_document` already exists with `source_line_id` (the exact FK to match a reservation row back to its `process_order_line`).
- `production_segment_location_config` is **empty in Dev** and `production_mode` is **NULL on all materials** (data gaps, not code gaps — Claude seeds these separately via MCP before live end-to-end testing).

---

## 1. Migration (NEW file)

Create `supabase/migrations/20260711120000_gate27_processpo_full_chain.sql`. Idempotent (`IF NOT EXISTS`/`DROP...IF EXISTS`). **Do NOT apply — Claude applies to Dev via MCP.**

```sql
BEGIN;

-- Machine assignment
ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES erp_master.machine_master(id),
  ADD COLUMN IF NOT EXISTS has_unapproved_deviation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qi_release_stock_ledger_id UUID; -- stores the P321 posting's stock_ledger_id, for CORS to reverse via P322

-- Final/Verify draft columns + substitution, on process_order_line
ALTER TABLE erp_production.process_order_line
  ADD COLUMN IF NOT EXISTS actual_material_id UUID REFERENCES erp_master.material_master(id),
  ADD COLUMN IF NOT EXISTS dosage_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS is_formulation_line BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approved_status TEXT
    CHECK (approved_status IS NULL OR approved_status = ANY (ARRAY['YES','NO','PARTIAL'])),
  ADD COLUMN IF NOT EXISTS ap_approved_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS variance_qty NUMERIC;

-- Reco/Costing layer (fully denormalized, per §83.5)
CREATE TABLE IF NOT EXISTS erp_production.process_order_line_reco (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES erp_master.companies(id),
  po_number             TEXT NOT NULL,
  batch_number          TEXT,
  po_type               TEXT NOT NULL,
  prodshade_material_id UUID NOT NULL REFERENCES erp_master.material_master(id),
  stroke_number         TEXT,
  machine_id            UUID REFERENCES erp_master.machine_master(id),
  segment_code          TEXT,
  batch_started_at      TIMESTAMPTZ,
  verified_at           TIMESTAMPTZ,
  process_order_id      UUID NOT NULL REFERENCES erp_production.process_order(id),
  process_order_line_id UUID NOT NULL REFERENCES erp_production.process_order_line(id),
  material_id           UUID NOT NULL REFERENCES erp_master.material_master(id), -- formulation material, never changes
  line_material_type    TEXT NOT NULL DEFAULT 'RM' CHECK (line_material_type = ANY (ARRAY['RM','INT'])),
  dosage_pct            NUMERIC,
  actual_material_id    UUID REFERENCES erp_master.material_master(id), -- substitute, NULL = same as formulation
  storage_location_id   UUID REFERENCES erp_inventory.storage_location_master(id),
  standard_qty          NUMERIC,
  actual_qty            NUMERIC NOT NULL,
  approved_status       TEXT NOT NULL CHECK (approved_status = ANY (ARRAY['YES','NO','PARTIAL'])),
  ap_approved_qty       NUMERIC NOT NULL,
  variance_qty          NUMERIC NOT NULL,
  is_formulation_line   BOOLEAN NOT NULL DEFAULT true,
  is_voided             BOOLEAN NOT NULL DEFAULT false,
  voided_at             TIMESTAMPTZ,
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_by       UUID
);

CREATE INDEX IF NOT EXISTS ix_po_line_reco_order ON erp_production.process_order_line_reco (process_order_id, is_voided);
CREATE INDEX IF NOT EXISTS ix_po_line_reco_company ON erp_production.process_order_line_reco (company_id, po_number);

GRANT ALL ON TABLE erp_production.process_order_line_reco TO service_role;

COMMIT;
```

Mirror the exact grant style already used for `reservation_document` (Gate-27.4) for `process_order_line_reco` — inspect that migration and match.

---

## 2. Backend changes — `process_order.handlers.ts` (and one new route each in `production.routes.ts` + `route-acl-registry.ts`)

Work through these in order. Each is independently testable; do not skip ahead if one is unclear — flag it in your log notes rather than guessing.

### 2.1 `createProcessOrderHandler` — machine + po_type branching at Standard

- Add `machineId = toTrimmedString(body.machine_id) || null`.
- **Machine required** for `MTO`, `HPS`, `MTS`, `INT` (validate `machine_id` present + belongs to `company_id` + `active = true`, else `PROD_PO_MACHINE_REQUIRED` / `PROD_PO_MACHINE_INVALID`, 400/422). **MTEST does not require a machine** (fully manual test batch — no validation needed for MTEST).
- Store `machine_id` on the inserted `process_order` row.
- **MTEST branch (one-step, per §83.4/§83.5):** when `poType === "MTEST"`, after inserting the manual lines (existing code path) and their reservations are SKIPPED (see below), immediately in the SAME request:
  1. Generate batch number: `generateBatchNumber(companyId, "MTEST", null)` (company-level, per §83.7).
  2. For each manual line: post **P261** (OUT, UNRESTRICTED, from segment `rm_sloc_id`/line override — same location-resolution logic already used elsewhere) using the existing `postStockMovement` helper in this file, with `documentNumber = poNumber`.
  3. Post **P101** for the header `material_id` (the "Prodshade Material ID" field, representing what's being tested), `direction: "IN"`, `stockTypeCode: "UNRESTRICTED"` (INT/MTEST skip QI hold entirely, per §83.4's "101 → Quality Inspection hold" exceptions list), landing at the segment's `shopfloor_sloc_id`.
  4. Update the `process_order` row: `status: "VERIFIED", batch_number, actual_qty: plannedQty, fg_stock_ledger_id, verified_at: now, verified_by: ctx.auth_user_id`.
  5. **Do NOT create any `reservation_document` rows for MTEST** — it never sits in an open/reserved state, stock posts immediately in this same call.
  6. Return `{ id: poId, po_number: poNumber, status: "VERIFIED", batch_number }`.
- **INT branch (still has a Standard phase, unlike MTEST):** `poType === "INT"` keeps today's behavior (Standard save only, reservation created normally, uses Stroke + Machine like MTO/HPS) — INT's *completion* is a **separate new endpoint**, see §2.6. No change to INT's create path beyond the machine requirement.
- **MTO/HPS/MTS:** unchanged create flow (still create at STANDARD, reservations created as today).

### 2.2 `qaRejectProcessOrderHandler` — cascade straight to PRUNED (fix a doc violation)

Per locked doc: "QA Reject → Status = QA_REJECTED → PRUNED immediately (no edit, no reuse)". Today's code stops at `QA_REJECTED` and never prunes. Fix: in the same handler call, after validating `status === "STANDARD"` and `reason` present, update the process_order directly to the **terminal** state in one write:
```
status: "CANCELLED", qa_rejection_reason: reason, qa_decided_by, qa_decided_at,
prune_reason: reason, pruned_by: ctx.auth_user_id, pruned_at: now,
last_updated_at, last_updated_by
```
(Reuse the `prune_reason`/`pruned_by`/`pruned_at` columns from Gate-27.4 — do not add new ones.) Also cancel any OPEN/PARTIAL reservations for this PO (same bulk-update pattern `pruneProcessOrderHandler` already uses — reuse that exact WHERE clause). Return `{ id, status: "CANCELLED" }`.

### 2.3 `startBatchHandler` — MTS skips QA (po_type branching)

Currently requires `status === "QA_APPROVED"`. Change the guard to:
```
const requiredStatus = po.po_type === "MTS" ? "STANDARD" : "QA_APPROVED";
if (po.status !== requiredStatus) return 422 PROD_PO_STATUS_INVALID;
```
Everything else (batch type routing MTO/HPS/MTEST=company-level, MTS=per-Prodshade) is already correct from Gate-27.7-era work — do not touch the `batchTypeMap`/`prodshadeId` logic, only the status guard. Remove the stale "INT is mapped to MTO here as a placeholder" comment and the `"INT": "MTO"` mapping entry — INT never reaches this handler anymore (it has its own completion endpoint, §2.6), so drop INT from `batchTypeMap` entirely and let an unexpected `po_type` fall through to a clear error instead of silently mapping to MTO.

### 2.4 QA Queue — exclude MTS from the queue (frontend-visible effect of 2.3)

`listProcessOrdersHandler` already supports an exact `po_type` filter. Add support for a **CSV multi-value** `po_type_in` query param (e.g. `po_type_in=MTO,HPS`) — if present, use `.in("po_type", list)` instead of the exact-match filter. In `QAQueuePage.jsx`, change the query to pass `po_type_in: "MTO,HPS"` instead of no po_type filter, so MTS Process POs (which skip QA per §83.4) never appear in the QA queue.

### 2.5 NEW `editProcessOrderHandler` (PR10) + route + ACL

Per §83.4 PR10 rules — **only** qty and machine, nothing else:

- `PATCH /api/production/process-orders/:id/edit`
- Allowed at `status IN ('QA_APPROVED', 'BATCH_STARTED')` only; else 422 `PROD_PO_EDIT_STATUS_INVALID`.
- Body: `{ machine_id?: string, lines?: [{ id: string, planned_qty: number }] }`.
- If `machine_id` provided: validate belongs to company + active, update `process_order.machine_id`.
- If `lines` provided: for each `{id, planned_qty}`, update `process_order_line.planned_qty` **and** update the matching `reservation_document` row (`source_line_id = line.id`) `required_qty = planned_qty` (balance_qty is a generated column, recomputes automatically). Batch both updates (§8B — independent per line, one call per line max, or better: since Postgres upsert-by-id in bulk isn't trivial via PostgREST, a small `Promise.all` over the (few) line updates is acceptable here — these are genuinely independent per-line writes).
- Explicitly reject (ignore, do not error) any other field in the body — stroke, alternate material at this stage, SLoc, PO type, prodshade are all blocked per doc; simplest correct behavior is to just never read those fields from `body`.
- Register route in `production.routes.ts` next to `/lines`; register ACL in `route-acl-registry.ts` with the same `resourceCode`/`action` as the sibling `/lines` PATCH route (copy that entry).

### 2.6 NEW `completeIntProcessOrderHandler` (INT single-action completion)

Per §83.5 — INT has Standard (already exists, unchanged) then ONE completion action (no Final, no Verify, no QA, no batch number):

- `POST /api/production/process-orders/:id/complete-int`
- Only valid when `po.po_type === "INT"` and `po.status === "STANDARD"`; else 422 `PROD_PO_INT_COMPLETE_STATUS_INVALID` / `PROD_PO_NOT_INT`.
- Body: `{ lines: [{ id, actual_qty }], actual_output_qty }` (actual qty per RM line + actual INT output qty; default to planned if a line is omitted).
- For each line: update `process_order_line.actual_qty`; post **P261** (OUT, UNRESTRICTED) exactly like `verifyProcessOrderHandler` already does (reuse that same location-resolution + `postStockMovement` call shape); then update that line's reservation (`source_line_id = line.id`) — since INT is a one-shot movement, mark it `issued_qty = required_qty, status = 'FULLY_ISSUED'` (fully consumed in this single call).
- Post **P101** for `po.material_id` (the INT material), `direction: "IN"`, `stockTypeCode: "UNRESTRICTED"` (INT is one of the documented QI-hold exceptions — no P321 needed).
- Update `process_order`: `status: "VERIFIED", actual_qty: actual_output_qty, fg_stock_ledger_id, verified_at: now, verified_by: ctx.auth_user_id`.
- Register route + ACL exactly like `/verify`'s existing entry (copy `resourceCode`/`action`).

### 2.7 `finalizeProcessOrderHandler` — Approved/AP-Approved/Variance + substitution (Final = data-entry only, unchanged: still no stock movement)

Rewrite the per-line update loop to implement the exact §83.4 Approved-toggle table:

For each line in `body.lines` (existing shape `{ id, actual_qty, ... }` extended with `approved_status?`, `ap_approved_qty?` for Partial, `actual_material_id?`):
1. Fetch the line's `planned_qty` (Standard Qty) — already available from the existing per-line fetch/loop.
2. If `actual_qty === planned_qty` (or both effectively 0 for a brand-new added row with actual 0): `approved_status = 'YES'`, `ap_approved_qty = actual_qty`, `variance_qty = 0` — **ignore any client-sent approved_status/ap_approved_qty for this case**, this is always auto.
3. Else (`actual_qty !== planned_qty`, including new added rows where planned is always 0): require `body`'s line to specify `approved_status` (`YES`/`NO`/`PARTIAL`); if missing → 400 `PROD_PO_APPROVED_STATUS_REQUIRED`.
   - `YES` → `ap_approved_qty = actual_qty`, `variance_qty = 0`
   - `NO` → `ap_approved_qty = planned_qty`, `variance_qty = actual_qty - planned_qty`
   - `PARTIAL` → `ap_approved_qty` = client-provided manual value (validate present & numeric, else 400 `PROD_PO_AP_APPROVED_QTY_REQUIRED`), `variance_qty = actual_qty - ap_approved_qty`
4. **Substitution** (`actual_material_id`): if the body sets it and it differs from the line's current `actual_material_id`:
   - Validate it equals that line's material's registered alternate: fetch `stroke_line.alternate_material_id` for the stroke line matching this `process_order_line.material_id` (via the PO's `stroke_master_id` + the line's `material_id`), reject with `PROD_PO_SUBSTITUTE_NOT_REGISTERED` (422) if it doesn't match.
   - Update `process_order_line.actual_material_id`.
   - **Reservation swap**: find the OPEN/PARTIAL reservation for `source_line_id = line.id`, set it `status: 'CANCELLED'`; insert a NEW reservation row for the substitute material, same `required_qty`, `source_type/source_id/source_line_id/company_id` unchanged, `material_id = <substitute>`, `status: 'OPEN'`.
5. Update the line row with `actual_qty, approved_status, ap_approved_qty, variance_qty` (+ `actual_material_id` if changed).

After all lines: compute `has_unapproved_deviation = ANY line has variance_qty > 0` (i.e. any `NO`, or `PARTIAL` where `actual > ap_approved`), set it on `process_order`. Everything else in this handler (INT-dependency hard check, status→FINAL, no stock movement) stays as-is.

**Batching note (§8B):** the per-line loop here does independent per-row updates (each line is its own row, no shared running total) — batch reads with `.in()` where you need lookups (e.g. the stroke_line alternate check across multiple lines), but the actual per-line UPDATE calls can stay a small sequential loop since Postgres/PostgREST has no native bulk-upsert-by-differing-values in one call; that's an accepted exception already used elsewhere in this file for line-level writes.

### 2.8 `verifyProcessOrderHandler` — QI hold + P321 auto-release + reservation issue + Reco commit (the core fix)

This is the most important correctness fix in the whole brief. Rewrite in this order:

1. **Line edits** (existing "Apply QA adjustments" block) — extend to accept the same `approved_status`/`ap_approved_qty`/`actual_material_id` fields as Final (§2.7's exact rules — QA can correct Actual Qty and the AP-Approved recompute must re-run using the identical Yes/No/Partial logic). Substitution here uses the same reservation-swap logic as §2.7 (this is explicitly allowed "before P261 posted" per doc — and since P261 posts later in this same handler call, it's always "before" at this point).
2. **P261 issue loop** (existing, keep — this loop is correctly `DEPENDENT` on stock posting order, keep its `// DEPENDENT:` semantics if you add one). **Immediately after each line's P261 posts successfully**, in the same loop iteration, update that line's reservation (`source_line_id = line.id`, `status IN ('OPEN','PARTIAL')`): `issued_qty = issued_qty + actualQty`; then set `status = issued_qty >= required_qty ? 'FULLY_ISSUED' : 'PARTIAL'`. (This is fine to do inside the already-sequential P261 loop — it doesn't add an extra network round-trip pattern concern since it's naturally tied 1:1 to each line's own posting call.)
3. **P101 FG receipt** — change the `stockTypeCode` argument from `"UNRESTRICTED"` to **`"QUALITY_INSPECTION"`** (this is the actual fix — P101's own `movement_type_master` default target already is QUALITY_INSPECTION; today's code was overriding it). Keep everything else (shopfloor sloc, qty, uom) unchanged.
4. **NEW: P321 auto-release** — immediately after the P101 call succeeds, post one more movement using the exact pattern from §0: `movementTypeCode: "P321", stockTypeCode: "UNRESTRICTED", direction: "IN"`, same `documentNumber` (po_number), same storage location (shopfloor), same material (`po.material_id`), same quantity (`verifiedQty`). Store the returned `stock_ledger_id` into the new `qi_release_stock_ledger_id` column (alongside the existing `fg_stock_ledger_id` from P101).
5. **Reco commit** — after all postings succeed, for each processed line (all INPUT lines, i.e. RM/PM/INT, **not** the OUTPUT/FG line — "No dedicated OUTPUT row" per §83.5), insert one row into `process_order_line_reco` with: header context fields (`company_id, po_number, batch_number, po_type, prodshade_material_id: po.material_id, stroke_number` [resolve from `stroke_master`], `machine_id, segment_code, batch_started_at, verified_at`), `process_order_id, process_order_line_id: line.id`, `material_id: line.material_id` (formulation — never the substitute), `line_material_type` (`'INT'` if that line's material has `production_mode='INT'`, else `'RM'`), `dosage_pct, actual_material_id, storage_location_id, standard_qty: line.planned_qty, actual_qty, approved_status, ap_approved_qty, variance_qty, is_formulation_line, is_voided: false`. **Batch this as one multi-row `.insert([...])`** (§8B — independent rows).
6. Update `process_order`: `status: "VERIFIED", actual_qty: verifiedQty, fg_stock_ledger_id, qi_release_stock_ledger_id, verified_at, verified_by, has_unapproved_deviation` (recompute here too, same rule as Final, in case QA's edits changed any line's variance).

### 2.9 `reverseProcessOrderHandler` (CORS) — 3 movements + reservation reinstate + Reco void

Per the locked correction: "VERIFIED→STANDARD CORS now reverses 3 movements (P262, then P322, then P102) not 2." Rewrite the `if (po.status === "VERIFIED")` block:

1. **P262** — reverse each RM/PM line (existing code, unchanged — this already correctly reverses `line.stock_ledger_id`, one call per line, keep the `// DEPENDENT` semantics if the file has one).
2. **NEW P322** — reverse the P321 auto-release first: one call, `movementTypeCode: "P322", stockTypeCode: "UNRESTRICTED", direction: "OUT"`, same shopfloor location + `po.material_id` + `po.actual_qty`, `reversalOfId: po.qi_release_stock_ledger_id`.
3. **P102** — reverse the original P101 receipt (existing code, but it currently reverses against `UNRESTRICTED`; the *source* of a P102 reversal is defined by `movement_type_master` as `QUALITY_INSPECTION` — since that's where the material now sits again after step 2's P322 put it back, change this call's `stockTypeCode` to `"QUALITY_INSPECTION"`), `reversalOfId: po.fg_stock_ledger_id`.
4. **Reservation reinstate** — for every OPEN/PARTIAL/FULLY_ISSUED reservation with `source_type='PROCESS_PO', source_id=id`: reset `issued_qty = 0, status = 'OPEN'` (batched update, one statement, §8B).
5. **Reco void** — `UPDATE process_order_line_reco SET is_voided = true, voided_at = now() WHERE process_order_id = id AND is_voided = false` (one statement — append-not-reset per §83.5; do NOT delete rows).
6. Existing `status: "REVERSED"` update, unchanged.

For **FINAL/BATCH_STARTED/QA_APPROVED/STANDARD** reversal branches (no stock posted yet): still just reinstate reservations to `OPEN` with `issued_qty=0` (they may have been partially touched by a PR10 edit but never issued) and skip the reco void (nothing was ever committed there pre-Verify).

---

## 3. Frontend changes

### 3.1 `ProductionPOCreatePage.jsx` — Machine field + combobox conversion (Process PO tab only, per Constitution Rule 1 & Rule 5)

- Add a **Machine** combobox (required for MTO/HPS/MTS/INT, hidden/not-required for MTEST) — call `GET /api/om/machines?company_id=` (reuse existing `listMachines` if already in `prodApi.js`/`omApi.js`, else add a thin wrapper calling that existing endpoint — do not invent a new backend route). Reuse the existing `ErpComboboxField` component (already extended with empty-state messaging in Gate-27.1) for this and for Company/Prodshade Material/Stroke — replacing today's raw-UUID text inputs. Company combobox source = existing admin companies list hook if one exists in this codebase (reuse, don't invent); Prodshade Material combobox = material search scoped to Prodshade materials; Stroke combobox = APPROVED strokes for the selected company+prodshade.
- Send `machine_id` in the create payload.
- Per Constitution Rule 5 (Production PO create = SAP ZCoR1 equivalent, criteria-first pattern is mandatory): wrap the Process PO tab's field entry in the existing `ErpSelectionScreen` pattern if that component already exists in this codebase (grep `ErpSelectionScreen`); if it does not yet exist as a reusable component, do NOT build one from scratch in this brief — fall back to the current single-form layout and note this explicitly in your log as a follow-up, rather than inventing a new shared component under time pressure.

### 3.2 `ProductionPOEditPage.jsx` (PR10) — wire to the new edit endpoint

Read the existing file first. Rebuild/adjust it to: load a Process PO by id (only usable at `QA_APPROVED`/`BATCH_STARTED` — show a clear blocked message otherwise), show only **Machine** (combobox) and each line's **Planned Qty** (editable number) — no other field editable (no stroke, no SLoc, no material, no PO type — matches §83.4 PR10 rule table exactly). Save calls the new `PATCH /:id/edit`.

### 3.3 `ProductionPOFinalPage.jsx` (PR11) — full line-table rebuild

Read the existing file first, then rebuild the component grid to match the exact locked layout (feasibility §83.4 "Final and Verify Phase UI Layout"):
- Header (read-only): PO #, Batch #, Status, Machine, Stroke #, Prodshade, Description, Type, Std Size.
- INPUT section: columns `Formulation Material | Dosage% | Actual Material | SLoc | Std | Actual | Approved | AP Appr | Var | Mvt(261, read-only)`. Approved column: show a static "★ YES" badge (non-interactive) when Std=Actual; an active Yes/No/Partial dropdown otherwise. Actual Material: dropdown showing only the line's registered alternate (from `stroke_line.alternate_material_id`, resolved via the order's lines response) plus "(same)" to clear back to formulation.
- `[+ Add Row]` under INPUT only, adding a row with Formulation/Dosage blank, Std=0, Approved always active.
- OUTPUT section (exactly one row, no Add Row): `Material | Std | Actual | AP Appr (auto = SUM of INPUT AP Approved, read-only) | Var | Mvt(101, read-only)`.
- `[Save as Final]` top-right; submits the shape §2.7 expects.

### 3.4 `ProductionPOVerifyPage.jsx` (PR12) — same table, QA differences

Same layout as 3.3, but: button label `[Save & Post Stock]`; Actual Material becomes editable (QA can correct); Add Row still allowed; **Delete Row allowed only for non-formulation (added) rows** — formulation rows can't be removed (enter 0 instead), matches doc. Submits to `verifyProcessOrderHandler`'s expected shape (§2.8).

### 3.5 `ReversalPage.jsx` (PR15/CORS) — reason-mandatory confirm

Read the existing file first. Ensure: reason is a mandatory text field before the Confirm button is enabled; after confirm, show the resulting status (`STANDARD` or `CANCELLED`) and which movements were reversed (from the response's `ledger_entries`, if the backend returns them — extend `reverseProcessOrderHandler`'s response to include the P262/P322/P102 entries array, mirroring how `verifyProcessOrderHandler` already returns `ledger_entries`).

### 3.6 Minimal INT completion surface

Add a lightweight "Complete" action for INT Process POs at STANDARD status — a button + a small inline form (per-line Actual Qty + Actual Output Qty) calling the new `/complete-int` endpoint. Put it on `ProcessOrderPage.jsx` or `OrderListPage.jsx` (read both first, pick whichever already shows Process PO detail/rows) as a status-gated action — do not build a whole new dedicated page for this in this brief (a polished dedicated INT page is a later, separate item).

---

## 4. Explicitly OUT OF SCOPE (do NOT build in this brief)

- PR16 full visual rebuild (batch# column, sort/priority order, expandable formulation grid) — Gate-27.5 already fixed its field-correctness; the deeper UI rebuild is a separate later item.
- PR17 Batch Number Release true design (VOIDED→RELEASED reuse drawer) — note that the existing `BatchReleasePage.jsx` is **not** actually PR17; it's a differently-purposed "Manager triggers Start Batch" page. Leave it alone; do not touch it.
- A polished dedicated MTEST page — MTEST is fully handled inside the existing create endpoint per §2.1; no separate page needed for correctness (the create page's existing MTEST tab/mode already collects manual lines).
- Per-location (only per-company) reservation netting — still interim, unchanged from Gate-27.4.
- Section 104 costing/valuation of the Stock-vs-Reco gap — explicitly deferred in the doc itself.
- Any `production_segment_location_config` / `production_mode` data seeding — Claude does this via MCP separately.

---

## 5. Hard rules (apply throughout)

1. **Implement only what's specified above** — every behavior here traces to a locked §83.x line or a fact verified in §0. If you hit a genuine ambiguity not resolved above, stop and note it in your log rather than inventing a resolution.
2. R-01: no raw UUIDs anywhere in new/touched frontend output.
3. `useQuery`, not `useEffect`+`setState`, for any new data fetching.
4. Batch independent DB reads/writes (`.in()`, or small `Promise.all` for genuinely independent per-row writes with no bulk-upsert path); keep the existing stock-posting loops sequential with their `DEPENDENT` rationale intact.
5. Schema-first: always `serviceRoleClient.schema("x").from("y")`.
6. New routes MUST be registered in `route-acl-registry.ts` — copy the resource/action from the nearest sibling route, don't invent new resource codes.
7. `console.error(..., JSON.stringify(error))` before every new `throw`.
8. Keep every file's mandatory header intact/updated (Constitution §9).
9. **Watch unicode corruption** — do not let existing `—`/`…` characters get mangled; if adding new literal strings, ASCII is safe.
10. Migration: create only, do not apply, do not run git commands.

## 6. Verification (Codex: before the log entry)

1. `deno check` every edited backend file — ignore the known pre-existing shared typing errors (`serviceRoleClient.ts`, `canonical_access.ts`, `context.ts`); only file-anchored errors in your own edits matter.
2. Grep for the P321/P322 calls and confirm they match the single-call pattern from §0 exactly (no invented paired IN+OUT calls).
3. Confirm the migration is idempotent and doesn't touch any table/column outside §1's list.
4. Confirm `route-acl-registry.ts` has entries for `/edit` and `/complete-int`.
5. Re-check frontend files you rewrote for raw-UUID leftovers and mojibake.

## 7. Log + commit

Append **one** `docs/Codex-Log.md` entry (existing template, dated today) summarizing: the migration's new columns/table, every backend handler changed/added (2.1–2.9), every frontend file changed (3.1–3.6), and anything you flagged as ambiguous/deferred per Hard Rule 1. List every file touched. **Do NOT run any git commands** — Claude reviews (this is a large, high-risk diff — expect a thorough pass), applies the migration to Dev via MCP, then commits.
