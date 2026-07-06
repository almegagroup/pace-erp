/*
 * File-ID: VENDOR-REDESIGN
 * File-Path: supabase/migrations/20260619000000_vendor_master_redesign.sql
 * Purpose: Vendor Master redesign — separate vendor_contacts + vendor_emails tables,
 *          add country_code, drop old flat contact/email columns, public wrapper for generate_vendor_code.
 */

BEGIN;

-- 1. Drop old flat contact/email columns (no prod data, dev only)
ALTER TABLE erp_master.vendor_master
  DROP COLUMN IF EXISTS primary_contact_person,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS primary_email,
  DROP COLUMN IF EXISTS cc_email_list;

-- 2. Add country_code for import vendors
ALTER TABLE erp_master.vendor_master
  ADD COLUMN IF NOT EXISTS country_code text;

-- 3. vendor_contacts table
CREATE TABLE IF NOT EXISTS erp_master.vendor_contacts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      uuid        NOT NULL REFERENCES erp_master.vendor_master(id) ON DELETE CASCADE,
  contact_name   text        NOT NULL,
  phone          text,
  designation    text,
  is_primary     boolean     NOT NULL DEFAULT false,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_contacts_vendor_id
  ON erp_master.vendor_contacts (vendor_id);

-- 4. vendor_emails table
CREATE TABLE IF NOT EXISTS erp_master.vendor_emails (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  uuid        NOT NULL REFERENCES erp_master.vendor_master(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  label      text,
  is_primary boolean     NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_emails_vendor_id
  ON erp_master.vendor_emails (vendor_id);

-- 5. Public wrapper for generate_vendor_code (erp_master schema not PostgREST-exposed)
CREATE OR REPLACE FUNCTION public.generate_vendor_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT erp_master.generate_vendor_code();
$$;

COMMIT;
