-- AC01 free-text search must not drop rows either.
--
-- The handler resolved matching vendors and materials by name with .limit(50) each and put the ids into a
-- URL .or() filter, so a term that matches more than 50 vendors/materials ("ltd", "chemical") missed rows.
-- The search now runs inside ac01_visible_goods_receipts: GRN / invoice / LR number, vendor name, material
-- name or external code, as a plain substring match (no wildcard characters from the user text).
-- p_company_id NULL = every company (the SA/GA view that has no company filter).
-- The old one-argument function is dropped; the new one keeps p_search optional, so a request that only
-- sends p_company_id (the previous release during a deploy) still resolves.
DROP FUNCTION IF EXISTS erp_procurement.ac01_visible_goods_receipts(uuid);

CREATE OR REPLACE FUNCTION erp_procurement.ac01_visible_goods_receipts(p_company_id uuid, p_search text DEFAULT NULL)
RETURNS SETOF erp_procurement.goods_receipt
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT g.*
  FROM erp_procurement.goods_receipt AS g
  WHERE (
      p_company_id IS NULL
      OR g.company_id = p_company_id
      OR EXISTS (SELECT 1 FROM erp_procurement.landed_cost AS lc
                 WHERE lc.grn_id = g.id AND lc.itc_owner_company_id = p_company_id)
      OR EXISTS (SELECT 1 FROM erp_procurement.purchase_order AS po
                 WHERE po.id = g.po_id AND po.company_id = p_company_id AND COALESCE(po.crcp_enabled, false))
      OR EXISTS (SELECT 1 FROM erp_procurement.stock_transfer_order AS s
                 WHERE s.id = g.sto_id AND s.receiving_company_id = p_company_id AND COALESCE(s.crcp_enabled, false))
    )
    AND (
      NULLIF(btrim(p_search), '') IS NULL
      OR strpos(lower(COALESCE(g.grn_number, '')), lower(btrim(p_search))) > 0
      OR strpos(lower(COALESCE(g.invoice_number, '')), lower(btrim(p_search))) > 0
      OR strpos(lower(COALESCE(g.lr_number, '')), lower(btrim(p_search))) > 0
      OR EXISTS (SELECT 1 FROM erp_master.vendor_master AS v
                 WHERE v.id = g.vendor_id AND strpos(lower(COALESCE(v.vendor_name, '')), lower(btrim(p_search))) > 0)
      OR EXISTS (SELECT 1 FROM erp_master.material_master AS m
                 WHERE m.id = g.material_id
                   AND (strpos(lower(COALESCE(m.material_name, '')), lower(btrim(p_search))) > 0
                        OR strpos(lower(COALESCE(m.external_code, '')), lower(btrim(p_search))) > 0))
    );
$function$;

REVOKE ALL ON FUNCTION erp_procurement.ac01_visible_goods_receipts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_procurement.ac01_visible_goods_receipts(uuid, text) TO service_role;
