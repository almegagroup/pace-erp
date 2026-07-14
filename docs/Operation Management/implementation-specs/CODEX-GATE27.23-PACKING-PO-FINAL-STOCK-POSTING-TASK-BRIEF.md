# CODEX-GATE27.23-PACKING-PO-FINAL-STOCK-POSTING-TASK-BRIEF

**Gate:** 27.23
**Domain:** PRODUCTION
**Title:** Packing PO Standard/Final/Reverse rebuild to match the 2026-07-13 locks — Pack-BOM-driven lines, 3-movement Final posting (SFG issue + PM issue + FG receipt), batch/document-number granularity, COR6 correction + CORS reversal, FG stock breakdown report.
**Scope:** rewrite `packing_order.handlers.ts` (Change 1–5 below) + rebuild `PackingOrderPage.jsx`'s Create/Edit/Detail UI (Change 6, added 2026-07-13 — the original brief only specified backend changes and missed that the existing frontend page is now fundamentally incompatible with them) + new frontend report page. No QA step, no reservation engine — see "Explicitly out of scope" below, this is not a full Packing PO lifecycle redesign.
**Dependency:** **Hard dependency on Gate-27.22 (Pack BOM full rebuild) landing first** — Change 1 of this brief reads `pack_bom`/`pack_bom_line` fields (company_id, storage_location_id, movement_type_code) that 27.22 creates. Do not start this brief until 27.22 is verified.
**Reference doc:** feasibility doc §83.15 "Pack BOM — Full Design Lock, Session 2 (LOCKED — 2026-07-13)", subsection "FG batch/lot identity for stock movements and reporting" — plus the reconfirmed "no Verify" / COR6+CORS lines at the end of that same subsection.

---

## ⚠️ Verification findings (2026-07-13, after first implementation pass — commit `003d48a`) — fix these before moving on

Claude reviewed the first implementation pass directly against Dev (schema + code).

**Already fixed directly in Dev by Claude — do not redo:** the `packing_order_line_line_type_check` migration (adding `FG` to the allowed set) had also never actually been applied to Dev — applied now.

**Not yet fixed — please fix these:**

1. **`createPackingOrderHandler`, the FG line's `total_qty` for `bomRequired=false` (599/000/001) is in the wrong unit — a real bug, not a style nit.** Currently:
   ```
   total_qty: bomRequired ? plannedQtyKg : (numPacks ?? plannedQtyKg),
   ```
   For the `false` branch this evaluates to `numPacks` — a **count** (e.g. `2` barrels) — not the actual KG quantity (e.g. `460`). Compare with the SFG line right above it in the same function, which correctly uses `total_qty: plannedQtyKg` for the same branch. Since `finalizePackingOrderHandler` reads `Number(line.actual_qty ?? line.total_qty ?? 0)` as the literal quantity it posts to `post_stock_movement()` with `baseUomCode="KG"`, this bug means **every flexible-fill Packing PO's FG receipt (P101) posts the barrel/tanker *count* as if it were KG** — e.g. posts `2` instead of `460`. This is exactly the barrel-count-vs-KG confusion the design session spent significant time locking correctly (stock_ledger must always be KG, never a container count) — fix it to `total_qty: bomRequired ? plannedQtyKg : plannedQtyKg` (i.e. always `plannedQtyKg` for this line, the `numPacks` branch should never have been there at all — the FG line's KG total is the same `plannedQtyKg` regardless of `bomRequired`). Add a regression check for this specific case to your verification pass, not just the existing "confirm 3 movements post" check — actually inspect the *quantity* posted for a 599/000/001 PO, not just that a P101 row exists.

2. **Change 6 (rebuild `PackingOrderPage.jsx`) — confirmed not implemented in commit `003d48a`.** `git show --stat` on that commit shows `PackingOrderPage.jsx` was not touched at all. This Change was added to this brief file after your first pass may have already read it — it is not optional, it's required for the backend changes above to even be usable (the page's current Create form still posts the old raw-UUID/manual-PM-line shape, which Change 1 already ignores server-side, and the current Finalize button copy is now factually wrong). Please implement Change 6 in full this pass.

3. **`route-acl-registry.ts` — the new `POST .../correct` endpoint (Change 4) references a `resourceCode` that doesn't exist anywhere: `PROD_PACKING_PO_FINAL`.** Verified via direct query against both `acl.menu_master` and `erp_menu.menu_master` — neither has this code registered. This system is Default-Deny (CLAUDE.md §8), so **every caller, including DIRECTOR/SA, will get denied on this endpoint** until it's registered. Fix: either (a) register `PROD_PACKING_PO_FINAL` as a proper menu/ACL resource (same MCP-side steps used earlier this session for other new resources — insert into both `erp_menu.menu_master` and `acl.menu_master` with matching codes per CLAUDE.md §8's "acl.menu_master.menu_code MUST = erp_menu.menu_master.resource_code" rule, map capabilities via `acl.capability_menu_actions`, and regenerate the ACL/menu snapshots), or (b) if this correction action is meant to reuse an existing permission scope rather than be its own resource, point it at an already-registered resourceCode instead (e.g. whatever resource already governs Packing PO writes) — decide which and document the choice in your log; don't leave it pointing at an unregistered code either way.

4. **`FgStockBreakdownPage.jsx` is unreachable from the sidebar.** `operationScreens.js` got a new `PROD_FG_STOCK_BREAKDOWN` screen_code and `AppRouter.jsx` got the route, but this screen_code was never registered in `acl.menu_master`/`erp_menu.menu_master` either, so no menu item will ever appear for it (same class of gap as #3 above, and the same one this project hit before with the IN06 page earlier in this Gate). It's reachable by typing the URL directly today, but not through the UI. Register it the same way as #3, and also make sure Change 6's "link/button from the Packing Order list to this report" requirement actually gets built (it wasn't, since Change 6 itself wasn't built) — the report is useless if nothing in the UI points to it.

---

## Before you write any code

Same as GATE27.22's brief — read CLAUDE.md §8/8A/8B/8C in full, read `OM-IMPLEMENTATION-LOG.md`/`OM-CORRECTION-NOTES.md`, verify current schema/data via MCP before assuming, batch independent DB work per §8B, never invent a suffixed `document_number` per §8C.

**This brief covers only what was actually locked in the 2026-07-13 session.** Packing PO's known pre-existing gaps — no QA step, no reservation engine — are real and tracked (see CLAUDE.md's own "Next: Packing PO" note), but they were **not** part of today's design discussion and have no locked spec to implement against. Do not invent a QA/reservation design to fill them in as part of this brief; that needs its own separate design session first, exactly like Gate-27's Process PO QA/reservation work needed one. Flag it in your log as still open, and stop there.

---

## Current state (verified against `packing_order.handlers.ts`, 2026-07-13)

- `createPackingOrderHandler`: creates at `STANDARD`, auto-adds one `packing_order_line` row (`line_type='SFG'`, batch_number copied from the parent `process_order.batch_number`, `total_qty=planned_qty_kg`) — but this is a bookkeeping row only, **no stock movement is posted for it, ever, anywhere in this file**. PM lines come verbatim from the caller's `body.pm_lines` (no Pack BOM lookup at all).
- `finalizePackingOrderHandler`: posts **P261 (PM issue) only** — reading each PM line's `issue_sloc_id` or falling back to `production_segment_location_config.pm_sloc_id`. **No SFG issue (P261) is posted, and no FG receipt (P101) is posted at all** — Final currently only debits packing material, it never actually moves the SFG into the FG SKU. This is the real, previously-undocumented gap this brief exists to close.
- `postStockMovement()` (local wrapper, line 68) calls the **14-param** `post_stock_movement()` overload (no `p_batch_number`) — the batch-aware 15-param overload added by Gate-27.19 is not used anywhere in this file yet.
- `document_number` passed to every call today is already `poData.po_number` (the Packing PO's own number) — this part already matches the 2026-07-13 lock, do not change it.
- `reversePackingOrderHandler`: only reverses the PM P261 postings (as P262). No SFG/FG reversal exists because Final never posts them today.
- No COR6-equivalent correction path exists at all today — the only two states after FINAL are "leave it" or "REVERSED" (full reversal).
- `packing_order_line` columns: `id, packing_order_id, line_type, material_id, batch_number, qty_per_pack, total_qty, actual_qty, issue_sloc_id, display_order` (plus `stock_ledger_id`, added informally by the existing code via `.update()` — confirm this column actually exists in the table before relying on it further; it may have been added ad hoc).

---

## Change 1 — `createPackingOrderHandler`: source lines from Pack BOM, not caller input

Replace the caller-supplied `pm_lines` array entirely. Once `material_id` (the FG SKU) is known:

1. Look up the SKU's **ACTIVE** `pack_bom` for this `company_id` (Gate-27.22 makes `pack_bom` company-scoped — match on `company_id` + `sku_material_id`, status `ACTIVE`). If none exists, reject the create with a clear 422 (`PROD_PACK_NO_ACTIVE_BOM`) — this is the existing "BOM must be ACTIVE before Packing PO" hard rule from §83.15, currently not enforced anywhere in this handler.
2. Pull that Pack BOM's OUTPUT row (FG SKU, its `storage_location_id`), INPUT/SFG row (Prodshade material, its `storage_location_id`, and its `qty` if `bom_required=true`), and PM rows (material, qty, `storage_location_id`, `is_primary_container`).
3. For `bom_required=true` SKUs: derive `packing_order_line` rows directly from the BOM's stored quantities × `num_packs` (the BOM's qty is "per one outer pack unit").
4. For `bom_required=false` SKUs (599/000/001): quantities come from this Packing PO's own header fields instead (`num_packs`, `fill_qty_per_pack` — already present on `packing_order`), exactly per the existing locked table (barrels × fill_qty_per_barrel for SFG; `num_packs`×1 for OUTPUT since output is a barrel count, etc. — re-read the "BOM Required = No qty calculation at Packing PO time" table in §83.15 before writing this, don't approximate it from memory).
5. Insert one `packing_order_line` per BOM line (`line_type` = `SFG`/`FG`/`PM` — check whether `packing_order_line.line_type` needs a new allowed value for the FG/OUTPUT row, since today it's only ever `SFG`/`PM`; confirm the actual CHECK constraint via MCP and extend it in a small migration if needed), each carrying its own `issue_sloc_id`/receipt location copied from the Pack BOM line (**not** re-derived from `production_segment_location_config`, which per the 2026-07-13 lock no longer governs FG/SFG locations here — see Change 2).
6. Keep copying `batch_number` from the parent `process_order.batch_number` onto the SFG and FG lines (already done for SFG today — extend the same copy to the new FG line) — this is bookkeeping on the line row, separate from what actually gets passed to `post_stock_movement()` in Change 2.

---

## Change 2 — `finalizePackingOrderHandler`: post all 3 movements with correct batch/document granularity

1. **Extend `postStockMovement()`** (the local wrapper) to accept an optional `batchNumber` and, when present, call the **15-param** `post_stock_movement()` overload (the one with `p_batch_number`, added by Gate-27.19 — `20260712013000_gate27_batch_number_persistence.sql`) instead of the 14-param one. Do not touch the RPC itself.
2. **SFG issue (P261):** for the SFG line, post `direction='OUT'`, `movementTypeCode='P261'`, `storageLocationId` = that line's own `issue_sloc_id` (sourced from Pack BOM's INPUT row per Change 1 — the Stroke-default S0xx location), `quantity` = that line's `actual_qty` (or `total_qty` if actual not yet entered, matching the existing PM-line fallback pattern already in this file), `batchNumber` = the parent Process PO's `batch_number` (fetch it if not already on hand — it's already stored on the SFG `packing_order_line` row per Change 1.6, cheaper to read from there than re-joining `process_order`).
3. **PM issue (P261):** same as today, but change the `storageLocationId` source from `production_segment_location_config.pm_sloc_id` fallback to the Pack BOM line's own `issue_sloc_id` (per Change 1.5) as the primary source — keep the segment-config fallback only if a PM line genuinely has no Pack-BOM-sourced location (e.g. a BOM-not-required pack type's manually-entered PM line). Also pass `batchNumber` = the same parent-batch value (PM consumption is tied to the same production batch, even though PM itself isn't individually batch-tracked as a material).
4. **FG receipt (P101) — new, does not exist today:** post `direction='IN'`, `movementTypeCode='P101'`, `storageLocationId` = the FG line's own location (the F0xx location from Pack BOM's OUTPUT row per Change 1.5), `materialId` = the FG SKU (`packing_order.material_id`), `quantity` = the actual total (recompute from actual `num_packs`/`fill_qty_per_pack` if those can be adjusted at Final — check whether `actual_qty_kg` on the header should drive this or the line's own `actual_qty`, and make the two consistent), `documentNumber` = `poData.po_number` (unchanged, already correct), `batchNumber` = the same parent Process PO batch_number. This is a **direct receipt straight to the F0xx location** — no separate "S003→F003 transfer" movement, per the 2026-07-13 correction (see reference doc).
5. Per §8B, these 3 postings are **independent** of each other (SFG issue, PM issue×N, FG receipt don't depend on each other's committed state within one Final call) except that logically stock must exist to issue before it's meaningful to receive — but since this is one Packing PO's one Final transaction posting 3 distinct ledger entries, not a chain reading back its own prior writes, they can be issued as `Promise.all` rather than forced sequential; if you find a reason they must be sequential (e.g. a shared row-lock inside `post_stock_movement()` itself serializes them anyway), document that reasoning with a `// DEPENDENT:` comment rather than silently leaving it sequential.
6. Store each posting's `stock_ledger_id` back onto its own `packing_order_line` row (extends the existing pattern already used for PM lines) — needed by Change 4's reversal/correction logic.

---

## Change 3 — Reversal (CORS): reverse all 3 movement types, not just PM

`reversePackingOrderHandler` currently only reverses PM (P262). Extend it to also reverse:
- The SFG issue → post a P262-style reversal (`direction='IN'`, same movement-type-reversal pattern already used for PM, `reversalOfId` = that line's stored `stock_ledger_id`).
- The FG receipt → post a **P102** reversal (`direction='OUT'`, `reversalOfId` = the FG line's stored `stock_ledger_id`) — P102 is the already-existing reversal code for P101 (confirmed elsewhere in this codebase, e.g. Process PO's own INT/MTEST completion reversal — find and match that exact pattern rather than inventing a new one).
- Keep the existing `${po_number}-REV` document-number-suffix pattern **only if** that's how existing reversal documents in this codebase are conventionally numbered — if you find this actually violates §8C's document-number rule (the engine handles its own item numbering per document_number; a manually suffixed document_number is a separate document, which may or may not be the intended convention here), check how Process PO's own CORS reversal numbers its reversal document and match that instead of guessing.

## Change 4 — COR6-equivalent correction (new: add/less lines after Final, without a full reverse)

The 2026-07-13 lock says post-Final mistakes get fixed via "COR6 (add/less)" **or** CORS (full reverse) — both must exist, this isn't an either/or choice for the system to make, it's a choice for the user. Add a new endpoint, e.g. `POST /api/production/packing-orders/:id/correct`, available only at `status='FINAL'`:
- Accepts additional/adjusted line quantities (mirror whatever shape Process PO's own PR12 COR6 correction-mode endpoint uses for its analogous "add/less" capability — find and reuse that pattern rather than designing a new shape from scratch, per this brief's general reuse-over-reinvent instruction).
- Posts only the **delta** as new stock movements (additional P261/P101, or reversing P262/P102 for a reduction) — it must not touch/replace the original Final postings, matching how corrections elsewhere in this codebase are append-only (never edit a posted ledger row in place).
- Update the corrected line's `actual_qty` to the new total.

If you cannot find an existing Process-PO-side COR6 correction-mode handler to mirror, say so explicitly in your log and describe the minimal shape you built instead — do not silently skip this Change.

## Change 5 — FG stock breakdown report (new page + endpoint)

New read-only report, e.g. `GET /api/production/fg-stock-breakdown?material_id=&company_id=`, and a corresponding frontend page. Query shape (already specified in the reference doc, reproduce exactly):

```
stock_ledger (P101 IN rows, filtered to the given material_id/company_id)
  JOIN stock_document  ON stock_document.id = stock_ledger.stock_document_id
  JOIN packing_order   ON packing_order.po_number = stock_document.document_number
GROUP BY stock_ledger.batch_number
  → drill-down rows per packing_order: po_number, num_packs, fill_qty_per_pack, quantity
```

Resolve all display fields (§8A) — material name, batch number as-is (it already is a human-readable business number, not a UUID), Packing PO number. This report is explicitly designed to be reused later as the Dispatch (L5) selection UI (per the reference doc) — build it as a reusable table/query component, not a one-off page, so that reuse is straightforward when Dispatch gets its formal session. Do not build any Dispatch functionality itself here — this is display-only in this brief.

---

## Change 6 — Frontend: rebuild `PackingOrderPage.jsx`'s Create/Detail/Edit UI (added 2026-07-13)

**Why this is needed:** verified `frontend/src/pages/dashboard/production/PackingOrderPage.jsx` as it exists today — its Create form is 4 raw UUID paste-in text inputs (`company_id`, `process_order_id`, `pack_code_config_id`, plus `planned_qty_kg`), a pre-existing §8A/R-01 violation on its own. Once Change 1 lands (server derives PM/SFG/FG lines from the Pack BOM and ignores any caller-supplied `pm_lines`), this page's "Edit Lines" drawer — which lets a user manually type a PM material's `planned_qty_kg` — becomes actively misleading: the qty it edits either won't match what Final actually posts, or will be silently overwritten. This page must be rebuilt, not patched.

**New Create flow (2 pages, mirrors the pattern already established for Pack BOM PR05 and Process PO PR09 — reuse those components, don't reinvent):**

- **Page 1 (identify):** Company (`TransactionCompanySelector`) → Process Order combobox (search/select by `po_number` + `batch_number`, filtered to that company's `VERIFIED` or later Process POs — not a raw UUID paste) → PO Type auto-derives from the selected Process Order's own `po_type` (MTO→PMTO etc., reuse the same mapping used elsewhere) → FG SKU combobox (same "eligible SKU" filtering as Pack BOM's PR05 Page 1 — company-mapped + type-matched) → Pack Code (from the SKU's own `pack_code`, display-only, resolved via the SKU's Material Master row, not user-selected separately) → for BOM-not-required SKUs (599/000/001) only: `num_packs` and `fill_qty_per_pack` input fields (these drive the qty calculation per the existing locked table); for BOM-required SKUs: just `num_packs` (fill qty comes from the fixed BOM itself).
- **Page 2 (review, read-only except header qty inputs already entered):** show the server-derived SFG/PM/FG lines (material, qty, storage location — all resolved names, §8A) exactly as Change 1 will construct them, so the user can see what's about to be created before confirming — no line-level editing here (that capability moves to Change 4's new COR6-style correct endpoint, post-Final, not pre-create).
- Submit calls the rewritten `createPackingOrderHandler` with just `{ company_id, process_order_id, material_id (FG SKU), num_packs, fill_qty_per_pack }` — no `pm_lines` array at all anymore.

**Detail drawer:** replace the raw `material_id?.slice(0,8)` line rendering with resolved material names (pace_code — material_name), show each line's resolved storage location, and show `batch_number` per line (now meaningful — SFG/FG lines carry the parent Process PO's batch, per Change 2).

**Remove entirely:** the "Edit Lines" drawer and its `updatePackingOrderLinesHandler` call from this page — lines are no longer manually editable pre-Final (Change 1 makes them fully derived). If `updatePackingOrderLinesHandler` itself has no other caller after this, flag it in your log as dead code rather than deleting it silently (confirm via a repo-wide search whether anything else calls it before deciding).

**Finalize action:** update the button copy/confirm dialog to reflect that Final now posts 3 movements (SFG issue, PM issue, FG receipt), not just PM — the current "PM consumption will be posted (P261)" text is now inaccurate and would mislead the user about what's about to happen.

**Add:** a way to trigger Change 4's new correct-after-Final endpoint from this page (a button visible only at `status='FINAL'`, opening a small form for the delta lines) — same drawer pattern already used elsewhere in this file.

**Add:** a link/button to Change 5's new FG stock breakdown report from this page's list view (e.g. "View Stock Breakdown" on a row), so the two new features are actually reachable, not just built.

---

## Hard rules

1. No raw UUIDs anywhere in the new report or any touched page (§8A).
2. Batch independent multi-row DB work per §8B (materials, group lookups, etc. — same as the existing file already does correctly in most places; keep that discipline in whatever you add).
3. Never invent a suffixed `document_number` to dodge a uniqueness conflict (§8C) — `post_stock_movement()` handles item numbering itself; if Change 3's reversal-document-numbering turns out to already violate this in the *existing* code (the `-REV` suffix), flag it rather than copying it forward uncritically — check first, per Change 3's own note.
4. Do not add a QA step or a reservation engine to Packing PO in this brief — explicitly out of scope, see below.
5. Do not touch `process_order.handlers.ts`, Process PO's own Verify/CORS logic, or anything Process-PO-scoped — read-only reference for patterns to mirror, nothing there should change.
6. Do not touch `stock_snapshot` or `post_stock_movement()` itself — only call the *existing* batch-aware overload, don't modify the engine.

## Explicitly out of scope (known gaps, not part of today's lock, do not invent a design)

- QA step for Packing PO (if one is even needed — not discussed in the 2026-07-13 session).
- Reservation engine for Packing PO (§83.5 lists it as one of 5 reservation sources but the mechanism itself was never built for Packing PO specifically).
- SO↔FO link (`sales_order_line.fo_id`) — deferred to the Dispatch (L5) formal session.
- Any Dispatch (L5) functionality — Change 5's report is display-only, reused later, not built into a dispatch flow now.
- PID for FG.
- `stock_snapshot` batch-split — explicitly decided against for now.

## Verification

1. Create a Packing PO for a `bom_required=true` SKU with an ACTIVE Pack BOM (from Gate-27.22) — confirm lines auto-populate from the BOM (SFG qty, PM qty, both storage locations), not from any caller-supplied line array.
2. Attempt to create a Packing PO for a SKU with no ACTIVE Pack BOM — confirm it's rejected with `PROD_PACK_NO_ACTIVE_BOM`, not silently allowed.
3. Finalize it — confirm **3** ledger entries post (SFG P261 OUT, PM P261 OUT ×N, FG P101 IN), all sharing `document_number = po_number` and `batch_number` = the parent Process PO's batch, and the FG receipt lands at the Pack BOM's OUTPUT F0xx location (not any S0xx segment-config location).
4. Reverse it (CORS) — confirm all 3 (not just PM) get their correct reversal movement (P262/P262/P102) posted, tagged back via `reversalOfId`.
5. Use the new COR6-equivalent correct endpoint on a still-FINAL (not reversed) PO to add extra qty — confirm it posts only the delta, doesn't touch the original ledger rows.
6. Open the new FG stock breakdown report for a material with 2+ Packing POs sharing one batch (seed this via MCP if no real data exists yet) — confirm it groups correctly by batch with the right per-PO drill-down numbers.
7. Confirm the rebuilt Create page has zero raw-UUID inputs (Process Order and FG SKU are both comboboxes with resolved labels), Page 2's line preview matches what actually gets created, and the old "Edit Lines" drawer no longer exists on this page.
8. `deno check` and frontend build clean (zero new errors beyond the documented pre-existing baseline).

## Log + commit

- Append one entry to `docs/Codex-Log.md` and to `OM-IMPLEMENTATION-LOG.md` (Gate-27.23).
- Commit with `Co-Authored-By: Codex`. Do not push.
