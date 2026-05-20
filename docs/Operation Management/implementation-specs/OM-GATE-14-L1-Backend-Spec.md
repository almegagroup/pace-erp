# OM-GATE-14 — L1 Master Data Backend Spec
# PACE-ERP Operation Management — Backend Handlers (erp_master domain)

**Gate:** 14
**Phase:** Operation Management — Layer 1 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-11 VERIFIED ✅ | Gate-12 VERIFIED ✅ — proceed
**Implementer:** Codex
**Verifier:** Claude
**Design Reference:** docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md

---

## 1. What This Gate Builds

Gate-14 is the backend handler layer for all **L1 master data** entities. These are the TypeScript Edge Function handlers, routes, and shared utilities for managing:

- Material master (create, list, get, update, status change, extend-company, extend-plant, UOM conversions)
- Vendor master (create, list, get, update, status change, company-map, payment terms)
- Vendor Material Info / Approved Source List (create, list, get, update, status change)
- Customer master (create, list, get, update, status change, company-map)
- UOM master (list, create — SA only)
- Storage location (create, list, plant-map — SA only)
- Number series master (create, list — SA only)

**What you must NOT do:**
- Do NOT create DB migrations (that is Gate-11 / Gate-12 — already done)
- Do NOT create procurement handlers (that is Gate-15 / L2)
- Do NOT create frontend files
- Do NOT use `db.from("table")` — always `serviceRoleClient.schema("erp_master").from("table")` or the appropriate schema

---

## 2. Files to Create

| File | Purpose |
|---|---|
| `supabase/functions/api/_core/om/shared.ts` | OmHandlerContext type, assertOmSaContext, assertOmAdminContext |
| `supabase/functions/api/_core/om/material.handlers.ts` | All material master handlers |
| `supabase/functions/api/_core/om/vendor.handlers.ts` | All vendor master + payment terms handlers |
| `supabase/functions/api/_core/om/vendor_material_info.handlers.ts` | Vendor Material Info / ASL handlers |
| `supabase/functions/api/_core/om/customer.handlers.ts` | All customer master handlers |
| `supabase/functions/api/_core/om/uom.handlers.ts` | UOM master handlers (SA only) |
| `supabase/functions/api/_core/om/location.handlers.ts` | Storage location handlers (SA only) |
| `supabase/functions/api/_core/om/number_series.handlers.ts` | Number series master handlers (SA only) |
| `supabase/functions/api/_routes/om.routes.ts` | Route dispatcher for all /api/om/* routes |

**Update this existing file:**
- `supabase/functions/api/_pipeline/protected_routes.dispatch.ts` — add `dispatchOmRoutes`

---

## 3. Shared Utilities — `_core/om/shared.ts`

This file defines the context type and guard functions. Follow the exact same pattern as `_core/hr/shared.ts`.

```typescript
import type { ContextResolution } from "../../_pipeline/context.ts";

export type OmHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

/**
 * Asserts that the caller is a System Administrator (SA).
 * Used for global config operations: UOM, storage location, number series.
 * Throws "OM_SA_REQUIRED" if not SA.
 */
export function assertOmSaContext(ctx: OmHandlerContext): void {
  if (ctx.roleCode !== "SA") {
    throw new Error("OM_SA_REQUIRED");
  }
}

/**
 * Asserts that the caller is SA or ADMIN.
 * Used for master data CRUD operations.
 * Throws "OM_ADMIN_REQUIRED" if neither.
 */
export function assertOmAdminContext(ctx: OmHandlerContext): void {
  if (ctx.roleCode !== "SA" && ctx.roleCode !== "ADMIN") {
    throw new Error("OM_ADMIN_REQUIRED");
  }
}
```

**Import pattern for all OM handlers:**
```typescript
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmAdminContext, assertOmSaContext } from "./shared.ts";
```

**DB access pattern:**
```typescript
// erp_master tables
serviceRoleClient.schema("erp_master").from("material_master")
serviceRoleClient.schema("erp_master").from("vendor_master")
serviceRoleClient.schema("erp_master").from("customer_master")
serviceRoleClient.schema("erp_master").from("uom_master")
serviceRoleClient.schema("erp_master").from("storage_location_master")
serviceRoleClient.schema("erp_master").from("number_series_master")
// etc.

// erp_inventory tables (for storage location plant map)
serviceRoleClient.schema("erp_inventory").from("storage_location_plant_map")
```

---

## 4. Handler Specifications

### 4.1 Material Master — `material.handlers.ts`

**Exported functions:**

#### `createMaterialHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ material_type, material_name, base_uom_code, description?, hsn_code?, is_batch_managed?, variable_conversion? }`
- Logic:
  1. Validate `material_type` is one of: `RM | PM | INT | FG | TRA | CONS`
  2. Validate `base_uom_code` exists in `erp_master.uom_master`
  3. Call `erp_master.generate_material_pace_code(material_type)` via RPC to get `material_code`
  4. Insert into `erp_master.material_master` with `status = 'DRAFT'`, `created_by = ctx.auth_user_id`
  5. Return the created row
- Errors: `OM_INVALID_MATERIAL_TYPE`, `OM_INVALID_BASE_UOM`, `OM_MATERIAL_CREATE_FAILED`

#### `listMaterialsHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?material_type=`, `?status=`, `?search=` (searches material_code, material_name), `?limit=50`, `?offset=0`
- Logic: Query `erp_master.material_master` with optional filters
- Return: `{ data: MaterialRow[], total: number }`

#### `getMaterialHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?id=`
- Logic: Fetch single row from `erp_master.material_master`
- Return: Full material row
- Error: `OM_MATERIAL_NOT_FOUND`

#### `updateMaterialHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, material_name?, description?, hsn_code?, is_batch_managed?, variable_conversion? }`
- Guard: Only allow update if `status IN ('DRAFT', 'PENDING_APPROVAL')`
- Logic: PATCH `erp_master.material_master` — `material_code`, `material_type`, `base_uom_code` are immutable after create
- Error: `OM_MATERIAL_NOT_FOUND`, `OM_MATERIAL_LOCKED` (if status is ACTIVE/INACTIVE/DISCONTINUED)

#### `changeMaterialStatusHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, new_status }` where `new_status` is one of: `PENDING_APPROVAL | ACTIVE | INACTIVE | DISCONTINUED`
- Logic:
  - Fetch current material row
  - Validate transition — allowed transitions:
    - `DRAFT → PENDING_APPROVAL`
    - `PENDING_APPROVAL → ACTIVE` (SA or ADMIN only)
    - `PENDING_APPROVAL → DRAFT` (revert)
    - `ACTIVE → INACTIVE`
    - `ACTIVE → DISCONTINUED`
    - `INACTIVE → ACTIVE`
  - If `new_status = 'ACTIVE'`: set `approved_by = ctx.auth_user_id`, `approved_at = now()`
  - Update status
- Error: `OM_MATERIAL_NOT_FOUND`, `OM_INVALID_STATUS_TRANSITION`

#### `extendMaterialToCompanyHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ material_id, company_id, valuation_class?, costing_method? }`
- Logic: Upsert `erp_master.material_company_ext` — ON CONFLICT (material_id, company_id) DO UPDATE
- Error: `OM_MATERIAL_NOT_FOUND`, `OM_COMPANY_NOT_FOUND`, `OM_MATERIAL_EXTEND_FAILED`

#### `extendMaterialToPlantHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ material_id, company_id, plant_id, procurement_type?, reorder_point?, safety_stock?, default_storage_location_id? }`
- Logic: Upsert `erp_master.material_plant_ext`
- Note: `default_storage_location_id` is stored as-is — no FK enforcement
- Error: `OM_MATERIAL_NOT_FOUND`, `OM_PLANT_NOT_FOUND`, `OM_MATERIAL_EXTEND_FAILED`

#### `createMaterialUomConversionHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ material_id, from_uom_code, to_uom_code, numerator, denominator }`
- Logic:
  - Validate both UOM codes exist in `erp_master.uom_master`
  - Insert into `erp_master.material_uom_conversion`
  - UNIQUE (material_id, from_uom_code, to_uom_code) — return 409 if exists
- Error: `OM_MATERIAL_NOT_FOUND`, `OM_INVALID_UOM`, `OM_UOM_CONVERSION_EXISTS`

#### `listMaterialUomConversionsHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?material_id=`
- Logic: List all UOM conversions for a material
- Return: `{ data: ConversionRow[] }`

#### `createMaterialCategoryGroupHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ group_name, group_code?, company_id? }`
- Logic: Insert into `erp_master.material_category_group`
- Error: `OM_CATEGORY_GROUP_EXISTS`

#### `listMaterialCategoryGroupsHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?company_id=`
- Logic: List from `erp_master.material_category_group`

#### `addMaterialCategoryMemberHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ group_id, material_id, is_primary? }`
- Logic:
  - If `is_primary = true`: update any existing primary member for this material to `is_primary = false` first
  - Insert into `erp_master.material_category_group_member`
- Error: `OM_GROUP_NOT_FOUND`, `OM_MATERIAL_NOT_FOUND`, `OM_MEMBER_EXISTS`

---

### 4.2 Vendor Master — `vendor.handlers.ts`

**Exported functions:**

#### `createVendorHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ vendor_name, vendor_type, registered_address, gst_number?, pan_number?, primary_contact_person?, phone?, primary_email?, cc_email_list?, currency_code? }`
- Logic:
  1. Validate `vendor_type` is one of: `DOMESTIC | IMPORT | SUBCONTRACT`
  2. Call `erp_master.generate_vendor_code()` via RPC to get `vendor_code`
  3. Insert into `erp_master.vendor_master` with `status = 'DRAFT'`, `created_by = ctx.auth_user_id`
  4. `cc_email_list` defaults to `[]` if not provided
- Error: `OM_INVALID_VENDOR_TYPE`, `OM_VENDOR_CREATE_FAILED`

#### `listVendorsHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?vendor_type=`, `?status=`, `?search=` (vendor_code, vendor_name), `?limit=50`, `?offset=0`
- Return: `{ data: VendorRow[], total: number }`

#### `getVendorHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?id=`
- Logic: Fetch single vendor with latest payment terms row joined
- Return: Vendor row + `latest_payment_terms: PaymentTermsRow | null`
- Error: `OM_VENDOR_NOT_FOUND`

#### `updateVendorHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, vendor_name?, registered_address?, gst_number?, pan_number?, primary_contact_person?, phone?, primary_email?, cc_email_list? }`
- Guard: Only allow if `status IN ('DRAFT', 'PENDING_APPROVAL')`
- Logic: PATCH `erp_master.vendor_master` — `vendor_code`, `vendor_type` are immutable
- Error: `OM_VENDOR_NOT_FOUND`, `OM_VENDOR_LOCKED`

#### `changeVendorStatusHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, new_status }`
- Allowed transitions:
  - `DRAFT → PENDING_APPROVAL`
  - `PENDING_APPROVAL → ACTIVE` (set `approved_by`, `approved_at`)
  - `PENDING_APPROVAL → DRAFT`
  - `ACTIVE → INACTIVE`
  - `ACTIVE → BLOCKED`
  - `INACTIVE → ACTIVE`
  - `BLOCKED → ACTIVE`
- Error: `OM_VENDOR_NOT_FOUND`, `OM_INVALID_STATUS_TRANSITION`

#### `mapVendorToCompanyHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ vendor_id, company_id, active? }`
- Logic: Upsert `erp_master.vendor_company_map`
- Error: `OM_VENDOR_NOT_FOUND`, `OM_COMPANY_NOT_FOUND`

#### `addVendorPaymentTermsHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ vendor_id, company_id, payment_days, payment_method, discount_days?, discount_percent?, notes? }`
- Logic:
  - Insert into `erp_master.vendor_payment_terms_log` with `effective_from = now()`, `set_by = ctx.auth_user_id`
  - This is append-only — never UPDATE existing rows
- Error: `OM_VENDOR_NOT_FOUND`, `OM_PAYMENT_TERMS_CREATE_FAILED`

#### `getVendorPaymentTermsHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?vendor_id=`, `?company_id=`
- Logic: Fetch from `erp_master.vendor_payment_terms_log` ORDER BY effective_from DESC LIMIT 10
- Return: `{ data: PaymentTermsRow[] }` (latest first — history log)

---

### 4.3 Vendor Material Info — `vendor_material_info.handlers.ts`

**This is the Approved Source List (ASL). One row per vendor-material pair.**

**Exported functions:**

#### `createVendorMaterialInfoHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ vendor_id, material_id, vendor_material_code?, vendor_material_description?, lead_time_days?, min_order_qty?, price_per_base_uom?, currency_code?, notes? }`
- Logic:
  - Validate vendor exists in `erp_master.vendor_master`
  - Validate material exists in `erp_master.material_master`
  - Insert into `erp_master.vendor_material_info` with `status = 'ACTIVE'`, `created_by = ctx.auth_user_id`
  - UNIQUE (vendor_id, material_id) — return 409 if exists
- Error: `OM_VENDOR_NOT_FOUND`, `OM_MATERIAL_NOT_FOUND`, `OM_VMI_EXISTS`, `OM_VMI_CREATE_FAILED`

#### `listVendorMaterialInfosHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?vendor_id=`, `?material_id=`, `?status=`, `?limit=50`, `?offset=0`
- Logic: Query `erp_master.vendor_material_info` with optional filters
- Return: `{ data: VmiRow[], total: number }`

#### `getVendorMaterialInfoHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?id=` OR `?vendor_id=&material_id=`
- Logic: Fetch single VMI row
- Error: `OM_VMI_NOT_FOUND`

#### `updateVendorMaterialInfoHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, vendor_material_code?, vendor_material_description?, lead_time_days?, min_order_qty?, price_per_base_uom?, currency_code?, notes? }`
- Logic: PATCH `erp_master.vendor_material_info` — `vendor_id`, `material_id` are immutable
- Error: `OM_VMI_NOT_FOUND`

#### `changeVendorMaterialInfoStatusHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, new_status }` — `ACTIVE | INACTIVE`
- Logic: Update status
- Error: `OM_VMI_NOT_FOUND`, `OM_INVALID_STATUS`

---

### 4.4 Customer Master — `customer.handlers.ts`

**Exported functions:**

#### `createCustomerHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ customer_name, customer_type, delivery_address, billing_address?, gst_number?, pan_number?, primary_contact_person?, phone?, primary_email?, currency_code? }`
- Logic:
  1. Validate `customer_type` is one of: `DOMESTIC | EXPORT`
  2. Call `erp_master.generate_customer_code()` via RPC to get `customer_code`
  3. Insert into `erp_master.customer_master` with `status = 'DRAFT'`, `created_by = ctx.auth_user_id`
- Error: `OM_INVALID_CUSTOMER_TYPE`, `OM_CUSTOMER_CREATE_FAILED`

#### `listCustomersHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?customer_type=`, `?status=`, `?search=` (customer_code, customer_name), `?limit=50`, `?offset=0`
- Return: `{ data: CustomerRow[], total: number }`

#### `getCustomerHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?id=`
- Error: `OM_CUSTOMER_NOT_FOUND`

#### `updateCustomerHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, customer_name?, delivery_address?, billing_address?, gst_number?, pan_number?, primary_contact_person?, phone?, primary_email? }`
- Guard: Only allow if `status IN ('DRAFT', 'PENDING_APPROVAL')`
- Logic: PATCH — `customer_code`, `customer_type` are immutable
- Error: `OM_CUSTOMER_NOT_FOUND`, `OM_CUSTOMER_LOCKED`

#### `changeCustomerStatusHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ id, new_status }`
- Allowed transitions:
  - `DRAFT → PENDING_APPROVAL`
  - `PENDING_APPROVAL → ACTIVE` (set `approved_by`, `approved_at`)
  - `PENDING_APPROVAL → DRAFT`
  - `ACTIVE → INACTIVE`
  - `ACTIVE → BLOCKED`
  - `INACTIVE → ACTIVE`
  - `BLOCKED → ACTIVE`
- Error: `OM_CUSTOMER_NOT_FOUND`, `OM_INVALID_STATUS_TRANSITION`

#### `mapCustomerToCompanyHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Body: `{ customer_id, company_id, active? }`
- Logic: Upsert `erp_master.customer_company_map`
- Error: `OM_CUSTOMER_NOT_FOUND`, `OM_COMPANY_NOT_FOUND`

---

### 4.5 UOM Master — `uom.handlers.ts`

**SA-only operations.** UOM is global config — not company-scoped.

#### `listUomHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)` ← ADMIN can also list (read-only is OK)
- Query params: `?is_active=`
- Logic: Query `erp_master.uom_master` ORDER BY uom_code ASC
- Return: `{ data: UomRow[] }`

#### `createUomHandler(req, ctx)`
- Guard: `assertOmSaContext(ctx)` ← SA only (global config)
- Body: `{ uom_code, uom_name, uom_type, decimal_places? }`
- Logic:
  - Validate `uom_code` is uppercase text, max 10 chars
  - Validate `uom_type` is one of: `MASS | VOLUME | LENGTH | AREA | COUNT | TIME | ENERGY | EACH`
  - Insert into `erp_master.uom_master` with `is_active = true`
  - UNIQUE (uom_code) — return 409 if exists
- Error: `OM_UOM_EXISTS`, `OM_UOM_CREATE_FAILED`

---

### 4.6 Storage Location — `location.handlers.ts`

**SA-only for create/map. ADMIN can list.**

#### `createStorageLocationHandler(req, ctx)`
- Guard: `assertOmSaContext(ctx)`
- Body: `{ location_code, location_name, location_type, company_id }`
- Logic:
  - Validate `location_type` is one of: `WAREHOUSE | SHOP_FLOOR | QUARANTINE | SCRAP | TRANSIT | EXTERNAL`
  - Insert into `erp_inventory.storage_location_master` with `is_active = true`, `created_by = ctx.auth_user_id`
  - UNIQUE (location_code, company_id)
- Error: `OM_LOCATION_EXISTS`, `OM_LOCATION_CREATE_FAILED`

#### `listStorageLocationsHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?company_id=`, `?plant_id=`, `?location_type=`, `?is_active=`
- Logic:
  - If `plant_id` provided: join with `erp_inventory.storage_location_plant_map` to filter by plant
  - Else: query `erp_inventory.storage_location_master` directly
- Return: `{ data: LocationRow[] }`

#### `mapStorageLocationToPlantHandler(req, ctx)`
- Guard: `assertOmSaContext(ctx)`
- Body: `{ storage_location_id, plant_id, company_id, is_active? }`
- Logic: Upsert `erp_inventory.storage_location_plant_map`
- Error: `OM_LOCATION_NOT_FOUND`, `OM_PLANT_NOT_FOUND`

---

### 4.7 Number Series Master — `number_series.handlers.ts`

**SA-only. Number series controls document number generation for all schemas.**

#### `createNumberSeriesHandler(req, ctx)`
- Guard: `assertOmSaContext(ctx)`
- Body: `{ series_code, document_type, company_id, plant_id?, prefix, suffix?, start_number, step?, padding, fiscal_year_reset? }`
- Logic:
  - Validate `series_code` is unique per `(document_type, company_id, plant_id)`
  - Insert into `erp_inventory.number_series_master`
  - Also insert into `erp_inventory.number_series_counter` with `current_number = start_number - step`
- Error: `OM_NUMBER_SERIES_EXISTS`, `OM_NUMBER_SERIES_CREATE_FAILED`

#### `listNumberSeriesHandler(req, ctx)`
- Guard: `assertOmAdminContext(ctx)`
- Query params: `?document_type=`, `?company_id=`
- Logic: Query `erp_inventory.number_series_master` with optional filters
- Return: `{ data: NumberSeriesRow[] }`

---

## 5. Route Table — `om.routes.ts`

Route prefix: `/api/om/`

```
Method  Route                                         Handler
------  ------------------------------------------    -----------------------------------------------
POST    /api/om/material                              createMaterialHandler
GET     /api/om/materials                             listMaterialsHandler
GET     /api/om/material                              getMaterialHandler          (?id=)
PATCH   /api/om/material                              updateMaterialHandler
POST    /api/om/material/status                       changeMaterialStatusHandler
POST    /api/om/material/extend-company               extendMaterialToCompanyHandler
POST    /api/om/material/extend-plant                 extendMaterialToPlantHandler
POST    /api/om/material/uom-conversion               createMaterialUomConversionHandler
GET     /api/om/material/uom-conversions              listMaterialUomConversionsHandler
POST    /api/om/material/category-group               createMaterialCategoryGroupHandler
GET     /api/om/material/category-groups              listMaterialCategoryGroupsHandler
POST    /api/om/material/category-group/member        addMaterialCategoryMemberHandler

POST    /api/om/vendor                                createVendorHandler
GET     /api/om/vendors                               listVendorsHandler
GET     /api/om/vendor                                getVendorHandler             (?id=)
PATCH   /api/om/vendor                                updateVendorHandler
POST    /api/om/vendor/status                         changeVendorStatusHandler
POST    /api/om/vendor/company-map                    mapVendorToCompanyHandler
POST    /api/om/vendor/payment-terms                  addVendorPaymentTermsHandler
GET     /api/om/vendor/payment-terms                  getVendorPaymentTermsHandler (?vendor_id=&company_id=)

POST    /api/om/vendor-material-info                  createVendorMaterialInfoHandler
GET     /api/om/vendor-material-infos                 listVendorMaterialInfosHandler
GET     /api/om/vendor-material-info                  getVendorMaterialInfoHandler
PATCH   /api/om/vendor-material-info                  updateVendorMaterialInfoHandler
POST    /api/om/vendor-material-info/status           changeVendorMaterialInfoStatusHandler

POST    /api/om/customer                              createCustomerHandler
GET     /api/om/customers                             listCustomersHandler
GET     /api/om/customer                              getCustomerHandler           (?id=)
PATCH   /api/om/customer                              updateCustomerHandler
POST    /api/om/customer/status                       changeCustomerStatusHandler
POST    /api/om/customer/company-map                  mapCustomerToCompanyHandler

GET     /api/om/uoms                                  listUomHandler
POST    /api/om/uom                                   createUomHandler

POST    /api/om/storage-location                      createStorageLocationHandler
GET     /api/om/storage-locations                     listStorageLocationsHandler
POST    /api/om/storage-location/plant-map            mapStorageLocationToPlantHandler

POST    /api/om/number-series                         createNumberSeriesHandler
GET     /api/om/number-series                         listNumberSeriesHandler
```

---

## 6. Route File Structure — `_routes/om.routes.ts`

Follow the exact pattern of `_routes/hr.routes.ts`:

```typescript
import type { SessionResolution } from "../_pipeline/session.ts";
import type { ContextResolution } from "../_pipeline/context.ts";
import { /* all handlers from material.handlers.ts */ } from "../_core/om/material.handlers.ts";
import { /* all handlers from vendor.handlers.ts */ } from "../_core/om/vendor.handlers.ts";
import { /* all handlers from vendor_material_info.handlers.ts */ } from "../_core/om/vendor_material_info.handlers.ts";
import { /* all handlers from customer.handlers.ts */ } from "../_core/om/customer.handlers.ts";
import { /* all handlers from uom.handlers.ts */ } from "../_core/om/uom.handlers.ts";
import { /* all handlers from location.handlers.ts */ } from "../_core/om/location.handlers.ts";
import { /* all handlers from number_series.handlers.ts */ } from "../_core/om/number_series.handlers.ts";

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
    // --- Material ---
    case "POST:/api/om/material":
      return await createMaterialHandler(req, ctx);
    // ... all other cases ...
    default:
      return null;
  }
}
```

---

## 7. Update `protected_routes.dispatch.ts`

Add after the `dispatchHrRoutes` block:

```typescript
import { dispatchOmRoutes } from "../_routes/om.routes.ts";
```

And in the function body, add after `if (hr) return hr;`:

```typescript
const om = await dispatchOmRoutes(
  routeKey,
  req,
  requestId,
  sessionResult,
  contextResult
);
if (om) return om;
```

---

## 8. PACE Code Generation — RPC Pattern

Material, Vendor, Customer codes are generated by SECURITY DEFINER SQL functions. Call them via RPC, not via application logic:

```typescript
// Material code
const { data: codeData, error: codeError } = await serviceRoleClient
  .rpc("generate_material_pace_code", { p_material_type: material_type });

// Vendor code
const { data: codeData, error: codeError } = await serviceRoleClient
  .rpc("generate_vendor_code");

// Customer code
const { data: codeData, error: codeError } = await serviceRoleClient
  .rpc("generate_customer_code");
```

Note: These RPC calls go to the default schema. Supabase Edge Functions call RPCs without a schema prefix when using the service role client directly.

---

## 9. Error Handling Pattern

Follow the existing project pattern. Use `okResponse` / `errorResponse` from `../response.ts`:

```typescript
// Success
return okResponse({ data: row }, req, requestId);

// Validation error
return errorResponse("OM_INVALID_MATERIAL_TYPE", "Invalid material type", requestId, "VALIDATION", 400, {}, req);

// Not found
return errorResponse("OM_MATERIAL_NOT_FOUND", "Material not found", requestId, "NOT_FOUND", 404, {}, req);

// Conflict (duplicate)
return errorResponse("OM_MATERIAL_EXISTS", "Material already exists", requestId, "CONFLICT", 409, {}, req);

// Auth failure
return errorResponse("OM_ADMIN_REQUIRED", "Admin access required", requestId, "FORBIDDEN", 403, {}, req);
```

Wrap handler body in try/catch. Catch and re-throw known error codes as `errorResponse`. Catch unknown errors as 500.

---

## 10. Critical Rules

### Rule 1: Schema access — always explicit
```typescript
// CORRECT
serviceRoleClient.schema("erp_master").from("material_master")
serviceRoleClient.schema("erp_inventory").from("storage_location_master")

// WRONG — never do this
serviceRoleClient.from("material_master")
```

### Rule 2: PACE codes are generated by the DB, not the handler
Never construct `material_code`, `vendor_code`, or `customer_code` in TypeScript. Always call the RPC function.

### Rule 3: vendor_payment_terms_log is append-only
Never UPDATE existing payment terms rows. Always INSERT a new row. The latest row (by `effective_from DESC`) is the current terms.

### Rule 4: vendor_material_info UNIQUE constraint
(vendor_id, material_id) is UNIQUE. If a POST tries to create a duplicate, return `OM_VMI_EXISTS` (409), not a 500.

### Rule 5: material_company_ext and material_plant_ext use UPSERT
Use `.upsert()` on these tables — they are extension tables that may already exist.

### Rule 6: No cross-schema FK in application logic
The application should validate `company_id`, `plant_id`, `vendor_id`, `material_id` exist by querying their source tables directly. Do not rely on DB FK errors (there are none for cross-schema refs).

### Rule 7: vendor_company_map and customer_company_map UPSERT
These mapping tables can be upserted. ON CONFLICT (vendor_id/customer_id, company_id) — update `active` field.

### Rule 8: Status transitions must be validated in the handler
The DB has no CHECK constraint on status transitions — only on valid status values. The handler is responsible for rejecting invalid transitions (e.g., ACTIVE → DRAFT is not allowed).

### Rule 9: `cc_email_list` on vendor_master
This is `text[]`. If the caller sends a JSON array, parse it as string[]. Default: `[]`.

### Rule 10: ordered_qty / quantity fields
All quantity fields in erp_master use `numeric(20, 6)`. Do not lose precision — pass as strings in JSON if needed, let Supabase handle conversion.

---

## 11. Self-Check

```
[ ] _core/om/shared.ts — OmHandlerContext, assertOmSaContext, assertOmAdminContext
[ ] _core/om/material.handlers.ts — 12 handlers exported
[ ] _core/om/vendor.handlers.ts — 8 handlers exported
[ ] _core/om/vendor_material_info.handlers.ts — 5 handlers exported
[ ] _core/om/customer.handlers.ts — 6 handlers exported
[ ] _core/om/uom.handlers.ts — 2 handlers exported
[ ] _core/om/location.handlers.ts — 3 handlers exported
[ ] _core/om/number_series.handlers.ts — 2 handlers exported
[ ] _routes/om.routes.ts — dispatchOmRoutes, 38 route cases, returns null for default
[ ] protected_routes.dispatch.ts — import dispatchOmRoutes, call after dispatchHrRoutes
[ ] All material handlers use schema("erp_master")
[ ] Storage location handlers use schema("erp_inventory")
[ ] PACE codes generated via .rpc() not constructed in TS
[ ] vendor_payment_terms_log: INSERT only, never UPDATE
[ ] vendor_material_info: 409 on duplicate (vendor_id, material_id)
[ ] material_company_ext + material_plant_ext: use .upsert()
[ ] Status transitions validated in handler, not relying on DB
[ ] createUomHandler: assertOmSaContext (SA only)
[ ] createStorageLocationHandler: assertOmSaContext (SA only)
[ ] mapStorageLocationToPlantHandler: assertOmSaContext (SA only)
[ ] createNumberSeriesHandler: assertOmSaContext (SA only)
[ ] listUomHandler, listStorageLocationsHandler, listNumberSeriesHandler: assertOmAdminContext
[ ] Error codes follow OM_ prefix pattern
[ ] No .ts files in supabase/migrations/
[ ] No SQL migration files created
```

---

## 12. Implementation Log Update

After each file is created, update `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`:

```
| 14.X | item name | DONE | supabase/functions/api/... | - | - |
```

After all files:
```
Gate-14 implementation complete. All 10 handler files created. Awaiting Claude verification.
```

---

*Gate: 14 | Phase: L1 Backend | Domain: MASTER DATA*
*Gate-11 VERIFIED ✅ | Gate-12 VERIFIED ✅ — proceed*
*Do not start Gate-15 (L1 Frontend) until Claude marks Gate-14 VERIFIED.*
*Gate-13 (Procurement DB) can be implemented in parallel or after Gate-14 — it has no backend dependency.*
