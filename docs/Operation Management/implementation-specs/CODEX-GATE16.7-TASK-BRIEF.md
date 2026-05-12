# CODEX TASK BRIEF — Gate-16.7 RTV + Debit Note + Exchange Backend

**Gate:** 16.7
**Spec File:** OM-GATE-16.7-RTVBackend-Spec.md
**Dependency:** Gate-16.5 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.7-RTVBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/rtv.handlers.ts`
2. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add RTV + DN + EXR routes

## What to Build

**rtv.handlers.ts:** `createRTVHandler`, `listRTVsHandler`, `getRTVHandler`, `addRTVLineHandler`, `postRTVHandler`, `createDebitNoteHandler`, `listDebitNotesHandler`, `getDebitNoteHandler`, `markDebitNoteSentHandler`, `acknowledgeDebitNoteHandler`, `settleDebitNoteHandler`, `createExchangeRefHandler`, `listExchangeRefsHandler`, `linkReplacementGRNHandler`

## Critical Business Logic

**addRTVLineHandler:**
Validate stock available in BLOCKED type for this material+location before adding line.

**postRTVHandler:**
1. For each RTV line: call `post_stock_movement()` (P122, OUT, BLOCKED)
2. Store stock_document_id on rtv_line
3. Auto-create `gate_exit_outbound` (exit_type='RTV', rtv_id) with gxo_number = `generate_doc_number('GXO')`
4. RTV status → DISPATCHED

**Direct from UNRESTRICTED path** (if rtv_line.stock_type_override = 'DIRECT'):
Two calls: (1) P344 OUT UNRESTRICTED + IN BLOCKED, then (2) P122 OUT BLOCKED

**createDebitNoteHandler:**
- Validate rtv.settlement_mode = 'DEBIT_NOTE' → else 400
- dn_number = `generate_doc_number('DN')`
- Calculate: material_value = sum(rtv_line.quantity × po_rate)
- Get landed cost for this GRN via getLandedCostForGRN. Proportional_lc = total_lc × (return_qty / grn_total_qty)
- Apply freight_term rules (FOR = 0 vendor freight contribution)
- Store breakdown: material_value, freight_value, etc.

**createExchangeRefHandler:**
- Validate rtv.settlement_mode = 'EXCHANGE' → else 400
- exchange_ref_number = `generate_doc_number('EXR')`

## After Implementation — Update Log
Set Gate-16.7 items to DONE.

---
*Brief frozen: 2026-05-12*
