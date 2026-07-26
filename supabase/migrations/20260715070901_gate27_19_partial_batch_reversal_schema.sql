/*
 * File-Path: supabase/migrations/20260715070901_gate27_19_partial_batch_reversal_schema.sql
 * Gate: 27.19
 * Domain: PRODUCTION
 * Purpose: PR19 Partial Batch Reversal + PR20 Partial Reversal Report (§83.7,
 * LOCKED 2026-07-12). Header + line audit trail for a partial-qty CORS-style
 * reversal of an already-VERIFIED/FINAL batch, reusing existing movement
 * types (P101/P102/P261/P262) — no new movement type codes.
 */

CREATE TABLE IF NOT EXISTS erp_production.partial_batch_reversal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),
  document_number text NOT NULL UNIQUE,
  po_type text NOT NULL CHECK (po_type IN ('MTO','HPS')),
  prodshade_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  source_batch_number text NOT NULL,
  source_process_order_id uuid NOT NULL REFERENCES erp_production.process_order(id),
  selected_row_type text NOT NULL CHECK (selected_row_type IN ('SFG','SKU')),
  selected_material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  selected_storage_location_id uuid NOT NULL REFERENCES erp_inventory.storage_location_master(id),
  -- Only set for SKU rows — PR19 Page 2 breaks a batch's SKU availability
  -- down per Packing PO (a batch can feed multiple Packing POs), so a
  -- specific PO must be identified to know which Packing-PO-Final P261 to
  -- reverse in step 2 of the movement sequence.
  selected_packing_order_id uuid REFERENCES erp_production.packing_order(id),
  reverse_qty numeric(20,6) NOT NULL CHECK (reverse_qty > 0),
  actual_total_output numeric(20,6) NOT NULL,
  reversal_ratio numeric(20,10) NOT NULL,
  -- Traceability only (§83.7) — does not insert a new line into the
  -- receiving batch's own Material Table; that batch just consumes the
  -- now-normal Unrestricted RM/PM stock at its own Final as usual.
  salvage_batch_number text,
  salvage_process_order_id uuid REFERENCES erp_production.process_order(id),
  status text NOT NULL DEFAULT 'POSTED',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erp_production.partial_batch_reversal_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_id uuid NOT NULL REFERENCES erp_production.partial_batch_reversal(id) ON DELETE CASCADE,
  line_type text NOT NULL CHECK (line_type IN ('SFG','RM','INT','PM','SKU')),
  -- Effective material actually reversed (actual/substitute if one was used
  -- at original posting time); formulation_material_id kept for record when
  -- they differ, matching process_order_line/packing_order_line's own split.
  material_id uuid NOT NULL REFERENCES erp_master.material_master(id),
  formulation_material_id uuid REFERENCES erp_master.material_master(id),
  -- PM-line-only checkbox (§83.7): unchecked lines get no movement at all
  -- and stay recorded as consumed — logged here with included=false for
  -- audit visibility, not silently dropped.
  included boolean NOT NULL DEFAULT true,
  qty numeric(20,6) NOT NULL DEFAULT 0,
  uom_code text NOT NULL DEFAULT 'KG',
  movement_type_code text,
  direction text CHECK (direction IN ('IN','OUT')),
  storage_location_id uuid REFERENCES erp_inventory.storage_location_master(id),
  stock_ledger_id uuid,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partial_batch_reversal_line_reversal_id ON erp_production.partial_batch_reversal_line(reversal_id);
CREATE INDEX IF NOT EXISTS idx_partial_batch_reversal_company ON erp_production.partial_batch_reversal(company_id);
CREATE INDEX IF NOT EXISTS idx_partial_batch_reversal_source_po ON erp_production.partial_batch_reversal(source_process_order_id);
CREATE INDEX IF NOT EXISTS idx_partial_batch_reversal_packing_po ON erp_production.partial_batch_reversal(selected_packing_order_id);
CREATE INDEX IF NOT EXISTS idx_partial_batch_reversal_batch_number ON erp_production.partial_batch_reversal(source_batch_number);
