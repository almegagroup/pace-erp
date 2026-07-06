-- Customer Master is being reframed as "RM/PM Sales Customer" (it sells the
-- company's own RM/PM surplus — see assertSalesMaterial in
-- sales_order.handlers.ts; FG dispatch customers are a separate, not-yet-
-- designed concept under Gate-27).
--
-- Two new capabilities:
-- 1. Parent Customer — a small standalone master (own name/GST/address) that
--    groups several Customer rows under one business entity (e.g. several
--    buying units under "Asian Group"). Optional — a Customer can have no
--    parent.
-- 2. Vendor-linked Customer — when the same business is both a vendor and a
--    buyer of RM/PM, the Customer row can live-link to vendor_master via
--    vendor_id instead of duplicating name/GST/contact. Resolution happens
--    at read time (join), so editing the vendor record keeps the customer
--    view in sync automatically. customer_name becomes nullable to support
--    this — it's required only when the customer is NOT vendor-linked.

CREATE TABLE erp_master.parent_customer_code_sequence (
  id boolean PRIMARY KEY DEFAULT true,
  last_number int NOT NULL DEFAULT 0,
  CONSTRAINT parent_customer_code_sequence_singleton CHECK (id)
);

INSERT INTO erp_master.parent_customer_code_sequence (id, last_number) VALUES (true, 0);

CREATE OR REPLACE FUNCTION erp_master.generate_parent_customer_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next int;
BEGIN
  UPDATE erp_master.parent_customer_code_sequence
  SET last_number = last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PC-' || lpad(v_next::text, 5, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_parent_customer_code()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = erp_master, public
AS $$ SELECT erp_master.generate_parent_customer_code(); $$;

GRANT EXECUTE ON FUNCTION public.generate_parent_customer_code() TO service_role;

CREATE TABLE erp_master.parent_customer_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_customer_code text NOT NULL UNIQUE,
  parent_customer_name text NOT NULL,
  gst_number text,
  address text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  last_updated_at timestamptz,
  last_updated_by uuid
);

ALTER TABLE erp_master.customer_master
  ALTER COLUMN customer_name DROP NOT NULL,
  ADD COLUMN parent_customer_id uuid REFERENCES erp_master.parent_customer_master(id),
  ADD COLUMN vendor_id uuid REFERENCES erp_master.vendor_master(id),
  ADD CONSTRAINT customer_master_name_or_vendor_link CHECK (
    customer_name IS NOT NULL OR vendor_id IS NOT NULL
  );
