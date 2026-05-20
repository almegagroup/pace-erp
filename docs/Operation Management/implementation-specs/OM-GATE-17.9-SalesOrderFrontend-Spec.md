# OM-GATE-17.9 — Sales Order + Sales Invoice Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.9
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.9 VERIFIED ✅ + Gate-17.8 VERIFIED ✅
**Design Reference:** Section 97 (Sales Order), Section 99 (Invoice), Section 87.17 (scope)

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/sales/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add SO + Invoice functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY |
| `frontend/src/router/AppRouter.jsx` | MODIFY |

---

## 3. `procurementApi.js` — Functions to Add

```javascript
export const listSalesOrders        = (params) => fetchProcurement('GET',  '/api/procurement/sales-orders', null, params)
export const getSalesOrder          = (id)      => fetchProcurement('GET',  `/api/procurement/sales-orders/${id}`)
export const createSalesOrder       = (data)    => fetchProcurement('POST', '/api/procurement/sales-orders', data)
export const updateSalesOrder       = (id, data)=> fetchProcurement('PUT',  `/api/procurement/sales-orders/${id}`, data)
export const cancelSalesOrder       = (id, data)=> fetchProcurement('POST', `/api/procurement/sales-orders/${id}/cancel`, data)
export const issueSOStock           = (id, data)=> fetchProcurement('POST', `/api/procurement/sales-orders/${id}/issue`, data)
export const knockOffSOLine         = (id, lineId, data) => fetchProcurement('POST', `/api/procurement/sales-orders/${id}/lines/${lineId}/knock-off`, data)
export const listSalesInvoices      = (params) => fetchProcurement('GET',  '/api/procurement/sales-invoices', null, params)
export const getSalesInvoice        = (id)      => fetchProcurement('GET',  `/api/procurement/sales-invoices/${id}`)
export const createSalesInvoice     = (data)    => fetchProcurement('POST', '/api/procurement/sales-invoices', data)
export const postSalesInvoice       = (id)      => fetchProcurement('POST', `/api/procurement/sales-invoices/${id}/post`)
```

---

## 4. Screen Specs

### `SOListPage.jsx`
- Route: `/dashboard/procurement/sales-orders`
- Columns: so_number, customer_name, customer_po_number, so_date, status badge, total_value
- Status badges: CREATED (grey), ISSUED (blue), INVOICED (amber), CLOSED (green), CANCELLED (red)
- Filters: company_id, status, customer_id, date range

### `SOCreatePage.jsx`
- Route: `/dashboard/procurement/sales-orders/create`
- **Header fields:** company_id, customer_id (searchable dropdown from customer master), customer_po_number (mandatory), customer_po_date, delivery_address (pre-filled from customer master, editable), payment_term_id (dropdown), remarks
- **Lines section:** Per line: material_id (searchable — only RM/PM types shown), quantity, uom_code, rate, discount_pct (default 0), net_rate (auto = rate × (1 - disc/100)), gst_rate (auto from material master, editable), issue_storage_location_id (optional)
- Net value + GST per line shown auto
- Submit → createSalesOrder → navigate to SODetailPage

### `SODetailPage.jsx`
- Route: `/dashboard/procurement/sales-orders/:id`
- Load via `getSalesOrder`
- **Header info** (read-only)
- **Lines table:** material, quantity, issued_qty, balance_qty, line_status badge, rate, net_rate, total_value
- **Balance qty highlight:** If balance_qty > 0 → show as open/pending
- **Issue Stock Section** (CREATED or ISSUED status only):
  - Per line: qty_to_issue input (max = balance_qty), storage_location (pre-filled from SO line, editable)
  - "Issue Stock" button → confirm dialog → issueSOStock
  - After issue: shows DC number + GXO number auto-generated
- **Knock-off per line:** "Knock Off" button on lines with balance_qty > 0. Reason mandatory.
- **Cancel SO button** (CREATED only, all lines balance_qty must be 0 after issue=0)
- **Linked Invoices section:** Table of Sales Invoices for this SO. "Create Invoice" button.

### `SalesInvoiceListPage.jsx`
- Route: `/dashboard/procurement/sales-invoices`
- Columns: invoice_number, customer_name, invoice_date, dc_number (from dc_id), total_invoice_value, status badge, gst_type badge
- Filters: company_id, customer_id, status, date range

### `SalesInvoiceDetailPage.jsx`
- Route: `/dashboard/procurement/sales-invoices/:id` (also handles create via 'new')
- **Create flow:** Select DC (delivery challan). Loads DC lines auto. Review gst_type (shown as CGST_SGST or IGST — auto-derived, read-only). Lines with qty, rate, taxable_value, gst amounts shown.
- **Invoice summary:** total_taxable, GST breakdown, total_invoice_value
- **Action:** "Post Invoice" button (DRAFT only) → confirm → postSalesInvoice
- **Posted view:** Read-only. Print/download button (Phase-2).

---

## 5. Critical UI Rules

| Rule | Detail |
|---|---|
| RM/PM only filter | Material search in SOCreatePage: only show materials with type IN ('RM','PM'). Show note: "FG Sales not in scope." |
| net_rate auto-calc | On rate or discount_pct change: net_rate = rate × (1 - discount_pct / 100). Show computed value. |
| Issue qty max | issue qty input: max = balance_qty. Show max as placeholder. |
| gst_type derived | In SalesInvoiceDetailPage: gst_type shown as read-only label (CGST+SGST or IGST). Cannot be changed. |
| CGST/SGST split | If CGST_SGST: show two rows (CGST = total_gst/2, SGST = total_gst/2) in invoice summary. |
| DC auto-generated | After issue: info box "Delivery Challan [DC-XXXXX] and Gate Exit [GXO-XXXXX] auto-generated." |

---

## 6. Navigation Updates

### `operationScreens.js` — Add:
```javascript
PROC_SO_LIST:       { name: 'PROC_SO_LIST',       label: 'Sales Orders',    path: '/dashboard/procurement/sales-orders' },
PROC_SO_CREATE:     { name: 'PROC_SO_CREATE',     label: 'Create SO',       path: '/dashboard/procurement/sales-orders/create' },
PROC_INV_LIST:      { name: 'PROC_INV_LIST',      label: 'Sales Invoices',  path: '/dashboard/procurement/sales-invoices' },
```

### `AppRouter.jsx` — Add 5 routes (SO list, create, detail + Invoice list, detail)

---

## 7. Verification — Claude Will Check

1. SOCreatePage shows only RM/PM materials in dropdown
2. net_rate auto-computed from rate and discount_pct
3. Issue Stock section shows per-line qty input with max = balance_qty
4. After issue: DC and Gate Exit numbers shown in success message
5. SalesInvoiceDetailPage shows gst_type as read-only derived label
6. CGST/SGST split shown for intra-state invoices
7. All 11 API functions added to procurementApi.js
8. operationScreens.js updated, AppRouter.jsx updated

---

*Spec frozen: 2026-05-12 | Reference: Section 97, Section 99, Section 87.17*
