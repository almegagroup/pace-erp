# OM-GATE-17.7 — RTV + Debit Note + Exchange Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.7
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.7 VERIFIED ✅ + Gate-17.6 VERIFIED ✅
**Design Reference:** Section 98 (RTV), Section 98.5 (settlement modes)

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/rtv/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add RTV functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY |
| `frontend/src/router/AppRouter.jsx` | MODIFY |

---

## 3. `procurementApi.js` — Functions to Add

```javascript
export const listRTVs               = (params) => fetchProcurement('GET',  '/api/procurement/rtvs', null, params)
export const getRTV                 = (id)      => fetchProcurement('GET',  `/api/procurement/rtvs/${id}`)
export const createRTV              = (data)    => fetchProcurement('POST', '/api/procurement/rtvs', data)
export const addRTVLine             = (id, data)=> fetchProcurement('POST', `/api/procurement/rtvs/${id}/lines`, data)
export const postRTV                = (id)      => fetchProcurement('POST', `/api/procurement/rtvs/${id}/post`)
export const listDebitNotes         = (params) => fetchProcurement('GET',  '/api/procurement/debit-notes', null, params)
export const getDebitNote           = (id)      => fetchProcurement('GET',  `/api/procurement/debit-notes/${id}`)
export const createDebitNote        = (data)    => fetchProcurement('POST', '/api/procurement/debit-notes', data)
export const markDebitNoteSent      = (id)      => fetchProcurement('POST', `/api/procurement/debit-notes/${id}/mark-sent`)
export const acknowledgeDebitNote   = (id)      => fetchProcurement('POST', `/api/procurement/debit-notes/${id}/acknowledge`)
export const settleDebitNote        = (id)      => fetchProcurement('POST', `/api/procurement/debit-notes/${id}/settle`)
export const listExchangeRefs       = (params) => fetchProcurement('GET',  '/api/procurement/exchange-refs', null, params)
export const createExchangeRef      = (data)    => fetchProcurement('POST', '/api/procurement/exchange-refs', data)
export const linkReplacementGRN     = (id, data)=> fetchProcurement('PUT',  `/api/procurement/exchange-refs/${id}/link-grn`, data)
```

---

## 4. Screen Specs

### `RTVListPage.jsx`
- Route: `/dashboard/procurement/rtvs`
- Columns: rtv_number, vendor_name, grn_number, reason_category, settlement_mode badge, status badge, created_at
- Filters: company_id, status, vendor_id, settlement_mode
- Settlement mode badges: DEBIT_NOTE (blue), NEXT_INVOICE_ADJUST (amber), EXCHANGE (purple)

### `RTVCreatePage.jsx`
- Route: `/dashboard/procurement/rtvs/create`
- **Step 1 — GRN selection:** Search/select GRN to return against. Shows: grn_number, vendor, material, received_qty, date.
- **Header fields:** reason_category dropdown (SHORT_RECEIVED/QUALITY_REJECTION/WRONG_MATERIAL/DAMAGED/EXCESS/OTHER), settlement_mode dropdown, remarks
- **Lines section:** Per line: grn_line_id (auto from GRN selection), return_qty (max = available BLOCKED qty), uom (read-only)
- Submit → createRTV + addRTVLine for each line → navigate to RTVDetailPage

### `RTVDetailPage.jsx`
- Route: `/dashboard/procurement/rtvs/:id`
- Load via `getRTV`
- **RTV header** (vendor, grn, reason, settlement_mode, status)
- **Lines table** (material, return_qty, uom, po_rate)
- **Action buttons:**
  - DRAFT: "Post RTV" button → confirm dialog → postRTV. After post: shows Gate Exit number auto-generated.
  - DISPATCHED + settlement_mode=DEBIT_NOTE: "Create Debit Note" button → inline DN form
  - DISPATCHED + settlement_mode=EXCHANGE: "Create Exchange Reference" button → inline EXR form
  - DISPATCHED + settlement_mode=NEXT_INVOICE_ADJUST: info banner "Pending credit tracked on next IV for this vendor"
- **Debit Note section** (if DN created): Shows DN number, value breakdown, status badge. Action buttons: Mark Sent → Acknowledge → Settle.
- **Exchange Reference section** (if EXR created): Shows exchange_ref_number, status. "Link Replacement GRN" button when replacement arrives.

---

## 5. Critical UI Rules

| Rule | Detail |
|---|---|
| Return qty max | Return qty input: max = BLOCKED stock qty for this material. Show available BLOCKED qty as hint. |
| Settlement mode drives actions | After RTV posted: show relevant action based on settlement_mode only. |
| Debit Note value breakdown | Show: Material Value + Freight Value + Other LC = Total. Read-only display. |
| Confirm dialogs | Post RTV confirmation: "Stock will be returned to vendor (P122 movement)." |
| NEXT_INVOICE_ADJUST tracking | Show "Pending Credit: ₹[amount]" on vendor's future IV screen. (Info only in this screen.) |

---

## 6. Navigation Updates

### `operationScreens.js` — Add:
```javascript
PROC_RTV_LIST:   { name: 'PROC_RTV_LIST',   label: 'Return to Vendor', path: '/dashboard/procurement/rtvs' },
PROC_RTV_CREATE: { name: 'PROC_RTV_CREATE', label: 'Create RTV',       path: '/dashboard/procurement/rtvs/create' },
```

### `AppRouter.jsx` — Add 3 routes (list, create, detail)

---

## 7. Verification — Claude Will Check

1. RTVCreatePage shows GRN selection step before header fields
2. Return qty max = available BLOCKED qty (shown as hint)
3. Post RTV shows Gate Exit number in success response
4. Settlement mode controls which action buttons appear after dispatch
5. Debit Note section shows material + freight breakdown
6. Exchange Reference section has "Link Replacement GRN" when PENDING
7. All 14 API functions added to procurementApi.js

---

*Spec frozen: 2026-05-12 | Reference: Section 98, Section 98.5*
