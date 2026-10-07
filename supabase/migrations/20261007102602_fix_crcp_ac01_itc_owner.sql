-- CRCP ITC owner invariant.
--
-- `landed_cost.company_id` remains the actual receiver because the receipt,
-- inventory and landed-cost document belong to that company.  GST credit is a
-- separate legal ownership concern: for a CRCP receipt it belongs to Bill-To
-- (PO.company_id / STO.receiving_company_id).  AC01 can create the first
-- landed-cost header from the Actual Receiver's workspace, so deriving the
-- owner only in PO12's cost-component path left a hole.
--
-- Enforce the invariant at the table boundary.  This covers every current and
-- future landed-cost header writer, while keeping the existing one-header-per-
-- GRN model and AC01's own atomic save RPC unchanged.
CREATE OR REPLACE FUNCTION erp_procurement.enforce_landed_cost_itc_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_grn_company_id uuid;
  v_po_id uuid;
  v_sto_id uuid;
  v_bill_to_company_id uuid;
  v_crcp_enabled boolean := false;
BEGIN
  IF NEW.grn_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT gr.company_id, gr.po_id, gr.sto_id
  INTO v_grn_company_id, v_po_id, v_sto_id
  FROM erp_procurement.goods_receipt AS gr
  WHERE gr.id = NEW.grn_id;

  -- Do not invent an owner for an orphaned legacy reference.  The foreign-key
  -- constraint will still reject an invalid GRN id in the normal path.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_po_id IS NOT NULL THEN
    SELECT po.company_id, COALESCE(po.crcp_enabled, false)
    INTO v_bill_to_company_id, v_crcp_enabled
    FROM erp_procurement.purchase_order AS po
    WHERE po.id = v_po_id;
  ELSIF v_sto_id IS NOT NULL THEN
    SELECT sto.receiving_company_id, COALESCE(sto.crcp_enabled, false)
    INTO v_bill_to_company_id, v_crcp_enabled
    FROM erp_procurement.stock_transfer_order AS sto
    WHERE sto.id = v_sto_id;
  END IF;

  IF v_crcp_enabled AND v_bill_to_company_id IS NOT NULL THEN
    NEW.itc_owner_company_id := v_bill_to_company_id;
  ELSE
    NEW.itc_owner_company_id := v_grn_company_id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION erp_procurement.enforce_landed_cost_itc_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_landed_cost_itc_owner
  ON erp_procurement.landed_cost;

CREATE TRIGGER trg_enforce_landed_cost_itc_owner
BEFORE INSERT OR UPDATE OF grn_id, itc_owner_company_id
ON erp_procurement.landed_cost
FOR EACH ROW
EXECUTE FUNCTION erp_procurement.enforce_landed_cost_itc_owner();

COMMENT ON FUNCTION erp_procurement.enforce_landed_cost_itc_owner() IS
  'Enforces landed-cost ITC owner: CRCP Bill-To (PO.company_id / STO.receiving_company_id), otherwise the GRN actual receiver.';
