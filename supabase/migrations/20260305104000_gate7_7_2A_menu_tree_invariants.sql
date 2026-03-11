/*
 * File-ID: 7.2A
 * File-Path: supabase/migrations/20260305104000_gate7_7_2A_menu_tree_invariants.sql
 * Gate: 7
 * Phase: 7
 * Domain: ACL
 * Purpose: Prevent cycles, universe leaks, and ghost menus
 * Authority: Backend
 */

BEGIN;

-- ============================================================
-- INVARIANT 1: Parent & Child must belong to SAME universe
-- ============================================================

CREATE OR REPLACE FUNCTION erp_menu.enforce_same_universe()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_universe TEXT;
  child_universe  TEXT;
BEGIN
  IF NEW.parent_menu_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT universe INTO parent_universe
  FROM erp_menu.menu_master
  WHERE id = NEW.parent_menu_id;

  SELECT universe INTO child_universe
  FROM erp_menu.menu_master
  WHERE id = NEW.child_menu_id;

  IF parent_universe <> child_universe THEN
    RAISE EXCEPTION
      'Menu universe mismatch: parent=% child=%',
      parent_universe, child_universe;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_same_universe
ON erp_menu.menu_tree;

CREATE TRIGGER trg_menu_same_universe
BEFORE INSERT OR UPDATE ON erp_menu.menu_tree
FOR EACH ROW
EXECUTE FUNCTION erp_menu.enforce_same_universe();

-- ============================================================
-- INVARIANT 2: Prevent hierarchy cycles (A → B → A)
-- ============================================================

CREATE OR REPLACE FUNCTION erp_menu.prevent_menu_cycles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_found BOOLEAN;
BEGIN
  IF NEW.parent_menu_id IS NULL THEN
    RETURN NEW;
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT parent_menu_id
    FROM erp_menu.menu_tree
    WHERE child_menu_id = NEW.parent_menu_id

    UNION ALL

    SELECT mt.parent_menu_id
    FROM erp_menu.menu_tree mt
    JOIN ancestors a ON mt.child_menu_id = a.parent_menu_id
    WHERE mt.parent_menu_id IS NOT NULL
  )
  SELECT TRUE INTO cycle_found
  FROM ancestors
  WHERE parent_menu_id = NEW.child_menu_id
  LIMIT 1;

  IF cycle_found THEN
    RAISE EXCEPTION 'Menu hierarchy cycle detected';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_prevent_cycles
ON erp_menu.menu_tree;

CREATE TRIGGER trg_menu_prevent_cycles
BEFORE INSERT OR UPDATE ON erp_menu.menu_tree
FOR EACH ROW
EXECUTE FUNCTION erp_menu.prevent_menu_cycles();

COMMIT;
