/*
 * File-ID: 8.6A-HR-RPT
 * File-Path: supabase/functions/api/_core/hr/attendance_reports.handlers.ts
 * Gate: 8
 * Phase: 6-A
 * Domain: HR
 * Purpose: HR attendance summary reports — monthly summary, daily register,
 *          yearly leave summary, department report, leave usage report.
 * Authority: Backend
 */

import { okResponse, errorResponse } from "../response.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { getActiveAclVersionIdForCompany } from "../../_shared/acl_runtime.ts";
import { readAclSnapshotDecision } from "../../_shared/acl_snapshot.ts";
import {
  ATTENDANCE_RESOURCE_CODES,
  assertHrBusinessContext,
  loadActiveCompanyWorkContexts,
  loadUserIdentityMap,
  normalizeIsoDate,
  type HrHandlerContext,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// Internal: ACL guard — HR_ATTENDANCE_REPORT READ
// ---------------------------------------------------------------------------

async function assertAttendanceReportPermission(
  ctx: HrHandlerContext,
  companyId: string,
  workContextId: string,
): Promise<Response | null> {
  const aclVersionId = await getActiveAclVersionIdForCompany(
    serviceRoleClient,
    companyId,
  );
  const { data: aclDecision } = await readAclSnapshotDecision({
    db: serviceRoleClient,
    aclVersionId,
    authUserId: ctx.auth_user_id,
    companyId,
    workContextId,
    resourceCode: ATTENDANCE_RESOURCE_CODES.report,
    actionCode: "READ",
  });

  if (!aclDecision || aclDecision.decision !== "ALLOW") {
    return errorResponse(
      "ATTENDANCE_REPORT_FORBIDDEN",
      "permission denied — HR_ATTENDANCE_REPORT required",
      ctx.request_id,
      "NONE",
      403,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isoYearMonth(year: number, month: number): { fromDate: string; toDate: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to   = new Date(Date.UTC(year, month, 0));       // last day of month
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate:   to.toISOString().slice(0, 10),
  };
}

function parseYearParam(raw: string): number | null {
  const n = parseInt(raw, 10);
  return !isNaN(n) && n >= 2000 && n <= 2100 ? n : null;
}

function parseMonthParam(raw: string): number | null {
  const n = parseInt(raw, 10);
  return !isNaN(n) && n >= 1 && n <= 12 ? n : null;
}

type DayRecord = {
  day_record_id: string;
  employee_auth_user_id: string;
  record_date: string;
  declared_status: string;
  source: string;
  leave_request_id: string | null;
  out_work_request_id: string | null;
};

// ---------------------------------------------------------------------------
// Handler 1 — Monthly Attendance Summary
// GET /api/hr/attendance/monthly-summary?year=YYYY&month=M
//
// Returns per-employee status counts for the given month.
// ---------------------------------------------------------------------------

export async function getMonthlyAttendanceSummaryHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);
    const companyId    = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertAttendanceReportPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const url   = new URL(req.url);
    const year  = parseYearParam(url.searchParams.get("year") ?? "");
    const month = parseMonthParam(url.searchParams.get("month") ?? "");

    if (!year || !month) {
      return errorResponse("INVALID_PARAMS", "year (YYYY) and month (1-12) are required", ctx.request_id, "NONE", 400);
    }

    const { fromDate, toDate } = isoYearMonth(year, month);

    const { data: records, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select("day_record_id, employee_auth_user_id, record_date, declared_status, source, leave_request_id, out_work_request_id")
      .eq("company_id", companyId)
      .gte("record_date", fromDate)
      .lte("record_date", toDate)
      .order("record_date", { ascending: true });

    if (error) {
      return errorResponse("REPORT_FETCH_FAILED", "Failed to fetch day records", ctx.request_id);
    }

    const rows = (records ?? []) as DayRecord[];

    // Aggregate per employee
    const empMap = new Map<string, {
      total: number; present: number; leave: number; out_work: number;
      holiday: number; week_off: number; absent: number; miss_punch: number;
    }>();

    for (const r of rows) {
      if (!empMap.has(r.employee_auth_user_id)) {
        empMap.set(r.employee_auth_user_id, {
          total: 0, present: 0, leave: 0, out_work: 0,
          holiday: 0, week_off: 0, absent: 0, miss_punch: 0,
        });
      }
      const agg = empMap.get(r.employee_auth_user_id)!;
      agg.total++;
      if (r.declared_status === "PRESENT")    agg.present++;
      if (r.declared_status === "LEAVE")      agg.leave++;
      if (r.declared_status === "OUT_WORK")   agg.out_work++;
      if (r.declared_status === "HOLIDAY")    agg.holiday++;
      if (r.declared_status === "WEEK_OFF")   agg.week_off++;
      if (r.declared_status === "ABSENT")     agg.absent++;
      if (r.declared_status === "MISS_PUNCH") agg.miss_punch++;
    }

    const identityMap = await loadUserIdentityMap([...empMap.keys()]);

    const summary = [...empMap.entries()].map(([empId, agg]) => {
      const identity = identityMap.get(empId);
      return {
        employee_auth_user_id: empId,
        employee_display: identity?.name ?? identity?.user_code ?? empId,
        employee_code: identity?.user_code ?? null,
        ...agg,
      };
    }).sort((a, b) => (a.employee_display ?? "").localeCompare(b.employee_display ?? ""));

    return okResponse(
      { year, month, from_date: fromDate, to_date: toDate, summary, total_employees: summary.length },
      ctx.request_id,
    );
  } catch (_err) {
    return errorResponse("MONTHLY_SUMMARY_ERROR", "Unexpected error", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 2 — Daily Attendance Register
// GET /api/hr/attendance/daily-register?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
//
// Returns all day records in the range. Max 31 days enforced.
// Frontend builds the employee × date grid from the flat record list.
// ---------------------------------------------------------------------------

export async function getDailyAttendanceRegisterHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);
    const companyId    = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertAttendanceReportPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const url      = new URL(req.url);
    const fromDate = normalizeIsoDate(url.searchParams.get("from_date") ?? "");
    const toDate   = normalizeIsoDate(url.searchParams.get("to_date") ?? "");

    if (toDate < fromDate) {
      return errorResponse("DATE_RANGE_INVALID", "to_date must be >= from_date", ctx.request_id, "NONE", 400);
    }

    // Enforce max 31-day window
    const fromUtc = new Date(`${fromDate}T00:00:00.000Z`);
    const toUtc   = new Date(`${toDate}T00:00:00.000Z`);
    const diffDays = Math.floor((toUtc.getTime() - fromUtc.getTime()) / 86400000) + 1;
    if (diffDays > 31) {
      return errorResponse("DATE_RANGE_TOO_WIDE", "Daily register is limited to 31 days", ctx.request_id, "NONE", 400);
    }

    const { data: records, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select("day_record_id, employee_auth_user_id, record_date, declared_status, source, manually_corrected")
      .eq("company_id", companyId)
      .gte("record_date", fromDate)
      .lte("record_date", toDate)
      .order("record_date", { ascending: true });

    if (error) {
      return errorResponse("REPORT_FETCH_FAILED", "Failed to fetch day records", ctx.request_id);
    }

    const rows = records ?? [];
    const uniqueEmpIds = [...new Set(rows.map((r) => r.employee_auth_user_id))];
    const identityMap  = await loadUserIdentityMap(uniqueEmpIds);

    const employees = uniqueEmpIds.map((id) => {
      const identity = identityMap.get(id);
      return {
        employee_auth_user_id: id,
        employee_display: identity?.name ?? identity?.user_code ?? id,
        employee_code: identity?.user_code ?? null,
      };
    }).sort((a, b) => (a.employee_display ?? "").localeCompare(b.employee_display ?? ""));

    return okResponse(
      { from_date: fromDate, to_date: toDate, total_days: diffDays, employees, records: rows },
      ctx.request_id,
    );
  } catch (_err) {
    return errorResponse("DAILY_REGISTER_ERROR", "Unexpected error", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 3 — Yearly Leave Summary (per employee)
// GET /api/hr/attendance/yearly-leave-summary?year=YYYY&employee_id=UUID
//
// Returns month-by-month leave day counts for the selected employee + year.
// ---------------------------------------------------------------------------

export async function getYearlyLeaveSummaryHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);
    const companyId    = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertAttendanceReportPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const url        = new URL(req.url);
    const year       = parseYearParam(url.searchParams.get("year") ?? "");
    const employeeId = url.searchParams.get("employee_id")?.trim() ?? "";

    if (!year) {
      return errorResponse("INVALID_PARAMS", "year (YYYY) is required", ctx.request_id, "NONE", 400);
    }
    if (!employeeId) {
      return errorResponse("EMPLOYEE_ID_REQUIRED", "employee_id is required", ctx.request_id, "NONE", 400);
    }

    const fromDate = `${year}-01-01`;
    const toDate   = `${year}-12-31`;

    const { data: records, error } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select("record_date, declared_status, leave_request_id")
      .eq("company_id", companyId)
      .eq("employee_auth_user_id", employeeId)
      .eq("declared_status", "LEAVE")
      .gte("record_date", fromDate)
      .lte("record_date", toDate)
      .order("record_date", { ascending: true });

    if (error) {
      return errorResponse("REPORT_FETCH_FAILED", "Failed to fetch leave records", ctx.request_id);
    }

    // Group by month (1–12)
    const monthCounts: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) monthCounts[m] = 0;

    for (const r of records ?? []) {
      const month = parseInt(r.record_date.slice(5, 7), 10);
      if (month >= 1 && month <= 12) monthCounts[month]++;
    }

    const months = Object.entries(monthCounts).map(([m, count]) => ({
      month: parseInt(m, 10),
      leave_days: count,
    }));

    const totalLeaveDays = (records ?? []).length;
    const identityMap = await loadUserIdentityMap([employeeId]);
    const identity = identityMap.get(employeeId);

    return okResponse(
      {
        year,
        employee_auth_user_id: employeeId,
        employee_display: identity?.name ?? identity?.user_code ?? employeeId,
        employee_code: identity?.user_code ?? null,
        total_leave_days: totalLeaveDays,
        months,
      },
      ctx.request_id,
    );
  } catch (_err) {
    return errorResponse("YEARLY_LEAVE_SUMMARY_ERROR", "Unexpected error", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 4 — Department Attendance Report
// GET /api/hr/attendance/department-report?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
//
// Returns per-work-context status totals for the date range. Max 31 days.
// Employees are mapped to their work context via erp_acl.user_work_contexts.
// ---------------------------------------------------------------------------

export async function getDepartmentAttendanceReportHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);
    const companyId    = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertAttendanceReportPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const url      = new URL(req.url);
    const fromDate = normalizeIsoDate(url.searchParams.get("from_date") ?? "");
    const toDate   = normalizeIsoDate(url.searchParams.get("to_date") ?? "");

    if (toDate < fromDate) {
      return errorResponse("DATE_RANGE_INVALID", "to_date must be >= from_date", ctx.request_id, "NONE", 400);
    }

    const fromUtc  = new Date(`${fromDate}T00:00:00.000Z`);
    const toUtc    = new Date(`${toDate}T00:00:00.000Z`);
    const diffDays = Math.floor((toUtc.getTime() - fromUtc.getTime()) / 86400000) + 1;
    if (diffDays > 31) {
      return errorResponse("DATE_RANGE_TOO_WIDE", "Department report is limited to 31 days", ctx.request_id, "NONE", 400);
    }

    // Fetch day records
    const { data: records, error: recError } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select("employee_auth_user_id, declared_status")
      .eq("company_id", companyId)
      .gte("record_date", fromDate)
      .lte("record_date", toDate);

    if (recError) {
      return errorResponse("REPORT_FETCH_FAILED", "Failed to fetch day records", ctx.request_id);
    }

    const rows = records ?? [];
    const uniqueEmpIds = [...new Set(rows.map((r) => r.employee_auth_user_id))];

    // Fetch user → work_context mapping from erp_acl.user_work_contexts
    const empWorkContextMap = new Map<string, string>(); // empId → work_context_id
    if (uniqueEmpIds.length > 0) {
      const { data: uwcRows } = await serviceRoleClient
        .schema("erp_acl")
        .from("user_work_contexts")
        .select("auth_user_id, work_context_id")
        .eq("company_id", companyId)
        .in("auth_user_id", uniqueEmpIds);

      for (const row of uwcRows ?? []) {
        empWorkContextMap.set(row.auth_user_id, row.work_context_id);
      }
    }

    // Load work context names
    const allWorkContexts = await loadActiveCompanyWorkContexts(serviceRoleClient, companyId);
    const wcNameMap = new Map(
      allWorkContexts.map((wc) => [wc.work_context_id, wc.work_context_name ?? wc.work_context_code]),
    );

    // Aggregate by work context
    const deptMap = new Map<string, {
      work_context_name: string;
      total: number; present: number; leave: number; out_work: number;
      holiday: number; week_off: number; absent: number; miss_punch: number;
    }>();

    for (const r of rows) {
      const wcId   = empWorkContextMap.get(r.employee_auth_user_id) ?? "UNKNOWN";
      const wcName = wcNameMap.get(wcId) ?? "Unknown";

      if (!deptMap.has(wcId)) {
        deptMap.set(wcId, {
          work_context_name: wcName,
          total: 0, present: 0, leave: 0, out_work: 0,
          holiday: 0, week_off: 0, absent: 0, miss_punch: 0,
        });
      }

      const agg = deptMap.get(wcId)!;
      agg.total++;
      if (r.declared_status === "PRESENT")    agg.present++;
      if (r.declared_status === "LEAVE")      agg.leave++;
      if (r.declared_status === "OUT_WORK")   agg.out_work++;
      if (r.declared_status === "HOLIDAY")    agg.holiday++;
      if (r.declared_status === "WEEK_OFF")   agg.week_off++;
      if (r.declared_status === "ABSENT")     agg.absent++;
      if (r.declared_status === "MISS_PUNCH") agg.miss_punch++;
    }

    const departments = [...deptMap.entries()].map(([wcId, agg]) => ({
      work_context_id: wcId,
      ...agg,
    })).sort((a, b) => a.work_context_name.localeCompare(b.work_context_name));

    return okResponse(
      { from_date: fromDate, to_date: toDate, departments },
      ctx.request_id,
    );
  } catch (_err) {
    return errorResponse("DEPARTMENT_REPORT_ERROR", "Unexpected error", ctx.request_id);
  }
}

// ---------------------------------------------------------------------------
// Handler 5 — Leave Usage Report
// GET /api/hr/attendance/leave-usage?year=YYYY
//
// Returns per-employee per-leave-type leave day counts for the year.
// Balance field is always null — Phase 8 (Leave Policy) will populate it.
// ---------------------------------------------------------------------------

export async function getLeaveUsageReportHandler(
  req: Request,
  ctx: HrHandlerContext,
): Promise<Response> {
  try {
    assertHrBusinessContext(ctx);
    const companyId    = ctx.context.companyId;
    const workContextId = ctx.context.workContextId;

    const denied = await assertAttendanceReportPermission(ctx, companyId, workContextId);
    if (denied) return denied;

    const url  = new URL(req.url);
    const year = parseYearParam(url.searchParams.get("year") ?? "");

    if (!year) {
      return errorResponse("INVALID_PARAMS", "year (YYYY) is required", ctx.request_id, "NONE", 400);
    }

    const fromDate = `${year}-01-01`;
    const toDate   = `${year}-12-31`;

    // Fetch LEAVE day records with leave_request_id
    const { data: records, error: recError } = await serviceRoleClient
      .schema("erp_hr")
      .from("employee_day_records")
      .select("employee_auth_user_id, record_date, leave_request_id")
      .eq("company_id", companyId)
      .eq("declared_status", "LEAVE")
      .gte("record_date", fromDate)
      .lte("record_date", toDate);

    if (recError) {
      return errorResponse("REPORT_FETCH_FAILED", "Failed to fetch leave records", ctx.request_id);
    }

    const rows = records ?? [];

    // Collect unique leave_request_ids to batch-fetch leave_type info
    const leaveRequestIds = [...new Set(
      rows.filter((r) => r.leave_request_id).map((r) => r.leave_request_id as string),
    )];

    // Map leave_request_id → { leave_type_id, type_code, type_name }
    const leaveTypeByRequestId = new Map<string, { leave_type_id: string; type_code: string; type_name: string }>();

    if (leaveRequestIds.length > 0) {
      const { data: leaveRows } = await serviceRoleClient
        .schema("erp_hr")
        .from("leave_requests")
        .select("leave_request_id, leave_type_id")
        .in("leave_request_id", leaveRequestIds);

      const leaveTypeIds = [...new Set(
        (leaveRows ?? []).filter((r) => r.leave_type_id).map((r) => r.leave_type_id as string),
      )];

      // Fetch leave type names
      const leaveTypeNameMap = new Map<string, { type_code: string; type_name: string }>();
      if (leaveTypeIds.length > 0) {
        const { data: typeRows } = await serviceRoleClient
          .schema("erp_hr")
          .from("leave_types")
          .select("leave_type_id, type_code, type_name")
          .in("leave_type_id", leaveTypeIds);

        for (const t of typeRows ?? []) {
          leaveTypeNameMap.set(t.leave_type_id, { type_code: t.type_code, type_name: t.type_name });
        }
      }

      for (const lr of leaveRows ?? []) {
        if (lr.leave_type_id) {
          const typeInfo = leaveTypeNameMap.get(lr.leave_type_id) ?? { type_code: "UNKNOWN", type_name: "Unknown" };
          leaveTypeByRequestId.set(lr.leave_request_id, {
            leave_type_id: lr.leave_type_id,
            ...typeInfo,
          });
        }
      }
    }

    // Aggregate: empId → typeId → count
    type TypeCount = { leave_type_id: string; type_code: string; type_name: string; days_taken: number; balance: null };
    const empTypeMap = new Map<string, Map<string, TypeCount>>();

    for (const r of rows) {
      const typeInfo = r.leave_request_id
        ? (leaveTypeByRequestId.get(r.leave_request_id) ?? null)
        : null;

      const typeId   = typeInfo?.leave_type_id ?? "UNKNOWN";
      const typeCode = typeInfo?.type_code ?? "UNKNOWN";
      const typeName = typeInfo?.type_name ?? "Unknown";

      if (!empTypeMap.has(r.employee_auth_user_id)) {
        empTypeMap.set(r.employee_auth_user_id, new Map());
      }
      const typeMap = empTypeMap.get(r.employee_auth_user_id)!;
      if (!typeMap.has(typeId)) {
        typeMap.set(typeId, { leave_type_id: typeId, type_code: typeCode, type_name: typeName, days_taken: 0, balance: null });
      }
      typeMap.get(typeId)!.days_taken++;
    }

    const uniqueEmpIds = [...empTypeMap.keys()];
    const identityMap  = await loadUserIdentityMap(uniqueEmpIds);

    const usageRows = uniqueEmpIds.map((empId) => {
      const identity = identityMap.get(empId);
      const types    = [...(empTypeMap.get(empId)?.values() ?? [])];
      const totalDays = types.reduce((sum, t) => sum + t.days_taken, 0);
      return {
        employee_auth_user_id: empId,
        employee_display: identity?.name ?? identity?.user_code ?? empId,
        employee_code: identity?.user_code ?? null,
        total_leave_days: totalDays,
        by_type: types,
      };
    }).sort((a, b) => (a.employee_display ?? "").localeCompare(b.employee_display ?? ""));

    return okResponse(
      {
        year,
        note_balance: "Leave balance tracking is not configured. Requires Phase 8 (Leave Policy & Balance Management).",
        usage: usageRows,
        total_employees: usageRows.length,
      },
      ctx.request_id,
    );
  } catch (_err) {
    return errorResponse("LEAVE_USAGE_REPORT_ERROR", "Unexpected error", ctx.request_id);
  }
}
