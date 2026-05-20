# CODEX-GATE18-TASK-BRIEF — Number Series Overhaul

**Read First:** `OM-GATE-18-NumberSeries-Spec.md`

## Files to Create / Modify

**DB (3 migrations):**
- `supabase/migrations/20260512100000_gate18_18_1_1_fix_document_number_series.sql`
- `supabase/migrations/20260512100100_gate18_18_1_2_create_company_doc_number_series.sql`
- `supabase/migrations/20260512100200_gate18_18_1_3_create_company_doc_number_functions.sql`

**BE (modify):**
- `supabase/functions/api/_core/procurement/po.handlers.ts`
- `supabase/functions/api/_core/procurement/sto.handlers.ts`
- `supabase/functions/api/_core/procurement/sales_order.handlers.ts`
- `supabase/functions/api/_routes/procurement.routes.ts`

**BE (create):**
- `supabase/functions/api/_core/procurement/number_series.handlers.ts`

**FE (modify):**
- `frontend/src/admin/sa/screens/SAOmNumberSeries.jsx` ← full rebuild
- `frontend/src/pages/dashboard/procurement/procurementApi.js` ← add 6 functions

---

## Critical Points

- **Global docs** (GRN, GE, GEX, GXO, QA, DC, RTV, DN, EXR, IV, LC, SO, CSN, SALES_INVOICE) → `erp_procurement.generate_doc_number(p_doc_type)` → pure padded number e.g. `000047`
- **PO + STO** → `erp_procurement.generate_company_doc_number(p_company_id, p_doc_type)` → `prefix/FY/padded` e.g. `PO/CMP003/25-26/00001`
- FY format: `25-26`, `26-27` (2-digit year, April start)
- STO: pass `sending_company_id` as `p_company_id`
- SA prefix = free text input, no format enforcement
- "Edit Starting" on global series → only allowed if `last_number = 0`
- All 6 SA routes → assert SA role → 403 if not SA
- `generate_company_doc_number()` → SECURITY DEFINER, GRANT service_role only
- Drop `generate_invoice_number()` function, keep `invoice_number_series` table (audit)

## After Implementation

Update `OM-IMPLEMENTATION-LOG.md`:
- Gate-18 section, items 18.1–18.3 → DONE
