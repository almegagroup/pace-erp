# CODEX-GATE27.26-AC06-SLOC-COSTING-GROUP-TASK-BRIEF

**Gate:** 27.26
**Domain:** PRODUCTION / COSTING (Accounts ACL)
**TX Code:** AC06
**Title:** Storage-Location-based Costing Group master for MTO/HPS RM/PM/INT costing rate — optional grouping (same rate for multiple materials) + standalone per-material rate, both on a month-wise Draft→Approve rate chart.
**Reference doc:** feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`, **Section 114**, specifically **§114.9** (Costing Group mechanism + the corrected "grouping is optional, standalone materials still need individual rates" rule), **§114.10** (Monthly Rate Chart + Approve lock + history/reporting answer), **§114.15** (TX code AC06, company-scope rule), **§114.21** (⚠️ LOCKED — resolves a real blocker an earlier Codex pass correctly paused on: group membership and rate are **material-level, NOT (material, storage_location)-level**. Read this before Change 1 — it changes the schema below from what an earlier version of this brief said). **Also read §114.9's correction paragraph** — an earlier wrong assumption (storage-location membership implies automatic rate inheritance) was explicitly corrected by the business owner; do not reintroduce that wrong assumption while implementing.

---

## Before you write any code

1. Read **CLAUDE.md** §8, §8A, §8B (same as every brief in this batch).
2. Read `supabase/functions/api/_core/production/conversion_cost.handlers.ts` for the Accounts-ownership/company-scope pattern (reuse `getCompanyScope`, `assertCompanyScope`), but note **AC04 has no Draft/Approve** — same caveat as the AC05 brief, design the Draft/Approve mechanism fresh.
3. Read the **AC05 brief** (`CODEX-GATE27.25-AC05-MTS-SKU-MONTHLY-RATE-TASK-BRIEF.md`) if it has already landed — AC06 reuses the exact same Draft→Approve shape (status CHECK, separate approve handler/route/ACL-action, hard-block on incomplete/zero rate) at the rate-line level. Don't reinvent that mechanism differently here; mirror it.
4. **Storage-location↔company scoping is NOT via `storage_location_master` directly** — that table has no `company_id` column. Use `erp_inventory.storage_location_plant_map (storage_location_id, company_id, active)` to resolve which locations belong to the selected company. Verify this against live Dev before writing the query — schema may have changed since this brief was written.
5. You have Supabase MCP access to Dev (`ytapuwiqicmvpanmzelb`). Re-verify every table/column referenced in this brief live before using it.
6. **Do NOT touch ACL/menu registration** — same rule as the AC05 brief, Claude does that via MCP separately. You only add `route-acl-registry.ts` entries.
7. Migration naming/reconciliation: same discipline as the AC05 brief (§8A Migration Integrity — apply, reconcile version, run `migration-integrity-check.mjs`, confirm `in_sync = true`, Dev only).

---

## Ground truth for reuse

- Company-scope: `getCompanyScope(ctx, requestedCompanyId)`, `TransactionCompanySelector.jsx` — same as AC05.
- Material list for a storage location: **`erp_inventory.stock_snapshot`** filtered by `company_id` + `storage_location_id` (any `stock_type_code`, distinct `material_id`) — this is what "the list of items in that location" means per §114.9's own description ("storage location choose korbe, r oi location e thaka Item er list asbe"). Not `material_plant_ext` (that's AC05's SKU↔company mechanism, a different concept — don't conflate the two).
- Material description: `material_master.pace_code` + `material_name`, same convention as everywhere else in this codebase.
- Approve separation-of-duties: mirror `createPgiInvoiceHandler`/`reverseSalesInvoiceHandler` split (see AC05 brief's identical note) — Draft-save is `WRITE`, Approve is a fully separate handler/route/`APPROVE` action.
- Dense grid / drawer / hotkeys: same components as AC05 brief (`ErpDenseGrid`, `DrawerBase` for the group create/edit modal, `useErpScreenHotkeys`).

---

## Change 1 — Migration: 3 new tables in `erp_production`

**§114.21 LOCKED schema note (read before implementing):** a material can physically exist in multiple storage locations at once (normal stock), but at any given time it belongs to **at most one Costing Group**, and it has **exactly one rate per month** — neither is partitioned by storage location. Storage Location is a **browse/discovery filter only** (how the user finds materials to add), never part of the group-membership or rate-line identity.

```sql
CREATE TABLE erp_production.costing_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (company_id, name)
);

-- material_id is the sole uniqueness key -- a material is a member of at most
-- ONE group at a time, full stop, regardless of how many storage locations it
-- exists in. storage_location_id is kept as a nullable "last added from" note
-- for UI/audit convenience only, never part of the identity.
CREATE TABLE erp_production.costing_group_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES erp_production.costing_group(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  added_from_storage_location_id uuid REFERENCES erp_inventory.storage_location_master(id),
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id)
);

-- one row per material per month per company, regardless of grouped or standalone --
-- group_id is a SNAPSHOT of membership at rate-chart-save time (nullable = was
-- standalone that month). This is deliberate, not an oversight: §114.10's own
-- locked answer to the history/reporting question depends on each material's
-- own row recording which group it was in THAT month, not a live join to
-- costing_group_member (which can change independently of past rate charts).
-- No storage_location_id here either -- same §114.21 rule, one rate per
-- material per month, wherever it's physically stocked.
CREATE TABLE erp_production.costing_rate_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  rate_month date NOT NULL,
  rate numeric NOT NULL DEFAULT 0,
  group_id uuid REFERENCES erp_production.costing_group(id),  -- NULL = standalone that month
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

## Change 2 — Backend: `supabase/functions/api/_core/production/costing_group.handlers.ts` (new file)

**Group CRUD:**
1. `createCostingGroupHandler` (`POST /api/production/costing-groups`) — `{company_id, name}`. Company-scoped.
2. `listCostingGroupsHandler` (`GET /api/production/costing-groups?company_id=`) — for the "existing group or new group" picker in the member-add flow.
3. `addCostingGroupMemberHandler` (`POST /api/production/costing-groups/:id/members`) — `{storage_location_id, material_ids: [...]}` (`storage_location_id` here is purely the browse context the materials were picked from — stored as `added_from_storage_location_id`, not an identity field). **Hard-block (409) if any `material_id` is already a member of a *different* group** — per §114.21, a material must be explicitly unmapped from its current group before joining another; do not silently move it. Skip (no-op, not an error) if it's already a member of *this same* group.
4. `removeCostingGroupMemberHandler` (`DELETE /api/production/costing-groups/:id/members/:memberId`) — unmap, per §114.9 ("item add or unmap দুটোই করা যাবে"). After unmap the material becomes standalone (no group) until explicitly added elsewhere.

**Rate list/entry (mirrors AC05's shape closely — read that handler file once it exists):**
5. `listCostingRateMaterialsHandler` (`GET /api/production/costing-rate/materials?company_id=&storage_location_id=&rate_month=`) — `storage_location_id` is a **browse filter**: every material with a `stock_snapshot` row at that company+location. LEFT JOIN against `costing_rate_line` for `rate_month` (if given) and against `costing_group_member` for the **current** group name (§114.9's "pashe group name dekhabe, na thakle blank" — live current group, for entry convenience; not frozen until save). Since rate/group are material-level, the same material browsed from a different location on a different day resolves to the identical rate/group row — that's expected, not a bug.
6. `saveCostingRateDraftHandler` (`POST /api/production/costing-rate/draft`) — body `{company_id, rate_month, lines: [{material_id, rate}]}` (**no `storage_location_id`** — it was only needed to build the browse list in step 5, not the save payload). For each line: resolve current `group_id` from `costing_group_member` (NULL if standalone), upsert into `costing_rate_line` keyed by `(company_id, material_id, rate_month)` (insert if absent, update `rate`/`group_id` if existing row is still `DRAFT`, 409 if `APPROVED`). **Group auto-fill (§114.10) is a frontend convenience only** — backend still receives one explicit rate per material, no server-side broadcast logic.
7. `listPendingCostingDraftsHandler` / `approveCostingRateHandler` — same shape as AC05's `listDraftMtsSkuRatesHandler`/`approveMtsSkuRateHandler`, scoped by `(company_id, rate_month)` (not by storage location — there's no location dimension to the approval). Hard-block Approve if any `DRAFT` row for that `(company_id, rate_month)` has `rate <= 0` — but **do not require every material in the company to have a row**; only the ones actually touched (drafted) that month are in scope for that Approve action. Same separate-handler/route/ACL-action split as AC05.

## Change 3 — Frontend: new page

1. **Group management:** "Create Costing Material Group" action → Name → pick Storage Location (browse filter) → pick material(s) from that location's list → Save. A second entry point for **adding to an existing group** (§114.9) — same flow, Group picker offers Select-existing as well as Create-new. If a picked material is already in a different group, surface the 409 from Change 2.3 clearly (e.g. "already in Group X — unmap it there first") rather than a generic error.
2. **Rate Chart Entry:** Storage Location Tab/Dropdown (browse filter only) → material list for that location (group name shown, blank if none) → Month → editable rate grid. **Group auto-fill UX:** typing a rate into one group member auto-fills every other **visible** row sharing that `group_id` (client-side convenience; a member currently sitting in a different storage-location's browse view isn't affected until that view is also opened/saved — the backend save is still per-material, so this is purely a same-screen convenience, not a data integrity mechanism).
3. **Approve tab:** one-liner Draft list scoped per `(company, month)` (not per location) — matches Change 2.7.

---

## Hard rules

1. `costing_group_member` changes (add/unmap) **never retroactively alter an already-saved `costing_rate_line` row** — those are frozen snapshots (§114.10's own locked history design). Only *future* rate-chart saves pick up the current membership.
2. Draft-save and Approve are structurally separate (same rule as AC05).
3. `APPROVED` rows immutable server-side, re-checked on every write attempt, not just the UI.
4. Zero or missing rate = incomplete for Approve, for every material **drafted that month** (company+month scope, not location-scoped) — no partial-approve within that drafted set.
5. Company scope validated on every handler (group CRUD, member add/remove, rate list, draft-save, approve) — checklist item #2, do not repeat the known gap.
6. Two different departments/actions never share a `resource_code` (checklist item #6) — Draft-save and Approve get distinct ACL actions on the same resource, as elsewhere in this batch, not two different resources either (keep it consistent with the AC05 pattern: one resource, two actions).

## Explicitly out of scope

- How this rate is consumed by §104's RMC calculation or by SO creation — deliberately deferred by the business owner during design (§114.9's own "OPEN, deliberately deferred" note). Build the master + rate chart only.
- ACL/menu registration — Claude's job via MCP, same as AC05.
- Maker-checker enforcement beyond ACL action separation — same open question as AC05, not resolved here.

## Verification

1. Create a group with 2 members (materials found via browsing one storage location) plus confirm 1+ standalone (ungrouped) material also exists (any location) in Dev.
2. Attempt to add one of those 2 members to a *second*, different group — confirm 409 block (§114.21's core rule).
3. Save a rate chart for that month: group's first member gets a rate, confirm (via API response or DB check) the SAME rate landed on the second member's own row too (frontend-filled, but verify the actual persisted rows, not just the UI) — and confirm both rows carry the same `group_id`, no `storage_location_id` column exists on `costing_rate_line` to check.
4. Leave the standalone material's rate at 0, attempt Approve for that `(company, month)` — confirm hard-block.
5. Fill it, Approve — confirm all drafted rows (group + standalone) for that company+month flip to `APPROVED` with `group_id` correctly snapshotted per row.
6. Unmap one group member, save a **new** month's rate chart — confirm the unmapped material now saves as standalone (`group_id NULL`) for the new month, while the **old** approved month's row for that material still shows the old `group_id` unchanged (history-preservation check, §114.10's design).
7. Confirm the same material, browsed via two *different* storage locations (if it exists in both in Dev data), resolves to the identical rate/group in both browse views.
8. `deno check` clean against documented baseline. `node scripts/migration-integrity-check.mjs` → `in_sync = true`.

## Log + commit

- Append entries to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md` (Gate-27.26).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
