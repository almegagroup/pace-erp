# OM-GATE-16.1 — L2 Masters Backend (TypeScript Handlers)
# PACE-ERP Operation Management — Procurement

**Gate:** 16.1
**Phase:** Operation Management — Layer 2 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.0 VERIFIED ✅ (Stock Posting Engine)
**Design Reference:** Section 87.4 (Payment Terms), Section 89.4–89.8 (Port/Transit/Lead Time), Section 94 (Transporter), Section 95 (CHA), Section 89.6 (Material Category)

---

## 1. What You Are Building

TypeScript handlers for all L2 procurement master data.
New handler directory: `supabase/functions/api/_core/procurement/`
New routes file: `supabase/functions/api/_routes/procurement.routes.ts`
Route prefix: `/api/procurement/`
Update: `protected_routes.dispatch.ts` — add procurement dispatcher

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `supabase/functions/api/_core/procurement/shared.ts` | CREATE — L2 context type + auth guards |
| `supabase/functions/api/_core/procurement/l2_masters.handlers.ts` | CREATE — all L2 master handlers |
| `supabase/functions/api/_routes/procurement.routes.ts` | CREATE — route dispatcher |
| `supabase/functions/api/_pipeline/protected_routes.dispatch.ts` | MODIFY — add dispatchProcurementRoutes |

---

## 3. `shared.ts`

```typescript
import type { ContextResolution } from "../../_pipeline/context.ts";

export type ProcurementHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

// PO approval, PO amendment approval — Procurement Head only
export function assertProcurementHeadRole(ctx: ProcurementHandlerContext): void {
  if (ctx.roleCode !== "PROC_HEAD" && ctx.roleCode !== "SA") {
    throw new Error("PROCUREMENT_HEAD_REQUIRED");
  }
}

// QA for-reprocess decision — QA Manager only
export function assertQAManagerRole(ctx: ProcurementHandlerContext): void {
  if (ctx.roleCode !== "QA_MGR" && ctx.roleCode !== "SA") {
    throw new Error("QA_MANAGER_REQUIRED");
  }
}

// SA-only master data management
export function assertSARole(ctx: ProcurementHandlerContext): void {
  if (ctx.roleCode !== "SA") {
    throw new Error("SA_REQUIRED");
  }
}
```

---

## 4. `l2_masters.handlers.ts` — Handler List

Schema: `erp_master` for all L2 master tables.

### Payment Terms Master (Section 87.4)
Table: `erp_master.payment_terms_master`

| Function | Route | Description |
|---|---|---|
| `listPaymentTermsHandler` | `GET:/api/procurement/payment-terms` | List all active payment terms. Filter: company_id, is_active |
| `createPaymentTermsHandler` | `POST:/api/procurement/payment-terms` | Create new term. SA or PROC_MGR only. Auto-generates code (PT-001 pattern) |
| `updatePaymentTermsHandler` | `PUT:/api/procurement/payment-terms/:id` | Update term. Cannot deactivate if referenced by open PO |
| `getPaymentTermsHandler` | `GET:/api/procurement/payment-terms/:id` | Get single term with all fields |

### Port Master (Section 89.4)
Table: `erp_master.port_master`

| Function | Route | Description |
|---|---|---|
| `listPortsHandler` | `GET:/api/procurement/ports` | List all active ports. Filter: country |
| `createPortHandler` | `POST:/api/procurement/ports` | SA only. Auto-generates port_code |
| `updatePortHandler` | `PUT:/api/procurement/ports/:id` | SA only |

### Port-Plant Transit Master (Section 89.5)
Table: `erp_master.port_plant_transit_master`

| Function | Route | Description |
|---|---|---|
| `listTransitTimesHandler` | `GET:/api/procurement/port-transit` | List. Filter: port_id, plant_id |
| `upsertTransitTimeHandler` | `POST:/api/procurement/port-transit` | SA only. Upsert on (port_id, plant_id) |

### Material Category Master (Section 89.6)
Table: `erp_master.material_category_master`

| Function | Route | Description |
|---|---|---|
| `listMaterialCategoriesHandler` | `GET:/api/procurement/material-categories` | List. Filter: company_id |
| `createMaterialCategoryHandler` | `POST:/api/procurement/material-categories` | SA only |

### Lead Time Master — Import (Section 89.7)
Table: `erp_master.lead_time_master_import`

| Function | Route | Description |
|---|---|---|
| `listImportLeadTimesHandler` | `GET:/api/procurement/lead-times/import` | List. Filter: port_id, material_category_id |
| `upsertImportLeadTimeHandler` | `POST:/api/procurement/lead-times/import` | SA only. Upsert on (port_id, material_category_id) |

### Lead Time Master — Domestic (Section 89.8)
Table: `erp_master.lead_time_master_domestic`

| Function | Route | Description |
|---|---|---|
| `listDomesticLeadTimesHandler` | `GET:/api/procurement/lead-times/domestic` | List. Filter: plant_id, material_category_id |
| `upsertDomesticLeadTimeHandler` | `POST:/api/procurement/lead-times/domestic` | SA only. Upsert on (plant_id, material_category_id) |

### Transporter Master (Section 94)
Table: `erp_master.transporter_master`

| Function | Route | Description |
|---|---|---|
| `listTransportersHandler` | `GET:/api/procurement/transporters` | List. Query param: direction=INBOUND|OUTBOUND|BOTH (filter for context dropdown) |
| `createTransporterHandler` | `POST:/api/procurement/transporters` | SA only. Auto-generates transporter_code |
| `updateTransporterHandler` | `PUT:/api/procurement/transporters/:id` | SA only |

### CHA Master (Section 95)
Table: `erp_master.cha_master` + `erp_master.cha_port_map`

| Function | Route | Description |
|---|---|---|
| `listCHAsHandler` | `GET:/api/procurement/chas` | List active CHAs |
| `createCHAHandler` | `POST:/api/procurement/chas` | SA only. Auto-generates cha_code |
| `mapCHAToPortHandler` | `POST:/api/procurement/chas/:id/ports` | SA only. Map CHA to port(s) |
| `listCHAPortsHandler` | `GET:/api/procurement/chas/:id/ports` | List ports for a CHA |

---

## 5. `procurement.routes.ts` Structure

```typescript
export async function dispatchProcurementRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  sessionResult: ...,
  contextResult: ...
): Promise<Response | null> {
  const ctx: ProcurementHandlerContext = {
    context: contextResult,
    request_id: requestId,
    auth_user_id: sessionResult.userId,
    roleCode: contextResult.roleCode,
  };

  switch (routeKey) {
    case "GET:/api/procurement/payment-terms":    return listPaymentTermsHandler(req, ctx);
    case "POST:/api/procurement/payment-terms":   return createPaymentTermsHandler(req, ctx);
    // ... all routes
    default: return null;
  }
}
```

---

## 6. `protected_routes.dispatch.ts` Modification

Add after the existing `om` block:
```typescript
import { dispatchProcurementRoutes } from "../_routes/procurement.routes.ts";

// Inside dispatchProtectedRoute function:
const procurement = await dispatchProcurementRoutes(routeKey, req, requestId, sessionResult, contextResult);
if (procurement) return procurement;
```

---

## 7. Critical Rules

| Rule | Detail |
|---|---|
| Schema | All L2 master tables are in `erp_master` schema — use `serviceRoleClient.schema("erp_master")` |
| Authority | SA-only for creates. Procurement authorized users for reads. assertSARole() in handlers |
| Auto-codes | Payment Terms: PT-001 format. Port: user provides code. Transporter: TR-001. CHA: CHA-001 |
| Transporter direction filter | `direction` query param filters: INBOUND shows INBOUND+BOTH, OUTBOUND shows OUTBOUND+BOTH |
| is_active flag | All masters have is_active. Inactive items excluded from dropdowns (list with filter `is_active=true`) |
| 409 on duplicate code | Return 409 if auto-generated or user-provided code already exists |

---

## 8. Verification — Claude Will Check

1. `shared.ts` has `ProcurementHandlerContext` type + 3 assert functions
2. All 20 handlers present in `l2_masters.handlers.ts`
3. Transporter list filters by direction correctly (INBOUND shows INBOUND+BOTH)
4. All creates use SA guard (`assertSARole`)
5. `procurement.routes.ts` has all route cases, returns null for unmatched
6. `protected_routes.dispatch.ts` imports + calls dispatchProcurementRoutes
7. Schema set to `erp_master` (not `erp_procurement`)
8. 409 returned on duplicate codes

---

*Spec frozen: 2026-05-12 | Reference: Sections 87.4, 89.4–89.8, 94, 95*
