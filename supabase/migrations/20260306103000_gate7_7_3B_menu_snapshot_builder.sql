/*
 * File-ID: 7.3B
 * File-Path: supabase/migrations/20260306103000_gate7_7_3B_menu_snapshot_builder.sql
 * Gate: 7
 * Phase: 7
 * Domain: ACL
 * Purpose: Deterministic menu snapshot generation engine (Projection Layer)
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- MENU SNAPSHOT BUILDER
-- Generates deterministic projection snapshot per user-context
-- Source of truth: acl.precomputed_acl_view (6.18A)
-- This is projection-only logic (no permission evaluation here)
-- ============================================================

CREATE OR REPLACE FUNCTION erp_menu.generate_menu_snapshot(
    p_user_id UUID,
    p_company_id UUID,
    p_universe TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_version INTEGER;
BEGIN

    -- ------------------------------------------------------------
    -- 1️⃣ Validate universe input
    -- ------------------------------------------------------------
    IF p_universe NOT IN ('SA', 'ACL') THEN
        RAISE EXCEPTION 'Invalid universe: %', p_universe;
    END IF;

    -- ------------------------------------------------------------
    -- 2️⃣ Compute next snapshot version (monotonic per user+company+universe)
    -- ------------------------------------------------------------
    SELECT COALESCE(MAX(snapshot_version), 0) + 1
    INTO v_next_version
    FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND company_id = p_company_id
      AND universe = p_universe;

    -- ------------------------------------------------------------
    -- 3️⃣ Remove previous snapshot rows (fail-closed design)
    -- ------------------------------------------------------------
    DELETE FROM erp_menu.menu_snapshot
    WHERE user_id = p_user_id
      AND company_id = p_company_id
      AND universe = p_universe;

    -- ------------------------------------------------------------
    -- 4️⃣ ACL Universe Projection
    -- ------------------------------------------------------------
    IF p_universe = 'ACL' THEN

        INSERT INTO erp_menu.menu_snapshot (
            user_id,
            company_id,
            universe,
            snapshot_version,
            menu_code,
            resource_code,
            route_path,
            menu_type,
            parent_menu_code,
            display_order,
            is_visible
        )
        SELECT
            p_user_id,
            p_company_id,
            'ACL',
            v_next_version,
            m.menu_code,
            m.resource_code,
            m.route_path,
            m.menu_type,
            parent.menu_code,
            COALESCE(mt.display_order, m.display_order),
            TRUE
        FROM acl.precomputed_acl_view pav
        JOIN erp_menu.menu_master m
            ON m.resource_code = pav.resource_code
        LEFT JOIN erp_menu.menu_tree mt
            ON mt.child_menu_id = m.id
        LEFT JOIN erp_menu.menu_master parent
            ON parent.id = mt.parent_menu_id
        WHERE pav.auth_user_id = p_user_id
          AND pav.company_id = p_company_id
          AND pav.decision = 'ALLOW'
          AND pav.action_code = 'VIEW'
          AND m.universe = 'ACL'
          AND m.is_active = true;

    END IF;

    -- ------------------------------------------------------------
    -- 5️⃣ SA Universe Projection (Unrestricted)
    -- ------------------------------------------------------------
    IF p_universe = 'SA' THEN

        INSERT INTO erp_menu.menu_snapshot (
            user_id,
            company_id,
            universe,
            snapshot_version,
            menu_code,
            resource_code,
            route_path,
            menu_type,
            parent_menu_code,
            display_order,
            is_visible
        )
        SELECT
            p_user_id,
            p_company_id,
            'SA',
            v_next_version,
            m.menu_code,
            m.resource_code,
            m.route_path,
            m.menu_type,
            parent.menu_code,
            COALESCE(mt.display_order, m.display_order),
            TRUE
        FROM erp_menu.menu_master m
        LEFT JOIN erp_menu.menu_tree mt
            ON mt.child_menu_id = m.id
        LEFT JOIN erp_menu.menu_master parent
            ON parent.id = mt.parent_menu_id
        WHERE m.universe = 'SA'
          AND m.is_active = true;

    END IF;

END;
$$;

COMMENT ON FUNCTION erp_menu.generate_menu_snapshot IS
'Deterministic projection engine building menu_snapshot from precomputed_acl_view (ACL) or full registry (SA). Projection only, no permission logic.';

COMMIT;