# CODEX-GATE27.26-AC06-SLOC-COSTING-GROUP-TASK-BRIEF (v3 -- FINAL PO11-parity redesign)

**Gate:** 27.26
**Domain:** ACCOUNTS / DISPATCH RATE
**TX Code:** AC06
**Resource:** `ACC_SLOC_COSTING_GROUP`
**Title:** Monthly Costing Rate Workspace
**Design SSOT:** feasibility §114.23 (2026-08-24). It supersedes AC06-specific statements in §§114.9, 114.10, 114.21, and 114.22.

## Outcome

Build AC06 as the company-scoped PO11 workspace pattern:

`Company -> SLOC Group -> eligible item pool -> Costing Group / Standalone -> monthly rate -> Auditor verification -> close/archive -> Dispatch resolution`

It is **not** procurement planning. Do not reuse `erp_procurement` tables, procurement routes, or PO11 authority. Reuse PO11's proven data-scoping, carry-forward, close/archive, full-page report, and ERP DenseGrid UX patterns.

## Mandatory reading and process

1. Read `CLAUDE.md`, especially §8, §8A, §8B and all mandatory bug-pattern rules.
2. Read `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` AC06 entries; they document the obsolete v1/v2 model and must not be treated as the current business model.
3. Read feasibility §114.23 in full, this brief, `PROD-ACL-Access-Decisions.md`, PO11's task brief, migrations, backend handler, frontend page, and dependency-provisioning report process.
4. Verify actual Dev schema before migration. Use a new additive migration; never edit the two existing AC06 migrations.
5. Before completion run all applicable static guards, dependency provisioning check, migration integrity check, focused backend type checks, frontend lint/build, and add exact results to both implementation logs.

## Locked authority

| Area | Accounts | L1/L2 Auditor | Director | ACL Master |
|---|---|---|---|---|
| View/report/history | Yes | Yes | Yes | Yes |
| SLOC Group / Costing Group / item mapping maintenance | Yes | Yes | No | Yes |
| Rate entry/change | Yes | No | No | Yes |
| Verify pending rate | No | Yes | No | Yes |
| Close month | No | Yes | No | Yes |

Use ACL resource actions and approver/workflow data; no local role arrays or direct role-code gates. `ACC_SLOC_COSTING_GROUP` is view-only; `ACC_SLOC_COSTING_SETUP`, `ACC_SLOC_COSTING_RATE`, `ACC_SLOC_COSTING_VERIFY`, and `ACC_SLOC_COSTING_CLOSE` independently gate the four operational responsibilities.

## Database redesign -- additive migration

AC06 data-entry month starts at `2026-05-01`. Historical May onward months stay open until an authorized Auditor/ACL Master explicitly uses **Close Month**; opening a workspace must never close a month as a side effect. The retained auto-close RPC is reserved for a separately authorized scheduled job.

Create a clean AC06 monthly workspace in `erp_production`. Dev and Prod were verified with zero
legacy AC06 rows, so retire/drop the old AC06 v1/v2 tables and endpoints in this migration. Do not
retain old behavior or compatibility code.

1. `costing_rate_sloc_group`: company, name, audit fields, active state; unique `(company_id, name)`.
2. `costing_rate_sloc_group_member`: parent group + storage location; enforce that a location has one active parent group per company. Validate company ownership in DB/handler.
3. `costing_rate_item_group`: parent SLOC group, name, audit fields, active state; unique `(sloc_group_id, name)`.
4. `costing_rate_month`: company + first-day month, status `OPEN/CLOSED`, carry-forward source, closed audit; unique `(company_id, rate_month)`.
5. `costing_rate_month_line`: `(month_id, source_sloc_group_id, material_id)` identity; current item-group snapshot/null for standalone; free-precision numeric rate; verification status/audit; rate revision audit fields. Enforce one material in at most one Costing Group in one monthly SLOC scope.
6. `costing_rate_month_group_config`: snapshot/configuration of parent SLOC Group, Costing Group, and member material for the month, sufficient for carry-forward and immutable history.
7. Archive header/line/group-config tables mirroring PO11 snapshot requirements, including group names and verification/rate precision snapshots.
8. A security-definer Dispatch resolver RPC/function that accepts company, dispatch month, source SLOC group, and material; returns only verified non-zero rate or an explicit blocked result. It must never fallback to a prior rate.
9. Auto-close function/schedule path matching PO11's safe month-expiry pattern. Do not silently verify pending rows on close.

## Backend

Implement an AC06 workspace handler family under Production routes, with all reads/writes company-scope checked:

1. Workspace GET: resolve/create current month, carry forward prior month config/rates as pending draft, calculate eligible material pool from the parent SLOC Group, return grouped/standalone rows, summary, SLOC groups, Costing Groups, and permissions.
2. Bulk rate/config save: preserve arbitrary numeric decimal precision; group-lead rate propagates only within its current Costing Group; any rate/membership revision invalidates required verification deterministically.
3. SLOC Group CRUD and membership validation: reject duplicate active company membership; block deletion/move when dependent Costing Groups require action.
4. Costing Group CRUD and membership validation: parent must match selected company/SLOC Group; a material may exist in only one current Item/Costing Group within its monthly scope; removing makes it standalone.
5. Verify endpoint: only pending eligible standalone/group-lead scopes; accept bulk selected scopes atomically; reject a mixed selection containing verified/stale/other-scope rows. Verification cascades to group members through the same saved group rate snapshot.
6. Close, history, auto-close, and multi-month report endpoints. Archive must preserve names, mapping, rate value, precision, and verification state.
7. Dispatch resolver/integration endpoint. Consumers get an explicit `usable=false`/block response for zero, missing, or pending rates.
8. Add every route to `route-acl-registry.ts`; validate actual method/path patterns. Do not use frontend permission checks as authority.

## Frontend

Rebuild `SlocCostingGroupPage.jsx` as the PO11 workspace visual pattern, retaining AC06 labels:

1. Header: company, month, SLOC Group, status/count chips, Refresh, Close Month.
2. Tabs: Costing Dashboard, Monthly Costing Rate Input, SLOC Group Setup, Costing Group Setup, History / Archive.
3. SLOC Group Setup: create/edit/delete and add/remove locations; immediate refresh after save; company-only location choices.
4. Costing Group Setup: selected parent SLOC Group is mandatory; group create/edit/delete and eligible-item map/unmap; clear standalone list.
5. Monthly Costing Rate Input: ERP DenseGrid; group lead editable plus read-only auto-filled members; standalone editable; free decimal input; pending/verified/zero status; checkbox selection only for valid pending scopes; bulk Verify action follows locked inactive rule.
6. Costing Dashboard/report selection: Company + SLOC Group + multi-month picker; Execute opens a full-page report route, compatible with Shift+F8 new-window flow.
7. History: immutable closed-month snapshot; no edit controls.
8. Use shared transaction-company, screen scaffold, DenseGrid, hotkey, loading, action-overlay, and page/report patterns. No custom role arrays.

## Acceptance checklist

1. CMP003 and CMP006 can have independent SLOC Groups, Costing Groups, items, monthly rates, verification, and reports.
2. One company SLOC cannot be saved into two active AC06 SLOC Groups.
3. A Costing Group cannot exist without its parent SLOC Group; an item cannot join two Costing Groups in one same-month SLOC scope.
4. Removed item immediately appears standalone; new/changed SLOC Group is immediately available in setup and input.
5. Group lead rate auto-fills all members without rounding; standalone rate remains independent.
6. Changed rate invalidates prior verification; missing/zero/pending rate is Dispatch-blocked.
7. Bulk Verify accepts only a clean pending selection and is atomic.
8. Carry-forward is editable and not Dispatch-usable until verified.
9. Explicit/automatic close produces immutable snapshot without converting pending values to verified.
10. Multi-month full-page report compares selected months correctly.
11. ACL follows the locked matrix and company scope; ACL Master retains full access.
12. Dependency scan, migration integrity, focused checks, lint, and build pass; logs record actual results.

## Logs and commit

Append a Gate-27.26 v3 entry to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md`, including migration name/version, Dev migration result, validations, limitations, ACL changes, and dependency scan result. Commit only after verification; push only when the user asks.
