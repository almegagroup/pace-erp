# CODEX-GATE27.18-PR09-STANDARD-CREATE-REBUILD-TASK-BRIEF

**Gate:** 27.18
**Domain:** PRODUCTION
**Title:** Fix two live ACL/auth bugs + rebuild PR09 Process PO Standard Create to the locked 3-page flow
**Scope:** 2 backend fixes (no schema change) + 1 frontend page rewrite (Process PO tab only)
**Dependency:** None — Process PO backend (Gate-27.6/27.14) is already correct and unaffected by this brief
**Reference doc:** feasibility Section 83.4, new subsection **"PR09 — Standard Create: Page-by-Page UI Spec"** (added 2026-07-11/12, includes the "Order-family selector" note) — read that subsection in full before starting, it is the single source of truth for this brief

---

## Why this brief exists

Live click-through testing (business owner, against the deployed dev environment) found PR09's Process PO tab does not match the locked design at all — flat single form, no gated navigation, an unrequested "Segment" field always shown, and two dropdowns (Prodshade, Machine) permanently empty due to live 403 errors. Root cause: the exact PR09 page-by-page flow was confirmed in chat and mockup-approved but never written into the feasibility doc until now — a genuine doc-first-workflow miss, not a Codex implementation error. The underlying mechanism-level design (Reservation, stock-check severity, Alternate Material substitution) WAS already correctly built — this brief does not touch that backend logic, only the two auth bugs and the frontend page shape.

**Explicit instruction from the business owner: implement the full locked 3-page design as written below. Do not substitute a "simpler equivalent" single-page structure — that shortcut was proposed and explicitly rejected.**

---

## Change 1 — Fix `GET /api/production/prodshades` ACL mis-mapping

**File:** `supabase/functions/api/_acl/route-acl-registry.ts`

Current entry:
```
"GET:/api/production/prodshades": { skipAcl: false, resourceCode: "SA_OM_PACK_CODE_MASTER", action: "VIEW" },
```

`SA_OM_PACK_CODE_MASTER` is the SA-only Pack Code Master admin resource (§OM08) — completely unrelated to listing prodshades for Process PO creation. This is why any non-SA Production role (DIRECTOR, L-Manager, etc.) gets 403 on this dropdown.

**Fix:** find the correct existing resource code for Process PO Standard create (the same one guarding `POST /api/production/process-orders` — look up its `resourceCode` in this same registry, likely something in the `PROD_PO_*` family) and use that instead. Do not invent a new resource code — reuse whatever the create endpoint already uses, since listing prodshades is a read prerequisite for the same action.

---

## Change 2 — Fix `GET /api/om/machines` 403 for non-SA/ADMIN roles

**File:** `supabase/functions/api/_core/om/machine.handlers.ts`

`listMachinesHandler` calls `assertOmAdminContext(ctx)` (requires `roleCode === "SA" || "ADMIN"`), which is a hardcoded gate *inside the handler*, separate from and not overridden by the route registry's `skipAcl: true` for this route. Any Production role hits 403 trying to populate the Machine dropdown.

**Fix:** Machine master creation/edit/deactivate must stay SA-only (§83.9 — "Master managed by: SA only") — do **not** change `createMachineHandler`, `updateMachineHandler`, or `toggleMachineHandler`. Only `listMachinesHandler` needs broader read access. Replace its `assertOmAdminContext(ctx)` call with whatever this codebase's standard "any authenticated user with a valid company/session context" check is (look at how sibling read-only production endpoints like the prodshades list or storage-location list handlers authorize reads, and match that pattern — do not invent a new assert function if an equivalent already exists).

---

## Change 3 — Rebuild `ProductionPOCreatePage.jsx`'s Process PO tab (Packing PO tab untouched)

**File:** `frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx`

The existing Process PO / Packing PO tab toggle at the top of the page is correct and must be kept exactly as-is — the order-family selector doc note confirms this pattern is right. **Do not touch the Packing PO tab or its handler/state at all** — it is intentionally still ID-based, a separate future brief.

Inside the **Process PO** tab, replace the current flat single-form layout with the locked 3-page flow:

### Page 1 — Company / PO Type / Material
- Company (existing `useCompaniesForOmQuery` combobox — keep)
- PO Type (existing static list MTO/HPS/MTS/MTEST/INT — keep)
- Material — dropdown filtered by PO Type: approved SFG/INT for MTO/HPS/MTS/INT; SFG/INT/SKU for MTEST (the existing `listApprovedProdshades` call and its filtering logic should already mostly do this once Change 1 unblocks it — verify the MTEST case actually includes SKU options, extend the query/filter if it currently doesn't)
- A "Next" action that advances to Page 2. No save yet.

### Page 2 — Stroke gate
- MTO/HPS/MTS: list of APPROVED strokes for the selected Company + Material (existing `listStrokeMasters` query already does this). Selection is **mandatory** — even a single result must be explicitly clicked, no auto-select. "Next" stays disabled/blocked until a stroke is chosen.
- MTEST: show the stroke list only if one exists for that material; selection is optional, a "Skip" path must exist.
- MTEST-with-SKU-material path: no stroke concept at all, skip straight to Page 3.
- A "Back" action returns to Page 1 without losing Company/PO Type/Material selections.

### Page 3 — Header + Material Table
Header fields, all carried over from Page 1/2 and read-only except where marked:
- PO Number: blank placeholder, generated on save
- Company, PO Type — read-only
- **Prodshade** — read-only, displays the selected material's `material_master.material_name`
- **Description** — read-only, displays the selected material's `material_master.document_name`
- Stroke Number — read-only, from Page 2
- **Machine** — dropdown (existing `listMachines` query, unblocked by Change 2), **mandatory for MTO/HPS/MTS/INT**, hidden/disabled for MTEST (the existing `machineRequired` boolean logic is already correct — keep it)
- **Batch Size** — the existing Planned Qty (KG) input, keep as-is
- Batch Number — read-only "—" placeholder (not generated until Start Batch, out of scope here)
- Status badge — "STANDARD"
- Output reference block — Material Code / Name / Description / External Code / Storage Location / Movement Type = P101 (read-only reference info)
- **No Notes field** — remove the existing textarea entirely, it was explicitly dropped
- **No FO Number field** — confirm none exists, do not add one
- **No manually-typed Segment dropdown** — remove the current always-visible `PROCESS_SEGMENTS` combobox. Instead auto-derive `segment_code` from `po_type` with no UI: `MTO → "ADMIX"`, `HPS → "HPS"`, `INT → "INT"`. For `MTS` only, since IWC vs POWDER is genuinely ambiguous from PO Type alone, keep a visible required dropdown scoped to just `["IWC", "POWDER"]` (not the full 5-value list). Send the resolved `segment_code` in the create payload exactly as today.

**Material Table** — rebuild the existing "RM Location Preview" table (keep its underlying data: `strokePreviewRows`, `availabilityPreviewProcessOrder` query, `lineLocationOverrides` state — all of that machinery is correct and already wired, this is a column/behavior addition, not a data-layer rewrite) to have exactly these 9 columns:

| # | Column | Behavior |
|---|---|---|
| 1 | # | row number |
| 2 | Material Type | read-only, RM or INT (`line_material_type` from the stroke line data) |
| 3 | Formulation Material | read-only (already exists) |
| 4 | Dosage % | read-only (already exists) |
| 5 | **Actual Material** | **editable dropdown, must work at Standard phase** — registered-alternate-only (same alternate/Material-Group mechanism already used elsewhere in this codebase, e.g. Stroke Master's own alternate picker — reuse that component/pattern, do not invent a new one), default blank meaning "(same)" as formulation. **This column does not currently exist on the live table and must be added — explicit requirement, substitution is allowed starting at Standard, not just Final/Verify.** |
| 6 | Storage Location | editable (already exists) |
| 7 | Standard Qty | read-only (currently labeled "Planned Qty" — rename to "Standard Qty" for consistency with Final/Verify's own column naming) |
| 8 | **Movement Type** | read-only, always "261" — currently missing, add it |
| 9 | Available | already exists (red row if short) |

**Hard save block (currently missing — cosmetic-only today):** if any row's Available < Standard Qty, disable the Create/Save button (not just color the row) and show a blocking message explaining which line(s) are short. This matches the already-locked stock-check severity rule (§83.5 — Standard is a hard block, not a warning). The backend already enforces this at 422 on submit; this change just surfaces the block before the user tries to submit, consistent with the rest of the locked UI spec.

Save behavior on success: unchanged from today (PO Number generates, form resets, query invalidation) — no change needed there.

---

## Hard rules

1. Backend: only the two named auth checks change. No new resource codes invented for Change 1. No change to machine create/update/toggle authorization for Change 2.
2. Frontend: Packing PO tab is completely out of scope — zero changes to it.
3. Do not touch `process_order.handlers.ts`, migrations, or any Reservation/availability-preview backend logic — all of that is already correct per Gate-27.6/27.14 and this brief is frontend-plus-two-small-backend-auth-fixes only.
4. No raw UUIDs anywhere in the rebuilt page (R-01) — all dropdowns must show resolved labels, which the existing code already does correctly; preserve that.
5. Data fetching stays on `useQuery` — do not introduce `useEffect` + manual fetch anywhere new.
6. Do not add fields, pages, or behavior beyond what is listed above. If something feels missing that isn't in this brief or the referenced doc subsection, stop and flag it rather than guessing.

## Out of scope

- Packing PO's own create flow (separate future brief)
- PR10/PR11/PR12/PR15/PR16/PR17/PR18 (already audited separately — do not touch)
- Start Batch, batch number generation, QA queue behavior
- Any schema/migration change

## Verification

1. Confirm prodshades and machines dropdowns populate for a non-SA test role (e.g. DIRECTOR) — no 403.
2. Confirm Page 1 → Page 2 → Page 3 navigation works, and Page 2's stroke selection is a genuine gate (Next disabled until a stroke is clicked) for MTO/HPS/MTS.
3. Confirm Segment never appears as a manual field for MTO/HPS/INT, and appears (scoped to IWC/POWDER only) for MTS.
4. Confirm Notes field is gone.
5. Confirm the Material Table has all 9 columns, and Actual Material is editable and saves correctly at Standard (not just Final/Verify).
6. Confirm Create is blocked (not just visually warned) when any line is short on Available.
7. Confirm the Packing PO tab is byte-for-byte unchanged.

## Log + commit

- Append one entry to `docs/Codex-Log.md`
- Do not run git commands
