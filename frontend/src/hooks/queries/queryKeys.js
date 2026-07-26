import { cleanQueryParams } from "./queryUtils.js";

export const queryKeys = {
  admin: {
    // PERF: `admin.companies` and `om.companies` are DELIBERATELY the same key. Both
    // useAdminCompaniesQuery and useCompaniesForOmQuery call the identical function
    // (listCompaniesForOm -> GET /api/admin/companies), but they used to sit under different
    // keys, so React Query treated them as two unrelated queries: no dedup, no shared cache,
    // and /api/admin/companies was fetched twice (measured 4x on a live page load). Sharing the
    // key makes it one cached fetch. Keep them identical — do not "tidy" them apart.
    // NOTE: procurement.companies is a genuinely DIFFERENT endpoint
    // (GET /api/procurement/companies) and correctly stays separate.
    companies: () => ["admin", "companies"],
    projects: (params = {}) => ["admin", "projects", cleanQueryParams(params)],
  },
  om: {
    vendors: (params = {}) => ["om", "vendors", cleanQueryParams(params)],
    materials: (params = {}) => ["om", "materials", cleanQueryParams(params)],
    materialTypeCategories: (params = {}) => ["om", "material-type-categories", cleanQueryParams(params)],
    customers: (params = {}) => ["om", "customers", cleanQueryParams(params)],
    storageLocations: (params = {}) => ["om", "storage-locations", cleanQueryParams(params)],
    costCenters: (params = {}) => ["om", "cost-centers", cleanQueryParams(params)],
    uoms: (params = {}) => ["om", "uoms", cleanQueryParams(params)],
    parentCustomers: (params = {}) => ["om", "parent-customers", cleanQueryParams(params)],
    // Same key as admin.companies on purpose — same function, same endpoint. See the note there.
    companies: () => ["admin", "companies"],
  },
  procurement: {
    companies: () => ["procurement", "companies"],
    paymentTerms: (params = {}) => ["procurement", "payment-terms", cleanQueryParams(params)],
  },
  hr: {
    leaveTypes: (companyId = null) => ["hr", "leave-types", companyId ?? null],
    allLeaveTypes: (companyId = null) => ["hr", "leave-types-all", companyId ?? null],
    holidays: ({ year = null, companyId = null } = {}) => ["hr", "holidays", { companyId, year }],
    weekOffConfig: (companyId = null) => ["hr", "week-off-config", companyId ?? null],
    outWorkDestinations: (companyId = null) => ["hr", "out-work-destinations", companyId ?? null],
    myLeaveRequests: () => ["hr", "my-leave-requests"],
    leaveApprovalInbox: () => ["hr", "leave-approval-inbox"],
    leaveApprovalHistory: (requesterAuthUserId = "") => ["hr", "leave-approval-history", requesterAuthUserId || ""],
    leaveRegister: (filters = {}) => ["hr", "leave-register", cleanQueryParams(filters)],
    myOutWorkRequests: () => ["hr", "my-out-work-requests"],
    outWorkApprovalInbox: () => ["hr", "out-work-approval-inbox"],
    outWorkApprovalHistory: (requesterAuthUserId = "") => ["hr", "out-work-approval-history", requesterAuthUserId || ""],
    outWorkRegister: (filters = {}) => ["hr", "out-work-register", cleanQueryParams(filters)],
    dayRecords: (params = {}) => ["hr", "day-records", cleanQueryParams(params)],
    correctionRequests: () => ["hr", "correction-requests"],
    correctionRequestDetail: (correctionRequestId = "") => ["hr", "correction-request-detail", correctionRequestId || ""],
    correctionApprovalInbox: () => ["hr", "correction-approval-inbox"],
    correctionApprovalHistory: () => ["hr", "correction-approval-history"],
    monthlyAttendanceSummary: ({ year = null, month = null } = {}) => ["hr", "monthly-attendance-summary", { year, month }],
    dailyAttendanceRegister: ({ fromDate = null, toDate = null } = {}) => ["hr", "daily-attendance-register", { fromDate, toDate }],
    yearlyLeaveSummary: ({ year = null, employeeId = "" } = {}) => ["hr", "yearly-leave-summary", { year, employeeId: employeeId || "" }],
    departmentAttendanceReport: ({ fromDate = null, toDate = null } = {}) => ["hr", "department-attendance-report", { fromDate, toDate }],
    leaveUsageReport: ({ year = null } = {}) => ["hr", "leave-usage-report", { year }],
  },
};
