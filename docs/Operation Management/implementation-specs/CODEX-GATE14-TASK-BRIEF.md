# CODEX TASK BRIEF — Gate-14: L1 Master Data Backend

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 14
**Dependency status:** Gate-11 VERIFIED ✅ | Gate-12 VERIFIED ✅ — proceed
**Your task:** Create 9 TypeScript handler files + update 1 existing file. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-14-L1-Backend-Spec.md`
   → Complete spec. All handler signatures, logic, and route table are there.

2. `supabase/functions/api/_routes/hr.routes.ts`
   → This is the exact pattern your `om.routes.ts` must follow.

3. `supabase/functions/api/_core/hr/shared.ts`
   → This is the pattern for `_core/om/shared.ts`.

4. `supabase/functions/api/_pipeline/protected_routes.dispatch.ts`
   → You will add one block to this file.

5. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Update after each item. Gate-14 section is already added.

---

## Step 2 — What You Are Building

TypeScript backend handlers for all L1 master data entities. These go inside the existing Supabase Edge Function at `supabase/functions/api/`.

**Entities covered:**
- Material master (create, list, get, update, status, extend-company, extend-plant, UOM conversions, category groups)
- Vendor master (create, list, get, update, status, company-map, payment terms)
- Vendor Material Info / Approved Source List (create, list, get, update, status)
- Customer master (create, list, get, update, status, company-map)
- UOM master (list, create — SA only)
- Storage location (create, list, plant-map — SA only)
- Number series (create, list — SA only)

**Route prefix:** `/api/om/`

---

## Step 3 — Files to Create

| File | What it does |
|---|---|
| `supabase/functions/api/_core/om/shared.ts` | OmHandlerContext type + guard functions |
| `supabase/functions/api/_core/om/material.handlers.ts` | 12 material master handlers |
| `supabase/functions/api/_core/om/vendor.handlers.ts` | 8 vendor master + payment terms handlers |
| `supabase/functions/api/_core/om/vendor_material_info.handlers.ts` | 5 VMI / ASL handlers |
| `supabase/functions/api/_core/om/customer.handlers.ts` | 6 customer master handlers |
| `supabase/functions/api/_core/om/uom.handlers.ts` | 2 UOM handlers |
| `supabase/functions/api/_core/om/location.handlers.ts` | 3 storage location handlers |
| `supabase/functions/api/_core/om/number_series.handlers.ts` | 2 number series handlers |
| `supabase/functions/api/_routes/om.routes.ts` | Route dispatcher — 38 route cases |

**Update this existing file:**
- `supabase/functions/api/_pipeline/protected_routes.dispatch.ts`

---

## Step 4 — Critical Rules (Read All Before Writing)

### Rule 1: OmHandlerContext type — copy from HrHandlerContext
```typescript
export type OmHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};
```

### Rule 2: assertOmSaContext vs assertOmAdminContext
```typescript
// SA only (global config):
// - createUomHandler
// - createStorageLocationHandler
// - mapStorageLocationToPlantHandler
// - createNumberSeriesHandler
export function assertOmSaContext(ctx: OmHandlerContext): void {
  if (ctx.roleCode !== "SA") {
    throw new Error("OM_SA_REQUIRED");
  }
}

// SA or ADMIN (master data CRUD):
// - all material/vendor/customer handlers
// - listUomHandler, listStorageLocationsHandler, listNumberSeriesHandler
export function assertOmAdminContext(ctx: OmHandlerContext): void {
  if (ctx.roleCode !== "SA" && ctx.roleCode !== "ADMIN") {
    throw new Error("OM_ADMIN_REQUIRED");
  }
}
```

### Rule 3: Schema access — always explicit
```typescript
// erp_master tables
serviceRoleClient.schema("erp_master").from("material_master")
serviceRoleClient.schema("erp_master").from("vendor_master")
serviceRoleClient.schema("erp_master").from("customer_master")
serviceRoleClient.schema("erp_master").from("uom_master")
serviceRoleClient.schema("erp_master").from("vendor_material_info")
serviceRoleClient.schema("erp_master").from("vendor_payment_terms_log")
serviceRoleClient.schema("erp_master").from("vendor_company_map")
serviceRoleClient.schema("erp_master").from("customer_company_map")
serviceRoleClient.schema("erp_master").from("material_company_ext")
serviceRoleClient.schema("erp_master").from("material_plant_ext")
serviceRoleClient.schema("erp_master").from("material_uom_conversion")
serviceRoleClient.schema("erp_master").from("material_category_group")
serviceRoleClient.schema("erp_master").from("material_category_group_member")

// erp_inventory tables
serviceRoleClient.schema("erp_inventory").from("storage_location_master")
serviceRoleClient.schema("erp_inventory").from("storage_location_plant_map")
serviceRoleClient.schema("erp_inventory").from("number_series_master")
serviceRoleClient.schema("erp_inventory").from("number_series_counter")

// NEVER:
serviceRoleClient.from("material_master")  // wrong — always explicit schema
```

### Rule 4: PACE code generation via RPC only
```typescript
// Material — calls erp_master.generate_material_pace_code()
const { data: materialCode, error } = await serviceRoleClient
  .rpc("generate_material_pace_code", { p_material_type: material_type });

// Vendor — calls erp_master.generate_vendor_code()
const { data: vendorCode, error } = await serviceRoleClient
  .rpc("generate_vendor_code");

// Customer — calls erp_master.generate_customer_code()
const { data: customerCode, error } = await serviceRoleClient
  .rpc("generate_customer_code");
```
Never build the code string in TypeScript (e.g. `'RM-' + padStart(...)`) — always call the DB function.

### Rule 5: vendor_payment_terms_log is append-only
INSERT only. Never update existing rows. The latest row (ORDER BY effective_from DESC LIMIT 1) is the current payment terms.

### Rule 6: vendor_material_info — UNIQUE(vendor_id, material_id)
If insert fails with unique violation, return `OM_VMI_EXISTS` (409). Never allow duplicate vendor-material pairs.

### Rule 7: material_company_ext and material_plant_ext use UPSERT
```typescript
await serviceRoleClient
  .schema("erp_master")
  .from("material_company_ext")
  .upsert({ material_id, company_id, ... }, { onConflict: "material_id,company_id" });
```

### Rule 8: Status transitions — validated in handler, not DB
The DB only validates that the status value is in the allowed set. The handler must reject invalid transitions. For example:
- ACTIVE → DRAFT is forbidden
- DISCONTINUED → ACTIVE is forbidden
See the spec for the full allowed transition table for each entity.

### Rule 9: om.routes.ts — follow hr.routes.ts pattern exactly
- Construct ctx in the function body (not per-case)
- `const ctx = { context, request_id: requestId, auth_user_id: session.authUserId, roleCode: context.roleCode }`
- `default: return null;`

### Rule 10: protected_routes.dispatch.ts — minimal change
Add ONLY:
1. One import at the top: `import { dispatchOmRoutes } from "../_routes/om.routes.ts";`
2. One dispatch block after the `if (hr) return hr;` line:
```typescript
const om = await dispatchOmRoutes(routeKey, req, requestId, sessionResult, contextResult);
if (om) return om;
```
Do NOT change any other code in that file.

### Rule 11: No SQL migrations
This gate is TypeScript only. If you find yourself creating a `.sql` file, stop — that is Gate-11/12 (already done).

### Rule 12: No frontend files
No `.tsx`, no React, no UI code.

---

## Step 5 — Import Pattern for Handler Files

```typescript
// At top of each handler file:
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../response.ts";
import type { OmHandlerContext } from "./shared.ts";
import { assertOmAdminContext } from "./shared.ts";  // or assertOmSaContext where needed
```

---

## Step 6 — Error Response Pattern

```typescript
// Guard failure (403)
return errorResponse("OM_ADMIN_REQUIRED", "Admin access required", requestId, "FORBIDDEN", 403, {}, req);

// Validation (400)
return errorResponse("OM_INVALID_MATERIAL_TYPE", "Invalid material type", requestId, "VALIDATION", 400, {}, req);

// Not found (404)
return errorResponse("OM_MATERIAL_NOT_FOUND", "Material not found", requestId, "NOT_FOUND", 404, {}, req);

// Conflict / duplicate (409)
return errorResponse("OM_VMI_EXISTS", "Vendor-material pair already exists", requestId, "CONFLICT", 409, {}, req);

// Status transition invalid (422)
return errorResponse("OM_INVALID_STATUS_TRANSITION", "Status transition not allowed", requestId, "VALIDATION", 422, {}, req);

// Success
return okResponse({ data: row }, req, requestId);
return okResponse({ data: rows, total: count }, req, requestId);
```

All handler function bodies must be wrapped in try/catch. Catch `Error` objects, match `.message` against known error codes, return appropriate errorResponse. Unknown errors → 500.

---

## Step 7 — Self-Check Before Submitting

```
[ ] _core/om/shared.ts exists with OmHandlerContext, assertOmSaContext, assertOmAdminContext
[ ] _core/om/material.handlers.ts — 12 functions exported
[ ] _core/om/vendor.handlers.ts — 8 functions exported
[ ] _core/om/vendor_material_info.handlers.ts — 5 functions exported
[ ] _core/om/customer.handlers.ts — 6 functions exported
[ ] _core/om/uom.handlers.ts — 2 functions exported
[ ] _core/om/location.handlers.ts — 3 functions exported
[ ] _core/om/number_series.handlers.ts — 2 functions exported
[ ] _routes/om.routes.ts — dispatchOmRoutes exported, 38 cases, default returns null
[ ] protected_routes.dispatch.ts — import + dispatch block added, nothing else changed
[ ] All schema() calls use explicit schema name
[ ] PACE codes generated by .rpc(), not constructed in TS
[ ] vendor_payment_terms_log: INSERT only
[ ] vendor_material_info: 409 on UNIQUE violation
[ ] material_company_ext, material_plant_ext: .upsert() used
[ ] createUomHandler: assertOmSaContext
[ ] createStorageLocationHandler: assertOmSaContext
[ ] mapStorageLocationToPlantHandler: assertOmSaContext
[ ] createNumberSeriesHandler: assertOmSaContext
[ ] Status transitions validated in handler
[ ] No SQL migration files created
[ ] No frontend files created
```

---

## Step 8 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file created:
```
| 14.X | item name | DONE | supabase/functions/api/_core/om/filename.ts | - | - |
```

After all 10 items:
```
Gate-14 implementation complete. All 10 files created. Awaiting Claude verification.
```

---

## Step 9 — Hard Stop

After Gate-14, stop. Claude verifies. Then Gate-15 (L1 Frontend) brief will be issued.

Note: Gate-13 (erp_procurement DB migrations) can be done in parallel by a separate Codex session if needed — it has no dependency on Gate-14. But Gate-15 (frontend) depends on Gate-14 being VERIFIED.

---

*Task issued: 2026-05-09*
*Gate-11 VERIFIED ✅ | Gate-12 VERIFIED ✅*
*Do not start Gate-15 until Claude marks Gate-14 VERIFIED.*
