import { resolveErrorMessage } from "../../../utils/errorMessages.js";

/*
 * File-ID: 15.1
 * File-Path: frontend/src/pages/dashboard/om/omApi.js
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Provide all Operation Management frontend API fetch helpers.
 * Authority: Frontend
 */

// @ts-ignore Vite injects import.meta.env at runtime in this frontend bundle.
const BASE = import.meta.env.VITE_API_BASE;

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function createError(json, response, fallbackCode) {
  const code = json?.code ?? fallbackCode;
  const error = new Error(resolveErrorMessage(code, json?.message, response.status));
  // @ts-ignore Frontend API helpers attach transport metadata to thrown errors.
  error.code = code;
  // @ts-ignore Frontend API helpers attach transport metadata to thrown errors.
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

/**
 * @param {Record<string, unknown>} [params]
 */
export async function listMaterials({
  material_type,
  status,
  search,
  limit = 50,
  offset = 0,
  company_id,
} = {}) {
  const params = buildParams({ material_type, status, search, limit, offset, company_id });
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

export async function bulkSaveMaterials(payload) {
  return fetchJson(
    "/api/om/materials/bulk-save",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_BULK_SAVE_FAILED"
  );
}

export async function importMaterialsCsv(csvText) {
  return fetchJson(
    "/api/om/materials/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv_text: csvText }),
    },
    "OM_CSV_IMPORT_FAILED"
  );
}

/**
 * @param {Record<string, unknown>} [params]
 */
export async function listCompanyMapping({ company_id, search } = {}) {
  const params = buildParams({ company_id, search });
  return fetchJson(
    `/api/om/material/company-mapping?${params.toString()}`,
    {},
    "OM_COMPANY_MAPPING_FAILED"
  );
}

export async function bulkMapMaterials(payload) {
  return fetchJson(
    "/api/om/material/company-map-bulk",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MATERIAL_MAP_FAILED"
  );
}

export async function deleteMaterials(ids) {
  return fetchJson(
    "/api/om/materials",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
    "OM_MATERIAL_DELETE_FAILED"
  );
}

export async function bulkUnmapMaterials(payload) {
  return fetchJson(
    "/api/om/material/company-unmap-bulk",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MATERIAL_UNMAP_FAILED"
  );
}

export async function importCompanyMapping(csvText) {
  return fetchJson(
    "/api/om/material/company-mapping-import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv_text: csvText }),
    },
    "OM_MAPPING_IMPORT_FAILED"
  );
}

export async function listMaterialTypeCategories(params = {}) {
  const query = buildParams(params);
  return fetchJson(
    `/api/om/material-type-categories?${query.toString()}`,
    {},
    "OM_MATERIAL_TYPE_CATEGORY_LIST_FAILED"
  );
}

export async function createMaterialTypeCategory(payload) {
  return fetchJson(
    "/api/om/material-type-category",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MATERIAL_TYPE_CATEGORY_CREATE_FAILED"
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

export async function updateMaterialUomConversion(payload) {
  return fetchJson(
    "/api/om/material/uom-conversion",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_UOM_CONVERSION_UPDATE_FAILED"
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

/**
 * @param {Record<string, unknown>} [params]
 */
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

export async function deleteVendors(ids) {
  return fetchJson(
    "/api/om/vendors",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
    "OM_VENDOR_DELETE_FAILED"
  );
}

export async function getVendorBanks(vendor_id) {
  const params = buildParams({ vendor_id });
  return fetchJson(`/api/om/vendor/banks?${params.toString()}`, {}, "OM_VENDOR_BANKS_FAILED");
}

export async function upsertVendorBanks(payload) {
  return fetchJson(
    "/api/om/vendor/banks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_BANKS_FAILED"
  );
}

export async function getVendorContacts(vendor_id) {
  const params = buildParams({ vendor_id });
  return fetchJson(`/api/om/vendor/contacts?${params.toString()}`, {}, "OM_VENDOR_CONTACTS_FAILED");
}

export async function upsertVendorContacts(payload) {
  return fetchJson(
    "/api/om/vendor/contacts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_CONTACTS_FAILED"
  );
}

export async function getVendorEmails(vendor_id) {
  const params = buildParams({ vendor_id });
  return fetchJson(`/api/om/vendor/emails?${params.toString()}`, {}, "OM_VENDOR_EMAILS_FAILED");
}

export async function upsertVendorEmails(payload) {
  return fetchJson(
    "/api/om/vendor/emails",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_EMAILS_FAILED"
  );
}

/**
 * @param {Record<string, unknown>} [params]
 */
export async function listVendorCompanyMapping({ company_id, search, vendor_type } = {}) {
  const params = buildParams({ company_id, search, vendor_type });
  return fetchJson(`/api/om/vendor/company-mapping?${params.toString()}`, {}, "OM_VENDOR_MAPPING_LIST_FAILED");
}

export async function bulkMapVendors(payload) {
  return fetchJson(
    "/api/om/vendor/company-map-bulk",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_MAP_FAILED"
  );
}

export async function bulkUnmapVendors(payload) {
  return fetchJson(
    "/api/om/vendor/company-unmap-bulk",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_VENDOR_UNMAP_FAILED"
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

/**
 * @param {Record<string, unknown>} [params]
 */
export async function listVendorMaterialInfos({
  vendor_search,
  material_search,
  status,
  limit = 50,
  offset = 0,
} = {}) {
  const params = buildParams({ vendor_search, material_search, status, limit, offset });
  return fetchJson(
    `/api/om/vendor-material-infos?${params.toString()}`,
    {},
    "OM_VMI_LIST_FAILED"
  );
}

/**
 * @param {Record<string, unknown>} [params]
 */
export async function getVendorMaterialInfo({ id, vendor_id, material_id } = {}) {
  const params = buildParams({ id, vendor_id, material_id });
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

export async function unmapVendorMaterialInfo(id) {
  const params = buildParams({ id });
  return fetchJson(
    `/api/om/vendor-material-info?${params.toString()}`,
    { method: "DELETE" },
    "OM_VMI_UNMAP_FAILED"
  );
}

export async function listMappedMaterialIdsForVendor(vendorId) {
  const params = buildParams({ vendor_id: vendorId });
  return fetchJson(
    `/api/om/vendor-material-info/mapped-materials?${params.toString()}`,
    {},
    "OM_VMI_MAPPED_MATERIALS_LOOKUP_FAILED"
  );
}

/**
 * @typedef {Object} CreateCustomerPayload
 * @property {string} [customer_name] Required unless `vendor_id` is set.
 * @property {string} [vendor_id] Required unless `customer_name` is set.
 * @property {string} [parent_customer_id]
 * @property {"DOMESTIC"|"EXPORT"} customer_type
 * @property {"MTO_HPS"|"MTEST"|"MTS"} [fo_customer_type]
 * @property {string} delivery_address
 * @property {string} [billing_address]
 * @property {string} billing_state Required for both DOMESTIC and EXPORT.
 * @property {string} [town]
 * @property {string} company_id Required company scope for the initial map row.
 * @property {string} [gst_number]
 * @property {"REGISTERED"|"UNREGISTERED"|"COMPOSITION"|"EXPORT"} [gst_category]
 * @property {string} [pan_number]
 * @property {string} [primary_contact_person]
 * @property {string} [phone]
 * @property {string} [primary_email]
 * @property {string} [currency_code]
 */

/**
 * @param {CreateCustomerPayload} payload
 */
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


/**
 * @param {Record<string, unknown>} [params]
 */
export async function listCustomers({
  customer_type,
  fo_customer_type,
  status,
  search,
  company_id,
  limit = 50,
  offset = 0,
} = {}) {
  const params = buildParams({ customer_type, fo_customer_type, status, search, company_id, limit, offset });
  return fetchJson(`/api/om/customers?${params.toString()}`, {}, "OM_CUSTOMER_LIST_FAILED");
}

export async function lookupCustomerGstProfile(gstNumber) {
  const params = buildParams({ gst_number: gstNumber });
  return fetchJson(`/api/om/customer/gst-profile?${params.toString()}`, {}, "OM_CUSTOMER_GST_LOOKUP_FAILED");
}

export async function lookupSharedGstProfile(gstNumber) {
  const params = buildParams({ gst_number: gstNumber });
  return fetchJson(`/api/procurement/gst-profile?${params.toString()}`, {}, "PROCUREMENT_GST_LOOKUP_FAILED");
}

export async function getCustomer(id) {
  const params = buildParams({ id });
  return fetchJson(`/api/om/customer?${params.toString()}`, {}, "OM_CUSTOMER_LOOKUP_FAILED");
}

/**
 * @typedef {Object} UpdateCustomerPayload
 * @property {string} id
 * @property {string} [customer_name]
 * @property {string} [gst_number]
 * @property {string} [parent_customer_id]
 * @property {string} [delivery_address]
 * @property {string} [billing_address]
 * @property {string} [billing_state]
 * @property {string} [town]
 * @property {string} [pan_number]
 * @property {string} [primary_contact_person]
 * @property {string} [phone]
 * @property {string} [primary_email]
 * @property {string} [currency_code]
 * @property {"REGISTERED"|"UNREGISTERED"|"COMPOSITION"|"EXPORT"|""} [gst_category]
 * @property {"MTO_HPS"|"MTEST"|"MTS"|""} [fo_customer_type]
 */

/**
 * @param {UpdateCustomerPayload} payload
 */
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

export async function createFgParentCompany(payload) {
  return fetchJson(
    "/api/om/fg-parent-company",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "MM05_PARENT_COMPANY_CREATE_FAILED"
  );
}

export async function listFgParentCompanies(params = {}) {
  const query = buildParams(params);
  return fetchJson(`/api/om/fg-parent-companies?${query.toString()}`, {}, "MM05_PARENT_COMPANY_LIST_FAILED");
}

export async function createOrGetFgDepotCode(payload) {
  return fetchJson(
    "/api/om/fg-depot-code",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "MM05_DEPOT_CODE_CREATE_FAILED"
  );
}

export async function listFgDepotCodes(params = {}) {
  const query = buildParams(params);
  return fetchJson(`/api/om/fg-depot-codes?${query.toString()}`, {}, "MM05_DEPOT_CODE_LIST_FAILED");
}

export async function createFgDispatchCustomer(payload) {
  return fetchJson(
    "/api/om/fg-dispatch-customer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "MM05_CUSTOMER_CREATE_FAILED"
  );
}

export async function upgradeFgDispatchCustomer(customerId, payload) {
  return fetchJson(
    `/api/om/fg-dispatch-customers/${customerId}/upgrade-gst`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "MM05_CUSTOMER_UPGRADE_FAILED"
  );
}

export async function addFgDispatchCustomerAddress(customerId, payload) {
  return fetchJson(
    `/api/om/fg-dispatch-customers/${customerId}/addresses`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "MM05_ADDRESS_CREATE_FAILED"
  );
}

export async function listFgDispatchCustomerAddresses(customerId) {
  return fetchJson(`/api/om/fg-dispatch-customers/${customerId}/addresses`, {}, "MM05_ADDRESS_LIST_FAILED");
}

export async function updateFgDispatchCustomerAddress(addressId, payload) {
  return fetchJson(
    `/api/om/fg-dispatch-addresses/${addressId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "MM05_ADDRESS_UPDATE_FAILED"
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

export async function updateUom(payload) {
  return fetchJson(
    "/api/om/uom",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_UOM_UPDATE_FAILED"
  );
}

export async function toggleUom(payload) {
  return fetchJson(
    "/api/om/uom/toggle",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_UOM_TOGGLE_FAILED"
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

export async function listMaterialCategoryGroups(companyId) {
  const params = buildParams({ company_id: companyId });
  return fetchJson(`/api/om/material/category-groups?${params.toString()}`, {}, "OM_MCG_LIST_FAILED");
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

export async function updateMaterialCategoryGroup(payload) {
  return fetchJson(
    "/api/om/material/category-group",
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    "OM_MCG_UPDATE_FAILED"
  );
}

export async function deleteMaterialCategoryGroup(id) {
  return fetchJson(
    "/api/om/material/category-group",
    { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) },
    "OM_MCG_DELETE_FAILED"
  );
}

export async function removeMaterialCategoryMember(memberId) {
  return fetchJson(
    "/api/om/material/category-group/member",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId }),
    },
    "OM_MCG_MEMBER_REMOVE_FAILED"
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

export async function updateCostCenter(payload) {
  return fetchJson(
    "/api/om/cost-center",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_CC_UPDATE_FAILED"
  );
}

export async function toggleCostCenter(payload) {
  return fetchJson(
    "/api/om/cost-center/toggle",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_CC_TOGGLE_FAILED"
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

export async function updateMachine(payload) {
  return fetchJson(
    "/api/om/machine",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MACHINE_UPDATE_FAILED"
  );
}

export async function toggleMachine(payload) {
  return fetchJson(
    "/api/om/machine/toggle",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_MACHINE_TOGGLE_FAILED"
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

export async function listCustomerCompanyMaps(customerId) {
  const params = buildParams({ customer_id: customerId });
  return fetchJson(`/api/om/customer/company-maps?${params.toString()}`, {}, "OM_CUSTOMER_COMPANY_MAP_LIST_FAILED");
}

export async function listParentCustomers(params = {}) {
  const query = buildParams(params);
  return fetchJson(`/api/om/parent-customers?${query.toString()}`, {}, "OM_PARENT_CUSTOMER_LIST_FAILED");
}

export async function createParentCustomer(payload) {
  return fetchJson(
    "/api/om/parent-customer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_PARENT_CUSTOMER_CREATE_FAILED"
  );
}

export async function updateParentCustomer(payload) {
  return fetchJson(
    "/api/om/parent-customer",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_PARENT_CUSTOMER_UPDATE_FAILED"
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

export async function updateStorageLocation(payload) {
  return fetchJson(
    "/api/om/storage-location",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_LOCATION_UPDATE_FAILED"
  );
}

export async function toggleStorageLocation(payload) {
  return fetchJson(
    "/api/om/storage-location/toggle",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_LOCATION_TOGGLE_FAILED"
  );
}

/**
 * @param {Record<string, unknown>} [params]
 */
export async function listPlantAssignments({ company_id } = {}) {
  const params = buildParams({ company_id });
  return fetchJson(
    `/api/om/storage-location/plant-assignments?${params.toString()}`,
    {},
    "OM_LOCATION_LIST_FAILED"
  );
}

export async function unmapStorageLocationsFromPlant(payload) {
  return fetchJson(
    "/api/om/storage-location/plant-unmap",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "OM_LOCATION_UNMAP_FAILED"
  );
}

export async function listMaterialCompanyExtensions(materialId) {
  const params = buildParams({ material_id: materialId });
  return fetchJson(`/api/om/material/company-extensions?${params.toString()}`, {}, "OM_MATERIAL_COMPANY_EXT_LIST_FAILED");
}

export async function listMaterialPlantExtensions(materialId) {
  const params = buildParams({ material_id: materialId });
  return fetchJson(`/api/om/material/plant-extensions?${params.toString()}`, {}, "OM_MATERIAL_PLANT_EXT_LIST_FAILED");
}

export async function listVendorCompanyMaps(vendorId) {
  const params = buildParams({ vendor_id: vendorId });
  return fetchJson(`/api/om/vendor/company-maps?${params.toString()}`, {}, "OM_VENDOR_COMPANY_MAP_LIST_FAILED");
}

async function fetchAdminJsonSafe(path, fallbackCode) {
  const response = await fetch(`${BASE}${path}`, { credentials: "include" });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    const code = json?.code ?? fallbackCode;
    const error = new Error(resolveErrorMessage(code, json?.message, response.status));
    // @ts-ignore Frontend API helpers attach transport metadata to thrown errors.
    error.code = code;
    // @ts-ignore Frontend API helpers attach transport metadata to thrown errors.
    error.status = response.status;
    throw error;
  }
  return json.data;
}

export async function listCompaniesForOm() {
  const data = await fetchAdminJsonSafe("/api/admin/companies", "COMPANY_LIST_FAILED");
  return Array.isArray(data?.companies) ? data.companies : [];
}

export async function listProjectsByCompany(companyId) {
  const params = companyId ? `?company_id=${encodeURIComponent(companyId)}` : "";
  const data = await fetchAdminJsonSafe(`/api/admin/projects${params}`, "PROJECT_LIST_FAILED");
  return Array.isArray(data?.projects) ? data.projects : [];
}
