# CODEX-GATE19-TASK-BRIEF — Opening Stock Migration

**Read First:** `OM-GATE-19-OpeningStock-Spec.md`

## Files to Create / Modify

**DB (2 migrations):**
- `supabase/migrations/20260512200000_gate19_19_1_1_seed_opening_stock_movement_types.sql`
- `supabase/migrations/20260512200100_gate19_19_1_2_create_opening_stock_tables.sql`

**BE (create):**
- `supabase/functions/api/_core/procurement/opening_stock.handlers.ts`

**BE (modify):**
- `supabase/functions/api/_routes/procurement.routes.ts`

**FE (create):**
- `frontend/src/admin/sa/screens/SAOpeningStockListPage.jsx`
- `frontend/src/admin/sa/screens/SAOpeningStockDetailPage.jsx`

**FE (modify):**
- `frontend/src/pages/dashboard/procurement/procurementApi.js` ← add 9 functions

---

## Critical Points

- **P563/P565 missing** — seed P563 (QA), P564, P565 (Blocked), P566 in `erp_inventory.movement_type_master`
- **movement_type_code** derived server-side: UNRESTRICTED→P561, QUALITY_INSPECTION→P563, BLOCKED→P565. Client never sends it.
- **total_value** = GENERATED ALWAYS AS (quantity × rate_per_unit) STORED — never set manually
- **UNIQUE(company_id, plant_id, cut_off_date)** — one document per company+plant+cut_off
- **'OS'** added to `erp_procurement.document_number_series` in migration 19.1.2
- **postOpeningStockDocumentHandler** — calls `post_stock_movement()` per line. Pass `p_plant_id = document.plant_id` (NOT null — unlike GRN)
- All 9 handlers assert SA role → 403 if not SA
- Status flow: DRAFT → SUBMITTED → APPROVED → POSTED (no skipping)
- Post confirm dialog in FE: "This will post stock movements to the ledger. Cannot be undone."
- Storage location dropdown filtered by document's plant_id
- Material combobox: show `material_name (pace_code)`
- Add Line form + Edit/Remove only when status = DRAFT

## After Implementation

Update `OM-IMPLEMENTATION-LOG.md` Gate-19 items 19.1–19.3 → DONE
