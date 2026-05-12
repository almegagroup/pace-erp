/*
 * File-ID: 13.9.1
 * File-Path: supabase/migrations/20260511090000_gate13_9_13_9_1_create_sales_order.sql
 * Gate: 13.9
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: Sales Order header + lines - RM/PM outward sale to external customers.
 * Authority: Backend
 */

BEGIN;

-- Sales Order Header
CREATE TABLE IF NOT EXISTS erp_procurement.sales_order (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto: global pure numeric (SO series - Section 99.2)
  so_number             text NOT NULL UNIQUE,

  so_date               date NOT NULL,
  system_created_at     timestamptz NOT NULL DEFAULT now(),

  -- Cross-schema - plain uuid, NO FK
  company_id            uuid NOT NULL,
  customer_id           uuid NOT NULL,

  -- Customer's own purchase order reference (mandatory - Section 97.3)
  customer_po_number    text NOT NULL,
  customer_po_date      date NULL,

  -- Delivery address - defaults from Customer Master; overridable per SO
  delivery_address      text NULL,

  -- Payment Terms - dynamic last-used from Customer Master
  -- Plain uuid - cross-schema reference
  payment_term_id       uuid NULL,

  -- CREATED -> ISSUED -> INVOICED -> CLOSED | CANCELLED
  status                text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'ISSUED', 'INVOICED', 'CLOSED', 'CANCELLED')),

  cancellation_reason   text NULL,
  cancelled_at          timestamptz NULL,
  cancelled_by          uuid NULL,

  remarks               text NULL,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_updated_at       timestamptz NULL,
  last_updated_by       uuid NULL
);

COMMENT ON TABLE erp_procurement.sales_order IS
'SO for RM/PM outward sale. Scope: RM/PM only (FG dispatch = separate Logistics module). Created when customer sends their PO. Partial dispatch allowed. Delivery Challan auto-created on stock issue. Sales Invoice raised by Accounts after DC.';

COMMENT ON COLUMN erp_procurement.sales_order.status IS
'CREATED: SO entered. ISSUED: at least one line dispatched (partial ok). INVOICED: all dispatched qty invoiced. CLOSED: fully done or balance knocked off.';

-- Sales Order Lines
CREATE TABLE IF NOT EXISTS erp_procurement.sales_order_line (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intra-schema FK
  so_id                       uuid NOT NULL
    REFERENCES erp_procurement.sales_order(id)
    ON DELETE RESTRICT,

  line_number                 int NOT NULL,

  -- Cross-schema - plain uuid, NO FK
  material_id                 uuid NOT NULL,
  -- Issue storage location - cross-schema to erp_inventory
  issue_storage_location_id   uuid NULL,

  quantity                    numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_code                    text NOT NULL,

  -- Pricing (Section 97.3)
  rate                        numeric(20, 4) NOT NULL CHECK (rate > 0),
  discount_pct                numeric(6, 3) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  -- net_rate = rate × (1 − discount_pct/100) - computed by handler, stored
  net_rate                    numeric(20, 4) NOT NULL CHECK (net_rate > 0),

  -- GST (auto from Material Master; overridable per line)
  gst_rate                    numeric(6, 2) NULL CHECK (gst_rate >= 0),
  gst_amount                  numeric(20, 4) NULL CHECK (gst_amount >= 0),

  -- Total value = net_rate × quantity + gst_amount
  total_value                 numeric(20, 4) NULL CHECK (total_value >= 0),

  -- Dispatch tracking
  issued_qty                  numeric(20, 6) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  -- balance_qty = quantity − issued_qty
  balance_qty                 numeric(20, 6) NOT NULL,

  -- Per-line status
  line_status                 text NOT NULL DEFAULT 'OPEN'
    CHECK (line_status IN ('OPEN', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'KNOCKED_OFF', 'CANCELLED')),

  knock_off_reason            text NULL,
  knocked_off_by              uuid NULL,
  knocked_off_at              timestamptz NULL,

  -- erp_inventory cross-schema references (plain uuid - no FK)
  stock_document_id           uuid NULL,
  stock_ledger_id             uuid NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  last_updated_at             timestamptz NULL,

  UNIQUE (so_id, line_number)
);

COMMENT ON TABLE erp_procurement.sales_order_line IS
'SO line. material_id must be RM or PM type (handler enforces - no DB constraint on material type). Partial dispatch: issued_qty updated per dispatch. balance_qty = quantity − issued_qty. stock_document_id set after SALES_ISSUE movement posting.';

COMMENT ON COLUMN erp_procurement.sales_order_line.issue_storage_location_id IS
'Location from which stock will be issued. Defaults from Material Master at SO creation. Overridable by Stores at dispatch. Cross-schema to erp_inventory - plain uuid.';

COMMIT;
