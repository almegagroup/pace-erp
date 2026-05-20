# OM-GATE-17.1 — L2 Masters Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.1
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.1 VERIFIED ✅
**Design Reference:** Section 87.4 (Payment Terms), Section 89, Section 94, Section 95

---

## 1. What You Are Building

SA-managed screens for all L2 procurement masters. All screens follow the established L1 pattern (List + Create form, no separate detail page unless needed).

Screen files go in: `frontend/src/admin/sa/screens/`
API functions go in: `frontend/src/pages/dashboard/procurement/procurementApi.js` (NEW file)

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | CREATE — all API fetch functions for procurement module |
| `frontend/src/admin/sa/screens/SAPaymentTermsMaster.jsx` | CREATE |
| `frontend/src/admin/sa/screens/SAPortMaster.jsx` | CREATE |
| `frontend/src/admin/sa/screens/SAPortTransitMaster.jsx` | CREATE |
| `frontend/src/admin/sa/screens/SALeadTimeMasters.jsx` | CREATE — one screen with two tabs (Import / Domestic) |
| `frontend/src/admin/sa/screens/SATransporterMaster.jsx` | CREATE |
| `frontend/src/admin/sa/screens/SACHAMaster.jsx` | CREATE |
| `frontend/src/navigation/screens/adminScreens.js` | MODIFY — add 6 new SA screen entries |
| `frontend/src/router/AppRouter.jsx` | MODIFY — add 6 imports + 6 routes |

---

## 3. `procurementApi.js` — Initial Function Set

```javascript
// Base: /api/procurement/
// All use credentials: 'include', follow L1 omApi.js pattern

export const listPaymentTerms  = (params) => fetchProcurement('GET', '/api/procurement/payment-terms', null, params)
export const createPaymentTerm = (data)   => fetchProcurement('POST', '/api/procurement/payment-terms', data)
export const listPorts         = (params) => fetchProcurement('GET', '/api/procurement/ports', null, params)
export const createPort        = (data)   => fetchProcurement('POST', '/api/procurement/ports', data)
export const listTransitTimes  = (params) => fetchProcurement('GET', '/api/procurement/port-transit', null, params)
export const upsertTransitTime = (data)   => fetchProcurement('POST', '/api/procurement/port-transit', data)
export const listImportLeadTimes   = (params) => fetchProcurement('GET', '/api/procurement/lead-times/import', null, params)
export const upsertImportLeadTime  = (data)   => fetchProcurement('POST', '/api/procurement/lead-times/import', data)
export const listDomesticLeadTimes = (params) => fetchProcurement('GET', '/api/procurement/lead-times/domestic', null, params)
export const upsertDomesticLeadTime= (data)   => fetchProcurement('POST', '/api/procurement/lead-times/domestic', data)
export const listTransporters  = (params) => fetchProcurement('GET', '/api/procurement/transporters', null, params)
export const createTransporter = (data)   => fetchProcurement('POST', '/api/procurement/transporters', data)
export const listCHAs          = (params) => fetchProcurement('GET', '/api/procurement/chas', null, params)
export const createCHA         = (data)   => fetchProcurement('POST', '/api/procurement/chas', data)
export const mapCHAToPort      = (id, data) => fetchProcurement('POST', `/api/procurement/chas/${id}/ports`, data)
```

---

## 4. Screen Specs

### `SAPaymentTermsMaster.jsx`
- List: code, name, payment_method, reference_date, credit_days, lc_type, is_active
- Create form: name, payment_method (dropdown: CREDIT/ADVANCE/LC/TT/DA/DP/MIXED), reference_date (dropdown), credit_days, advance_pct, lc_type, usance_days, description, is_active toggle
- Code auto-generated (PT-001 pattern) — show after create

### `SAPortMaster.jsx`
- List: port_code, port_name, country, is_active
- Create form: port_code, port_name, country
- Inline edit: is_active toggle

### `SAPortTransitMaster.jsx`
- List: port_name, plant_name, transit_days
- Create/Edit: port_id dropdown, plant_id input (uuid), transit_days number input
- Uses upsert (same row updated if port+plant combo exists)

### `SALeadTimeMasters.jsx`
- Two tabs: IMPORT | DOMESTIC
- Import tab: list + upsert by (port_id, material_category_id) — lead_days for each stage
- Domestic tab: list + upsert by (plant_id, material_category_id) — transit_days

### `SATransporterMaster.jsx`
- List: transporter_code, name, direction (INBOUND/OUTBOUND/BOTH), contact, is_active
- Create form: name, direction dropdown, contact_person, contact_phone, gst_number
- Code auto-generated

### `SACHAMaster.jsx`
- List: cha_code, name, contact, is_active
- Create form: name, contact details
- Detail section: Port assignments — list ports + "Add Port" button (map CHA to port)

---

## 5. Navigation Updates

### `adminScreens.js` — Add entries:
```javascript
SA_PAYMENT_TERMS:   { name: 'SA_PAYMENT_TERMS',   label: 'Payment Terms',    path: '/admin/sa/payment-terms' },
SA_PORT_MASTER:     { name: 'SA_PORT_MASTER',      label: 'Port Master',      path: '/admin/sa/ports' },
SA_PORT_TRANSIT:    { name: 'SA_PORT_TRANSIT',     label: 'Port Transit',     path: '/admin/sa/port-transit' },
SA_LEAD_TIMES:      { name: 'SA_LEAD_TIMES',       label: 'Lead Times',       path: '/admin/sa/lead-times' },
SA_TRANSPORTERS:    { name: 'SA_TRANSPORTERS',     label: 'Transporters',     path: '/admin/sa/transporters' },
SA_CHA_MASTER:      { name: 'SA_CHA_MASTER',       label: 'CHA Master',       path: '/admin/sa/chas' },
```

### `AppRouter.jsx` — Add imports + routes:
```jsx
import SAPaymentTermsMaster  from ".../SAPaymentTermsMaster.jsx"
import SAPortMaster          from ".../SAPortMaster.jsx"
import SAPortTransitMaster   from ".../SAPortTransitMaster.jsx"
import SALeadTimeMasters     from ".../SALeadTimeMasters.jsx"
import SATransporterMaster   from ".../SATransporterMaster.jsx"
import SACHAMaster           from ".../SACHAMaster.jsx"

<Route path="/admin/sa/payment-terms" element={<SAPaymentTermsMaster />} />
<Route path="/admin/sa/ports"         element={<SAPortMaster />} />
<Route path="/admin/sa/port-transit"  element={<SAPortTransitMaster />} />
<Route path="/admin/sa/lead-times"    element={<SALeadTimeMasters />} />
<Route path="/admin/sa/transporters"  element={<SATransporterMaster />} />
<Route path="/admin/sa/chas"          element={<SACHAMaster />} />
```

---

## 6. Verification — Claude Will Check

1. `procurementApi.js` created with all 14 functions using credentials:'include'
2. All 6 screen files created with list + create form
3. Payment Terms create form has all 9 fields including lc_type and usance_days
4. Transporter list shows direction column
5. CHA screen has Port Assignments section (map + list)
6. Lead Times screen has Import/Domestic tabs
7. adminScreens.js has 6 new entries (existing entries untouched)
8. AppRouter.jsx has 6 imports + 6 routes (existing routes untouched)

---

*Spec frozen: 2026-05-12 | Reference: Sections 87.4, 89.4–89.8, 94, 95*
