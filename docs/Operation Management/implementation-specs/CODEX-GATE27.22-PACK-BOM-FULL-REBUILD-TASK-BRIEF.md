# CODEX-GATE27.22-PACK-BOM-FULL-REBUILD-TASK-BRIEF

**Gate:** 27.22
**Domain:** PRODUCTION
**Title:** Pack BOM (PR05–PR08) full rebuild — company-wise scope, F0xx storage location, UOM conversion auto-sync, mandatory OUTPUT/INPUT rows, flexible-fill handling
**Scope:** 1 migration + rewrite of 1 backend handler file + rewrite/extend 2 frontend pages (PR05 create, PR06 approval). PR07/PR08 (Change Pack BOM / Change Approval) get a smaller follow-on patch, described at the end.
**Dependency:** None for schema/backend. Packing PO's own Standard→Final rebuild (next brief after this one) depends on this being done first — its PM/SFG line auto-population reads Pack BOM.
**Reference doc:** feasibility doc, section **"Pack BOM — Full Design Lock, Session 2 (LOCKED — 2026-07-13)"**, inside §83.15 (`docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`). This is the single source of truth for this brief. The original §83.15 lock (2026-06-30) and its 2026-07-11 correction are still valid background but the 2026-07-13 section **supersedes** the "OUTPUT row Storage Location is user-entered" line specifically — read the strikethrough+correction inline, not the struck text.

---

## ⚠️ Verification findings (2026-07-13, after first implementation pass — commit `003d48a`) — fix these before moving on

Claude reviewed the first implementation pass directly against Dev (schema + code). Two categories of finding:

**Already fixed directly in Dev by Claude — do not redo, just be aware:**
- The migration file (`20260713093000_gate27_22_pack_bom_full_rebuild.sql`) was written and committed but **had never actually been applied to Dev** — `pack_bom.company_id`, `pack_bom_line.storage_location_id`/`movement_type_code`/`is_primary_container`, and `pack_code_master.outer_uom_code` did not exist, meaning every touched endpoint was 500ing. Applied now.
- The migration itself had two bugs, both fixed in the version now live on Dev: (a) the new `pack_code_master_pack_type_check` constraint was added *before* the UPSERT that normalizes existing `CONSUMER`/`DRUM` rows to the new vocabulary, so it failed immediately on existing data — constraint must be added *after* the data normalization, not before; (b) the company-backfill query used `min(mpe.company_id)` on a `uuid` column, which Postgres has no aggregate for — use `(array_agg(mpe.company_id))[1]` instead. If you need to touch this migration again for any reason, keep both fixes.

**Not yet fixed — please fix these:**

1. **`pack_bom.handlers.ts` — `syncPackBomConversions`, the `BOM Required=No` branch:** currently writes `conversion_factor: 1` alongside `variable_conversion: true`. The brief (and the locked design) says no factor value should ever be written here — it should be `conversion_factor: null` (or however this column's NOT NULL-ness, if any, needs to be handled — check the actual column definition; if it truly can't be NULL, flag that back rather than silently writing a misleading `1`, since `1` reads as a real fixed ratio to anyone querying the table later).
2. **`pack_bom.handlers.ts` — `createPackBomHandler` is missing a caller-company-membership check.** The brief said to validate the caller has access to `company_id` the same way other production create handlers do (the established pattern elsewhere in this codebase is checking `erp_map.user_companies` for the caller's `auth_user_id`). This handler currently trusts any `company_id` the caller sends with no membership check at all.
3. **`pack_bom.handlers.ts` — `resolveApprovedStroke()` only selects `default_storage_location_id`, never resolves it to a display object.** `listPackBomEligibleSkusHandler` passes this raw `stroke_master` object straight through to the frontend, and `PackBomCreatePage.jsx`'s Page 2 reads `selectedSku?.stroke_master?.default_storage_location` (note: `_location`, not `_location_id`) — a field that never exists in the response. Result: the INPUT/SFG row's Storage Location column on Page 2 is **always blank**, even though a real location exists. Bulk-resolve `default_storage_location_id` → `{code, name}` (reuse `getStorageLocationMapByIds`, already defined in this same file) and attach it to the `stroke_master` object returned by both `listPackBomEligibleSkusHandler` and (if used there too) `createPackBomHandler`'s own stroke lookup.
4. **`PackBomCreatePage.jsx` — Company field doesn't reuse `TransactionCompanySelector.jsx`.** The brief explicitly said to reuse it (same component `ProductionPOCreatePage.jsx` already uses) rather than build a new company picker; the current page instead hand-rolls a `<select>` off `useCompaniesForOmQuery()` directly. Replace it with `TransactionCompanySelector` for consistency with the rest of the Production module.
5. **`PackBomCreatePage.jsx` — the `PACKING_LABEL` MTO→PMTO/HPS→PHPS/etc. map is a new hardcoded duplicate.** The brief said to find and reuse whatever mapping constant already exists for this (e.g. near `batchTypeMap` in `process_order.handlers.ts` or its frontend equivalent) rather than hardcode a second copy that can drift. Find the existing one and reuse it; if none exists on the frontend side yet, factor the single copy into a shared module both Process PO and Pack BOM pages import, don't leave two independent copies.

---

## Before you write any code

1. Read **CLAUDE.md** in full, especially §8 (Key Architecture Rules), §8A (no raw UUIDs — R-01, `useQuery` not `useEffect`, list endpoints must carry display data), §8B (batch vs sequential loop rule), §8C (stock posting `document_number`/`item_number` rule), and §6's "Sequencing locked 2026-07-11" + the Pack BOM gap note right below it.
2. Read `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` and `OM-CORRECTION-NOTES.md` — do not repeat a mistake already logged there.
3. You have Supabase MCP access to the same Dev project (`ytapuwiqicmvpanmzelb`) used throughout this feasibility doc. **Use it to verify current schema/data before writing migrations or queries** — do not assume a column exists or guess a table shape. Several of the facts in this brief (exact column names, existing helper functions) were themselves confirmed by direct MCP queries during design; re-verify them yourself rather than trusting this document blindly if anything looks off once you're in the code.
4. Do not violate §8B: any new loop over multiple rows doing independent DB work must be batched (`.in()` reads, `Promise.all` independent writes) unless it's genuinely order-dependent, in which case leave it sequential **with a `// DEPENDENT: ...` comment** explaining why.
5. Do not violate §8C: if any new code calls `post_stock_movement()` (it does not, in this brief — Pack BOM itself posts no stock — but double-check before assuming) with a document number, never invent a suffixed variant; that engine handles item numbering itself.

---

## Why this brief exists

Pack BOM (PR05–PR08) was rebuilt once already (Gate-27, listed as complete) but only implemented the **2026-06-30** version of the design: global (non-company-scoped) BOM, single OUTPUT+PM lines, no mandatory SFG INPUT row, storage location fields not addressed at all beyond a placeholder. A 2026-07-13 design session worked through everything that was still unresolved — SKU sourcing/company mapping, exact storage-location authority for both OUTPUT and INPUT rows, where UOM conversion factors live and how they sync, multi-layer packaging, and how FG batch/lot granularity for reporting ties back into Pack BOM. All of it is now locked in the feasibility doc. This brief implements that full lock. Nothing here is still "pending" or "to be decided" — if you hit something that looks undecided, stop and flag it rather than guessing; it likely means you're looking at the wrong section of the doc.

---

## Current state (verified against Dev, 2026-07-13)

- `erp_production.pack_bom` columns: `id, sku_material_id, status, created_by, created_at, approved_by, approved_at, reject_reason`. **No `company_id`.**
- `erp_production.pack_bom_line` columns: `id, pack_bom_id, line_type, material_id, qty, uom_code, has_alternate, material_group_id, display_order`. **No `storage_location_id`, no `movement_type_code`, no "is primary container" flag.**
- `erp_production.pack_code_master` columns: `id, pack_code, pack_name, pack_type, billing_uom, active, created_at, bom_required, description`. **No outer-pack UOM code column.**
- `erp_master.material_uom_conversion` columns: `id (assume), material_id, from_uom_code, to_uom_code, conversion_factor, variable_conversion, created_by` (already has the `variable_conversion` boolean — confirm exact full column list yourself via MCP before writing to it).
- `erp_master.material_plant_ext` columns: `id, material_id, company_id, default_storage_location_id, qa_required_on_inward_override, safety_stock_qty, reorder_point_qty, min_order_qty, lead_time_days, status, created_at, created_by, approved_by, approved_at`. Existing generic handlers: `extendMaterialToPlantHandler` (backend, `om/material.handlers.ts`), `extendMaterialToPlant` + `listMaterialPlantExtensions` (frontend, `om/omApi.js`).
- `erp_production.stroke_master` columns include `po_type` (CHECK: `MTO|HPS|MTS|INT|MTEST`), `default_storage_location_id`, `company_id`, `prodshade_material_id`.
- Current `PackBomCreatePage.jsx`: single FG-SKU combobox (no company field, no type field), auto-adds one hardcoded OUTPUT line (`qty:1, uom_code:"KG"`), PM lines table, no SFG INPUT line at all, no storage location fields anywhere.
- Current `pack_bom.handlers.ts`'s `createPackBomHandler`: validates SKU is `material_type=FG`, checks no existing DRAFT/ACTIVE BOM for that SKU (globally — no company dimension), determines `bom_required` via a join to `pack_code_master.pack_code`, inserts `pack_bom` + a caller-supplied `lines` array verbatim (OUTPUT line included in the array from the frontend, not synthesized server-side).

---

## Change 1 — Migration

New migration file, `supabase/migrations/<timestamp>_gate27_22_pack_bom_full_rebuild.sql`. Everything additive/backward-compatible (no drops of existing DRAFT/ACTIVE rows' meaning — but note Dev currently has zero real Pack BOM rows in active use for this feature, confirm via MCP before assuming you need a backfill).

1. **`pack_bom`:**
   - Add `company_id uuid NOT NULL` (no default — every existing row, if any, will need a value; check via MCP whether any exist and handle accordingly, e.g. backfill from the SKU's sole `material_plant_ext` company if unambiguous, or just note it if the table is empty).
   - Add FK to `erp_master.company` (confirm exact company table name/schema via MCP).
   - Drop any existing unique constraint on `sku_material_id` alone (for the DRAFT/ACTIVE-exists check) and replace the uniqueness enforcement with a partial unique index equivalent to "one DRAFT or ACTIVE pack_bom per (company_id, sku_material_id)" — mirror however the current `createPackBomHandler`'s existing-count check works today (it's an app-level count check, not a DB constraint — check whether to also add a DB-level partial unique index for safety, consistent with how other similar "one active X per Y" rules are enforced elsewhere in this codebase).

2. **`pack_bom_line`:**
   - Add `storage_location_id uuid NULL` (FK to `erp_inventory.storage_location_master`).
   - Add `movement_type_code text NULL` (FK to `erp_inventory.movement_type_master.code`) — will be `P101` for the OUTPUT row, `P261` for the INPUT/SFG row, `NULL` for plain PM lines (PM lines don't get their own movement type here; they're consumed as part of the same P261/P101 pair — confirm this against how Process PO's own RM/PM lines handle movement_type_code, if they store one per line at all, before deciding whether PM lines need `NULL` or should mirror the INPUT/SFG row's `P261`).
   - Add `is_primary_container boolean NOT NULL DEFAULT false` — the new flag from the 2026-07-13 lock. Only meaningful for `line_type='INPUT'` PM lines (not OUTPUT, not the mandatory SFG line itself, which is always effectively "primary" by definition — decide and document whether the SFG line itself needs this flag set true or whether it's implicit; lean toward implicit/not-set since the SFG line's own conversion sync is a separate rule, see Change 2).

3. **`pack_code_master`:**
   - Add `outer_uom_code text NULL` — one fixed code per pack code, the outermost/dispatch unit only (never touched by inner packaging layers, per the lock).
   - Seed all 15 existing rows via a data-only `UPDATE` in this same migration (structural column + its initial seed value both count as schema/system-design config per CLAUDE.md's MCP-vs-migration rule, since this is a fixed catalog value, not ongoing business data):

     | pack_code | outer_uom_code |
     |---|---|
     | 050 | BTL |
     | 110 | BTL |
     | 120 | BTL |
     | 207 | PKT |
     | 210 | BAG |
     | 250 | BTL |
     | 310 | JAR |
     | 320 | JAR |
     | 330 | JAR |
     | 340 | JAR |
     | 350 | JAR |
     | 450 | BBL |
     | 510 | IBC |
     | 599 | BBL |
     | 000 | TANKER |
     | 001 | PKT |

     Confirm each of these 15 pack codes' exact `pack_code` string values via MCP before writing the `UPDATE` (the table above uses the codes as documented in §83.15's original seed table — cross-check against live data, not just the doc, in case Dev's actual seed differs).
   - Confirm whether `BTL`, `PKT`, `BAG`, `JAR`, `BBL`, `IBC`, `TANKER` already exist as valid UOM codes in whatever UOM master table this system uses (`erp_master.uom_master` or similar — find it) — add any missing ones in this same migration if the FK/validation requires it.

4. Do **not** touch `stock_ledger`, `stock_snapshot`, or `post_stock_movement()` in this migration — the 2026-07-13 session explicitly decided to leave the batch-split-snapshot question as-is (ledger-sum-on-demand) for now. That is out of scope for this brief entirely.

---

## Change 2 — Backend rewrite (`pack_bom.handlers.ts`)

### 2.1 `listPackBomEligibleSkusHandler` — new handler, new route

`GET /api/production/pack-boms/eligible-skus?company_id=...&po_type=...`

Returns FG SKUs eligible for a new Pack BOM in this company+type, for PR05 Page 1's SKU dropdown. A SKU is eligible when **both**:
- it has an active `material_plant_ext` row for `company_id`, and
- its underlying Prodshade (resolve the same way `pack_config.handlers.ts`'s existing SKU↔Prodshade derivation works — the SKU's own `shade_code`+`pack_code` matched against `prodshade_pack_config` → linked Prodshade material_id, reuse that exact resolution logic, don't reinvent it) has a `stroke_master` row for the same `company_id` with `po_type = po_type`.

Batch this (§8B) — do not loop per-SKU with awaited queries; fetch the candidate FG SKU set, bulk-resolve `material_plant_ext` for `company_id`, bulk-resolve the Prodshade linkage, bulk-resolve `stroke_master` rows for `company_id`+the resolved Prodshade ids, then filter in memory.

Response items must include resolved `pace_code`/`material_name`/`pack_code` (§8A — no raw UUID list items).

### 2.2 `createPackBomHandler` — rewrite

New required body field: `company_id`. Validate the caller's role has access to that company the same way other production create handlers do (check `ProductionPOCreatePage.jsx`'s own backend counterpart for the pattern — likely `erp_map.user_companies` membership check, same one already fixed for Opening Stock and confirmed as the standing pattern this session).

Auto-synthesize the two mandatory rows server-side — **do not trust the caller to supply OUTPUT/SFG-INPUT lines** (this fixes the real gap flagged in CLAUDE.md's Pack BOM note):

1. **OUTPUT row:** `line_type='OUTPUT'`, `material_id=sku_material_id`, `qty` = `1` if `bom_required` else `null`, `uom_code` = the SKU's own `pack_code`'s `outer_uom_code` (from Change 1), `storage_location_id` = **the F-prefixed location the caller must supply for this specific create call** (see 2.3 for how the frontend sources the option list) — validate server-side that the supplied `storage_location_id` really is (a) mapped to this SKU+company via `material_plant_ext`, and (b) its resolved `storage_location_master.code` starts with `F`. Reject with a clear 422 otherwise. `movement_type_code='P101'`.
2. **INPUT/SFG row:** `line_type='INPUT'`, `material_id` = the resolved Prodshade material id (same resolution as 2.1), `qty` = derived from the caller's PM lines only when `bom_required` (see below) else `null`, `uom_code='KG'`, `storage_location_id` = looked up server-side from that company's `stroke_master.default_storage_location_id` for that Prodshade (**read-only from the caller's point of view — if the body includes one for this line, ignore it**, don't trust client input for a value that's supposed to be system-derived), `movement_type_code='P261'`.
3. **PM lines:** as today, from the caller's `lines` array, but each may now carry `is_primary_container` (boolean, default false).

**Qty derivation when `bom_required=true`:** the SFG INPUT row's qty must be provided by the caller (Procurement enters "KG per outer pack" on the frontend, per the existing PR05 spec) — validate it's a positive number. When `bom_required=false` (599/000/001), force both OUTPUT and SFG-INPUT qty to `null` regardless of what the caller sends (the "Calculated at Packing PO" rule — no fixed qty ever stored here).

Keep the existing `bom_required` lookup logic (join to `pack_code_master.pack_code`) and the existing DRAFT/ACTIVE-exists guard — just add `company_id` into both.

### 2.3 F-location option source for the OUTPUT row (backend support, used by the frontend)

Reuse the existing `listMaterialPlantExtensions(materialId)` endpoint/handler as-is (it already returns all `material_plant_ext` rows for a material) — the frontend will call it, filter client-side to the selected `company_id`, then bulk-resolve each row's `default_storage_location_id` and keep only ones whose `storage_location_master.code` starts with `F`. If that handler doesn't currently resolve the location's `code`/`name` (check — it may only return raw `default_storage_location_id`), extend it to bulk-resolve storage location display fields (§8A) rather than building a second endpoint.

### 2.4 `approvePackBomHandler` — add conversion auto-sync

After the existing line-replace-and-approve logic, when `bom_required=true` for this BOM's SKU:

1. Compute the OUTPUT→KG factor: the just-approved SFG INPUT line's `qty` (KG per one outer pack unit — OUTPUT qty is always 1 for these types, so the SFG line's qty *is* the factor).
2. Upsert one `material_uom_conversion` row on the SKU: `from_uom_code` = the OUTPUT row's `uom_code` (the pack code's `outer_uom_code`), `to_uom_code='KG'`, `conversion_factor` = that value, `variable_conversion=false`. Use `onConflict` on whatever unique key `material_uom_conversion` actually has (check — likely `(material_id, from_uom_code, to_uom_code)`) so re-approving an edited BOM updates rather than duplicates.
3. For every PM line flagged `is_primary_container=true`: upsert a second `material_uom_conversion` row on the **SKU** (not the PM material) with `from_uom_code` = that PM line's own `uom_code` (e.g. the Pouch's unit), `to_uom_code='KG'`, `conversion_factor` = SFG-INPUT-qty ÷ that PM line's qty, `variable_conversion=false`.

When `bom_required=false`, this auto-sync doesn't run at approve time (there is no PR06 approve step for these — see 2.5) — it runs once at create/auto-ACTIVE time instead.

### 2.5 `createPackBomHandler`, auto-ACTIVE branch (`bom_required=false`)

When the SKU's pack code has `bom_required=false`: after inserting the BOM as `ACTIVE` (existing behavior), also upsert a `material_uom_conversion` row on the SKU: `from_uom_code` = the pack code's `outer_uom_code`, `to_uom_code='KG'`, `conversion_factor=NULL`, `variable_conversion=true`. No factor value ever gets written here — only the flag.

### 2.6 `listPackBomsHandler` / `getPackBomHandler`

Add `company_id` to the list filter and to every response row's display data (resolve company name, don't show raw id — §8A). `getPackBomHandler`'s line response should include resolved storage location display (code/name) and the `is_primary_container` flag per line.

---

## Change 3 — Frontend: `PackBomCreatePage.jsx` (PR05) full rewrite

Rebuild as a 2-page flow matching PR09's own established pattern (reuse `TransactionCompanySelector.jsx` — already used by `ProductionPOCreatePage.jsx`, don't build a new company picker):

**Page 1 (identify):**
- Company — `TransactionCompanySelector`.
- Type — combobox: MTO / HPS / MTS / MTEST. Selecting it resolves the display-only Packing PO Type label (PMTO/PHPS/PMTS/PTEST — reuse whatever mapping constant already exists for this in the codebase, e.g. near `batchTypeMap` in `process_order.handlers.ts` or its frontend equivalent — search before hardcoding a second copy).
- FG SKU — combobox, options from the new `GET /api/production/pack-boms/eligible-skus?company_id=&po_type=` endpoint (Change 2.1), refetched (`useQuery`, not `useEffect`) whenever Company or Type changes.
- "Next" advances to Page 2 once all three are chosen.

**Page 2 (define BOM):**
- Header (read-only): Company, Type, SKU (resolved pace_code — material_name), Base UOM (always KG, just display it), and whether this pack code is `bom_required` (fetch this alongside SKU details, e.g. via the SKU's own material detail or a small lookup — display it so the user understands which mode they're in).
- **OUTPUT row (display, mostly read-only):** Material = SKU (read-only). Qty = `1` if `bom_required` else literal text `"Calculated at Packing PO"` (not an editable field). UOM = the pack code's `outer_uom_code` (read-only, fetched from pack code master via the SKU). **Storage Location — a combobox restricted to this SKU's F-prefixed `material_plant_ext` locations for the selected company** (Change 2.3's data source) — if exactly one option, auto-select it and show it read-only (no dropdown chrome) rather than a 1-item dropdown.
- **INPUT/SFG row (display, fully read-only):** Material = resolved Prodshade name (fetch via the same resolution the backend uses — either add a small "resolve" response to the eligible-skus endpoint or a dedicated lookup, whichever is less duplicative). Qty = if `bom_required`, an **editable** numeric field (this is the one qty Procurement actually enters — "KG per outer pack unit"); else literal `"Calculated at Packing PO"`. UOM = KG (read-only). Storage Location = read-only, fetched from that company's Stroke Master default location for this Prodshade (find/reuse whatever existing endpoint already exposes a Stroke's `default_storage_location_id` by company+material — do not invent a new one if one exists).
- **PM lines table:** reuse `PackBomLinesTable` (`strokeShared.jsx`) but add a new column/checkbox **"Is Primary Container?"** per line, wired to the new `is_primary_container` field. Keep the existing Has Alternate / Material Group / inline group-create flow as-is.
- Submit button — for `bom_required=true` SKUs, label it "Submit for Approval (PR06)"; for `bom_required=false`, label it "Save (Activates Immediately)" and show the auto-ACTIVE confirmation on success (existing `auto_approved` response flag already supported, keep that toast logic).
- `useQuery`/`useQueryClient` throughout (§8A) — the current page already does this correctly for its mutation, keep that pattern, just extend the query set for the new Page 1 fields.

---

## Change 4 — Frontend: `PackBomApprovalPage.jsx` (PR06)

Existing expandable-row list stays structurally the same. Add:
- Company column/filter (now that BOMs are company-scoped).
- Show the OUTPUT/INPUT mandatory rows (currently probably filtered out or not distinctly rendered — check) with their resolved storage location, alongside the existing editable PM lines.
- Show the "Is Primary Container?" flag per PM line (editable here too, since the Manager can edit lines before approving — matches the existing "edit PM lines before approving" rule).
- No change needed to the approve/reject action wiring itself — the conversion auto-sync (Change 2.4) happens entirely server-side inside the existing approve call.

---

## Change 5 — PR07/PR08 follow-on (smaller patch, do after 1–4 are verified)

`ChangePackBomPage.jsx` / `ChangePackBomApprovalPage.jsx` and their handlers need the same `is_primary_container` field added to their change-line shape (ADD/EDIT actions), so a change request can toggle it and have Change 2.4's conversion re-sync apply after PR08 approval too. Company scoping doesn't need separate handling here since PR07/08 operate on an already-company-scoped `pack_bom` row. Confirm whether PR08's approve path should also re-run the Change 2.4 auto-sync (yes — any time the SFG-INPUT qty or a primary-container PM line's qty changes via a change request, the derived conversion factor is now stale and must be re-derived) — wire that in.

---

## Hard rules

1. Every list/detail response resolves display names — no raw UUIDs anywhere in either page (§8A, R-01).
2. `useQuery`/`useQueryClient` only — no `useEffect`+manual fetch for data loading (§8A).
3. Any new multi-row loop must be batched per §8B unless genuinely order-dependent (none of this brief's writes are order-dependent — OUTPUT/INPUT/PM row inserts are all independent of each other within one BOM).
4. Do not touch `stock_ledger`, `stock_snapshot`, or `post_stock_movement()` — out of scope, explicitly deferred.
5. Do not build any "PACK"-type batch series or touch `erp_production.batch_number_series` — flexible-fill factors live only on `packing_order.fill_qty_per_pack`/`num_packs` (that table/columns already exist; this brief does not touch `packing_order` at all — it's Pack BOM only).
6. `outer_uom_code` on `pack_code_master` only ever holds the outermost/dispatch unit — never model inner packaging layers there, even if you find a SKU with 3+ layers. Inner layers are PM lines, full stop.
7. If you cannot find an existing helper/endpoint this brief tells you to reuse (Prodshade↔SKU resolution, Stroke default-location-by-company-and-material lookup, PMTO/PHPS/PMTS/PTEST type-mapping constant), say so explicitly in your implementation log rather than guessing a new implementation that might duplicate or diverge from the real one.

## Out of scope

- Packing PO's own rebuild (next brief).
- `stock_snapshot` batch-split (explicitly deferred, 2026-07-13 decision: leave as ledger-sum-on-demand).
- PID design for FG (not yet formally designed).
- SO↔FO link (`sales_order_line.fo_id`) — deferred to the Dispatch (L5) formal session.
- Any Dispatch/L5 work.

## Verification

1. Create a `bom_required=true` SKU's Pack BOM end-to-end as DIRECTOR (full access in Dev, confirmed): Page 1 Company→Type→SKU, Page 2 shows OUTPUT+INPUT rows with correct auto storage locations (F-location single-option auto-selected; if you seed a SKU with 2+ F-locations mapped, confirm the dropdown actually restricts to just those two, not all locations), enter SFG qty, add at least one PM line flagged "Is Primary Container", submit → DRAFT.
2. Approve it via PR06 → confirm `material_uom_conversion` now has both the OUTPUT-unit→KG row (`variable_conversion=false`) and the primary-container PM line's own →KG row, with the correct derived factors.
3. Create a `bom_required=false` (599/000/001) SKU's Pack BOM → confirm it auto-ACTIVEs with no PR06 step, OUTPUT/INPUT qty show "Calculated at Packing PO" not an editable field, and `material_uom_conversion` gets a `variable_conversion=true` row with `conversion_factor=NULL`.
4. Confirm a SKU with zero `material_plant_ext` rows for the chosen company never appears in Page 1's SKU dropdown, and a SKU whose Prodshade has no `stroke_master` row of the matching `po_type` for that company also doesn't appear.
5. Confirm a SKU with zero F-prefixed `material_plant_ext` locations for the chosen company blocks BOM creation with a clear error (not a silent empty dropdown).
6. `deno check` and frontend build clean (only pre-existing shared-typing errors already documented in prior Gate-27 log entries, zero new).

## Log + commit

- Append one entry to `docs/Codex-Log.md` and to `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` (Gate-27.22 entry, same format as 27.19–27.21).
- Commit message/co-author trailer per this repo's standing convention (`Co-Authored-By: Codex`).
- Do not push.
