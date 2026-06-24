import { cleanQueryParams } from "./queryUtils.js";

export const queryKeys = {
  om: {
    vendors: (params = {}) => ["om", "vendors", cleanQueryParams(params)],
    materials: (params = {}) => ["om", "materials", cleanQueryParams(params)],
    customers: (params = {}) => ["om", "customers", cleanQueryParams(params)],
    storageLocations: (params = {}) => ["om", "storage-locations", cleanQueryParams(params)],
    costCenters: (params = {}) => ["om", "cost-centers", cleanQueryParams(params)],
    uoms: (params = {}) => ["om", "uoms", cleanQueryParams(params)],
    parentCustomers: (params = {}) => ["om", "parent-customers", cleanQueryParams(params)],
    companies: () => ["om", "companies"],
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
  },
};
