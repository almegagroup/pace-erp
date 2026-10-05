-- PO12 (PTO) Phase C — Tab 1 Discrepancy List + Settlement (Leg 2 Invoice).
-- Design locked in docs/PROCUREMENT-DESIGN-DOC.md, business-owner session
-- 2026-10-03/04 ("PO12 (PTO) — Tab 1 Design", "AC01 'ITC To' + cross-company
-- visibility", "Settlement (Leg 2 Invoice)").
--
-- 1) landed_cost.itc_owner_company_id — header-level, who the GST credit on
--    this GRN's landed cost legally belongs to. Defaults to the GRN's own
--    company_id (ordinary non-CRCP case, zero behavior change); set to the
--    PO/STO's own Bill-To company_id for a CRCP-flagged GRN via the new
--    CRCP Cost Component Entry write-path (separate migration/handler).
-- 2) SETTLEMENT doc-series row — global range, per CLAUDE.md §8, confirmed
--    free in both Dev and Prod (highest band taken was SRET at 98xxxxxxxx).

BEGIN;

ALTER TABLE erp_procurement.landed_cost
  ADD COLUMN itc_owner_company_id uuid NULL;

COMMENT ON COLUMN erp_procurement.landed_cost.itc_owner_company_id IS
'Who the GST credit (ITC) on this landed cost document legally belongs to -- NOT "who entered this line" (that is created_by/entered-by, already covered, a separate audit-trail concept). Defaults to this landed cost''s own GRN company_id for an ordinary, non-CRCP purchase (today''s existing reality, zero behavior change). Explicitly set to the PO/STO''s own Bill-To company_id when this landed_cost belongs to a CRCP-flagged GRN whose Actual Receiver differs from its Bill-To -- see PO12 Tab 1 "AC01 ITC To" design. AC01''s own read/list query is broadened to show a GRN whenever the viewing company owns it OR is this column''s value; AC01''s write access stays unchanged (strictly GRN-company-scoped).';

-- Backfill: every existing row is the ordinary, non-CRCP case -- ITC owner is
-- simply that landed cost document's own GRN company, matching today's
-- reality exactly (no CRCP mechanism existed before 2026-09-27, so no
-- existing row can legitimately need anything else).
UPDATE erp_procurement.landed_cost lc
SET itc_owner_company_id = gr.company_id
FROM erp_procurement.goods_receipt gr
WHERE lc.grn_id = gr.id
  AND lc.itc_owner_company_id IS NULL;

INSERT INTO erp_procurement.document_number_series
  (doc_type, starting_number, last_number, pad_width)
VALUES ('SETTLEMENT', 9900000001, 0, 10)
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
