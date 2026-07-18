/*
 * File-Path: supabase/migrations/20260718120000_gate27_1049_opening_source_txn_type.sql
 * Gate: 27.104.9
 * Domain: PRODUCTION / COSTING
 * Purpose: Section 104.9 — Opening Stock Genealogy. The synthetic "Old" Process/Packing PO
 *          (PR22/PR23) write process_order_line_reco rows tagged source_txn_type='OPENING' so
 *          PR19 / Reco / Return work unchanged for pre-go-live MTO/HPS batches. Add 'OPENING'
 *          to the source_txn_type CHECK (was PRODUCTION / RETURN / PARTIAL_REVERSAL /
 *          COR6_CORRECTION per §106.6).
 * Authority: Backend / DB
 */

ALTER TABLE erp_production.process_order_line_reco
  DROP CONSTRAINT IF EXISTS process_order_line_reco_source_txn_type_check;

ALTER TABLE erp_production.process_order_line_reco
  ADD CONSTRAINT process_order_line_reco_source_txn_type_check
  CHECK (source_txn_type = ANY (ARRAY[
    'PRODUCTION'::text,
    'RETURN'::text,
    'PARTIAL_REVERSAL'::text,
    'COR6_CORRECTION'::text,
    'OPENING'::text
  ]));
