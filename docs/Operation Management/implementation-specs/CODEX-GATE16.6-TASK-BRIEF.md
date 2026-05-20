# CODEX TASK BRIEF — Gate-16.6 STO + DC Backend

**Gate:** 16.6
**Spec File:** OM-GATE-16.6-STODCBackend-Spec.md
**Dependency:** Gate-16.5 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.6-STODCBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/sto.handlers.ts`
2. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add STO routes

## What to Build

Handlers: `createSTOHandler`, `listSTOsHandler`, `getSTOHandler`, `updateSTOHandler`, `cancelSTOHandler`, `dispatchSTOHandler`, `updateGateExitOutboundWeightHandler`, `confirmSTOReceiptHandler`, `closeSTOHandler`, `transformSubCSNToSTOHandler`

## Critical Business Logic

**listSTOsHandler:**
Filter: `WHERE sending_company_id = :company_id OR receiving_company_id = :company_id`

**dispatchSTOHandler (most complex):**
1. For each STO line: check stock_snapshot qty >= line.quantity → else 400 INSUFFICIENT_STOCK
2. For each STO line: call `post_stock_movement()` (STO_ISSUE, OUT, UNRESTRICTED)
3. Store stock_document_id on STO line. Update issued_qty, balance_qty.
4. INSERT `delivery_challan` (dc_type='STO', sto_id) with dc_number = `generate_doc_number('DC')`
5. INSERT `delivery_challan_line` for each STO line
6. INSERT `gate_exit_outbound` (exit_type='STO', sto_id, dc_id) with gxo_number = `generate_doc_number('GXO')`
7. STO status → DISPATCHED

**transformSubCSNToSTOHandler:**
1. Create STO (sto_type=CONSIGNMENT_DISTRIBUTION)
2. UPDATE consignment_note: set sto_id = new STO id
3. CSN is NOT deleted — just linked

**confirmSTOReceiptHandler:**
Validates: a goods_receipt with sto_id = this STO and status='POSTED' exists → set STO status RECEIVED

## After Implementation — Update Log
Set Gate-16.6 items to DONE.

---
*Brief frozen: 2026-05-12*
