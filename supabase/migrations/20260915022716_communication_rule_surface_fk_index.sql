/* Phase 6: cover the enrolled-surface foreign key for parent-row changes. */

BEGIN;

CREATE INDEX IF NOT EXISTS ix_communication_rule_surface_enrollment
  ON erp_communication.automation_rule (surface_enrollment_id);

COMMIT;
