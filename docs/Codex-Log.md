# Codex Log

This file is Codex's own work log for the Claude+Codex workflow, used to record Codex-specific actions, decisions, and completed tasks in a concise running history that can be extended over time.

## Template

### YYYY-MM-DD HH:MM TZ
- Task:
- Changes:
- Notes:

## Entries

### 2026-06-24 08:34 IST
- Task: Created `docs/Codex-Log.md`.
- Changes: Added the header, a reusable template section, and the initial log entry.
- Notes: Created as the starting work log for the Claude+Codex workflow.

### 2026-06-24 08:35 IST
- Task: Redesigned PO Create across the frontend page and procurement PO API handlers.
- Changes: Moved Payment Term and Freight Term from header-level inputs to each material line, added a per-line drawer for Remarks and Rebate details (rate, basis, remarks), added a header-level drawer for GST Terms and repeatable Extra Fields, and relabeled the per-line delivery date field to `ETD` for Domestic POs or `ETA to Port` for Import POs.
- Notes: Files touched were `frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx` and `supabase/functions/api/_core/procurement/po.handlers.ts`.

### 2026-06-24 12:27 IST
- Task: Reworked PO create line details and materials extras UI in the frontend page.
- Changes: Moved GST Terms from the header-level drawer into each line's `LineMoreDrawer`, added per-line `gst_terms` state and payload mapping, removed the header `More Details` flow entirely, added a `+ Add Field` Materials action, and rendered `extra_fields` inline under the materials grid with per-row remove controls.
- Notes: Edited only `frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx` and appended this log entry.

### 2026-06-24 12:32 IST
- Task: Updated PO create backend GST term handling to validate per material instead of at the header/group level.
- Changes: Removed top-level `gst_terms` parsing and validation from `createPOHandler`, stopped writing `gst_terms` onto `erp_procurement.po_order_group`, and added optional per-material validation from `materialRecord.gst_terms` inside the materials loop while leaving the `purchase_order` insert unchanged.
- Notes: A migration adding a `gst_terms` column to `erp_procurement.purchase_order` is still required before the per-line value can be persisted; right now the handler validates `materialRecord.gst_terms` and then silently drops it.

### 2026-06-24 12:45 IST
- Task: Added reusable Procurement user display-name resolution and applied it to PO and PO-order-group responses/UI.
- Changes: Created `supabase/functions/api/_shared/resolveUserDisplayNames.ts`, updated `supabase/functions/api/_core/procurement/po.handlers.ts` to append `*_by_display` siblings across returned PO, PO line, PO order-group, approval-log, and amendment-log payloads via one batched resolver pass per response, and updated `frontend/src/pages/dashboard/procurement/po/POListPage.jsx` to render `created_by_display` with fallback to the raw UUID.
- Notes: Files touched were `supabase/functions/api/_shared/resolveUserDisplayNames.ts`, `supabase/functions/api/_core/procurement/po.handlers.ts`, `frontend/src/pages/dashboard/procurement/po/POListPage.jsx`, and `docs/Codex-Log.md`.

### 2026-06-24 15:33 IST
- Task: Replaced raw PO master UUIDs with readable company and line-item display values in procurement PO detail/list responses and the PO detail UI.
- Changes: Added batched PO reference lookups in `supabase/functions/api/_core/procurement/po.handlers.ts` so PO detail responses now include `company_name`, `material_display`, `cost_center_display`, and `payment_term_display`, extended the PO list response with `company_name`, updated `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` to render the company name in the header, replaced the line material UUID cell with the formatted material display, and inserted Cost Center and Payment Term columns after Rate.
- Notes: Kept the lookup strategy to one query per master table across the returned lines to avoid N+1 queries and left existing fallbacks to raw IDs in place when a display value is missing.

### 2026-06-24 15:42 IST
- Task: Surfaced additional purchase-order header, rebate, and audit fields already present in the PO detail API response.
- Changes: Updated `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` to add GST Terms, ETD/ETA, and Remarks to the Header card, inserted a conditional Rebate card for `has_rebate`, and added an Audit card showing resolved creator/updater/cancel/knock-off display names using `ErpFieldPreview`.
- Notes: Matched the ETD vs `ETA to Port` label to the existing PO create-page import logic by checking vendor type first and falling back to `po.delivery_type`.

### 2026-06-24 16:17 IST
- Task: Added DRAFT-only purchase-order editing on the procurement PO detail page.
- Changes: Updated `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` to load payment terms and company-scoped cost centers, show an `Edit` action only for DRAFT POs, initialize a draft-edit modal from the loaded PO, and submit the backend-compatible single-line payload through `updatePurchaseOrder()` before reloading the detail view.
- Notes: Tried to run `frontend` lint on the touched file, but the local Node/npm process was blocked by a filesystem `EPERM` on `C:\Users\cpalm`, so this change was verified by code inspection only.

### 2026-06-24 17:49 IST
- Task: Completed TanStack Query migration section 1 for Procurement PO detail.
- Changes: Updated `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` to replace local vendors, payment terms, cost centers, PO detail, and CSN fetch state/effects with shared query hooks plus page-specific `useQuery` calls keyed by PO id/company context so remount and back-navigation reuse cache while preserving existing edit, amendment, and audit behavior.
- Notes: Verified with `npm.cmd run build` in `frontend/` after the refactor.

### 2026-06-24 18:33 IST
- Task: Completed TanStack Query migration section 2 for the remaining Procurement screens and shared query foundation files.
- Changes: Added the shared React Query foundation and query-hook convention in `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/main.jsx`, `frontend/src/hooks/queries/README.md`, `frontend/src/hooks/queries/queryClient.js`, `frontend/src/hooks/queries/queryKeys.js`, `frontend/src/hooks/queries/queryUtils.js`, `frontend/src/hooks/queries/useHrMasterQueries.js`, `frontend/src/hooks/queries/useOmMasterQueries.js`, and `frontend/src/hooks/queries/useProcurementMasterQueries.js`; migrated the remaining Procurement screens to shared master-data hooks plus page-level `useQuery` caching in `frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx`, `frontend/src/pages/dashboard/procurement/gate/GateEntryCreatePage.jsx`, `frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/masters/CHAMasterPage.jsx`, `frontend/src/pages/dashboard/procurement/masters/DomesticLeadTimeMasterPage.jsx`, `frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx`, `frontend/src/pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx`, `frontend/src/pages/dashboard/procurement/masters/PaymentTermsMasterPage.jsx`, `frontend/src/pages/dashboard/procurement/masters/PortTransitMasterPage.jsx`, `frontend/src/pages/dashboard/procurement/masters/TransporterMasterPage.jsx`, `frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockListPage.jsx`, `frontend/src/pages/dashboard/procurement/po/POOrderGroupDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/qa/QADocumentPage.jsx`, `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx`, `frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx`, `frontend/src/pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx`, `frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx`, `frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx`, `frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx`, `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/sto/STOCreatePage.jsx`, and `frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx`.
- Notes: Verified with `npm.cmd run build` in `frontend/` after the refactor; procurement grep targets for duplicated `listVendors|listCostCenters|listPaymentTerms|listCompanies|listMaterials` fetches now resolve through the shared query hooks.

### 2026-06-24 19:06 IST
- Task: Completed TanStack Query migration section 3 for the Operation Management module.
- Changes: Migrated OM list, create, and detail screens to shared master-data query hooks plus page-level `useQuery` caching in `frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx`, `frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx`, `frontend/src/pages/dashboard/om/asl/AslListPage.jsx`, `frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx`, `frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx`, `frontend/src/pages/dashboard/om/customer/CustomerListPage.jsx`, `frontend/src/pages/dashboard/om/material/MaterialCreatePage.jsx`, `frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx`, `frontend/src/pages/dashboard/om/material/MaterialListPage.jsx`, `frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx`, and `frontend/src/pages/dashboard/om/vendor/VendorListPage.jsx`.
- Notes: Verified with `npm.cmd run build` in `frontend/`; OM master lookups now flow through the shared query-hook pattern and detail/list remounts reuse cached query data for back-navigation.

### 2026-06-24 19:37 IST
- Task: Completed TanStack Query migration section 4 for the HR module.
- Changes: Extended the shared HR query layer in `frontend/src/hooks/queries/queryKeys.js` and `frontend/src/hooks/queries/useHrMasterQueries.js`, migrated shared HR workspaces and report screens in `frontend/src/pages/dashboard/hr/HrRegisterReports.jsx` and `frontend/src/pages/dashboard/hr/HrWorkflowPages.jsx`, and converted attendance/correction/report pages to shared hooks plus page-level query caching in `frontend/src/pages/dashboard/hr/attendance/HrAttendanceCorrectionPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrCorrectionApprovalHistoryPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrCorrectionApprovalInboxPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrCorrectionPendingListPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrCorrectionRequestDetailPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrDailyAttendanceRegisterPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrDepartmentAttendanceReportPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrLeaveUsageReportPage.jsx`, `frontend/src/pages/dashboard/hr/attendance/HrMonthlyAttendanceSummaryPage.jsx`, and `frontend/src/pages/dashboard/hr/attendance/HrYearlyLeaveSummaryPage.jsx`.
- Notes: Verified with `npm.cmd run build` in `frontend/`; HR master/reference lists and request/register/report datasets now resolve through the shared query pattern for cache reuse and faster remounts.

### 2026-06-24 20:15 IST (Claude)
- Task: Completed TanStack Query migration section 5 (SA admin screens) — finishing and verifying Codex's uncommitted section 5 work.
- Changes: Verified Codex's migration of SACostCenterMaster.jsx, SAMachineMaster.jsx, SAOmNumberSeries.jsx, SAOmUomMaster.jsx, SAVendorMaster.jsx (all correctly wired to shared hooks). Found and fixed a regression in SAOmStorageLocations.jsx: the diff had imported useStorageLocationsQuery/useAdminCompaniesQuery/useQueryClient but never called them, while loadRows()/loadMeta() still referenced the now-removed listStorageLocations import and a deleted BASE constant — both would throw ReferenceError on mount. Rewired loadRows/loadMeta to use the shared hooks plus queryClient.invalidateQueries on mutations, and surfaced query errors in the notices banner.
- Notes: Verified with `npx vite build` and `npx eslint` (project-wide) after the fix; the only other lint findings (`react-hooks/set-state-in-effect`) were confirmed pre-existing via `git show 428c138` and are unrelated to this migration. Committed as 688e185.

### 2026-06-24 21:02 IST
- Task: Added a separate Opening / Legacy Purchase Order entry flow for loading pre-PACE open and in-transit POs with manual PO numbers and no approval step.
- Changes: Updated `supabase/functions/api/_core/procurement/po.handlers.ts` so `createPOHandler` accepts `is_opening_po`, requires a manual `po_number` only for opening POs, skips auto-number generation for that branch, and persists `is_opening_po` on inserted purchase-order rows; created `frontend/src/pages/dashboard/procurement/po/POCreateOpeningPage.jsx` as a copy of the existing PO create flow with added `Legacy PO Number` and `PO Date` header inputs plus create-then-confirm submission logic that auto-confirms every returned PO and reports partial confirm failures; added the new screen registry entry in `frontend/src/navigation/screens/projects/operationModule/operationScreens.js`, routed the page in `frontend/src/router/AppRouter.jsx`, and added the create-opening companion detail allowance in `frontend/src/router/routeIndex.js`.
- Notes: Verified with `npm.cmd run build` in `frontend/` and a direct `tsx` import check of `supabase/functions/api/_core/procurement/po.handlers.ts`; left the existing normal PO create/list/detail flows untouched.

### 2026-06-25 10:14 IST
- Task: Fixed stale Purchase Order Order-Group status reconciliation after individual PO status changes, then removed the redundant Pending Approvals shortcut from the PO list page.
- Changes: Updated `supabase/functions/api/_core/procurement/po.handlers.ts` to add `syncOrderGroupStatus(groupId, actionedBy)`, which reloads all member POs via `getOrderGroupPOs(groupId)` and recomputes group status with this aggregation rule: all member POs `CANCELLED` -> group `CANCELLED`; else all member POs terminal and at least one confirmed-like (`CONFIRMED`, with `CLOSED` treated as confirmed-equivalent for post-confirm knock-off lifecycle rows) -> group `CONFIRMED`; else any member `PENDING_APPROVAL` -> group `PENDING_APPROVAL`; else group `DRAFT`. Wired that sync into individual PO status-changing handlers after their PO updates: `confirmPOHandler`, `approvePOHandler`, `rejectPOHandler`, `amendPOHandler`, `approveAmendmentHandler`, `cancelPOHandler`, `knockOffPOLineHandler`, and `knockOffPOHandler`. Updated `frontend/src/pages/dashboard/procurement/po/POListPage.jsx` to remove the in-page `Pending Approvals` shortcut action and its helper, leaving the dedicated PO13 menu entry as the single access point.
- Notes: Verified with `npm.cmd run build` in `frontend/` and a direct `tsx` import check of `supabase/functions/api/_core/procurement/po.handlers.ts`; logically, a single-PO group that starts `DRAFT` and is confirmed through `confirmPOHandler` now immediately reconciles to group status `CONFIRMED`.
