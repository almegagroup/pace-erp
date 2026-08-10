import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listMaterialTypeCategories,
  listCompaniesForOm,
  listCostCenters,
  listCustomers,
  listMaterials,
  listParentCustomers,
  listStorageLocations,
  listUoms,
  listVendors,
} from "../../pages/dashboard/om/omApi.js";
import { queryKeys } from "./queryKeys.js";
import { cleanQueryParams, maybeArray } from "./queryUtils.js";

// Client-side picker/lookup queries (useMaterialOptionsQuery, useVendorOptionsQuery,
// useCustomerOptionsQuery) fetch a master table ONCE and build an in-memory id -> row
// Map on the client, for both display-name resolution and dropdown option lists. A
// too-small `limit` silently truncates whatever rows sort past it as the table grows --
// no error, just blank names / raw UUIDs shown instead of names, or missing dropdown
// options for anything outside the window.
//
// Real incident (2026-08-10): Inward QA Queue (PO06) started showing a raw material
// UUID and "no category" for a real, valid RM material once erp_master.material_master
// crossed ~200 rows (FG alone is 201 rows and sorts first by material_type -- so any
// limit:200 fetch on this table returns ZERO non-FG materials). Over a dozen pages
// across procurement/production shared this exact hardcoded limit:200/300/500 pattern.
//
// Use this constant instead of a magic number for any "load the full picker list"
// query on material/vendor/customer -- one place to raise if a master table ever
// outgrows it. (413 materials / 78 vendors / 15 customers as of 2026-08-10 -- this
// gives generous headroom for all three.)
export const MASTER_PICKER_FETCH_LIMIT = 5000;

export function useVendorsQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.om.vendors(normalizedParams),
    queryFn: () => listVendors(normalizedParams),
    ...options,
  });
}

export function useVendorOptionsQuery(params = {}, options = {}) {
  const query = useVendorsQuery(params, options);
  return {
    ...query,
    vendors: maybeArray(query.data?.data),
  };
}

export function useMaterialsQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.om.materials(normalizedParams),
    queryFn: () => listMaterials(normalizedParams),
    ...options,
  });
}

export function useMaterialTypeCategoriesQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.om.materialTypeCategories(normalizedParams),
    queryFn: () => listMaterialTypeCategories(normalizedParams),
    enabled: options.enabled ?? true,
    ...options,
  });
}

export function useMaterialOptionsQuery(params = {}, options = {}) {
  const query = useMaterialsQuery(params, options);
  return {
    ...query,
    materials: maybeArray(query.data?.data),
  };
}

export function useMaterialTypeCategoryOptionsQuery(params = {}, options = {}) {
  const query = useMaterialTypeCategoriesQuery(params, options);
  return {
    ...query,
    categories: maybeArray(query.data?.data),
  };
}

export function useCustomersQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.om.customers(normalizedParams),
    queryFn: () => listCustomers(normalizedParams),
    ...options,
  });
}

export function useCustomerOptionsQuery(params = {}, options = {}) {
  const query = useCustomersQuery(params, options);
  return {
    ...query,
    customers: maybeArray(query.data?.data),
  };
}

export function useStorageLocationsQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.om.storageLocations(normalizedParams),
    queryFn: () => listStorageLocations(normalizedParams),
    ...options,
  });
}

export function useStorageLocationOptionsQuery(params = {}, options = {}) {
  const query = useStorageLocationsQuery(params, options);
  return {
    ...query,
    storageLocations: maybeArray(query.data?.data ?? query.data),
  };
}

export function useCostCentersQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  const isEnabled = options.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.om.costCenters(normalizedParams),
    queryFn: () => listCostCenters(normalizedParams),
    enabled: isEnabled && (!("company_id" in normalizedParams) || Boolean(normalizedParams.company_id)),
    ...options,
  });
}

export function useUomsQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.om.uoms(normalizedParams),
    queryFn: () => listUoms(normalizedParams),
    ...options,
  });
}

export function useParentCustomersQuery(params = {}, options = {}) {
  const normalizedParams = useMemo(() => cleanQueryParams(params), [params]);
  return useQuery({
    queryKey: queryKeys.om.parentCustomers(normalizedParams),
    queryFn: () => listParentCustomers(normalizedParams),
    ...options,
  });
}

export function useCompaniesForOmQuery(options = {}) {
  return useQuery({
    queryKey: queryKeys.om.companies(),
    queryFn: () => listCompaniesForOm(),
    ...options,
  });
}
