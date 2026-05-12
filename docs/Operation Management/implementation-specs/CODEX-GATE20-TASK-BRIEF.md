# CODEX-GATE20-TASK-BRIEF — Physical Inventory Document (PID)

**Read First:** `OM-GATE-20-PhysicalInventory-Spec.md`

## Files to Create

**DB (2 migrations):**
- `supabase/migrations/20260512210000_gate20_20_1_1_seed_pi_movement_types.sql`
- `supabase/migrations/20260512210100_gate20_20_1_2_create_pi_tables.sql`

**BE (create):**
- `supabase/functions/api/_core/procurement/physical_inventory.handlers.ts`

**FE (create):**
- `frontend/src/pages/dashboard/procurement/inventory/PIDocumentListPage.jsx`
- `frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx`

## Files to Modify

**BE (modify — 5 files):**
- `supabase/functions/api/_routes/procurement.routes.ts` ← add 7 routes
- `supabase/functions/api/_core/procurement/grn.handlers.ts` ← posting block check in postGRNHandler
- `supabase/functions/api/_core/procurement/sto.handlers.ts` ← posting block check in dispatchSTOHandler
- `supabase/functions/api/_core/procurement/sales_order.handlers.ts` ← posting block check in issueSOStockHandler
- `supabase/functions/api/_core/procurement/rtv.handlers.ts` ← posting block check in postRTVHandler

**FE (modify — 3 files):**
- `frontend/src/pages/dashboard/procurement/procurementApi.js` ← add 7 functions
- `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` ← add PROC_PI_LIST + PROC_PI_DETAIL
- `frontend/src/router/AppRouter.jsx` ← import + 2 routes

---

## Critical Points

### DB
- `difference_qty GENERATED ALWAYS AS (physical_qty - book_qty) STORED` — NULL when physical_qty not entered (valid PostgreSQL behaviour)
- `physical_inventory_item` UNIQUE(document_id, material_id, stock_type)
- `physical_inventory_block` in `erp_inventory` schema (not erp_procurement), UNIQUE(material_id, plant_id, storage_location_id)
- 'PI' → document_number_series (pad_width=6, starting_number=1)

### createPIDHandler
- LOCATION_WISE: query `erp_inventory.stock_ledger` grouped by material_id + stock_type_code WHERE plant_id + storage_location_id match AND balance > 0
- ITEM_WISE: items array from body `[{material_id, stock_type}]`, snapshot book_qty from same query (may be 0)
- Conflict check per item: if `physical_inventory_block` already has a row for material+plant+sloc → 409 `MATERIAL_POSTING_BLOCKED`
- After inserting items: INSERT into `erp_inventory.physical_inventory_block` one row per item

### enterCountHandler
- physical_qty must be >= 0 (zero count is valid — means none found)
- After updating item: check `SELECT COUNT(*) FROM physical_inventory_item WHERE document_id = X AND physical_qty IS NULL` — if 0 → UPDATE document status = 'COUNTED'

### requestRecountHandler
- Clear physical_qty → NULL, counted_by → NULL, counted_at → NULL, is_recount_requested → true
- If document.status = 'COUNTED' → set status = 'OPEN'

### postDifferencesHandler
- Process items where: `physical_qty IS NOT NULL AND posted_stock_document_id IS NULL AND difference_qty != 0`
- Also process: `physical_qty IS NOT NULL AND posted_stock_document_id IS NULL AND difference_qty = 0` — skip post_stock_movement but still release block
- Release block: DELETE FROM `erp_inventory.physical_inventory_block` WHERE pi_document_id = document.id AND material_id = item.material_id (use pi_document_id match for safety, but actually delete by material+plant+sloc)
- After processing all: check if ALL items are fully processed → if yes, set status = 'POSTED'
- p_posting_date = document.posting_date (NOT count_date — backdated posting support)
- p_unit_value = 0
- company_id: resolve from storage_location record (erp_master schema)

### Posting block check (add to 4 existing handlers)
```ts
// Add this check before post_stock_movement in each handler:
const { data: block } = await serviceRoleClient
  .schema("erp_inventory")
  .from("physical_inventory_block")
  .select("id")
  .eq("material_id", materialId)
  .eq("plant_id", plantId)
  .eq("storage_location_id", storageLocationId)
  .maybeSingle();
if (block) {
  return errorResponse("MATERIAL_POSTING_BLOCKED",
    "Material has an active physical inventory count in progress.",
    requestId, "NONE", 409, {}, req);
}
```
- GRN: check per line using line.material_id + grn.plant_id + line.storage_location_id
- STO: check per line using line.material_id + sto.sending_plant_id + line.storage_location_id
- SO issue: check per line using line.material_id + so.plant_id + line.storage_location_id
- RTV: check per line using line.material_id + rtv.plant_id + line.storage_location_id

### FE — PIDocumentDetailPage
- Physical qty input: inline in grid — number input for uncounted items, display value for counted items
- Difference column: real-time = inputValue - book_qty (client-side calc while typing, confirmed on save)
- Row colour: rose if deficit, emerald if surplus, slate if zero
- Recount button: only on counted (physical_qty NOT NULL) and unposted items
- Progress bar / summary: Items total | Counted X/Y | Pending Z
- Post confirm dialog: "This will post stock differences to the inventory ledger. Cannot be undone."
- Add Item section: visible on OPEN documents only

### openScreen() before every navigate()
- PIDocumentListPage: openScreen("PROC_PI_DETAIL") before navigate to detail; openScreen("PROC_PI_LIST") before back navigation
- PIDocumentDetailPage: openScreen("PROC_PI_LIST") before navigate back to list

---

## After Implementation

Update `OM-IMPLEMENTATION-LOG.md` Gate-20 items 20.1–20.3 → DONE
