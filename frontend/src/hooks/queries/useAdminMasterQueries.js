import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listCompaniesForOm, listProjectsByCompany } from "../../pages/dashboard/om/omApi.js";
import { queryKeys } from "./queryKeys.js";
import { cleanQueryParams } from "./queryUtils.js";

export function useAdminCompaniesQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.admin.companies(),
    queryFn: () => listCompaniesForOm(),
    ...options,
  });
}

export function useAdminProjectsQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.admin.projects(normalizedParams),
    queryFn: () => listProjectsByCompany(normalizedParams.company_id),
    ...options,
  });
}
