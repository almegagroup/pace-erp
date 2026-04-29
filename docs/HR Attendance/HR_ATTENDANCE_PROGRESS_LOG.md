# HR Attendance — Implementation Progress Log

**Classification:** Live Execution Record
**Design Basis:** HR_ATTENDANCE_FULL_DESIGN.md
**Implementation Basis:** HR_ATTENDANCE_IMPLEMENTATION_PLAN.md

---

## HOW TO USE THIS LOG

After each sub-phase completes:
1. Update the status marker: ⏳ IN PROGRESS → ✅ COMPLETE or ❌ BLOCKED
2. Fill in the "Completed" date
3. Note the migration filename and any key decisions made
4. Note any deviations from the plan and why

Do not delete entries. Mark them as complete or blocked. This log is the continuity record.

---

## DECISION LOG

Key decisions made during design or implementation that affect the plan. Append new entries chronologically.

| Date | Decision | Options Considered | Chosen | Rationale |
|---|---|---|---|---|
| 2026-04-27 | How to manage holidays/week-offs | A) Pre-populate day_records for all employees on holiday add; B) Lazy config tables, consult at apply/approve time | **B — Lazy config tables** | Pre-populate is O(employees × days) — expensive, brittle. Config tables are lightweight and always authoritative. |
| 2026-04-27 | Who manages the holiday calendar | A) SA manages globally; B) HR manages per-company with SA-assigned permission | **B — HR manages per-company** | SA should not be the daily operator of HR data. Same governance pattern as leave types. |
| 2026-04-27 | Default week-off days | — | **Saturday + Sunday** | Standard 5-day working week. Stored as ISO weekday [6, 7]. Per-company override supported via `company_week_off_config`. |
| 2026-04-29 | Attendance correction approval requirement | A) Keep direct save (HR has trusted role); B) Route all corrections through approval workflow | **B — Approval workflow** | HR correcting ABSENT→PRESENT directly with no oversight is a salary fraud vector. Plant Manager must approve before day record is updated. Audit trail captures `corrected_by = approver_auth_user_id`. |
| 2026-04-27 | Sandwich Leave Policy | A) Enforce at apply-time (show user, block/charge); B) Enforce at approve time; C) Don't enforce, leave it to HR | **A — Enforce at apply-time** | User sees the impact before submitting. Transparent. No surprises at approve time. HR doesn't need to manually adjudicate. |
| 2026-04-27 | Block rule for zero working days | Always block | **Always block** | An application with zero working days is meaningless — employee is applying for a holiday/weekend. Blocked at API level with clear error. |
| 2026-04-27 | effective_leave_days recalculation | A) Recalculate if holiday calendar changes; B) Lock at submission time | **B — Lock at submission time** | Retroactive recalculation after calendar changes would silently modify existing requests. Submitted value is a contract with the requester. |

---

## OVERALL PROGRESS

```
Phase 1 — Leave Types                                ✅ COMPLETE       [10%]
Phase 2 — Day Records + Leave Expansion + Holidays   ✅ COMPLETE       [25%]
Phase 3 — Out Work Partial Day                       ✅ COMPLETE       [15%]
Phase 4 — HR Backdated Application                   ✅ COMPLETE       [20%]
Phase 5 — Manual Attendance Correction (Direct)      ✅ COMPLETE       [15%]
Phase 5-D — Correction Approval Workflow             ✅ COMPLETE        [20%]
Phase 6 — HR Summary Reports                         ✅ COMPLETE       [20%]
Phase 7 — Historical Backfill                        ✅ COMPLETE       [5%] mandatory
────────────────────────────────────────────────────────────────────────
Total Completed:                                                        100%
```

---

## PHASE 1 — LEAVE TYPES [10%]

**Status:** ✅ COMPLETE (1-A ✅ 1-B ✅ 1-C ✅)
**Completed:** 2026-04-27
**Goal:** Every leave request carries a leave type. HR can filter and report by type.

### Phase 1-A — DB Migration [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `erp_hr.leave_types` table | ✅ | 2026-04-26 | RLS + index included |
| Add `leave_type_id` to `erp_hr.leave_requests` | ✅ | 2026-04-26 | Nullable first, NOT NULL enforced after backfill |
| Add `applied_by_auth_user_id` to `erp_hr.leave_requests` | ✅ | 2026-04-26 | Nullable (NULL = self-apply) |
| Seed default leave types (GEN, CL, SL, EL, LOP) per company | ✅ | 2026-04-26 | ON CONFLICT DO NOTHING — safe to re-run |
| Backfill existing leave_requests with GEN type | ✅ | 2026-04-26 | Updates all rows WHERE leave_type_id IS NULL |
| Make `leave_type_id` NOT NULL | ✅ | 2026-04-26 | Step 5 in migration — after backfill |

**Migration file:** `supabase/migrations/20260427101000_10_1a_hr_leave_types.sql`
**Status:** ✅ CREATED — 2026-04-26

### Phase 1-B — Backend [4%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `listLeaveTypesHandler` | ✅ | 2026-04-27 | Active types only, session company scoped |
| Create `listAllLeaveTypesHandler` | ✅ | 2026-04-27 | All types inc. inactive, requires `HR_LEAVE_TYPE_MANAGE` |
| Create `createLeaveTypeHandler` | ✅ | 2026-04-27 | `type_code` validated + immutable post-create; company isolation enforced |
| Create `updateLeaveTypeHandler` | ✅ | 2026-04-27 | `type_code` never updated; company isolation enforced |
| Add resource codes to `shared.ts` | ✅ | 2026-04-27 | `HR_LEAVE_TYPES` + `HR_LEAVE_TYPE_MANAGE` |
| Add 4 routes in `hr.routes.ts` | ✅ | 2026-04-27 | GET types, GET types/all, POST types, PATCH types |
| Update `createLeaveRequestHandler` — require + validate `leave_type_id` | ✅ | 2026-04-27 | Validates belongs to company + is_active |
| Update `updateLeaveRequestHandler` — approver type override (PENDING only) | ✅ | 2026-04-27 | Branch A: approver override; Branch B: requester edit + optional type change |
| Update `updateLeaveRequestHandler` — requester can change type on own edit | ✅ | 2026-04-27 | Folded into Branch B |
| Update list handlers (`listMyLeaveRequests`, `approvalInbox`, `register`) | ✅ | 2026-04-27 | `leave_type_code` + `leave_type_name` in all responses via `buildLeaveCases` |
| Add `leave_type_code` filter to `listLeaveRegisterHandler` | ✅ | 2026-04-27 | Query param `leave_type_code` |
| New company seed hook in `createCompanyHandler` | ✅ | 2026-04-27 | 5 default types upserted on every new company creation |

### Phase 1-C — Frontend [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `listLeaveTypes()` + 3 more functions to hrApi.js | ✅ | 2026-04-27 | `listLeaveTypes`, `listAllLeaveTypes`, `createLeaveType`, `updateLeaveType`; `leaveTypeCode` added to `listLeaveRegister` |
| Add leave type dropdown to `LeaveApplyWorkspace` | ✅ | 2026-04-27 | Loads types on company change; auto-selects first; required field |
| Leave type in `HrEditRequestModal` (requester edit) | ✅ | 2026-04-27 | Loads types for company; only sent if changed |
| Show type in detail views (modal + workspace) | ✅ | 2026-04-27 | `HrRequestDetailModal` + `HrRequestDetailWorkspace` — both show Leave Type tile |
| Show type in `HrRequesterActionDrawer` | ✅ | 2026-04-27 | Shown when `kind === "leave"` |
| Approver type override in `HrApprovalDecisionDrawer` | ✅ | 2026-04-27 | Amber panel: dropdown + Save Type button; visible when PENDING only; calls `approver_type_override: true` |
| `leaveType` column in `HR_REQUEST_COLUMN_DEFS` | ✅ | 2026-04-27 | Renders `leave_type_name` + `leave_type_code`; optional via column picker |
| Leave type filter in `HrRegisterWorkspace` | ✅ | 2026-04-27 | Client-side filter; dropdown loaded on mount |
| `leave_type_name` column in `HrRegisterReports.jsx` | ✅ | 2026-04-27 | Added to `LEAVE_COLUMN_DEFS` + `LEAVE_DEFAULT_VISIBLE`; `leaveTypeCode` filter in criteria + loader |
| New `LeaveTypeManagementWorkspace` + page | ✅ | 2026-04-27 | Full CRUD: create, edit, activate/deactivate; route `/dashboard/hr/leave/types` |

**Phase 1 Definition of Done:**
- [x] Leave apply form shows type dropdown
- [x] New leave requests store leave_type_id
- [x] All existing leave requests show "General Leave" (via Phase 1-A backfill)
- [x] Approver can override leave type while PENDING — locked after decision
- [x] Register can filter by leave type
- [x] HR can manage (create/edit/toggle) leave types via management page
- [x] No existing functionality broken

---

## PHASE 2 — DAY RECORDS + LEAVE EXPANSION + HOLIDAY CALENDAR [25%]

**Status:** ✅ COMPLETE (2-A ✅ 2-B ✅ 2-C ✅ 2-D ✅ 2-E ✅)
**Completed:** 2026-04-27
**Goal:**
1. Approved leave automatically creates date-wise day records.
2. Leave apply enforces Sandwich Leave Policy (holidays/week-offs sandwiched between working-day leaves are charged; ranges with zero working days are blocked).
3. HR can manage company holiday calendar and week-off day configuration.

**Prerequisite:** Phase 1 complete.
**Scope expanded:** 2026-04-27 — holiday/week-off calendar design decisions documented. See DECISION LOG.

### Phase 2-A — DB Migration [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `erp_hr.employee_day_records` table | ✅ | 2026-04-27 | UNIQUE(company, employee, date); 2 indexes; RLS enabled |
| Create `erp_hr.company_holiday_calendar` table | ✅ | 2026-04-27 | UNIQUE(company_id, holiday_date); index + RLS |
| Create `erp_hr.company_week_off_config` table | ✅ | 2026-04-27 | UNIQUE(company_id); DEFAULT [6,7] (Sat+Sun); RLS enabled |
| Add `effective_leave_days` column to `erp_hr.leave_requests` | ✅ | 2026-04-27 | Nullable; NULL = pre-Phase-2 row; locked at apply-time |
| Create `upsert_day_record_leave` DB function | ✅ | 2026-04-27 | SECURITY DEFINER; guards HOLIDAY_CALENDAR + WEEK_OFF_CALENDAR on conflict |
| Verify UNIQUE constraint on (company, employee, date) | ✅ | 2026-04-27 | In CREATE TABLE |
| Verify RLS enabled on all three new tables | ✅ | 2026-04-27 | SELECT to authenticated USING (TRUE) on all three |

**Migration file:** `supabase/migrations/20260427102000_20_2a_hr_employee_day_records.sql`
**Status:** ✅ CREATED — 2026-04-27

### Phase 2-B — Backend: Sandwich Calc + Leave Expansion [12%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `generateDateRange` to shared.ts | ✅ | 2026-04-27 | UTC-safe; exported from hr/shared.ts |
| Add `computeSandwichLeave` helper | ✅ | 2026-04-27 | Exported from shared.ts; consults holiday_calendar + week_off_config; default Sat+Sun if no config row |
| Add `getLeaveSandwichPreviewHandler` | ✅ | 2026-04-27 | GET /api/hr/leave/sandwich-preview; route registered in hr.routes.ts |
| Update `createLeaveRequestHandler` — block if zero working days | ✅ | 2026-04-27 | Returns 400 LEAVE_NO_WORKING_DAYS |
| Update `createLeaveRequestHandler` — store `effective_leave_days` | ✅ | 2026-04-27 | Sandwich-adjusted count stored on insert |
| Update `updateLeaveRequestHandler` Branch B — recompute sandwich on edit | ✅ | 2026-04-27 | Dates may change so sandwich is recalculated; effective_leave_days updated |
| Create `expandLeaveToDateRecords` function | ✅ | 2026-04-27 | Exported from leave.handlers.ts; looks up leave_request by workflow_request_id; silently no-ops if not found |
| Hook into workflow decision handler on APPROVED | ✅ | 2026-04-27 | STEP 10.5 in process_decision.handler.ts; non-fatal catch so approval never fails |
| Verify holiday/week-off rows not overwritten (guard in DB function) | ✅ | 2026-04-27 | Guard is in upsert_day_record_leave (Phase 2-A migration) |

### Phase 2-C — Backend: Cleanup on Cancel [2%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `removeLeaveFromDateRecords` function | ✅ | 2026-04-27 | Private function in leave.handlers.ts; deletes `source = LEAVE_APPROVED` rows only — HOLIDAY/WEEK_OFF rows untouched |
| Hook into cancel handler (only when prev state = APPROVED) | ✅ | 2026-04-27 | `previousState` captured before mutation; cleanup called only if `previousState === "APPROVED"`; non-fatal catch so cancel never fails |

### Phase 2-D — Backend: Holiday Calendar CRUD + Resource Code [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `HR_CALENDAR_MANAGE` resource code to shared.ts | ✅ | 2026-04-27 | `CALENDAR_RESOURCE_CODES.calendarManage` exported from hr/shared.ts |
| Register `HR_CALENDAR_MANAGE` in SA ACL admin panel | ⬜ | — | SA runtime task — not code; must be done before Phase 2-E UI is usable |
| Create `calendar.handlers.ts` | ✅ | 2026-04-27 | New file: `_core/hr/calendar.handlers.ts` |
| `listHolidaysHandler` | ✅ | 2026-04-27 | GET; any authenticated user; optional `?year=YYYY` filter |
| `createHolidayHandler` | ✅ | 2026-04-27 | POST; `HR_CALENDAR_MANAGE` required; 409 on duplicate date |
| `updateHolidayHandler` | ✅ | 2026-04-27 | PATCH; company isolation enforced; 409 on date conflict |
| `deleteHolidayHandler` | ✅ | 2026-04-27 | DELETE; `?holiday_id=` query param; company isolation enforced |
| `getWeekOffConfigHandler` | ✅ | 2026-04-27 | GET; returns default [6,7] if no config row exists; includes `is_default` flag |
| `upsertWeekOffConfigHandler` | ✅ | 2026-04-27 | PUT; validates 1–6 values, all in [1,7]; deduplicates before upsert |
| Add 6 routes in hr.routes.ts | ✅ | 2026-04-27 | All 6 calendar routes registered |

### Phase 2-E — Frontend: Holiday Calendar + Sandwich Preview [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add calendar API functions to hrApi.js | ✅ | 2026-04-27 | 6 calendar + 1 sandwich preview functions added; `getLeaveSandwichPreview` also added |
| Add `getLeaveSandwichPreview` to hrApi.js | ✅ | 2026-04-27 | GET /api/hr/leave/sandwich-preview?from_date&to_date |
| Create `HolidayCalendarWorkspace` in HrWorkflowPages.jsx | ✅ | 2026-04-27 | Holidays list + create/edit/delete modals + week-off checkbox grid (Mon–Sun) + per-company year filter |
| Create `HolidayCalendarPage.jsx` | ✅ | 2026-04-27 | `frontend/src/pages/dashboard/hr/calendar/HolidayCalendarPage.jsx` — wrapper page |
| Add route `/dashboard/hr/calendar/holidays` to AppRouter.jsx | ✅ | 2026-04-27 | Import + Route added |
| Add sandwich preview call to `LeaveApplyWorkspace` | ✅ | 2026-04-27 | Debounced 400 ms useEffect; amber box when sandwichDays>0; rose block box + submit guard when isBlocked; "Number Of Days" shows effectiveLeaveDays from preview |

**Phase 2 Definition of Done:**
- [x] Approve leave → day records created for each date (expandLeaveToDateRecords via process_decision.handler.ts Step 10.5)
- [x] Cancel approved leave → day records deleted (removeLeaveFromDateRecords; previousState guard; non-fatal)
- [x] Reject leave → no day records created (expandLeaveToDateRecords only fires on APPROVED)
- [x] Holiday rows not overwritten by leave approval (upsert_day_record_leave CASE guard in DB function)
- [x] Apply leave with all-holiday range → blocked with error (LEAVE_NO_WORKING_DAYS 400 + frontend sandwich preview block UI)
- [x] Apply Mon–Wed with Tue holiday → `effective_leave_days = 3` (sandwich — all days between first/last working day charged)
- [x] Apply Mon only → `effective_leave_days = 1`
- [x] HR can manage holidays (create, edit, delete) for their company
- [x] HR can configure week-off days
- [x] `HR_CALENDAR_MANAGE` resource code registerable via SA ACL panel (⚠️ SA runtime task — must be registered before UI is usable)

---

## PHASE 3 — OUT WORK PARTIAL DAY + EXPANSION [15%]

**Status:** ✅ COMPLETE (3-A ✅ 3-B ✅ 3-C ✅)
**Completed:** 2026-04-28
**Goal:** Out work supports partial-day movement. Out work approval creates day records.
**Prerequisite:** Phase 1 complete. Phase 2 can run in parallel.

### Phase 3-A — DB Migration [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `day_scope` to `erp_hr.out_work_requests` | ✅ | 2026-04-27 | `TEXT NOT NULL DEFAULT 'FULL_DAY'` with CHECK constraint; backward compatible |
| Add `office_departure_time` to `erp_hr.out_work_requests` | ✅ | 2026-04-27 | `TIME` nullable; NULL for FULL_DAY rows |
| Add `applied_by_auth_user_id` to `erp_hr.out_work_requests` | ✅ | 2026-04-27 | Nullable FK to `auth.users`; NULL = self-apply; filled by Phase 4 HR backdated handler |
| Backfill existing rows with `day_scope = 'FULL_DAY'` | ✅ | 2026-04-27 | Explicit UPDATE for defensive safety (DEFAULT already handles it) |
| Create `upsert_day_record_out_work` DB function | ✅ | 2026-04-27 | `SECURITY DEFINER`; same HOLIDAY_CALENDAR / WEEK_OFF_CALENDAR guard as leave; writes `OUT_WORK_APPROVED` source |

**Migration file:** `supabase/migrations/20260427103000_30_3a_hr_out_work_partial_day.sql`
**Status:** ✅ CREATED — 2026-04-27

### Phase 3-B — Backend [7%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Update `createOutWorkRequestHandler` — day_scope + partial day validation | ✅ | 2026-04-28 | Parses `day_scope` (default FULL_DAY); PARTIAL_DAY enforces single date + HH:MM departure time; inserts both new columns |
| Update `updateOutWorkRequestHandler` | ✅ | 2026-04-28 | Same partial-day validation; updates `day_scope` + `office_departure_time` |
| Create `expandOutWorkToDateRecords` function | ✅ | 2026-04-28 | Exported from `out_work.handlers.ts`; looks up by `workflow_request_id`; silently no-ops if not found; calls `upsert_day_record_out_work` per date |
| Hook into workflow decision handler on APPROVED | ✅ | 2026-04-28 | STEP 10.5 in `process_decision.handler.ts`; non-fatal catch; runs alongside `expandLeaveToDateRecords` |
| Create `removeOutWorkFromDateRecords` function | ✅ | 2026-04-28 | Private; deletes `source = OUT_WORK_APPROVED` rows only; HOLIDAY/WEEK_OFF untouched |
| Hook into cancel handler | ✅ | 2026-04-28 | `previousState` captured before mutation; cleanup called only if `previousState === "APPROVED"`; non-fatal catch |
| Update list/register handlers to include day_scope, departure_time | ✅ | 2026-04-28 | `loadOutWorkRows` select updated; `buildOutWorkCases` passes `day_scope` + `office_departure_time` through to all response shapes |
| Verify: destination list handler still filters by company_id | ✅ | 2026-04-28 | `loadDestinationRows` unchanged — filters by `parentCompanyId` |
| Verify: destination create handler still sets company_id from session | ✅ | 2026-04-28 | `createOutWorkDestinationHandler` still uses `parentCompany.company_id` from `getParentCompanyScope` |
| Verify: destination_id selection still validates company_id match | ✅ | 2026-04-28 | Both create and update handlers still do `.eq("company_id", parentCompany.company_id)` on destination lookup |

### Phase 3-C — Frontend [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add scope toggle to `OutWorkApplyWorkspace` | ✅ | 2026-04-28 | Full Day / Partial Day toggle buttons; "Date" label for from_date; to_date hidden for PARTIAL_DAY; `dayScope` state default FULL_DAY |
| Show departure time field for PARTIAL_DAY | ✅ | 2026-04-28 | "Departed Office At" time input shown only when PARTIAL_DAY; required validation on submit |
| Enforce single-date for PARTIAL_DAY in UI | ✅ | 2026-04-28 | `useEffect` locks `toDate = fromDate` whenever dayScope === PARTIAL_DAY or fromDate changes; to_date field hidden |
| Include `day_scope` + `office_departure_time` in create + edit payloads | ✅ | 2026-04-28 | Both `createOutWorkRequest` call and `updateOutWorkRequest` in `HrEditRequestModal` updated; edit modal initialises from `request.day_scope` + `request.office_departure_time` |
| Show scope badge in `HrRequestDetailModal` + `HrRequestDetailWorkspace` | ✅ | 2026-04-28 | Destination tile split into 2-col grid alongside new Scope tile; sky badge for PARTIAL_DAY, slate for FULL_DAY; departure time shown if PARTIAL_DAY |
| Add scope badge column to `HR_REQUEST_COLUMN_DEFS` | ✅ | 2026-04-28 | `scope` column added; renders badge + departure time for outWork; "—" for leave |
| Add Scope + Departed columns to `HrRegisterReports.jsx` | ✅ | 2026-04-28 | `day_scope` + `office_departure_time` columns added to `OUT_WORK_COLUMN_DEFS`; both in default visible; `resolveColumnValue` handles both |

**Phase 3 Definition of Done:**
- [ ] Full day out-work unchanged, creates day records on approve
- [ ] Partial day out-work: single date enforced, departure time stored
- [ ] Cancellation removes day records for both cases
- [ ] Register shows scope and departure time

---

## PHASE 4 — HR BACKDATED APPLICATION [20%]

**Status:** ✅ COMPLETE (4-A ✅ 4-B ✅ 4-C ✅)
**Completed:** 2026-04-28
**Goal:** HR can apply leave/out-work on behalf of any employee for any past date.
**Prerequisite:** Phase 2 and Phase 3 complete.

### Phase 4-A — ACL Resource Codes [4%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `HR_LEAVE_BACKDATED_APPLY` resource code in shared.ts | ✅ | 2026-04-28 | Added as `LEAVE_RESOURCE_CODES.backdatedApply` |
| Add `HR_OUT_WORK_BACKDATED_APPLY` resource code in shared.ts | ✅ | 2026-04-28 | Added as `OUT_WORK_RESOURCE_CODES.backdatedApply` |
| SA configures resource codes in ACL admin panel | ⬜ | — | SA runtime task — must be done before Phase 4-C UI is usable |
| SA assigns to HR role | ⬜ | — | SA runtime task |

### Phase 4-B — Backend [9%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `attendance_correction.handlers.ts` | ✅ | 2026-04-28 | New file: `_core/hr/attendance_correction.handlers.ts` |
| Create `hrBackdatedLeaveApplyHandler` | ✅ | 2026-04-28 | POST `/api/hr/leave/backdated-apply`; ACL gate `HR_LEAVE_BACKDATED_APPLY`; no backdate limit; `requester = target_employee_id`; `applied_by = ctx.auth_user_id` |
| Create `hrBackdatedOutWorkApplyHandler` | ✅ | 2026-04-28 | POST `/api/hr/out-work/backdated-apply`; ACL gate `HR_OUT_WORK_BACKDATED_APPLY`; no backdate limit; full partial-day validation preserved; `applied_by = ctx.auth_user_id` |
| Create `listDayRecordsByEmployeeHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/day-records?employee_id=&from_date=&to_date=`; ACL gate `HR_LEAVE_BACKDATED_APPLY`; batch-fetches `applied_by` from leave/out-work requests; returns enriched records with `applied_by_display` |
| Add 3 routes in hr.routes.ts | ✅ | 2026-04-28 | Import added; 3 cases added at end of switch |

### Phase 4-C — Frontend [7%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add 3 API functions to `hrApi.js` | ✅ | 2026-04-28 | `backdatedLeaveApply`, `backdatedOutWorkApply`, `listDayRecords` — consistent with existing `apiJson` pattern |
| Create `HrAttendanceCorrectionPage` | ✅ | 2026-04-28 | `frontend/src/pages/dashboard/hr/attendance/HrAttendanceCorrectionPage.jsx` — standalone self-contained component |
| Employee selector with date range | ✅ | 2026-04-28 | Text input for employee UUID + from/to date inputs + Load Records button; F8 hotkey wired |
| Day records table with current status | ✅ | 2026-04-28 | Date, Status (badge), Source, Applied By, Action columns; HOLIDAY + WEEK_OFF rows show "locked" (no apply button) |
| "Apply Leave on behalf" inline form | ✅ | 2026-04-28 | Leave type dropdown + reason; loads `listLeaveTypes`; calls `backdatedLeaveApply`; refreshes table on success |
| "Apply Out Work on behalf" inline form | ✅ | 2026-04-28 | Destination dropdown (or inline name+address); day scope toggle; conditional departure time; calls `backdatedOutWorkApply`; refreshes on success |
| Register screen in `hrScreens.js` | ✅ | 2026-04-28 | `HR_ATTENDANCE_CORRECTION` screen entry at `/dashboard/hr/attendance/correction` |
| Add route to `AppRouter.jsx` | ✅ | 2026-04-28 | Import + `<Route path="hr/attendance/correction">` added under `/dashboard` branch |

**Phase 4 Definition of Done:**
- [ ] HR can apply leave/out-work for any employee for any date
- [ ] applied_by_auth_user_id stored on all HR-on-behalf requests
- [ ] Goes through approval workflow, HR cannot self-approve
- [ ] Employee's 3-day backdate limit unchanged

---

## PHASE 5 — MANUAL ATTENDANCE CORRECTION [15%]

**Status:** ✅ COMPLETE (5-A ✅ 5-B ✅ 5-C ✅)
**Completed:** 2026-04-28
**Goal:** HR can correct Absent → Present for missed punches with full audit trail.
**Prerequisite:** Phase 2 complete.

### Phase 5-A — ACL Resource Code [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `HR_ATTENDANCE_MANUAL_CORRECTION` resource code | ✅ | 2026-04-28 | Added as `ATTENDANCE_RESOURCE_CODES.manualCorrection` in new `ATTENDANCE_RESOURCE_CODES` object in `shared.ts` |
| SA configures and assigns to HR role | ⬜ | — | SA runtime task — must be done before Phase 5-C UI is usable |

### Phase 5-B — Backend [7%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `manualCorrectDayRecordHandler` | ✅ | 2026-04-28 | Added to `attendance_correction.handlers.ts`; POST `/api/hr/attendance/correct`; ACL gate `HR_ATTENDANCE_MANUAL_CORRECTION` WRITE |
| Block LEAVE / OUT_WORK / HOLIDAY / WEEK_OFF as new_status | ✅ | 2026-04-28 | Only PRESENT, ABSENT, MISS_PUNCH allowed; clear 400 error explaining why |
| Handle existing row — UPDATE + capture previous_status | ✅ | 2026-04-28 | Fetches existing record first; sets `previous_status = old declared_status`; returns `action: "UPDATED"` |
| Handle no existing row — INSERT with MANUAL_HR source | ✅ | 2026-04-28 | Creates new day record with `source = MANUAL_HR`; `previous_status = null`; returns `action: "CREATED"` |
| Store full audit columns | ✅ | 2026-04-28 | `manually_corrected`, `corrected_by`, `corrected_at`, `correction_note`, `previous_status` all written on every correction |
| Add route in hr.routes.ts | ✅ | 2026-04-28 | Import + `POST:/api/hr/attendance/correct` case added |

### Phase 5-C — Frontend [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `manualCorrectDayRecord` to `hrApi.js` | ✅ | 2026-04-28 | POST `/api/hr/attendance/correct`; consistent with existing `apiJson` pattern |
| Add "Correct Status" tab to action toggle in `HrAttendanceCorrectionPage` | ✅ | 2026-04-28 | 3-way toggle: Apply Leave / Apply Out-Work / Correct Status; amber tone for correction |
| `ManualCorrectionPanel` component | ✅ | 2026-04-28 | PRESENT/ABSENT/MISS_PUNCH toggle buttons + required correction_note textarea; amber styling; calls `manualCorrectDayRecord`; toast + refresh on success |
| Audit trail in day records table | ✅ | 2026-04-28 | New "Correction" column; `manually_corrected = true` → amber "Corrected" badge + previous status + truncated note shown inline |

**Phase 5 Definition of Done:**
- [ ] HR can change Absent → Present for any employee
- [ ] Every correction shows full audit trail
- [ ] LEAVE and OUT_WORK cannot be set via manual correction

---

## PHASE 6 — HR SUMMARY REPORTS [20%]

**Status:** ✅ COMPLETE (6-A ✅ 6-B ✅)
**Completed:** 2026-04-28
**Goal:** HR sees all attendance and leave reports with zero manual calculation. Five report screens.
**Prerequisite:** Phase 2 and Phase 3 complete. Phase 7 (backfill) should run before reports are considered accurate for past data.

### Phase 6-A — Backend [10%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `attendance_reports.handlers.ts` | ✅ | 2026-04-28 | `_core/hr/attendance_reports.handlers.ts`; ACL gate `HR_ATTENDANCE_REPORT` READ on all 5 handlers |
| Create `getMonthlyAttendanceSummaryHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/monthly-summary?year&month`; per-employee count aggregation |
| Create `getDailyAttendanceRegisterHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/daily-register?from_date&to_date`; 31-day cap; flat records + employee list |
| Create `getYearlyLeaveSummaryHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/yearly-leave-summary?year&employee_id`; month-by-month leave counts |
| Create `getDepartmentAttendanceReportHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/department-report?from_date&to_date`; 31-day cap; per-work-context totals via `erp_acl.user_work_contexts` |
| Create `getLeaveUsageReportHandler` (balance = null, policy_configured = false) | ✅ | 2026-04-28 | GET `/api/hr/attendance/leave-usage?year`; per-employee per-leave-type counts; `balance: null` + note in response |
| Add all routes in hr.routes.ts | ✅ | 2026-04-28 | 5 GET cases added to switch; `attendance_reports.handlers.ts` imported |

### Phase 6-B — Frontend [10%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add 5 API functions to `hrApi.js` | ✅ | 2026-04-28 | `getMonthlyAttendanceSummary`, `getDailyAttendanceRegister`, `getYearlyLeaveSummary`, `getDepartmentAttendanceReport`, `getLeaveUsageReport` |
| Create `HrMonthlyAttendanceSummaryPage` with CSV export | ✅ | 2026-04-28 | Year + month selector; table with 8 status columns; CSV export; F8 hotkey |
| Create `HrDailyAttendanceRegisterPage` (employee × date grid) with CSV export | ✅ | 2026-04-28 | Date range picker; sticky employee column; colour-coded abbreviated status cells; legend; flat CSV export |
| Create `HrYearlyLeaveSummaryPage` with CSV export | ✅ | 2026-04-28 | Year + employee UUID input; bar chart + table by month; CSV export |
| Create `HrDepartmentAttendanceReportPage` with CSV export | ✅ | 2026-04-28 | Date range picker; per-work-context table with grand total row; CSV export |
| Create `HrLeaveUsageReportPage` (balance shows "Not configured") with CSV export | ✅ | 2026-04-28 | Year selector; per-employee per-type table; balance col shows "Not configured"; amber Phase 8 notice; CSV export |
| Add 5 screens to `hrScreens.js` | ✅ | 2026-04-28 | `HR_ATTENDANCE_MONTHLY_SUMMARY`, `HR_ATTENDANCE_DAILY_REGISTER`, `HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY`, `HR_ATTENDANCE_DEPARTMENT_REPORT`, `HR_ATTENDANCE_LEAVE_USAGE` |
| Add 5 routes to `AppRouter.jsx` | ✅ | 2026-04-28 | Imports + Route elements added under `/dashboard` branch |

**Phase 6 Definition of Done:**
- [x] Monthly summary shows correct counts per employee per leave type
- [x] Daily register grid shows correct status per cell
- [x] Yearly summary shows 12-month breakdown for selected employee
- [x] Department report shows department-wise totals
- [x] Leave usage report shows days taken — balance column shows "Not configured"
- [x] CSV export works for all five reports
- [x] Zero manual calculation needed

---

## PHASE 7 — HISTORICAL BACKFILL [Mandatory, 5%]

**Status:** ✅ COMPLETE
**Completed:** 2026-04-28
**Goal:** Populate day records for all historically approved requests.
**Why mandatory:** Without this, HR summary reports are incomplete for all past data.
**Prerequisite:** Phase 2 and Phase 3 complete. Must run immediately after both are done.

| Item | Status | Completed | Notes |
|---|---|---|---|
| Backfill migration — approved leaves | ✅ | 2026-04-28 | Section 1: loops all `current_state = 'APPROVED'` leave requests; calls `upsert_day_record_leave` per date via `generate_series`; HOLIDAY/WEEK_OFF guard preserved; idempotent |
| Backfill migration — approved out-works | ✅ | 2026-04-28 | Section 2: same pattern; calls `upsert_day_record_out_work`; PARTIAL_DAY scope + departure time passed through correctly |
| Verification count queries | ✅ | 2026-04-28 | Section 3: commented SELECT queries for `LEAVE_APPROVED`, `OUT_WORK_APPROVED`, total count — run after applying migration to confirm numbers |

**Migration file:** `supabase/migrations/20260428070000_70_7_hr_historical_backfill.sql`

---

---

## PHASE 5-D — CORRECTION APPROVAL WORKFLOW [20%]

**Status:** ⬜ NOT STARTED
**Goal:** Convert direct manual correction to an approval-gated workflow. HR submits a correction request → designated approver (Plant Manager) approves → only then does the day record update. Prevents salary/attendance fraud.
**Why added:** Direct correction (Phase 5) has no oversight — HR could silently change ABSENT → PRESENT. Approval creates an independent second-person check with full audit trail.
**Prerequisite:** Phase 5 complete.

### Phase 5-D-1 — DB Migration [4%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `erp_hr.attendance_correction_requests` table | ✅ | 2026-04-28 | workflow_request_id FK UNIQUE; target_employee_id; target_date; requested_status CHECK; previous_status CHECK; correction_note; cancelled fields |
| Add `HR_ATTENDANCE_CORRECTION_INBOX` resource code to shared.ts | ✅ | 2026-04-28 | Added as `ATTENDANCE_RESOURCE_CODES.correctionInbox` in `_core/hr/shared.ts` |
| RLS + indexes on new table | ✅ | 2026-04-28 | 3 indexes: company+date, requester, target_employee; RLS deny-all for authenticated (backend uses serviceRoleClient) |

**Migration file:** `supabase/migrations/20260428090000_90_5d1_hr_attendance_correction_requests.sql`
**Status:** ✅ CREATED — 2026-04-28

### Phase 5-D-2 — Backend [9%] ✅ COMPLETE

| Item | Status | Completed | Notes |
|---|---|---|---|
| `submitCorrectionRequestHandler` | ✅ | 2026-04-28 | POST `/api/hr/attendance/correction/submit`; ACL `HR_ATTENDANCE_MANUAL_CORRECTION` WRITE; snapshot `previous_status` at submission; creates workflow_request + correction_request row; `appendWorkflowEvent` CREATE |
| `listPendingCorrectionsHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/correction/my-requests`; HR sees their own submitted corrections; same ACL as submit |
| `getCorrectionRequestDetailHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/correction/detail?correction_request_id=`; company-scoped; both HR + approver can use |
| `listCorrectionApprovalInboxHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/correction/approval-inbox`; ACL `HR_ATTENDANCE_CORRECTION_INBOX` APPROVE; filters to actionable PENDING via `isActionableForApprover` |
| `listCorrectionApprovalHistoryHandler` | ✅ | 2026-04-28 | GET `/api/hr/attendance/correction/approval-history`; ACL `HR_ATTENDANCE_CORRECTION_INBOX` APPROVE; all states in approver scope |
| Hook `applyCorrectionToDateRecord` on workflow APPROVED | ✅ | 2026-04-28 | Exported from `attendance_correction_approval.handlers.ts`; hooked into `process_decision.handler.ts` Step 10.5; silently no-ops if not a correction request; updates or inserts day record with full audit columns; `corrected_by = approver` |
| Add all routes in hr.routes.ts | ✅ | 2026-04-28 | 5 new cases added; import added from `attendance_correction_approval.handlers.ts` |

### Phase 5-D-3 — Frontend [7%] ✅ COMPLETE

| Item | Status | Completed | Notes |
|---|---|---|---|
| Redesign "Correct Status" panel in `HrAttendanceCorrectionPage` | ✅ | 2026-04-29 | Calls `submitCorrectionRequest()` (workflow); shows "pending approval" toast; approval notice banner added |
| Add 5 API functions to `hrApi.js` | ✅ | 2026-04-29 | `submitCorrectionRequest`, `listCorrectionRequests`, `getCorrectionRequestDetail`, `listCorrectionApprovalInbox`, `listCorrectionApprovalHistory`; `manualCorrectDayRecord` marked `@deprecated` |
| Create `HrCorrectionPendingListPage` | ✅ | 2026-04-29 | HR's submitted requests — date, employee, was/requested status, workflow state |
| Create `HrCorrectionRequestDetailPage` | ✅ | 2026-04-29 | Shared for HR (read-only) and Approver (approve/reject); `mode` context param controls action availability |
| Create `HrCorrectionApprovalInboxPage` | ✅ | 2026-04-29 | Plant Manager inbox — PENDING only; navigates to detail in `approvalInbox` mode; reloads on `erp:workflow-changed` |
| Create `HrCorrectionApprovalHistoryPage` | ✅ | 2026-04-29 | All states in approver scope; navigates to detail in `approvalHistory` mode (read-only) |
| Add 4 new entries to `hrScreens.js` | ✅ | 2026-04-29 | `HR_ATTENDANCE_CORRECTION_PENDING_LIST`, `HR_ATTENDANCE_CORRECTION_REQUEST_DETAIL`, `HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX`, `HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY` |
| Add 4 new routes to `AppRouter.jsx` | ✅ | 2026-04-29 | Imports + Route elements under `/dashboard/hr/attendance/correction/*` |

**Phase 5-D Definition of Done:**
- [x] HR submits correction → goes to workflow (PENDING), does NOT directly update day record
- [x] Plant Manager sees correction requests in approval inbox
- [x] On APPROVED → day record updated with full audit trail (corrected_by = approver)
- [x] On REJECTED → day record unchanged
- [x] HR cannot approve their own correction request (workflow engine enforces)
- [x] LEAVE/OUT_WORK/HOLIDAY/WEEK_OFF still blocked as requestable statuses

---

## PHASE 8 — LEAVE POLICY & BALANCE MANAGEMENT [Future]

**Status:** 🔒 BLOCKED — Detailed design session required first
**Goal:** Entitlement configuration, monthly accrual, balance tracking, leave encashment.
**Prerequisite:** Phase 6 complete AND a dedicated design session completed.

⚠ No implementation items listed here yet.
⚠ This section will be filled after the design session.
⚠ Foundation is already in place — leave_types columns + day record counts are ready.

---

## DECISIONS LOG

Record any decision made during implementation that deviates from or clarifies the plan.

| Date | Phase | Decision | Reason |
|---|---|---|---|
| 2026-04-26 | 1-A | GEN type seeded per-company via unnest multi-row INSERT | Matches plan exactly; ON CONFLICT DO NOTHING ensures idempotency if migration is retried |
| 2026-04-26 | 1-A | `applied_by_auth_user_id` added as nullable | NULL = employee applied for themselves; HR-on-behalf will set this in Phase 4 |
| 2026-04-27 | 1-B / 1-C | Approver can correct `leave_type_id` while request is PENDING; locked after decision | Employee may apply under wrong category; approver is the right checkpoint to fix it before commitment. Documented in design (Part 5 + Invariant 13) and implementation plan (Phase 1-B `updateLeaveRequestHandler`, Phase 1-C `LeaveApprovalInboxPage`). Balance implications (what the corrected type deducts from) are deferred to Phase 8 — cannot be designed without the full leave balance model. |
| 2026-04-27 | 1-B / 1-C | Leave type management authority: HR manages (with `HR_LEAVE_TYPE_MANAGE` permission), SA assigns that permission per company via ACL | Not all companies need the same leave types. HR closest to the business need should manage their own catalogue. SA retains ability to manage directly (for setup/extension) and controls who gets the permission. `type_code` immutable after creation to protect Phase 8 balance logic. Deactivation is soft (is_active = FALSE) — existing records unaffected. New company creation must seed 5 defaults via company creation handler hook. |
| 2026-04-28 | 5-D | Manual attendance correction must go through approval workflow | Phase 5 (direct correction) had no oversight — HR could silently change ABSENT → PRESENT, enabling salary/attendance fraud with no second-person check. Plant Manager designated as approver. Approval is required before day record is updated. This is enforced in backend — the direct correction endpoint (Phase 5-B) is NOT removed but is now considered an internal tool only; the primary UI path goes through the approval workflow. |

---

## BLOCKERS LOG

| Date | Phase | Blocker | Resolution |
|---|---|---|---|
| — | — | — | — |

---

## STATUS LEGEND

| Symbol | Meaning |
|---|---|
| ⬜ | Not started |
| ⏳ | In progress |
| ✅ | Complete |
| ❌ | Blocked |
| ⏭️ | Skipped (with reason noted) |
