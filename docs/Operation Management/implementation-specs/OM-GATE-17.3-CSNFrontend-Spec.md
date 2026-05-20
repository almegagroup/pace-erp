# OM-GATE-17.3 — CSN Tracker + Alerts Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.3
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.3 VERIFIED ✅ + Gate-17.2 VERIFIED ✅
**Design Reference:** Section 88 (CSN), Section 89 (ETA), Section 90 (alerts)

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/csn/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx` | CREATE — main tracker view |
| `frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx` | CREATE — full CSN edit |
| `frontend/src/pages/dashboard/procurement/csn/CSNAlertsPage.jsx` | CREATE — alert tabs |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add CSN functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY |
| `frontend/src/router/AppRouter.jsx` | MODIFY |

---

## 3. `procurementApi.js` — CSN Functions to Add

```javascript
export const listCSNs                     = (params) => fetchProcurement('GET', '/api/procurement/csns', null, params)
export const getCSN                       = (id)      => fetchProcurement('GET', `/api/procurement/csns/${id}`)
export const updateCSN                    = (id, data)=> fetchProcurement('PUT', `/api/procurement/csns/${id}`, data)
export const createSubCSN                 = (id, data)=> fetchProcurement('POST', `/api/procurement/csns/${id}/sub-csns`, data)
export const deleteSubCSN                 = (id, subId)=> fetchProcurement('DELETE', `/api/procurement/csns/${id}/sub-csns/${subId}`)
export const markCSNInTransit             = (id, data)=> fetchProcurement('POST', `/api/procurement/csns/${id}/mark-in-transit`, data)
export const markCSNArrived               = (id, data)=> fetchProcurement('POST', `/api/procurement/csns/${id}/mark-arrived`, data)
export const getAllAlertCounts            = (params) => fetchProcurement('GET', '/api/procurement/alerts/counts', null, params)
export const getLCAlertList               = (params) => fetchProcurement('GET', '/api/procurement/alerts/lc', null, params)
export const getVesselBookingAlertList    = (params) => fetchProcurement('GET', '/api/procurement/alerts/vessel-booking', null, params)
export const getCSNTracker                = (params) => fetchProcurement('GET', '/api/procurement/tracker', null, params)
export const inlineUpdateCSN              = (id, data)=> fetchProcurement('PUT', `/api/procurement/tracker/${id}/inline`, data)
```

---

## 4. Screen Specs

### `CSNTrackerPage.jsx`
- Route: `/dashboard/procurement/csn-tracker`
- Full-width flat list table. Columns: csn_number, po_number, vendor_name, material_name, csn_type badge, status badge, qty, etd_origin, eta_plant, actual_arrival_date, lr_number, transporter_name
- **Alert badges at top of page:** 
  - "LC Alerts: N" (amber badge, loads getLCAlertList tab)
  - "Vessel Booking: N" (amber badge, loads getVesselBookingAlertList tab)
  - Load from `getAllAlertCounts` on page mount
- **Filters:** company_id, status, csn_type, date range, search by csn_number/vendor/material
- **Inline edit:** Click cell for lr_number, transporter, eta fields → inline edit, save via `inlineUpdateCSN`
- **Row click:** Navigate to CSNDetailPage

### `CSNDetailPage.jsx`
- Route: `/dashboard/procurement/csns/:id`
- Load via `getCSN`
- **Sections:**
  1. Header: CSN number, type, status, linked PO, linked GE, linked GRN (read-only links)
  2. Import fields (shown only if csn_type='IMPORT'): vessel_name, bl_number, etd_origin, eta_destination_port, eta_plant, lc_required flag, lc_number, lc_opened_date
  3. Domestic fields (shown only if csn_type='DOMESTIC'): lr_date, lr_number, transporter_id dropdown
  4. Bulk fields (shown only if csn_type='BULK'): simplified fields
  5. Sub CSNs section: list of sub-CSNs with "Add Sub CSN" form. Delete button per sub-CSN.
  6. Status action buttons: "Mark In Transit" / "Mark Arrived" (based on current status)
- All editable fields save via `updateCSN`

### `CSNAlertsPage.jsx`
- Route: `/dashboard/procurement/csn-alerts`
- Two tabs: **LC Alerts** | **Vessel Booking Alerts**
- LC Alerts tab: Table of CSNs needing LC (csn_number, vendor, material, eta_destination_port, days_until_deadline). Link to CSNDetailPage to fill lc_number.
- Vessel Booking tab: Table of CSNs missing vessel booking (csn_number, vendor, po_date, days_overdue). Link to CSNDetailPage to fill vessel_booking_confirmed_date.

---

## 5. Navigation Updates

### `operationScreens.js` — Add:
```javascript
PROC_CSN_TRACKER: { name: 'PROC_CSN_TRACKER', label: 'Consignment Tracker', path: '/dashboard/procurement/csn-tracker' },
PROC_CSN_ALERTS:  { name: 'PROC_CSN_ALERTS',  label: 'CSN Alerts',         path: '/dashboard/procurement/csn-alerts' },
```

### `AppRouter.jsx` — Add 3 routes (tracker, detail, alerts)

---

## 6. Critical UI Rules

| Rule | Detail |
|---|---|
| Import/Domestic/Bulk conditional fields | Show relevant field groups based on csn_type |
| Alert count badges | Load on page mount via getAllAlertCounts. Refresh on filter change. |
| Inline edit | Only editable on ORDERED/IN_TRANSIT status CSNs. ARRIVED/GRN_DONE rows = read-only. |
| Sub CSN delete guard | Show delete button only if sub-CSN has no linked GE. |
| Mother CSN label | If csn has mother_csn_id: show "Sub CSN of [mother_csn_number]" at top of detail page. |

---

## 7. Verification — Claude Will Check

1. CSNTrackerPage shows LC and Vessel Booking alert counts from `getAllAlertCounts`
2. Inline edit cells present for lr_number, transporter, eta fields
3. CSNDetailPage shows correct conditional field groups per csn_type
4. CSNDetailPage has Sub CSNs section with add + delete
5. CSNAlertsPage has two tabs with correct data
6. All 12 API functions added to procurementApi.js
7. Routes added to AppRouter.jsx

---

*Spec frozen: 2026-05-12 | Reference: Sections 88, 89, 90*
