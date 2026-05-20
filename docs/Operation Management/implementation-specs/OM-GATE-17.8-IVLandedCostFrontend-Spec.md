# OM-GATE-17.8 — Invoice Verification + Landed Cost Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.8
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.8 VERIFIED ✅ + Gate-17.7 VERIFIED ✅
**Design Reference:** Section 100 (IV), Section 87.9 (Landed Cost)

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/accounts/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add IV + LC functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY |
| `frontend/src/router/AppRouter.jsx` | MODIFY |

---

## 3. `procurementApi.js` — Functions to Add

```javascript
export const listIVs                = (params) => fetchProcurement('GET',  '/api/procurement/invoice-verifications', null, params)
export const getIV                  = (id)      => fetchProcurement('GET',  `/api/procurement/invoice-verifications/${id}`)
export const createIVDraft          = (data)    => fetchProcurement('POST', '/api/procurement/invoice-verifications', data)
export const addIVLine              = (id, data)=> fetchProcurement('POST', `/api/procurement/invoice-verifications/${id}/lines`, data)
export const removeIVLine           = (id, lineId) => fetchProcurement('DELETE', `/api/procurement/invoice-verifications/${id}/lines/${lineId}`)
export const runIVMatch             = (id)      => fetchProcurement('POST', `/api/procurement/invoice-verifications/${id}/run-match`)
export const postIV                 = (id)      => fetchProcurement('POST', `/api/procurement/invoice-verifications/${id}/post`)
export const listBlockedIVs         = (params) => fetchProcurement('GET',  '/api/procurement/invoice-verifications/blocked', null, params)
export const listLandedCosts        = (params) => fetchProcurement('GET',  '/api/procurement/landed-costs', null, params)
export const getLandedCost          = (id)      => fetchProcurement('GET',  `/api/procurement/landed-costs/${id}`)
export const createLandedCost       = (data)    => fetchProcurement('POST', '/api/procurement/landed-costs', data)
export const addLCLine              = (id, data)=> fetchProcurement('POST', `/api/procurement/landed-costs/${id}/lines`, data)
export const updateLCLine           = (id, lineId, data) => fetchProcurement('PUT', `/api/procurement/landed-costs/${id}/lines/${lineId}`, data)
export const deleteLCLine           = (id, lineId) => fetchProcurement('DELETE', `/api/procurement/landed-costs/${id}/lines/${lineId}`)
export const postLandedCost         = (id)      => fetchProcurement('POST', `/api/procurement/landed-costs/${id}/post`)
export const getLandedCostByGRN     = (grnId)   => fetchProcurement('GET',  `/api/procurement/landed-costs/by-grn/${grnId}`)
```

---

## 4. Screen Specs

### `IVListPage.jsx`
- Route: `/dashboard/procurement/accounts/invoice-verifications`
- Columns: iv_number, vendor_name, vendor_invoice_number, invoice_date, total_invoice_value, status badge
- Status badges: DRAFT (grey), MATCHED (green), BLOCKED (red), POSTED (blue)
- **Blocked IVs tab / section:** Highlight blocked IVs. Prompt action.
- Filters: company_id, vendor_id, status, date range

### `IVCreatePage.jsx`
- Route: `/dashboard/procurement/accounts/invoice-verifications/create`
- **Header:** company_id, vendor_id (searchable dropdown), vendor_invoice_number, vendor_invoice_date
- **Select GRN Lines:** Searchable by GRN number for same vendor. Each GRN line shows: material, grn_qty, po_rate, invoiced_qty (remaining). User enters invoice_qty and invoice_rate per line.
- **GST section per line:** gst_rate (auto from material master — editable), invoice_gst_amount (Accounts enters from physical invoice)
- Submit → createIVDraft + addIVLine for each line → navigate to IVDetailPage

### `IVDetailPage.jsx`
- Route: `/dashboard/procurement/accounts/invoice-verifications/:id`
- Load via `getIV`
- **IV header info**
- **Lines table:** material, grn_qty, invoice_qty, po_rate, invoice_rate, rate_variance_pct (highlighted red if >50%), match_status badge, taxable_value, gst_amount, gst_match_flag
- **Totals row:** total_taxable_value, total_gst_amount, total_invoice_value
- **Match Result banner:**
  - MATCHED: green banner "All lines within 50% tolerance — ready to post"
  - BLOCKED: red banner "One or more lines exceed 50% rate variance — cannot post until resolved"
- **Action buttons:**
  - DRAFT: "Run Match" button → runIVMatch → refreshes line statuses
  - MATCHED: "Post IV" button → confirm dialog → postIV
  - BLOCKED: No post button. Shows "Resolve variance or amend PO" message.
- "Add Line" / "Remove Line" buttons (DRAFT only)

### `LandedCostListPage.jsx`
- Route: `/dashboard/procurement/accounts/landed-costs`
- Columns: lc_number, lc_date, grn_number (if linked), vendor_name, total_cost, status badge
- Filters: company_id, status, date range

### `LandedCostDetailPage.jsx`
- Route: `/dashboard/procurement/accounts/landed-costs/:id` (also handles CREATE via route param = 'new')
- **Create new LC:** grn_id or csn_id (optional, either/both), vendor_id, lc_date, remarks
- **Lines table:** line_number, cost_type (dropdown), cha_id (shown only for CHA_CHARGES type), bill_reference, bill_date, amount
- "Add Line" / "Edit Line" / "Delete Line" buttons (DRAFT only)
- Total cost shown (sum of lines, updated on add/edit/delete)
- "Post LC" button → confirm dialog → postLandedCost

---

## 5. Critical UI Rules

| Rule | Detail |
|---|---|
| Rate variance highlight | If rate_variance_pct > 50: show cell in red. Show "BLOCKED" badge on line. |
| GST match flag | Show green check or red X next to invoice_gst_amount. |
| Add line validation | All GRN lines must be same vendor as IV header. Show vendor filter on GRN search. |
| Blocked IV dashboard | IVListPage: red count badge or separate tab for BLOCKED status. |
| LC retroactive | LC create: no restriction on lc_date. Note shown: "Can be entered any time after GRN." |
| CHA charges | LandedCost line: if cost_type = CHA_CHARGES, show CHA dropdown (from CHA master). |

---

## 6. Navigation Updates

### `operationScreens.js` — Add:
```javascript
PROC_IV_LIST: { name: 'PROC_IV_LIST', label: 'Invoice Verification', path: '/dashboard/procurement/accounts/invoice-verifications' },
PROC_LC_LIST: { name: 'PROC_LC_LIST', label: 'Landed Costs',         path: '/dashboard/procurement/accounts/landed-costs' },
```

### `AppRouter.jsx` — Add 5 routes (IV list, create, detail + LC list, detail)

---

## 7. Verification — Claude Will Check

1. IVDetailPage highlights rate_variance_pct > 50 in red
2. BLOCKED status shows red banner, no Post button
3. MATCHED status shows green banner + Post button
4. Run Match updates line match_status badges
5. LandedCostDetailPage shows CHA dropdown only for CHA_CHARGES type
6. LC create allows no date restriction (retroactive note shown)
7. All 16 API functions added to procurementApi.js

---

*Spec frozen: 2026-05-12 | Reference: Section 100, Section 87.9*
