/*
 * File-Path: supabase/migrations/20261006100000_po12_tab2_transfer_group.sql
 * Domain: PROCUREMENT
 * Purpose: PO12 Tab 2 (Returnable Material Transfer) — SA "PTO Company" Transfer Group
 *          master. Final design locked 2026-10-05, PROCUREMENT-DESIGN-DOC.md §"PO12
 *          (PTO) — Tab 1 Design" -> "Tab 2 ... FINAL DESIGN LOCKED".
 *
 * Group-based (not pairwise) allow-list: a company may belong to several groups, but no
 * two active groups may share the exact same member-set (set equality, size-independent).
 * Enforced by a canonical member_signature (sorted, comma-joined company ids) under a
 * partial unique index scoped to is_active — deactivating a group frees its signature for
 * reuse later (business owner's own call).
 *
 * Split into 3 functions (header resolve / member sync / thin public wrapper) rather than
 * one monolithic upsert — a single function combining the create-or-update branch with the
 * member delete+insert was repeatedly unable to apply through this project's Supabase MCP
 * tooling (timed out every attempt; each half applied instantly on its own). Functionally
 * equivalent, just two sequential statements instead of one for the member-sync step.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_procurement.transfer_group (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name        text NOT NULL,
  member_signature  text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_updated_by   uuid NULL,
  last_updated_at   timestamptz NULL
);

-- Set-equality uniqueness, scoped to active groups only — a deactivated group's
-- combination is free to be reused by a brand new group later.
CREATE UNIQUE INDEX IF NOT EXISTS ux_transfer_group_active_signature
  ON erp_procurement.transfer_group (member_signature)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS erp_procurement.transfer_group_member (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES erp_procurement.transfer_group(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL,
  UNIQUE (group_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_group_member_company
  ON erp_procurement.transfer_group_member (company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_procurement.transfer_group TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_procurement.transfer_group_member TO service_role;

-- ── _resolve_transfer_group_header — validate + create-or-update the header row ───────
-- Validates: >=2 distinct companies, non-blank name, no existing ACTIVE group with the
-- exact same member-set (excluding itself on edit). The unique index is the final
-- safety net against a concurrent race; the pre-check exists purely so the error message
-- can name the colliding group. Returns the group id; does NOT touch membership rows.
CREATE OR REPLACE FUNCTION erp_procurement._resolve_transfer_group_header(
  p_group_id    uuid,
  p_group_name  text,
  p_company_ids uuid[],
  p_actor       uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $fn$
DECLARE
  v_group_id       uuid;
  v_signature      text;
  v_distinct_count int;
  v_existing_name  text;
BEGIN
  SELECT count(DISTINCT cid) INTO v_distinct_count FROM unnest(p_company_ids) AS cid;
  IF v_distinct_count IS NULL OR v_distinct_count < 2 THEN
    RAISE EXCEPTION 'TRANSFER_GROUP_MIN_MEMBERS';
  END IF;
  IF p_group_name IS NULL OR btrim(p_group_name) = '' THEN
    RAISE EXCEPTION 'TRANSFER_GROUP_NAME_REQUIRED';
  END IF;

  SELECT string_agg(cid::text, ',' ORDER BY cid) INTO v_signature
  FROM (SELECT DISTINCT unnest(p_company_ids) AS cid) s;

  SELECT group_name INTO v_existing_name
  FROM erp_procurement.transfer_group
  WHERE member_signature = v_signature
    AND is_active = true
    AND id IS DISTINCT FROM p_group_id;
  IF v_existing_name IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSFER_GROUP_DUPLICATE_MEMBERS: %', v_existing_name;
  END IF;

  IF p_group_id IS NULL THEN
    INSERT INTO erp_procurement.transfer_group (group_name, member_signature, created_by)
    VALUES (btrim(p_group_name), v_signature, p_actor)
    RETURNING id INTO v_group_id;
  ELSE
    UPDATE erp_procurement.transfer_group
    SET group_name = btrim(p_group_name),
        member_signature = v_signature,
        last_updated_by = p_actor,
        last_updated_at = now()
    WHERE id = p_group_id
    RETURNING id INTO v_group_id;
    IF v_group_id IS NULL THEN
      RAISE EXCEPTION 'TRANSFER_GROUP_NOT_FOUND';
    END IF;
  END IF;

  RETURN v_group_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'TRANSFER_GROUP_DUPLICATE_MEMBERS';
END;
$fn$;

-- ── _sync_transfer_group_members — full replace of a group's membership ───────────────
CREATE OR REPLACE FUNCTION erp_procurement._sync_transfer_group_members(
  p_group_id    uuid,
  p_company_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_procurement, public
AS $fn$
BEGIN
  DELETE FROM erp_procurement.transfer_group_member WHERE group_id = p_group_id;
  INSERT INTO erp_procurement.transfer_group_member (group_id, company_id)
  SELECT p_group_id, cid FROM unnest(p_company_ids) AS cid
  ON CONFLICT (group_id, company_id) DO NOTHING;
END;
$fn$;

COMMENT ON FUNCTION erp_procurement._resolve_transfer_group_header(uuid, text, uuid[], uuid) IS
  'PO12 Tab 2 SA "PTO Company" page — header create/edit with set-equality duplicate guard (2026-10-05 lock). Call _sync_transfer_group_members afterward with the returned id.';
COMMENT ON FUNCTION erp_procurement._sync_transfer_group_members(uuid, uuid[]) IS
  'PO12 Tab 2 SA "PTO Company" page — full replace of one group''s membership rows.';

REVOKE ALL ON FUNCTION erp_procurement._resolve_transfer_group_header(uuid, text, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement._resolve_transfer_group_header(uuid, text, uuid[], uuid) TO service_role;
REVOKE ALL ON FUNCTION erp_procurement._sync_transfer_group_members(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement._sync_transfer_group_members(uuid, uuid[]) TO service_role;

COMMIT;
