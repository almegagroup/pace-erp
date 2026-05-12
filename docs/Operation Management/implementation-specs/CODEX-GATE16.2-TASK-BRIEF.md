# CODEX TASK BRIEF — Gate-16.2 Purchase Order Backend

**Gate:** 16.2
**Spec File:** OM-GATE-16.2-POBackend-Spec.md
**Dependency:** Gate-16.1 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.2-POBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/po.handlers.ts`
2. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add all PO routes

## What to Build

12 handlers in `po.handlers.ts`:
`createPOHandler`, `listPOsHandler`, `getPOHandler`, `updatePOHandler`, `deletePOHandler`, `confirmPOHandler`, `approvePOHandler`, `rejectPOHandler`, `amendPOHandler`, `approveAmendmentHandler`, `cancelPOHandler`, `knockOffPOLineHandler`, `knockOffPOHandler`

## Critical Business Logic

**confirmPOHandler** (most complex):
- PO status DRAFT → CONFIRMED (or PENDING_APPROVAL if approval configured)
- For each PO line: INSERT into `erp_procurement.consignment_note` with csn_number = `generate_doc_number('CSN')`, status='ORDERED', csn_type derived from delivery_type

**ASL Hard Block** (in createPOHandler):
- For each line: check `erp_procurement.vendor_material_info` where vendor_id + material_id exists AND asl_status = 'APPROVED'
- If not found → return 400 error

**amendPOHandler:**
- If changed fields include `rate` or `quantity` → set `requires_approval=true`, status → PENDING_AMENDMENT
- Otherwise → free amendment, log only

**cancelPOHandler:**
- Block if any line has `grn_received_qty > 0`
- On cancel: also UPDATE linked CSNs with status='ORDERED' → status='CANCELLED'

**approvePOHandler/rejectPOHandler:** require `assertProcurementHeadRole(ctx)`

## After Implementation — Update Log
Set Gate-16.2 items to DONE.

---
*Brief frozen: 2026-05-12*
