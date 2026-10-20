/*
 * Migration: 20261021100000_po22_inbound_eta_reschedule
 * Purpose:   PO22 P1 (owner 2026-10-20) — planning-side rescheduled ETA.
 *            The planner may move a not-yet-shipped inbound piece (open PO remainder,
 *            CSN not dispatched, PO lot) to another plant date for planning only.
 *            CSN Tracker / PO are never changed by the system — the user updates them.
 *
 *   1. inbound_eta_reschedule — append-only, versioned per (company, reschedule_key);
 *      rescheduled_eta NULL = cleared (back to the source date).
 *   2. save_inbound_eta_reschedule() — atomic save of one or more keys.
 *
 * reschedule_key: 'CSN|<consignment_note.id>' | 'PO_LINE|<purchase_order_line.id>'
 *                 | 'PO_LOT|<purchase_order_line.id>|<lot_number>'
 *
 * After applying: NOTIFY pgrst, 'reload schema'; run migration-integrity-check.
 */

BEGIN;

CREATE TABLE erp_planning.inbound_eta_reschedule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES erp_master.companies(id),
  reschedule_key   text NOT NULL CHECK (reschedule_key ~ '^(CSN|PO_LINE|PO_LOT)\|'),
  material_id      uuid NOT NULL REFERENCES erp_master.material_master(id),
  original_eta     date,
  rescheduled_eta  date,
  reason           text,
  version_no       integer NOT NULL CHECK (version_no >= 1),
  is_current       boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE erp_planning.inbound_eta_reschedule IS
  'PO22: planning-only rescheduled plant ETA of a not-yet-shipped inbound piece. Append-only; CSN Tracker is never changed by it.';

CREATE UNIQUE INDEX ux_inbound_eta_reschedule_current
  ON erp_planning.inbound_eta_reschedule (company_id, reschedule_key) WHERE is_current;

CREATE TRIGGER trg_inbound_eta_reschedule_append_only
  BEFORE UPDATE OR DELETE ON erp_planning.inbound_eta_reschedule
  FOR EACH ROW EXECUTE FUNCTION erp_planning.guard_append_only();

-- p_rows: [{ reschedule_key, material_id, original_eta?, rescheduled_eta (null/'' = clear), reason? }]
CREATE OR REPLACE FUNCTION erp_planning.save_inbound_eta_reschedule(
  p_company_id uuid,
  p_actor      uuid,
  p_rows       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row       jsonb;
  v_key       text;
  v_material  uuid;
  v_eta       date;
  v_original  date;
  v_reason    text;
  v_current   erp_planning.inbound_eta_reschedule%ROWTYPE;
  v_saved     integer := 0;
  v_unchanged integer := 0;
BEGIN
  IF p_company_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'MTS_RESCHEDULE_INVALID_INPUT: company and actor are required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'MTS_RESCHEDULE_NO_ROWS: nothing to save';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_key      := btrim(coalesce(v_row->>'reschedule_key', ''));
    v_material := nullif(v_row->>'material_id', '')::uuid;
    v_eta      := nullif(v_row->>'rescheduled_eta', '')::date;
    v_original := nullif(v_row->>'original_eta', '')::date;
    v_reason   := nullif(btrim(coalesce(v_row->>'reason', '')), '');
    IF v_key !~ '^(CSN|PO_LINE|PO_LOT)\|' OR v_material IS NULL THEN
      RAISE EXCEPTION 'MTS_RESCHEDULE_INVALID_INPUT: key and material are required';
    END IF;

    SELECT * INTO v_current FROM erp_planning.inbound_eta_reschedule
    WHERE company_id = p_company_id AND reschedule_key = v_key AND is_current
    FOR UPDATE;

    IF (v_current.id IS NULL AND v_eta IS NULL)
       OR (v_current.id IS NOT NULL AND v_current.rescheduled_eta IS NOT DISTINCT FROM v_eta
           AND v_current.reason IS NOT DISTINCT FROM v_reason) THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;
    IF v_current.id IS NOT NULL THEN
      UPDATE erp_planning.inbound_eta_reschedule SET is_current = false WHERE id = v_current.id;
    END IF;
    INSERT INTO erp_planning.inbound_eta_reschedule
      (company_id, reschedule_key, material_id, original_eta, rescheduled_eta, reason, version_no, is_current, created_by)
    VALUES (p_company_id, v_key, v_material, v_original, v_eta, v_reason, coalesce(v_current.version_no, 0) + 1, true, p_actor);
    v_saved := v_saved + 1;
  END LOOP;

  RETURN jsonb_build_object('saved', v_saved, 'unchanged', v_unchanged);
END;
$$;

ALTER TABLE erp_planning.inbound_eta_reschedule ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_planning.inbound_eta_reschedule TO service_role;
REVOKE ALL ON FUNCTION erp_planning.save_inbound_eta_reschedule(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.save_inbound_eta_reschedule(uuid, uuid, jsonb) TO service_role;

COMMIT;
