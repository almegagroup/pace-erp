-- Transporter Master redesign — same pattern as Vendor: GST and non-GST
-- transporters (gst_number nullable, already was), multi-row contacts and
-- emails instead of flat columns, and Company Mapping.
--
-- Also fixes a pre-existing RLS gap discovered while building this:
-- vendor_contacts/vendor_emails never had RLS enabled (vendor_company_map
-- did). service_role bypasses RLS regardless, so backend access is
-- unaffected; this only closes the anon/authenticated default-deny gap.

ALTER TABLE erp_master.vendor_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.vendor_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY backend_only ON erp_master.vendor_contacts FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.vendor_emails FOR ALL USING (false);

-- Drop the flat single-value columns (no prod data — dev only) in favor of
-- the multi-row tables below, mirroring the vendor_master redesign.
ALTER TABLE erp_master.transporter_master
  DROP COLUMN IF EXISTS contact_person,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email;

CREATE TABLE erp_master.transporter_contacts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_id uuid      NOT NULL REFERENCES erp_master.transporter_master(id) ON DELETE CASCADE,
  contact_name text        NOT NULL,
  phone        text,
  designation  text,
  is_primary   boolean     NOT NULL DEFAULT false,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transporter_contacts_transporter_id
  ON erp_master.transporter_contacts (transporter_id);

CREATE TABLE erp_master.transporter_emails (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_id uuid        NOT NULL REFERENCES erp_master.transporter_master(id) ON DELETE CASCADE,
  email          text        NOT NULL,
  label          text,
  is_primary     boolean     NOT NULL DEFAULT false,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transporter_emails_transporter_id
  ON erp_master.transporter_emails (transporter_id);

CREATE TABLE erp_master.transporter_company_map (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_id uuid        NOT NULL REFERENCES erp_master.transporter_master(id) ON DELETE CASCADE,
  company_id     uuid        NOT NULL REFERENCES erp_master.companies(id),
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (transporter_id, company_id)
);

ALTER TABLE erp_master.transporter_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.transporter_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.transporter_company_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY backend_only ON erp_master.transporter_contacts FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.transporter_emails FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.transporter_company_map FOR ALL USING (false);
