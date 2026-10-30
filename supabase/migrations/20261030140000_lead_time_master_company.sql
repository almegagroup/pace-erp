-- Company-to-company transit days for STO / FG STO CSNs.
--
-- An STO CSN has no vendor lead time (its "vendor" is the sending COMPANY, whose
-- id is stored in consignment_note.vendor_id) and no port, so its ETA to plant
-- never had a transit master to read: prod STO CSNs 3000000128/131 carried
-- transit_days_snapshot NULL and ETA = LR date.
--
-- One row describes a PAIR of companies and is valid in BOTH directions
-- (CMP003 -> CMP005 is the same lane as CMP005 -> CMP003), so the pair is stored
-- once in canonical order (company_a_id < company_b_id) and looked up either way.
CREATE TABLE IF NOT EXISTS erp_master.lead_time_master_company (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_a_id  uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  company_b_id  uuid NOT NULL REFERENCES erp_master.companies(id) ON DELETE RESTRICT,
  transit_days  int  NOT NULL CHECK (transit_days >= 0),
  effective_from date NOT NULL,
  effective_to   date NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NULL,
  CONSTRAINT lead_time_master_company_pair_order CHECK (company_a_id < company_b_id),
  CONSTRAINT lead_time_master_company_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE erp_master.lead_time_master_company IS
'Company-to-company transit days (days from LR/dispatch to plant gate) for STO and FG STO CSNs. Symmetric: one row per unordered company pair, company_a_id < company_b_id.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_ltmc_pair_from
  ON erp_master.lead_time_master_company (company_a_id, company_b_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_ltmc_pair_active
  ON erp_master.lead_time_master_company (company_a_id, company_b_id) WHERE active;

ALTER TABLE erp_master.lead_time_master_company ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_only" ON erp_master.lead_time_master_company
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false);
GRANT ALL    ON erp_master.lead_time_master_company TO service_role;

-- Transit days for a lane on a given date (either direction); NULL when no row.
CREATE OR REPLACE FUNCTION erp_master.resolve_company_transit_days(
  p_company_1 uuid, p_company_2 uuid, p_on date DEFAULT CURRENT_DATE
) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'erp_master', 'pg_catalog'
AS $$
  SELECT m.transit_days
    FROM erp_master.lead_time_master_company m
   WHERE m.active
     AND m.company_a_id = LEAST(p_company_1, p_company_2)
     AND m.company_b_id = GREATEST(p_company_1, p_company_2)
     AND m.effective_from <= p_on
     AND (m.effective_to IS NULL OR m.effective_to >= p_on)
   ORDER BY m.effective_from DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION erp_master.resolve_company_transit_days(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_master.resolve_company_transit_days(uuid, uuid, date) TO service_role;
