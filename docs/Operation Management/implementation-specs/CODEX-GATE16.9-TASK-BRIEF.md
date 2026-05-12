# CODEX TASK BRIEF — Gate-16.9 Sales Order + Sales Invoice Backend

**Gate:** 16.9
**Spec File:** OM-GATE-16.9-SalesOrderBackend-Spec.md
**Dependency:** Gate-16.6 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.9-SalesOrderBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/sales_order.handlers.ts`
2. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add SO + Sales Invoice routes

## What to Build

Handlers: `createSOHandler`, `listSOsHandler`, `getSOHandler`, `updateSOHandler`, `cancelSOHandler`, `issueSOStockHandler`, `knockOffSOLineHandler`, `createSalesInvoiceHandler`, `listSalesInvoicesHandler`, `getSalesInvoiceHandler`, `postSalesInvoiceHandler`

## Critical Business Logic

**createSOHandler:**
- so_number = `generate_doc_number('SO')`
- Validate each line: fetch material from `erp_master.material_master` WHERE id = material_id. Check material_type IN ('RM','PM') → else 400 with message "Only RM/PM materials allowed in Sales Order"
- Compute net_rate = rate × (1 - discount_pct / 100)
- Initial line.balance_qty = quantity

**issueSOStockHandler (core):**
1. For each issue line: check stock_snapshot qty >= qty → else 400 INSUFFICIENT_STOCK
2. Call `post_stock_movement()` (SALES_ISSUE, OUT, UNRESTRICTED)
3. Update SO line: issued_qty += qty, balance_qty -= qty. Set line_status.
4. Auto-create delivery_challan (dc_type='SALES', so_id) with dc_number = `generate_doc_number('DC')`
5. Auto-create gate_exit_outbound (exit_type='SALES', so_id, dc_id) with gxo_number = `generate_doc_number('GXO')`
6. Update SO header status: CREATED → ISSUED if first issue

**createSalesInvoiceHandler:**
- invoice_number = `generate_invoice_number()` (YYYYMM format — NOT generate_doc_number)
- Derive gst_type: fetch company.state + customer.state from erp_master. Same → CGST_SGST, different → IGST
- gst_type CHECK IN ('CGST_SGST','IGST') — NEVER 'NONE' on sales invoices

**postSalesInvoiceHandler:**
- Compute per line: taxable_value = qty × rate
- CGST_SGST: cgst = gst/2, sgst = gst/2, igst = NULL
- IGST: igst = gst, cgst = NULL, sgst = NULL
- line_total = taxable_value + gst_amount
- Compute header totals

## After Implementation — Update Log
Set Gate-16.9 items to DONE.

---
*Brief frozen: 2026-05-12*
