/*
 * File-Path: supabase/migrations/20261006120000_po12_tab2_settlement_and_recode.sql
 * Domain: PROCUREMENT
 * Purpose: PO12 Tab 2 — closes two gaps flagged against the 2026-10-05 design lock:
 *   (1) "Settle via Sale" instead of physical return — a pure bookkeeping row, no stock
 *       movement, that decrements the same Outstanding Returnable Balance pool a
 *       physical return would (design's "shared ledger between Tab 1 and Tab 2" point —
 *       built as its own lightweight mechanism rather than forcing a literal join into
 *       Tab 1's GRN-keyed Settlement Invoice, which has no natural reference here).
 *   (2) Material recode — handled entirely in the balance QUERY (returnable_transfer.
 *       handlers.ts), by resolving erp_master.material_category_group_member membership
 *       instead of exact material_id match. No schema change needed for that half.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.returnable_transfer_settlement (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_company_id       uuid NOT NULL,
  to_company_id         uuid NOT NULL,
  material_id           uuid NOT NULL,
  quantity              numeric(20,6) NOT NULL CHECK (quantity > 0),
  settlement_reference  text NULL,
  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (from_company_id <> to_company_id)
);

COMMENT ON TABLE erp_procurement.returnable_transfer_settlement IS
  'PO12 Tab 2 — "settle via Sale instead of physical return" (design edge case #5, 2026-10-05). Pure bookkeeping: no stock_ledger/stock_document row, decrements the Outstanding Returnable Balance by the same amount a physical return would. from_company_id = the holder settling the obligation, to_company_id = the original owner being paid off.';

CREATE INDEX IF NOT EXISTS idx_returnable_settlement_pair
  ON erp_procurement.returnable_transfer_settlement (from_company_id, to_company_id, material_id);

GRANT SELECT, INSERT ON erp_procurement.returnable_transfer_settlement TO service_role;

COMMIT;
