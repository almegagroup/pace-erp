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

## OVERALL PROGRESS

```
Phase 1 — Leave Types                     ⬜ NOT STARTED    [10%]
Phase 2 — Day Records + Leave Expansion   ⬜ NOT STARTED    [20%]
Phase 3 — Out Work Partial Day            ⬜ NOT STARTED    [15%]
Phase 4 — HR Backdated Application        ⬜ NOT STARTED    [20%]
Phase 5 — Manual Attendance Correction    ⬜ NOT STARTED    [15%]
Phase 6 — HR Summary Reports              ⬜ NOT STARTED    [20%]
Phase 7 — Historical Backfill             ⬜ NOT STARTED    [5%] mandatory
─────────────────────────────────────────────────────────────────
Total Completed:                                             0%
```

---

## PHASE 1 — LEAVE TYPES [10%]

**Status:** ⬜ NOT STARTED
**Goal:** Every leave request carries a leave type. HR can filter and report by type.

### Phase 1-A — DB Migration [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `erp_hr.leave_types` table | ⬜ | — | — |
| Add `leave_type_id` to `erp_hr.leave_requests` | ⬜ | — | — |
| Add `applied_by_auth_user_id` to `erp_hr.leave_requests` | ⬜ | — | — |
| Seed default leave types (GEN, CL, SL, EL, LOP) per company | ⬜ | — | — |
| Backfill existing leave_requests with GEN type | ⬜ | — | — |
| Make `leave_type_id` NOT NULL | ⬜ | — | — |

**Migration file:** `supabase/migrations/20260427_10_1a_hr_leave_types.sql`
**Status:** ⬜ NOT CREATED

### Phase 1-B — Backend [4%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `listLeaveTypesHandler` | ⬜ | — | — |
| Add route `GET /api/hr/leave/types` | ⬜ | — | — |
| Update `createLeaveRequestHandler` — require leave_type_id | ⬜ | — | — |
| Update `updateLeaveRequestHandler` — allow leave_type_id change | ⬜ | — | — |
| Update list handlers to include type_code, type_name | ⬜ | — | — |

### Phase 1-C — Frontend [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `listLeaveTypes()` to hrApi.js | ⬜ | — | — |
| Add leave type dropdown to LeaveApplyPage | ⬜ | — | — |
| Show type in LeaveRequestDetailPage | ⬜ | — | — |
| Show type column in LeaveMyRequestsPage | ⬜ | — | — |
| Show type column in LeaveApprovalInboxPage | ⬜ | — | — |
| Add type column + filter to LeaveRegisterPage | ⬜ | — | — |

**Phase 1 Definition of Done:**
- [ ] Leave apply form shows type dropdown
- [ ] New leave requests store leave_type_id
- [ ] All existing leave requests show "General Leave"
- [ ] Register can filter by leave type
- [ ] No existing functionality broken

---

## PHASE 2 — DAY RECORDS + LEAVE EXPANSION [20%]

**Status:** ⬜ NOT STARTED
**Goal:** Approved leave automatically creates date-wise day records.
**Prerequisite:** Phase 1 complete.

### Phase 2-A — DB Migration [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `erp_hr.employee_day_records` table | ⬜ | — | — |
| Create `upsert_day_record_leave` DB function | ⬜ | — | — |
| Verify UNIQUE constraint on (company, employee, date) | ⬜ | — | — |
| Verify RLS enabled | ⬜ | — | — |

**Migration file:** `supabase/migrations/20260427_20_2a_hr_employee_day_records.sql`
**Status:** ⬜ NOT CREATED

### Phase 2-B — Backend: Leave Expansion on Approve [10%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `generateDateRange` to shared.ts | ⬜ | — | — |
| Create `expandLeaveToDateRecords` function | ⬜ | — | — |
| Hook into workflow decision handler on APPROVED | ⬜ | — | — |
| Verify holiday/week-off rows not overwritten | ⬜ | — | — |

### Phase 2-C — Backend: Cleanup on Cancel [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `removeLeaveFromDateRecords` function | ⬜ | — | — |
| Hook into cancel handler (only when prev state = APPROVED) | ⬜ | — | — |

**Phase 2 Definition of Done:**
- [ ] Approve leave → day records created for each date
- [ ] Cancel approved leave → day records deleted
- [ ] Reject leave → no day records created
- [ ] Holiday rows not overwritten
- [ ] generateDateRange tested for edge cases

---

## PHASE 3 — OUT WORK PARTIAL DAY + EXPANSION [15%]

**Status:** ⬜ NOT STARTED
**Goal:** Out work supports partial-day movement. Out work approval creates day records.
**Prerequisite:** Phase 1 complete. Phase 2 can run in parallel.

### Phase 3-A — DB Migration [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `day_scope` to `erp_hr.out_work_requests` | ⬜ | — | — |
| Add `office_departure_time` to `erp_hr.out_work_requests` | ⬜ | — | — |
| Add `applied_by_auth_user_id` to `erp_hr.out_work_requests` | ⬜ | — | — |
| Backfill existing rows with `day_scope = 'FULL_DAY'` | ⬜ | — | — |
| Create `upsert_day_record_out_work` DB function | ⬜ | — | — |

**Migration file:** `supabase/migrations/20260427_30_3a_hr_out_work_partial_day.sql`
**Status:** ⬜ NOT CREATED

### Phase 3-B — Backend [7%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Update `createOutWorkRequestHandler` — day_scope + partial day validation | ⬜ | — | — |
| Update `updateOutWorkRequestHandler` | ⬜ | — | — |
| Create `expandOutWorkToDateRecords` function | ⬜ | — | — |
| Hook into workflow decision handler on APPROVED | ⬜ | — | — |
| Create `removeOutWorkFromDateRecords` function | ⬜ | — | — |
| Hook into cancel handler | ⬜ | — | — |
| Update list/register handlers to include day_scope, departure_time | ⬜ | — | — |
| Verify: destination list handler still filters by company_id | ⬜ | — | — |
| Verify: destination create handler still sets company_id from session | ⬜ | — | — |
| Verify: destination_id selection still validates company_id match | ⬜ | — | — |

### Phase 3-C — Frontend [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add scope toggle to OutWorkApplyPage | ⬜ | — | — |
| Show departure time field for PARTIAL_DAY | ⬜ | — | — |
| Enforce single-date for PARTIAL_DAY in UI | ⬜ | — | — |
| Show scope badge in OutWorkRequestDetailPage | ⬜ | — | — |
| Add scope + departure columns to OutWorkRegisterResultsPage | ⬜ | — | — |

**Phase 3 Definition of Done:**
- [ ] Full day out-work unchanged, creates day records on approve
- [ ] Partial day out-work: single date enforced, departure time stored
- [ ] Cancellation removes day records for both cases
- [ ] Register shows scope and departure time

---

## PHASE 4 — HR BACKDATED APPLICATION [20%]

**Status:** ⬜ NOT STARTED
**Goal:** HR can apply leave/out-work on behalf of any employee for any past date.
**Prerequisite:** Phase 2 and Phase 3 complete.

### Phase 4-A — ACL Resource Codes [4%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `HR_LEAVE_BACKDATED_APPLY` resource code in shared.ts | ⬜ | — | — |
| Add `HR_OUT_WORK_BACKDATED_APPLY` resource code in shared.ts | ⬜ | — | — |
| SA configures resource codes in ACL admin panel | ⬜ | — | — |
| SA assigns to HR role | ⬜ | — | — |

### Phase 4-B — Backend [9%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `attendance_correction.handlers.ts` | ⬜ | — | — |
| Create `hrBackdatedLeaveApplyHandler` | ⬜ | — | — |
| Create `hrBackdatedOutWorkApplyHandler` | ⬜ | — | — |
| Create `listDayRecordsByEmployeeHandler` | ⬜ | — | — |
| Add routes in hr.routes.ts | ⬜ | — | — |

### Phase 4-C — Frontend [7%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `HrAttendanceCorrectionPage` | ⬜ | — | — |
| Employee selector with date range | ⬜ | — | — |
| Day records table with current status | ⬜ | — | — |
| "Apply Leave on behalf" inline form | ⬜ | — | — |
| "Apply Out Work on behalf" inline form | ⬜ | — | — |
| Add to HR navigation menu | ⬜ | — | — |

**Phase 4 Definition of Done:**
- [ ] HR can apply leave/out-work for any employee for any date
- [ ] applied_by_auth_user_id stored on all HR-on-behalf requests
- [ ] Goes through approval workflow, HR cannot self-approve
- [ ] Employee's 3-day backdate limit unchanged

---

## PHASE 5 — MANUAL ATTENDANCE CORRECTION [15%]

**Status:** ⬜ NOT STARTED
**Goal:** HR can correct Absent → Present for missed punches with full audit trail.
**Prerequisite:** Phase 2 complete.

### Phase 5-A — ACL Resource Code [3%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add `HR_ATTENDANCE_MANUAL_CORRECTION` resource code | ⬜ | — | — |
| SA configures and assigns to HR role | ⬜ | — | — |

### Phase 5-B — Backend [7%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `manualCorrectDayRecordHandler` | ⬜ | — | — |
| Handle both existing row update and new row insert | ⬜ | — | — |
| Store full audit columns (corrected_by, corrected_at, previous_status, note) | ⬜ | — | — |
| Add route in hr.routes.ts | ⬜ | — | — |

### Phase 5-C — Frontend [5%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Add "Correct Status" action to day rows in HrAttendanceCorrectionPage | ⬜ | — | — |
| Inline correction panel with status dropdown and required note | ⬜ | — | — |
| Show audit trail block in day record detail view | ⬜ | — | — |

**Phase 5 Definition of Done:**
- [ ] HR can change Absent → Present for any employee
- [ ] Every correction shows full audit trail
- [ ] LEAVE and OUT_WORK cannot be set via manual correction

---

## PHASE 6 — HR SUMMARY REPORTS [20%]

**Status:** ⬜ NOT STARTED
**Goal:** HR sees all attendance and leave reports with zero manual calculation. Five report screens.
**Prerequisite:** Phase 2 and Phase 3 complete. Phase 7 (backfill) should run before reports are considered accurate for past data.

### Phase 6-A — Backend [10%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `attendance_reports.handlers.ts` | ⬜ | — | — |
| Create `getMonthlyAttendanceSummaryHandler` | ⬜ | — | — |
| Create `getDailyAttendanceRegisterHandler` | ⬜ | — | — |
| Create `getYearlyLeaveSummaryHandler` | ⬜ | — | — |
| Create `getDepartmentAttendanceReportHandler` | ⬜ | — | — |
| Create `getLeaveUsageReportHandler` (balance = null, policy_configured = false) | ⬜ | — | — |
| Add all routes in hr.routes.ts | ⬜ | — | — |

### Phase 6-B — Frontend [10%]

| Item | Status | Completed | Notes |
|---|---|---|---|
| Create `MonthlyAttendanceSummaryPage` with CSV export | ⬜ | — | — |
| Create `DailyAttendanceRegisterPage` (grid + sidebar) with CSV export | ⬜ | — | — |
| Create `YearlyLeaveSummaryPage` with CSV export | ⬜ | — | — |
| Create `DepartmentAttendanceReportPage` with CSV export | ⬜ | — | — |
| Create `LeaveUsageReportPage` (balance shows "Not configured") with CSV export | ⬜ | — | — |
| Add all five pages to HR navigation menu | ⬜ | — | — |

**Phase 6 Definition of Done:**
- [ ] Monthly summary shows correct counts per employee per leave type
- [ ] Daily register grid shows correct status per cell
- [ ] Yearly summary shows 12-month breakdown for selected employee
- [ ] Department report shows department-wise totals
- [ ] Leave usage report shows days taken — balance column shows "Not configured"
- [ ] CSV export works for all five reports
- [ ] Zero manual calculation needed

---

## PHASE 7 — HISTORICAL BACKFILL [Mandatory, 5%]

**Status:** ⬜ NOT STARTED
**Goal:** Populate day records for all historically approved requests.
**Why mandatory:** Without this, HR summary reports are incomplete for all past data.
**Prerequisite:** Phase 2 and Phase 3 complete. Must run immediately after both are done.

| Item | Status | Completed | Notes |
|---|---|---|---|
| Run backfill migration script for approved leaves | ⬜ | — | — |
| Run backfill migration script for approved out-works | ⬜ | — | — |
| Verify row counts match expected (compare with leave register) | ⬜ | — | — |

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
| — | — | — | — |

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
