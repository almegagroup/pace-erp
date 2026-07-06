/*
 * Migration: 20260705181244_cleanup_redundant_opening_stock_movement_types
 * Purpose: Remove stock-type-specific opening stock movement types — align with SAP model.
 *
 * SAP uses a single 561/562 pair for opening stock across all stock types.
 * Stock type is carried by the document context, not the movement type code.
 *
 * Removed:
 *   P563 / P564 — Opening Stock QA / Reversal
 *   P565 / P566 — Opening Stock Blocked / Reversal
 *
 * P561 / P562 (Unrestricted) are kept and now serve ALL stock types.
 */

BEGIN;

DELETE FROM erp_inventory.movement_type_master
  WHERE code IN ('P563','P564','P565','P566');

COMMIT;
