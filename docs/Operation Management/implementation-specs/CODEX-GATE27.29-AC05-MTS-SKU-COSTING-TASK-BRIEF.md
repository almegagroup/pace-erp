# CODEX-GATE27.29-AC05-MTS-SKU-COSTING-TASK-BRIEF

**Gate:** 27.29
**Domain:** PRODUCTION / COSTING (Accounts ACL)
**TX Code:** AC05 (reused — see "Change 0", the retirement this brief also performs)
**Title:** AC05 "MTS SKU Costing" — Vendor-Code-keyed, effective-dated, manually-entered SKU rate table for MTS (IWC/Powder) dispatch, with an AC04+AC06-derived verification-only cost breakup and an AC06-split-triggered auto row cascade.
**Reference doc:** feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`, **Section 142** — read it in full before writing any code. This brief is the implementation of that lock; if anything here seems to contradict §142, §142 is the source of truth and you should stop and flag it rather than pick one silently.

---

## Before you write any code

1. Read **CLAUDE.md** §8 (Key Architecture Rules), §8A (no raw UUIDs, `useQuery` not `useEffect`+`setState`, bulk-resolve FKs), §8B (batch vs sequential loop rule), §8E (`fetchInChunks` for any unbounded `.in()` id list).
2. Read **feasibility doc §142** in full (this brief's design source) and **§140/§141** (Company Vendor Code / SO01 Vendor Code — the two features AC05 sits directly on top of).
3. You have Supabase MCP access to **Dev** (`ytapuwiqicmvpanmzelb`). Every table/column name below was verified against **live Prod** (`bsjpvkigpllichlknmah`) on 2026-09-24 while writing this brief — re-verify against Dev before writing queries in case Dev has drifted, but do not assume this brief's names are stale just because they came from Prod; Prod and Dev should carry the same schema.
4. **Do NOT touch ACL/menu registration** (`erp_menu.menu_master`, `acl.menu_master`, `acl.capability_menu_actions`, `acl.version_*`, snapshot rebuild) — that is Claude's job via MCP after your code is verified. You only add/remove entries in `supabase/functions/api/_acl/route-acl-registry.ts` (code-level, lives in the repo).
5. Migration file naming: `supabase/migrations/<UTC-timestamp>_gate27_29_ac05_mts_sku_costing.sql`, applied via `mcp__supabase__apply_migration` to **Dev only**, then reconcile `supabase_migrations.schema_migrations` version to match the local filename timestamp (CLAUDE.md §8A), run `node scripts/migration-integrity-check.mjs`, confirm `in_sync = true`. Also run `NOTIFY pgrst, 'reload schema';` after applying (CLAUDE.md §8A's separate PostgREST-cache note) — do not skip this, a prior session lost real time to exactly this gap.
6. Batch independent lookups per §8B; use `fetchInChunks` (`supabase/functions/api/_shared/chunkedIn.ts`) for any `.in()` over an id list that isn't trivially small and bounded (§8E).
7. This is a genuinely large feature (new table, ~8 endpoints, 2 frontend views, a cross-feature trigger hook into AC06). If your context window risks truncating mid-implementation, stop at a clean checkpoint (e.g. "Change 1–3 done, Change 4 not started") rather than half-writing a later change — an unfinished file is worse than an honestly-reported stopping point.

---

## Change 0 — Retire the old AC05 (`mts_sku_monthly_rate`)

**Why:** Gate-27.25 built a *different*, earlier AC05 design (month-wise DRAFT→APPROVED rate chart, no Vendor Code concept at all) against feasibility §114. That design was superseded by the real design discussed later in the same overall session and formally locked as §142 — but the old implementation is still live in the repo, fully wired (table, handlers, routes, ACL registry, frontend page, `tx_code = 'AC05'` already registered in **Prod's** `erp_menu.menu_master`). Leaving both mechanisms in place would mean two different "AC05" pages/tables coexisting — exactly the half-wired outcome to avoid. **Verified 2026-09-24: `erp_production.mts_sku_monthly_rate` has 0 rows in both Dev and Prod** — this is a safe, lossless retirement, not a data migration.

Do all of the following in one pass:
1. **Migration** (can be the same file as Change 1, or a preceding one — your choice): `DROP TABLE IF EXISTS erp_production.mts_sku_monthly_rate;`
2. **Delete** `supabase/functions/api/_core/production/mts_sku_rate.handlers.ts` entirely.
3. **Remove** its route cases from `supabase/functions/api/_routes/production.routes.ts` (currently `GET /api/production/mts-sku-rates`, `POST .../draft`, `GET .../pending-drafts`, `POST .../approve`, `GET .../available-months`) and its import block.
4. **Remove** the 5 `ACC_MTS_SKU_MONTHLY_RATE` entries from `supabase/functions/api/_acl/route-acl-registry.ts`.
5. **Delete** `frontend/src/pages/dashboard/production/MtsSkuMonthlyRatePage.jsx`.
6. **Remove** its import + `<Route>` from `frontend/src/router/AppRouter.jsx` (currently around line 230 / 953).
7. **Remove** the `ACC_MTS_SKU_MONTHLY_RATE` entry from `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` (around line 1048).
8. Leave the old migration file `supabase/migrations/20260731160000_gate27_25_mts_sku_monthly_rate.sql` alone (migration history is append-only — your new DROP migration is what actually retires the table; do not edit or delete the old file).
9. **Do not touch `erp_menu.menu_master`/`acl.menu_master`'s existing `AC05` row** — that's a Claude/MCP job (it will be repointed to the new page's route in the same MCP pass that registers the new AC05, not deleted and recreated).

## Ground truth for reuse — read these before writing anything new

- **Company-scope pattern:** every `_core/production/*.handlers.ts` file in this codebase uses a local `companyScope(ctx, requested)` helper wrapping `assertCompanyScope` (see `vendor_code.handlers.ts` top, `ac07_costing.handlers.ts` top). Copy that exact 4-line pattern into your new file rather than inventing another shape.
- **Access control helper:** `canMaintainCompanyResource(ctx, companyId, resourceCode, action)` (`_shared/companyResourceAccess.ts`) — every AC0x page uses this. New resource code for this brief: **`ACC_AC05_MTS_SKU_COSTING`**.
- **Vendor Code resolution — all of this already exists, reuse it, do not reimplement:**
  - `supabase/functions/api/_core/production/vendor_code.handlers.ts`:
    - `listCompanyVendorCodesForSalesOrderHandler` pattern (line ~321) — same shape you need for AC05's own Vendor Code dropdown (company's mapped codes, Primary first). You may call the existing exported logic directly, or add a thin new handler that returns the same shape — your call, but don't duplicate the query logic.
    - `getEligibleProdshadeIdsForVendorCode(companyId, vendorCodeId)` (line 356) — already exported.
    - `isPrimaryVendorCodeForCompany(companyId, vendorCodeId)` (line 375) — already exported.
    - `resolveVendorCodeForStroke(companyId, strokeMasterId)` (line 387) — **already exported and its own comment literally says "for AC05/dispatch (future consumers)"**. This is exactly the cascade mechanism's Stroke→VendorCode step (§142's cascade step 4). Do not rewrite this logic.
  - **New function you need to add** (same file, same style): `resolveStrokeForProdshadeAndVendorCode(companyId, prodshadeMaterialId, companyVendorCodeMapId): Promise<{ stroke_master_id: string } | null>` — the reverse of `resolveVendorCodeForStroke`. Logic (mirrors what was live-verified against Prod CMP003 data during design):
    - If `companyVendorCodeMapId` is the company's Primary (`isPrimaryVendorCodeForCompany`): find the one `stroke_master` row for `(company_id, prodshade_material_id, po_type='MTS', status='APPROVED')` that has **no** active row in `vendor_code_stroke_override`.
    - Else (non-Primary): find the one `stroke_master` row for the same `(company_id, prodshade_material_id, po_type='MTS', status='APPROVED')` that has an active `vendor_code_stroke_override` row pointing at this exact `companyVendorCodeMapId`.
    - If more than one Stroke matches (should not happen given today's data discipline, but the schema does not enforce it — see §142's own note on this), return the **most recently `approved_at`** one and do not error — this is a deliberate "best effort, never hard-fail a rate-entry Save over a data-hygiene issue that isn't AC05's to fix" choice; log nothing special, just pick one deterministically.
    - If **zero** match, return `null` — the caller (Create-row handler) must then block Save with a clear error ("No approved MTS Stroke found for this Prodshade + Vendor Code combination").
- **SKU ↔ Prodshade resolution — reuse, do not reinvent via `prodshade_pack_config`:**
  - `supabase/functions/api/_core/production/ac07_costing.handlers.ts` has `resolveProdshade(sku: Row): Promise<Row | null>` (line 79) — matches the SKU's own `shade_code` against `material_master` rows with `material_type IN ('SFG','INT')`. **This is the real, already-built, already-correct mechanism** — verified against live Prod data while writing this brief (Prodshade `00790908`, shade_code `0908`, correctly matches 9 real FG SKUs sharing that shade_code). It is currently **not exported** — add `export` to it (same treatment `materialMap`/`packCodeRow`/`resolvePmComposition` in the same file already got, each with a comment explaining which other file reuses it — add the same kind of comment for AC05).
  - The **reverse** direction (Prodshade → all its SKUs, needed for the cascade's step 3) is simply: `material_master WHERE material_type='FG' AND shade_code = <prodshade's own shade_code>`. Do not go through `prodshade_pack_config` for this identity relationship — that table's role is pack-code-level config/prerequisite gating (§83.17), not the SKU-identity mapping.
- **PM composition + per-pack qty:** `resolvePmComposition(skuMaterialId, sku)` (`ac07_costing.handlers.ts`, already exported for AC08 reuse) — returns `{ lines, perPackQtyFixed }` where `lines` includes `is_primary_container` per PM line and `perPackQtyFixed` is the Fixed-BOM OUTPUT row's qty (`null` for non-fixed pack types). Reuse directly for: (a) "does this SKU have an inner pack" (any line with `is_primary_container === true`), (b) the RMC/PMC verification calc's PM cost.
- **Pack code metadata:** `packCodeRow(packCode)` (`ac07_costing.handlers.ts`, already exported) — gives `bom_required`, `outer_uom_code`.
- **Material bulk-resolve:** `materialMap(materialIds)` (`ac07_costing.handlers.ts`, already exported) — `pace_code`/`material_name`/etc., no raw UUIDs in any response (§8A).
- **AC06 rate resolution — the one shared, date-aware resolver, never re-implement date logic:**
  - `resolveAc06RatesAsOf(monthRow, materialIds, asOfDate)` (`ac06_workspace.handlers.ts` line 544, already exported) — takes an `ac06_month` row (`{id, rate_month, status}`, resolved via that table for the target company+month), a list of `material_id`s, and an `asOfDate`; returns `Map<materialId, {rate, wastage_other_pct, costing_group_name, source}>`.
  - **You must resolve the `ac06_month` row yourself first** — query `erp_production.ac06_month` for `company_id` + the month containing your target date (`date_trunc('month', targetDate)`), matching `ac07_costing.handlers.ts`'s own usage pattern (line ~319 in that file). If no `ac06_month` row exists for that month, RMC/PMC for that row simply resolve to `null`/blank on the AC05 list page — do not hard-block the whole page over a missing AC06 month.
  - **§142's explicit rule — do NOT use `wastage_other_pct` from this result.** Only take `.rate`. AC05's own `rm_wastage_pct`/`pack_wastage_pct` (the user-typed ones on the AC05 row itself) are the only wastage figures that enter AC05's formula. This is a deliberate deviation from how AC07 itself uses this same resolved object (AC07 *does* add `wastage_other_pct` into its own cost preview) — do not copy that part of AC07's formula.
- **AC04 Conversion Cost — direct table read, no RPC, no segment guessing (locked 2026-09-24, this is the one point this brief corrects relative to how AC07/Process-PO-Verify do it):**
  - Do **not** call `erp_production.resolve_conversion_rate(...)` (that RPC requires a `segment_code` input, and there is no reliable way to derive which segment_code applies to a given MTS Prodshade — verified against Prod: `material_category` on Prodshades holds brand names like "TRUE CARE"/"SUPPREMA", not IWC/Powder; segment_code is a free-typed field at real Process PO creation with no fixed po_type→segment mapping).
  - Instead, query `erp_production.conversion_cost_config` **directly**: `WHERE company_id = :companyId AND prodshade_material_id = :prodshadeMaterialId AND valid_from <= :effectiveDate ORDER BY valid_from DESC LIMIT 1`. The row's own `segment_code`, `conversion_rate_per_kg`, `margin_cost_per_kg`, `transportation_cost_per_kg` are all you need — sum them for Net Conversion Cost (same formula as `resolve_conversion_rate`'s SQL body: `conversion_rate_per_kg + COALESCE(margin_cost_per_kg,0) + COALESCE(transportation_cost_per_kg,0)`).
  - **Never** fall back to a "segment default" (`prodshade_material_id IS NULL`) row here — MTS has no such default row today, and inventing a fallback to one segment's default would silently misattribute cost. If no Prodshade-specific row matches at all, Conversion Cost for that AC05 row is `null`/blank on the list page (not a hard block on Save — the manual rate is still what matters, this is a verification column only).
- **Dense grid / hotkeys:** `ErpDenseGrid` (`frontend/src/components/data/ErpDenseGrid.jsx`), `useErpScreenHotkeys`. Follow `frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx`'s concrete prop shapes.
- **Company selector:** `frontend/src/components/inputs/TransactionCompanySelector.jsx` — reuse as-is.

---

## Change 1 — Migration: `erp_production.ac05_mts_sku_rate`

```sql
CREATE TABLE erp_production.ac05_mts_sku_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  company_vendor_code_map_id uuid NOT NULL REFERENCES erp_production.company_vendor_code_map(id),
  sku_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  resolved_stroke_master_id uuid REFERENCES erp_production.stroke_master(id), -- nullable ONLY for a PENDING row whose cascade could not resolve a Stroke (should not happen per the cascade's own precondition, but do not make this NOT NULL and risk an insert failure blocking the whole split action)
  rate_per_base_uom numeric,
  rate_per_inner_pack numeric,       -- NULL when the SKU has no inner pack, or not yet entered
  rate_per_outer_uom numeric,        -- THE rate SO actually reads (once status='RATED')
  rm_wastage_pct numeric,            -- optional, carried forward on new pending rows
  pack_wastage_pct numeric,          -- optional, carried forward on new pending rows
  effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'RATED' CHECK (status IN ('PENDING', 'RATED')),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AC06_SPLIT_CASCADE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (company_vendor_code_map_id, sku_material_id, effective_date)
);
CREATE INDEX ON erp_production.ac05_mts_sku_rate (company_id, status);
```
- **Append-only in spirit, not DB-enforced:** a new rate revision is always a new row (new `effective_date`), never an UPDATE of an existing `RATED` row's rate fields. Enforce this in the handler (block editing a `RATED` row's rate/effective_date; only `PENDING → RATED` transition and Wastage-on-a-`PENDING`-row edits are allowed writes after insert). This mirrors AC04/AC06's own append-only convention.
- The `UNIQUE` constraint prevents two rows for the exact same (vendor-code-mapping, SKU, date) — a genuine duplicate/typo re-entry, not a legitimate revision (a revision always gets its own distinct date).

## Change 2 — Backend: `supabase/functions/api/_core/production/ac05_mts_sku_rate.handlers.ts` (new file)

1. **`listAc05RatesHandler`** (`GET /api/production/ac05-mts-sku-rates?company_id=`) — company-scoped list of every row (PENDING + RATED), newest `effective_date` first per SKU. Bulk-resolve: SKU (`pace_code — material_name` via `materialMap`), Vendor Code (via `company_vendor_code_map` → `vendor_code_master`, one bulk `.in()`), plus the verification columns computed per row (see Change 3). **No raw UUIDs in the response** (§8A) — resolve `company_vendor_code_map_id` to `{vendor_code}` and `sku_material_id` to `{pace_code, material_name}` server-side.
2. **`listAc05EligibleSkusHandler`** (`GET /api/production/ac05-mts-sku-rates/eligible-skus?company_id=&vendor_code_id=`) — for the "Create New" row's SKU dropdown: resolve the given `vendor_code_id` to its `company_vendor_code_map_id`, then (mirroring §141's own `getEligibleProdshadeIdsForVendorCode` + SO01's FG-SKU-picker filtering logic) return every MTS-scoped FG SKU for this company whose Prodshade is eligible for this vendor code — Primary → every MTS SKU company-mapped (`material_company_ext` active); non-Primary → only SKUs whose Prodshade is in `getEligibleProdshadeIdsForVendorCode()`'s set. Each row: `{material_id, pace_code, material_name, document_name, has_inner_pack}` — `has_inner_pack` from `resolvePmComposition()`'s `lines.some(l => l.is_primary_container)`.
3. **`createAc05RateRowHandler`** (`POST /api/production/ac05-mts-sku-rates`) — the "Create New" row's Save action. Body: `{company_id, vendor_code_id, sku_material_id, rate_per_base_uom, rate_per_inner_pack, rate_per_outer_uom, rm_wastage_pct, pack_wastage_pct, effective_date}`.
   - Validate `vendor_code_id` is actually mapped+active for this company (`company_vendor_code_map`).
   - Resolve the SKU's Prodshade via `resolveProdshade()`.
   - Resolve the Stroke via the new `resolveStrokeForProdshadeAndVendorCode()` — **hard-block (422) if it returns `null`** ("No approved MTS Stroke found for this Vendor Code + SKU").
   - `rate_per_base_uom` and `rate_per_outer_uom` are mandatory on this path (a manually-created row is always fully rated, never PENDING). `rate_per_inner_pack` mandatory **only if** `has_inner_pack` is true for this SKU (per the eligible-SKUs endpoint's own flag — re-derive it here too, don't trust the client). Wastage % columns stay optional.
   - Insert with `status='RATED'`, `source='MANUAL'`, `resolved_stroke_master_id` = the resolved Stroke's id (frozen — §142's freeze-at-creation-time rule).
4. **`updateAc05PendingRowHandler`** (`POST /api/production/ac05-mts-sku-rates/:id/rate`) — fills in a `PENDING` row's rate (the row the cascade created). Same field validation as create. **Hard-block (409) if the target row is already `RATED`** — a rated row is immutable; a correction is a brand-new row (new effective_date), never an edit of this one. On success flips `status → 'RATED'`.
5. **`deleteAc05PendingRowHandler`** (`POST /api/production/ac05-mts-sku-rates/:id/delete` or a real `DELETE`, your call, match this codebase's existing convention for similar drawers) — **only `PENDING` rows may be deleted** (e.g. the cascade over-generated a row for a SKU that turns out not to actually need this vendor code — flag this as a possible real scenario, not a hypothetical: if a Stroke override changes *after* a cascade already fired, a stale PENDING row could be left over. Hard-block deleting a `RATED` row, no exceptions).
6. **`getAc05PendingCountHandler`** (`GET /api/production/ac05-mts-sku-rates/pending-count?company_id=`) — `{pending_count: number}`, drives the "Create" button's red-dot indicator on the list page.
7. **`resolveAc05RateForSoHandler`** — **build this endpoint now** (it is the natural extension of this same table, matching the old AC05 brief's own precedent of building the future-consumer endpoint alongside the table even though wiring the consumer is a later brief): `GET /api/production/ac05-mts-sku-rates/resolve?company_id=&vendor_code_id=&sku_material_id=&as_of_date=` — resolves `company_vendor_code_map_id` from `vendor_code_id`, then the latest `RATED` row for `(company_vendor_code_map_id, sku_material_id)` whose `effective_date <= as_of_date`, returns `{rate_per_outer_uom, effective_date}` or `404` if none. **This is §142's "AC05 row selection at SO time" rule** — do not let the future SO-consumption brief reinvent this lookup.

## Change 3 — Verification columns (RMC/PMC/Conversion breakup), computed at list-read time, never stored

For every AC05 row (`PENDING` or `RATED`), the list endpoint additionally computes and returns (all under a `verification: {...}` sub-object, clearly separated from the row's own persisted fields so the frontend can never confuse the two):

1. Resolve the row's frozen `resolved_stroke_master_id`'s `stroke_line` rows (`material_id`, `dosage_pct`, filtered to RM/INT — i.e. everything that isn't the Stroke's own header, same as `ac07_costing.handlers.ts` line ~299's `strokeLineRows` query) and the SKU's PM composition (`resolvePmComposition`).
2. Resolve AC06 rates for the union of RM/INT + PM material ids, as of the row's own `effective_date` (per the "AC06 rate resolution" ground-truth section above). Take `.rate` only, ignore `.wastage_other_pct`.
3. `RMC = Σ(dosage_pct/100 × rm_rate)` over the Stroke's RM/INT lines missing no rate (if any material has no resolved rate, RMC is `null`, not a silent partial sum — same "don't lie with a partial number" principle as everywhere else in this codebase).
4. `PMC = Σ(pm_qty × pm_rate) ÷ perPackQtyFixed` for Fixed-BOM SKUs (`perPackQtyFixed` from `resolvePmComposition`); for non-Fixed-BOM (`bom_required=false`) SKUs there is no stored per-pack qty at all (§83.15 — that ratio only exists per-Packing-PO, not at the material level) — **PMC is `null`/"N/A — variable fill" for these SKUs, do not guess a divisor.**
5. Conversion Cost — the direct `conversion_cost_config` read described above, keyed on the SKU's resolved Prodshade + the row's `effective_date`.
6. `Per KG = (RMC × (1 + rm_wastage_pct/100)) + (PMC × (1 + pack_wastage_pct/100)) + Conversion Cost` — if any of RMC/PMC/Conversion is `null`, `Per KG` is `null` too (no partial formula).
7. `Per Inner Pack` / `Per Outer Unit` — derive from `Per KG` using the same Fixed-BOM `perPackQtyFixed`/`material_uom_conversion` factors this SKU already carries (§83.15's auto-synced conversion rows). For a variable-fill SKU, these are `null` — same "no fixed factor to derive from" reasoning as PMC above.
8. Frontend renders these next to the manual `rate_per_base_uom`/`rate_per_inner_pack`/`rate_per_outer_uom` columns, clearly styled as read-only/informational (e.g. muted text, a small "calculated" label) — never in an editable input, and never fed back into any write.

**If you find this per-row computation is too slow doing it live for every list-page render** (N rows × several lookups each), it is fine to batch it (§8B — bulk-resolve all distinct Strokes/SKUs/dates across the whole page in one pass, not N sequential round trips per row) but do **not** cache/store the result on the row — it must always reflect the row's own frozen Stroke + the *current* AC06/AC04 data as of that effective_date, recomputed every read.

## Change 4 — Cascade hook: AC06 split → AC05 pending rows

Hook into `insertAc06RateSplitHandler` (`ac06_workspace.handlers.ts` line 479) — **after** its own `ac06_month_line` insert succeeds, call a new function (put it in the new `ac05_mts_sku_rate.handlers.ts` file and import it into `ac06_workspace.handlers.ts`, not the other way around, to avoid a circular import):

```ts
export async function cascadeAc05RowsFromAc06Split(
  companyId: string,
  materialId: string,          // the split row's own material_id
  slocGroupId: string,         // the split row's own source_sloc_group_id
  effectiveDate: string,       // the split row's own effective_date
  actorUserId: string,
): Promise<void>
```

Logic (§142's cascade, steps 1–4):
1. Find every `stroke_line` row where `material_id = materialId` **and** whose `default_storage_location_id` is an active member of `ac06_sloc_group_member` for `sloc_group_id = slocGroupId`.
2. From those lines' `stroke_master_id`s, load the parent `stroke_master` rows, filtered to `po_type='MTS'`, `status='APPROVED'`, `company_id = companyId`.
3. For each matching Stroke, resolve its Prodshade's downstream SKUs (`material_master WHERE material_type='FG' AND shade_code = <that Stroke's Prodshade's shade_code>` — batch this across all matched Strokes in one query, not per-Stroke, per §8B).
4. For each (SKU × that Stroke's own resolved vendor code, via `resolveVendorCodeForStroke(companyId, strokeMasterId)`) pair: **skip if a row for this exact `(company_vendor_code_map_id, sku_material_id, effective_date)` already exists** (the `UNIQUE` constraint would reject it anyway, but check first so a partial cascade run doesn't throw and abort the rest — use an upsert-with-`onConflict`-ignore, or a pre-check `.in()` + filter, your call). Otherwise insert a `PENDING` row: `rate_per_*` all `NULL`, `rm_wastage_pct`/`pack_wastage_pct` = the latest prior row's values for this same `(company_vendor_code_map_id, sku_material_id)` pair if one exists else `NULL`, `effective_date` = the split's own date, `resolved_stroke_master_id` = that Stroke's id, `source='AC06_SPLIT_CASCADE'`.

**Failure handling:** if the cascade itself throws, do **not** let it roll back or fail the AC06 split insert that already succeeded — log the error (`console.error`, matching this codebase's existing error-logging convention elsewhere — check a nearby handler for the exact call shape) and return normally from `insertAc06RateSplitHandler`. The AC06 split is the source of truth and must not be blocked by a downstream AC05 bookkeeping failure; a missed cascade row is recoverable (someone notices a missing SKU rate later), a blocked AC06 split is not something AC05 should ever be able to cause.

## Change 5 — Frontend

New page, route `/dashboard/production/ac05-mts-sku-costing` (or match whatever path convention the Accounts pages under `frontend/src/pages/dashboard/procurement/accounts/` use if you find AC05 belongs there structurally instead — check how AC04/AC06's own pages are routed and be consistent, don't invent a third convention).

**List page** (the "main page" from §142):
- Company resolves via `TransactionCompanySelector`.
- `ErpDenseGrid` of every row from `listAc05RatesHandler`, columns: Vendor Code, SKU (`pace_code — material_name`), Rate/Base/Inner/Outer (manual, read-only display here — editing only happens via the Create/Edit-Pending flows below), Wastage×2, Effective Date, Status (`PENDING`/`RATED` badge), then the verification columns from Change 3 rendered clearly as read-only/muted, positioned next to their manual counterparts.
- A **"Create" button** (drawer, per §142's UI spec — search bar spanning all columns + Add Row with per-row Edit/Remove, `ErpDenseGrid` inside the drawer) — shows a **red dot** when `getAc05PendingCountHandler`'s `pending_count > 0`.
- Inside the Create drawer, **Add Row** opens a row where the user picks Vendor Code (default Primary) → SKU (from `listAc05EligibleSkusHandler`, filtered live by the selected Vendor Code) → types Base/Inner(if eligible)/Outer rate → optional Wastage×2 → Effective Date. Save calls `createAc05RateRowHandler`.
- **Pending rows** (from the cascade) appear in this same list with `status='PENDING'` — give them an inline "Fill Rate" action that opens the same rate-entry fields pre-filled with the carried-forward Wastage, calling `updateAc05PendingRowHandler` on save.

## Hard rules

1. **Manual rate is always authoritative, calculated verification value never is** — enforce this at the type/response level too: the verification sub-object's fields must never be assignable back into a write payload. This is the single most important rule in this entire brief; re-read §142's "Locked rule, non-negotiable" before implementing Change 3/5.
2. **No raw UUIDs anywhere in the UI** (§8A) — every response resolves Vendor Code / SKU to human-readable fields.
3. **A `RATED` row is immutable** — enforced server-side (`updateAc05PendingRowHandler` hard-blocks on an already-`RATED` target), never just a disabled UI control.
4. **Company scope validated on every handler**, not just the write paths (recurring bug pattern #2 — CLAUDE.md's own checklist).
5. **AC06's `wastage_other_pct` never enters AC05's RMC/PMC** — only `.rate` from `resolveAc06RatesAsOf()`'s result is used.
6. **Conversion Cost never falls back to a segment-default row** — Prodshade-specific `conversion_cost_config` match only, `null` if none exists.
7. **The AC06-split cascade must never fail or roll back the AC06 split itself** — see Change 4's failure-handling note.
8. Follow §8B for every independent lookup in Change 3's per-row verification computation.

## Explicitly out of scope

- **SO01's own consumption of `resolveAc05RateForSoHandler`** — build the endpoint (Change 2 item 7), do not wire an SO01 UI consumer. That is a separate, later brief (same precedent as the old/retired AC05 brief's own explicit scoping of this exact boundary).
- **ACL/menu registration** — Claude's job via MCP (repointing the existing `tx_code='AC05'` row to this new page's route, granting `ACC_AC05_MTS_SKU_COSTING` to the Accounts/Auditor/Director roles per §142's access-control lock) — you only need the `route-acl-registry.ts` entries so routes don't 403 once that's wired.
- **A `RATED` row "reopen" mechanism** — does not exist, per §142's append-only convention (a correction is always a new row). Do not build an unlock/reopen action even as a stretch goal.
- **Any UI on the `ac06_month_line` / AC06 workspace pages themselves** beyond the one cascade hook in Change 4 — do not touch AC06's own frontend.
- **Powder/IWC segment_code plumbing for `conversion_cost_config`** — out of scope; Change 3's direct-Prodshade-match approach deliberately sidesteps needing this resolved at all. Do not "fix" `resolve_conversion_rate`'s segment requirement as a side quest.

## Verification

1. Real Dev/Prod-mirrored data: pick a company + MTS Prodshade with ≥2 downstream FG SKUs and a real `vendor_code_stroke_override` (CMP003's Prodshade `00790908`/`54400908`/`67150912` are real, verified examples from Prod — if Dev doesn't have equivalent data, set up a small matching fixture via MCP before testing, don't test against an empty table).
2. Create a manual AC05 row for a Primary-vendor-code SKU — confirm `resolved_stroke_master_id` lands on the un-overridden Stroke.
3. Create one for a non-Primary vendor code with a real override — confirm it lands on the overridden Stroke.
4. Attempt a SKU/vendor-code combo with **no** matching Stroke — confirm the 422 block.
5. Trigger a real AC06 split (`insertAc06RateSplitHandler`) for a material that's actually used in one of these Strokes' `stroke_line` rows, at a `default_storage_location_id` inside the right `ac06_sloc_group` — confirm the expected `PENDING` AC05 rows appear, with correctly carried-forward Wastage from any prior rows.
6. Fill a `PENDING` row's rate — confirm it flips to `RATED` and disappears from the pending count.
7. Attempt to edit an already-`RATED` row's rate directly (bypass the UI, call the endpoint) — confirm 409.
8. Confirm the verification columns show real, correctly-computed RMC/PMC/Conversion/Per-KG/Per-Inner/Per-Outer numbers for a Fixed-BOM SKU, and cleanly show `null`/"N/A" (not a wrong number, not a crash) for a variable-fill (599/000/001) SKU.
9. `resolveAc05RateForSoHandler` — confirm it returns the correct rate for an `as_of_date` that falls between two effective-dated rows (SO-date resolution, §142).
10. `deno check` clean (compare against the documented pre-existing baseline via `git stash` before/after, per this project's own established discipline).
11. `eslint` clean on every touched/new frontend file.
12. `node scripts/migration-integrity-check.mjs` → `in_sync = true`.
13. Confirm **all 18** `scripts/*.mjs` guards still pass, including `route-acl-registry-guard` (0 missing matches) and `dependency-provisioning-check.mjs --strict-manifest` — add this new page to `PAGE-DEPENDENCY-MANIFEST.json` if that script requires it (check how the retired `MtsSkuMonthlyRatePage.jsx` was listed there and replace that entry, don't just add a new one and leave the old dangling).
14. Confirm the retired old-AC05 routes genuinely 404/are gone (not just unreachable from the UI) — `curl` or equivalent against the removed route paths.

## Log + commit

- Append one entry to `docs/Codex-Log.md` and `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` (Gate-27.29 entry, same format as prior Gate-27.x entries — and explicitly note the Change 0 retirement in that entry, since a future reader needs to know AC05 was rebuilt from scratch, not just extended).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
