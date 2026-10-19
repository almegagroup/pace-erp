/*
 * Migration: 20261019150000_po22_ai_usage_budget
 * Purpose:   PO22 AI explanations (Phase 2D §8, owner D8): server-side token budget per company per
 *            month with an atomic reservation, then settlement with the real usage. AI never writes a
 *            planning number; this table only records usage.
 *   After applying (owner approval required): NOTIFY pgrst, 'reload schema'; reconcile schema_migrations;
 *   run migration-integrity-check.
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_planning.mts_ai_usage (
  company_id      uuid NOT NULL REFERENCES erp_master.companies(id),
  usage_month     date NOT NULL CHECK (date_trunc('month', usage_month)::date = usage_month),
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  used_tokens     bigint NOT NULL DEFAULT 0 CHECK (used_tokens >= 0),
  request_count   integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, usage_month)
);
COMMENT ON TABLE erp_planning.mts_ai_usage IS
  'PO22 AI token budget per company and month: reserved (in flight) + used (settled). Cap enforced by reserve_mts_ai_budget().';
ALTER TABLE erp_planning.mts_ai_usage ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_planning.mts_ai_usage TO service_role;

-- Atomic reservation (CLAUDE.md §8B): one UPDATE ... RETURNING; false when the cap would be exceeded.
CREATE OR REPLACE FUNCTION erp_planning.reserve_mts_ai_budget(
  p_company_id uuid, p_month date, p_tokens bigint, p_cap bigint
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, erp_planning
AS $$
DECLARE v_ok boolean;
BEGIN
  IF p_tokens <= 0 OR p_cap <= 0 THEN RETURN false; END IF;
  INSERT INTO erp_planning.mts_ai_usage (company_id, usage_month) VALUES (p_company_id, p_month)
  ON CONFLICT (company_id, usage_month) DO NOTHING;
  UPDATE erp_planning.mts_ai_usage
     SET reserved_tokens = reserved_tokens + p_tokens, request_count = request_count + 1, updated_at = now()
   WHERE company_id = p_company_id AND usage_month = p_month
     AND used_tokens + reserved_tokens + p_tokens <= p_cap
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END;
$$;

-- Settlement: release the reservation and record what was really used.
CREATE OR REPLACE FUNCTION erp_planning.settle_mts_ai_budget(
  p_company_id uuid, p_month date, p_reserved bigint, p_used bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, erp_planning
AS $$
BEGIN
  UPDATE erp_planning.mts_ai_usage
     SET reserved_tokens = greatest(0, reserved_tokens - greatest(0, p_reserved)),
         used_tokens = used_tokens + greatest(0, p_used),
         updated_at = now()
   WHERE company_id = p_company_id AND usage_month = p_month;
END;
$$;

REVOKE ALL ON FUNCTION erp_planning.reserve_mts_ai_budget(uuid, date, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_planning.settle_mts_ai_budget(uuid, date, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_planning.reserve_mts_ai_budget(uuid, date, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION erp_planning.settle_mts_ai_budget(uuid, date, bigint, bigint) TO service_role;

COMMIT;
