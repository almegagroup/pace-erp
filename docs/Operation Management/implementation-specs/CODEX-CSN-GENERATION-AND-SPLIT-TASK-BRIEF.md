# Codex Task Brief — CSN Generation Rules + Partial-Dispatch Split/Knock-Off

Locked design decisions from a design session with the business owner (P0004). Nine parts below — implement all, in order, since later parts depend on fields/tables introduced in earlier ones (e.g. Part 9's history log references fields added in Parts 6–8).

**Status: design session complete. This brief is final — ready for implementation.**

---

## Part 1 — CSN generation rules by delivery type

**File:** `supabase/functions/api/_core/procurement/po.handlers.ts`

**Current behavior (wrong):**
```ts
function deriveCsnType(po: PurchaseOrderRow): string {
  const deliveryType = toUpperTrimmedString(po.delivery_type);
  const vendorType = toUpperTrimmedString(po.vendor_type);

  if (deliveryType === "BULK" || deliveryType === "TANKER") {
    return "BULK";
  }

  return vendorType === "IMPORT" ? "IMPORT" : "DOMESTIC";
}
```
`createCsnsForPo` (same file) creates a CSN unconditionally for every PO line, regardless of `delivery_type`.

**Locked rule:**
- `delivery_type === "STANDARD"` or `"TANKER"` → a CSN **is** created (TANKER follows the normal IMPORT/DOMESTIC classification by vendor_type, same as STANDARD — it should NOT be lumped into "BULK").
- `delivery_type === "BULK"` → **no CSN is created at all.** Bulk deliveries don't need shipment tracking.
- Design constraint from the business owner: implement the BULK skip as a simple, isolated conditional (not a structural change), so that re-enabling CSN tracking for BULK in the future is a one-line change, not a rewrite.

**Fix:**
```ts
function deriveCsnType(po: PurchaseOrderRow): string {
  const vendorType = toUpperTrimmedString(po.vendor_type);
  return vendorType === "IMPORT" ? "IMPORT" : "DOMESTIC";
}
```
And in `createCsnsForPo`, skip the entire per-line loop body (or return early) when `toUpperTrimmedString(po.delivery_type) === "BULK"`. Keep the skip as a single guarded `if` at the top of the function — do not restructure the rest of the function.

Apply the equivalent check anywhere else a CSN is auto-created from a PO (search for other callers of `createCsnsForPo` / any duplicated CSN-creation logic) to keep the rule consistent everywhere.

---

## Part 2 — Partial-dispatch qty split, reconciliation, and knock-off

**Context:** One CSN is created per PO line at PO confirm/approve time, with `po_qty` = the full ordered quantity. The CSN Tracker page lets procurement edit `dispatch_qty` inline (`CSNTrackerPage.jsx` → `saveInlineEdit()` → `inlineUpdateCSN()` → backend `inlineUpdateCSNHandler` in `csn.handlers.ts`). Today this is a plain field edit with no concept of a leftover balance. The business needs balance tracking: if the dispatched quantity entered is less than the line's total ordered quantity, the remaining balance must either become its own CSN or be explicitly knocked off — never silently lost.

**No new relational column.** Sibling CSNs for the same order are found purely by `po_line_id` — there is no parent/child FK. The invariant to maintain at all times: for a given `po_line_id`, the sum of `po_qty` across all of that line's non-knocked-off CSNs must equal the PO line's `ordered_qty` minus any knocked-off quantity.

### Locked flow

When dispatch qty is edited and saved on a CSN:

1. Compute `balance = (sum of po_qty across ALL CSNs currently on this po_line_id, with this CSN's po_qty replaced by the new edited value) − ordered_qty`... more precisely: after applying the edit, recompute how much of the line's `ordered_qty` is still unaccounted for by any CSN. If that remainder is 0, just save — no prompt.
2. If remainder > 0:
   - **No sibling CSNs exist yet for this line** (this CSN is the only one) → show a simple two-button prompt: **"Create CSN for balance"** or **"Knock Off"**.
     - Create CSN → insert a new CSN for this po_line with `po_qty = remainder`, `dispatch_qty = remainder` (default — dispatch_qty always defaults to po_qty on creation per the existing rule), `status = "ORDERED"`, copying the same company/vendor/material/po/payment-term/etc. fields as the edited CSN.
     - Knock Off → no new CSN is created. The remainder is permanently written off (reuse the existing PO line knock-off semantics — `knockOffPOLineHandler` already marks a line `KNOCKED_OFF`; here the "remainder" needs to be tracked as knocked off without necessarily knocking off the whole line if dispatch has partially happened. Use judgement matching the existing knock-off data model — e.g. an explicit `knocked_off_qty` accumulator on the PO line, or a zero-qty CSN row with status reflecting knock-off — pick whichever fits the existing schema with the least structural change, and flag the choice in the PR description for review).
   - **Sibling CSN(s) already exist for this line** → do NOT auto-create or auto-pick one. Open a reconciliation view (modal) listing **every CSN currently on this po_line_id** with an editable qty field per row, pre-filled with a suggested redistribution (the natural default: keep every other CSN's qty as-is except adjust the one sibling that represents the still-open/un-dispatched balance to absorb the new remainder), plus a **Knock Off** action for the leftover. The user can override any suggested qty before saving. On save, persist the user's final qty per CSN row (and/or knock off the leftover if they chose that instead of allocating it).

### Example trace to validate against (from the design session)
- PO line ordered_qty = 5000. PO confirmed → CSN-1 created, `po_qty=5000`, `dispatch_qty=5000` (default).
- Edit CSN-1 `dispatch_qty` → 3000. Save. No siblings yet → simple prompt → user picks "Create CSN" → CSN-2 created, `po_qty=2000`, `dispatch_qty=2000`.
- Edit CSN-1 again → change its qty to 2500 (or 3500). Sibling (CSN-2) now exists → reconciliation modal opens showing CSN-1 and CSN-2 together. User saves with CSN-1=2500. CSN-2 automatically becomes 2500 (5000-2500) since it's the only other CSN — system suggests this, user accepted it as-is in this example.
- Edit CSN-2 (now 2500) → change to 1000. Sibling check again. (Per the design, since CSN-2 has no sibling of its OWN yet at this point — CSN-1 is not its sibling in the "open balance" sense, it's already fixed at 2500 — this is effectively the "first split" case again for the 2500→1000 edit) → prompt: "Create CSN" or "Knock Off".
  - If "Create CSN": CSN-3 created with `po_qty=1500`.
  - If "Knock Off": no CSN-3, the 1500 is knocked off permanently.
- If CSN-3 (1500) is later edited to exactly 1500 or more (e.g. 1520) → remainder ≤ 0 → no prompt, just saves.
- If CSN-3 is edited to 999 → remainder = 1 → prompt fires again, even for a 1-unit balance.

**Important nuance to get right:** "sibling" here effectively means "the other CSN(s) on this line that are not yet finalized/dispatched-away" — in practice, since each split's remainder becomes exactly one new CSN, there is at most one other CSN to reconcile against in the simple chain case. If the business later allows more branching, the reconciliation modal already generalizes (it lists ALL CSNs on the line, not just one), so build the modal to handle N rows, not hardcode 2.

### Where to implement
- **Backend** (`csn.handlers.ts`): extend or wrap the `dispatch_qty` path of `inlineUpdateCSNHandler` (or add a dedicated endpoint, e.g. `POST /api/procurement/csns/:id/dispatch-qty`) that:
  1. Given the new value, computes the remainder for that `po_line_id`.
  2. Returns enough info for the frontend to decide which UI to show (remainder amount, list of existing sibling CSNs if any) — do not auto-decide on the backend; the user must choose Create-CSN vs Knock-Off vs explicit-reconcile-allocation.
  3. A second confirm step (separate endpoint or a `confirm` flag + `action`/`allocations` payload on the same endpoint) actually persists: either the simple save, the new-CSN creation, the knock-off, or the multi-row reconciliation.
- **Frontend** (`CSNTrackerPage.jsx`): wire `saveInlineEdit()`'s dispatch_qty path through this new preview/confirm flow — simple Yes/Knock-Off prompt when there's no sibling, full reconciliation modal (new component) when there is.

### Verification checklist (Part 2)
1. Trace through the exact example sequence above and confirm the resulting CSN rows (qty, status, count) match at every step.
2. Confirm a PO line's CSNs always sum to `ordered_qty` minus any knocked-off amount — write this as an explicit assertion/test if a test harness exists, otherwise verify manually via SQL after each step.
3. `npx eslint` + `npx vite build` clean on all changed frontend files.
4. `deno check` clean (no new errors) on `csn.handlers.ts` and `po.handlers.ts`.
5. Structural-integrity check (file line count vs. last top-level `}` line) on every changed file — this bug class (code stranded after a function's closing brace) has recurred multiple times this session.

---

## Part 3 — PO/STO Cancel, Knock-off, CSN inactivation, and Revoke

This is the biggest piece. It governs when a CSN becomes "inactive," when PO/STO Cancel and Knock-off are even allowed, and introduces a brand-new Revoke mechanism for both. **STO follows every rule in this section identically to PO**, with one additional STO-only rule at the end for `CONSIGNMENT_DISTRIBUTION` re-linking.

### 3.1 — When can PO/STO Cancel happen, and what does it do to CSNs

- Cancel is allowed at **any stage before GRN** (or before final receipt, for STO) — `ORDERED`, `IN_TRANSIT`, or even after Gate Entry (GE) has happened. **Only after GRN/receipt is Cancel blocked entirely.** This is looser than the current code (`cancelPOHandler`'s `lineHasReceipt` check already matches the GRN cutoff correctly — keep that part — but `cancelSTOHandler`'s current restriction to `["DRAFT","PENDING_APPROVAL","CREATED"]` is now too strict and needs to allow cancel through dispatched/in-transit/GE stages too, only blocking once received).
- If the PO/STO line being cancelled is still at `ORDERED` stage, cancel proceeds with no special warning.
- If it's at `IN_TRANSIT` or post-GE stage, cancelling must show a **warning** first (what stage it's at, whether CSN Tracker has data filled in) before the user confirms.
- **If Gate Entry has already happened**, Cancel is blocked until the GE itself is **dropped (reversed) first**. There is currently no GE-drop/reverse handler anywhere in `gate_entry.handlers.ts` — this needs to be built as a new endpoint (e.g. `POST /api/procurement/gate-entries/:id/drop`) that reverses a GE so the linked CSN goes back to a pre-GE state, after which Cancel becomes possible.
- Once Cancel proceeds (at any allowed stage): the linked CSN(s) — for PO, those still `ORDERED`/`IN_TRANSIT`/GE-stage and not yet received; for STO, the CSN(s) tied to that STO — become **CLOSED**. All their already-filled fields (vessel, BL, ETA, GE data, etc.) remain **visible** (do not null them out, do not delete the row) but the CSN is locked from edits and excluded from Planning calculations (see 3.3).

### 3.2 — Knock-off (direct from PO/STO, separate from the dispatch-qty reconcile flow in Part 2)

- Knocking off a PO/STO line directly only affects CSN(s) still in `ORDERED` status on that line. CSNs already `IN_TRANSIT`, GE-stage, `ARRIVED`, or `GRN_DONE` are **never** touched by a knock-off — those are left exactly as-is.
- Those `ORDERED` CSNs become **CLOSED** (same inactive treatment as 3.3) when knocked off.
- Authority: knock-off already uses a normal ACL permission gate (`resourceCode: PROC_PO_CREATE, action: EDIT` in `route-acl-registry.ts`) — this already matches "any role can do it if they have the permission," no change needed there for STO (mirror the same ACL pattern for STO's knock-off route if it isn't already there).

### 3.3 — Inactive CSN behavior (applies identically whether closed via Cancel or via Knock-off)

- An inactive (`CLOSED`) CSN is **never** considered in any future calculation — Planning, GE creation, GRN creation, sub-CSN-for-STO listing, etc. all must exclude it (the GE/GRN handlers already exclude `CLOSED` via `.not("status","in",'("GRN_DONE","CLOSED")')` — extend the same exclusion to Planning's CSN-based calculations if they don't already filter it).
- An inactive CSN **cannot be edited by anyone**, no role exceptions. `updateCSNHandler`/`inlineUpdateCSNHandler` already block edits on non-`EDITABLE_CSN_STATUSES` statuses (`ORDERED`, `IN_TRANSIT`) — `CLOSED` is already outside that set, so this should already hold; just confirm it explicitly in testing, don't assume.
- The PO/STO itself shows a distinct status label for each path — `CANCELLED` vs `KNOCKED_OFF` — these must remain visually/data distinguishable so a future Revoke action knows which authority rule applies (see 3.4).

### 3.4 — Revoke (brand new feature, does not exist anywhere in the codebase today)

- **Revoke Cancel**: only the configured **Approver** for that resource (same approver-resolution mechanism as `assertProcurementHeadRole` / `assertStoApproverRole` — i.e. `acl.approver_map` lookup, not a generic ACL permission) can revoke a Cancel. On revoke, the PO/STO status reverts from `CANCELLED` to its prior state, and every CSN that was closed by that cancel becomes **active** again (reverts to its prior status, e.g. back to `ORDERED`/`IN_TRANSIT`).
- **Revoke Knock-off**: any role can revoke a knock-off, gated by a normal ACL permission check (not restricted to a specific approver) — same `PROC_PO_CREATE`/EDIT-style permission pattern as knock-off itself. On revoke, the affected CSN(s) become active again.
- Both need new endpoints + new route-ACL-registry entries + new buttons in the PO/STO detail pages, gated appropriately (Revoke Cancel button only enabled/visible for users who pass the approver check; Revoke Knock-off gated by the existing EDIT permission).

### 3.5 — STO-only addition: re-linking on revoke for CONSIGNMENT_DISTRIBUTION

- If a Cancel or Knock-off being revoked belongs to a `CONSIGNMENT_DISTRIBUTION`-type STO (one originally created from a sub-CSN via `buildConsignmentStoFromSubCsns`), revoking must **re-link** that sub-CSN back to the STO.
- This re-link is **not guaranteed to succeed** — it must re-run the exact same validation rules used at original STO creation time (`CSN_ALREADY_LINKED_TO_STO`, `CSN_CONSIGNEE_COMPANY_MISMATCH`, `CSN_SOURCE_COMPANY_MISMATCH`, `PROCUREMENT_PO_CANCELLED`, `PROCUREMENT_PO_LINE_KNOCKED_OFF`, etc. — see `buildConsignmentStoFromSubCsns` in `sto.handlers.ts`). If the sub-CSN was linked to a different STO in the meantime, or its source PO/line was itself cancelled/knocked-off since, the revoke must **fail with a clear error** explaining which check failed — it must never silently succeed into a corrupted state.
- `INTER_PLANT`-type STOs have no such re-link step — their CSN was auto-created by the STO itself, so revoke just reactivates that same CSN directly (no relinking needed, nothing to search for).

### Verification checklist (Part 3)
1. Walk through every stage combination (ORDERED-cancel, IN_TRANSIT-cancel-with-warning, GE-done-cancel-blocked-until-GE-dropped, post-GRN-cancel-blocked) for both PO and STO.
2. Confirm knock-off only ever touches `ORDERED` CSNs, never anything further along.
3. Confirm inactive CSNs are excluded from every consuming screen/query (Planning, GE picker, GRN picker, sub-CSN-for-STO picker) — grep for every place that queries `consignment_note` and check each one's status filter.
4. Confirm Revoke Cancel is rejected for non-approvers, and Revoke Knock-off is rejected for users without the EDIT permission.
5. Confirm the CONSIGNMENT_DISTRIBUTION revoke re-link failure path surfaces a clear, specific error (not a generic 500) when the sub-CSN is no longer available.
6. Same eslint/build/deno-check/structural-integrity checks as Parts 1–2, applied to every newly touched file (expect new files: GE-drop handler, Revoke handlers, Revoke UI buttons).

Commit message should end with `Co-Authored-By: Codex <noreply@openai.com>`.

---

## Part 4 — CSN field redesign, calculation logic, edit UI, and Material Group

### 4.1 — Full field list (locked)

The CSN field set is being redesigned. Group fields as follows (system-set at creation / manually editable / calculated):

**System auto-set at CSN creation (PO confirm time), never edited after:**
CSN Number, CSN Type, Company Code (Consignee), Company Name (Consignee), Vendor ID, Vendor Name, Material Code, Material Name, PO Number, PO Date, PO Quantity, Base UOM, Order UOM, Has Rebate.

**Manually editable by procurement (via the expand-row UI in 4.3):**
Dispatch Qty, Material Group (see 4.4), Indent Required, Indent Number (only if Indent Required = YES), ETD (manual override; defaults from the calculation in 4.2 until overridden), ATD (= BL Date for Import / LR Date for Domestic), BL Number, BL Date (Import only), Invoice Number, Invoice Date, BOE Number, BOE Date, Current ETA (manual), ATA (manual), Transporter (dropdown), LR Date, LR Number, GE Number, GE Date, GRN Number, GRN Date, LC Number, LC Opened Date.

**Calculated (system computes, see 4.2 for exact formulas):**
- Domestic: Calculated ETA to Plant
- Import: Calculated ETD from Loading Port
- ETA to Plant (live, recalculates as the CSN progresses)
- Calculated LC Opening Date

### 4.2 — Calculation formulas (locked)

**ETD/ATD are now explicit, named drivers of "ETA to Plant" — not silently absorbed into another field.** Whenever ETD or ATD changes (set, or manually overridden), "ETA to Plant" must recalculate immediately, using whichever of the two is more concrete (ATD is actual, always wins over ETD's estimate once ATD exists).

**Domestic:**
1. Baseline: `Calculated ETA to Plant = PO Line's expected_delivery_date + Domestic Lead Time` (lead time from the domestic lead-time master). This is the default/baseline `ETD` shown before any manual override.
2. If procurement overrides `ETD` manually (e.g. 5-Jul → 10-Jul) → `ETA to Plant = ETD + Domestic Transit Days` recalculates immediately off the new ETD.
3. Once `ATD` (= LR Date) is entered (e.g. 12-Jul) → `ETA to Plant = ATD + Domestic Transit Days` recalculates again, overriding the ETD-based estimate (actual data always wins over estimate).
4. If `GE Date` is entered → `ETA to Plant = GE Date` directly (most concrete, final).

**Import:**
1. Baseline: `Calculated ETD from Loading Port = Scheduled ETA to Port − Sail Time` (from the import lead-time master).
2. If procurement overrides `ETD` manually → recalculate `ETA to Plant` off the new ETD estimate (see step 4 priority chain below).
3. Once `ATD` (= BL Date) is entered → recalculate off ATD, overriding the ETD-based estimate.
4. `ETA to Plant` priority chain beyond ETD/ATD (each step further down is more concrete and overrides the previous): `GE Date` (most concrete) → `LR Date (post-clearance)` + Port-to-Plant Transit → `ATA at Port` + Clearance Days + Port-to-Plant Transit → `ETA at Port` (itself derived from ATD/BL Date or ETD + Sail Time) + Clearance Days + Port-to-Plant Transit → baseline Scheduled ETA to Port + Clearance + Transit.

**Calculated LC Opening Date (Import only):** `ETD − 10 days` (fixed buffer). Recalculates whenever the underlying ETD changes.

**Trigger point:** every recalculation above happens automatically on Save in the expand-row edit UI (4.3) — the user never manually triggers a recalculation, it's a side effect of saving any of the driving fields.

### 4.3 — Edit UI pattern (locked): expand-row, not a separate detail page

- CSN Tracker keeps its existing grid/list view as the default (Option A retained) — each row shows the **latest** values, read-only, compact.
- Each row gets an **expand toggle** (chevron). Expanding a row reveals an inline edit form (within the row, accordion-style — not a navigation to another page) where procurement enters/edits the manually-editable fields from 4.1.
- Saving from the expanded form recalculates whatever fields apply (4.2) and then **collapses back to the grid view**, now showing the updated latest values in that row.
- Fields that have edit history (every manually-editable field, per Part 4.1) get a small info icon (`ti-info-circle`) next to the input, visible only while the row is expanded. Hovering/touching the icon shows a small popup listing the field's change history (old value → new value, who changed it, when). Moving away hides the popup. This is the UI surface for whatever history-logging mechanism gets built (see the still-open audit-log design point — not yet locked, revisit separately).
- Collapsing a row without expanding it never triggers any save/recalculation — it's purely a read view.

### 4.4 — Material Group (locked)

- A material can belong to **multiple** material groups simultaneously — this is a genuine many-to-many relationship, already modeled in `erp_master.material_category_assignment` (`material_id`, `group_id`, `is_primary`, `active`). Material Group is primarily used by **Planning**, which aggregates/plans at the group level, not the material level.
- On a CSN, "Material Group" is a **dropdown scoped to the CSN's own material** — query `material_category_assignment WHERE material_id = <csn.material_id> AND active = true` and offer only those groups as options (never the full group master list).
- If exactly one assignment has `is_primary = true`, pre-select it as the default in the dropdown — procurement can still override to any other valid group for that material.
- If the material has **zero** active group assignments, there is nothing to pick — display the Material Name itself in place of the Material Group field (no dropdown shown).
- `consignment_note.material_category_id` is the existing column to populate with the selected `group_id` — currently it exists in schema but is never populated anywhere in `createCsnsForPo`. Populate it at creation time with the material's primary group (if one exists) as the initial default, and let procurement change it via the expand-row edit UI (4.3) same as any other manually-editable field.

### Verification checklist (Part 4)
1. Confirm every field in 4.1's three buckets matches what's rendered in the CSN Tracker grid + expand-row form — no field silently dropped or miscategorized.
2. Walk the exact Domestic and Import calculation chains in 4.2 with concrete dates and confirm the resulting `ETA to Plant` at each stage matches by hand-calculation.
3. Confirm expanding a row never auto-saves, and collapsing without saving discards in-progress edits cleanly (or prompts before discarding — decide and note which behavior was implemented).
4. Confirm the Material Group dropdown only ever lists groups actually assigned to that row's material, and falls back to displaying Material Name when none exist.
5. Same eslint/build/deno-check/structural-integrity checks as prior parts.

---

## Part 5 — Sub-CSN: creation, fields, STO-link behavior, material sourcing

**Core principle (locked): a Sub-CSN is not a different entity from a CSN.** It is the exact same `consignment_note` row shape, same lifecycle, same fields, same Part 1–4 rules. The only things that make a CSN a "sub" are: it has a `mother_csn_id` pointing at another CSN, and (until STO-linked) its display label is prefixed differently in the UI. Nothing about its data model is special-cased.

### 5.1 — Creating a Sub-CSN

- From a (mother) CSN, there is a **"Create Sub CSN"** action (a button near/associated with the row, not inside the row itself). Each click creates one new sub-CSN copied from that mother. Clicking again creates another — there is no limit baked into the button itself (existing `createSubCSNHandler` already supports this — keep that mechanic).
- **Numbering (locked):** every sub-CSN gets a real, freshly-generated `csn_number` from the same global CSN sequence used by every other CSN (`generateProcurementDocNumber("CSN")`, already what `createSubCSNHandler` does — no change needed here). There is no separate "sub" number range or counter. The number is permanent from the moment of creation and never changes later, including after STO-linking.
- **Display label (locked, new requirement):** while a CSN has a `mother_csn_id` set and `sto_id` is still null, the UI shows it labeled as `Sub-CSN-<number>` (e.g. "Sub-CSN-9") instead of plain `CSN-<number>`. The moment `sto_id` becomes non-null (STO-linked), the label switches to plain `CSN-<number>` (e.g. "CSN-9") — same row, same number, label changes based on `mother_csn_id != null && sto_id == null` vs not.

### 5.2 — Collapsed-row appearance: identical to any CSN

In the CSN Tracker's collapsed/grid view, a sub-CSN's row looks exactly like a normal CSN row — no extra columns, no different styling. The only behavioral difference is the label rule in 5.1.

### 5.3 — Expanded-row: two extra fields only on sub-CSNs

When expanding a sub-CSN row (using the expand-row pattern from 4.3), show two extra fields beyond what a normal CSN's expanded view has:
1. **Mother CSN** (read-only reference, showing which CSN it was split from). This reference must persist even after the sub-CSN gets STO-linked — never clear `mother_csn_id`.
2. **Allotted Company** — a dropdown to select/change the consignee company this sub-CSN is being distributed to. This is the existing `consignee_company_id` field, just exposed as an editable dropdown in this expanded view.

On save, after setting Allotted Company and collapsing the row: the collapsed row's Consignee display updates to show the newly-allotted company's name (replacing whatever was shown before — there's no separate "mother's consignee" to fall back to display once allotted).

### 5.4 — Calculated fields use the allotted company, not the mother's own consignee

Once Allotted Company is set/changed and saved, every Part 4.2 calculation (`ETA to Plant`, etc.) for that sub-CSN must recompute using **that allotted company's own port-to-plant transit time** (from the port-plant-transit master, keyed by company), not whatever transit time applies to the mother CSN's original consignee. Example from the design session: if Company A's port-to-plant transit is 1 day and Company B's is 4 days, a sub-CSN allotted to Company B must calculate `ETA to Plant` using 4 days, even though it inherited the same vessel/BL/port data from the mother.

### 5.5 — What happens when a sub-CSN gets linked to an STO

- The existing linking mechanism (`buildConsignmentStoFromSubCsns`, reached via `createSTOHandler`'s `CONSIGNMENT_DISTRIBUTION` path or `transformSubCSNToSTOHandler`) sets `sto_id` on the sub-CSN. **No change to this part** — confirmed correct already.
- **Status is not touched by linking** — the sub-CSN's own lifecycle status (`ORDERED`/`IN_TRANSIT`/etc.) stays exactly as it was. Linking an STO does not itself advance or alter CSN status.
- **Display label** switches from `Sub-CSN-<number>` to plain `CSN-<number>` per 5.1 (since `sto_id` is now set).
- **"PO Number" field is replaced by "STO Number" in display** — once `sto_id` is set, the row's PO-reference field (wherever PO Number is shown — tracker grid column, expanded view, etc.) shows the linked STO's number instead of the original PO number. This is a display substitution only — do not delete or null out `po_id`/`po_line_id` on the row; the underlying PO linkage data stays intact for traceability, only the **shown** label changes. If not STO-linked, the field shows PO Number as normal.
- **No separate "STO Number" column needs to be added** — reuse the existing PO Number column/field and make it conditionally render PO Number vs STO Number based on whether `sto_id` is set.

### 5.6 — Fix: STO line material must come from the CSN, never from caller input

**Bug found and confirmed during this design session.** In `buildConsignmentStoFromSubCsns` (`sto.handlers.ts`), the STO line insert currently does:
```ts
material_id: lineConfig.material_id,
```
`lineConfig` comes from caller-supplied data (`createSTOHandler`'s `CONSIGNMENT_DISTRIBUTION` branch passes user-submitted line input; `transformSubCSNToSTOHandler` passes the raw request body, which typically doesn't even include `material_id`). There is no validation anywhere that this matches the sub-CSN's actual `material_id`.

**Why this matters even though the normal UI picker (`listAvailableSubCsnsForStoHandler`) already filters sub-CSNs by the requested `material_id`** (so a user can't normally pick a mismatched CSN through the UI): this still leaves a latent gap for any caller that bypasses the picker (direct API calls, future code paths). Since "a Sub-CSN is not different from a CSN" and its material is an inherent property of the CSN row — never something a caller should be choosing independently — the fix is:

```ts
material_id: subCsn.material_id,
```
Use the sub-CSN's own `material_id` directly when constructing the STO line, in **both** call sites that feed into `buildConsignmentStoFromSubCsns` (don't just fix the function signature — make sure the line insert always reads `material_id` off the fetched `subCsn` row inside `buildConsignmentStoFromSubCsns` itself, not from the `lineConfig`/caller input at all, so it's impossible to override regardless of caller).

### Verification checklist (Part 5)
1. Create 2 sub-CSNs from one mother, 1 from another — confirm all three get fresh, sequential `csn_number`s from the same global sequence (no separate sub-range).
2. Confirm label shows `Sub-CSN-<n>` before STO-link, `CSN-<n>` after — same underlying number throughout.
3. Confirm Allotted Company change recalculates `ETA to Plant` using that company's port-plant-transit master row, not the mother's original consignee's.
4. Confirm linking an STO does not change sub-CSN status, but does switch the displayed PO-reference field to the STO number while leaving `po_id`/`po_line_id` intact underneath.
5. Confirm the STO line's `material_id` always equals the source sub-CSN's `material_id`, even if a crafted request tries to pass a different one directly to the API (bypassing the normal picker).
6. Same eslint/build/deno-check/structural-integrity checks as prior parts.

### 5.7 — Deleting a mistakenly-created Sub-CSN

- **Delete vs Inactive (locked):** if nothing has happened to the sub-CSN yet (`status = ORDERED`, no Gate Entry link), a hard delete is allowed and correct — there's no real-world event or audit value to preserve. `deleteSubCSNHandler` already implements this check correctly (status must be `ORDERED`, blocks if a `gate_entry_line` row or `gate_entry_id` exists) — **no change needed there.** If the sub-CSN has progressed beyond `ORDERED` or has a GE link, deletion must stay blocked — use the Part 3 Knock-off/Cancel → inactive path instead, never delete.
- **Bug found and confirmed — STO-link is not checked before delete.** `deleteSubCSNHandler` currently checks status and GE-link only; it never checks `sto_id`. This means a sub-CSN that is STO-linked but still `ORDERED` (no GE yet) can currently be deleted, leaving the linked STO's `related_csn_id`/line referencing a now-nonexistent CSN — an orphaned reference that breaks STO data integrity. **Fix: block deletion outright whenever `sto_id` is set**, regardless of status — the same way the GE-link check already blocks it. To delete in that case, the CSN must first be unlinked from the STO (e.g. via STO cancel, which already unlinks sub-CSNs per Part 3.1's `CONSIGNMENT_DISTRIBUTION` rule) before deletion becomes possible.
- **Serial number behavior on delete (informational, no change needed):** `erp_procurement.generate_doc_number` is a simple ever-incrementing counter (`last_number = last_number + 1`) that never decrements. Deleting a CSN row has zero effect on this counter — the number it consumed is permanently skipped and will never be reissued to a future CSN. This is already correct, audit-safe behavior; just documenting it here since it came up in the design session.

### 5.8 — RESOLVED: Sub-CSN creation does reduce the Mother's own displayed quantity, but GE/GRN always use the original Order Quantity

This was previously an open question — now locked:

- **Two separate quantity concepts must exist on a CSN row:**
  1. **Order Quantity** — the PO line's original total (e.g. 25MT). **Immutable, never reduced by splitting.** Gate Entry and GRN **always** use this value, regardless of how many sub-CSNs have been carved out of the Mother. Reason: GE/GRN reflect the physical shipment arriving as one unit — splitting into sub-CSNs is a downstream internal-allocation concept, not a change to what physically arrives.
  2. **CSN/Dispatch Qty** — the row's own current allocation, shown in the CSN Tracker. **This one does reduce** when sub-CSNs are split off: e.g. Mother starts at 25MT, after Sub-1 (10MT) and Sub-2 (5MT) are created, Mother's own CSN/Dispatch Qty shows 10MT (its retained portion). This is for Tracker display/allocation-tracking purposes only — it must never be substituted for Order Quantity when generating a GE or GRN.
- **Implication for `createSubCSNHandler`:** when creating a sub-CSN with a given quantity, subtract that quantity from the Mother's `dispatch_qty` (not `po_qty` — `po_qty` stays untouched as the Order Quantity reference). The sub-CSN itself gets its own `dispatch_qty` set to its allocated amount; its own `po_qty` should likely still reference back to the original Order Quantity for consistency (needs the same immutability), but its Tracker-displayed quantity is its `dispatch_qty`.
- **Implication for GE creation:** wherever GE is created against a CSN that has sub-CSNs (i.e. `is_mother_csn = true`), the GE quantity field must pull `po_qty` (Order Quantity), not `dispatch_qty`.
- **Sub-CSNs cannot have their own GE/GRN at all until STO-linked** (locked earlier in this session) — only the Mother ever does GE/GRN for the full Order Quantity; sub-CSNs are pure allocation records until an STO picks them up, at which point that leg's onward movement is tracked through the STO's own dispatch/receipt flow, not a separate GE/GRN on the CSN itself.

---

## Part 6 — CSN status codes, and additional fields

### 6.1 — Status values get short 3-character codes (locked)

Replace the long-form status strings with short internal codes (used as the actual `status` column value), while the UI still displays the full word:

| Status (display) | Code (stored value) | Badge color (light mode: bg / text) |
|---|---|---|
| Ordered | `ORD` | `#F1EFE8` / `#2C2C2A` (gray) |
| In Transit | `TRN` | `#B5D4F4` / `#042C53` (blue) |
| GE Done | `GED` | `#FAC775` / `#412402` (amber) |
| GRN Done | `GRD` | `#97C459` / `#173404` (green) |
| Cancelled | `CAN` | `#E24B4A` / `#FCEBEB` (red, bold/dark — terminal) |
| Knocked Off | `KOF` | `#5F5E5A` / `#F1EFE8` (dark gray, bold — terminal, distinct from Cancelled) |

This is a progression-scale palette (gray → blue → amber → green as the CSN advances), with the two terminal statuses (Cancelled, Knocked Off) given deliberately bold/dark badges so they stand out from the in-progress states at a glance. Use these exact colors for the Status badge in both the Tracker grid and the expanded view.

This **replaces** the current text values (`ORDERED`, `IN_TRANSIT`, `ARRIVED`, `GRN_DONE`, `CLOSED`) — note `ARRIVED` is dropped (collapsed into the GE/GRN-only lifecycle) and the old generic `CLOSED` is now split into the two distinct terminal statuses `CAN` (Cancelled) and `KOF` (Knocked Off), matching Part 3's requirement that Cancel and Knock-off need distinguishable statuses (different revoke-authority rules apply to each — Cancel revoke is approver-only, Knock-off revoke is permission-gated). Update every status comparison across `csn.handlers.ts`, `po.handlers.ts`, `sto.handlers.ts`, `gate_entry.handlers.ts`, and any frontend status-tone/filter logic (`CSNTrackerPage.jsx` etc.) to use the new codes — this touches a lot of call sites, grep exhaustively for the old string literals (`"ORDERED"`, `"IN_TRANSIT"`, `"ARRIVED"`, `"GRN_DONE"`, `"CLOSED"`) and update every one.

- The CSN Tracker grid should show this 3-character code as a compact **Status** column (not the full word) — full word available via tooltip/hover or in the expanded view.

### 6.2 — Two new Yes/No fields (locked)

Added as main-row manually-editable fields (dropdown, Yes/No):
- **Soft Copy Received**
- **Hard Copy Received**

### 6.3 — New expanded-view-only fields for hard-copy courier tracking (locked)

Visible only in the expanded edit view, all manually entered:
- **Hard Copy Courier Number** (text)
- **Courier Dispatch Date**
- **Courier Received Date**
- **Courier Date to CHA**
- **Courier CHA Receive Date**
- **CHA Docket Number** (text)

These follow the same edit-history rule as every other manually-editable field (Part 4.3's `i`-icon history popup applies here too).

---

## Part 7 — Add Destination Port to PO (and legacy/opening PO), carry it into CSN

**Root cause this fixes:** CSN's `port_of_discharge_id` is currently never populated at CSN creation (`createCsnsForPo` doesn't set it) and PO has no port concept at all — so every CSN's ETA/ETD calculation (Part 4.2) sits blank/uncalculatable until procurement manually fills in the port later. This closes that gap by giving PO a Destination Port up front, which flows down into the CSN automatically.

### 7.1 — Add `destination_port_id` to PO

- Add to both `createPOHandler`/`updatePOHandler` (`po.handlers.ts`) and the legacy/opening PO flow (`POCreateOpeningPage.jsx` + its backend handler) — same field, same behavior in both places, no divergence between regular PO and legacy/opening PO.
- **Dropdown options are scoped to the PO's company** — query `erp_master.port_plant_transit_master WHERE company_id = <PO's company_id> AND active = true`, list the distinct `port_id`s (joined to `port_master` for the display name). Only ports actually mapped (have a transit-time row) for that company are selectable — not the full port master list.
- **Editable via Edit and Amend** — `destination_port_id` should be added to the same mutable-field list used by PO's edit flow and to `MUTABLE_AMENDMENT_FIELDS` (or PO's equivalent) so it goes through the same amendment-log/approval-gating pattern as other amendable PO fields (decide whether changing destination port after CSNs already exist should require approval — likely yes if any linked CSN's calculated dates would change, consistent with how qty/rate changes are gated today).

### 7.2 — Carry Destination Port into CSN at creation

- `createCsnsForPo` must now set `port_of_discharge_id = po.destination_port_id` when creating each CSN (currently this field is omitted entirely from the insert — add it).
- This becomes the CSN's **default** `port_of_discharge_id` — procurement can still change it later via the expanded edit view (Part 4.1's manually-editable list), same as today, but it no longer starts blank.
- Since the port is now known from the moment of creation, the Part 4.2 calculation chain (which depends on the port-plant-transit lookup) can run immediately instead of sitting pending — this should noticeably reduce the "blank until someone fills it in" gap raised earlier in this session.
- Sub-CSNs inherit this the same way they inherit every other field from their mother (Part 5.1's copy mechanism) — no special handling needed there.

### Verification checklist (Part 7)
1. Confirm the Destination Port dropdown on PO create/edit only lists ports with an active `port_plant_transit_master` row for that PO's company — never the full port master.
2. Confirm legacy/opening PO has the identical field and identical scoping — no divergence.
3. Confirm a newly-confirmed PO's auto-created CSN has `port_of_discharge_id` pre-filled from the PO, and that the ETA/ETD calculation chain produces a real (non-blank) value immediately rather than waiting for manual entry.
4. Confirm changing Destination Port via Amend follows the same approval-gating decision made in 7.1.
5. Same eslint/build/deno-check/structural-integrity checks as prior parts.

---

## Part 8 — Conditional cell highlighting, new columns, column show/hide

### 8.1 — Status badge colors (locked, extends Part 6.1)

Progression-scale palette — gray → blue → amber → green as the CSN advances, with the two terminal statuses given deliberately bold/dark badges so they stand out:

| Status | Code | Badge bg / text (light mode) |
|---|---|---|
| Ordered | `ORD` | `#F1EFE8` / `#2C2C2A` |
| In Transit | `TRN` | `#B5D4F4` / `#042C53` |
| GE Done | `GED` | `#FAC775` / `#412402` |
| GRN Done | `GRD` | `#97C459` / `#173404` |
| Cancelled | `CAN` | `#E24B4A` / `#FCEBEB` (bold, terminal) |
| Knocked Off | `KOF` | `#5F5E5A` / `#F1EFE8` (bold, terminal, visually distinct from Cancelled) |

### 8.2 — Conditional cell highlighting (locked) — "deadline passed, dependent still blank" rule

**General principle:** for each estimate/predecessor milestone, once it has passed (date elapsed) or been completed, if the dependent successor field(s) are still blank, those cells turn **red**. The moment the dependent field is filled, red clears immediately. If an estimate field itself gets pushed to a future date, red clears until that new date also elapses.

Full list of triggers (Domestic + Import):

| Field(s) that turn red | Trigger condition | Clears when |
|---|---|---|
| **ETD** | today > ETD's date AND `ATD` is blank | `ATD` filled, or `ETD` edited to a future date (until that date also passes) |
| **ATD** | today > ETD's date AND `ATD` itself is blank | `ATD` filled (Domestic = LR Date, Import = BL Date) |
| **BL Number** (Import) | `BL Date` filled but `BL Number` blank | `BL Number` filled |
| **BL Date** (Import) | `BL Number` filled but `BL Date` blank | `BL Date` filled |
| **Invoice Number** | predecessor (`ATD`/LR Date, or BL+BL Date for Import) filled, but `Invoice Number` blank | `Invoice Number` filled |
| **Invoice Date** | same predecessor condition, but `Invoice Date` blank | `Invoice Date` filled |
| **ETA at Port** (Import) | today > ETA's date AND `ATA` is blank | `ATA` filled, or `ETA` edited to a future date |
| **ATA at Port** (Import) | today > ETA's date AND `ATA` itself is blank | `ATA` filled |
| **BOE Number** (Import) | `ATA` filled but `BOE Number` blank | `BOE Number` filled |
| **BOE Date** (Import) | `ATA` filled but `BOE Date` blank | `BOE Date` filled |
| **Transporter** (Import) | calculated post-clearance departure date (`ATA + Clearance Days` from import lead-time master) has passed, `Transporter` blank | `Transporter` set |
| **LR Number** (Import) | same calculated date passed, `LR Number` blank | `LR Number` filled |
| **LR Date** (Import) | same calculated date passed, `LR Date` blank | `LR Date` filled |
| **Soft Copy Received** | today ≥ `ATD + 3 days` AND still `No` | switched to `Yes` |
| **Hard Copy Received** | today ≥ `ATD + 7 days` AND still `No` | switched to `Yes` |
| **ETA to Plant** | its own date has passed AND GE hasn't happened (`GE Number`/`GE Date` blank) | GE done (`GE Number`/`GE Date` filled) |

Implement this as a reusable rule evaluator (not 15 hardcoded if-statements scattered across the component) — each rule is essentially `(predecessorCondition, dependentFieldsList)`, so model it as a small declarative table in code mirroring the one above, evaluated per-row on render and on every save.

### 8.3 — New calculated/display columns (locked)

| Column | Calculation | Color |
|---|---|---|
| **ETD vs ATD (days)** | `ATD − ETD` | Delay (positive, ATD later) → red. Advance (negative, ATD earlier) → blue. |
| **ETA vs ATA (days)** | `ATA − ETA` | Same red/blue rule as above. |
| **Baseline vs Actual (days)** | Domestic: `LR Date − PO ETD (baseline)`. Import: `ATA − ETA to Port (baseline)`. | Same red/blue rule as above. |
| **LR Date vs GE Date (days)** | `GE Date − LR Date` | No color — plain number. |
| **Actual Payment Date** | Look up the CSN's `payment_term_id` → `payment_terms_master.reference_date_type_id` (one of `INVOICE_DATE`/`GRN_DATE`/`BL_DATE`/`SHIPMENT_DATE`/`N_A`) → take the CSN's own field matching that reference type as the anchor date → `anchor date + credit_days`. If `reference_date_type` is `N_A`, leave blank (not applicable). | No color. |
| **Created By** | Resolved via the existing `enrichProcurementUserDisplays`-style display pattern — show as `<user_code>-<user name>` (e.g. "P0004-Almega Director"), never a raw UUID or bare name, matching the project-wide user-identity display rule. | No color. |
| **Created At** | Plain timestamp. | No color. |

### 8.4 — Column show/hide, with named, saveable, shareable layouts (locked)

- The CSN Tracker grid shows every field as a column (the full ~50-field set across Parts 4, 5, 6, 8 above), reachable via horizontal scroll.
- Add a **column visibility control** (e.g. a "Columns" button opening a checklist of all available columns) so a user can toggle which columns are currently shown vs hidden.
- **Default view (no layout selected) shows every column.**
- **Named, saveable layouts (new requirement):** a user can save their current column-visibility configuration as a named **Layout** (e.g. "Import Quick View", "Domestic Dispatch Check"). There is no limit on how many layouts a user can create.
- **Scope per layout: Global or User-specific, chosen at save time:**
  - **Global** — visible to and usable by every user. Anyone can select it from the layout picker.
  - **User-specific** — visible only to the user who created it.
- Selecting a saved layout from a picker (dropdown) switches the grid's visible columns to match that layout's saved configuration. Switching back to "Default"/no layout shows every column again.
- **New table needed** (e.g. `erp_procurement.csn_tracker_layout` or similar — pick a schema/name consistent with this codebase's conventions): `id`, `name`, `scope` (`GLOBAL`/`USER`), `created_by`, `visible_columns` (json array of column keys), `created_at`. New CRUD endpoints: list layouts (global ones + the current user's own user-specific ones), create layout, delete layout (only the creator should be able to delete their own; decide whether Global layouts need an elevated permission to delete — recommend yes, restrict Global layout create/delete to a manager-level role, while User-specific layouts are unrestricted for their own creator).
- Hiding a column (whether via the default checklist or a saved layout) only affects display — never affects underlying data or calculations.

### Verification checklist (Part 8)
1. Walk through the exact ETD→ATD→BL→Invoice and ETA→ATA→BOE→Transporter/LR chains with concrete dates and confirm red appears/clears exactly per the 8.2 table at each step.
2. Confirm Soft/Hard Copy Received red-by-ATD-offset triggers fire on the correct day (ATD+3, ATD+7) and clear immediately on toggling to Yes.
3. Confirm the delay/advance day-diff columns (8.3) color correctly in both directions (red for delay, blue for advance) and show 0/blank sensibly when either side of the diff is missing.
4. Confirm Actual Payment Date correctly resolves the anchor field per `reference_date_type` and shows blank for `N_A` terms.
5. Confirm a saved Global layout is visible/selectable by a different user than its creator, and a saved User-specific layout is not.
6. Confirm selecting a layout correctly shows/hides exactly its saved column set, and that switching back to Default restores every column.
7. Same eslint/build/deno-check/structural-integrity checks as prior parts.

---

## Part 9 — Field edit history (audit log) — closes the last open point from Part 4.3

**New table:** `erp_procurement.csn_field_history` (or similar name consistent with this codebase's `*_log`/`*_history` conventions — see `po_amendment_log`/`sto_amendment_log` for the established pattern this should mirror):
- `id`, `csn_id` (FK to `consignment_note`), `field_name` (text — which field changed), `old_value` (text), `new_value` (text), `changed_by` (uuid, FK to the user), `changed_at` (timestamptz, default now()).

**What gets logged:** every save from the expand-row edit UI (Part 4.3) that changes a manually-editable field (Part 4.1's list, plus the new fields from Parts 6–8: Material Group, Soft/Hard Copy Received, courier fields, CHA Docket Number, Allotted Company, Destination Port if changed at CSN level, etc.) writes one history row per changed field — not one row per save covering all fields at once, so each field's own history can be queried/displayed independently in its own `i`-icon popup (Part 4.3).

**Display (`changed_by`):** must follow this codebase's established user-identity display rule — show as `<user_code>-<user name>` (e.g. "P0004-Almega Director"), **never a raw UUID and never a bare name alone**. Reuse the existing `enrichProcurementUserDisplays`/`resolveUserDisplayNames` utility pattern already used across PO/STO handlers — don't write a new ad-hoc resolver for this.

**Read path:** the `i`-icon popup (Part 4.3) for a given field queries this table filtered by `csn_id` + `field_name`, ordered by `changed_at` descending, and renders each entry as `old_value → new_value` with the resolved `changed_by` display and `changed_at` timestamp — matching the example shown during the design session ("5-Jul-2026 → 10-Jul-2026 by P0007, 24-Jun").

### Verification checklist (Part 9)
1. Confirm editing a single field in the expand-row form writes exactly one history row for that field, not one row covering every field on the form.
2. Confirm the `i`-icon popup for any manually-editable field shows its own history only, correctly ordered newest-first.
3. Confirm `changed_by` always renders as `<user_code>-<name>`, never a raw UUID, in every history entry.
4. Same eslint/build/deno-check/structural-integrity checks as prior parts.

---

## Part 10 — Follow-up: missing fields from Parts 1-9, plus Tracker UI redesign

**Context:** Parts 1-9 were implemented across two Codex rounds (commits `592a04d`, `370707b`). Claude's post-implementation field-by-field audit against the locked design found real gaps — fields that were locked in this brief but never made it into the actual grid columns or expand-row form. This part lists exactly what's missing, plus a UI density/usability redesign requested by the business owner.

### 10.1 — Missing grid columns (add these to `CSNTrackerPage.jsx`'s column list)

| Column | Source field | Why it's missing-but-needed |
|---|---|---|
| Material Code | `material.pace_code` (already fetched in `enrichTrackerRows`'s `materialMap`, just not surfaced) | Locked in Part 4.1 alongside Material Name — only Material Name made it into the grid |
| Base UOM | `material.base_uom_code` or equivalent | Part 4.1 locked Base UOM and Order UOM as two separate columns — only one UOM column (`po_uom_code`) exists today |
| PO Date | `po.po_date` (already fetched as `poMap`) | Locked in Part 4.1, never added as its own column |
| Has Rebate | `consignment_note.has_rebate` | Locked in Part 4.1, never added |
| **Rebate Rate** (new, requested in this round) | `consignment_note.rebate_rate` — **did not exist, already added by Claude via migration `20260627060031_csn_add_rebate_rate.sql`, confirmed applied to dev** | New ask from the business owner — show alongside Has Rebate |
| **Rebate Remarks** (new, requested in this round) | `consignment_note.rebate_remarks` — confirmed already exists, no migration needed | New ask from the business owner |
| Calculated LC Opening Date | The Part 4.2 formula output (`ETD − 10 days`), distinct from `lc_opened_date` (when it was actually opened) | Locked in Part 4.2/8.3 as its own column — only `lc_opened_date` (the actual) is shown today, the calculated target date is missing entirely |
| Baseline ETD/ETA (Domestic: PO ETD: Import: ETA to Port baseline) | The Part 4.2 baseline-only calculation (before any actual milestone overrides it) | Locked in Part 4.2 as a distinct column from the live-recalculating "ETA Plant" — only the live one is shown |
| Destination Port | `consignment_note.port_of_discharge_id` → port name | Exists in the expand form (Part 4.3) but was also meant to be visible in the grid per Part 4.1/7.2 — add as a grid column too |

### 10.2 — Missing expand-row fields (add these to the expand form in `CSNTrackerPage.jsx`)

- **ATD** — present as a grid column today but **not editable in the expand form**. This is a serious functional gap: Part 4.2's entire calculation cascade depends on ATD being settable (it's one of the two explicit named drivers of "ETA to Plant" recalculation, per Part 4.2). Add it as an `EditField` exactly like `etd` is handled.
- **Courier Date to CHA** (`courier_date_to_cha`) — locked in Part 6.3, missing from the expand form (only `courier_dispatch_date`, `courier_received_date`, `cha_docket_number`, `hard_copy_courier_number` are present).
- **Courier CHA Receive Date** (`courier_cha_receive_date`) — same, locked in Part 6.3, missing.
- **Mother CSN** (read-only reference) — locked in Part 5.3 as a required expand-only field for sub-CSNs (showing which CSN it was split from, persisting even after STO-link per Part 5.5). This is **completely absent** from the expand form right now — add it as a read-only field, visible only when `mother_csn_id` is set on the row.

### 10.3 — CSN Tracker UI redesign (business owner feedback, this round)

The current Tracker layout wastes vertical space and the action buttons are too verbose for a data-dense report screen. Redesign with these specific changes:

1. **Pagination with a much higher visible row count.** Currently very few rows are visible per page given the available space. Target showing **at least 50-100 rows per page** before pagination kicks in — the whole point of the wide-workspace mode (added this session) was to maximize space for this exact reason. Audit the page's vertical layout (header, alert cards, filter bar, the "Tracker Alerts" section) for unnecessary padding/spacing that's eating row-display space, and tighten it.
2. **Compact, icon-only action buttons.** Replace verbose text buttons (e.g. "COLUMNS", "SAVE LAYOUT", "REFRESH") with small icon buttons. Each icon button must show what it does via a **tooltip on hover/touch** (use `title` attribute at minimum, or a proper tooltip component if one exists in this codebase — check `frontend/src/components/` for an existing tooltip primitive before building a new one).
3. **General principle: maximize usable space on this specific page.** This is a dense operational report (SAP ALV/ZMB51-style, per the earlier design discussion) — every bit of chrome (borders, padding, redundant headers) that isn't load-bearing should be trimmed specifically on this page. Don't change other pages' density — this is a CSN-Tracker-specific density pass, not a global design-system change.

### Verification checklist (Part 10)
1. Confirm every column listed in 10.1 renders real data (not blank) for at least one existing CSN row — `rebate_rate`/`rebate_remarks` columns already exist on `consignment_note` (migration applied), so this is purely a frontend/select-list wiring task, no schema work needed.
2. Confirm editing ATD in the expand form actually triggers the Part 4.2 recalculation cascade (ETA to Plant updates), matching how editing ETD already behaves.
3. Confirm Mother CSN reference only appears for rows with `mother_csn_id` set, and that it survives STO-linking (per Part 5.5 — don't regress this).
4. Confirm the redesigned Tracker page shows materially more rows per screen than before on a standard laptop viewport (1366×768 or similar) without horizontal/vertical content getting cut off.
5. Confirm every icon-only button has a working hover/touch tooltip naming its action — no unlabeled icons.
6. Same eslint/build/deno-check/structural-integrity checks as prior parts. Pay special attention to the structural-integrity check on `CSNTrackerPage.jsx` given how large it already is (1300+ lines) — this is exactly the file where the "stranded code after closing brace" bug class has the highest chance of recurring.

Commit message should end with `Co-Authored-By: Codex <noreply@openai.com>`.

---

## Part 11 — Tracker density redesign (locked via mockup approval with business owner)

The business owner rejected the current Tracker's visual density — too much wasted vertical space top and bottom, fields/buttons too large, too few rows visible. Two mockups were shown and approved; implement exactly what they show.

### 11.1 — Header and filter bar (collapsed/default view)

- Collapse the header into a single compact row: eyebrow + title + alert counts inline (e.g. "Procurement · Consignment Tracker · LC: 0 · Vessel: 0") — no separate large "Tracker Alerts" card section taking its own vertical block.
- Action buttons (Columns, Save Layout, Refresh) become **small icon-only buttons** (~26x26px) using Tabler icons (`ti-columns`, `ti-device-floppy`, `ti-refresh`), each with a `title` tooltip (reuse the `title` prop already added to `ErpActionStrip` in Part 10 — don't reintroduce text labels).
- Filter row (Company, Status, CSN Type, Date From, Date To, Layout, Search) becomes one tight row of small (~26px height) inputs, wrapping only if the viewport is too narrow — not stacked in a tall multi-row block by default.
- Pagination/footer strip becomes a single compact line: "Rows X-Y of Z" on the left, Prev/Page/Next compact on the right — no large separate block.

### 11.2 — Table row density

- Reduce row height and cell padding significantly (target similar to the mockup: ~2-3px vertical padding per cell, 11px font) so meaningfully more rows are visible without scrolling on a standard laptop viewport, on top of the LIMIT=100 paging already set in Part 10.
- Status column renders as a small colored badge (already exists per Part 6.1/8.1 — just ensure the badge itself is compact, not oversized).

### 11.3 — Expand-row redesign

- Header bar of the expanded row: CSN display number/label on the left, **icon-only action buttons** on the right — Create Sub CSN (`ti-git-branch`), Open full detail page (`ti-external-link`), Save (`ti-check`), Collapse (`ti-chevron-up`) — each with a `title` tooltip. No text-label buttons here.
- Body is organized into the section groups already built in the prior round (Allocation, Shipment Timeline, Documents, Logistics, Receiving, Courier And CHA, Remarks) — keep that grouping, but tighten each section's grid to ~4 fields per row with small (~26px) inputs and a small uppercase section label (10-11px, muted color) above each group — matching the mockup's density, not the current oversized spacing.
- **New: add a "Sub CSNs" section** (bordered box, placed right after "Allocation") that is only rendered when the row has at least one sub-CSN created from it (i.e. `is_mother_csn` true or a non-empty sub-CSN list is available) — contents:
  - A small header showing the count (e.g. "Sub CSNs (2)") and the **Create Sub CSN** icon button (`ti-git-branch`) on the same line.
  - A compact mini-table listing each sub-CSN: its display label (reusing the existing `Sub-CSN-<n>` / `CSN-<n>` logic from Part 5.1 depending on STO-link state), Allotted Company, Qty, Status badge, and a small delete icon (`ti-trash`) that only renders/enables per the existing delete rules from Part 5.7 (status `ORD` and no `sto_id`) — reuse the existing delete-sub-csn endpoint/handler, don't build a new one.
- The "Mother CSN" read-only reference (Part 5.3/10.2) stays as a small strip at the bottom of the expand body — shows the actual mother reference when this row is itself a sub-CSN, or an empty/dash state when it isn't (don't hide the strip entirely on mother rows — show it in a clearly-empty state instead, per the mockup).
- Every `i`-icon history indicator (Part 4.3) stays, just sized to fit the now-smaller field layout without overlapping the input or label.

### 11.4 — Row interaction: single-click vs double-click (locked, new behavior)

- **Single click on the row (or its expand chevron)** — toggles the row's expand/collapse state in place. Does not navigate.
- **Double-click anywhere on the row** — navigates to the full `CSNDetailPage` for that CSN (same destination as the expand-row's "Open full detail page" icon button). Match the existing app-wide double-click-opens-detail convention used on other list pages (e.g. `STOListPage.jsx`) — including the paired `openScreen()`/`openScreenWithContext()` + `navigate()` call (continuity rule from earlier in this session — don't regress that).

### Verification checklist (Part 11)
1. Confirm a standard 1366×768 laptop viewport shows materially more rows than before (target: noticeably closer to the "50-100 rows visible without scrolling the page itself" goal — the table's own internal scroll is fine, the surrounding chrome should not eat the space).
2. Confirm every icon-only button (header strip + expand-row header) has a working hover/touch tooltip and no two controls visually overlap at any standard viewport width.
3. Confirm the new Sub CSNs section only appears for rows that actually have sub-CSNs, the Create Sub CSN button works from there, and the delete icon respects the existing ORD/no-STO-link rule.
4. Confirm single-click expands/collapses in place (no navigation) and double-click navigates to CSNDetailPage with proper screen-stack continuity.
5. Confirm the Mother CSN strip shows a clear empty/dash state on mother/independent rows rather than disappearing.
6. Same eslint/build/deno-check/structural-integrity checks as prior parts.

---

## Part 12 — Post-Part-11 live bug round (icon library correction, PO/Balance qty fix, filter/STO gaps, layout fixes)

Business owner tested the Part 11 build live and found multiple real defects. Root causes investigated directly against the live dev DB (`ytapuwiqicmvpanmzelb`) before writing this Part — do not re-investigate root cause for items where it's already stated below, just implement the fix.

### 12.0 — CORRECTION: this project has no icon font (supersedes Part 11's `ti-*` icon instructions)

Part 11 told Codex to use Tabler icon classes (`ti-columns`, `ti-git-branch`, `ti-chevron-up`, etc.). **This was wrong** — `@tabler/icons` (or any icon font/library) is not installed or loaded anywhere in this project (confirmed: no `ti` CSS in `index.html`, no icon package in `frontend/package.json`, no other page in the codebase uses `ti-*` classes). Every icon-only button on the live Tracker rendered as a blank box because the glyph font doesn't exist.

Claude already fixed this directly in `frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx` (commit `b02a65e`) by replacing `IconActionButton`'s `<i className="ti ...">` with short uppercase text labels (SPLIT, OPEN, SAVE, COLLAPSE, DEL, COLUMNS, etc.) and replacing the row expand/collapse chevron with plain `▲`/`▼` characters. **Codex: do not reintroduce `ti-*` icon classes anywhere in this file or any new code for this module.** All future action controls must be short text-label buttons (matching the rest of the app's plain-text convention) or plain Unicode glyphs already proven to render (▲ ▼) — never an icon font class.

### 12.1 — Filter bar: remove vertical gap regression (already fixed, no action needed)

The huge blank gap between the filter row and the data table (seen live) was a regression Claude introduced in the Part 11 footer-positioning fix — CSS Grid's `align-content` defaults to stretch, and the global `ErpScreenScaffold.jsx` content wrapper was made `flex-1` to pin the footer strip, which stretched the row tracks on short-content pages. Already fixed (commit `40ca692`) by adding `content-start` to that grid container. No action needed from Codex; mentioned here only so the history is in one place.

### 12.2 — Company filter needs an explicit "ALL" option

Currently `CSNTrackerPage.jsx`'s Company `<select>` (~line 934-948) only offers "Select company" + the user's assigned companies, and a `useEffect` (~line 508) force-defaults `companyId` to `companyOptions[0]?.value` whenever it's empty — so the user can never actually view all companies at once, unlike the Status and CSN Type filters which both correctly have an "ALL" option (empty-string value, no force-default).

**Fix:**
- Add an explicit `<option value="">ALL</option>` as the first option in the Company select (matching the Status/CSN Type pattern), and rename the placeholder text from "Select company" to "ALL".
- Remove the force-default behavior in the `useEffect` at ~line 508 that overwrites an empty `companyId` with the first company — leave it empty (= ALL) unless the user explicitly picks one.
- `getCSNTracker(...)` / the backend `listCSNsHandler` must support `company_id` being omitted/empty and, in that case, return rows across **all companies the requesting user's ACL/company-scope allows** (not all companies system-wide) — check how other list endpoints in this codebase already do an empty-company_id = "all scoped companies" filter (e.g. check `listPurchaseOrdersHandler` or similar in `po.handlers.ts` for the existing pattern) and reuse it rather than inventing a new scoping rule.

### 12.3 — STO not appearing in tracker for a company filter — confirmed as a real data-linkage gap, not a display bug

Investigated directly in dev DB. Findings:
- `erp_procurement.stock_transfer_order` has STO `ASCSTO2627-0002` (Almega Surface Coats LLP → Jayashree Industries, status `PENDING_APPROVAL`) — confirmed it exists.
- But its `related_csn_id` column is **NULL**, and neither CSN row (`CSN-000001`, `CSN-000003`) has `sto_id` or `consignee_company_id` set.
- This means this particular STO was created through a path that never links back to a CSN — so the Tracker correctly shows nothing for "Company = Jayashree", because no CSN row's `consignee_company_id` is Jayashree. This is not a Tracker bug; it's a gap in whatever screen created `ASCSTO2627-0002` (it bypassed the CSN→STO linkage entirely).

**RESOLVED — not a bug, no fix needed.** Checked `sto.handlers.ts` and the DB's `stock_transfer_order_sto_type_check` constraint: this system has exactly two STO types — `CONSIGNMENT_DISTRIBUTION` (always created from a Sub-CSN via the transform flow, sets `related_csn_id` + the CSN's `sto_id`/`consignee_company_id`) and `INTER_PLANT` (an independent plant-to-plant transfer, Gate-23, deliberately has no CSN link — required for Opening STOs per `STO_OPENING_REQUIRES_INTER_PLANT`). `ASCSTO2627-0002` has `sto_type = 'INTER_PLANT'`, so it correctly has no `related_csn_id` and correctly doesn't appear on the CSN Tracker — the Tracker only tracks `CONSIGNMENT_DISTRIBUTION` STOs. No action item here.

### 12.4 — PO Qty must stop being a mutated per-row allocation slice; add a real "Balance Qty" column

Confirmed via dev DB: PO line `ASCPO2627-0201` line item has `ordered_qty = 100`. After the business owner created a second CSN against the same PO line with `dispatch_qty = 50`, **both** CSN rows now show `po_qty = 50` (split 50/50) — i.e. `consignment_note.po_qty` is being treated as a mutable "this row's current slice of the PO line" by `computeDispatchQtyPreview()` (`csn.handlers.ts` ~line 1007-1060, used by the `/dispatch-qty/preview` and `/dispatch-qty/confirm` endpoints) and `recalculateAndBuildUpdates()`. This matches the business owner's earlier (locked) instruction that GE/GRN must always operate against the PO line's full original ordered qty, not whatever a CSN's `po_qty` currently shows — so `po_qty` silently changing per CSN is actively misleading on the Tracker grid.

**Fix:**
- `consignment_note.po_qty` should always display/store the PO line's full `ordered_qty` for every CSN against that line — stop writing the reconciled "current_qty"/"suggested_qty" slice into `po_qty`. (Check every place `po_qty` is currently set to a computed slice — `computeDispatchQtyPreview`, `recalculateAndBuildUpdates`, the sub-CSN creation/clone path at ~line 581, and the dispatch-qty confirm handler ~line 1942 — and change them to stop mutating `po_qty`; only `dispatch_qty` should be written per the existing locked rule that dispatch_qty starts at 0 and is manually allocated.)
- Add a new **computed (not stored) "Balance Qty"** value per CSN row, shown as a new Tracker column between "PO Qty"/"Order Qty" and "Dispatch Qty": `Balance Qty = po_line.ordered_qty − po_line.knocked_off_qty − SUM(dispatch_qty of all non-knocked-off CSNs against that same po_line_id)`. This must be computed server-side in `listCSNsHandler`/`enrichTrackerRows` (one extra query per distinct `po_line_id` in the result set, or a single batched query, not N+1 per row) and returned as a new field, e.g. `balance_qty`, then added to `buildColumnDefs()` in `CSNTrackerPage.jsx` right after the existing Order/PO Qty column.
- Keep `computeDispatchQtyPreview`'s actual purpose (warning the user if total dispatch_qty across siblings would exceed the PO line's available balance) — just stop conflating that preview math with the stored `po_qty` field.

### 12.5 — Expand-row action buttons and content get clipped off-screen, need horizontal scroll just to see them

Business owner reports that in the expanded row, the per-row action buttons (Split/Save/Collapse/etc.) and some field content are pushed off to the right, requiring a horizontal scroll all the way to the end to see them — they should always be visible at the left without scrolling.

- Audit the expand-row markup in `CSNTrackerPage.jsx` for any wrapping element that allows horizontal overflow without wrapping (e.g. a flex row with `flex-nowrap` and no `min-w-0`/`flex-wrap` on a row that's wider than the visible table viewport, or content sitting inside a table `<td>` that inherits the table's horizontal scroll container from the main grid).
- The expand-row's own header bar and section bodies must render in their own full-width block **below** the scrollable table, not inside a `<td>` that's still subject to the table's horizontal scroll — confirm this is actually the case structurally (it's supposed to be a `colSpan` full-width row per earlier parts; if it currently still scrolls horizontally with the table, that's the bug to fix).
- Buttons specifically must always stay left-aligned/visible without requiring scroll — do not let `flex-wrap` reflow push them past the visible width.

### 12.6 — Expand-row action buttons need keyboard shortcuts

Per this app's existing keyboard-native convention (footer hints like "Enter Open", "Esc Back", "Ctrl+K Command Bar" used elsewhere), add keyboard shortcuts for the expand-row actions while a row is expanded: e.g. `Ctrl+S` = Save, `Esc` = Collapse, `Ctrl+Shift+S` (or similar, avoid clashing with existing global shortcuts in `MenuShell.jsx`/`ErpScreenScaffold.jsx`) = Create Sub CSN. Check `MenuShell.jsx` and `ErpScreenScaffold.jsx` for already-bound global shortcuts before picking keys, to avoid collisions. Show the bound key in each button's `title` tooltip (e.g. "Save (Ctrl+S)").

### 12.7 — "Remarks" section textarea is oversized

The "Remarks"/"Final notes before saving" section's `<textarea>` (~line 1353, currently `rows={3}` but rendering far larger than 3 rows' worth of space in the live build) takes up disproportionate vertical space compared to every other compact field in the expand body. Reduce it to genuinely match `rows={3}` sizing (check for any CSS forcing it taller, e.g. a parent grid/flex stretch — same class of bug as 12.1, the `align-content`/stretch regression may also be affecting this textarea's grid cell since `TrackerSection` is a `grid` container; verify after 12.1's fix is confirmed live whether this is already resolved before changing the textarea itself) and confirm it visually matches the density of the surrounding fields.

### Verification checklist (Part 12)
1. No `ti-*` or any icon-font class anywhere in `CSNTrackerPage.jsx` after this round — only text labels or plain Unicode glyphs.
2. Company filter has a working "ALL" option that does not get force-overwritten, and returns all ACL-scoped companies' CSNs when empty.
3. 12.3 (STO linkage) — resolved as not-a-bug, no action item, nothing to verify.
4. `po_qty` no longer changes value when sibling CSNs are created/edited against the same PO line — confirm by creating a second CSN against a PO line and checking the first CSN's `po_qty` stays at the PO line's full `ordered_qty`.
5. New "Balance Qty" column appears, computed correctly, and updates live as `dispatch_qty` changes across sibling CSNs.
6. Expand-row buttons and all field content visible without horizontal scrolling at a standard 1366×768 viewport.
7. Keyboard shortcuts work while a row is expanded and are shown in tooltips; no collision with existing global shortcuts.
8. Remarks textarea visually matches the density of other compact fields (not oversized).
9. Same eslint/build/deno-check/structural-integrity checks as prior parts.

Commit message should end with `Co-Authored-By: Codex <noreply@openai.com>`.

---

## Part 13 — Second live bug round (dispatch-qty reconciliation logic, domestic field gating, rebate fields, allotted-company default, PO rate/currency)

Investigated directly against the live dev DB / code before writing this Part.

### 13.1 — Dispatch-qty balance prompt must always offer "Create CSN / Knock Off" when there's a remainder, never silently auto-dump it onto an existing sibling

Reproduced the reported bug. Root cause is in `computeDispatchQtyPreview()` (`csn.handlers.ts` ~line 1007-1062):
- `requires_prompt` is only `true` when `remainder > 0 && siblingRows.length === 0` (~line 1061) — i.e. only the *first* time a balance appears, with no other CSN yet against that PO line.
- The moment at least one sibling CSN exists, `requires_reconciliation` becomes `true` instead (~line 1060), and the backend silently computes a `suggested_qty` that dumps the entire remainder onto the **last** sibling CSN (~line 1044-1050: `recipientId = siblingRows[siblingRows.length - 1]`) — so editing a second CSN's dispatch_qty down from 50 to 30 silently proposes bumping the *first* CSN from 50 to 70, instead of asking the user the same "Create CSN for Balance / Knock Off Balance" question it asked the first time.

This is wrong per the business owner: every time a balance/remainder appears on a dispatch-qty edit, the user must always be asked to choose between creating a new CSN for the balance or knocking it off — regardless of whether sibling CSNs already exist. The "reconciliation" editor (manually typing new quantities for multiple existing siblings at once) is a different, separate, manually-invoked action — it must not be the automatic default just because a sibling happens to exist.

**Fix:**
- Change `requires_prompt` to be `true` whenever `remainder > 0`, regardless of `siblingRows.length`. Remove the auto-redistribution of `suggested_qty` onto an existing sibling for this default path.
- Keep `requires_reconciliation` / the manual multi-sibling quantity editor available, but only as an explicit alternate action the user can choose to open from the dialog (e.g. an additional "Manually Reallocate Across Existing CSNs" button next to "Create CSN for Balance" / "Knock Off Balance" in the `dispatchDialog` modal in `CSNTrackerPage.jsx` ~line 1474-1499) — not the default that fires automatically when siblings exist.
- Verify by reproducing the exact reported scenario: PO line ordered_qty 100 → CSN A created with dispatch_qty 50 → CSN B created for the balance with dispatch_qty 50 → edit CSN B's dispatch_qty down to 30 → must show the same "Balance remaining: 20 — Create CSN for Balance / Knock Off Balance" prompt, must NOT silently propose changing CSN A's qty to 70.

### 13.2 — Domestic CSNs must gate off IMPORT-only fields (LC, ETA/ATA at port, BL/BOE)

`CSNTrackerPage.jsx`'s expand-row sections ("Shipment Timeline", "Receiving", and parts of "Documents") currently render LC Number/LC Opened Date, ETA at Port/ATA at Port, BL Number/BL Date, and BOE Number/BOE Date as live editable fields for every CSN regardless of `csn_type` — these are IMPORT-specific (the code already knows this elsewhere: see the `csn_type === "IMPORT"` branches in `evaluateRedFields` ~line 266-319 and the ATD field mapping at ~line 1233). For `csn_type === "DOMESTIC"`, these fields should be inactive (disabled, greyed out, or hidden — match whatever pattern this codebase already uses elsewhere for conditionally-inapplicable fields; check `EditField`/other master pages for an existing "disabled with explanatory tone" convention before inventing a new one).

- LC Number, LC Opened Date — IMPORT only (LC = Letter of Credit, only relevant to import consignments per `purchase_order.lc_required`).
- ETA at Port, ATA at Port, Scheduled ETA Port — IMPORT only (port arrival doesn't apply to domestic LR-based dispatch, which already has its own `lr_date`/`lr_number` under Logistics).
- BL Number, BL Date, BOE Number, BOE Date — IMPORT only (Bill of Lading / Bill of Entry don't exist for domestic moves).
- Keep ETD if it's meaningful for domestic too (check with business owner if domestic uses a dispatch-date-from-vendor concept distinct from LR Date — if it's redundant with LR Date for domestic, disable it too).

### 13.3 — "Has Rebate" / "Rebate Rate" / "Rebate Remarks" have no editable input anywhere

`has_rebate`, `rebate_rate`, `rebate_remarks` exist as read-only **display columns** in `buildColumnDefs()` (~line 225-227) but there is no `EditField` for any of them anywhere in the expand-row body — they can never actually be set by a user. Add them as editable fields in the expand body (a new small section, or add to an existing logical section like "Allocation" or "Documents" — pick whichever groups data most sensibly given the rest of Part 11's section layout): `has_rebate` as a Yes/No select (matching the existing `YES_NO_OPTIONS` pattern used for `soft_copy_received`/`hard_copy_received`), `rebate_rate` as a numeric input, `rebate_remarks` as a text input — and only enable `rebate_rate`/`rebate_remarks` for editing when `has_rebate` is Yes (disable/grey them out when No, consistent with how this app handles conditional fields elsewhere).

### 13.4 — Allotted Company should default to the CSN's own (mother) company until explicitly changed

`buildDraft()` (`CSNTrackerPage.jsx` ~line 172-179) falls back every field to `""` when the row's value is null, including `consignee_company_id` — so the "Allotted Company" select always shows blank/"Select company" instead of visually defaulting to the CSN's own company (`row.company_id`) until the user actively picks a different one, per the business owner's expectation that an unset Allotted Company implicitly means "stays with the mother/owning company."

**Fix:** in `buildDraft()`, default `consignee_company_id` to `row?.consignee_company_id ?? row?.company_id ?? ""` instead of the generic empty-string fallback, so the select visually shows the owning company pre-selected when nothing else has been set. Confirm with the business owner whether this should also write `consignee_company_id = company_id` to the database on save when left at this default (vs. leaving it `null` in the DB and only defaulting visually) — implement the **visual-default-only** version unless told otherwise, since silently writing a value the user never explicitly chose could break "is this CSN actually allotted elsewhere" checks used elsewhere (e.g. STO-eligibility checks in Part 5.7's delete-sub-csn rule).

### 13.5 — Add PO Rate column; Currency column needs a decision first (no currency field exists in the schema)

- **PO Rate**: `erp_procurement.purchase_order_line.unit_rate` exists and is populated — add it to `enrichTrackerRows`'s response (join via the existing `po_line_id` lookup already used for other PO-line-sourced fields) and add a new read-only "PO Rate" column to `buildColumnDefs()`, placed near "Order Qty"/"PO Qty".
- **Currency**: confirmed via direct schema inspection — neither `erp_procurement.purchase_order` nor `purchase_order_line` has any currency column at all. This system currently has no multi-currency support on POs. **Do not invent a currency value or assume INR** — flag this back to the business owner: either (a) all POs are implicitly INR-only today and a "Currency" column should just be a hardcoded display constant for now, or (b) a real `currency_code` column needs to be added to `purchase_order` first (a proper schema change, separate from this Tracker UI work). Do not implement 13.5's currency half until that's confirmed.

### Verification checklist (Part 13)
1. Reproduce the exact dispatch-qty scenario in 13.1 and confirm it now always prompts Create CSN/Knock Off, never silently changes a sibling's qty.
2. Confirm DOMESTIC CSNs show LC/ETA/ATA/BL/BOE fields as inactive, IMPORT CSNs unaffected (still fully editable).
3. Confirm Has Rebate/Rebate Rate/Rebate Remarks are now editable, with rate/remarks disabled when Has Rebate = No.
4. Confirm Allotted Company visually defaults to the owning company on rows where `consignee_company_id` is null, and that nothing gets silently written to the DB beyond what the user explicitly changes.
5. Confirm PO Rate column appears and is correct; Currency column is NOT implemented until the business owner confirms the schema approach.
6. Same eslint/build/deno-check/structural-integrity checks as prior parts.

Commit message should end with `Co-Authored-By: Codex <noreply@openai.com>`.

Commit message should end with `Co-Authored-By: Codex <noreply@openai.com>`.
