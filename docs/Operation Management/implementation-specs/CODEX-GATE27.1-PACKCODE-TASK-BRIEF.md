# CODEX-GATE27.1-PACKCODE-TASK-BRIEF

**Gate:** 27.1
**Domain:** PRODUCTION
**Title:** Pack Code Master — fix route ACL blackout, fix broken upsert, redesign Prodshade Pack Config UI, add Tab 1 create/edit
**Dependency:** Gate-27 core + extension (already merged)
**Design reference:** `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md` — Section 83.17, the **2026-06-30 LOCKED update** (search for "Tab 1 — Pack Code Catalog" and "Tab 2 — Prodshade Pack Config (LOCKED — 2026-06-30)"). Treat that section as ground truth over anything else.

---

## Why this brief exists (root cause, already diagnosed — do not re-investigate)

Live walkthrough of `SAPackCodeMasterPage.jsx` found three independent bugs stacked on the same page:

1. **Every `/api/production/*` route is completely absent from `supabase/functions/api/_acl/route-acl-registry.ts`.** The pipeline (`_pipeline/runner.ts` line ~412) has a hard rule: any route not found in the registry throws `ROUTE_ACL_NOT_REGISTERED` and returns HTTP 500 — for every role, including SA. This is why "Pack Code Catalog" shows "No pack codes found" even though 16 rows exist in `erp_production.pack_code_master` — the API call 500s and the frontend silently swallows the error into an empty list.
2. **`upsertPackConfigHandler` in `pack_config.handlers.ts` calls `.upsert(..., { onConflict: "material_id,pack_code_id" })` but `erp_production.prodshade_pack_config` has no unique constraint on those columns at all** (confirmed via `information_schema.table_constraints` — only a PK on `id` and two FKs exist). PostgREST rejects an `on_conflict` target that isn't backed by a real unique constraint/index. **Every save on Tab 2 currently fails at the DB level**, independent of bug #1.
3. **`SAPackCodeMasterPage.jsx` Tab 2 asks the user to paste a raw Material UUID** for "Prodshade" (filter box, drawer field, and table column). The locked design explicitly shows this as a dropdown/search ("Prodshade: [dropdown — globally approved prodshades]"). This also violates the project's standing rule that no raw UUID may ever be shown in the UI (`CLAUDE.md` Section 8A).

Additionally the locked design (2026-06-30) expects **Tab 1 to support SA Add + Edit** ("SA can add new codes or edit existing"), not just the toggle that exists today.

**Constraint for this task:** `erp_production.stroke_master` currently has **zero rows** in dev (no strokes created yet). The "approved prodshade" list will be empty today — that is expected and correct. Build the feature so it activates cleanly the moment a stroke gets approved; do not hardcode or fake data to make it look populated.

---

## Scope boundary

Fix the **entire route-acl-registry gap for all of `/api/production/*`** (not just pack-codes/pack-configs) — this single gap blocks every production page (Stroke Master, Process PO, Packing PO, Plan Feed, Batch Series, Segment Location, everything), and it is far cheaper to close it once, now, than to rediscover it page by page. Everything else in this brief is scoped tightly to Pack Code Master only — do not touch Stroke Master, Process Order, or Packing Order business logic.

---

## Part A — Route ACL registration (unblocks all of Production)

### A1. Register every `/api/production/*` route in `route-acl-registry.ts`

Open `supabase/functions/api/_routes/production.routes.ts` and enumerate **every** `routeKey` handled by `dispatchProductionRoutes` (both the static `switch` block and every regex-matched parameterized route). For each one, add an entry to `EXACT_ROUTE_ACL` in `route-acl-registry.ts` (pattern-match via `PATTERN_ROUTE_ACL` for the `/:id` routes, following the existing style already used for procurement/OM routes in that same file — copy the idiom, don't invent a new one).

**resourceCode mapping rule:** map each route to the `menu_code` that already governs the page which calls it (cross-reference `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` and `frontend/src/admin/sa/screens/adminScreens.js` for the screen that owns each API). Concretely:

| Route group | resourceCode |
|---|---|
| `/api/production/pack-codes*` | `SA_OM_PACK_CODE_MASTER` |
| `/api/production/pack-configs*` | `SA_OM_PACK_CODE_MASTER` |
| `/api/production/batch-series*` | `SA_PROD_BATCH_SERIES` |
| `/api/production/segment-locations*` | `SA_PROD_SEGMENT_LOCATIONS` |
| `/api/production/stroke-masters*` | `PROD_STROKE_MASTER` (list/get/create) and `PROD_STROKE_APPROVAL` (approve/revert) |
| `/api/production/plan-feed*` | `PROD_PLAN_FEED` |
| `/api/production/process-orders*` | `PROD_PO_CREATE` (create), `PROD_PO_EDIT` (lines patch), `PROD_QA_QUEUE` (qa-approve/qa-reject), `PROD_BATCH_RELEASE` (start-batch), `PROD_PO_FINAL` (finalize), `PROD_PO_VERIFY` (verify), `PROD_REVERSAL` (reverse), `PROD_ORDER_LIST` (list/get) |
| `/api/production/packing-orders*` | same pattern as process-orders, reuse `PROD_PO_CREATE`/`PROD_PO_EDIT`/`PROD_PO_FINAL`/`PROD_REVERSAL`/`PROD_ORDER_LIST` |
| `/api/production/stroke-change-requests*` | `PROD_CHANGE_BOM_ITEM` (create), `PROD_CHANGE_BOM_ITEM_APPROVAL` (approve/reject) |
| `/api/production/pack-boms*` | `PROD_PACK_BOM_CREATE` (create), `PROD_PACK_BOM_APPROVAL` (approve/reject) |
| `/api/production/pack-bom-change-requests*` | `PROD_CHANGE_PACK_BOM` (create), `PROD_CHANGE_PACK_BOM_APPROVAL` (approve/reject) |

**action mapping rule:** GET → `VIEW`, POST that creates → `WRITE`, PATCH → `EDIT`, DELETE → `DELETE`, approve/reject/qa-approve/qa-reject/verify → `APPROVE`.

### A2. Verify every resourceCode used above actually exists in `acl.menu_master`

Run this against the dev DB (Supabase project `ytapuwiqicmvpanmzelb`) and list any resourceCode from the table above that returns zero rows:

```sql
SELECT menu_code FROM acl.menu_master WHERE menu_code IN (
  'SA_OM_PACK_CODE_MASTER','SA_PROD_BATCH_SERIES','SA_PROD_SEGMENT_LOCATIONS',
  'PROD_STROKE_MASTER','PROD_STROKE_APPROVAL','PROD_PLAN_FEED','PROD_PO_CREATE',
  'PROD_PO_EDIT','PROD_QA_QUEUE','PROD_BATCH_RELEASE','PROD_PO_FINAL','PROD_PO_VERIFY',
  'PROD_REVERSAL','PROD_ORDER_LIST','PROD_CHANGE_BOM_ITEM','PROD_CHANGE_BOM_ITEM_APPROVAL',
  'PROD_PACK_BOM_CREATE','PROD_PACK_BOM_APPROVAL','PROD_CHANGE_PACK_BOM','PROD_CHANGE_PACK_BOM_APPROVAL'
);
```

As of this brief being written, **`SA_PROD_BATCH_SERIES` and `SA_PROD_SEGMENT_LOCATIONS` are confirmed MISSING** from `acl.menu_master`. For any resourceCode missing (this includes those two, and any other you find), write a new migration `supabase/migrations/20260710XXXXXX_gate27_production_acl_gap_fill.sql` that:
- Inserts the missing row(s) into `erp_menu.menu_master` (if not already there — check first) and `acl.menu_master` (`menu_code` = `resource_code`, per `CLAUDE.md` Section 8 rule)
- Grants the resource's actions to the same capabilities already used for sibling production pages (`CAP_PROD_OPERATOR` for VIEW/WRITE, Manager+ tier for APPROVE/DELETE — mirror exactly how `PROD_STROKE_MASTER` is configured in `acl.capability_menu_actions` today, since SA_PROD_BATCH_SERIES/SEGMENT_LOCATIONS are documented as "SA + Manager+" access)
- Follow the existing pattern from `supabase/migrations/20260706020000_gate27_production_acl.sql` exactly (same style of insert, same `version_role_capabilities` / `version_work_context_capabilities` / `version_capability_menu_actions` backfill for all 4 ACL versions)

**Do not apply this migration yourself** — create the file only. Claude will apply it via MCP to dev and verify, then it ships to prod via normal migration deploy.

---

## Part B — Backend fixes (`pack_config.handlers.ts`, `production.routes.ts`)

### B1. Fix the broken upsert in `upsertPackConfigHandler`

Do **not** rely on PostgREST's `.upsert(..., { onConflict })` — there is no matching unique constraint and Postgres NULL semantics make a literal unique constraint on `(material_id, pack_code_id, variant, fill_qty)` unreliable for dedup when `variant`/`fill_qty` are NULL (Postgres treats each NULL as distinct, so two NULL-variant rows with the same fill_qty would NOT be caught by a plain UNIQUE constraint).

Replace with explicit check-then-write:
1. `SELECT id FROM prodshade_pack_config WHERE material_id = :materialId AND pack_code_id = :packCodeId AND COALESCE(variant,'') = COALESCE(:variant,'') AND COALESCE(fill_qty,-1) = COALESCE(:fillQty,-1)`
2. If a row exists → `UPDATE ... SET fill_qty = :fillQty, active = true WHERE id = :existingId`
3. If no row exists → plain `INSERT`
4. Keep the existing FG Material Auto-Create block unchanged (it already works and matches the design's "On link → FG Material Master auto-created" rule) — just move it to fire after either the insert or the update branch, same as today.

Also add a real DB-level guard against exact duplicates (defense in depth, not the primary dedup mechanism): in the new migration file from A2 (or a separate migration if you prefer — your call), add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS prodshade_pack_config_dedup_idx
  ON erp_production.prodshade_pack_config (material_id, pack_code_id, COALESCE(variant, ''), COALESCE(fill_qty, -1));
```

This index is NOT referenced by the app's `onConflict` — it's a safety net only, since the app now does check-then-write.

### B2. Add delete safety check to `deletePackConfigHandler`

Per locked design: "SA cannot delete a linked pack code if a Pack BOM (PR06) or Packing PO already exists for that SKU." Before deleting, look up the config row's `material_id` + `pack_code_id`, resolve the FG SKU material (via the same `shade_code`/`pack_code` join logic already used in the auto-create block), and check:
- `erp_production.pack_bom` — any row referencing that FG material_id → block with a new error code `PROD_PACK_CONFIG_DELETE_BLOCKED_BOM_EXISTS`
- `erp_production.packing_order` — any row referencing that FG material_id → block with `PROD_PACK_CONFIG_DELETE_BLOCKED_PO_EXISTS`

If neither exists, proceed with delete as today.

### B3. Add `createPackCodeHandler` and `updatePackCodeHandler`

Design (2026-06-30 lock): "SA can add new codes or edit existing." Currently only `togglePackCodeHandler` exists. Add:
- `POST /api/production/pack-codes` → create: body `{ pack_code, pack_name, pack_type, billing_uom, bom_required, description }`. Validate `pack_code` is unique (case-sensitive exact match against existing rows) — return `PROD_PACK_CODE_EXISTS` (409) on conflict. `assertSARole`.
- `PATCH /api/production/pack-codes/:id` → edit: same fields except `pack_code` itself is immutable once created (it's baked into SKUs) — only allow editing `pack_name`, `pack_type`, `billing_uom`, `bom_required`, `description`. `assertSARole`.

Wire both into `production.routes.ts` and register both in `route-acl-registry.ts` (resourceCode `SA_OM_PACK_CODE_MASTER`, action `WRITE`/`EDIT`).

### B4. Add `listApprovedProdshadesHandler`

New handler, new route `GET /api/production/prodshades`. Returns the list that populates the Tab 2 dropdown — "globally approved prodshades" per design, defined as: distinct materials that have **at least one `stroke_master` row with `status = 'ACTIVE'`**.

```sql
SELECT DISTINCT m.id AS material_id, m.shade_code, m.material_name, m.external_code
FROM erp_production.stroke_master sm
JOIN erp_master.material_master m ON m.id = sm.prodshade_material_id
WHERE sm.status = 'ACTIVE'
ORDER BY m.shade_code
```

Return `{ material_id, shade_code, material_name, external_code }[]`. This will legitimately return an empty array today (no strokes exist yet) — that is correct, not a bug. `assertProdReadRole`. Register route in `route-acl-registry.ts`, resourceCode `SA_OM_PACK_CODE_MASTER`, action `VIEW`.

---

## Part C — Frontend redesign (`SAPackCodeMasterPage.jsx`)

### C1. Tab 1 — Pack Code Catalog: add Create + Edit

- Add an "Add pack code" button opening a small form/drawer (same `DrawerBase` component already used for Tab 2's config drawer) with fields: Pack Code (text, required, uppercase-on-blur), Description, Pack Type (select — reuse whatever enum values already exist in the 16 seeded rows: CONSUMER/DRUM/BARREL/IBC/TANKER/MTEST), Billing UOM (PER_UNIT/PER_KG), BOM Required (checkbox).
- Add an "Edit" action per row opening the same form pre-filled, with Pack Code field disabled/read-only (immutable per B3).
- Keep the existing Activate/Deactivate toggle as-is.
- Call the new `createPackCode`/`updatePackCode` functions (add to `prodApi.js` alongside the existing `listPackCodes`/`togglePackCode`).

### C2. Tab 2 — Prodshade Pack Config: replace every raw-UUID surface

1. **Filter field** ("Filter by Prodshade (Material ID)") → replace the raw text input with a searchable combobox backed by the new `GET /api/production/prodshades` endpoint. Type-ahead filters client-side on `shade_code`/`material_name` (the list will be small — no need for server-side search debouncing). Selecting a prodshade sets the filter and re-queries `listPackConfigs({ material_id })`.
2. **Table column "Prodshade (Material ID)"** → remove the raw UUID slice-and-ellipsis rendering. Instead, since a single prodshade is always selected via the filter before configs are shown, drop this column entirely and show the selected prodshade's `shade_code — material_name` in a small banner above the table (not per-row, since every row shares the same prodshade once filtered).
3. **Add Config drawer, "Prodshade Material ID" field** → replace the raw UUID text input with the same combobox component from step 1, pre-filled with whatever prodshade is currently selected in the page filter (matches existing `openAddConfig()` behavior of seeding `material_id: filterMaterialId`), but now showing `shade_code — material_name` instead of a UUID.
4. **When the prodshade list is empty** (no ACTIVE strokes exist yet — true today), show a clear inline message in the combobox dropdown: "No approved prodshades yet — a stroke must be approved first (see Stroke Master)." Do not show a generic "no results" — this is a distinct, expected state, not an error.
5. Add a "FG SKU" column to the config table showing the auto-created FG material's `external_code` (the handler already returns `fg_pace_code`/`fg_material_id` on save — for the list endpoint, join `pack_code_id` + `material_id` → resolve the FG material the same way the auto-create block does, or store the resulting `fg_material_id` back onto the `prodshade_pack_config` row if that's simpler — your call on implementation, but the column must show a human SKU string, never a UUID).
6. Multiple fill sizes per pack code (e.g. 599 with 230 KG and 250 KG) render as **separate rows**, matching the locked design's mockup table — do not attempt to collapse them into one cell.

### C3. Error handling (small but real UX bug)

Both `codesQ` and `configsQ` currently only branch on `isLoading` vs `length === 0` — a hard API error (which is exactly what bug #1 was producing) renders identically to "nothing found here," hiding real failures. Add an `isError` branch to both queries showing the actual error message (via the existing `friendly()` mapper) instead of the empty-state copy.

---

## Verification checklist (Codex: run these yourself before writing the log entry)

1. `deno check` (or the project's existing typecheck command) on every touched `.ts` file — zero errors.
2. Confirm the new migration file is syntactically valid SQL (read it back, no dangling commas/typos) — **do not run it against dev yourself**, leave that to Claude.
3. Confirm `route-acl-registry.ts` has no duplicate `routeKey` entries (would silently shadow one route).
4. Confirm `production.routes.ts` still exports `dispatchProductionRoutes` with the same signature — only add new cases, don't restructure existing ones.
5. Grep the frontend file for any remaining raw `material_id` rendering (`.slice(0, ` on a UUID-shaped field is the tell) — should be zero occurrences after this change.

## Log + commit

Append your usual entry to `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` describing what you did (file list, migration filename, any deviations from this brief and why). Commit with your standard `Co-Authored-By: Codex` marker — do not `git add -A`; stage only the files this brief touches plus the new migration and the log update.
