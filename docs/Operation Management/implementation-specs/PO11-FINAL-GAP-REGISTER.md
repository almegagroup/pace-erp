# PO11 Final Gap Register

## Design Lock

Frozen PO11 model:

1. `SLOC Group` = parent planning scope, company-scoped
2. Eligible RM/PM item pool comes from the chosen SLOC-group locations
3. One parent `SLOC Group` may contain multiple `Item Group`
4. Remaining ungrouped items stay stand-alone inside that same SLOC-group scope
5. Planning input is month-scoped
6. Previous month values + membership + group config carry forward into the new month
7. Month close creates a frozen archive snapshot
8. One storage location cannot belong to two active planning SLOC groups in the same company

## Gap Register

| Area | Status | Notes |
|---|---|---|
| DB - active SLOC-group parent model | Closed in schema | Parent `sloc_group_id` now exists on item group; future duplicate active SLOC membership blocked by backend validation |
| DB - monthly line identity | Closed in source | New migration scopes monthly plan line uniqueness by `plan_id + material_id + source_sloc_group_id` |
| DB - archive line scope identity | Closed in source | New migration adds scope snapshot ids and archive uniqueness by `archive_id + material_id + source_sloc_group_id_snapshot` |
| DB - archive group-config identity | Closed in source | Archive group config no longer depends on snapshot name uniqueness |
| BE - eligible item discovery from chosen SLOC scope | Closed in source | Uses `stock_snapshot` within the configured planning SLOC locations instead of `material_plant_ext.default_storage_location_id` |
| BE - same-session SLOC/item-group refresh | Closed in source | React Query authoritative workspace pattern already applied |
| BE - next-month line carry-forward | Closed in source | Previous month line values clone into the new month with scope-aware dedupe |
| BE - next-month item membership carry-forward | Closed in source | Previous month membership carries forward when the item group still exists in the same parent SLOC scope; invalid old group refs now drop back to stand-alone instead of breaking bootstrap |
| BE - next-month group-config carry-forward | Closed in source | Previous month group configs now carry forward only for still-valid item groups |
| BE - month close / archive snapshot | Closed in source | Live close persists scoped archive lines and group configs |
| FE - item-group create/update placement | Closed in source | Item-group create/update now lives inside the parent SLOC mapping section |
| FE - full-page report route | Closed in source | Dashboard now has filter page -> execute -> full-page report route |
| FE - Shift+F8 compatibility | Closed in source design | Full-page report now has its own route, so opening the current workspace in a new ERP window can preserve that report URL |
| FE - view-only vs maintenance visibility | Closed in source | Setup tabs, save actions, and close action are hidden for viewers; Monthly Input stays readable but read-only |
| FE - next-month auto-fill UX | Partially closed pending live retest | Backend carry-forward is wired; needs live month-to-month verification after migrations/deploy |
| Prod data - duplicate active SLOC memberships | Open | `CMP003` still has `P003`, `R003`, `T003` assigned to 3 active groups; cleanup decision still required |
| Prod data - old bad PO11 rows/backfill | Open | Existing prod rows should be rechecked after migrations/deploy and duplicate SLOC cleanup |
| Deploy - migrations apply | Open | New PO11 migrations not yet applied live in this session |
| Deploy - backend/function rollout | Open | Source changed locally; live deploy still pending |
| Acceptance checklist | Open | Must be executed end-to-end after deploy/data cleanup |

## Journey Status

### Journey 1
`SLOC group create -> eligible item pool -> item group create -> member assign/unassign -> stand-alone visible`

Source status:
- Mostly closed in source
- Still needs live verification after deploy + prod cleanup

### Journey 2
`Monthly input save -> grouped totals -> report view by SLOC group`

Source status:
- Mostly closed in source
- Full-page report flow now added
- Still needs live verification with real saved rows after migrations

### Journey 3
`Next month open -> previous month carry-forward -> changed fields only update`

Source status:
- Closed in source for line values, membership, and group config carry-forward
- Still needs live month-to-month verification

### Journey 4
`Close month -> archive snapshot -> history read`

Source status:
- Closed in source, including scoped archive-line identity
- Still needs live verification against a real closed month

## Acceptance Lock

Do not call PO11 closed until all 8 pass:

1. First-time company setup
2. Item pool appears
3. Item group mapping works
4. Stand-alone works
5. Grouped report works
6. Next month auto-fill works
7. Close month snapshot works
8. History frozen works
