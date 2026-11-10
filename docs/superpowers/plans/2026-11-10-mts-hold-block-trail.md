# MTS FG Hold & Block Trail (IN15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company-scoped, Excel-exportable report of every MTS FG quantity put into QI/Blocked — who, what, why, and what happened after — plus a compulsory hold reason on the Verify page.

**Architecture:** Read existing tables (`mts_verify_hold_allocation`, `stock_status_change_posting`, `process_order`) — no duplicate trail table. One new column (`reason`) on the hold table, written by `complete_process_po_verify`. Pure row/summary logic is separated from the DB handler so it can be unit-tested with `deno test`.

**Tech Stack:** Deno edge handlers (TypeScript), Supabase Postgres (plpgsql), React + TanStack Query, shared `useColumnLayouts`, `ErpDenseGrid`.

**Spec:** `docs/superpowers/specs/2026-11-10-mts-hold-block-trail-design.md`

## Global Constraints
- Branch workflow: work on `agent/claude`, promote fast-forward only to `dev`; **never push `main`** (prod deploy) without the owner saying so; no force-push.
- Every id-list `.in()` read uses `fetchInChunks` (§8E); no `.catch(() => [])` on a read; no raw UUID/`pace_code` shown in the UI (§8A).
- Company scope on the report: `resolveAllowedCompanyIds` + `scopeCompanyIds`; a denied company yields nothing.
- Migration: build `complete_process_po_verify` from the **live** DB definition; afterwards `NOTIFY pgrst, 'reload schema'`, reconcile `schema_migrations`, run `node scripts/migration-integrity-check.mjs`.
- New resource code `PROD_MTS_HOLD_TRAIL` (never reuse); new `acl_versions` row for the ACL change.
- Verify with `deno check` (before/after identical error set), `eslint`, the six CI guards, `vite build`. Dev project id `ytapuwiqicmvpanmzelb`; prod is never written.

## Review Focus
- Hold with `reason = NULL` (legacy row) → report shows "—", never blank/crash.
- Process PO later `REVERSED` → its HOLD rows show "Reversed with Process PO", and are excluded from the SKU "held" summary.
- A reversed IN13 posting and its reversal row must not be counted twice in the summary.
- Verify-written status rows (batch set) must not show up a second time as STATUS CHANGE events (only `batch_number IS NULL` rows do).
- Caller whose company is not allowed gets an empty report, not another company's data.

---

### Task 1: Hold reason — DB migration
**Files:** Create `supabase/migrations/20261110100000_mts_hold_reason.sql`
**Interfaces:** Produces `erp_production.mts_verify_hold_allocation.reason text NULL`; `complete_process_po_verify` reads `hold_allocations[].reason` and `status_postings[].reason`.
- [ ] **Step 1:** Fetch the live definition: `SELECT pg_get_functiondef('erp_production.complete_process_po_verify(uuid,jsonb,jsonb)'::regprocedure)` on dev; use it (not the migration file text) as the base.
- [ ] **Step 2:** Write the migration: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS reason text`; `CREATE OR REPLACE` the function with exactly two edits — the hold-allocation INSERT also writes `row_json->>'reason'`, and the SSC INSERT's reason becomes `COALESCE(NULLIF(v_item->>'reason',''), 'MTS Verify QA stock allocation')`.
- [ ] **Step 3:** Prove it on dev in a rolled-back transaction: call the function with a synthetic `mts_verify` context (or inspect the generated definition) and assert the hold row and the SSC row carry the reason; assert a hold with no reason still inserts (reason NULL, SSC fallback text).
- [ ] **Step 4:** Apply to dev, reconcile `schema_migrations` version to the file's timestamp, `NOTIFY pgrst, 'reload schema'`, run the integrity check (`in_sync = true`).
- [ ] **Step 5:** Commit.

### Task 2: Hold reason — backend validation
**Files:** Create `supabase/functions/api/_core/production/mts_hold_reason.ts`, `mts_hold_reason.test.ts`; Modify `process_order.handlers.ts` (`runMtsProcessOrderVerify` holds loop ~5390-5430, `statusPostingGroups` ~5577, urgent submit ~5164).
**Interfaces:** Produces `normalizeHoldReason(raw: unknown): string | null` (trim, collapse whitespace, `null` when empty, throws `PROD_MTS_HOLD_REASON_TOO_LONG` over 500 chars) and `mergeHoldReasons(reasons: Array<string | null>): string | null` (distinct, input order, joined with `"; "`).
- [ ] **Step 1:** Write tests: `normalizeHoldReason("  too   late ")==="too late"`, `normalizeHoldReason("   ")===null`, 501 chars throws `PROD_MTS_HOLD_REASON_TOO_LONG`; `mergeHoldReasons(["a","b","a",null])==="a; b"`, `mergeHoldReasons([null])===null`.
- [ ] **Step 2:** Run `deno test mts_hold_reason.test.ts` → FAIL (module missing); implement; run → PASS.
- [ ] **Step 3:** In `runMtsProcessOrderVerify`, require a non-null reason for every `requestedHold` → `poErr(..., "PROD_MTS_HOLD_REASON_REQUIRED", 422, "Every MTS QA hold needs a reason.")`; put `reason` on each `holdAllocations` push and `mergeHoldReasons` onto each merged `statusPostings` group. Apply the same required check in the urgent submit path before `request_mts_urgent_manager_approval` (it stores `body.holds` verbatim, so the reason replays on manager approval).
- [ ] **Step 4:** `deno check` before/after → identical error set; commit.

### Task 3: Verify page — Reason field
**Files:** Modify `frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx` (holds state ~232-262 and hold block render ~362).
**Interfaces:** Each hold object in the payload gains `reason: string`.
- [ ] **Step 1:** Add `reason: ""` to a new hold's initial state; render a required "Reason" text input in each hold block; include `reason` in the mapped `holds` payload (~260); disable Submit while any hold has an empty trimmed reason and show the message "Enter a reason for every hold."
- [ ] **Step 2:** `eslint` on the file, run `scripts/frontend-payload-guard.mjs` + `jsx-no-undef-guard.mjs`; commit.

### Task 4: Trail logic (pure) + handler
**Files:** Create `supabase/functions/api/_core/production/mts_hold_trail.logic.ts`, `mts_hold_trail.logic.test.ts`, `mts_hold_trail.handlers.ts`.
**Interfaces:**
- `type HoldRow`, `type SscRow` (fields as read from the two tables, plus `process_order_status`).
- `buildTrailEvents(holds: HoldRow[], sscRows: SscRow[]): TrailEvent[]` — HOLD events from `holds`; STATUS CHANGE events from `sscRows` where `batch_number == null` and (`from_stock_type` or `to_stock_type` ∈ {QUALITY_INSPECTION, BLOCKED}); sorted newest first; a HOLD whose `process_order_status === "REVERSED"` has `state: "Reversed with Process PO"`.
- `computeHeldSummary(sscRows: SscRow[]): Array<{ material_id: string; qi_kg: number; blocked_kg: number }>` — only `status === "POSTED"` and `reversal_of_posting_id == null` rows; + into QI/BLOCKED, − out of them.
- `getMtsHoldTrailHandler(req: Request, ctx: ProdHandlerContext): Promise<Response>` → `{ items, summary, total }`.
- [ ] **Step 1:** Write failing tests with the Review Focus cases: legacy `reason: null` → `reason_display "—"`; reversed Process PO → state + excluded from summary; a REVERSED posting plus its reversal row → summary 0; Verify-written row with a batch is not a STATUS CHANGE event; QI→UNRESTRICTED row subtracts from `qi_kg`.
- [ ] **Step 2:** Run → FAIL; implement `buildTrailEvents` / `computeHeldSummary`; run → PASS.
- [ ] **Step 3:** Implement the handler: `assertProdReadRole`, parse `company_ids`/`company_id`, `date_from`/`date_to` (required, ≤365 days, reuse the PR24 helpers), `material_ids`, `status`; scope via `resolveAllowedCompanyIds`/`scopeCompanyIds`; read hold rows (+ their Process PO / Packing PO number, status), SSC rows, materials, user names (`resolveUserDisplayNames`) all with `fetchInChunks`, errors returned not swallowed; summary uses the SSC rows **without** the date filter (a balance, not a period figure) restricted to the requested SKUs/companies.
- [ ] **Step 4:** `deno test` PASS, `deno check` identical error set; commit.

### Task 5: Route, ACL registry, frontend page
**Files:** Modify `_routes/production.routes.ts` (case next to `mts-register`, line ~450), `_acl/route-acl-registry.ts` (next to line ~753), `frontend/src/pages/dashboard/production/prodApi.js`, `navigation/screens/projects/operationModule/operationScreens.js`, `router/AppRouter.jsx`; Create `frontend/src/pages/dashboard/production/MtsHoldTrailPage.jsx`.
**Interfaces:** `getMtsHoldTrail(params): Promise<{ items, summary, total }>`; screen `PROD_MTS_HOLD_TRAIL`, route `/dashboard/production/mts-hold-trail`.
- [ ] **Step 1:** Wire `GET:/api/production/mts-hold-trail` (registry: `skipAcl:false, resourceCode:"PROD_MTS_HOLD_TRAIL", action:"VIEW"`); run `scripts/route-acl-registry-guard.mjs` → PASS.
- [ ] **Step 2:** Build the page from the Gate Entry Report template (Page 1 filters: Company, Event Date From/To default last 30 days, SKU multi, QI/Blocked checkboxes; Page 2: summary strip, grid, Columns picker code `MTS_HOLD_TRAIL`, Search all columns, Excel export with criteria preamble, Back/Esc, F8); no `stickyFirstColumn`, no fixed column.
- [ ] **Step 3:** `eslint`, the CI guards (`wrong-company-source`, `jsx-no-undef`, `frontend-payload`, `hardcoded-role-check`), `vite build`; commit.

### Task 6: Menu + ACL on dev, verify, promote
**Files:** none (data via MCP on dev); Modify `docs/superpowers/plans/...` checklist only.
- [ ] **Step 1:** Confirm IN15 / `PROD_MTS_HOLD_TRAIL` are unused on dev; confirm IN13's parent group.
- [ ] **Step 2:** Insert `erp_menu.menu_master`, `acl.menu_master`, `erp_menu.menu_tree` (parent = IN13's group), `(CAP_EVERYONE_REPORTS, PROD_MTS_HOLD_TRAIL, VIEW)`; create a **new** `acl_versions` row per company, `capture_acl_version_source`, `generate_acl_snapshot`, `rebuild_acl_menu_snapshot`; run `scripts/acl-master-drift-check.mjs` SQL for P0076 and fix any gap.
- [ ] **Step 3:** Assert via SQL that a normal user's menu snapshot contains IN15; promote `agent/claude` → `dev` fast-forward; report prod steps (migration, menu/ACL re-run) for the owner. No `main`.
