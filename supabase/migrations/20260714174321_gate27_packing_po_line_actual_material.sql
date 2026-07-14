/*
 * File-Path: supabase/migrations/20260714174321_gate27_packing_po_line_actual_material.sql
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: Packing PO PM lines need a formulation material (from Pack BOM,
 * material_id, unchanged) plus an optional actual/substitute material
 * override, matching process_order_line's existing pattern. Needed so PM
 * alternate resolution can work exactly like Process PO's RM/PM lines.
 */

ALTER TABLE erp_production.packing_order_line
  ADD COLUMN IF NOT EXISTS actual_material_id uuid NULL REFERENCES erp_master.material_master(id);

COMMENT ON COLUMN erp_production.packing_order_line.actual_material_id IS
  'Optional substitute material actually consumed, validated against the Pack BOM line''s material_group members. material_id always stays the Pack BOM formulation material.';
