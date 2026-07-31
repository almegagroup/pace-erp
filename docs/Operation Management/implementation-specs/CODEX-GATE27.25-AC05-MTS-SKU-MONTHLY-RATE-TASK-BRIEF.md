# CODEX-GATE27.25-AC05-MTS-SKU-MONTHLY-RATE-TASK-BRIEF

**Gate:** 27.25
**Domain:** PRODUCTION / COSTING (Accounts ACL)
**TX Code:** AC05
**Title:** MTS (IWC) SKU Monthly Sale Rate Master — company-wide FG SKU list, month-wise rate entry with Draft→Approve, feeds SO Create's rate lookup (SO side is a LATER brief, not this one).
**Reference doc:** feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`, **Section 114** (FG Dispatch Discovery Session), specifically **§114.8** (mechanism), **§114.15** (final TX code + company-scope rule). Read all of §114 for context before starting — this brief only covers AC05, but §114 explains *why* (MTS/IWC has no FO system, so SO rate can't come from a costing-group mechanism like MTO/HPS does — it needs its own simple monthly rate lookup).

---

## Before you write any code

1. Read **CLAUDE.md** §8 (Key Architecture Rules), §8A (no raw UUIDs, `useQuery` not `useEffect`+`setState`, bulk-resolve FKs on list endpoints), §8B (batch vs sequential loop rule).
2. Read `supabase/functions/api/_core/production/conversion_cost.handlers.ts` in full — it is the closest existing precedent (Accounts-owned, company-scoped, append-only rate-history pattern with derived `valid_to`). **Do not copy its Draft/Approve shape** — AC04 has none (it's straight-insert, no approval gate). AC05 genuinely needs Draft→Approve; that part has no precedent in this codebase, design it fresh per this brief.
3. You have Supabase MCP access to Dev (`ytapuwiqicmvpanmzelb`). Verify every table/column name in this brief against live Dev before writing queries — schemas may have drifted since this brief was written. Specifically re-verify: `erp_master.material_plant_ext` columns, `erp_production.stroke_master` columns (`po_type`, `prodshade_material_id`, `company_id`, `status`), `erp_master.material_master` columns (`pace_code`, `material_name`, `base_uom_code`).
4. **Do NOT touch ACL/menu registration (`erp_menu.menu_master`, `acl.menu_master`, `acl.capability_menu_actions`, `acl.version_*`, snapshot rebuild).** That is Claude's job via MCP after your code is verified — you only need to add the route pattern to `supabase/functions/api/_acl/route-acl-registry.ts` (code-level, lives in the repo) so the route doesn't 403 once the menu/capability side is wired up separately.
5. Migration file naming: `supabase/migrations/<UTC-timestamp>_gate27_25_mts_sku_monthly_rate.sql`, applied via `mcp__supabase__apply_migration`, then reconcile `supabase_migrations.schema_migrations` version to match the local filename timestamp (CLAUDE.md §8A "Migration Integrity"), then run `node scripts/migration-integrity-check.mjs` and confirm `in_sync = true`. Do this for Dev only — do not touch prod.
6. Batch independent lookups per §8B (e.g. bulk-resolving material/company names on list endpoints — one `.in()` call, not N).

---

## Ground truth for reuse

- **Company-scope pattern** — `getCompanyScope(ctx, requestedCompanyId)` (see `sales_order.handlers.ts` top of file) resolves to the caller's single scoped company automatically, or validates an explicitly-passed `company_id` against `erp_map.user_companies`. Reuse this exact helper (or a local copy with identical behavior) — do not hand-roll company resolution.
- **Frontend company selector** — `frontend/src/components/inputs/TransactionCompanySelector.jsx`. Reuse as-is for AC05's company field (auto-resolves for single-company users, dropdown for multi-company).
- **MTS SKU scoping (§114-confirmed formula):**
  1. Company-mapped: `erp_master.material_plant_ext` row exists for `(material_id, company_id)`, `status` active.
  2. Type-matched: the SKU's underlying Prodshade has an `erp_production.stroke_master` row for that company with `po_type = 'MTS'` and `status = 'APPROVED'`. The join from FG SKU → Prodshade is **not a direct FK** — mirror the exact resolution already used for Pack BOM's own SKU↔Prodshade matching in `pack_bom.handlers.ts` (shade_code+pack_code match against `prodshade_pack_config`) — **read that file's resolution logic before reimplementing it**, don't invent a second method.
  3. Description: `material_master.pace_code` + `material_master.material_name` (`pace_code — material_name` convention, never raw UUID, never `external_code`/`external_sku` for business logic — CLAUDE.md's own locked rule).
- **Approve separation-of-duties pattern** — mirror `createPgiInvoiceHandler` (WRITE) vs `reverseSalesInvoiceHandler` (EDIT) in `supabase/functions/api/_core/procurement/delivery_order.handlers.ts`: two fully separate handler functions, two separate routes, two separate `route-acl-registry.ts` entries with **different actions** (`WRITE` for draft create/edit, `APPROVE` for the approve action) on the same `resourceCode`. Do not let one function branch on a mode flag to do both.
- **Dense grid / hotkeys** — `ErpDenseGrid` (`frontend/src/components/data/ErpDenseGrid.jsx`), `useErpScreenHotkeys` (`frontend/src/hooks/useErpScreenHotkeys.js`, registers `save`/`refresh`/`focusSearch`/`focusPrimary` — wire `refresh` at minimum, wire `save` for the rate-entry grid's Save action). Follow the exact prop shapes already used in `frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx` (columns/rows/rowKey/emptyMessage/summaryRow) — read that file for the concrete pattern.

---

## Change 1 — Migration: `erp_production.mts_sku_monthly_rate`

```sql
CREATE TABLE erp_production.mts_sku_monthly_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  rate_month date NOT NULL,          -- always the 1st of the month
  rate numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  UNIQUE (company_id, material_id, rate_month)
);
```
Verify `rate_month` values are always stored as the 1st of the month (`date_trunc('month', ...)`) at the handler level, not a DB constraint — simpler and matches how this codebase handles similar "period" columns elsewhere (check `conversion_cost_config.valid_from` for precedent, no DB-level day-of-month constraint there either).

## Change 2 — Backend: `supabase/functions/api/_core/production/mts_sku_rate.handlers.ts` (new file)

1. **`listMtsSkuRateHandler`** (`GET /api/production/mts-sku-rates?company_id=&rate_month=`) — resolves company via `getCompanyScope`. Returns every MTS-scoped SKU for that company (per the scoping formula above) LEFT JOINed against `mts_sku_monthly_rate` for the given `rate_month` (if provided) — each row: `{material_id, pace_code, material_name, base_uom_code, rate, status, has_rate}`. If `rate_month` omitted, just return the SKU list with `rate: null`. Bulk-resolve names (§8A), no N+1.
2. **`saveMtsSkuRateDraftHandler`** (`POST /api/production/mts-sku-rates/draft`) — body `{company_id, rate_month, lines: [{material_id, rate}]}`. Upsert: for each line, insert a `DRAFT` row if none exists for `(company_id, material_id, rate_month)`, or update the `rate` if an existing row for that key is still `DRAFT`. **Hard-block (409) if any targeted row is already `APPROVED`** — approved rows are immutable (§114.10 "once Approve হয়ে গেলে সেই মাসের rate chart আর কোনোভাবে বদলানো যাবে না"). This is the WRITE action.
3. **`listDraftMtsSkuRatesHandler`** (`GET /api/production/mts-sku-rates/pending-drafts?company_id=`) — groups `DRAFT` rows by `rate_month`, returns `[{rate_month, line_count, filled_count}]` for the Approver's "Draft one-liner list" (§114.10). `filled_count` = rows where `rate > 0`.
4. **`approveMtsSkuRateHandler`** (`POST /api/production/mts-sku-rates/approve`) — **separate function, separate route, `APPROVE` action** — body `{company_id, rate_month}`. **Hard-block if any MTS SKU for that company has no row for that month, or has `rate <= 0`** (§114.10's two hard rules: mandatory fill, zero rate = not usable). On success: `UPDATE ... SET status='APPROVED', approved_by, approved_at WHERE company_id=... AND rate_month=... AND status='DRAFT'`.
5. **`listApprovedMonthsForSkuHandler`** (`GET /api/production/mts-sku-rates/available-months?company_id=&material_id=`) — returns `APPROVED` `rate_month` + `rate` pairs for one SKU. **This is the endpoint the future SO Create page will call for its month dropdown — build it now even though SO Create itself is out of scope, since it's a natural extension of this same table and trivial to add here.**

## Change 3 — Frontend: new page (route `/dashboard/production/mts-sku-monthly-rate` or similar under the Accounts area — confirm exact route path convention against existing Accounts pages like `frontend/src/pages/dashboard/procurement/accounts/landed-costs` before picking, follow whatever pattern is already there)

Two views on one page (tabs, matching how e.g. `SAProductionBatchSeriesPage.jsx` or a similar existing SA/config page splits list vs entry — check for a precedent before inventing tab UI from scratch):

1. **Rate Chart Entry tab:** Company selector (`TransactionCompanySelector`) → Month picker → dense grid of every MTS SKU for that company/month (from `listMtsSkuRateHandler`) with an editable Rate input per row → Save (calls `saveMtsSkuRateDraftHandler`). Pagination if the SKU list is long (`ErpPaginationStrip`, same component already used in `SalesInvoiceListPage.jsx`/other list pages this session).
2. **Approve tab:** one-liner list of pending drafts (`listDraftMtsSkuRatesHandler`) — `rate_month | filled_count/total | Enter/double-click to open`. Opening a row loads that month's full rate grid **read-write** (approver can overwrite per §114.10), with an **Approve** button (separate action from Save — different button, different handler call, matching the separate-handler backend split).

---

## Hard rules

1. Draft-save and Approve are **structurally separate** — separate handler functions, separate routes, separate `route-acl-registry.ts` entries (`WRITE` vs `APPROVE`), separate frontend buttons. Never let the same button/handler do both depending on a flag.
2. No raw UUIDs anywhere in the UI (§8A) — every material row shows `pace_code — material_name`, never `material_id`.
3. `APPROVED` rows are immutable at the DB-write level, not just the UI level — the draft-save handler must re-check status server-side even if the UI wouldn't normally let you touch an approved row (never trust the client alone).
4. Zero rate and missing rate are both "incomplete" for Approve purposes — don't special-case zero as "technically filled."
5. Company scope must be validated on **every** handler (list, draft-save, list-drafts, approve, available-months) — not just the write path. This is checklist item #2 from `feedback_known_bug_patterns_predesign_checklist` (company-scope gap found repeatedly in prior audits) — do not repeat it here.

## Explicitly out of scope

- SO Create's own consumption of `listApprovedMonthsForSkuHandler` (the "Single Month? Yes/No" toggle, per-line vs header month selection) — that's a future SO/DO/Invoice design brief, not this one. Build the endpoint, don't wire a consumer.
- ACL/menu registration (menu_master, capability grants, version capture, snapshot rebuild) — Claude does this via MCP after your code is verified. You only add the `route-acl-registry.ts` entries.
- Any change to `conversion_cost.handlers.ts` or `conversion_cost_config` — read-only reference, not touched.
- Maker-checker enforcement beyond ACL action separation (i.e., whether the SAME person with both WRITE and APPROVE grants should be blocked from approving their own draft) — this was flagged as an open business decision in §114 discovery, not yet resolved. Build the ACL-action separation (ready for maker-checker later); do not add a same-user-block yourself.

## Verification

1. Create a company with at least 2 MTS-scoped SKUs (real Dev data — verify via the scoping formula query directly in MCP first, don't assume test data already fits).
2. Save a Draft rate chart for a month with one SKU's rate left at 0 — confirm Approve is blocked with a clear error.
3. Fill all rates > 0, Approve — confirm all rows flip to `APPROVED`, `approved_by`/`approved_at` set.
4. Attempt to re-save a Draft for an already-approved month — confirm 409 block.
5. Call `available-months` for one of the now-approved SKUs — confirm it returns the approved month + rate.
6. `deno check` clean (zero new errors beyond the documented pre-existing `.range()`/`.gt()` baseline — verify the baseline count via `git stash` before/after per this project's own established discipline).
7. `node scripts/migration-integrity-check.mjs` → `in_sync = true` after your migration.

## Log + commit

- Append one entry to `docs/Codex-Log.md` and `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` (Gate-27.25 entry, same format as prior Gate-27.x entries).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
