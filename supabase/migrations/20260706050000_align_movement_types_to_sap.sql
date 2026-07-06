/*
 * Migration: 20260706050000_align_movement_types_to_sap
 * Gate: 27
 * Purpose: Align PACE movement types exactly to SAP numbering and functionality.
 *          SAP movement type 101 = Goods Receipt for both PO (vendor GRN) and
 *          Production Order (FG/SFG receipt). PACE used P231 for production FG
 *          receipt — this is incorrect. Both use P101 in SAP; distinction is made
 *          via reference_document_type context in the handler, not the movement code.
 *
 *          Changes:
 *          - DELETE P231 (Production Receipt FG/SFG) — replaced by P101
 *          - DELETE P232 (P231 Reversal) — replaced by P102
 *          - UPDATE P101 name to reflect dual-use (vendor GRN + production GR)
 *          - UPDATE P102 name to reflect dual-use reversal
 */

-- Remove non-SAP production-specific GR codes
DELETE FROM erp_inventory.movement_type_master WHERE code IN ('P231', 'P232');

-- Update P101/P102 to reflect SAP 101 covers both vendor GRN and production order GR
UPDATE erp_inventory.movement_type_master
SET name = 'Goods Receipt (PO / Production Order)'
WHERE code = 'P101';

UPDATE erp_inventory.movement_type_master
SET name = 'Goods Receipt Reversal (P101 Reversal)'
WHERE code = 'P102';
