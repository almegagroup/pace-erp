# CODEX TASK BRIEF — Gate-16.4 Gate Entry + GRN Backend

**Gate:** 16.4
**Spec File:** OM-GATE-16.4-GateEntryGRNBackend-Spec.md
**Dependency:** Gate-16.3 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.4-GateEntryGRNBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/gate_entry.handlers.ts`
2. CREATE `supabase/functions/api/_core/procurement/grn.handlers.ts`
3. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add GE + GRN routes

## What to Build

**gate_entry.handlers.ts:** `createGateEntryHandler`, `listGateEntriesHandler`, `getGateEntryHandler`, `updateGateEntryHandler`, `listOpenCSNsForGEHandler`, `createGateExitInboundHandler`, `getGateExitInboundHandler`

**grn.handlers.ts:** `createGRNDraftHandler`, `listGRNsHandler`, `getGRNHandler`, `updateGRNDraftHandler`, `postGRNHandler`, `reverseGRNHandler`

## Critical Business Logic

**createGateEntryHandler:**
- ge_number via `generate_doc_number('GE')`
- gex_number (if doing gate exit inline) via `generate_doc_number('GEX')`
- On create: set linked CSN status → ARRIVED

**createGateExitInboundHandler:**
- One per GE (UNIQUE constraint). Block if gate_exit already exists for this gate_entry_id.
- net_weight_calculated = ge.gross_weight - tare_weight (auto-compute, store)

**postGRNHandler (most critical):**
1. For each GRN line: call `serviceRoleClient.rpc('post_stock_movement', {...})` with:
   - p_movement_type_code = 'P101' (or 'STO_RECEIPT' if sto_id on GRN)
   - p_direction = 'IN'
   - p_stock_type_code = 'QA_STOCK' if material has qa_required=true, else 'UNRESTRICTED'
   - p_unit_value = po_line.rate
2. Store returned stock_document_id + stock_ledger_id on grn_line
3. Set gate_entry_line.grn_posted = true
4. Update po_line.grn_received_qty += received_qty
5. Set CSN status → GRN_DONE, csn.grn_id = this grn id
6. Update vendor_material_info.last_purchase_price = po_line.rate
7. If material qa_required = true → INSERT inward_qa_document with qa_number = `generate_doc_number('QA')`

**reverseGRNHandler:** Calls post_stock_movement with P102 + direction=OUT + p_reversal_of_id. Voids QA doc if auto-created.

## After Implementation — Update Log
Set Gate-16.4 items to DONE.

---
*Brief frozen: 2026-05-12*
