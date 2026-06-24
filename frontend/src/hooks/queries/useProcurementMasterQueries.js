import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listCompanies, listPaymentTerms } from "../../pages/dashboard/procurement/procurementApi.js";
import { queryKeys } from "./queryKeys.js";
import { cleanQueryParams, maybeArray } from "./queryUtils.js";

export function useCompaniesQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.procurement.companies(),
    queryFn: () => listCompanies(),
    ...options,
  });
}

export function usePaymentTermsQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.procurement.paymentTerms(normalizedParams),
    queryFn: () => listPaymentTerms(normalizedParams),
    ...options,
  });
}

export function usePaymentTermOptionsQuery(params = {}, options = {}) {
  const query = usePaymentTermsQuery(params, options);
  return {
    ...query,
    paymentTerms: maybeArray(query.data),
  };
}
