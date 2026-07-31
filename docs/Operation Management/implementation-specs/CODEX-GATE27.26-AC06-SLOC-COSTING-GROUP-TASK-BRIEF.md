# CODEX-GATE27.26-AC06-SLOC-COSTING-GROUP-TASK-BRIEF (v2 — corrects the shipped v1)

**Gate:** 27.26
**Domain:** PRODUCTION / COSTING (Accounts ACL)
**TX Code:** AC06
**Title:** Storage-Location-based Costing Group master for MTO/HPS RM/PM/INT costing rate — **v2 adds a new "SLoc Group" prerequisite layer and a real Approval Detail page**, replacing the single-storage-location browse and blunt bulk-approve v1 shipped.
**Reference doc:** feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`, **§114.22** (this correction, read in full — explains exactly what was wrong and why), plus the still-valid **§114.9/§114.10/§114.21** underneath it (material-level group/rate uniqueness is UNCHANGED, only the browsing layer and Approval flow change).

---

## ⚠️ Read this first: this is a v1→v2 correction, not a fresh build

Business owner clicked through the deployed v1 page and said it's **not usable as-is**. The core
`costing_group`/`costing_group_member`/`costing_rate_line` schema and the material-level
uniqueness rule (§114.21) are **correct and stay unchanged**. What's wrong is:

1. There is no way to browse/act on **multiple** storage locations at once — every flow
   (group-member picking, rate-chart entry) is hard-wired to exactly one `storage_location_id` at
   a time. The real requirement needs a **new, separate, reusable "SLoc Group" master** (a named
   group of storage locations) as a prerequisite step before both group-creation and rate entry.
2. Approval is a single blunt "approve everything drafted this month" button with **no way to
   review, edit a rate, or fix group membership before approving** — the real requirement needs a
   proper Detail page reachable from the draft list.

Read `supabase/functions/api/_core/production/costing_group.handlers.ts` and
`frontend/src/pages/dashboard/production/SlocCostingGroupPage.jsx` **in full** before starting —
both already exist and most of what's in them is correct and reusable. This brief tells you
precisely what to add/change, not to rewrite from scratch.

---

## Before you write any code

1. Read CLAUDE.md §8, §8A, §8B.
2. Read feasibility doc §114.22 in full (this correction), then §114.9/§114.10/§114.21 underneath it for what's still valid.
3. Read the existing `costing_group.handlers.ts` and `SlocCostingGroupPage.jsx` in full (they're short).
4. You have Supabase MCP access to Dev (`ytapuwiqicmvpanmzelb`). Re-verify every table/column live before using it.
5. Do NOT touch ACL/menu registration in the DB — Claude does that via MCP. This brief needs **no new ACL resource** — everything stays under the existing `ACC_SLOC_COSTING_GROUP` resource code (VIEW/WRITE/APPROVE/DELETE actions already registered), you only add new `route-acl-registry.ts` entries for the new routes using those same actions (SLoc Group CRUD = VIEW/WRITE, same as Costing Group CRUD already is).
6. Migration integrity discipline unchanged (§8A) — apply, reconcile version, `migration-integrity-check.mjs` → `in_sync = true`, Dev only.

---

## Change 1 — Migration: two new tables

```sql
-- A named, reusable, company-scoped group OF storage locations. Pure browse/filter
-- convenience — a storage location can belong to multiple SLoc Groups (no exclusivity;
-- this does NOT touch the material-level Costing Group exclusivity rule, §114.21).
CREATE TABLE erp_production.sloc_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE erp_production.sloc_group_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sloc_group_id uuid NOT NULL REFERENCES erp_production.sloc_group(id),
  storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sloc_group_id, storage_location_id)
);
```

`costing_group` / `costing_group_member` / `costing_rate_line` — **no schema change**, still
material-level, no location column.

## Change 2 — Backend: new `sloc_group.handlers.ts` (or add to `costing_group.handlers.ts`, your call — keep them in the same file since they share the `getCompanyScope`/`getMaterialMap` helpers)

1. `createSlocGroupHandler` (`POST /api/production/sloc-groups`) — `{company_id, name, storage_location_ids: [...]}`. Creates the group + inserts every member row in one call (this is a create-with-members flow, not create-then-add-separately — the UI always collects the multi-select before saving).
2. `listSlocGroupsHandler` (`GET /api/production/sloc-groups?company_id=`) — returns each group with its member storage locations (code + name, join `storage_location_master`) and a `member_count`.
3. `addSlocGroupMemberHandler` (`POST /api/production/sloc-groups/:id/members`) — `{storage_location_ids: [...]}`, for adding more locations to an existing SLoc Group later. Skip (no-op) any id already a member — no exclusivity conflict is possible here (unlike Costing Group), so there's no 409 case to handle.
4. `removeSlocGroupMemberHandler` (`DELETE /api/production/sloc-groups/:id/members/:memberId`).

## Change 3 — Backend: `listCostingRateMaterialsHandler` — switch from single location to SLoc Group union

Change the query param from `storage_location_id` to `sloc_group_id`. Resolve every
`storage_location_id` that's a member of that `sloc_group_id` (join `sloc_group_member`), then run
the existing `stock_snapshot` query with `.in("storage_location_id", memberLocationIds)` instead of
`.eq("storage_location_id", storageLocationId)` — the rest of the function (material dedup, group
name join, rate join) is unchanged, it already operates on a `materialIds` array regardless of how
many locations fed it. This ONE function is reused as-is by both the group-member-picker browse
list (drawer) and the Rate Chart Entry list (main table) — both already call it, they'll both just
pass `sloc_group_id` now instead of `storage_location_id`.

## Change 4 — Backend: `addCostingGroupMemberHandler` — no schema change, just param rename

`storage_location_id` in the body (currently stored as `added_from_storage_location_id`, audit-only)
no longer makes sense as a single value once browsing is SLoc-Group-driven — change it to accept
`sloc_group_id` instead and store... actually, simplest: **drop this field from the request
entirely** and leave `added_from_storage_location_id` NULL going forward (it was always
audit-only/non-identity per §114.21, never load-bearing) — don't invent a new "added from which
SLoc Group" audit column unless you find a real use for it; this brief doesn't ask for one.

## Change 5 — Backend: Approval Detail page endpoint

New: `listDraftCostingRateDetailHandler` (`GET /api/production/costing-rate/draft-detail?company_id=&rate_month=`)
— returns every `costing_rate_line` row for that `(company_id, rate_month)` regardless of status
(so the approver sees the full drafted set, not filtered by any single SLoc Group — a month's
drafts may have been entered across several different SLoc-Group browsing sessions). Same shape as
`listCostingRateMaterialsHandler`'s response rows (material label, group name, rate, status) plus
the row's own `id` so the frontend can distinguish rows. Reuse `getMaterialMap` for labels.

`saveCostingRateDraftHandler` and `removeCostingGroupMemberHandler`/`addCostingGroupMemberHandler`
are reused as-is from the Detail page for editing — no new write endpoints needed. Read §114.22's
"nuance" paragraph on why a membership change doesn't retroactively touch an already-drafted row's
`group_id` — don't try to "fix" that, it's the intended snapshot behavior.

## Change 6 — Frontend: `SlocCostingGroupPage.jsx` rework

1. **Header**: replace the single "Storage Location" `<select>` with an "SLoc Group" `<select>`
   (sourced from `listSlocGroups`). Keep Company + Month as-is.
2. **New "Manage SLoc Groups" entry point** (a button next to "New Group", or a small inline
   drawer) — multi-select checkboxes over `listStorageLocations` (already imported), Name input,
   Save → `createSlocGroup`. Simple, one screen, no need for a separate route/page.
3. **"New Group" drawer** (Costing Category Group creation) — the "Browse Storage Location"
   `<select>` inside the drawer becomes an "SLoc Group" `<select>` instead, feeding
   `listCostingRateMaterials({ sloc_group_id })` (Change 3) for the picker grid. Everything else in
   the drawer (mode toggle, group name, material checkboxes, save) is unchanged.
4. **Rate Chart Entry table** — driven by the header's SLoc Group selection now, same
   `listCostingRateMaterials({ sloc_group_id, rate_month })` call. **Rate input behavior change**:
   only the row that is the **first member of its group** (by material sort order, or simplest:
   first occurrence when iterating `rateMaterials` in the order the API returns them) gets an
   editable `<input>`; every other row sharing that `group_id` renders the rate as **read-only
   text**, updated live from the first row's `onChange` (the existing `updateRate(materialId,
   value, groupId)` propagation logic already does the "update every row sharing groupId" part —
   you're only changing which rows render an `<input>` vs plain text). Standalone rows
   (`group_id == null`) stay editable exactly as today.
5. **Approve tab → Detail page, not a bare Approve button.** The pending-drafts list stays as the
   entry point, but clicking/Entering a row now opens a Detail view (can be an inline expand,
   a drawer, or route to a sub-view — your call on the exact UI shape, but it must show every
   drafted row for that month per Change 5, not just a count) with:
   - Editable rate per row (reuses the same input pattern as Change 6.4 — first-of-group editable,
     rest read-only-and-propagated).
   - An "Unmap from group" action per grouped row (reuses `removeCostingGroupMember`, same as the
     existing `SectionMembers` unmap button — copy that pattern here).
   - A "Save Changes" action that calls `saveCostingRateDraftHandler` with whatever the approver
     edited (same endpoint the Rate Chart Entry tab already uses).
   - An "Approve" action (calls the existing `approveCostingRateHandler`) that only becomes
     available from within this Detail view — remove the old bare "Approve" button from the list
     view entirely, the list view now only navigates into the Detail view.

## Change 7 — `frontend/src/pages/dashboard/production/prodApi.js`

Add: `createSlocGroup`, `listSlocGroups`, `addSlocGroupMember`, `removeSlocGroupMember`,
`listDraftCostingRateDetail` — same `fetchProd` wrapper pattern as every other function in this
file, next to the existing `createCostingGroup`/`listCostingGroups`/etc.

## Change 8 — `route-acl-registry.ts`

All new routes gated under the existing `ACC_SLOC_COSTING_GROUP` resource:
- `POST /api/production/sloc-groups` → `WRITE`
- `GET /api/production/sloc-groups` → `VIEW`
- `POST /api/production/sloc-groups/:id/members` → `WRITE`
- `DELETE /api/production/sloc-groups/:id/members/:memberId` → `DELETE`
- `GET /api/production/costing-rate/draft-detail` → `VIEW`

---

## Hard rules

1. Material-level Costing Group exclusivity (§114.21) is **unchanged** — do not let SLoc Group
   membership introduce any material-exclusivity concept. A storage location can sit in many SLoc
   Groups; that's fine and expected.
2. `costing_rate_line.group_id` stays a snapshot, never live-joined for history — same as v1,
   restated in §114.22's nuance paragraph. Don't "fix" this into a live join while building the
   Approval Detail page.
3. Company scope on every new/changed handler.
4. Draft-save vs Approve stay structurally separate handlers/actions (unchanged from v1).
5. Don't regress anything in v1 that's already correct — Change 1-8 above is additive/substitutive
   on specific pieces, not a rewrite of the whole file.

## Explicitly out of scope

- How the approved rate is consumed by SO/§104 RMC calc — still deliberately deferred (§114.9).
- A "reopen after approve" mechanism — not asked for.
- Any change to `sloc_group`'s own storage locations affecting existing `costing_rate_line` history — out of scope, no such coupling exists.

## Verification

1. Create an SLoc Group with 2+ storage locations in Dev.
2. Open "New Group", pick that SLoc Group, confirm the material picker shows the **union** of items across both locations (not just one).
3. Create a Costing Category Group with 2 members from that union list.
4. Switch the header to that SLoc Group + a test month, confirm the Rate Chart Entry table shows the same union, confirm only the first grouped row has an editable rate input and typing into it updates the second row's (read-only) display.
5. Save Draft, then go to Approve tab, click into that month's row, confirm the Detail view shows all drafted rows (including any entered via a **different** SLoc Group session that same month, if you test that), edit one rate there, unmap one member, confirm both persist, then Approve from inside the Detail view.
6. Confirm the list view no longer has a bare Approve button — only navigation into Detail.
7. `deno check` / `eslint` clean. `node scripts/migration-integrity-check.mjs` → `in_sync = true`.

## Log + commit

- Append entries to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md` (Gate-27.26, mark as v2 correction with a reference back to the original entry).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
