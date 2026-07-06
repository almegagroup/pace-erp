/*
 * Migration: 20260705180512_cleanup_redundant_pid_movement_types
 * Purpose: Remove stock-type-specific PID movement types — align with SAP model.
 *
 * SAP uses a single pair (701/702) for all stock types in Physical Inventory.
 * Stock type is carried by the PI document context, not the movement type code.
 *
 * Removed:
 *   P703 / P714 — PI Surplus/Deficit Reversal — Quality Inspection
 *   P704 / P713 — PI Deficit/Surplus Reversal — Quality Inspection
 *   P705 / P716 — PI Surplus/Deficit Reversal — Blocked
 *   P706 / P715 — PI Deficit/Surplus Reversal — Blocked
 *
 * P701 / P702 / P711 / P712 (Unrestricted) are kept and now serve ALL stock types.
 */

BEGIN;

DELETE FROM erp_inventory.movement_type_master
  WHERE code IN ('P703','P704','P705','P706','P713','P714','P715','P716');

COMMIT;
