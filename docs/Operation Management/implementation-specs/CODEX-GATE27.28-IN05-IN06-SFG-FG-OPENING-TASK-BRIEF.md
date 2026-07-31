# CODEX-GATE27.28-IN05-IN06-SFG-FG-OPENING-TASK-BRIEF

**Gate:** 27.28
**Domain:** PROCUREMENT (Opening Stock) / PRODUCTION (Opening Genealogy)
**TX Code:** IN05 (`PROC_OPENING_STOCK_LIST`), IN06 (`PROC_OPENING_STOCK_APPROVAL`), PR22 (`PROD_OLD_PROCESS_PO`), PR23 (`PROD_OLD_PACKING_PO`)
**Title:** Build the MTO/HPS SFG/FG Opening Stock entry flow (currently a 100%-unbuilt placeholder), wired against PR22 (Old Process PO) / PR23 (Old Packing PO) genealogy records which must now be created **before** Opening Stock instead of after.
**Reference doc:** feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`, **Section 115** (full discovery session, read in full before writing any code — every field, every decision, and the two design reversals that happened mid-session are recorded there with their reasoning). Also re-read **§104.9** (original PR22/PR23 design) and **§104.9.1** (the reconciliation guard this brief reverses).

---

## Before you write any code

1. Read **CLAUDE.md** §8, §8A, §8B, §8C — same baseline as every brief in this batch.
2. Read **feasibility doc §115 in full**. It documents two real reversals that happened during design (the "silently match after PR23" idea was proposed then abandoned; the rate-conversion mechanism changed once the ordering flipped back) — read §115.3 and §115.6 carefully so you don't rebuild an already-abandoned approach.
3. Read the three files you're modifying **in full** before touching them — they are small enough:
   - `supabase/functions/api/_core/procurement/opening_stock.handlers.ts` (IN05/IN06 backend)
   - `supabase/functions/api/_core/production/opening_genealogy.handlers.ts` (PR22/PR23 backend)
   - `frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx` (IN05 frontend)
   - `frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockApprovalPage.jsx` (IN06 frontend)
   - `frontend/src/pages/dashboard/production/OldProcessPoPage.jsx` (PR22 frontend)
   - `frontend/src/pages/dashboard/production/OldPackingPoPage.jsx` (PR23 frontend)
4. You have Supabase MCP access to Dev (`ytapuwiqicmvpanmzelb`). Re-verify every table/column referenced in this brief live before using it — this brief was written against a live read of all six files above plus `information_schema.columns`, but re-verify anyway per standing discipline.
5. **Do NOT touch ACL/menu registration in the DB.** Claude does that via MCP separately. You only add `route-acl-registry.ts` entries for the one genuinely new route (§Change 4).
6. Migration naming/reconciliation: apply, reconcile `supabase_migrations.schema_migrations.version` to the local filename timestamp, run `node scripts/migration-integrity-check.mjs`, confirm `in_sync = true`. Dev only.
7. **This is a placeholder-fill, not a rewrite.** `isBlockedPlaceholder` in `OpeningStockDetailPage.jsx` currently renders `"Will open after implementation"` for MTO/HPS SFG/FG documents — nobody has ever used this path in Dev, so there is no legacy data risk. But the generic RM/PM/INT/MTS-SFG/FG path (everything `!isBlockedPlaceholder`) is real, working, and must not regress.

---

## Ground truth for reuse

- `assertProdReadRole(ctx)` in `production.shared.ts` is a no-op today — real authorization is `route-acl-registry.ts` gating. Don't add a role check inside the handler that isn't already there for PR22/PR23's siblings.
- `assertManagerOrSARole(ctx)` in `opening_stock.handlers.ts` — this IS a real check (SA/GA/DIRECTOR/L4_MANAGER/L3_MANAGER/L2_MANAGER), already applied to every IN05/IN06 handler. Keep using it for anything you add there.
- `assertCompanyScope(ctx, companyId)` (`_shared/companyScope.ts`) — already used in `opening_genealogy.handlers.ts`. `assertOpeningStockCompanyScope` (local to `opening_stock.handlers.ts`) is the equivalent there — same pattern, different helper name, don't conflate or duplicate.
- `generateGlobalDocNumber("PROC_PO" | "PACK_PO")` (`production.utils.ts`) — already used by PR22/PR23, unchanged.
- `UomQuantityInput.jsx` — reusable qty+UoM picker, but it is **single-hop and `material_uom_conversion`-driven only**. It does NOT work for the MTO/HPS barrel/IBC case in this brief (that conversion factor lives on a specific PR23 row's `fill_qty_per_pack`, not on `material_uom_conversion`) — build a small dedicated read-only display for that case (§Change 6), don't force-fit `UomQuantityInput`. It DOES work as-is for §Change 8 (MTS/MTEST rate, which genuinely is `material_uom_conversion`-driven).
- `listOldProcessPoBatchesHandler` (existing, `GET /api/production/old-process-po/batches?company_id=`) — the exact pattern to mirror for the new PR23-list endpoint (§Change 4): query the `_reco` table filtered by `source_txn_type='OPENING'` for distinct parent ids, then fetch+label the parent rows.

---

## Change 1 — Migration: `packing_order_id` column on `opening_stock_line`

```sql
ALTER TABLE erp_procurement.opening_stock_line
  ADD COLUMN packing_order_id uuid REFERENCES erp_production.packing_order(id);
```

Nullable. Only ever set on FG lines (never RM/PM/INT/SFG). No backfill needed — no FG opening line has ever been created via this path (§115.1).

## Change 2 — Reverse the PR22/PR23 dependency direction (`opening_genealogy.handlers.ts`)

**Remove**, don't repurpose, from `createOldProcessPoHandler`:
- The `openingBatchExists(companyId, batchNumber)` call + its `PROD_OLD_OPENING_BATCH_NOT_FOUND` error.
- The `sumOpeningQty(...)` reconciliation block + its `PROD_OLD_OPENING_QTY_MISMATCH` error.

**Remove**, don't repurpose, from `createOldPackingPoHandler`:
- The `openingBatchExists(companyId, batchNumber)` call + its error.
- The `sumOpeningQty`/`sumAllocatedPackingQty`/`remainingFgQty` reconciliation block + its error.

Leave everything else in both handlers unchanged (duplicate-batch guard, MTO/HPS-only `po_type` check, company scope, line inserts, reco inserts — all still correct and still needed). You can delete the now-unused `sumOpeningQty`/`sumAllocatedPackingQty`/`openingBatchExists`/`QTY_TOL` helpers only if nothing else in the file references them after this change — check first, `QTY_TOL` in particular might still be worth keeping as a shared constant if Change 3 needs the same tolerance (it does — see below).

**Frontend copy fix** (both `OldProcessPoPage.jsx` and `OldPackingPoPage.jsx`):
- File-header comment `"Sequence: Opening Stock (IN05) first → then this page"` → reverse to `"Sequence: this page first → then Opening Stock (IN05)"`.
- `OldProcessPoPage.jsx`'s `<p>` hint under Batch Number (`"Must exactly match the Opening Stock batch — it is the only join."`) → reverse to something like `"This batch number is what Opening Stock (IN05) will reference — pick something clear and unique."`
- `OldProcessPoPage.jsx`'s hint under Actual Output Qty (`"Must reconcile with the opening SFG qty for this batch."`) → remove or reword — reconciliation now happens at IN05 Submit time (§Change 3), not here.
- Same two hints in `OldPackingPoPage.jsx` under Actual Qty (KG).

## Change 3 — New reconciliation guard at IN05 Submit (`opening_stock.handlers.ts`)

In `submitOpeningStockDocumentHandler`, after the existing "at least one line" check and before flipping status to `SUBMITTED`, add a hard-block reconciliation **only when `document.material_type` is `SFG` or `FG`** (RM/PM/INT/MTS/MTEST documents are unaffected — skip this block for them):

- **SFG**: group this document's lines by `batch_number`. For each distinct batch, sum `quantity` across every line sharing it, fetch that batch's `process_order.actual_qty` (the PR22 row — `company_id` + `batch_number` + `po_type` match, `process_order_line_reco.source_txn_type='OPENING'` tag), and hard-block (409, new code `OPENING_STOCK_BATCH_QTY_MISMATCH`) if the sums differ by more than `0.01` (reuse the same tolerance PR22/PR23 used, `QTY_TOL` from `opening_genealogy.handlers.ts` — either import it or redeclare the same literal locally, your call).
- **FG**: group by `packing_order_id` instead of `batch_number`, compare against `packing_order.actual_qty_kg`, same tolerance, same error code.

This is the reconciliation §104.9.1 used to do on the PR22/PR23 side — it now lives here because the dependency direction reversed (§115.10). Don't skip it; it's the only thing standing between a half-loaded batch and a silent stock-vs-genealogy mismatch.

## Change 4 — New endpoint: list PR23 (Old Packing PO) batches for a material

Mirror `listOldProcessPoBatchesHandler` exactly (same file, `opening_genealogy.handlers.ts`):

```
GET /api/production/old-packing-po/batches?company_id=&material_id=
```

- Query `packing_order_line_reco` for `company_id` + `source_txn_type='OPENING'`, distinct `packing_order_id`.
- Fetch those `packing_order` rows: `id, po_number, po_type, batch_number, material_id, actual_qty_kg, fill_qty_per_pack, num_packs, process_order_id`.
- If `material_id` query param given, filter to that SKU only (this is the FG SKU the IN05 line is being entered for).
- Label via the same `fetchMaterialLabels` helper already in the file (reuse, don't duplicate).
- Route registration: `production.routes.ts` (`case "GET:/api/production/old-packing-po/batches":`), placed next to the existing PR22/PR23 cases.
- `route-acl-registry.ts`: `{ skipAcl: false, resourceCode: "PROD_OLD_PACKING_PO", action: "VIEW" }` — same resource+action the sibling PR22-batches-list route already uses (`GET:/api/production/old-process-po/batches` is gated under `PROD_OLD_PACKING_PO`, not a typo — mirror it exactly, don't gate this new one under `PROD_OLD_PROCESS_PO` even though it feels like it should be the other way round).
- `frontend/src/pages/dashboard/production/prodApi.js`: add `export const listOldPackingPoBatches = (p) => fetchProd("GET", "/api/production/old-packing-po/batches", undefined, p);` next to `listOldProcessPoBatches`.

No other new backend endpoints are needed — every "remaining qty" computation in §Change 5/6 is done client-side from `detail.lines` (already loaded by `getOpeningStockDocument`), per §115.9.

## Change 5 — `opening_stock.handlers.ts`: validate the new SFG/FG fields server-side

In `addOpeningStockLineHandler`, `updateOpeningStockLineHandler`, and `batchUpdateOpeningStockLinesHandler`:

- **SFG line**: `batch_number` (already a field) must resolve to an existing `process_order` row matching `company_id` + `po_type` (document's own `po_type`) + tagged `source_txn_type='OPENING'` in `process_order_line_reco`. Reject (422, `OPENING_STOCK_SFG_BATCH_NOT_FOUND`) if not found. (This is the mirror-image of the guard you just removed from PR22 in §Change 2 — same shape, opposite direction.)
- **FG line**: accept new body field `packing_order_id`. Must resolve to an existing `packing_order` row matching the same company/po_type/OPENING-tag pattern, status `FINAL`. Reject (422, `OPENING_STOCK_FG_PACKING_PO_NOT_FOUND`) if not found. **`batch_number` for an FG line is now derived server-side from the resolved `packing_order.batch_number`** — ignore any `batch_number` the client sends for an FG line, always overwrite with the resolved value (prevents a client-side mismatch bug where `packing_order_id` and `batch_number` disagree).
- Add `packing_order_id` to every `select("*")`/insert/update touching `opening_stock_line` where you already see `batch_number` handled (they're always in the same place in this file — search for `normalizedBatchNumber`/`batch_number` and add the sibling logic right next to each occurrence, don't create a separate pass).
- This validation only applies when `document.material_type` is `SFG` (batch check) or `FG` (packing_order check) **and `document.po_type` is `MTO` or `HPS`** — MTS/MTEST SFG/FG documents skip both (§115.7, they have no PR22/PR23 concept).

## Change 6 — Frontend: IN05 (`OpeningStockDetailPage.jsx`) — replace the MTO/HPS placeholder

Delete the `isBlockedPlaceholder` branch entirely (the `"Will open after implementation"` card) and its guarding variable — this material_type+po_type combination now gets a real entry form. You'll need **two new field groups**, conditionally rendered based on `documentMaterialType`, layered on top of the existing generic single/bulk entry drawer (reuse `DrawerBase`, `ErpDenseFormRow`, `ErpComboboxField` — same components, same drawer, don't build a second drawer):

**SFG lines (`documentMaterialType === "SFG" && documentPoType in (MTO, HPS)`):**
1. Material dropdown — already exists (filtered to `document.material_type`), unchanged.
2. **New: Batch Number becomes a dropdown**, not free text — sourced from `listOldProcessPoBatches({ company_id: companyId })` (existing endpoint), client-filtered to `material_id === singleForm.material_id` (or `row.material_id` for bulk) and `po_type === documentPoType`. Show `${batch_number} · Stroke ${stroke_number ?? '--'} · ${actual_qty} KG` per option (stroke_number isn't in the current `listOldProcessPoBatchesHandler` response — add it: join `stroke_master.stroke_number` via `process_order.stroke_master_id` in that handler, same file, small addition).
3. On batch selection, compute and display **Remaining Qty** = `selectedBatch.actual_qty - Σ(detail.lines where batch_number === selectedBatch.batch_number, excluding the line being edited).quantity`. Prefill the Quantity field with this value (still editable/overwritable — user may want to split it across multiple Stock Type rows, per §115.5).
4. Quantity — plain numeric input in KG (no `UomQuantityInput`, SFG has no alternate unit).
5. Storage Location, Stock Type — unchanged, already generic.
6. Rate Per Unit — unchanged, plain per-KG input (§115.5, no conversion needed for SFG).

**FG lines (`documentMaterialType === "FG" && documentPoType in (MTO, HPS)`):**
1. Material dropdown (FG SKU) — already exists, unchanged.
2. **New: "Packing PO" dropdown** — sourced from the new `listOldPackingPoBatches({ company_id: companyId, material_id: <selected SKU> })` (§Change 4). Show `${batch_number} · ${po_number} · ${num_packs ?? '--'} packs · ${actual_qty_kg} KG` per option.
3. On selection, auto-display (read-only): Batch Number, Number of Packs, KG/Pack (all straight from the selected row — no computation).
4. Compute and display **Remaining Qty (KG)** the same way as SFG but keyed on `packing_order_id` instead of `batch_number` — prefill Quantity.
5. **New: "Rate Per Pack" input** replacing the plain "Rate Per Unit" for this branch only. Label switches to "Rate Per KG" when the selected Packing PO's `fill_qty_per_pack` is null/0 (Tanker case, §115.6). On change, compute `rate_per_unit = fill_qty_per_pack ? ratePerPack / fill_qty_per_pack : ratePerPack` and that's what actually gets sent as `rate_per_unit` in the API call — keep the entered "Rate Per Pack" value in local form state too so the field doesn't silently convert itself while the user is still typing.
6. Storage Location, Stock Type — unchanged.
7. Send `packing_order_id` (not `batch_number` — server derives that, §Change 5) in the `addOpeningStockLine`/`updateOpeningStockLine`/bulk payloads.

Apply the identical field logic to **both** the Single Entry form and the Bulk Entry table rows (the page has two parallel UIs for the same fields today — don't build SFG/FG support into only one of them).

## Change 7 — Frontend: IN06 (`OpeningStockApprovalPage.jsx`) — mirror Change 6

`OpeningStockApprovalPage.jsx`'s editable-line table (SUBMITTED-stage correction, `batchUpdateOpeningStockLines`) has the same field set as IN05's generic form (see `mapLineForEditing`/`createNewEditableLine`) and the same `BATCH_NUMBER_HELP_TEXT` free-text batch input. Apply the exact same SFG/FG conditional field changes here — Batch Number → dropdown (SFG), Packing PO dropdown + derived fields + Rate Per Pack (FG). Don't let this page fall out of sync with IN05; it's reachable independently (IN06 is its own route) and must support the same corrections IN05 does at DRAFT stage.

## Change 8 — Frontend: MTS/MTEST Rate — small, separate, not gated on anything in Changes 1-7

For SFG/FG documents where `documentPoType === "MTS"` or `"MTEST"` (the existing generic, non-placeholder branch — do not touch its Batch Number/Quantity fields, those already work), add a `UomQuantityInput`-style unit picker **next to the Rate Per Unit field specifically**, driven by that material's own `material_uom_conversion` rows (already fetched via `listMaterialUomConversionsForProcurement`, already in scope in this component for the Quantity field — reuse the same query result, don't add a new one). When a non-`variable_conversion` alternate unit exists, let the user type the rate in that unit and convert to per-KG the same way Change 6 converts Rate Per Pack (divide by the conversion factor). When no alternate unit exists, behave exactly as today (plain per-KG rate, no picker shown). This is genuinely independent of Changes 1-7 (different material type combination, different conversion source per §115.7) — implement it as a small reusable inline piece, not entangled with the MTO/HPS-specific code from Change 6.

---

## Hard rules

1. Company scope validated on every touched/new handler (checklist item #2) — `assertOpeningStockCompanyScope`/`assertCompanyScope` already exist, use them, don't skip on the new endpoint.
2. `packing_order_id`/`batch_number` server-side validation (§Change 5) is not optional — the frontend dropdowns make a bad value unlikely, but the backend must not trust that (checklist item — DB constraint gaps only surface with real data; this document type has never had real data yet, don't be the first gap in it).
3. Don't remove or weaken any RM/PM/INT/MTS/MTEST behavior in either page — every change in this brief is additive/conditional on `material_type` + `po_type`, never a change to the shared generic path.
4. Reconciliation tolerance (§Change 3) must match PR22/PR23's original `0.01` KG — don't invent a different number.
5. Migration integrity discipline (CLAUDE.md §8A) — this is the one schema change in this brief, don't skip the reconciliation step.

## Explicitly out of scope

- Any change to Process PO / Packing PO's own **live** (non-opening) Standard→Final→Verify flow — this brief only touches the `OPENING`-tagged synthetic genealogy path and IN05/IN06.
- MTS/IWC's own batch-blind reservation/dispatch design (§108) — unrelated, not touched here.
- The Opening Rate "Recalculate" mechanism (§109) — already built, not in scope, don't modify `recalculateValuationHandler` or its frontend section.
- ACL/menu registration in the DB — Claude's job via MCP. You only touch `route-acl-registry.ts` for the one new route in §Change 4.
- Building a "reopen"/unlock mechanism for a wrongly-entered SFG/FG line after Submit — out of scope, same as every other opening-stock correction path today (IN06 exists for that).

## Verification

1. In Dev, using the 4-step ACL sequence Claude will already have run for these existing pages (no new pages here, only new fields — should already be visible to whichever role could reach IN05/PR22/PR23 before), walk through the full chain for a fresh test batch:
   - Create a Stroke Master (APPROVED) for a test Prodshade if one doesn't already exist for the po_type you're testing.
   - Create PR22 with a new batch number, confirm it saves with **no** `openingBatchExists` error (that guard is gone).
   - Create an IN05 SFG opening document (po_type matching), open the entry drawer, confirm the new batch dropdown shows your PR22 batch, confirm Remaining Qty prefills correctly, post a partial qty as Unrestricted and the rest as QUALITY_INSPECTION (two lines, same batch, different stock_type).
   - Confirm the batch total mismatch guard (§Change 3) blocks Submit if you deliberately post less than PR22's total, then fix it and confirm Submit succeeds once it reconciles.
   - Create a Pack BOM + PR23 against that same PR22 batch, confirm it saves with **no** `openingBatchExists` error.
   - Create an IN05 FG opening document, confirm the new Packing PO dropdown shows your PR23 row, confirm Batch Number/Num Packs/KG-per-Pack auto-display, enter a Rate Per Pack and confirm the posted `rate_per_unit` (check via `getOpeningStockDocument` response or direct DB read) equals `ratePerPack / fill_qty_per_pack`.
   - Approve + Post the FG document, confirm `stock_ledger`/`stock_snapshot` land at the expected per-KG rate.
2. Repeat the IN06 (`OpeningStockApprovalPage.jsx`) correction flow against a SUBMITTED SFG or FG document, confirm the same dropdown/derived-field behavior works there too.
3. Confirm an existing/new RM, PM, INT, or MTS/MTEST SFG/FG opening document still works exactly as before (no field changes, no new required inputs) — regression check for §Hard rule 3.
4. `deno check` clean against the documented baseline for every touched backend file. `eslint` clean for every touched frontend file. `node scripts/migration-integrity-check.mjs` → `in_sync = true`.

## Log + commit

- Append entries to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md` (Gate-27.28).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
