/*
 * File-ID: 14.9
 * File-Path: supabase/functions/api/_routes/om.routes.ts
 * Gate: 14
 * Phase: 14
 * Domain: MASTER
 * Purpose: Dispatch all /api/om/* backend master data routes.
 * Authority: Backend
 */

import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";
import {
  addMaterialCategoryMemberHandler,
  removeMaterialCategoryMemberHandler,
  updateMaterialCategoryGroupHandler,
  deleteMaterialCategoryGroupHandler,
  bulkSaveMaterialsHandler,
  deleteMaterialsHandler,
  importMaterialsCsvHandler,
  listCompanyMappingHandler,
  bulkMapMaterialsHandler,
  bulkUnmapMaterialsHandler,
  importCompanyMappingHandler,
  changeMaterialStatusHandler,
  createMaterialCategoryGroupHandler,
  createMaterialHandler,
  createMaterialUomConversionHandler,
  extendMaterialToCompanyHandler,
  extendMaterialToPlantHandler,
  getMaterialHandler,
  listMaterialCategoryGroupsHandler,
  listMaterialsHandler,
  listMaterialUomConversionsHandler,
  listMaterialCompanyExtensionsHandler,
  listMaterialPlantExtensionsHandler,
  updateMaterialHandler,
} from "../_core/om/material.handlers.ts";
import {
  addVendorPaymentTermsHandler,
  changeVendorStatusHandler,
  createVendorHandler,
  getVendorHandler,
  getVendorPaymentTermsHandler,
  listVendorCompanyMapsHandler,
  listVendorsHandler,
  mapVendorToCompanyHandler,
  updateVendorHandler,
} from "../_core/om/vendor.handlers.ts";
import {
  changeVendorMaterialInfoStatusHandler,
  createVendorMaterialInfoHandler,
  getVendorMaterialInfoHandler,
  listVendorMaterialInfosHandler,
  updateVendorMaterialInfoHandler,
} from "../_core/om/vendor_material_info.handlers.ts";
import {
  changeCustomerStatusHandler,
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
  mapCustomerToCompanyHandler,
  updateCustomerHandler,
} from "../_core/om/customer.handlers.ts";
import {
  createUomHandler,
  listUomHandler,
  toggleUomHandler,
  updateUomHandler,
} from "../_core/om/uom.handlers.ts";
import {
  createStorageLocationHandler,
  listStorageLocationsHandler,
  listPlantAssignmentsHandler,
  mapStorageLocationToPlantHandler,
  unmapStorageLocationFromPlantHandler,
  updateStorageLocationHandler,
  toggleStorageLocationHandler,
} from "../_core/om/location.handlers.ts";
import {
  createNumberSeriesHandler,
  listNumberSeriesHandler,
} from "../_core/om/number_series.handlers.ts";
import {
  createCostCenterHandler,
  listCostCentersHandler,
  toggleCostCenterHandler,
  updateCostCenterHandler,
} from "../_core/om/cost_center.handlers.ts";
import {
  createMachineHandler,
  listMachinesHandler,
  updateMachineHandler,
  toggleMachineHandler,
} from "../_core/om/machine.handlers.ts";

export async function dispatchOmRoutes(
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
    case "POST:/api/om/material":
      return await createMaterialHandler(req, ctx);
    case "GET:/api/om/materials":
      return await listMaterialsHandler(req, ctx);
    case "GET:/api/om/material":
      return await getMaterialHandler(req, ctx);
    case "PATCH:/api/om/material":
      return await updateMaterialHandler(req, ctx);
    case "POST:/api/om/material/status":
      return await changeMaterialStatusHandler(req, ctx);
    case "POST:/api/om/material/extend-company":
      return await extendMaterialToCompanyHandler(req, ctx);
    case "POST:/api/om/material/extend-plant":
      return await extendMaterialToPlantHandler(req, ctx);
    case "POST:/api/om/material/uom-conversion":
      return await createMaterialUomConversionHandler(req, ctx);
    case "GET:/api/om/material/uom-conversions":
      return await listMaterialUomConversionsHandler(req, ctx);
    case "GET:/api/om/material/company-extensions":
      return await listMaterialCompanyExtensionsHandler(req, ctx);
    case "GET:/api/om/material/plant-extensions":
      return await listMaterialPlantExtensionsHandler(req, ctx);
    case "POST:/api/om/materials/bulk-save":
      return await bulkSaveMaterialsHandler(req, ctx);
    case "DELETE:/api/om/materials":
      return await deleteMaterialsHandler(req, ctx);
    case "POST:/api/om/materials/import":
      return await importMaterialsCsvHandler(req, ctx);
    case "GET:/api/om/material/company-mapping":
      return await listCompanyMappingHandler(req, ctx);
    case "POST:/api/om/material/company-map-bulk":
      return await bulkMapMaterialsHandler(req, ctx);
    case "DELETE:/api/om/material/company-unmap-bulk":
      return await bulkUnmapMaterialsHandler(req, ctx);
    case "POST:/api/om/material/company-mapping-import":
      return await importCompanyMappingHandler(req, ctx);
    case "POST:/api/om/material/category-group":
      return await createMaterialCategoryGroupHandler(req, ctx);
    case "PATCH:/api/om/material/category-group":
      return await updateMaterialCategoryGroupHandler(req, ctx);
    case "DELETE:/api/om/material/category-group":
      return await deleteMaterialCategoryGroupHandler(req, ctx);
    case "GET:/api/om/material/category-groups":
      return await listMaterialCategoryGroupsHandler(req, ctx);
    case "POST:/api/om/material/category-group/member":
      return await addMaterialCategoryMemberHandler(req, ctx);
    case "DELETE:/api/om/material/category-group/member":
      return await removeMaterialCategoryMemberHandler(req, ctx);

    case "POST:/api/om/vendor":
      return await createVendorHandler(req, ctx);
    case "GET:/api/om/vendors":
      return await listVendorsHandler(req, ctx);
    case "GET:/api/om/vendor":
      return await getVendorHandler(req, ctx);
    case "PATCH:/api/om/vendor":
      return await updateVendorHandler(req, ctx);
    case "POST:/api/om/vendor/status":
      return await changeVendorStatusHandler(req, ctx);
    case "POST:/api/om/vendor/company-map":
      return await mapVendorToCompanyHandler(req, ctx);
    case "POST:/api/om/vendor/payment-terms":
      return await addVendorPaymentTermsHandler(req, ctx);
    case "GET:/api/om/vendor/payment-terms":
      return await getVendorPaymentTermsHandler(req, ctx);
    case "GET:/api/om/vendor/company-maps":
      return await listVendorCompanyMapsHandler(req, ctx);

    case "POST:/api/om/vendor-material-info":
      return await createVendorMaterialInfoHandler(req, ctx);
    case "GET:/api/om/vendor-material-infos":
      return await listVendorMaterialInfosHandler(req, ctx);
    case "GET:/api/om/vendor-material-info":
      return await getVendorMaterialInfoHandler(req, ctx);
    case "PATCH:/api/om/vendor-material-info":
      return await updateVendorMaterialInfoHandler(req, ctx);
    case "POST:/api/om/vendor-material-info/status":
      return await changeVendorMaterialInfoStatusHandler(req, ctx);

    case "POST:/api/om/customer":
      return await createCustomerHandler(req, ctx);
    case "GET:/api/om/customers":
      return await listCustomersHandler(req, ctx);
    case "GET:/api/om/customer":
      return await getCustomerHandler(req, ctx);
    case "PATCH:/api/om/customer":
      return await updateCustomerHandler(req, ctx);
    case "POST:/api/om/customer/status":
      return await changeCustomerStatusHandler(req, ctx);
    case "POST:/api/om/customer/company-map":
      return await mapCustomerToCompanyHandler(req, ctx);

    case "GET:/api/om/uoms":
      return await listUomHandler(req, ctx);
    case "POST:/api/om/uom":
      return await createUomHandler(req, ctx);
    case "PATCH:/api/om/uom":
      return await updateUomHandler(req, ctx);
    case "POST:/api/om/uom/toggle":
      return await toggleUomHandler(req, ctx);

    case "POST:/api/om/storage-location":
      return await createStorageLocationHandler(req, ctx);
    case "GET:/api/om/storage-locations":
      return await listStorageLocationsHandler(req, ctx);
    case "PATCH:/api/om/storage-location":
      return await updateStorageLocationHandler(req, ctx);
    case "POST:/api/om/storage-location/toggle":
      return await toggleStorageLocationHandler(req, ctx);
    case "GET:/api/om/storage-location/plant-assignments":
      return await listPlantAssignmentsHandler(req, ctx);
    case "POST:/api/om/storage-location/plant-map":
      return await mapStorageLocationToPlantHandler(req, ctx);
    case "POST:/api/om/storage-location/plant-unmap":
      return await unmapStorageLocationFromPlantHandler(req, ctx);

    case "POST:/api/om/number-series":
      return await createNumberSeriesHandler(req, ctx);
    case "GET:/api/om/number-series":
      return await listNumberSeriesHandler(req, ctx);
    case "POST:/api/om/cost-center":
      return await createCostCenterHandler(req, ctx);
    case "PATCH:/api/om/cost-center":
      return await updateCostCenterHandler(req, ctx);
    case "GET:/api/om/cost-centers":
      return await listCostCentersHandler(req, ctx);
    case "POST:/api/om/cost-center/toggle":
      return await toggleCostCenterHandler(req, ctx);

    case "POST:/api/om/machine":
      return await createMachineHandler(req, ctx);
    case "GET:/api/om/machines":
      return await listMachinesHandler(req, ctx);
    case "PATCH:/api/om/machine":
      return await updateMachineHandler(req, ctx);
    case "POST:/api/om/machine/toggle":
      return await toggleMachineHandler(req, ctx);

    default:
      return null;
  }
}
