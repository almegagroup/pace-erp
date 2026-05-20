# CODEX TASK BRIEF — Gate-17.9 Sales Order + Sales Invoice Frontend

**Gate:** 17.9
**Spec File:** OM-GATE-17.9-SalesOrderFrontend-Spec.md
**Dependency:** Gate-16.9 VERIFIED ✅ + Gate-17.8 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.9-SalesOrderFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx`
3. CREATE `frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx`
4. CREATE `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx`
5. CREATE `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx`
6. MODIFY `procurementApi.js` — add 11 SO + Sales Invoice functions
7. MODIFY `operationScreens.js` — add 3 entries
8. MODIFY `AppRouter.jsx` — add 5 routes

## Critical Points

- **SOCreatePage material filter:** Only show RM/PM material types in dropdown. Add note: "FG Sales not in scope." Validation on submit: reject if non-RM/PM material.
- **net_rate auto-calc:** Compute in real-time: `net_rate = rate × (1 - discount_pct / 100)`. Show as read-only computed field.
- **Issue Stock section:** Per-line qty input. Max = balance_qty (show as placeholder). Stock issue requires NO approval.
- **After issue:** Response must include dc_number and gxo_number. Show: "Delivery Challan [DC-XXXXX] and Gate Exit [GXO-XXXXX] auto-generated."
- **SalesInvoiceDetailPage:** `gst_type` is READ-ONLY derived label (cannot be changed). Show CGST + SGST breakdown for intra-state; IGST for inter-state.
- **Linked Invoices section** on SODetailPage: list of invoices for this SO. "Create Invoice" button → SalesInvoiceDetailPage with so_id pre-filled.

## After Implementation — Update Log
Set Gate-17.9 items to DONE.

---
*Brief frozen: 2026-05-12*
