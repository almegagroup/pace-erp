import { useQuery } from "@tanstack/react-query";
import {
  getWeekOffConfig,
  listAllLeaveTypes,
  listHolidays,
  listLeaveTypes,
  listOutWorkDestinations,
} from "../../pages/dashboard/hr/hrApi.js";
import { queryKeys } from "./queryKeys.js";

export function useLeaveTypesQuery(companyId = null, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.leaveTypes(companyId),
    queryFn: () => listLeaveTypes(companyId),
    ...options,
  });
}

export function useAllLeaveTypesQuery(companyId = null, options = {}) {
  return useQuery({
    queryKey: queryKeys.hr.allLeaveTypes(companyId),
    queryFn: () => listAllLeaveTypes(companyId),
    ...options,
  });
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
