/*
 * File-Path: supabase/migrations/20260811120000_po_freight_term_widen.sql
 * Purpose: Widen purchase_order.freight_term CHECK constraint.
 *
 * Two changes bundled together:
 * 1. FREIGHT_AT_ACTUALS was already offered by the frontend (POCreatePage.jsx
 *    and 4 other pages) and allowed by po.handlers.ts's own FREIGHT_TERMS
 *    validation set, but was never added to this constraint back when it was
 *    introduced -- selecting it on a real PO would 500 at insert time. Live
 *    bug, found 2026-08-11, fixed here alongside the new term below.
 * 2. EX_TRANSPORTER_GODOWN -- new freight term requested by business owner
 *    2026-08-11 (buyer collects from the transporter's own godown; freight
 *    from that point is billed separately, same commercial shape as
 *    FREIGHT_SEPARATE/FREIGHT_AT_ACTUALS).
 */

BEGIN;

ALTER TABLE erp_procurement.purchase_order
  DROP CONSTRAINT purchase_order_freight_term_check;

ALTER TABLE erp_procurement.purchase_order
  ADD CONSTRAINT purchase_order_freight_term_check
  CHECK (freight_term IN ('FOR', 'FREIGHT_SEPARATE', 'FREIGHT_AT_ACTUALS', 'EX_TRANSPORTER_GODOWN'));

COMMIT;
