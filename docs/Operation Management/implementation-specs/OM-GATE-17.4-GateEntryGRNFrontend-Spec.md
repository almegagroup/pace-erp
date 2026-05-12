# OM-GATE-17.4 — Gate Entry + GRN Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.4
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.4 VERIFIED ✅ + Gate-17.3 VERIFIED ✅
**Design Reference:** Section 88.1 (GE), Section 87.7 (weighbridge), Section 93 (GRN), Section 102 (Gate Exit)

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/gate/`
`frontend/src/pages/dashboard/procurement/grn/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/gate/GateEntryListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/gate/GateEntryCreatePage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/gate/GateEntryDetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/grn/GRNListPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx` | CREATE |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add GE + GRN functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY |
| `frontend/src/router/AppRouter.jsx` | MODIFY |

---

## 3. `procurementApi.js` — Functions to Add

```javascript
export const listGateEntries        = (params) => fetchProcurement('GET',  '/api/procurement/gate-entries', null, params)
export const getGateEntry           = (id)      => fetchProcurement('GET',  `/api/procurement/gate-entries/${id}`)
export const createGateEntry        = (data)    => fetchProcurement('POST', '/api/procurement/gate-entries', data)
export const updateGateEntry        = (id, data)=> fetchProcurement('PUT',  `/api/procurement/gate-entries/${id}`, data)
export const listOpenCSNsForGE      = (params) => fetchProcurement('GET',  '/api/procurement/gate-entries/open-csns', null, params)
export const createGateExitInbound  = (data)    => fetchProcurement('POST', '/api/procurement/gate-exits/inbound', data)
export const getGateExitInbound     = (id)      => fetchProcurement('GET',  `/api/procurement/gate-exits/inbound/${id}`)
export const listGRNs               = (params) => fetchProcurement('GET',  '/api/procurement/grns', null, params)
export const getGRN                 = (id)      => fetchProcurement('GET',  `/api/procurement/grns/${id}`)
export const createGRNDraft         = (data)    => fetchProcurement('POST', '/api/procurement/grns', data)
export const updateGRNDraft         = (id, data)=> fetchProcurement('PUT',  `/api/procurement/grns/${id}`, data)
export const postGRN                = (id)      => fetchProcurement('POST', `/api/procurement/grns/${id}/post`)
export const reverseGRN             = (id, data)=> fetchProcurement('POST', `/api/procurement/grns/${id}/reverse`, data)
```

---

## 4. Screen Specs

### `GateEntryListPage.jsx`
- Columns: ge_number, entry_date, vehicle_number, status, num_lines, total_qty
- Filters: company_id, status (OPEN/CLOSED), date range
- "Create GE" button

### `GateEntryCreatePage.jsx`
- Route: `/dashboard/procurement/gate-entries/create`
- **Header fields:** company_id, entry_date (allows backdating — date picker, no restriction), vehicle_number, driver_name, gate_staff_id
- **For BULK/TANKER:** gross_weight field (mandatory — show warning if material on any line requires weighbridge)
- **Lines section:** Add/remove lines. Per line:
  - CSN searchable dropdown (loads from `listOpenCSNsForGE` for selected company)
  - On CSN select: auto-fills po_number, material_name, vendor_name, expected_qty (read-only)
  - invoice_number, invoice_date (vendor's invoice details)
  - received_qty (entered by gate staff)

### `GateEntryDetailPage.jsx`
- Route: `/dashboard/procurement/gate-entries/:id`
- Display GE header + lines (read-only if CLOSED)
- **Gate Exit section:** If no Gate Exit exists AND GE is OPEN: show "Create Gate Exit" form
  - Gate Exit form: tare_weight (mandatory for BULK/TANKER), net_weight_override (optional)
  - Submit via `createGateExitInbound`
  - After Gate Exit created: show calculated net_weight
- **GRN section:** If Gate Exit exists: "Create GRN" button → GRNDetailPage (creates draft)

### `GRNListPage.jsx`
- Columns: grn_number, grn_date, vendor_name, ge_number, status badge, total_qty
- Filters: company_id, status, vendor_id, date range
- Row click → GRNDetailPage

### `GRNDetailPage.jsx`
- Route: `/dashboard/procurement/grns/:id`
- Load via `getGRN` or `createGRNDraft` (from GE detail)
- **Lines table:** ge_qty (read-only), received_qty (editable in DRAFT), discrepancy (auto = ge_qty - received_qty, shown in red if non-zero), storage_location_id (required), batch_number (shown only if material has batch tracking), expiry_date (shown only if expiry tracking on)
- **Stock type column:** Shows QA_STOCK or UNRESTRICTED (auto from material master) — read-only indicator
- **BULK/TANKER note:** received_qty pre-filled from net_weight. Editable.
- **Action buttons:**
  - DRAFT: "Post GRN" button → confirm dialog → postGRN
  - POSTED: "Reverse GRN" button → reason input → reverseGRN (with confirmation)
- Post GRN shows success message with stock movement summary

---

## 5. Critical UI Rules

| Rule | Detail |
|---|---|
| Backdating | GE entry_date: date picker with no min/max restriction. System timestamp note shown. |
| Weighbridge mandatory | If any GE line's material has weighbridge_required=true: gross_weight field required on submit |
| Gate Exit before GRN | "Create GRN" button only appears after Gate Exit exists |
| QA_STOCK indicator | Show QA badge on line if stock will go to QA_STOCK. Stores user info only — cannot change. |
| Post confirmation | "Post GRN" triggers confirm dialog: "This will post stock movement. Cannot be undone without reversal." |
| Discrepancy highlight | If discrepancy != 0: highlight row in amber. Show discrepancy value. |

---

## 6. Verification — Claude Will Check

1. GateEntryCreatePage loads open CSNs filtered by company
2. BULK/TANKER gross_weight field present and required conditionally
3. GateEntryDetailPage shows Gate Exit form only if no Gate Exit exists
4. GateExitInbound tare_weight mandatory for BULK/TANKER
5. GRNDetailPage shows discrepancy column (ge_qty - received_qty)
6. GRNDetailPage shows QA_STOCK indicator per line
7. Post GRN confirmation dialog present
8. All 14 API functions added to procurementApi.js

---

*Spec frozen: 2026-05-12 | Reference: Sections 88.1, 87.7, 87.8, 93, 102*
