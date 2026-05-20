# OM-GATE-17.2 — Purchase Order Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.2
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.2 VERIFIED ✅ + Gate-17.1 VERIFIED ✅ (procurementApi.js exists)
**Design Reference:** Section 85.2, Section 87.2–87.12

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/po/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/po/POListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add PO API functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY — add PO screen entries |
| `frontend/src/router/AppRouter.jsx` | MODIFY — add PO routes |

---

## 3. `procurementApi.js` — PO Functions to Add

```javascript
export const listPurchaseOrders     = (params) => fetchProcurement('GET',  '/api/procurement/purchase-orders', null, params)
export const getPurchaseOrder       = (id)      => fetchProcurement('GET',  `/api/procurement/purchase-orders/${id}`)
export const createPurchaseOrder    = (data)    => fetchProcurement('POST', '/api/procurement/purchase-orders', data)
export const updatePurchaseOrder    = (id, data)=> fetchProcurement('PUT',  `/api/procurement/purchase-orders/${id}`, data)
export const confirmPurchaseOrder   = (id)      => fetchProcurement('POST', `/api/procurement/purchase-orders/${id}/confirm`)
export const approvePurchaseOrder   = (id, data)=> fetchProcurement('POST', `/api/procurement/purchase-orders/${id}/approve`, data)
export const rejectPurchaseOrder    = (id, data)=> fetchProcurement('POST', `/api/procurement/purchase-orders/${id}/reject`, data)
export const amendPurchaseOrder     = (id, data)=> fetchProcurement('PUT',  `/api/procurement/purchase-orders/${id}/amend`, data)
export const approveAmendment       = (id)      => fetchProcurement('POST', `/api/procurement/purchase-orders/${id}/approve-amendment`)
export const cancelPurchaseOrder    = (id, data)=> fetchProcurement('POST', `/api/procurement/purchase-orders/${id}/cancel`, data)
export const knockOffPOLine         = (id, lineId, data) => fetchProcurement('POST', `/api/procurement/purchase-orders/${id}/lines/${lineId}/knock-off`, data)
export const knockOffPO             = (id, data)=> fetchProcurement('POST', `/api/procurement/purchase-orders/${id}/knock-off`, data)
```

---

## 4. Screen Specs

### `POListPage.jsx`
- Route: `/dashboard/procurement/purchase-orders`
- Table columns: po_number, vendor_name, company_name, po_date, status, total_value, created_by
- Filters: status dropdown, date range, vendor search
- Status badges: DRAFT (grey), PENDING_APPROVAL (amber), CONFIRMED (blue), CLOSED (green), CANCELLED (red)
- Actions: "Create PO" button → POCreatePage. Click row → PODetailPage.

### `POCreatePage.jsx`
- Route: `/dashboard/procurement/purchase-orders/create`
- **Header fields:** company_id (dropdown), vendor_id (searchable dropdown — load from vendor list), delivery_type (STANDARD/BULK/TANKER), incoterm (shown only if delivery_type from IMPORT vendors), payment_term_id (dropdown from payment terms master, pre-filled with last-used), freight_term dropdown, remarks
- **Lines section:** Add/remove lines. Per line: material_id (searchable dropdown, RM/PM only note), quantity, uom_code, rate, cost_center_id (dropdown from cost center master), delivery_date, indent_reference (if vendor requires)
- Net value = qty × rate shown per line
- Submit → createPurchaseOrder → on success navigate to PODetailPage

### `PODetailPage.jsx`
- Route: `/dashboard/procurement/purchase-orders/:id`
- Load via getPurchaseOrder
- **Sections:**
  1. Header info (read-only display)
  2. Lines table with status badges per line
  3. CSNs linked (list of CSN numbers → CSN detail link)
  4. Approval Log (append-only table)
  5. Amendment Log (append-only table)
  6. GRN summary (total ordered qty vs total received qty per line)
- **Action buttons (conditional on status):**
  - DRAFT: "Confirm" button → confirmPurchaseOrder
  - PENDING_APPROVAL: "Approve" / "Reject" buttons (shown only to PROC_HEAD role)
  - CONFIRMED: "Amend" button → opens amendment form. "Cancel PO" button. "Knock-off" per line.
  - PENDING_AMENDMENT: "Approve Amendment" button (PROC_HEAD only)
- **Amendment form (inline modal):** Only editable fields: rate (per line), qty (per line), delivery_date, remarks. Rate/qty change shows warning: "Approval required"

---

## 5. Navigation Updates

### `operationScreens.js` — Add entries:
```javascript
PROC_PO_LIST:   { name: 'PROC_PO_LIST',   label: 'Purchase Orders', path: '/dashboard/procurement/purchase-orders' },
PROC_PO_CREATE: { name: 'PROC_PO_CREATE', label: 'Create PO',       path: '/dashboard/procurement/purchase-orders/create' },
```

### `AppRouter.jsx` — Add:
```jsx
import POListPage   from ".../po/POListPage.jsx"
import POCreatePage from ".../po/POCreatePage.jsx"
import PODetailPage from ".../po/PODetailPage.jsx"

<Route path="/dashboard/procurement/purchase-orders"         element={<POListPage />} />
<Route path="/dashboard/procurement/purchase-orders/create"  element={<POCreatePage />} />
<Route path="/dashboard/procurement/purchase-orders/:id"     element={<PODetailPage />} />
```

---

## 6. Critical UI Rules

| Rule | Detail |
|---|---|
| Incoterm conditional | Show incoterm field ONLY for import POs. Domestic = hide. |
| Approve/Reject buttons | Shown only to users with roleCode = PROC_HEAD or SA. Hidden for others. |
| ASL warning | On vendor+material selection: show warning if no approved VMI record exists (check on blur). |
| Status transitions | Buttons shown based on current status only. Read the status → show relevant buttons. |
| Amendment warning | When rate or qty field changed: show inline text "Amendment will require Procurement Head approval" |
| No useNavigate violations | Only use navigate() for programmatic redirect, not for link rendering (use `<a href>` or Link). |

---

## 7. Verification — Claude Will Check

1. POCreatePage has all required header fields (company, vendor, delivery_type, payment_term, freight_term)
2. POCreatePage lines include cost_center_id
3. PODetailPage shows Approve/Reject only to PROC_HEAD
4. PODetailPage shows all 5 sections (header, lines, CSNs, approval log, amendment log)
5. Amendment form shows only editable fields (rate, qty, delivery_date, remarks)
6. All 12 API functions added to procurementApi.js
7. operationScreens.js updated, existing entries untouched
8. AppRouter.jsx has 3 routes, existing routes untouched

---

*Spec frozen: 2026-05-12 | Reference: Sections 85.2, 87.2–87.12*
