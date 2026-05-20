# OM-GATE-17.6 — STO + Delivery Challan Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.6
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.6 VERIFIED ✅ + Gate-17.5 VERIFIED ✅
**Design Reference:** Section 92 (STO), Section 88.4 (Sub CSN → STO transform)

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/sto/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/sto/STOListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/sto/STOCreatePage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add STO functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY |
| `frontend/src/router/AppRouter.jsx` | MODIFY |

---

## 3. `procurementApi.js` — Functions to Add

```javascript
export const listSTOs                  = (params) => fetchProcurement('GET',  '/api/procurement/stos', null, params)
export const getSTO                    = (id)      => fetchProcurement('GET',  `/api/procurement/stos/${id}`)
export const createSTO                 = (data)    => fetchProcurement('POST', '/api/procurement/stos', data)
export const updateSTO                 = (id, data)=> fetchProcurement('PUT',  `/api/procurement/stos/${id}`, data)
export const cancelSTO                 = (id, data)=> fetchProcurement('POST', `/api/procurement/stos/${id}/cancel`, data)
export const dispatchSTO               = (id)      => fetchProcurement('POST', `/api/procurement/stos/${id}/dispatch`)
export const updateGateExitWeight      = (id, data)=> fetchProcurement('PUT',  `/api/procurement/gate-exits/outbound/${id}/weight`, data)
export const confirmSTOReceipt         = (id)      => fetchProcurement('POST', `/api/procurement/stos/${id}/confirm-receipt`)
export const closeSTO                  = (id)      => fetchProcurement('POST', `/api/procurement/stos/${id}/close`)
export const transformSubCSNToSTO      = (csnId, data) => fetchProcurement('POST', `/api/procurement/csns/${csnId}/transform-to-sto`, data)
```

---

## 4. Screen Specs

### `STOListPage.jsx`
- Route: `/dashboard/procurement/stos`
- Columns: sto_number, sto_type badge, sending_company, receiving_company, status badge, total_qty, created_at
- **Both sending and receiving company see STOs** (filter: company_id shows both)
- Sending company: STO in "Outbound" section
- Receiving company: STO in "Inbound" section (or tab toggle: MY OUTBOUND | MY INBOUND)
- Filters: status, sto_type, date range

### `STOCreatePage.jsx`
- Route: `/dashboard/procurement/stos/create`
- Fields: sto_type (CONSIGNMENT_DISTRIBUTION/INTER_PLANT), sending_company_id, receiving_company_id, remarks
- Lines: material_id (searchable), quantity, uom_code, transfer_price (last-used pre-filled)
- Submit → createSTO → navigate to STODetailPage

### `STODetailPage.jsx`
- Route: `/dashboard/procurement/stos/:id`
- Load via `getSTO`
- **STO header info** (read-only after CREATED)
- **Lines table** with issued_qty, balance_qty columns
- **Status + Action buttons:**
  - CREATED: "Dispatch" button → confirm dialog (shows stock availability) → dispatchSTO
  - After dispatch: shows DC number (auto-generated) + Gate Exit number
  - BULK/TANKER: "Add Tare Weight" form appears after dispatch (for gate exit weight entry)
  - DISPATCHED: "Confirm Receipt" button (for receiving company) → confirmSTOReceipt
  - RECEIVED: "Close STO" button → closeSTO
  - CREATED: "Cancel" button → reason input → cancelSTO
- **Dispatch result section** (after DISPATCHED): DC number, GXO number, dispatch_date

---

## 5. Critical UI Rules

| Rule | Detail |
|---|---|
| Role-based actions | Dispatch: sending company Stores user only. Confirm Receipt: receiving company Stores user only. |
| BULK/TANKER weight | After dispatch: show "Add Tare Weight" section. net_weight = gross - tare auto-shown. |
| DC auto-generated notice | After dispatch: info box "Delivery Challan DC-XXXXX auto-generated." Link to DC. |
| Stock check warning | Before dispatch: show available stock qty. If insufficient → show warning on confirm dialog. |
| Sub CSN transform | From CSN detail page (Gate-17.3): "Transform to STO" button links here via transformSubCSNToSTO. |

---

## 6. Navigation Updates

### `operationScreens.js` — Add:
```javascript
PROC_STO_LIST:   { name: 'PROC_STO_LIST',   label: 'Stock Transfers', path: '/dashboard/procurement/stos' },
PROC_STO_CREATE: { name: 'PROC_STO_CREATE', label: 'Create STO',      path: '/dashboard/procurement/stos/create' },
```

### `AppRouter.jsx` — Add 3 routes (list, create, detail)

---

## 7. Verification — Claude Will Check

1. STOListPage shows STOs for BOTH sending and receiving company
2. Dispatch button shows confirm dialog with stock availability
3. After dispatch: DC and Gate Exit numbers shown
4. BULK/TANKER tare weight form appears after dispatch
5. Confirm Receipt only shown for receiving company context
6. All 10 API functions added to procurementApi.js

---

*Spec frozen: 2026-05-12 | Reference: Section 92, Section 88.4*
