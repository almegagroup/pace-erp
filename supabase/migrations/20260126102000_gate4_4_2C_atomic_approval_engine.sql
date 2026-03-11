/*
 * File-ID: 4.2C (HARD SEALED)
 * File-Path: supabase/migrations/20260126102000_gate4_4_2C_atomic_approval_engine.sql
 * Gate: 4
 * Phase: 4
 * Domain: DB
 * Purpose: Atomic approval + rejection lifecycle engine (Gate-4 hard seal)
 * Authority: Backend
 *
 * IMPORTANT:
 * - SINGLE SQL command (DO block)
 * - All lifecycle transitions DB-owned
 * - No handler-level mutation allowed
 */

DO $outer$
BEGIN

  -- --------------------------------------------------
  -- 0️⃣ Ensure schema
  -- --------------------------------------------------
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS erp_meta';

  -- ==================================================
  -- 1️⃣ APPROVE ATOMIC ENGINE
  -- ==================================================
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION erp_meta.approve_signup_atomic(
    p_target_auth_user_id UUID,
    p_actor_auth_user_id  UUID
  )
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $body$
  DECLARE
    v_seq BIGINT;
    v_user_code TEXT;
  BEGIN

    -- Hard input guard
    IF p_target_auth_user_id IS NULL OR p_actor_auth_user_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;

    -- Lock ERP user row (race prevention)
    PERFORM 1
    FROM erp_core.users
    WHERE auth_user_id = p_target_auth_user_id
    FOR UPDATE;

    -- Validate signup request state
    IF NOT EXISTS (
      SELECT 1
      FROM erp_core.signup_requests
      WHERE auth_user_id = p_target_auth_user_id
        AND decision = 'PENDING'
    ) THEN
      RAISE EXCEPTION 'INVALID_SIGNUP_STATE';
    END IF;

    -- Validate ERP user lifecycle state
    IF NOT EXISTS (
      SELECT 1
      FROM erp_core.users
      WHERE auth_user_id = p_target_auth_user_id
        AND state = 'PENDING'
    ) THEN
      RAISE EXCEPTION 'INVALID_USER_STATE';
    END IF;

    -- Deterministic sequence
    SELECT nextval('erp_core.user_code_p_seq') INTO v_seq;
    v_user_code := 'P' || lpad(v_seq::TEXT, 4, '0');

    -- Update signup request
    UPDATE erp_core.signup_requests
    SET decision    = 'APPROVED',
        reviewed_at = now(),
        reviewed_by = p_actor_auth_user_id
    WHERE auth_user_id = p_target_auth_user_id
      AND decision = 'PENDING';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SIGNUP_UPDATE_FAILED';
    END IF;

    -- Activate ERP user
    UPDATE erp_core.users
    SET state     = 'ACTIVE',
        user_code = v_user_code
    WHERE auth_user_id = p_target_auth_user_id
      AND state = 'PENDING';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'USER_UPDATE_FAILED';
    END IF;

    -- Minimal ACL bootstrap (single-role architecture)
    INSERT INTO erp_acl.user_roles (
      auth_user_id,
      role_code,
      role_rank,
      assigned_by
    )
    VALUES (
      p_target_auth_user_id,
      'L1_USER',
      10,
      p_actor_auth_user_id
    )
    ON CONFLICT (auth_user_id) DO NOTHING;

    -- Audit log
    INSERT INTO erp_audit.signup_approvals (
      actor_auth_user_id,
      target_auth_user_id,
      decision,
      meta
    )
    VALUES (
      p_actor_auth_user_id,
      p_target_auth_user_id,
      'APPROVED',
      jsonb_build_object(
        'user_code', v_user_code,
        'source', 'ATOMIC_APPROVAL_ENGINE'
      )
    );

    RETURN v_user_code;

  END;
  $body$;
  $fn$;

  -- ==================================================
  -- 2️⃣ REJECT ATOMIC ENGINE
  -- ==================================================
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION erp_meta.reject_signup_atomic(
    p_target_auth_user_id UUID,
    p_actor_auth_user_id  UUID
  )
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $body$
  BEGIN

    IF p_target_auth_user_id IS NULL OR p_actor_auth_user_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;

    -- Lock ERP user row
    PERFORM 1
    FROM erp_core.users
    WHERE auth_user_id = p_target_auth_user_id
    FOR UPDATE;

    -- Validate signup request state
    IF NOT EXISTS (
      SELECT 1
      FROM erp_core.signup_requests
      WHERE auth_user_id = p_target_auth_user_id
        AND decision = 'PENDING'
    ) THEN
      RAISE EXCEPTION 'INVALID_SIGNUP_STATE';
    END IF;

    -- Validate ERP user lifecycle state
    IF NOT EXISTS (
      SELECT 1
      FROM erp_core.users
      WHERE auth_user_id = p_target_auth_user_id
        AND state = 'PENDING'
    ) THEN
      RAISE EXCEPTION 'INVALID_USER_STATE';
    END IF;

    -- Update signup request
    UPDATE erp_core.signup_requests
    SET decision    = 'REJECTED',
        reviewed_at = now(),
        reviewed_by = p_actor_auth_user_id
    WHERE auth_user_id = p_target_auth_user_id
      AND decision = 'PENDING';

    -- Update ERP user lifecycle
    UPDATE erp_core.users
    SET state = 'REJECTED'
    WHERE auth_user_id = p_target_auth_user_id
      AND state = 'PENDING';

    -- Audit log
    INSERT INTO erp_audit.signup_approvals (
      actor_auth_user_id,
      target_auth_user_id,
      decision,
      meta
    )
    VALUES (
      p_actor_auth_user_id,
      p_target_auth_user_id,
      'REJECTED',
      jsonb_build_object(
        'source', 'ATOMIC_REJECT_ENGINE'
      )
    );

    RETURN 'REJECTED';

  END;
  $body$;
  $fn$;

  -- ==================================================
  -- 3️⃣ LOCKDOWN EXECUTION
  -- ==================================================
  EXECUTE 'REVOKE ALL ON FUNCTION erp_meta.approve_signup_atomic(UUID, UUID) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION erp_meta.reject_signup_atomic(UUID, UUID) FROM PUBLIC';

  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_meta.approve_signup_atomic(UUID, UUID) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION erp_meta.reject_signup_atomic(UUID, UUID) TO service_role';

  -- ==================================================
  -- 4️⃣ OWNER HARDENING (SECURITY DEFINER SAFE)
  -- ==================================================
  EXECUTE 'ALTER FUNCTION erp_meta.approve_signup_atomic(UUID, UUID) OWNER TO postgres';
  EXECUTE 'ALTER FUNCTION erp_meta.reject_signup_atomic(UUID, UUID) OWNER TO postgres';

END;
$outer$;