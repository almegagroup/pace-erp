# Task A — 11-Bug Repo Audit

**Date:** 2026-08-03  
**Scope:** Static repo audit before any broad ACL/company-rule refactor  
**Purpose:** Identify which recurring bug patterns are currently confirmed in source, which are only historical/procedural, and which need DB/ACL snapshot verification before code changes.

## Audit Rules

- Business pages and business handlers were audited separately from SA/admin governance screens.
- A pattern is marked **Confirmed active** only when current source shows the behavior directly.
- A pattern is marked **Review next** when the source contains a risky structure, but this scan alone does not prove a live business-page failure.
- A pattern is marked **Needs DB/ACL snapshot** when the issue depends on runtime ACL data, approval-map rows, menu snapshots, or production configuration rather than source alone.

## Summary Matrix

| Bug # | Pattern | Status | Notes |
| --- | --- | --- | --- |
| 1 | Hardcoded rank/role check bypass | Review next | Present in shared/backend code; direct business impact must be verified per route/page before changing. |
| 2 | Company-scope gap | Review next | Many handlers now scope correctly; targeted verification still needed per business flow. |
| 3 | Blanket capability leak | Needs DB/ACL snapshot | Source alone cannot prove which published ACL versions still carry broad grants. |
| 4 | `capture_acl_version_source()` one-time trap | Historical/procedural | Process hazard, not a source bug to refactor in business pages. |
| 5 | ACL-MASTER / DIRECTOR maintenance drift | Needs DB/ACL snapshot | Requires current ACL publish/version data. |
| 6 | Shared `resource_code` reused for different actions | Review next | Needs registry-level audit before any fix. |
| 7 | Maker-checker empty / fallback-only | Needs DB/ACL snapshot | Approval-chain truth lives in data plus approval resources. |
| 8 | Route / ACL registry mismatch | Review next | Historical examples exist; current repo needs route-to-registry verification task. |
| 9 | `acl.approver_map` uniqueness shape | Needs DB/migration audit | Schema/data issue, not FE-source driven. |
| 10 | Small config/data traps | Needs DB/config audit | Includes placeholder UUIDs, exposed schema toggles, counters, copy/migration hygiene. |
| 11 | Wrong company source / single-company auto-resolution bypass | Confirmed active | Multiple business pages still violate the canonical transaction company rule. |

## Confirmed Active Findings

### Bug #11 — Wrong company source / single-company auto-resolution bypass

#### Not OK

- [frontend/src/pages/dashboard/production/ProcessOrderPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ProcessOrderPage.jsx:271)
  uses raw text input for list filtering (`Company ID`) instead of transaction-company runtime behavior.
- [frontend/src/pages/dashboard/production/ProcessOrderPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ProcessOrderPage.jsx:442)
  uses raw text input for create (`Company ID`) instead of the standard transaction selector/read-only single-company behavior.
- [frontend/src/pages/dashboard/production/PackConfigPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PackConfigPage.jsx:162)
  uses raw text input for company filter.
- [frontend/src/pages/dashboard/production/PackConfigPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PackConfigPage.jsx:213)
  uses raw text input for create/update `company_id`.

#### Partial

- [frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx:116)
  uses `availableCompanies`, but still renders a generic dropdown with `ALL`; single-company users are not converted to read-only company context.
- [frontend/src/pages/dashboard/procurement/sales/DOListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/sales/DOListPage.jsx:86)
  uses scoped company options, but still exposes a free company filter UI instead of single-company read-only behavior.
- [frontend/src/pages/dashboard/procurement/gate/GateEntryListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/gate/GateEntryListPage.jsx:133)
  auto-defaults company from runtime context, but still renders a normal select for everyone instead of read-only for single-company users.

#### Safe pattern reference

- [frontend/src/components/inputs/TransactionCompanySelector.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/components/inputs/TransactionCompanySelector.jsx:16)
  is the canonical FE behavior: resolve default company from runtime context, render read-only when not multi-company, and keep dropdown only for allowed multi-company users.
- [supabase/functions/api/_pipeline/context.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_pipeline/context.ts:57)
  already supports safe backend fallback: selected company if valid, otherwise first `user_companies` row ordered by `is_primary DESC`.

## Review-Next Findings

### Bug #1 — Hardcoded rank/role check bypass

These are real code smells, but this Task A scan does not treat every occurrence as an automatic bug. Business impact must be verified route-by-route.

- [supabase/functions/api/_core/admin/company/list_companies.handler.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/admin/company/list_companies.handler.ts:20)
  still uses a hardcoded `MANAGER_OR_SA_ROLES` set. This is acceptable for SA/admin governance, but becomes a business-page bug if any business screen reuses `/api/admin/companies`.
- [supabase/functions/api/_core/production/production.shared.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/production/production.shared.ts:21)
  defines shared manager/SA hardcoded checks for production handlers.
- [supabase/functions/api/_core/om/shared.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/om/shared.ts:32)
  defines shared manager/SA hardcoded checks for OM handlers.
- [supabase/functions/api/_core/procurement/opening_stock.handlers.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/procurement/opening_stock.handlers.ts:85)
  uses hardcoded manager/SA role gating on an approval-sensitive business flow.
- [supabase/functions/api/_core/procurement/l2_masters.handlers.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/procurement/l2_masters.handlers.ts:34)
  contains another manager/SA role gate that should be reviewed against current ACL intent.

### Bug #2 — Company-scope gap

Source review shows many newer handlers now validate company scope explicitly, so this pattern is no longer assumed repo-wide. It still needs targeted flow verification in future tasks, especially for list/detail/create combinations and approval transitions.

Examples of current scoped patterns:

- [supabase/functions/api/_shared/companyScope.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_shared/companyScope.ts:4)
- [supabase/functions/api/_core/procurement/sales_order.handlers.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/procurement/sales_order.handlers.ts:1525)
- [supabase/functions/api/_core/procurement/rtv.handlers.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/procurement/rtv.handlers.ts:337)
- [supabase/functions/api/_core/production/sfg_qa.handlers.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/production/sfg_qa.handlers.ts:178)

### Bug #8 — Route / ACL registry mismatch

Historical evidence exists in the implementation log, so this remains a review task. This Task A pass did not yet perform a full source-to-registry comparison, so no new active mismatch is claimed here without deeper route inventory.

## Historical / Procedural Only

### Bug #4 — `capture_acl_version_source()` one-time trap

- This is a session/process rule, not a business-page code defect.
- The correct fix is operational discipline: every new ACL source capture must use a new version when source data changed.

## Needs DB / ACL Snapshot Verification

These patterns cannot be safely “fixed from source” without reading live ACL/menu/approval data first:

- Bug #3 — blanket capability leak
- Bug #5 — ACL-MASTER / DIRECTOR drift
- Bug #7 — maker-checker chain emptiness or fallback-only behavior
- Bug #9 — `acl.approver_map` uniqueness shape
- Bug #10 — config/data traps

## Task A Conclusion

- The next safe implementation target is **Bug #11 company-rule normalization on business pages**, because the source already proves active violations.
- The next backend review target is **Bug #1 hardcoded role/rank checks**, but only after page/route ownership is confirmed so SA/admin screens are not “fixed” incorrectly.
- Approval, capability, and ACL-version issues must stay behind **DB/ACL snapshot verification** and should not be refactored blindly from source alone.

## Implementation Progress After Task A

### Completed in this session

Bug #11 company-rule normalization was implemented on the following business pages:

- [frontend/src/pages/dashboard/production/ProcessOrderPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ProcessOrderPage.jsx:1)
- [frontend/src/pages/dashboard/production/PackConfigPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PackConfigPage.jsx:1)
- [frontend/src/pages/dashboard/production/BatchVariancePage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/BatchVariancePage.jsx:1)
- [frontend/src/pages/dashboard/production/BatchReleasePage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/BatchReleasePage.jsx:1)
- [frontend/src/pages/dashboard/production/OrderOverviewPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/OrderOverviewPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/sales/DOListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/sales/DOListPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/gate/GateEntryListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/gate/GateEntryListPage.jsx:1)
- [frontend/src/pages/dashboard/production/QAQueuePage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/QAQueuePage.jsx:1)
- [frontend/src/pages/dashboard/production/PartialReversalReportPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PartialReversalReportPage.jsx:1)
- [frontend/src/pages/dashboard/production/ConversionCostPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ConversionCostPage.jsx:1)
- [frontend/src/pages/dashboard/production/BatchNumberReleasePage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/BatchNumberReleasePage.jsx:1)
- [frontend/src/pages/dashboard/production/FgStockBreakdownPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/FgStockBreakdownPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/reports/StockValuationPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/reports/StockValuationPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx:1)

### Verification completed

- Targeted ESLint passed cleanly for all changed files.

### Task D Closure Update - 2026-08-03

Bug #11 company-rule normalization is now treated as complete for the active business-page scope.

#### Additional business pages normalized after the first wave

- [frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/po/POListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/po/POListPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/po/POOrderGroupListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/po/POOrderGroupListPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx:1)
- [frontend/src/pages/dashboard/production/OldPackingPoPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/OldPackingPoPage.jsx:1)
- [frontend/src/pages/dashboard/production/OldProcessPoPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/OldProcessPoPage.jsx:1)
- [frontend/src/pages/dashboard/production/OrderListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/OrderListPage.jsx:1)
- [frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx:1)
- [frontend/src/pages/dashboard/production/PartialBatchReversalPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PartialBatchReversalPage.jsx:1)
- [frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx:1)
- [frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx:1)
- [frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx:1)

#### Intentional exceptions (not Bug #11)

- [frontend/src/pages/dashboard/production/ReversalPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ReversalPage.jsx:1)
  is intentionally company-picker-free because the page's locked design uses globally unique PO numbers to resolve the target order directly.
- [frontend/src/pages/dashboard/procurement/masters/CHAMasterPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/masters/CHAMasterPage.jsx:1)
  is a company-mapping governance page, not a transaction-entry page; explicit company selection is part of the business action.
- [frontend/src/pages/dashboard/procurement/masters/TransporterMasterPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/masters/TransporterMasterPage.jsx:1)
  is also a company-mapping governance page, so explicit company selection remains correct.

#### Non-bug residual references

The following pages still mention `availableCompanies` or company labels, but this Task D close-out does not treat them as active Bug #11 violations because they are already using the canonical transaction selector or only use company rows for display / mapping / route-specific secondary behavior:

- [frontend/src/pages/dashboard/production/PackBomCreatePage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PackBomCreatePage.jsx:1)
- [frontend/src/pages/dashboard/procurement/sto/StoCreateFormPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/sto/StoCreateFormPage.jsx:1)
- [frontend/src/pages/dashboard/procurement/transfer/PlantTransferListPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/procurement/transfer/PlantTransferListPage.jsx:1)
- [frontend/src/pages/dashboard/production/PlanFeedPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/PlanFeedPage.jsx:1)
- [frontend/src/pages/dashboard/production/ChangeBomItemApprovalPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/ChangeBomItemApprovalPage.jsx:1)
- [frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx](/C:/Users/cpalm/Documents/pace-erp/frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx:1)

### Still pending

- Bug #1 / #3 / #5 / #7 / #9 / #10 still require route-by-route review or live DB/ACL snapshot validation before any safe implementation change.

### Task B Closure Update - 2026-08-03

Bug #1 and Bug #2 are now closed for the two highest-confidence procurement backend gaps identified in this audit:

- [supabase/functions/api/_core/procurement/opening_stock.handlers.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/procurement/opening_stock.handlers.ts:1)
  no longer hard-blocks business users with the legacy `assertManagerOrSARole` rank gate. The file now relies on route ACL for permission and applies company-scope checks on list/detail/mutate/post/recalculate flows.
- [supabase/functions/api/_core/procurement/physical_inventory.handlers.ts](/C:/Users/cpalm/Documents/pace-erp/supabase/functions/api/_core/procurement/physical_inventory.handlers.ts:1)
  now validates caller company scope from the storage location's mapped company on create/detail/add/count/recount/post flows, and its list flow is filtered down to the caller's allowed storage locations instead of returning cross-company documents.

Verification completed for this closure:

- `deno check supabase/functions/api/_core/procurement/opening_stock.handlers.ts`
- `deno check supabase/functions/api/_core/procurement/physical_inventory.handlers.ts`
- source sweep confirmed no remaining `assertManagerOrSARole` references in those two files

Boundary note:

- This Task B close-out does not claim that every remaining historical rank-gate or approval-sensitive handler in the repo is solved. It closes the confirmed active business gaps that this audit had already elevated as the next safe backend targets.

### Task C Checkpoint - 2026-08-03

Current review evidence says Task C should stay narrow:

- AC05 and AC06 use `acl.resource_approval_policy`-driven draft vs direct-approve behavior in source, not `acl.approver_map` maker-checker routing.
- MM05 has no `APPROVE` action in `route-acl-registry.ts`, so there is no hidden maker-checker path to "fix" there from source.
- IN06 remains a separate approval-gated page/resource pattern, not a true workflow-engine maker-checker chain.

Because Bug #7 / Bug #9 truth depends on live ACL rows and approval-policy data, any broader Task C claim still needs runtime DB verification rather than source-only assumption.
