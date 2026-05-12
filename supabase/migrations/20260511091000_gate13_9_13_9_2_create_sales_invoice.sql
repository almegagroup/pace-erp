/*
 * File-ID: 13.9.2
 * File-Path: supabase/migrations/20260511091000_gate13_9_13_9_2_create_sales_invoice.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: GST Sales Invoice - created by Accounts after Delivery Challan. YYYYMM+incremental number.
 * Authority: Backend
 */

BEGIN;

-- Sales Invoice Header
-- Created by Accounts after DC. Cannot be created without a posted DC.
-- Number format: YYYYMM + incremental (Section 99.3) - uses generate_invoice_number()
CREATE TABLE IF NOT EXISTS erp_procurement.sales_invoice (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: YYYYMM + incremental global counter - Section 99.3
  invoice_number          text NOT NULL UNIQUE,

  invoice_date            date NOT NULL,
  system_created_at       timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id              uuid NOT NULL,
  customer_id             uuid NOT NULL,

  -- Intra-schema FKs
  dc_id                   uuid NOT NULL
    REFERENCES erp_procurement.delivery_challan(id)
    ON DELETE RESTRICT,

  so_id                   uuid NULL
    REFERENCES erp_procurement.sales_order(id)
    ON DELETE RESTRICT,

  -- Payment Terms - carried from SO
  -- Plain uuid - cross-schema
  payment_term_id         uuid NULL,

  -- GST type at invoice level (same for all lines - derived from seller + buyer state)
  gst_type                text NOT NULL
    CHECK (gst_type IN ('CGST_SGST', 'IGST')),

  -- Totals (auto-computed from lines)
  total_taxable_value     numeric(20, 4) NULL CHECK (total_taxable_value >= 0),
  total_cgst_amount       numeric(20, 4) NULL CHECK (total_cgst_amount >= 0),
  total_sgst_amount       numeric(20, 4) NULL CHECK (total_sgst_amount >= 0),
  total_igst_amount       numeric(20, 4) NULL CHECK (total_igst_amount >= 0),
  total_gst_amount        numeric(20, 4) NULL CHECK (total_gst_amount >= 0),
  total_invoice_value     numeric(20, 4) NULL CHECK (total_invoice_value >= 0),

  -- DRAFT -> POSTED
  status                  text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED')),

  posted_by               uuid NULL,
  posted_at               timestamptz NULL,

  remarks                 text NULL,
  created_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_at         timestamptz NULL
);

COMMENT ON TABLE erp_procurement.sales_invoice IS
'GST Sales Invoice for RM/PM outward. Created by Accounts after DC. Number: YYYYMM+incremental global (same counter as purchase invoices - Section 99.3). No GST portal integration in Phase-1. Format is GST-compliant for manual filing.';

COMMENT ON COLUMN erp_procurement.sales_invoice.invoice_number IS
'Format: YYYYMM + 6-digit incremental (e.g., 202607000001). Global counter shared across all invoice types. Never resets. Uses erp_procurement.generate_invoice_number().';

-- Sales Invoice Lines
CREATE TABLE IF NOT EXISTS erp_procurement.sales_invoice_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  invoice_id        uuid NOT NULL
    REFERENCES erp_procurement.sales_invoice(id)
    ON DELETE RESTRICT,

  line_number       int NOT NULL,

  -- SO line reference (intra-schema)
  so_line_id        uuid NULL
    REFERENCES erp_procurement.sales_order_line(id)
    ON DELETE RESTRICT,

  -- DC line reference (intra-schema)
  dc_line_id        uuid NULL
    REFERENCES erp_procurement.delivery_challan_line(id)
    ON DELETE RESTRICT,

  -- Cross-schema - plain uuid, NO FK
  material_id       uuid NOT NULL,

  quantity          numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_code          text NOT NULL,
  rate              numeric(20, 4) NOT NULL CHECK (rate > 0),
  taxable_value     numeric(20, 4) NOT NULL CHECK (taxable_value >= 0),

  -- GST per line (rate from Material Master / SO line)
  gst_rate          numeric(6, 2) NULL CHECK (gst_rate >= 0),

  -- CGST_SGST or IGST - matches invoice header gst_type
  cgst_amount       numeric(20, 4) NULL CHECK (cgst_amount >= 0),
  sgst_amount       numeric(20, 4) NULL CHECK (sgst_amount >= 0),
  igst_amount       numeric(20, 4) NULL CHECK (igst_amount >= 0),

  -- line_total = taxable_value + GST
  line_total        numeric(20, 4) NOT NULL CHECK (line_total >= 0),

  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (invoice_id, line_number)
);

COMMENT ON TABLE erp_procurement.sales_invoice_line IS
'Sales Invoice line. Loaded from DC lines. GST computed per line from Material Master GST rate. cgst_amount and sgst_amount populated for CGST_SGST; igst_amount populated for IGST. Others remain NULL.';

COMMIT;
