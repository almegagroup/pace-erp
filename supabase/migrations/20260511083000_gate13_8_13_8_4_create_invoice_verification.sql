/*
 * File-ID: 13.8.4
 * File-Path: supabase/migrations/20260511083000_gate13_8_13_8_4_create_invoice_verification.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Invoice Verification header + lines - 3-way match, GST verification, 50% tolerance hard block.
 * Authority: Backend
 */

BEGIN;

-- Invoice Verification Header
CREATE TABLE IF NOT EXISTS erp_procurement.invoice_verification (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (IV series)
  iv_number               text NOT NULL UNIQUE,

  iv_date                 date NOT NULL,
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id              uuid NOT NULL,
  vendor_id               uuid NOT NULL,

  -- PO reference - intra-schema FK (auto-loaded from GRN lines selected)
  po_id                   uuid NULL
    REFERENCES erp_procurement.purchase_order(id)
    ON DELETE RESTRICT,

  -- Vendor's own invoice details (mandatory)
  vendor_invoice_number   text NOT NULL,
  vendor_invoice_date     date NOT NULL,

  -- DRAFT -> MATCHED -> POSTED | BLOCKED (Section 100.5)
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'MATCHED', 'POSTED', 'BLOCKED')),

  -- Totals (auto-computed by handler from lines, stored for reporting)
  total_taxable_value     numeric(20, 4) NULL CHECK (total_taxable_value >= 0),
  total_gst_amount        numeric(20, 4) NULL CHECK (total_gst_amount >= 0),
  total_invoice_value     numeric(20, 4) NULL CHECK (total_invoice_value >= 0),

  posted_by               uuid NULL,
  posted_at               timestamptz NULL,

  remarks                 text NULL,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL,
  last_updated_by         uuid NULL
);

COMMENT ON TABLE erp_procurement.invoice_verification IS
'IV - SAP MIRO equivalent. One IV can reference multiple GRN lines from same vendor. 3-way match: PO Rate vs Invoice Rate. Hard block if |Invoice Rate − PO Rate| / PO Rate > 50%. Partial invoicing allowed - each partial IV is a separate document.';

COMMENT ON COLUMN erp_procurement.invoice_verification.status IS
'DRAFT: building. MATCHED: all lines ≤50% variance. BLOCKED: at least one line >50% variance (cannot post). POSTED: liability recorded.';

-- Invoice Verification Lines
CREATE TABLE IF NOT EXISTS erp_procurement.invoice_verification_line (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  iv_id                   uuid NOT NULL
    REFERENCES erp_procurement.invoice_verification(id)
    ON DELETE RESTRICT,

  line_number             int NOT NULL,

  -- GRN reference (intra-schema FK)
  grn_id                  uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt(id)
    ON DELETE RESTRICT,

  grn_line_id             uuid NOT NULL
    REFERENCES erp_procurement.goods_receipt_line(id)
    ON DELETE RESTRICT,

  -- Cross-schema - plain uuid, NO FK
  material_id             uuid NOT NULL,

  -- Quantities
  grn_qty                 numeric(20, 6) NOT NULL,
  invoice_qty             numeric(20, 6) NOT NULL CHECK (invoice_qty > 0),
  uom_code                text NOT NULL,

  -- 3-Way Match (Section 100.2)
  po_rate                 numeric(20, 4) NOT NULL,
  invoice_rate            numeric(20, 4) NOT NULL CHECK (invoice_rate > 0),

  -- |invoice_rate − po_rate| / po_rate × 100. Auto-computed by handler, stored for reporting.
  rate_variance_pct       numeric(10, 4) NULL CHECK (rate_variance_pct >= 0),

  -- MATCHED: variance ≤ 50%. BLOCKED: variance > 50%. PENDING: not yet evaluated.
  match_status            text NOT NULL DEFAULT 'PENDING'
    CHECK (match_status IN ('MATCHED', 'BLOCKED', 'PENDING')),

  -- Taxable value = invoice_rate × invoice_qty
  taxable_value           numeric(20, 4) NULL CHECK (taxable_value >= 0),

  -- GST Fields (Section 100.3 - Domestic)
  -- gst_type derived from vendor state vs company state (intra-state vs inter-state)
  -- NONE for import vendor invoices (no GST on import - BOE/customs handled in Landed Cost)
  gst_type                text NOT NULL DEFAULT 'NONE'
    CHECK (gst_type IN ('CGST_SGST', 'IGST', 'NONE')),

  gst_rate                numeric(6, 2) NULL CHECK (gst_rate >= 0),

  -- Calculated GST amounts (auto from taxable_value × gst_rate; stored for reporting)
  cgst_amount             numeric(20, 4) NULL CHECK (cgst_amount >= 0),
  sgst_amount             numeric(20, 4) NULL CHECK (sgst_amount >= 0),
  igst_amount             numeric(20, 4) NULL CHECK (igst_amount >= 0),

  -- GST amount as stated on vendor's physical invoice (user enters)
  invoice_gst_amount      numeric(20, 4) NULL CHECK (invoice_gst_amount >= 0),

  -- GST match: true when calculated = invoice_gst_amount (tolerance by handler)
  gst_match_flag          boolean NOT NULL DEFAULT false,

  created_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (iv_id, line_number)
);

COMMENT ON TABLE erp_procurement.invoice_verification_line IS
'IV line. One per GRN line selected. Hard block when rate_variance_pct > 50 - IV cannot be posted until resolved (PO amendment or corrected invoice entry). Partial invoicing: invoice_qty can be less than grn_qty - remainder stays open for next IV.';

COMMENT ON COLUMN erp_procurement.invoice_verification_line.gst_type IS
'CGST_SGST: intra-state domestic. IGST: inter-state domestic. NONE: import vendor invoice (no GST on import - customs/duties go to Landed Cost module).';

COMMIT;
