# MTS Customer Plan (three-tab page) — Implementation Status

Date: 2026-10-14 · Branch: `agent/claude` · Owner authorisation: PR #654 comment 6166365454; specs on `agent/chatgpt` (31dbfee, a718f34).
Scope: one Procurement page, exactly three tabs. **No historical import, no Production/Dispatch integration, no PROD write, no deploy, no merge.**

## What is built

| Layer | File | Notes |
|---|---|---|
| DB migration | `supabase/migrations/20261014150000_erp_planning_mts_customer_plan.sql` | New `erp_planning` schema (owner T04). `customer_plan_line` (append-only, versioned), `stroke_plan_setting` / `_period` / `_group_primary`, triggers that forbid delete/edit, `mts_company_skus()`, `customer_plan_effective()`, atomic `save_customer_plan_lines()` and `save_stroke_plan_setting()`. RLS on, service-role only. |
| DB tests | `supabase/tests/erp_planning_customer_plan.test.sql` | 13 scenario checks; always rolls back. |
| Backend logic | `supabase/functions/api/_core/procurement/mts_customer_plan.logic.ts` (+ `.logic.test.ts`) | Month parsing, entry UoM (base, MT only for KG base, fixed material conversions only), line validation, report pivot. |
| Backend API | `supabase/functions/api/_core/procurement/mts_customer_plan.handlers.ts` | 8 routes under `/api/procurement/mts-plan/*`; routes + registry wired. |
| Frontend | `frontend/src/pages/dashboard/procurement/planning/MtsCustomerPlanPage.jsx` | 3 tabs; every table = `ErpDenseGrid` with Excel cell navigation + column filter; Excel-paste into qty column; history drawer; Excel export of the report (only visible columns/rows). |
| Registration | `operationScreens.js` (`PROC_MTS_CUSTOMER_PLAN`, `/dashboard/procurement/mts-customer-plan`), `AppRouter.jsx`, `procurementApi.js`, `PAGE-DEPENDENCY-MANIFEST.json` | |
| ACL data | `docs/mts-planning/acl/MTS-CUSTOMER-PLAN-ACL-PROVISIONING.sql` | **Applied to PROD 2026-10-14** (owner approval). Uses TX code PO21; refuses to run if PO21 is already taken by another menu. |

## Business rules implemented (owner)

- Grain: company × month × SKU × plan type, versioned. No customer/depot field.
- Effective plan = latest **Final** if entered for that SKU-month, else latest **Rolling**, plus every **Additional**, plus every **Urgent Extra**. Final replaces Rolling only for the SKU-months it covers.
- **Urgent From Existing Plan** re-phases existing quantity, never adds; its total may not exceed (Final or Rolling) + Additional for that SKU-month. A Final/Rolling reduction that would strand an existing From-Plan allocation is rejected too.
- Every save creates a new version; cancel = new cancelled version; nothing is overwritten or deleted (enforced by DB triggers).
- Blank (no plan) stays blank; an entered 0 is a real 0.
- **Tab 2 carry-forward (owner 2026-10-15, migration `20261015090000`):** Use Primary Y/N is stored in `stroke_group_primary_decision` with an `effective_month`; the value for a month = latest decision on or before it (none = Yes), so a change applies from that month onward until a later month changes it. Stroke periods stay month-only (a month with no setting uses the current stroke). Saving only Use Primary does not create a stroke setting for that month. Applied + tested on DEV (T13/T14); **PROD not yet applied**.
- Tab 2: per company × month × Prodshade, versioned stroke periods (inside the month, no overlap, APPROVED MTS strokes of that company/Prodshade only) and Use Primary Y/N per **Stroke × RM group** (only groups on that stroke's own lines). Default = current MTS stroke, whole month, Use Primary = Yes. Stroke Master is never changed. No PM primary control.
- Tab 3: non-contiguous year/month selection, PLAN row per SKU, month columns in chronological order. Show Production / Show Dispatch checkboxes exist but stay disabled with a "not available yet" reason (owner has not designed the sources) — no zeros are shown.

## Access (owner, 2026-10-14) — enforced by ACL, not code

| Who | View | Additional / Urgent | Rolling / Final + Tab 2 |
|---|---|---|---|
| SCM (SUPPLY CHAIN), DIRECTOR, ACL-MASTER | ✓ | ✓ | ✓ |
| STORES, LOGISTICS (users + their managers, not L4_MANAGER) | ✓ | ✓ | — (shown disabled) |
| Plant Head (L3_MANAGER under MANAGEMENT) | ✓ | ✓ | — (shown disabled) |
| Everyone else | — | — | — |

Resources: `PROC_MTS_CUSTOMER_PLAN` (VIEW, WRITE) and companion `PROC_MTS_CUSTOMER_PLAN_MAINTAIN` (WRITE). Each handler re-checks the page-selected company's grant.

## Tests run (2026-10-14)

| Check | Result |
|---|---|
| DB scenario tests on DEV (rolled back) | 13/13 pass; 0 rows left behind |
| Deno unit tests (`mts_customer_plan.logic.test.ts`) | 7/7 pass |
| `deno check` new handlers | clean |
| `deno check` procurement routes | 96 errors before = 96 after (all pre-existing, none in new files) |
| `eslint` page + touched frontend files | clean |
| `vite build` | succeeds |
| CI guards: route-ACL registry, company scope, company-scope write ACL, hardcoded role, resource-code domain, wrong company source, frontend payload, JSX no-undef, stock posting, approver chain, dependency manifest (strict) | all pass |
| SKU resolver vs PROD (read-only, same SQL) | CMP003 33, CMP005 22, CMP011 4 unique SKUs; 0 ambiguous |

## DEV state

- Migration applied to DEV and history reconciled to version `20261014150000`; `NOTIFY pgrst` sent.
- DEV migration history also contains `20261014120000_do_list_dispatch_date_filter`, which is not on this branch (someone else's work) — `migration-integrity-check` will report it as drift until that branch lands.

## Blockers before anyone can click through the page

1. ~~TX code approval~~ — **PO21 approved** (2026-10-14); provisioned on PROD (see PROD rollout).
2. **`erp_planning` must be added to Exposed schemas** in the Supabase Dashboard (DEV now, PROD later) — platform config, cannot be done by migration or MCP. Until then every `/mts-plan` API call returns a PostgREST schema error.
3. Then run the provisioning SQL on DEV + ACL version bump/capture/snapshot (steps in the SQL header), and test with SCM, Stores and Plant Head users.
4. PROD: migration + Exposed schemas + provisioning only with separate explicit owner approval.

## TX code — PO21 (owner approved 2026-10-14; registered by the provisioning SQL when it is run)

PROD `PO` codes in use: PO01–PO14, PO16–PO19. **Recommend `PO21`.**
- `PO15` is free but was "previously retired/skipped" (feasibility doc, PO19 tx-code note: "PO15 previously retired/skipped") — reusing it risks confusion with old references.
- `PO20` is already earmarked in planning docs for "Credit Notes (Vendor)" (Returns & Claims slice).
- `PO21` is the first code with no history and no reservation, and keeps the page inside the Procurement `PO` family where PO11 Procurement Planning already sits.

## PROD rollout (2026-10-14/15, owner approved)

- Migration `20261014150000` applied to PROD (history shows the same version).
- ACL provisioning SQL applied; menu PO21 under `GRP_ACL_PROCUREMENT`.
- New active ACL versions: CMP003 v131, CMP005 v27, CMP011 v27 — captured, snapshot generated, menu snapshots rebuilt.
- Verified in `precomputed_acl_view`:
  - Full (VIEW + WRITE + MAINTAIN:WRITE): SCM P0004, P0005, P0006, P0077; Director / ACL-MASTER P0074, P0076.
  - VIEW + WRITE only (Additional / Urgent): Stores — CMP003 P0009, P0013, P0014, P0024, P0055–P0059; CMP005 P0097; CMP011 P0084, P0088, P0090, P0092, P0094. Plant Head — P0003, P0065, P0100.
  - No LOGISTICS users exist in these three companies today.
- Exposed schemas: DEV's `authenticator` role override already lists `erp_planning`. PROD has **no** role override, so the PROD Dashboard → API → Exposed schemas list governs; `erp_planning` must be added there by hand (not verifiable from the agent container — outbound to the PROD API is blocked).

## Not done (by instruction)

Historical Google Sheet import (`LEGACY_GOOGLE_SHEETS` source value is reserved in the schema), Production / Dispatch rows in the report, requirement explosion, PROD writes, deployment, merge.
