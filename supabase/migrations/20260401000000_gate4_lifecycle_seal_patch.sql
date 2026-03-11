/*
 * File-ID: G4-LIFECYCLE-SEAL-PATCH
 * File-Path: supabase/migrations/20260401000000_gate4_lifecycle_seal_patch.sql
 * Purpose: Seal lifecycle tables (erp_core.users, signup_requests)
 * Nature: Forward-only corrective patch
 * Authority: Backend
 *
 * NOTE:
 * Does NOT modify earlier migrations.
 * Safe for reset.
 */

BEGIN;

------------------------------------------------------------
-- 1️⃣ Drop legacy self-isolation policies (if present)
------------------------------------------------------------

DROP POLICY IF EXISTS users_self_isolation ON erp_core.users;
DROP POLICY IF EXISTS signup_requests_self_isolation ON erp_core.signup_requests;

------------------------------------------------------------
-- 2️⃣ Ensure RLS is enabled + forced
------------------------------------------------------------

ALTER TABLE erp_core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_core.users FORCE ROW LEVEL SECURITY;

ALTER TABLE erp_core.signup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_core.signup_requests FORCE ROW LEVEL SECURITY;

------------------------------------------------------------
-- 3️⃣ USERS — Lifecycle Split Policies
------------------------------------------------------------

-- SELECT → Self only (service_role bypasses automatically)
CREATE POLICY users_select_self
ON erp_core.users
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
);

-- UPDATE → deny to authenticated (only service_role can update)
CREATE POLICY users_update_block
ON erp_core.users
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

-- INSERT → deny to authenticated
CREATE POLICY users_insert_block
ON erp_core.users
FOR INSERT
TO authenticated
WITH CHECK (false);

-- DELETE → deny to authenticated
CREATE POLICY users_delete_block
ON erp_core.users
FOR DELETE
TO authenticated
USING (false);

------------------------------------------------------------
-- 4️⃣ SIGNUP REQUESTS — Lifecycle Split Policies
------------------------------------------------------------

-- SELECT → Self only
CREATE POLICY signup_select_self
ON erp_core.signup_requests
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
);

-- UPDATE → deny to authenticated
CREATE POLICY signup_update_block
ON erp_core.signup_requests
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

-- INSERT → deny to authenticated
CREATE POLICY signup_insert_block
ON erp_core.signup_requests
FOR INSERT
TO authenticated
WITH CHECK (false);

-- DELETE → deny to authenticated
CREATE POLICY signup_delete_block
ON erp_core.signup_requests
FOR DELETE
TO authenticated
USING (false);

COMMIT;