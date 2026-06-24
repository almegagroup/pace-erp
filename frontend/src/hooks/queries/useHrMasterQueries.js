import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getCorrectionRequestDetail,
  getDailyAttendanceRegister,
  getDepartmentAttendanceReport,
  getLeaveUsageReport,
  getMonthlyAttendanceSummary,
  getWeekOffConfig,
  getYearlyLeaveSummary,
  listCorrectionApprovalHistory,
  listCorrectionApprovalInbox,
  listCorrectionRequests,
  listDayRecords,
  listAllLeaveTypes,
  listHolidays,
  listLeaveApprovalHistory,
  listLeaveApprovalInbox,
  listLeaveRegister,
  listLeaveTypes,
  listMyLeaveRequests,
  listMyOutWorkRequests,
  listOutWorkDestinations,
  listOutWorkApprovalHistory,
  listOutWorkApprovalInbox,
  listOutWorkRegister,
} from "../../pages/dashboard/hr/hrApi.js";
import { queryKeys } from "./queryKeys.js";
import { cleanQueryParams } from "./queryUtils.js";

export function useLeaveTypesQuery(companyId = null, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.leaveTypes(companyId),
    queryFn: () => listLeaveTypes(companyId),
    ...options,
  });
}

export function useLeaveTypeOptionsQuery(companyId = null, options = {}) {
  const query = useLeaveTypesQuery(companyId, options);
  return {
    ...query,
    leaveTypes: Array.isArray(query.data?.leave_types) ? query.data.leave_types : [],
  };
}

export function useAllLeaveTypesQuery(companyId = null, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.allLeaveTypes(companyId),
    queryFn: () => listAllLeaveTypes(companyId),
    ...options,
  });
}

export function useAllLeaveTypeOptionsQuery(companyId = null, options = {}) {
  const query = useAllLeaveTypesQuery(companyId, options);
  return {
    ...query,
    leaveTypes: Array.isArray(query.data?.leave_types) ? query.data.leave_types : [],
  };
}

export function useHolidaysQuery({ year = null, companyId = null } = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.holidays({ year, companyId }),
    queryFn: () => listHolidays(year, companyId),
    ...options,
  });
}

export function useWeekOffConfigQuery(companyId = null, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.weekOffConfig(companyId),
    queryFn: () => getWeekOffConfig(companyId),
    ...options,
  });
}

export function useOutWorkDestinationsQuery(companyId = null, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.outWorkDestinations(companyId),
    queryFn: () => listOutWorkDestinations(companyId),
    ...options,
  });
}

export function useOutWorkDestinationOptionsQuery(companyId = null, options = {}) {
  const query = useOutWorkDestinationsQuery(companyId, options);
  return {
    ...query,
    destinations: Array.isArray(query.data?.destinations) ? query.data.destinations : [],
  };
}

export function useMyLeaveRequestsQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.myLeaveRequests(),
    queryFn: () => listMyLeaveRequests(),
    ...options,
  });
}

export function useLeaveApprovalInboxQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.leaveApprovalInbox(),
    queryFn: () => listLeaveApprovalInbox(),
    ...options,
  });
}

export function useLeaveApprovalHistoryQuery(requesterAuthUserId = "", options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.leaveApprovalHistory(requesterAuthUserId),
    queryFn: () => listLeaveApprovalHistory(requesterAuthUserId),
    ...options,
  });
}

export function useLeaveRegisterQuery(filters = {}, options = {}) {
  const normalizedFilters = useMemo(() => cleanQueryParams(filters), [filters]);
  return useQuery({
    queryKey: queryKeys.hr.leaveRegister(normalizedFilters),
    queryFn: () => listLeaveRegister(normalizedFilters),
    ...options,
  });
}

export function useMyOutWorkRequestsQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.myOutWorkRequests(),
    queryFn: () => listMyOutWorkRequests(),
    ...options,
  });
}

export function useOutWorkApprovalInboxQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.outWorkApprovalInbox(),
    queryFn: () => listOutWorkApprovalInbox(),
    ...options,
  });
}

export function useOutWorkApprovalHistoryQuery(requesterAuthUserId = "", options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.outWorkApprovalHistory(requesterAuthUserId),
    queryFn: () => listOutWorkApprovalHistory(requesterAuthUserId),
    ...options,
  });
}

export function useOutWorkRegisterQuery(filters = {}, options = {}) {
  const normalizedFilters = useMemo(() => cleanQueryParams(filters), [filters]);
  return useQuery({
    queryKey: queryKeys.hr.outWorkRegister(normalizedFilters),
    queryFn: () => listOutWorkRegister(normalizedFilters),
    ...options,
  });
}

export function useDayRecordsQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.hr.dayRecords(normalizedParams),
    queryFn: () => listDayRecords(normalizedParams),
    ...options,
  });
}

export function useCorrectionRequestsQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.correctionRequests(),
    queryFn: () => listCorrectionRequests(),
    ...options,
  });
}

export function useCorrectionRequestDetailQuery(correctionRequestId = "", options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.correctionRequestDetail(correctionRequestId),
    queryFn: () => getCorrectionRequestDetail(correctionRequestId),
    enabled: Boolean(correctionRequestId) && (options.enabled ?? true),
    ...options,
  });
}

export function useCorrectionApprovalInboxQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.correctionApprovalInbox(),
    queryFn: () => listCorrectionApprovalInbox(),
    ...options,
  });
}

export function useCorrectionApprovalHistoryQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.correctionApprovalHistory(),
    queryFn: () => listCorrectionApprovalHistory(),
    ...options,
  });
}

export function useMonthlyAttendanceSummaryQuery({ year = null, month = null } = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.monthlyAttendanceSummary({ year, month }),
    queryFn: () => getMonthlyAttendanceSummary({ year, month }),
    enabled: Boolean(year && month) && (options.enabled ?? true),
    ...options,
  });
}

export function useDailyAttendanceRegisterQuery({ fromDate = null, toDate = null } = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.dailyAttendanceRegister({ fromDate, toDate }),
    queryFn: () => getDailyAttendanceRegister({ fromDate, toDate }),
    enabled: Boolean(fromDate && toDate) && (options.enabled ?? true),
    ...options,
  });
}

export function useYearlyLeaveSummaryQuery({ year = null, employeeId = "" } = {}, options = {}) {
  const trimmedEmployeeId = String(employeeId ?? "").trim();
  return useQuery({
    queryKey: queryKeys.hr.yearlyLeaveSummary({ year, employeeId: trimmedEmployeeId }),
    queryFn: () => getYearlyLeaveSummary({ year, employeeId: trimmedEmployeeId }),
    enabled: Boolean(year && trimmedEmployeeId) && (options.enabled ?? true),
    ...options,
  });
}

export function useDepartmentAttendanceReportQuery({ fromDate = null, toDate = null } = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.departmentAttendanceReport({ fromDate, toDate }),
    queryFn: () => getDepartmentAttendanceReport({ fromDate, toDate }),
    enabled: Boolean(fromDate && toDate) && (options.enabled ?? true),
    ...options,
  });
}

export function useLeaveUsageReportQuery({ year = null } = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.leaveUsageReport({ year }),
    queryFn: () => getLeaveUsageReport({ year }),
    enabled: Boolean(year) && (options.enabled ?? true),
    ...options,
  });
}
