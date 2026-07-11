# CODEX-GATE27.14-STORAGE-LOCATION-REARCHITECTURE-TASK-BRIEF

**Gate:** 27.14
**Domain:** PRODUCTION
**Title:** Retire `production_segment_location_config` for Process PO — RM issue location comes from Stroke Line defaults, output location from Stroke header, all user-editable at Standard/Final/Verify. Stock check + reservation become storage-location-aware (company+material+location).
**Scope:** backend (`process_order.handlers.ts`) + frontend (PR09/PR11/PR12) + 1 small migration (add columns only, no drops)
**Dependency:** Gate-27.6 (done)
**Reference doc:** feasibility §83.4 (P261 Issue Location Default Chain, line-table SLoc editability at Standard/Final/Verify), §83.5 (Stock check severity "@ location", Reservation keyed by material+plant+storage location), §83.3 (Stroke default location). Business-owner decisions from 2026-07-11 chat (see `OM-IMPLEMENTATION-LOG.md` "Gate-27.6 Correction" and the follow-up entry for this task).

---

## 0. Ground facts already verified live — do NOT re-derive

- `erp_production.stroke_line` already has `default_storage_location_id`, and **42/42 existing rows have it populated** (100%). Zero PM lines exist in `stroke_line` (Process PO never issues PM — confirmed by locked doc: "Consumes RM components (NO PM)").
- `erp_production.production_segment_location_config` is **empty** (0 rows) and was never actually needed for Process PO once the above is used correctly — **do not seed it, do not build any SA config page for it**.
- **Bug found and must be fixed here:** `createProcessOrderHandler`'s stroke-line-prepopulate insert currently hardcodes `issue_sloc_id: null` and never selects `default_storage_location_id` from `stroke_line` — this is why every RM line's location has always fallen through to (now-retired) segment config.
- `GET /api/om/storage-locations` already exists (`om.routes.ts` → `listStorageLocationsHandler`) — reuse this for any storage-location combobox. Do not build a new list endpoint for that.
- Business-owner-confirmed rule (LOCKED): SLoc is editable at **Standard, Final, and Verify** (already in the doc's Final/Verify line-table design; now confirmed it must also apply at Standard, which currently has no RM line grid at all). Wherever the user last set the location, stock check + posting happens against exactly that location.

---

## 1. Migration (new file, additive only)

Create `supabase/migrations/20260711140000_gate27_location_aware_stock_check.sql`. Idempotent. **Do not drop `production_segment_location_config`** (leave the unused table in place — zero cost, avoids unnecessary risk). No new tables needed — `process_order_line.issue_sloc_id` and `reservation_document.storage_location_id` already exist.

If, after implementing Change 2 below, you find `getSegmentLocConfig`/segment-config reads have zero remaining callers in `process_order.handlers.ts`, you may delete that now-dead helper function in the same commit (code cleanup, not a schema change) — but do NOT touch the `production_segment_location_config` table itself.

---

## 2. Backend — `process_order.handlers.ts`

### 2.1 Stroke-line prepopulate now carries the real location
In `createProcessOrderHandler`, the stroke-line prepopulate query must also select `default_storage_location_id`:
```ts
.select("material_id, dosage_pct, display_order, default_storage_location_id")
```
When building `lineRows`, set:
```ts
issue_sloc_id: overrideMap.get(String(strokeLine.material_id)) ?? strokeLine.default_storage_location_id ?? null,
```
where `overrideMap` is built from a new optional request field `body.line_location_overrides` (array of `{ material_id, storage_location_id }`) that the frontend sends when the user overrode a line's default location in the new PR09 grid (Change 4). If a material has no override and (unexpectedly) no `default_storage_location_id`, leave `issue_sloc_id` null and let the existing per-line `PROD_PO_SLOC_MISSING` checks at Verify continue to catch it — do not silently fall back to segment config.

### 2.2 Location-aware availability check
Rewrite `checkStockAvailability` to key by **material_id + storage_location_id**, not material_id alone:
- Change its signature to accept `needed: Map<string, { materialId: string; storageLocationId: string; qty: number }>` (key = `` `${materialId}::${storageLocationId}` ``).
- The `stock_ledger` query must add `.in("storage_location_id", [...locationIds])` alongside the existing `material_id` filter, and the in-memory `available` map must be keyed the same composite way.
- The `reservation_document` netting query must add `.in("storage_location_id", [...locationIds])` and net per composite key too.
- **INT planned-output credit must also become location-aware**: for each INT material being credited, resolve the *INT PO's own* output location the same way as any other stroke-based PO (its `stroke_master.default_storage_location_id` — reuse `resolveOutputStorageLocationId` from Gate-27.6), and only credit that INT PO's planned/actual qty toward a consuming line whose resolved composite key (material+location) matches. If the INT PO's output location cannot be resolved, do not credit it (fail closed, not open).
- Update the two call sites (`createProcessOrderHandler`'s pre-create check, and anywhere else calling `checkStockAvailability`) to build the composite-keyed `needed` map using each line's resolved `issue_sloc_id` (override or stroke_line default) instead of company-wide material totals.

### 2.3 Reservation rows already get the right location for free
Once 2.1 is fixed, the existing reservation-insert code (`reservationRows.map(line => ({ ..., storage_location_id: line.issue_sloc_id ?? ... }))`) will naturally carry the correct per-line location — no further change needed there beyond removing the now-dead segment-config fallback (`segConfig?.rm_sloc_id`/`pm_sloc_id`) from that expression, since `issue_sloc_id` will now always be populated for Process PO's RM lines.

### 2.4 `getIssueStorageLocationId` simplified
Since Process PO lines are always RM (never PM) and `issue_sloc_id` is now always populated at create (2.1) or via override (2.5), simplify this helper to just `toTrimmedString(line.issue_sloc_id) || null` — remove the `segConfig.rm_sloc_id`/`pm_sloc_id` fallback branch entirely. Update its call sites so they no longer need to pass `segConfig` for this purpose (they may still need `segConfig` for nothing else — check if any other use remains; if `getSegmentLocConfig` becomes fully unused, remove its call sites per §1).

### 2.5 SLoc override support at Final and Verify
`applyFinalOrVerifyLineUpdates` (used by both `finalizeProcessOrderHandler` and `verifyProcessOrderHandler`) must now also accept an optional `storage_location_id` per body line:
- If present and different from the line's current `issue_sloc_id`: update `process_order_line.issue_sloc_id` to the new value, **and** update the matching OPEN/PARTIAL `reservation_document` row's `storage_location_id` to the same new value (simple in-place update — this is a location change on the same reservation, not a material-substitution swap, so do NOT cancel+recreate; just `UPDATE reservation_document SET storage_location_id = ... WHERE source_line_id = ...`).
- This applies only to formulation/added RM lines (never to the OUTPUT row, which continues to use `resolveOutputStorageLocationId`).

### 2.6 MTEST manual location entry
`createProcessOrderHandler`'s MTEST branch and the (Gate-27.6-added) MTEST completion path currently call `getSegmentLocConfig`/use `shopfloor_sloc_id`. Since MTEST has no stroke, replace this with **direct fields from the request body**:
- `body.output_storage_location_id` (required for MTEST) — used for the P101 posting instead of `resolveOutputStorageLocationId`/segment config.
- Each manual line's location comes from `body.lines[].storage_location_id` (required per line for MTEST) instead of segment config's `rm_sloc_id`.
- Validate both are present; if missing, return `PROD_PO_SLOC_MISSING` (400) with a clear message ("Storage location required for MTEST — segment config is not used for this type").

### 2.7 Remove segment-config dependency from Verify / INT-complete / CORS
`verifyProcessOrderHandler`, `completeIntProcessOrderHandler`, and `reverseProcessOrderHandler`'s VERIFIED branch currently call `getSegmentLocConfig` and pass it into `resolveOutputStorageLocationId`. Since every stroke-based PO (MTO/HPS/MTS/INT) now always has a stroke, `resolveOutputStorageLocationId` no longer needs a segConfig fallback for those types — simplify its signature to just take `strokeMasterId: string | null` and, if null (should only happen for a legacy/edge case), return `null` (hard error via the existing `PROD_PO_SHOPFLOOR_SLOC_MISSING` check) rather than falling back to segment config. Remove the `getSegmentLocConfig` calls from these three handlers entirely — they no longer need segment config for anything (RM issue locations now come from each line's own `issue_sloc_id`, per 2.4).

---

## 3. Frontend

### 3.1 PR09 (`ProductionPOCreatePage.jsx`) — RM line grid with red-if-short highlighting
After Company + Prodshade + Stroke + Planned Qty are selected (non-MTEST, non-MTEST-mode), fetch the stroke's lines (reuse whatever existing endpoint already returns `stroke_line` rows with `material_id`, `dosage_pct`, `default_storage_location_id` — check `listStrokeMasters`/stroke detail fetch already used elsewhere in this codebase before adding anything new) and render a grid:

| Formulation Material | Dosage% | Planned Qty (= dosage% × batch qty, computed client-side) | Storage Location (combobox, default = stroke_line's `default_storage_location_id`, editable — options from `GET /api/om/storage-locations`) | Available (right-aligned, from a new lightweight availability lookup — see below) |

- Row background gets a red/rose tint (reuse the same rose classes already used elsewhere for errors, e.g. `bg-rose-50`) whenever **Available < Planned Qty** for that row.
- Add a small backend endpoint `GET /api/production/process-orders/availability-preview?company_id=&stroke_master_id=&planned_qty=&overrides=<json array of {material_id, storage_location_id}>` that runs the exact same composite-keyed logic as `checkStockAvailability` (reuse that function directly, don't duplicate the query) and returns `{ material_id, storage_location_id, needed_qty, available_qty, short }[]`. Call this whenever qty or any row's location override changes (debounced ~400ms is fine, reuse whatever debounce pattern already exists in this codebase, or a simple `useEffect` + `setTimeout` if none does — keep it minimal).
- On submit, include `line_location_overrides: [{ material_id, storage_location_id }]` in the create payload for every row whose location the user changed away from the stroke default.
- The backend's own hard-block at actual create time remains authoritative — this grid is a preview/guide, not a replacement for the server check.

### 3.2 PR11 (`ProductionPOFinalPage.jsx`) and PR12 (`ProductionPOVerifyPage.jsx`) — SLoc becomes editable
Change the SLoc cell (currently `<td>{row.sloc_label}</td>`) to an `ErpComboboxField` sourced from `GET /api/om/storage-locations`, defaulting to the line's current `issue_sloc_id`/resolved location. On change, track it in the row's draft state and include `storage_location_id` in that line's payload on save (per §2.5's backend contract). Apply the same red-tint rule as PR09 when Actual Qty exceeds Available at the row's current (possibly just-overridden) location — call the same `availability-preview` endpoint for this, scoped to the single PO's lines (pass `process_order_id` instead of `stroke_master_id`/`planned_qty` if that's simpler — use whichever query shape reuses `checkStockAvailability`'s logic most directly without duplicating it).

### 3.3 MTEST form
Wherever MTEST's manual RM lines are entered (the existing MTEST mode in `ProductionPOCreatePage.jsx`), add a Storage Location combobox per line (required) and one header-level Output Storage Location combobox (required) — both from `GET /api/om/storage-locations`. Send these in the create payload per §2.6.

---

## Hard rules

1. Implement only the location-authority correction described above — no new business rules beyond what's stated.
2. Do NOT drop or seed `production_segment_location_config` — just stop reading it in the listed call sites.
3. Location netting/availability must be a single batched query per check (material+location composite keys), never a per-line DB round-trip loop (§8B).
4. R-01: storage location combobox must show `code — name`, never a raw UUID.
5. `useQuery` for the new availability-preview fetch, not `useEffect`+manual fetch state, unless the existing debounce pattern in this codebase already uses something else — match whatever convention already exists in these files.
6. Keep file headers intact.
7. Do not touch Packing PO, PR16, or the Result Recording page — separate briefs.

## Verification (Codex, before the log entry)
1. `deno check` on `process_order.handlers.ts` and any new route file — only file-anchored errors count.
2. Confirm no remaining `production_mode`, and confirm `getSegmentLocConfig` has zero remaining call sites (or is deleted) in `process_order.handlers.ts`.
3. Confirm the availability composite-key logic filters by both material_id and storage_location_id in both the ledger query and the reservation-netting query.
4. Grep touched frontend files for raw-UUID fallbacks and mojibake.

## Log + commit
Append one entry to `docs/Codex-Log.md` (existing template). List every file touched, and explicitly call out the new `availability-preview` endpoint's route + ACL registration (copy the ACL resource/action from the nearest sibling read-only production route). **Do not run git commands** — Claude (or the next session, per `GATE27-CODEX-DRIVER-GUIDE.md` §4) verifies and commits.
