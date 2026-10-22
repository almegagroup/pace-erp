# PO21 / PO22 Release Checklist — 2026-10-20

Release of the PO22 Requirement + Planning engine (Method C, D13) and the PO21 additions
(Show in MT, Production/Dispatch totals, cross-company production) for **CMP003, CMP005, CMP011**.

> **Nothing in this file has been executed on PROD.** Every write step below needs the
> business owner's explicit go-ahead. Only the read-only checks in §2 were run (2026-10-20,
> PROD project `bsjpvkigpllichlknmah`).

---

## 1. What is being released

`dev` is ahead of `main` by ~40 commits (all fast-forward). Main pieces:

| Area | What |
|---|---|
| PO22 Requirement | Method C allocation (D13): own demand first, Target/Critical protection, narrow group first, most-free member first, member surplus before buying; a monthly unchecked member is never bought by the engine, while its existing stock/inbound may still serve the group |
| PO22 Requirement | Sub-CSN (Distribution mode) inbound / sender commitment, STO CSN by effective destination, lead-time delay history + suggested Target/Critical (no Booking Time) |
| PO22 Planning | Day-major projection with group draws, cost-to-cost member choice, Action tab (Critical + Replenishment), Store usage schedule (month label, product groups, document name, **R→R transfer note**), AI explanation (budget-capped) |
| PO22 inputs | Vendor MOQ / multiple / lot / supply UoM / Booking Time, item carrying Rate, FX table, BOE rate, company interest %, counted-location policy (D12) |
| PO21 | Show in MT toggle; Production + Dispatch Prodshade/Child/Mother/Grand totals; cross-company production (plan made at another company) |

---

## 2. PROD read-only validation (2026-10-20)

| Check | Result |
|---|---|
| PROD migration history vs `main` | **Identical** — last applied `20261017130000`, every `main` migration since 15 Oct present |
| Pending migrations (dev only) | 6 — see §3. None of their objects exist in PROD (`company_planning_location_policy`, `mts_planning_run`, `mts_ai_usage`, `company_planning_finance`, `currency_exchange_rate`, `customer_plan_production_company`, new `vendor_material_info` columns — all MISSING, as expected) |
| Dependencies the migrations need | Present: `erp_planning.material_requirement_policy`, `guard_append_only`, `mts_company_skus`, `customer_plan_effective`, `save_material_requirement_policies` |
| ACL resources in PROD | Only PO21's: `PROC_MTS_CUSTOMER_PLAN`, `_MAINTAIN`, `PROC_MTS_PLAN_GROUP_MAINTAIN`. **PO22 not provisioned at all** (no `PROC_MTS_REQUIREMENT*`, `PROC_MTS_OPTIMIZER_*`, no PO22 menu row) — PO22 is invisible in PROD today |
| Active ACL versions | CMP003 v133, CMP005 v29, CMP011 v29 (all captured) → new versions needed (v134 / v30 / v30) |
| Location mapping (seed source for D12) | CMP003: F001-F003, L003, OT01, P001-P003, R001-R003, S001-S003, T003 · CMP005: F001, F002, OT01, P001, P002, R001, R002, S001, S002 · CMP011: F001, OT01, P001, R001, S001 — every location holding stock is mapped, so the seed covers all of them |
| Target / Critical days | **0 policy rows in all three companies** → nothing is protected (Method C rule 2 is a no-op) and the Action tab has no Critical line until entered. **Release blocker for accuracy** — see §5 |
| Group primary decisions | Each company must select at least one authorised member for every group/month that needs a new buy. With no selection, the shortage remains visible and no engine PO recommendation is created. |
| Cross-company readiness | All **22** CMP005 MTS SKUs and all **4** CMP011 MTS SKUs are also resolved MTS SKUs of CMP003 → "Made at CMP003" can be saved for every one of them |
| Plan lines (Oct onward) | CMP003 96 · CMP005 96 · CMP011 16 |
| Transfer-source stock | CMP003 R003 ≈ 117,647 (UNRESTRICTED) → R→R notes will appear for CMP003 only |

Earlier PROD runs of the engine against snapshots (task #16, same session) already confirmed the
Sub-CSN receipts (CMP011/CMP005, 17 Nov), the CMP005 zero-stock materials (~25) and the PM group
shortages (EXT_40_KG from 19 Nov, TOT_30KG). Re-check those after go-live with real settings.

---

## 3. Migrations — apply in this order (owner approval required)

1. `20261019070346_mts_optimizer_phase3b_selection_save_rpc.sql`
2. `20261019120000_po22_planning_cost_inputs.sql` (adds nullable columns to `vendor_material_info`, `material_requirement_policy`, `consignment_note` — no data change)
3. `20261019130000_po22_planning_location_policy.sql` (creates the table **and seeds** D12 roles for the 3 companies)
4. `20261019140000_po22_planning_run.sql`
5. `20261019150000_po22_ai_usage_budget.sql`
6. `20261020120000_po21_plan_production_company.sql`

After each apply (CLAUDE.md §8A):
- reconcile `supabase_migrations.schema_migrations.version` to the local filename timestamp
- `NOTIFY pgrst, 'reload schema';`
- at the end: `node scripts/migration-integrity-check.mjs` on PROD → `in_sync = true`

`erp_planning` must already be in PROD's PostgREST *Exposed schemas* (PO21 works in PROD, so it
is) — confirm in the Dashboard anyway.

---

## 4. ACL provisioning (owner approval required)

Run, in order, the files under `docs/mts-planning/acl/` (each is idempotent):
1. `MTS-REQUIREMENT-ACL-PROVISIONING.sql` — PO22 menu + `PROC_MTS_REQUIREMENT` / `_POLICY`
2. `MTS-OPTIMIZER-PHASE-3B-ACL-PROVISIONING.sql` — `PROC_MTS_OPTIMIZER_INPUT` / `_SELECTION`
   **Owner decision 2026-10-20: PO22 full authority = SCM, ACL-MASTER and Director only** —
   both files above grant PO22 resources to `CAP_MTS_PLAN_FULL` only (SUPPLY CHAIN / DIRECTOR /
   ACL-MASTER work contexts, verified PROD). Stores / Logistics / Plant Head do not get PO22.
3. `MTS-CUSTOMER-PLAN-ACL-PROVISIONING.sql` — re-run for the new companion
   `PROC_MTS_PLAN_PRODUCTION_COMPANY` (WRITE → `CAP_MTS_PLAN_FULL` = SCM / Director / ACL-MASTER,
   owner: "procurement team")

**All of §4 in one transaction: `docs/mts-planning/acl/PO22-PROD-ACL-ROLLOUT.sql`** (R-04 MCP runbook — provisioning + version bump + verification that aborts on any unrelated change).

What it does per company (CLAUDE.md §8 second correction — re-capturing an existing version is a silent no-op):
- create a **new** `acl_versions` row (CMP003 → 134, CMP005 → 30, CMP011 → 30)
- `acl.capture_acl_version_source(new_version, company, actor)`
- `acl.generate_acl_snapshot(new_version, company)`, activate per runbook
- `public.rebuild_acl_menu_snapshot(...)` for the users concerned
- `node scripts/acl-master-drift-check.mjs` → P0076 covers every new resource

---

## 5. Data setup before the first real run

| # | Item | Who | Notes |
|---|---|---|---|
| 1 | **Target / Critical days** per material (PO22 Settings) | Users (SCM) — owner 2026-10-20 | Currently 0 everywhere. Use "Suggested T / C (no booking)" + Use button as a start. Without it no stock is protected |
| 2 | Location policy (D12) | SCM | Seeded by migration 3: COUNTED R001 R002 S001 S002 P001 P002; TRANSFER_SOURCE R003; EXCLUDED OT01/OT02, F-series, S003/P003/T003/L003. Review per company in Settings |
| 3 | Group primary (D3) for CMP005 / CMP011 | SCM | Required before a new buy — choose at least one member in every required month; unchecked members are not substituted |
| 4 | Vendor MOQ / multiple / lot / Booking Time | Procurement | Optional; missing = no rounding / no booking buffer |
| 5 | Item carrying Rate, company interest %, FX rates | Accounts / Procurement | Needed only for cost-to-cost comparison; missing = comparison falls back to price + landed cost |
| 6 | Cross-company assignments (PO21 Plan Entry → "Cross company") | Procurement | e.g. CMP005 SKU-months made at CMP003. One SKU-month goes wholly to one company |

---

## 6. Environment (Render, PROD API)

| Variable | Purpose | Required |
|---|---|---|
| `AI_CORE_ENABLED=true` | turns on the PO22 AI explanation | **yes — owner wants AI on (2026-10-20)** |
| `ANTHROPIC_API_KEY` | AI provider key | yes — owner: already set on Render |
| `PO22_AI_MONTHLY_TOKEN_CAP` | monthly token budget (default 1,000,000) | optional |

Without them the AI button answers "AI explanations are switched off" — everything else works.

---

## 7. R→R transfer note (source contract §5)

- The Store schedule's **"Transfer first"** column and the Requirement tab's transfer suggestion are
  **advice only**. Nothing is posted, no STO / location transfer is created, no stock is assumed moved.
- A transfer is suggested **only between R stores** (raw-material stores, R-series codes). Every
  source must be an R store (D12: R003); the destination is an R store among the counted locations
  (R001 / R002), or "an R store (destination UNKNOWN)" — never S / P / F, never invented.
  (Fixed 2026-10-20: the destination list used to include counted shop-floor / packing locations.)
- Qty = min(stock in the R source, the part of the schedule counted stock cannot back). Group
  remainders are split over members' R-source stock, largest first, never twice.
- Stock in a non-R "other" location is shown on the Requirement tab as "Held at …
  (not an R→R transfer)" and is never counted.
- Physical R→S issue to shop floor stays entirely with Store / Plant operators.

---

## 8. Deploy and smoke test

1. PR `dev` → `main`; on merge `.github/workflows/deploy-prod.yml` runs `supabase db push` on PROD
   (applies the §3 migrations). Then check `schema_migrations` + PostgREST reload.
2. Then §4 ACL (owner approval) and §6 env.
3. Wait for Render (API) + frontend deploy.
4. Smoke test with a procurement user, per company (CMP003, CMP005, CMP011):
   - PO21: Report → "Show in MT" divides KG by 1000; Production / Dispatch totals appear when shown
   - PO21: Plan Entry → tick "Cross company" for one CMP005 SKU-month, pick CMP003, Save → CMP005 report shows `@CMP003`, CMP003 report shows "(from CMP005)" PLAN row
   - PO22: Settings → locations seeded; enter Target/Critical for a few materials
   - PO22: Requirement run → no 500; Sub-CSN / STO inbound visible; CMP005 SKU-month made at CMP003 counted in CMP003, not CMP005
   - PO22: Planning run → Action tab, Store schedule (R→R note for CMP003 R003 materials only)
5. `SELECT * FROM erp_inventory.stock_health_check();` — unchanged (this release posts no stock).

## 9. Rollback

- Frontend / API: revert `main` to the previous SHA (no stock or document writes are involved).
- Migrations are additive (new tables, nullable columns, new functions); leaving them in place is
  harmless. ACL: re-activate the previous version (CMP003 v133, CMP005 v29, CMP011 v29).

## 10. Known limits

- One SKU-month cannot be split between two producing companies.
- The owner company still sees its plan in the PO21 report (tagged `@CODE`); its PO22 ignores it.
- Pre-existing, unrelated: `mts_optimizer_phase3b.persistence.test.ts` has a type error
  (`materials` missing); `planning.readonly.test.ts` needs service-role credentials.
