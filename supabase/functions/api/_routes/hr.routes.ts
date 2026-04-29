import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";
import {
  cancelLeaveRequestHandler,
  createLeaveRequestHandler,
  getLeaveSandwichPreviewHandler,
  listLeaveApprovalInboxHandler,
  listLeaveApprovalScopeHistoryHandler,
  listLeaveRegisterHandler,
  listMyLeaveRequestsHandler,
  updateLeaveRequestHandler,
} from "../_core/hr/leave.handlers.ts";
import {
  listLeaveTypesHandler,
  listAllLeaveTypesHandler,
  createLeaveTypeHandler,
  updateLeaveTypeHandler,
} from "../_core/hr/leave_types.handlers.ts";
import {
  createHolidayHandler,
  deleteHolidayHandler,
  getWeekOffConfigHandler,
  listHolidaysHandler,
  updateHolidayHandler,
  upsertWeekOffConfigHandler,
} from "../_core/hr/calendar.handlers.ts";
import {
  cancelOutWorkRequestHandler,
  createOutWorkDestinationHandler,
  createOutWorkRequestHandler,
  listMyOutWorkRequestsHandler,
  listOutWorkApprovalInboxHandler,
  listOutWorkApprovalScopeHistoryHandler,
  listOutWorkDestinationsHandler,
  listOutWorkRegisterHandler,
  updateOutWorkRequestHandler,
} from "../_core/hr/out_work.handlers.ts";
import {
  hrBackdatedLeaveApplyHandler,
  hrBackdatedOutWorkApplyHandler,
  listDayRecordsByEmployeeHandler,
  manualCorrectDayRecordHandler,
} from "../_core/hr/attendance_correction.handlers.ts";
import {
  getCorrectionRequestDetailHandler,
  listCorrectionApprovalHistoryHandler,
  listCorrectionApprovalInboxHandler,
  listPendingCorrectionsHandler,
  submitCorrectionRequestHandler,
} from "../_core/hr/attendance_correction_approval.handlers.ts";
import {
  getMonthlyAttendanceSummaryHandler,
  getDailyAttendanceRegisterHandler,
  getYearlyLeaveSummaryHandler,
  getDepartmentAttendanceReportHandler,
  getLeaveUsageReportHandler,
} from "../_core/hr/attendance_reports.handlers.ts";

export async function dispatchHrRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>,
  context: Extract<ContextResolution, { status: "RESOLVED" }>,
): Promise<Response | null> {
  const ctx = {
    context,
    request_id: requestId,
    auth_user_id: session.authUserId,
    roleCode: context.roleCode,
  };

  switch (routeKey) {
    case "GET:/api/hr/leave/types":
      return await listLeaveTypesHandler(req, ctx);

    case "GET:/api/hr/leave/types/all":
      return await listAllLeaveTypesHandler(req, ctx);

    case "POST:/api/hr/leave/types":
      return await createLeaveTypeHandler(req, ctx);

    case "PATCH:/api/hr/leave/types":
      return await updateLeaveTypeHandler(req, ctx);

    case "GET:/api/hr/calendar/holidays":
      return await listHolidaysHandler(req, ctx);

    case "POST:/api/hr/calendar/holidays":
      return await createHolidayHandler(req, ctx);

    case "PATCH:/api/hr/calendar/holidays":
      return await updateHolidayHandler(req, ctx);

    case "DELETE:/api/hr/calendar/holidays":
      return await deleteHolidayHandler(req, ctx);

    case "GET:/api/hr/calendar/week-off":
      return await getWeekOffConfigHandler(req, ctx);

    case "PUT:/api/hr/calendar/week-off":
      return await upsertWeekOffConfigHandler(req, ctx);

    case "GET:/api/hr/leave/sandwich-preview":
      return await getLeaveSandwichPreviewHandler(req, ctx);

    case "POST:/api/hr/leave/request":
      return await createLeaveRequestHandler(req, ctx);

    case "GET:/api/hr/leave/my-requests":
      return await listMyLeaveRequestsHandler(req, ctx);

    case "POST:/api/hr/leave/cancel":
      return await cancelLeaveRequestHandler(req, ctx);

    case "POST:/api/hr/leave/update":
      return await updateLeaveRequestHandler(req, ctx);

    case "GET:/api/hr/leave/approval-inbox":
      return await listLeaveApprovalInboxHandler(req, ctx);

    case "GET:/api/hr/leave/approval-history":
      return await listLeaveApprovalScopeHistoryHandler(req, ctx);

    case "GET:/api/hr/leave/register":
      return await listLeaveRegisterHandler(req, ctx);

    case "GET:/api/hr/out-work/destinations":
      return await listOutWorkDestinationsHandler(req, ctx);

    case "POST:/api/hr/out-work/destination":
      return await createOutWorkDestinationHandler(req, ctx);

    case "POST:/api/hr/out-work/request":
      return await createOutWorkRequestHandler(req, ctx);

    case "GET:/api/hr/out-work/my-requests":
      return await listMyOutWorkRequestsHandler(req, ctx);

    case "POST:/api/hr/out-work/cancel":
      return await cancelOutWorkRequestHandler(req, ctx);

    case "POST:/api/hr/out-work/update":
      return await updateOutWorkRequestHandler(req, ctx);

    case "GET:/api/hr/out-work/approval-inbox":
      return await listOutWorkApprovalInboxHandler(req, ctx);

    case "GET:/api/hr/out-work/approval-history":
      return await listOutWorkApprovalScopeHistoryHandler(req, ctx);

    case "GET:/api/hr/out-work/register":
      return await listOutWorkRegisterHandler(req, ctx);

    case "POST:/api/hr/leave/backdated-apply":
      return await hrBackdatedLeaveApplyHandler(req, ctx);

    case "POST:/api/hr/out-work/backdated-apply":
      return await hrBackdatedOutWorkApplyHandler(req, ctx);

    case "GET:/api/hr/attendance/day-records":
      return await listDayRecordsByEmployeeHandler(req, ctx);

    case "POST:/api/hr/attendance/correct":
      return await manualCorrectDayRecordHandler(req, ctx);

    case "GET:/api/hr/attendance/monthly-summary":
      return await getMonthlyAttendanceSummaryHandler(req, ctx);

    case "GET:/api/hr/attendance/daily-register":
      return await getDailyAttendanceRegisterHandler(req, ctx);

    case "GET:/api/hr/attendance/yearly-leave-summary":
      return await getYearlyLeaveSummaryHandler(req, ctx);

    case "GET:/api/hr/attendance/department-report":
      return await getDepartmentAttendanceReportHandler(req, ctx);

    case "GET:/api/hr/attendance/leave-usage":
      return await getLeaveUsageReportHandler(req, ctx);

    case "POST:/api/hr/attendance/correction/submit":
      return await submitCorrectionRequestHandler(req, ctx);

    case "GET:/api/hr/attendance/correction/my-requests":
      return await listPendingCorrectionsHandler(req, ctx);

    case "GET:/api/hr/attendance/correction/detail":
      return await getCorrectionRequestDetailHandler(req, ctx);

    case "GET:/api/hr/attendance/correction/approval-inbox":
      return await listCorrectionApprovalInboxHandler(req, ctx);

    case "GET:/api/hr/attendance/correction/approval-history":
      return await listCorrectionApprovalHistoryHandler(req, ctx);

    default:
      return null;
  }
}
