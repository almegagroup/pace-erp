# CODEX-GATE27.28-PART2-FINISH-UI-TASK-BRIEF

**Gate:** 27.28 (Part 2 — completes the original brief, does not replace it)
**Domain:** PROCUREMENT (Opening Stock)
**Reference:** `CODEX-GATE27.28-IN05-IN06-SFG-FG-OPENING-TASK-BRIEF.md` (read that first — this brief only covers what's left) + feasibility doc §115.

---

## Status check (verified live, 2026-08-01) — read before touching anything

Part 1 landed the backend correctly and it's solid, verified via `deno check` (clean) and direct diff review:
- ✅ Migration (`opening_stock_line.packing_order_id` + FK) applied.
- ✅ PR22/PR23 (`opening_genealogy.handlers.ts`) — old `openingBatchExists` guards removed, both handlers now create freely without requiring IN05 to have posted first.
- ✅ New `listOldPackingPoBatchesHandler` (`GET /api/production/old-packing-po/batches`) — handler, route, ACL entry, and `prodApi.js` client function (`listOldPackingPoBatches`) all exist and are wired correctly.
- ✅ `opening_stock.handlers.ts` — `normalizeOpeningGenealogyLine()` (validates SFG batch against PR22 / FG packing_order_id against PR23) and `validateOpeningSubmitGenealogy()` (Submit-time qty reconciliation) are both implemented correctly and wired into `addOpeningStockLineHandler`/`updateOpeningStockLineHandler`/`batchUpdateOpeningStockLinesHandler`/`submitOpeningStockDocumentHandler`.

**None of this needs to change. Do not touch `opening_stock.handlers.ts` or `opening_genealogy.handlers.ts` unless fixing something specifically named below.**

What's missing is entirely in `frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx`: the data-fetching (`singleOpeningSfgQuery`, `singleOpeningFgQuery`, `editOpeningSfgQuery`, `editOpeningFgQuery`, `bulkOpeningQueries`, `singleRateUomOptions`, `editRateUomOptions`, `buildRateUomOptions`/`baseRateToDisplay`) was added but **never connected to any rendered form control**. Confirmed via `eslint`: 8 `no-unused-vars` errors on exactly these. The Batch Number field is still the original plain `<input type="text">` in all three forms (single-entry ~line 1101, edit ~line 975, bulk-table-header ~line 1207), and there is no Packing PO field anywhere. This means:
- SFG lines still work (free-typed batch number, validated server-side) but without the intended dropdown/Stroke-display/Remaining-Qty UX.
- **FG lines are completely broken** — there's no way to supply `packing_order_id`, so the backend's `OPENING_STOCK_FG_PACKING_PO_NOT_FOUND` rejects every save.

## 🔴 Change 0 — Fix first, it's a live regression affecting ALL material types

`handleAddBulkLines()`, inside `validRows.map((row) => { ... })`: line ~504 references `bulkConversionQueries[index]` but `index` is never defined (`eslint` catches this — `'index' is not defined  no-undef`). This throws at runtime the moment **any** user clicks "Add All Lines" in bulk mode, for RM/PM/INT/SFG/FG/MTS/MTEST alike — not an SFG/FG-only issue.

**Don't just add `index` from the `.map()` callback** — `bulkConversionQueries` (and `bulkOpeningQueries`, once you wire it in) are positionally aligned to `bulkRows` (the full, unfiltered array), but `validRows` is `bulkRows.filter(...)` — a different, shorter array with different positions. Since `.filter()` preserves object references, the correct fix is `const rowIndex = bulkRows.indexOf(row);` inside the `validRows.map((row) => {...})` callback, then use `bulkConversionQueries[rowIndex]?.data` (and `bulkOpeningQueries[rowIndex]?.data` for Change 2 below) — not the `validRows` map index.

## Change 1 — SFG: Batch Number → dropdown (single, edit, bulk)

Replace the plain `<input type="text">` Batch Number field with an `ErpComboboxField` (same component already used for Material elsewhere in this file) in all three places, **only when the material is SFG and the document's `po_type` is MTO/HPS** (`isOpeningGenealogyDocument && documentMaterialType === "SFG"` — both already computed in the file). Options come from the already-fetched `singleOpeningSfgQuery`/`editOpeningSfgQuery`/`bulkOpeningQueries[rowIndex]` (data shape: `{id, po_number, po_type, batch_number, material_id, actual_qty, stroke_master_id, prodshade, stroke_number}` — `stroke_number` and `prodshade` were added in Part 1 specifically for this). Value/onChange should set `batch_number` to the selected row's `batch_number` (not its `id` — the backend field is `batch_number`, matching what `normalizeOpeningGenealogyLine` looks up).

Below the dropdown, show a small read-only line: `Stroke {stroke_number ?? '--'} · Remaining {remaining} KG` where `remaining = selectedBatch.actual_qty - Σ(other lines in this document sharing the same batch_number).quantity` (compute from `lines` / `bulkRows` already in scope — no new API call). When the dropdown selection changes, prefill the Quantity field with that `remaining` value (still user-editable, per §115.5 — they may split it across Unrestricted/QA/Blocked rows).

For non-genealogy SFG/FG (MTS/MTEST, or RM/PM/INT which never show this field at all) — leave the existing free-text `<input>` exactly as-is. Gate every change behind the `isOpeningGenealogyDocument` check that Part 1 already added.

## Change 2 — FG: new "Packing PO" field (single, edit, bulk)

Add a new field, **only when `isOpeningGenealogyDocument && documentMaterialType === "FG"`**, positioned where Batch Number would normally go (FG's Batch Number is no longer user-entered at all in this case — it's derived server-side from the selected packing order, per Part 1's `normalizeOpeningGenealogyLine`). Label it "Packing PO (PR23)". Options from `singleOpeningFgQuery`/`editOpeningFgQuery`/`bulkOpeningQueries[rowIndex]` (data shape: `{id, po_number, po_type, source_po_type, batch_number, material_id, actual_qty_kg, fill_qty_per_pack, num_packs, sku}`). Show each option as `${po_number} · Batch ${batch_number} · ${actual_qty_kg} KG`. On selection, set `packing_order_id` to the selected row's `id` (this field already exists in form state and is already sent in the API payload — you're only adding the control that sets it).

Below the dropdown, show read-only: `Batch {batch_number} · {num_packs ?? '--'} packs · {fill_qty_per_pack ?? '--'} KG/pack · Remaining {remaining} KG` where `remaining = selectedPackingOrder.actual_qty_kg - Σ(other lines in this document sharing the same packing_order_id).quantity`. Prefill Quantity with `remaining` on selection (still editable, for splitting across Unrestricted/QA/Blocked).

## Change 3 — FG Rate: "Rate Per Pack" using the selected Packing PO's own fill_qty_per_pack

**This is different from the `rate_uom_code`/`buildRateUomOptions` mechanism already in the file** — that mechanism reads `material_uom_conversion` rows, which per §113.15 do NOT exist for variable/non-fixed pack types (599 Barrel) — only for Fixed types (510 IBC). Don't try to make `buildRateUomOptions` cover this case.

Instead, when a Packing PO is selected (Change 2) and its `fill_qty_per_pack` is a positive number, show the Rate input labeled "Rate Per Pack" instead of "Rate Per Unit", and convert on save: `rate_per_unit = enteredRate / fill_qty_per_pack`. When `fill_qty_per_pack` is null/0 (Tanker, pack code 000 — no per-pack concept, quantity is already KG-native), keep the label "Rate Per Unit" / "Rate Per KG" and send the entered value directly, no conversion. This is a **local, inline computation** in the single/edit/bulk rate handlers — don't route it through `buildRateUomOptions`/`displayRateToBase`, those stay as they are for the MTS/MTEST case (Change 4 next) which is a genuinely different mechanism.

## Change 4 — MTS/MTEST Rate UoM selector — just needs rendering, logic already exists

`buildRateUomOptions`/`baseRateToDisplay`/`displayRateToBase`/`singleRateUomOptions`/`editRateUomOptions` and the `showRateUomSelector` flag were already added correctly in Part 1 for the MTS/MTEST case (§115.7, `material_uom_conversion`-driven). They just need a `<select>` control rendered next to the Rate input in single-entry and edit forms (bulk table can reuse the same pattern per-row), visible when `showRateUomSelector` is true, options from `singleRateUomOptions`/`editRateUomOptions`/a per-row equivalent in bulk. Wire its `onChange` to set `rate_uom_code` in form state (already exists, already read by `displayRateToBase` at save time — you're only adding the missing `<select>`).

## Change 5 — IN06 mirror (`OpeningStockApprovalPage.jsx`)

Untouched so far. Apply the same field logic as Changes 1-4 to this page's editable-line table (`mapLineForEditing`/`createNewEditableLine` and the corresponding save flow using `batchUpdateOpeningStockLines`). Same components, same query patterns, same gating on `isOpeningGenealogyDocument`/material type — this page reads the document the same way IN05 does, so the same `document.material_type`/`document.po_type` values are available from its own detail fetch.

## Change 6 — PR22/PR23 frontend copy (small, cosmetic, do last)

In `OldProcessPoPage.jsx` and `OldPackingPoPage.jsx`:
- File-header comment `"Sequence: Opening Stock (IN05) first → then this page"` → `"Sequence: this page first → then Opening Stock (IN05)"`.
- `OldProcessPoPage.jsx`: remove/reword the `"Must exactly match the Opening Stock batch — it is the only join."` hint under Batch Number (reconciliation now happens at IN05 Submit, not here) and the `"Must reconcile with the opening SFG qty for this batch."` hint under Actual Output Qty.
- `OldPackingPoPage.jsx`: same for its Actual Qty (KG) hint.

---

## Hard rules (unchanged from Part 1)

1. Don't regress RM/PM/INT/MTS/MTEST behavior — every change here is additive/conditional on `isOpeningGenealogyDocument` (Changes 1-3) or `showRateUomSelector` (Change 4), never a change to the shared generic path.
2. Apply every field change to **all three** entry surfaces (single-entry, edit, bulk-table) plus IN06 — don't leave one behind, that's exactly how Part 1 ended up half-done (the queries existed but nothing rendered them).

## Verification

1. `eslint` on `OpeningStockDetailPage.jsx` — must go from 9 errors to 0. This alone proves the dead code is now used.
2. Bulk Entry: add 3+ rows of mixed material types, click "Add All Lines", confirm no console error and correct rates land (test with at least one row whose conversion factor differs from row 0, to catch the index-alignment bug for real).
3. Full SFG→FG chain from the Part 1 brief's own verification steps 1 still applies — walk through it now that the UI exists: PR22 → IN05 SFG (dropdown shows batch + stroke + remaining qty, split Unrestricted/QUALITY_INSPECTION) → PR23 → IN05 FG (dropdown shows Packing PO + batch/packs/fill-qty/remaining, Rate Per Pack converts correctly) → Submit (reconciliation blocks if short, passes once complete) → Approve → Post.
4. Same chain via IN06's correction UI on a SUBMITTED document.
5. MTS/MTEST: confirm the rate UoM `<select>` now appears when the material has a fixed `material_uom_conversion` row, and is absent otherwise (unchanged behavior).
6. `deno check` clean (should already be, this brief doesn't touch backend). `eslint` clean on all touched frontend files.

## Log + commit

- Append entries to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md` (Gate-27.28, mark as Part 2, reference the Part 1 entry).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
