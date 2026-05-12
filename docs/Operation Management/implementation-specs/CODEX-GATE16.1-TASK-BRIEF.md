# CODEX TASK BRIEF — Gate-16.1 L2 Masters Backend

**Gate:** 16.1
**Spec File:** OM-GATE-16.1-L2MastersBackend-Spec.md
**Dependency:** Gate-16.0 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.1-L2MastersBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/shared.ts`
2. CREATE `supabase/functions/api/_core/procurement/l2_masters.handlers.ts`
3. CREATE `supabase/functions/api/_routes/procurement.routes.ts`
4. MODIFY `supabase/functions/api/_pipeline/protected_routes.dispatch.ts`

## What to Build

**shared.ts:** `ProcurementHandlerContext` type + `assertProcurementHeadRole` + `assertQAManagerRole` + `assertSARole`

**l2_masters.handlers.ts:** 20 handlers covering:
- Payment Terms Master (4 handlers)
- Port Master (3)
- Port-Plant Transit (2)
- Material Category (2)
- Lead Time Import (2)
- Lead Time Domestic (2)
- Transporter Master (3 — direction filter on list)
- CHA Master (4 — includes port mapping)

All use `serviceRoleClient.schema("erp_master")`. All creates: `assertSARole(ctx)`.

**procurement.routes.ts:** Switch statement routing all `/api/procurement/*` routes. Returns `null` for unmatched.

**protected_routes.dispatch.ts:** Import + call `dispatchProcurementRoutes`. Insert AFTER the `om` block.

## Non-Negotiable Rules

1. All creates require `assertSARole(ctx)`
2. Transporter list: filter by `direction` query param — INBOUND shows INBOUND+BOTH, OUTBOUND shows OUTBOUND+BOTH
3. `procurement.routes.ts` MUST return `null` (not error) for unmatched routes
4. 409 on duplicate code conflicts

## After Implementation — Update Log

Set Gate-16.1 items to DONE, add filenames.

---
*Brief frozen: 2026-05-12*
