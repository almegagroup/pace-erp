# CODEX-GATE27.21-PR10-PROCESS-PO-EDIT-TASK-BRIEF

**Gate:** 27.21
**Domain:** PRODUCTION
**Title:** Rebuild PR10 (Process PO Edit) — pre-QA edit window, Storage Location + Alternate Material + stock re-check
**Scope:** rewrite 1 backend handler + 1 frontend page. No new tables, no new routes (both already exist and are wired).
**Dependency:** None — independent of Gate-27.19/27.20.
**Reference doc:** feasibility Section 83.4, subsection **"PR10 (ZCoR2) — Edit Rules — SECOND CORRECTION"** (LOCKED — 2026-07-12) — read this in full before starting, it is the single source of truth for this brief and it **supersedes** the older "QA_APPROVED only" rule further up in the same doc (struck-through, not deleted — read the correction, not the struck text).

---

## Why this brief exists

PR10's edit window was locked on 2026-07-04 as "available only at QA_APPROVED, closes at Start Batch." Business owner review on 2026-07-12 reversed this: PR10 should be available **before** QA approval (at STANDARD status), not after — catching mistakes before QA even reviews the PO, rather than after. Storage Location, previously blocked at PR10, is now explicitly allowed. A mandatory stock-availability re-check on save was added, which didn't exist before at all.

The current `editProcessOrderHandler` (`supabase/functions/api/_core/production/process_order.handlers.ts:1738`) and `ProductionPOEditPage.jsx` (`frontend/src/pages/dashboard/production/ProductionPOEditPage.jsx`) implement the **old** rule (`EDITABLE_STATUSES = ["QA_APPROVED", "BATCH_STARTED"]`, Machine + Planned Qty only, no Alternate Material, no Storage Location, no stock re-check). Both need a full rewrite to match the new locked rule.

**Do not confuse this with `updateProcessOrderLinesHandler`** (a different, older handler powering the legacy generic `ProcessOrderPage.jsx`) — that one does a full line delete+reinsert and predates the Gate-27 TX-code rebuild. Leave it alone; it is out of scope and must not be merged with PR10's logic.

---

## Scope for this brief

**Process PO only. MTO/HPS only.** Reject MTS/INT/MTEST with a clear error if the selected PO isn't MTO/HPS — do not silently allow them (see "Out of scope" below, these are deferred, not part of this brief).

---

## Change 1 — Rewrite `editProcessOrderHandler`

Current signature/route stay the same (`PATCH /api/production/process-orders/:id/edit`, already wired in `production.routes.ts`). Rewrite the body:

1. **Status/type gate:** fetch the PO. Reject (422, clear message) unless `po_type` is `MTO` or `HPS` **and** `status === "STANDARD"`. This replaces the old `["QA_APPROVED", "BATCH_STARTED"]` check entirely.
2. **Machine:** same as today — update `process_order.machine_id` if provided, validate it belongs to the company and is active.
3. **Batch Qty (header):** new capability. Accept a `planned_qty` (or equivalent header batch-size field — check the actual column name on `process_order` for the Standard Qty header field before assuming) in the body. When provided and different from the current value:
   - Recompute every RM/INT line's Standard Qty using the same Dosage% × Batch Qty formula PR09's own create flow already uses (find and reuse that exact calculation, don't reimplement it independently — search `createProcessOrderHandler`/`applyFinalOrVerifyLineUpdates` area for the dosage-based qty derivation).
   - Update each line's `process_order_line.planned_qty` to the recalculated value.
   - Update each line's own `reservation_document.required_qty` to match (mirrors what the current handler already does per-line, just driven by the recalculation instead of a raw per-line qty from the caller).
4. **Storage Location per line:** new capability. Accept `storage_location_id` per line in the `lines` array. When changed: update `process_order_line.issue_sloc_id` and the matching open reservation's `storage_location_id` — reuse the exact pattern already implemented in `applyFinalOrVerifyLineUpdates` (`process_order.handlers.ts` around line 499-520) for reservation-location-sync, don't reinvent it.
5. **Alternate/Actual Material per line:** new capability. Accept `actual_material_id` per line. Validate it against that line's registered alternate (`stroke_line.alternate_material_id`, via `fetchStrokeAlternates()` — already used elsewhere in this file) — reject with `PROD_PO_SUBSTITUTE_NOT_REGISTERED` (422) if it doesn't match, same error code already used in `createProcessOrderHandler`/`applyFinalOrVerifyLineUpdates`. On a genuine change: cancel the existing open reservation and insert a new one for the new material at the same qty/location — reuse the exact reservation-swap block already implemented in `applyFinalOrVerifyLineUpdates` (`process_order.handlers.ts` around line 522-574), don't reimplement it independently.
6. **Stock re-check, hard block:** after computing what the final per-line (material, storage_location, qty) set would be (post batch-qty-recalc, post material-substitution), run the same availability check `createProcessOrderHandler` already runs at Standard creation (reuse `computeAvailabilityRows`/`checkStockAvailability`, defined earlier in this same file — do not duplicate the query logic). If any line is short, return a 422 with the existing short-line error shape (match whatever `createProcessOrderHandler` already returns for a shortage) and **do not save anything** — the whole edit is one atomic pass/fail, not a partial save.
7. Blocked/no-op fields: stroke, RM add/prune, PO Type, Prodshade — the body must not accept edits to these; ignore any such fields silently (they aren't part of the request shape) rather than erroring, matching how PR10's shape is already scoped today.
8. Status stays `STANDARD` after a successful edit — no status transition here at all.

---

## Change 2 — Rewrite `ProductionPOEditPage.jsx`

Replace the current bare Machine+PlannedQty form with a 2-page flow:

**Page 1 (identify):**
- PO Number input only (no Company field — `po_number` is a single global counter, confirmed via direct DB check, no company-scoping needed for lookup).
- On submit, fetch the PO (reuse `getProcessOrder`). If it isn't MTO/HPS or isn't STANDARD, show the exact validation message the backend would give (or a clear client-side equivalent) and stop — do not show Page 2.

**Page 2 (edit — mirrors PR09's own Standard Material Table exactly):**
- Header: PO Number, PO Type, Prodshade/Material (read-only labels, resolved names not raw UUIDs).
- **Machine** — combobox, editable.
- **Batch Qty** — editable numeric field. Changing it should live-recalculate the displayed Standard Qty column for every line (Dosage% × new Batch Qty) — reuse whatever calculation/formatting `ProductionPOCreatePage.jsx` already uses for the same live-recalculation on its own Standard page, don't reimplement independently.
- Per-line table: Material (read-only), Standard Qty (live-recalculated, read-only display), **Storage Location** (combobox, editable), **Actual Material** (combobox, editable **only** for lines whose stroke line has a registered `alternate_material_id` — disable/hide the control otherwise, matching the pattern already built for PR09's own Actual Material column).
- Before Save, call the existing `GET /api/production/process-orders/availability-preview?process_order_id=...&overrides=...` endpoint (already used elsewhere in this codebase — reuse the same client function, don't write a new one) with the current draft's per-line overrides, and surface any shortage inline (red) **before** the user clicks Save — this is a live preview, not a replacement for the backend's own hard-block on save.
- Save calls the rewritten `editProcessOrder` with `{ machine_id, planned_qty (batch qty), lines: [{ id, storage_location_id, actual_material_id }] }` — check the exact body shape matches what Change 1's handler now expects.
- `useQuery`/`useQueryClient`, not `useEffect` + manual fetch, per CLAUDE.md's standing rule (the current page already does this correctly — keep it).

---

## Hard rules

1. **MTO/HPS only** — reject MTS/INT/MTEST at both Page 1 (frontend) and the handler (backend), with a clear message, not a silent allow.
2. **STANDARD only** — reject QA_APPROVED/BATCH_STARTED/FINAL/VERIFIED/CANCELLED with a clear message. This is a full reversal of the old rule — do not leave both windows active.
3. Stock shortage is a **hard 422 block on save**, not a warning — matches §83.5's Standard-creation severity.
4. Alternate Material is only ever offered for lines with a registered `stroke_line.alternate_material_id` — never an arbitrary material combobox.
5. No raw UUIDs anywhere in Page 1/Page 2 (CLAUDE.md §8A, R-01) — every material/location/machine reference resolved to a human-readable label.
6. Do not touch `updateProcessOrderLinesHandler` or `ProcessOrderPage.jsx` — separate, legacy, out of scope.
7. Reuse existing calculation/validation/reservation-sync logic already present elsewhere in `process_order.handlers.ts` (dosage recalculation, reservation location-sync, reservation material-swap, availability check) — do not reimplement any of these independently; if you can't find the existing block, say so in the log rather than guessing a new implementation.

## Out of scope

- MTS/INT edit window ("before Final") — deferred to the existing MTS/INT batch-mechanics future session.
- Packing PO's own PR10 half ("before Final") — deferred to land with Packing PO's own Standard→Final rebuild (separate, larger brief, already next in the locked sequencing).
- Any change to `updateProcessOrderLinesHandler`/`ProcessOrderPage.jsx`.

## Verification

1. Confirm a QA_APPROVED or BATCH_STARTED PO is now **rejected** by PR10 (reversal of the old rule) — this is the one most likely to regress silently if the old status check is only partially removed.
2. Confirm a STANDARD MTS/INT/MTEST PO is rejected by PR10.
3. Confirm changing Batch Qty recalculates every RM line's Standard Qty and its reservation's Required Qty, live on the frontend and correctly persisted on save.
4. Confirm Storage Location change persists and syncs the open reservation's location.
5. Confirm Actual Material substitution is blocked (422 `PROD_PO_SUBSTITUTE_NOT_REGISTERED`) for a material with no registered alternate, and succeeds (with reservation swap) for one that has one.
6. Confirm a shortage (from either the batch-qty increase or the substituted material) hard-blocks Save with a 422 and saves nothing.
7. `deno check` and `eslint`/`npm run build` clean (only pre-existing shared-typing errors already documented in prior Gate-27 log entries, zero new).

## Log + commit

- Append one entry to `docs/Codex-Log.md`
- Do not run git commands
