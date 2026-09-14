/*
 * Communication Automation — Phase 1 Foundation.
 *
 * erp_menu.menu_master remains PACE's page catalog.  This migration stores
 * only the explicit communication enrollment and selected surface keys.
 */

BEGIN;

CREATE SCHEMA IF NOT EXISTS erp_communication;

GRANT USAGE ON SCHEMA erp_communication TO service_role;

CREATE TABLE erp_communication.page_enrollment (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_menu_id           uuid NOT NULL REFERENCES erp_menu.menu_master(id) ON DELETE RESTRICT,
  menu_code_snapshot     text NOT NULL,
  resource_code_snapshot text NOT NULL,
  email_enabled          boolean NOT NULL DEFAULT false,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  last_updated_at        timestamptz NOT NULL DEFAULT now(),
  last_updated_by        uuid NOT NULL,
  CONSTRAINT uq_communication_page_enrollment_page UNIQUE (page_menu_id)
);

COMMENT ON TABLE erp_communication.page_enrollment IS
  'Communication-specific enrollment for an existing PACE menu page; it is not a duplicate page catalog.';
COMMENT ON COLUMN erp_communication.page_enrollment.page_menu_id IS
  'Stable FK to the canonical erp_menu.menu_master page identity.';
COMMENT ON COLUMN erp_communication.page_enrollment.menu_code_snapshot IS
  'Audit/debug snapshot only; the canonical value remains erp_menu.menu_master.menu_code.';
COMMENT ON COLUMN erp_communication.page_enrollment.resource_code_snapshot IS
  'Audit/debug snapshot only; the canonical value remains erp_menu.menu_master.resource_code.';

CREATE TABLE erp_communication.surface_enrollment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_enrollment_id uuid NOT NULL REFERENCES erp_communication.page_enrollment(id) ON DELETE CASCADE,
  surface_key        text NOT NULL CHECK (btrim(surface_key) <> ''),
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  last_updated_at    timestamptz NOT NULL DEFAULT now(),
  last_updated_by    uuid NOT NULL,
  CONSTRAINT uq_communication_surface_enrollment UNIQUE (page_enrollment_id, surface_key)
);

COMMENT ON TABLE erp_communication.surface_enrollment IS
  'Selected communication surfaces. Keys are validated by the server-owned communication surface manifest.';

CREATE INDEX ix_communication_page_enrollment_active
  ON erp_communication.page_enrollment (active, page_menu_id);
CREATE INDEX ix_communication_surface_enrollment_active
  ON erp_communication.surface_enrollment (page_enrollment_id, active);

ALTER TABLE erp_communication.page_enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_communication.surface_enrollment ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_communication.page_enrollment TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_communication.surface_enrollment TO service_role;

COMMIT;
