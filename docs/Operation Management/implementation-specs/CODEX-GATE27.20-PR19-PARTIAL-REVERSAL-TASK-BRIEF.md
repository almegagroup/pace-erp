# CODEX-GATE27.20-PR19-PARTIAL-REVERSAL-TASK-BRIEF

**Gate:** 27.20
**Domain:** PRODUCTION / INVENTORY
**Title:** Build PR19 (Partial Batch Reversal) + PR20 (Partial Reversal Report)
**Scope:** 1 migration (new tables) + backend handlers + 2 new frontend pages + routes/ACL
**Dependency:** **Gate-27.19 must be implemented and applied first** — this brief depends on `stock_ledger.batch_number`, `packing_order.batch_number`, and `post_stock_movement()`'s new `p_batch_number` parameter all existing. Do not start if Gate-27.19 isn't done.
**Reference doc:** feasibility Section 83.7, subsection **"PR19 — Partial Batch Reversal + PR20 — Partial Reversal Report"** (LOCKED — 2026-07-12) — read this in full before starting, it is the single source of truth for every field, filter, and movement-sequence rule in this brief. Also re-read §104.7 "Reversal Basis" for the exact ratio formula.

**Mandatory — read `CLAUDE.md` in full before starting, specifically:**
- §8A — no raw UUIDs anywhere (R-01): every material/location/batch reference in both new pages must resolve to a human-readable label, bulk-fetched via `.in()`, never a sliced UUID fallback.
- §8B — batch vs sequential DB loops: the reversal movement sequence (Change 4 below) is **DEPENDENT** (order matters — P262 must complete before the immediately-following P261, and both before the RM/PM P262s that derive from them) — write it as a sequential loop with a `// DEPENDENT:` comment explaining why, per the standing rule. Any independent batch reads (e.g. fetching all stock lines for Page 2's list) must be batched, not looped one-row-at-a-time.
- §8C — stock posting document_number/item_number: every `post_stock_movement()` call in one reversal transaction must reuse the **same** business document number (the new Partial Reversal Document's own number, generated once per transaction) — never invent a suffix like `-1`/`-OUT`. The engine's own `item_number` auto-increment already makes this safe to call repeatedly under the same document number.
- MCP vs migration scope — this brief's schema/DDL goes in a migration file; there is no business/operational data to seed via MCP for this brief.

---

## Why this brief exists

CORS (PR15) only supports full-batch reversal. Excess FG, returns, and salvage all need a way to reverse a *partial* quantity of an already-VERIFIED MTO/HPS batch, proportionally splitting Actual (stock) and AP Approved (Reco) reversal using the already-locked Reversal Basis formula, and optionally tag the recovered material for a specific in-progress receiving batch. No such mechanism exists today.

---

## Change 1 — Migration

New tables (design freely within these constraints, following this repo's existing denormalized/COID-style pattern used for `process_order_line_reco`):

- **`erp_production.partial_reversal_document`** (header, one row per reversal transaction): needs at minimum — id, document_number (own series, generate via the same pattern as other document number series in this codebase — do not invent a new numbering scheme without checking how `generateCompanyDocNumber`-equivalent is used elsewhere first), company_id, po_type, source_material_type (SFG or SKU), source_material_id, source_batch_number, source_storage_location_id, reverse_qty, salvage_batch_process_order_id (nullable, FK to `process_order`), created_by, created_at.
- **`erp_production.partial_reversal_line`** (detail, one row per RM/PM/SFG/SKU movement posted in that transaction): needs at minimum — id, partial_reversal_document_id (FK), material_id, line_role (e.g. SOURCE_SFG, SOURCE_SKU, RM, PM), movement_type_code, storage_location_id, qty, actual_qty_component, ap_approved_qty_component (both per the Reversal Basis dual-split — see Change 4), was_checked (boolean, only meaningful for PM lines — records whether that PM line's checkbox was left checked, i.e. whether it actually got reversed or was excluded), created_at.

Idempotent, `IF NOT EXISTS` guards.

---

## Change 2 — PR19 Page 1 + Page 2 backend (lookup)

New handler(s) to:
1. Given Company + PO Type (MTO/HPS only — reject MTS/INT/MTEST with a clear error) + Prodshade + Batch Number, find all matching stock lines. A "matching stock line" is any `stock_ledger`-derived balance (material + storage_location + batch_number, summed) where: `batch_number` matches, the material traces back to that Prodshade (either the SFG itself, or a SKU whose Pack BOM/Prodshade-Pack-Config links back to that Prodshade), stock_type is UNRESTRICTED only, and the summed balance qty is non-zero.
2. Return the 7 locked columns for Page 2's table (Storage Location, Material Type, Prodshade Code/SKU, Description, Batch Number, Available in Pack, Available in Base UOM) — all names/codes resolved, no raw UUIDs.

Batch every material/location resolution — do not loop row-by-row for `.in()`-able lookups (§8B).

---

## Change 3 — PR19 Page 3 backend (detail + salvage-batch list)

1. **If the selected row is SFG:** return the Prodshade's RM/INT lines from the original Process PO batch, with Actual/AP-Approved/Variance computed proportionally: `Reversal Ratio = Reverse Qty ÷ Actual Total Output (of that batch)`, then `Per-line Actual = stored Actual Qty × Ratio`, `Per-line AP Approved = stored AP Approved Qty × Ratio` (read the stored values from that batch's `process_order_line_reco`, per §104.7 — do not re-derive them from scratch). Read-only — this response is display-only, no user edits.
2. **If the selected row is SKU:** return RM (derived the same way, from the *original Process PO's* reco, proportional to the SFG quantity that was consumed into this specific SKU quantity) **and** PM (from the linked Packing PO's own lines) together. Each PM line needs a `default_checked: true` flag (the frontend defaults every PM checkbox to checked; the SFG line itself is not a checkbox line at all — see Change 4).
3. **Salvage Batch Number list:** given the same Company + PO Type + Prodshade family, return all `process_order` rows with status `BATCH_STARTED` (QA_APPROVED already happened, Start Batch clicked, Final not yet saved) — resolved batch numbers, no raw UUIDs.

---

## Change 4 — PR19 submit (the actual reversal posting)

One endpoint that receives: the selected stock line, Reverse Qty, optional Salvage Batch Number (process_order_id), and for SKU rows, the per-PM-line checked/unchecked state.

Generate one new `partial_reversal_document` (own document number). Then post movements — **this exact sequence, DEPENDENT, sequential, with a `// DEPENDENT:` comment**:

**If SFG row:**
1. `P102` — SFG, reverse-qty, out of the source storage location.
2. `P262` — each RM/INT line, proportional qty (per Change 3's ratio), into each material's *original* issue location (from that batch's own process_order_line).

**If SKU row:**
1. `P102` — SKU/FG, reverse-qty, out of F003 (or wherever it was found).
2. `P262` — SFG, reverses the *original* Packing-PO-Final P261 that issued this SFG into packing (same qty, same S003 location) — this brings the SFG back into existence.
3. `P261` — SFG, **immediately following step 2, same qty, same location** — re-issues that SFG as this reversal's own trace-down step. Steps 2 and 3 are deliberate and must both post — do not optimize them into a no-op skip. This is what lets a later audit distinguish "reversal of the original consumption" from "consumption belonging to this reversal."
4. `P262` — each RM/INT line derived from the *original Process PO batch*, proportional qty, into each material's original issue location.
5. `P262` — each **checked** PM line only, proportional qty, into its original `pm_sloc`. Unchecked PM lines get **no movement at all** — record them in `partial_reversal_line` with `was_checked = false` and no `movement_type_code`/no actual posting, for audit visibility only.

Every `post_stock_movement()` call in this whole sequence uses the **same** `partial_reversal_document.document_number` (§8C — the engine's own item_number handles collision-free sequencing, never suffix the document number yourself).

Write one `partial_reversal_line` row per movement actually posted (plus the unchecked-PM audit rows with no movement), each carrying its own `actual_qty_component`/`ap_approved_qty_component` split per the Reversal Basis formula.

Validate before posting: Reverse Qty must not exceed the Available qty shown on Page 2 for that exact batch/location/material — hard 422 if it does.

---

## Change 5 — PR20 Partial Reversal Report

- List handler: one row per `partial_reversal_document`, resolved (Prodshade/SKU label, batch number, Salvage Batch Number's own batch number if tagged, reverse qty, created by/at) — no raw UUIDs, batched resolution.
- Detail/expand handler: all `partial_reversal_line` rows for a given document, resolved.
- Frontend: CSN-tracker-style expandable list (same established pattern as PR16/PR06/etc. in this codebase — reuse the existing shared expandable-row component if one exists, don't build a new one from scratch).

---

## Change 6 — Frontend: PR19 and PR20 pages, routes, ACL

- New `ProductionPO...` or similarly-named PR19/PR20 page files under `frontend/src/pages/dashboard/production/`.
- PR19: 3-page flow matching Page 1/2/3 exactly as specced (Page 1 form → Page 2 single-select list → Page 3 header + qty + line detail + checkboxes + Salvage Batch Number + submit).
- PR20: expandable list page.
- Wire routes in `production.routes.ts`, register new resource codes in `route-acl-registry.ts` reusing existing capability patterns (e.g. `PROD_PO_EDIT`-family or whatever this repo's convention is for production write actions — do not invent a new capability without checking sibling resources first) and register menu entries the same way PR18 was (menu_master + menu_tree parent link under Production — do not repeat the PR18 sidebar-visibility bug, get the `parent_menu_id` right the first time).
- `useQuery`, not `useEffect` + manual fetch, for all data fetching (CLAUDE.md standing rule).

---

## Hard rules

1. MTS/INT/MTEST are explicitly out of scope — reject them with a clear error wherever PO Type is selected, do not silently allow them.
2. No new movement type codes — only P261/P262/P101/P102, reused.
3. The SFG-row-in-SKU-reversal double-posting (P262 then P261, Change 4 step 2+3) must both post — do not collapse them.
4. PM checkbox default is always checked, always manual per-transaction — do not add any `material_master` flag or stored default.
5. No raw UUIDs anywhere in either page (R-01).
6. Reverse Qty validation (≤ Available) is a hard 422, not a warning.

## Out of scope

- Partial return + pack-type-change workflow (separate future brief — may end up calling PR19 as a sub-step, not designed yet)
- BLOCKED→Unrestricted QA release for returns (separate, undesigned)
- MTS/INT/MTEST batch reversal (deferred indefinitely)

## Verification

1. Confirm Gate-27.19's schema/function changes are actually present before starting (`stock_ledger.batch_number`, `packing_order.batch_number`, `post_stock_movement()`'s new parameter).
2. Confirm the exact 5-step SKU-row movement sequence posts in order, under one shared document_number.
3. Confirm Reverse Qty validation blocks over-qty attempts.
4. Confirm unchecked PM lines get zero movements but still appear in the audit trail.
5. Confirm PR20 shows the Salvage Batch Number tag when present.
6. Confirm the new menu entries appear correctly nested under Production (not top-level) on first load — verify this directly, don't assume.
7. `deno check` and `eslint`/`npm run build` clean (only pre-existing shared-typing errors already documented in prior Gate-27 entries, zero new).

## Log + commit

- Append one entry to `docs/Codex-Log.md`
- Do not run git commands
