-- AC01 and PO12 (Tab 1 / Settlement) must never silently drop GRN rows.
--
-- Before: AC01 built one .or(id.in.(...)) URL from the company's ITC-owner GRN ids and capped it at 300
-- (the rest vanished); PO12 read a window of the latest GRNs through PostgREST (.limit(2000), which the
-- 1,000-row API cap cuts to 1,000) and filtered in TypeScript, so older discrepancy rows vanished.
-- Now the visibility rule runs in the database and the handlers page through the whole set.
--
-- ac01_visible_goods_receipts(company): the GRNs a company sees in AC01 = its own receipts, GRNs whose
--   landed cost names it ITC owner, and receipts against its CRCP POs / STOs (the Bill-To mirror).
-- crcp_candidate_goods_receipts(company): PO12 candidates = GRNs whose Bill-To (PO company, or STO
--   receiving company) differs from the receiving company, where the viewer is the Bill-To, the Ship-To
--   or the actual receiver. Same rule as fetchCrcpDiscrepancyRows, applied in SQL.
-- Both return SETOF goods_receipt so PostgREST can still filter, order, count and range them.
CREATE OR REPLACE FUNCTION erp_procurement.ac01_visible_goods_receipts(p_company_id uuid)
RETURNS SETOF erp_procurement.goods_receipt
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT g.*
  FROM erp_procurement.goods_receipt AS g
  WHERE g.company_id = p_company_id
     OR EXISTS (SELECT 1 FROM erp_procurement.landed_cost AS lc
                WHERE lc.grn_id = g.id AND lc.itc_owner_company_id = p_company_id)
     OR EXISTS (SELECT 1 FROM erp_procurement.purchase_order AS po
                WHERE po.id = g.po_id AND po.company_id = p_company_id AND COALESCE(po.crcp_enabled, false))
     OR EXISTS (SELECT 1 FROM erp_procurement.stock_transfer_order AS s
                WHERE s.id = g.sto_id AND s.receiving_company_id = p_company_id AND COALESCE(s.crcp_enabled, false));
$function$;

CREATE OR REPLACE FUNCTION erp_procurement.crcp_candidate_goods_receipts(p_company_id uuid)
RETURNS SETOF erp_procurement.goods_receipt
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT g.*
  FROM erp_procurement.goods_receipt AS g
  LEFT JOIN erp_procurement.purchase_order AS po ON po.id = g.po_id
  LEFT JOIN erp_procurement.stock_transfer_order AS s ON s.id = g.sto_id
  WHERE COALESCE(po.company_id, s.receiving_company_id) IS NOT NULL
    AND COALESCE(po.company_id, s.receiving_company_id) <> g.company_id
    AND (p_company_id = COALESCE(po.company_id, s.receiving_company_id)
         OR p_company_id = g.company_id
         OR p_company_id = g.ship_to_company_id);
$function$;

REVOKE ALL ON FUNCTION erp_procurement.ac01_visible_goods_receipts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION erp_procurement.crcp_candidate_goods_receipts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.ac01_visible_goods_receipts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION erp_procurement.crcp_candidate_goods_receipts(uuid) TO service_role;
