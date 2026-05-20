/*
 * File-ID: 15.1
 * File-Path: frontend/src/pages/dashboard/om/omApi.js
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Provide all Operation Management frontend API fetch helpers.
 * Authority: Frontend
 */

const BASE = import.meta.env.VITE_API_BASE;

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function createError(json, response, fallbackCode) {
  const error = new Error(json?.code ?? fallbackCode);
  error.status = response.status;
  throw error;
}

async function fetchJson(path, options = {}, fallbackCode = "OM_REQUEST_FAILED") {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    createError(json, response, fallbackCode);
  }
  return json.data;
}

function buildParams(values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    params.set(key, String(value));
  });
  return params;
}

export async function createMaterial(payload) {
  return fetchJson(
    "/api/om/material",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MATERIAL_CREATE_FAILED"
  );
}

export async function listMaterials({
  material_type,
  status,
  search,
  limit = 50,
  offset = 0,
} = {}) {
  const params = buildParams({ material_type, status, search, limit, offset });
  return fetchJson(`/api/om/materials?${params.toString()}`, {}, "OM_MATERIAL_LIST_FAILED");
}

export async function getMaterial(id) {
  const params = buildParams({ id });
  return fetchJson(`/api/om/material?${params.toString()}`, {}, "OM_MATERIAL_LOOKUP_FAILED");
}

export async function updateMaterial(payload) {
  return fetchJson(
    "/api/om/material",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MATERIAL_UPDATE_FAILED"
  );
}

export async function changeMaterialStatus(payload) {
  return fetchJson(
    "/api/om/material/status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MATERIAL_STATUS_UPDATE_FAILED"
  );
}

export async function createMaterialUomConversion(payload) {
  return fetchJson(
    "/api/om/material/uom-conversion",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_UOM_CONVERSION_CREATE_FAILED"
  );
}

export async function listMaterialUomConversions(materialId) {
  const params = buildParams({ material_id: materialId });
  return fetchJson(
    `/api/om/material/uom-conversions?${params.toString()}`,
    {},
    "OM_UOM_CONVERSION_LIST_FAILED"
  );
}

export async function createVendor(payload) {
  return fetchJson(
    "/api/om/vendor",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_CREATE_FAILED"
  );
}

export async function listVendors({
  vendor_type,
  status,
  search,
  limit = 50,
  offset = 0,
} = {}) {
  const params = buildParams({ vendor_type, status, search, limit, offset });
  return fetchJson(`/api/om/vendors?${params.toString()}`, {}, "OM_VENDOR_LIST_FAILED");
}

export async function getVendor(id) {
  const params = buildParams({ id });
  return fetchJson(`/api/om/vendor?${params.toString()}`, {}, "OM_VENDOR_LOOKUP_FAILED");
}

export async function updateVendor(payload) {
  return fetchJson(
    "/api/om/vendor",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_UPDATE_FAILED"
  );
}

export async function changeVendorStatus(payload) {
  return fetchJson(
    "/api/om/vendor/status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_STATUS_UPDATE_FAILED"
  );
}

export async function addVendorPaymentTerms(payload) {
  return fetchJson(
    "/api/om/vendor/payment-terms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_PAYMENT_TERMS_CREATE_FAILED"
  );
}

export async function getVendorPaymentTerms(vendorId, companyId) {
  const params = buildParams({ vendor_id: vendorId, company_id: companyId });
  return fetchJson(
    `/api/om/vendor/payment-terms?${params.toString()}`,
    {},
    "OM_PAYMENT_TERMS_LOOKUP_FAILED"
  );
}

export async function createVendorMaterialInfo(payload) {
  return fetchJson(
    "/api/om/vendor-material-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VMI_CREATE_FAILED"
  );
}

export async function listVendorMaterialInfos({
  vendor_id,
  material_id,
  status,
  limit = 50,
  offset = 0,
} = {}) {
  const params = buildParams({ vendor_id, material_id, status, limit, offset });
  return fetchJson(
    `/api/om/vendor-material-infos?${params.toString()}`,
    {},
    "OM_VMI_LIST_FAILED"
  );
}

export async function getVendorMaterialInfo(id) {
  const params = buildParams({ id });
  return fetchJson(
    `/api/om/vendor-material-info?${params.toString()}`,
    {},
    "OM_VMI_LOOKUP_FAILED"
  );
}

export async function updateVendorMaterialInfo(payload) {
  return fetchJson(
    "/api/om/vendor-material-info",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VMI_UPDATE_FAILED"
  );
}

export async function changeVendorMaterialInfoStatus(payload) {
  return fetchJson(
    "/api/om/vendor-material-info/status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VMI_STATUS_UPDATE_FAILED"
  );
}

export async function createCustomer(payload) {
  return fetchJson(
    "/api/om/customer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_CUSTOMER_CREATE_FAILED"
  );
}

export async function listCustomers({
  customer_type,
  status,
  search,
  limit = 50,
  offset = 0,
} = {}) {
  const params = buildParams({ customer_type, status, search, limit, offset });
  return fetchJson(`/api/om/customers?${params.toString()}`, {}, "OM_CUSTOMER_LIST_FAILED");
}

export async function getCustomer(id) {
  const params = buildParams({ id });
  return fetchJson(`/api/om/customer?${params.toString()}`, {}, "OM_CUSTOMER_LOOKUP_FAILED");
}

export async function updateCustomer(payload) {
  return fetchJson(
    "/api/om/customer",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_CUSTOMER_UPDATE_FAILED"
  );
}

export async function changeCustomerStatus(payload) {
  return fetchJson(
    "/api/om/customer/status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_CUSTOMER_STATUS_UPDATE_FAILED"
  );
}

export async function listUoms(params = {}) {
  const query = buildParams(params);
  return fetchJson(`/api/om/uoms?${query.toString()}`, {}, "OM_UOM_LIST_FAILED");
}

export async function createUom(payload) {
  return fetchJson(
    "/api/om/uom",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_UOM_CREATE_FAILED"
  );
}

export async function listStorageLocations(params = {}) {
  const query = buildParams(params);
  return fetchJson(
    `/api/om/storage-locations?${query.toString()}`,
    {},
    "OM_LOCATION_LIST_FAILED"
  );
}

export async function createStorageLocation(payload) {
  return fetchJson(
    "/api/om/storage-location",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_LOCATION_CREATE_FAILED"
  );
}

export async function listNumberSeries(params = {}) {
  const query = buildParams(params);
  return fetchJson(
    `/api/om/number-series?${query.toString()}`,
    {},
    "OM_NUMBER_SERIES_LIST_FAILED"
  );
}

export async function createNumberSeries(payload) {
  return fetchJson(
    "/api/om/number-series",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_NUMBER_SERIES_CREATE_FAILED"
  );
}

export async function listMaterialCategoryGroups() {
  return fetchJson("/api/om/material/category-groups", {}, "OM_MCG_LIST_FAILED");
}

export async function createMaterialCategoryGroup(payload) {
  return fetchJson(
    "/api/om/material/category-group",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MCG_CREATE_FAILED"
  );
}

export async function addMaterialCategoryMember(payload) {
  return fetchJson(
    "/api/om/material/category-group/member",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MCG_MEMBER_ADD_FAILED"
  );
}

export async function listCostCenters(params = {}) {
  const query = buildParams(params);
  return fetchJson(`/api/om/cost-centers?${query.toString()}`, {}, "OM_CC_LIST_FAILED");
}

export async function createCostCenter(payload) {
  return fetchJson(
    "/api/om/cost-center",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_CC_CREATE_FAILED"
  );
}

export async function listMachines(params = {}) {
  const query = buildParams(params);
  return fetchJson(`/api/om/machines?${query.toString()}`, {}, "OM_MACHINE_LIST_FAILED");
}

export async function createMachine(payload) {
  return fetchJson(
    "/api/om/machine",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MACHINE_CREATE_FAILED"
  );
}

export async function extendMaterialToCompany(payload) {
  const normalizedPayload = {
    ...payload,
    hsn_code_override: payload?.hsn_code_override ?? payload?.hsn_override,
  };
  return fetchJson(
    "/api/om/material/extend-company",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedPayload),
    },
    "OM_MATERIAL_EXTEND_COMPANY_FAILED"
  );
}

export async function extendMaterialToPlant(payload) {
  return fetchJson(
    "/api/om/material/extend-plant",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MATERIAL_EXTEND_PLANT_FAILED"
  );
}

export async function mapVendorToCompany(payload) {
  return fetchJson(
    "/api/om/vendor/company-map",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_COMPANY_MAP_FAILED"
  );
}

export async function mapCustomerToCompany(payload) {
  return fetchJson(
    "/api/om/customer/company-map",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_CUSTOMER_COMPANY_MAP_FAILED"
  );
}

export async function mapStorageLocationToPlant(payload) {
  return fetchJson(
    "/api/om/storage-location/plant-map",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_SLOC_PLANT_MAP_FAILED"
  );
}
