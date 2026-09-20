/*
 * Communication Automation — Phase 1 security completion.
 *
 * The backend service role is the sole table access path.  Explicit policies
 * keep the advisor and the database aligned: browser roles receive no direct
 * access even if this schema is later exposed accidentally.
 */

BEGIN;

CREATE POLICY backend_only
  ON erp_communication.page_enrollment
  AS RESTRICTIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY backend_only
  ON erp_communication.surface_enrollment
  AS RESTRICTIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
