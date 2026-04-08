-- =====================================================
-- 🔐 PACE ERP — SA BOOTSTRAP SCRIPT (UPSERT SAFE)
-- =====================================================

DO $$
DECLARE
  v_auth_user_id UUID := 'Your ID';
  v_user_code TEXT := 'SA001';
BEGIN

  -- ============================================
  -- 🔍 VALIDATE AUTH USER
  -- ============================================

  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_auth_user_id
  ) THEN
    RAISE EXCEPTION 'Auth user not found for given UUID';
  END IF;

  -- ============================================
  -- 🔄 UPSERT LOGIC
  -- ============================================

  IF EXISTS (
    SELECT 1 FROM erp_core.users
    WHERE auth_user_id = v_auth_user_id
  ) THEN

    -- 🔁 UPDATE existing (PENDING → SA)
    UPDATE erp_core.users
    SET 
      user_code = v_user_code,
      state = 'ACTIVE'
    WHERE auth_user_id = v_auth_user_id;

    RAISE NOTICE 'SA user UPDATED successfully: %', v_user_code;

  ELSE

    -- 🚀 INSERT new
    INSERT INTO erp_core.users (
      auth_user_id,
      user_code,
      state,
      created_at
    )
    VALUES (
      v_auth_user_id,
      v_user_code,
      'ACTIVE',
      now()
    );

    RAISE NOTICE 'SA user INSERTED successfully: %', v_user_code;

  END IF;

END $$;