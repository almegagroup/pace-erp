/*
 * CSN Hold lifecycle
 *
 * HLD is deliberately a temporary, editable operational state.  It is not a
 * cancellation or a knock-off: the original ORD/TRN state is retained for a
 * later Release, while PO22 excludes it as future supply.
 */

BEGIN;

ALTER TABLE erp_procurement.consignment_note
  ADD COLUMN IF NOT EXISTS hold_reason text NULL,
  ADD COLUMN IF NOT EXISTS hold_root_csn_id uuid NULL
    REFERENCES erp_procurement.consignment_note(id) ON DELETE SET NULL;

ALTER TABLE erp_procurement.consignment_note
  DROP CONSTRAINT IF EXISTS consignment_note_status_check;

ALTER TABLE erp_procurement.consignment_note
  ADD CONSTRAINT consignment_note_status_check
  CHECK (status IN ('ORD', 'TRN', 'GED', 'GRD', 'CAN', 'KOF', 'HLD'));

CREATE INDEX IF NOT EXISTS idx_csn_hold_root
  ON erp_procurement.consignment_note (hold_root_csn_id)
  WHERE status = 'HLD';

CREATE TABLE IF NOT EXISTS erp_procurement.csn_hold_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  csn_id uuid NOT NULL REFERENCES erp_procurement.consignment_note(id) ON DELETE CASCADE,
  hold_root_csn_id uuid NOT NULL REFERENCES erp_procurement.consignment_note(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('HOLD', 'RELEASE')),
  from_status text NOT NULL CHECK (from_status IN ('ORD', 'TRN', 'HLD')),
  to_status text NOT NULL CHECK (to_status IN ('ORD', 'TRN', 'HLD')),
  reason text NULL,
  acted_by uuid NOT NULL,
  acted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csn_hold_event_lookup
  ON erp_procurement.csn_hold_event (csn_id, acted_at DESC);

GRANT ALL ON erp_procurement.csn_hold_event TO service_role;

/*
 * One transaction changes a CSN and, when it is a Mother CSN, every active
 * Sub-CSN.  A child controlled by its Mother cannot be released independently;
 * the user must release the whole physical consignment through the Mother.
 */
CREATE OR REPLACE FUNCTION erp_procurement.transition_csn_hold(
  p_csn_id uuid,
  p_action text,
  p_reason text,
  p_actor uuid
)
RETURNS SETOF erp_procurement.consignment_note
LANGUAGE plpgsql
SET search_path = erp_procurement, public
AS $$
DECLARE
  v_root erp_procurement.consignment_note%ROWTYPE;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF p_action NOT IN ('HOLD', 'RELEASE') THEN
    RAISE EXCEPTION 'PROCUREMENT_CSN_HOLD_ACTION_INVALID';
  END IF;

  SELECT * INTO v_root
  FROM erp_procurement.consignment_note
  WHERE id = p_csn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROCUREMENT_CSN_NOT_FOUND';
  END IF;

  IF p_action = 'HOLD' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'PROCUREMENT_CSN_HOLD_REASON_REQUIRED';
    END IF;
    IF v_root.status NOT IN ('ORD', 'TRN') THEN
      RAISE EXCEPTION 'PROCUREMENT_CSN_HOLD_NOT_ALLOWED:%', v_root.status;
    END IF;
    IF v_root.mother_csn_id IS NOT NULL AND v_root.hold_root_csn_id IS NOT NULL THEN
      RAISE EXCEPTION 'PROCUREMENT_CSN_HOLD_ALREADY_CONTROLLED_BY_MOTHER';
    END IF;

    -- Refuse a partial physical-consignment Hold.  Terminal children need no
    -- hold, but a gate/GRN child proves the Mother cannot be wholly excluded.
    IF EXISTS (
      SELECT 1
      FROM erp_procurement.consignment_note child
      WHERE child.mother_csn_id = v_root.id
        AND child.status IN ('GED', 'GRD')
    ) THEN
      RAISE EXCEPTION 'PROCUREMENT_CSN_HOLD_CHILD_ALREADY_RECEIVED';
    END IF;

    UPDATE erp_procurement.consignment_note
    SET status = 'HLD',
        inactive_reason_code = 'HLD',
        inactive_from_status = status,
        inactive_at = v_now,
        inactive_by = p_actor,
        hold_reason = v_reason,
        hold_root_csn_id = v_root.id,
        last_updated_at = v_now,
        last_updated_by = p_actor
    WHERE id = v_root.id
       OR (mother_csn_id = v_root.id AND status IN ('ORD', 'TRN'));

    INSERT INTO erp_procurement.csn_hold_event
      (csn_id, hold_root_csn_id, action, from_status, to_status, reason, acted_by, acted_at)
    SELECT id, v_root.id, 'HOLD', inactive_from_status, 'HLD', v_reason, p_actor, v_now
    FROM erp_procurement.consignment_note
    WHERE hold_root_csn_id = v_root.id AND status = 'HLD';
  ELSE
    IF v_root.status <> 'HLD' THEN
      RAISE EXCEPTION 'PROCUREMENT_CSN_RELEASE_NOT_ALLOWED:%', v_root.status;
    END IF;
    IF v_root.hold_root_csn_id IS DISTINCT FROM v_root.id THEN
      RAISE EXCEPTION 'PROCUREMENT_CSN_RELEASE_FROM_MOTHER_REQUIRED';
    END IF;

    IF EXISTS (
      SELECT 1 FROM erp_procurement.consignment_note
      WHERE hold_root_csn_id = v_root.id
        AND (inactive_from_status NOT IN ('ORD', 'TRN') OR inactive_from_status IS NULL)
    ) THEN
      RAISE EXCEPTION 'PROCUREMENT_CSN_RELEASE_STATE_INVALID';
    END IF;

    INSERT INTO erp_procurement.csn_hold_event
      (csn_id, hold_root_csn_id, action, from_status, to_status, reason, acted_by, acted_at)
    SELECT id, v_root.id, 'RELEASE', 'HLD', inactive_from_status, v_reason, p_actor, v_now
    FROM erp_procurement.consignment_note
    WHERE hold_root_csn_id = v_root.id AND status = 'HLD';

    UPDATE erp_procurement.consignment_note
    SET status = inactive_from_status,
        inactive_reason_code = NULL,
        inactive_from_status = NULL,
        inactive_at = NULL,
        inactive_by = NULL,
        hold_reason = NULL,
        hold_root_csn_id = NULL,
        last_updated_at = v_now,
        last_updated_by = p_actor
    WHERE hold_root_csn_id = v_root.id AND status = 'HLD';
  END IF;

  RETURN QUERY
  SELECT * FROM erp_procurement.consignment_note
  WHERE id = p_csn_id;
END;
$$;

REVOKE ALL ON FUNCTION erp_procurement.transition_csn_hold(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_procurement.transition_csn_hold(uuid, text, text, uuid) TO service_role;

COMMIT;
