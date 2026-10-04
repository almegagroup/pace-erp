-- Physical Inventory block lifecycle repair.
--
-- A block is valid only while its PID is OPEN/COUNTED/PENDING_APPROVAL and
-- the corresponding PID item exists.  This migration restores that invariant
-- for existing data and enforces it for every future MI04/MI05/MI07 flow.

CREATE OR REPLACE FUNCTION erp_procurement.release_pi_block_when_item_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, erp_procurement, public
AS $fn$
BEGIN
  DELETE FROM erp_inventory.physical_inventory_block
  WHERE pi_document_id = OLD.document_id
    AND material_id = OLD.material_id
    AND storage_location_id = OLD.storage_location_id
    AND stock_type = OLD.stock_type
    AND batch_number IS NOT DISTINCT FROM OLD.batch_number;

  RETURN OLD;
END;
$fn$;

REVOKE ALL ON FUNCTION erp_procurement.release_pi_block_when_item_deleted() FROM PUBLIC;

DROP TRIGGER IF EXISTS physical_inventory_item_release_block ON erp_procurement.physical_inventory_item;
CREATE TRIGGER physical_inventory_item_release_block
AFTER DELETE ON erp_procurement.physical_inventory_item
FOR EACH ROW
EXECUTE FUNCTION erp_procurement.release_pi_block_when_item_deleted();

CREATE OR REPLACE FUNCTION erp_procurement.release_pi_blocks_when_document_finalized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = erp_inventory, erp_procurement, public
AS $fn$
BEGIN
  IF NEW.status IN ('POSTED', 'CANCELLED')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    DELETE FROM erp_inventory.physical_inventory_block
    WHERE pi_document_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION erp_procurement.release_pi_blocks_when_document_finalized() FROM PUBLIC;

DROP TRIGGER IF EXISTS physical_inventory_document_release_blocks ON erp_procurement.physical_inventory_document;
CREATE TRIGGER physical_inventory_document_release_blocks
AFTER UPDATE OF status ON erp_procurement.physical_inventory_document
FOR EACH ROW
EXECUTE FUNCTION erp_procurement.release_pi_blocks_when_document_finalized();

-- One-time repair: a completed/cancelled PID can never own a live posting
-- block.  This removes the stale F003 rows from CMP006 and equivalent rows,
-- if any, in every company without touching blocks for active counts.
DELETE FROM erp_inventory.physical_inventory_block AS block_row
USING erp_procurement.physical_inventory_document AS pid
WHERE pid.id = block_row.pi_document_id
  AND pid.status IN ('POSTED', 'CANCELLED');
