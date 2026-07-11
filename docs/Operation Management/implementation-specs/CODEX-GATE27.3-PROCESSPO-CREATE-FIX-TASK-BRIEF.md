# CODEX-GATE27.3-PROCESSPO-CREATE-FIX-TASK-BRIEF

**Gate:** 27.3
**Domain:** PRODUCTION
**Title:** Fix the guaranteed 400 on Process PO Create (PR09) — field-name mismatch + missing segment_code
**Scope:** Frontend only, **one file**, **Process PO tab only**
**Dependency:** none (standalone Phase-0 hotfix)
**Reference doc:** feasibility §83.4 (Process PO Types, Storage Location Integration); `CLAUDE.md` §8A Rule 1; `PACE_ERP_MASTER_CONSTITUTION.md` §9 (File Header), Part 1B Rule 1

---

## Why this brief exists (root cause — already diagnosed, do NOT re-investigate)

`frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx` submits the Process PO create form and **always gets a 400** from `POST /api/production/process-orders`. Two independent causes, both confirmed against the live backend handler `createProcessOrderHandler` (`supabase/functions/api/_core/production/process_order.handlers.ts`, lines ~333-345):

1. **Field-name mismatch:** the form sends `prod_type`, but the backend reads `body.po_type`. So `poType` is empty → `VALID_PO_TYPES.has(poType)` fails.
2. **Missing `segment_code`:** the form never sends `segment_code`, but the backend hard-requires it (`VALID_SEGMENTS.has(segmentCode)`, set = `ADMIX / HPS / IWC / POWDER / INT`).

Either one alone returns `PROD_PO_INVALID` (400). The backend **already accepts** `prodshade_material_id` (aliased to `material_id`), `planned_qty_kg` (aliased to `planned_qty`), and `stroke_master_id` — those are NOT the problem, leave them as they are sent.

**No backend change is needed.** This is a pure frontend fix.

### Why segment is a manual dropdown (not auto-derived)
Live dev check: `production_mode` is NULL on all 102 materials and `production_segment_location_config` is empty, so segment cannot be derived from the prodshade material yet. For this interim fix the operator picks the segment from a dropdown. (Full combobox/selection-screen rebuild of this page is a later phase — do NOT attempt it here.)

---

## The fix (Process PO tab only)

Edit **only** `frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx`.

1. **Add `segment_code: ""` to `EMPTY_PROCESS`** (the Process form initial state).

2. **Add a Segment dropdown** to the Process PO form, placed right after the "Production Type" field. Required field (red `*`). Options exactly: `ADMIX`, `HPS`, `IWC`, `POWDER`, `INT`. Wire it with the existing `updateProcess("segment_code", …)` pattern. Match the existing `<select>` styling used by the Production Type field.

3. **In `handleCreateProcess`:**
   - Add a validation guard: if `!processForm.segment_code`, `toast("Segment is required.", "error")` and return (same pattern as the existing company/prodshade/qty guard).
   - In the request `body`, **send `po_type` (not `prod_type`) and `segment_code`**:
     ```js
     const body = {
       company_id: processForm.company_id,
       po_type: processForm.prod_type,          // renamed key — backend reads po_type
       segment_code: processForm.segment_code,  // new — backend hard-requires it
       prodshade_material_id: processForm.prodshade_material_id,
       planned_qty_kg: parseFloat(processForm.planned_qty_kg),
       planned_start_date: processForm.planned_start_date || undefined,
       notes: processForm.notes || undefined,
     };
     if (processForm.prod_type !== "MTEST") {
       body.stroke_master_id = processForm.stroke_master_id;
     }
     ```
   - Keep everything else in the handler (toast on success reading `result.po_number`, `setProcessForm({ ...EMPTY_PROCESS })`, `qc.invalidateQueries`) unchanged.

4. **Complete the file header** to the full mandatory format (Constitution §9 / FILE_HEADER_STANDARD.md). The current header is missing `Phase` and `Authority`. Make it:
   ```
   /*
    * File-ID: 27.FE-PR09
    * File-Path: frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx
    * Gate: 27
    * Phase: 27
    * Domain: FRONT
    * Purpose: Create new Process PO or Packing PO (Standard Create — both PO types).
    * Authority: Frontend
    */
   ```

---

## Hard rules

1. **Process PO tab ONLY.** Do **not** touch the Packing PO tab, `handleCreatePacking`, `EMPTY_PACKING`, or any Packing markup — it needs a separate full rebuild and is explicitly out of scope here.
2. **No backend change.** Do not edit `process_order.handlers.ts` or any `.ts` file. Frontend only.
3. **Keep the existing raw-UUID text inputs as-is** (company_id, prodshade_material_id, stroke_master_id). This is a minimal 400-unblock, NOT the combobox rebuild — do not convert inputs to comboboxes.
4. **Do not add auto-defaulting logic** for segment (e.g. deriving it from prod_type). Plain required dropdown, default empty.
5. Do not change any other file. Do not touch routes, ACL, migrations, or `prodApi.js`.

---

## Out of scope (do NOT do these here)

- Packing PO tab fix (separate item — the whole form must be rebuilt to match locked §83.4 PR09 Packing mode: SFG line, PM lines, fill qty/pack, num packs, machine).
- Converting inputs to comboboxes / ErpSelectionScreen (Phase-4 PR09 rebuild).
- Seeding `production_segment_location_config` or populating `production_mode` (those are MCP business-data jobs Claude will do separately).
- The QA Queue field-mismatch fix (separate brief).

---

## Verification (Codex: do this before writing the log entry)

1. Confirm the Process form now has a Segment dropdown and that `handleCreateProcess`'s `body` sends `po_type` + `segment_code` (grep the file for `po_type` and `segment_code`).
2. Confirm the Packing tab is byte-unchanged from before your edit (diff should show changes only in `EMPTY_PROCESS`, the Process form JSX, `handleCreateProcess`, and the header).
3. `npm run lint` (or the repo's eslint) on the one file if runnable; otherwise a syntax read-through. No new imports needed.

## Log + commit

- Append one entry to `docs/Codex-Log.md` using its existing template format (dated today): summarize the field-name fix (`prod_type`→`po_type`), the new Segment dropdown + `segment_code` send, and the header completion; file touched = `frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx`.
- **Do NOT run any git commands** — just edit the file and append the log entry. Claude will review, then stage/commit.
