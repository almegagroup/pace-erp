-- CHA Master redesign — same pattern as Transporter: GST-backed autofill,
-- multi-row contacts/emails, Company Mapping. Unlike Transporter, every CHA
-- is GST-registered (no "Without GST" path), so gst_number becomes NOT NULL.

ALTER TABLE erp_master.cha_master
  DROP COLUMN IF EXISTS contact_person,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email;

ALTER TABLE erp_master.cha_master
  ALTER COLUMN gst_number SET NOT NULL;

CREATE TABLE erp_master.cha_contacts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cha_id       uuid        NOT NULL REFERENCES erp_master.cha_master(id) ON DELETE CASCADE,
  contact_name text        NOT NULL,
  phone        text,
  designation  text,
  is_primary   boolean     NOT NULL DEFAULT false,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cha_contacts_cha_id ON erp_master.cha_contacts (cha_id);

CREATE TABLE erp_master.cha_emails (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cha_id     uuid        NOT NULL REFERENCES erp_master.cha_master(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  label      text,
  is_primary boolean     NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cha_emails_cha_id ON erp_master.cha_emails (cha_id);

CREATE TABLE erp_master.cha_company_map (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cha_id     uuid        NOT NULL REFERENCES erp_master.cha_master(id) ON DELETE CASCADE,
  company_id uuid        NOT NULL REFERENCES erp_master.companies(id),
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (cha_id, company_id)
);

ALTER TABLE erp_master.cha_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.cha_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_master.cha_company_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY backend_only ON erp_master.cha_contacts FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.cha_emails FOR ALL USING (false);
CREATE POLICY backend_only ON erp_master.cha_company_map FOR ALL USING (false);
