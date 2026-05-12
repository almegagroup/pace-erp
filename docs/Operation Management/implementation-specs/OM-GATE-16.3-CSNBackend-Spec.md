# OM-GATE-16.3 — Consignment Note (CSN) Backend (TypeScript Handlers)
# PACE-ERP Operation Management — Procurement

**Gate:** 16.3
**Phase:** Operation Management — Layer 2 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.2 VERIFIED ✅
**Design Reference:** Section 88 (CSN full design), Section 89 (ETA cascade, lead times), Section 90 (LC + alerts)

---

## 1. What You Are Building

TypeScript handlers for Consignment Note management:
- CSN CRUD and status updates
- ETA cascade engine
- Mother/Sub CSN structure
- Alert generation (LC overdue, Vessel Booking missing)
- Single Window Tracker view

Create: `supabase/functions/api/_core/procurement/csn.handlers.ts`
Modify: `supabase/functions/api/_routes/procurement.routes.ts`

---

## 2. Handler List

Schema: `erp_procurement.consignment_note`

### CSN CRUD

| Function | Route | Description |
|---|---|---|
| `listCSNsHandler` | `GET:/api/procurement/csns` | List CSNs. Filters: company_id, status, csn_type, po_id, date range. Pagination. Returns header only (no lines). |
| `getCSNHandler` | `GET:/api/procurement/csns/:id` | Get full CSN with all fields + associated GE, GRN links |
| `updateCSNHandler` | `PUT:/api/procurement/csns/:id` | Update CSN fields. Status must be ORDERED or IN_TRANSIT. Cannot edit ARRIVED or GRN_DONE. On any date field update: recalculate ETA cascade (see below). |
| `createSubCSNHandler` | `POST:/api/procurement/csns/:id/sub-csns` | Create Sub CSN under Mother CSN. Sub CSN gets own csn_number, references mother_csn_id. Vessel/BL/ETA (pre-port) inherited from mother. |
| `deleteSubCSNHandler` | `DELETE:/api/procurement/csns/:id/sub-csns/:sub_id` | Delete Sub CSN. Only if status = ORDERED and no GE linked. |

### CSN Status Updates

| Function | Route | Description |
|---|---|---|
| `markCSNInTransitHandler` | `POST:/api/procurement/csns/:id/mark-in-transit` | ORDERED → IN_TRANSIT. Sets actual_etd if provided. |
| `markCSNArrivedHandler` | `POST:/api/procurement/csns/:id/mark-arrived` | IN_TRANSIT → ARRIVED. Sets actual_arrival_date. |

(GRN_DONE status is set automatically by the GRN post handler — not a manual action.)

### ETA Cascade Engine

ETA cascade recalculates automatically inside `updateCSNHandler` when any of these date fields change:
- Import cascade: `etd_origin` → `etd_port` → `eta_destination_port` → `eta_plant`
  - Uses `lead_time_master_import` for days between each stage
  - Formula: next_date = current_date + transit_days (from lead time master)
- Domestic cascade: `po_date` or `lr_date` → `eta_plant`
  - Uses `lead_time_master_domestic` transit_days

**Internal helper:** `calculateETACascade(csn, leadTimes): Partial<CSN>` — returns updated date fields. Called inside updateCSNHandler before DB save.

### Alert Queries

| Function | Route | Description |
|---|---|---|
| `getLCAlertCountHandler` | `GET:/api/procurement/alerts/lc-count` | Count of CSNs where: lc_required=true AND lc_opened_date IS NULL AND eta_destination_port <= today + 3 days. company_id filter. |
| `getLCAlertListHandler` | `GET:/api/procurement/alerts/lc` | Full list of CSNs triggering LC alert (same criteria as count). |
| `getVesselBookingAlertCountHandler` | `GET:/api/procurement/alerts/vessel-booking-count` | Count of CSNs where: csn_type=IMPORT AND vessel_booking_confirmed_date IS NULL AND po_date <= today - 3 days. |
| `getVesselBookingAlertListHandler` | `GET:/api/procurement/alerts/vessel-booking` | Full list for vessel booking alert. |
| `getAllAlertCountsHandler` | `GET:/api/procurement/alerts/counts` | Returns: { lc_alert: N, vessel_booking_alert: N } in one call. For dashboard badge. |

### Single Window Tracker

| Function | Route | Description |
|---|---|---|
| `getTrackerHandler` | `GET:/api/procurement/tracker` | Flat list of all CSNs with key tracking fields. Filters: company_id, status, csn_type, date range, vendor_id, material_category_id. Includes: po_number, vendor_name, material_name, csn_number, csn_type, status, etd_origin, eta_plant, actual_arrival_date, lr_number, transporter_name. Pagination + sort. |
| `inlineUpdateCSNHandler` | `PUT:/api/procurement/tracker/:id/inline` | Update single CSN field inline from tracker (lr_number, transporter_id, vessel_name, bl_number, eta fields). Triggers ETA cascade on date field changes. |

---

## 3. Business Rules

| Rule | Detail |
|---|---|
| CSN auto-creation | Done in Gate-16.2 (confirmPOHandler). Here we only manage existing CSNs. |
| Sub CSN inheritance | When mother CSN vessel/BL/ETD fields update → update all Sub CSNs with same values |
| Sub CSN GE visibility | When Sub CSNs exist under a Mother: GE screen shows Sub CSNs (not Mother) |
| No manual CSN create | CSNs are auto-created on PO confirm. Manual create not allowed except Sub CSNs. |
| LC alert dismiss | Alert dismissed when `lc_opened_date` AND `lc_number` both filled → CSN no longer in LC alert list |
| Vessel booking alert dismiss | Alert dismissed when `vessel_booking_confirmed_date` is filled |
| Status guard | Only ORDERED/IN_TRANSIT CSNs can be edited. ARRIVED/GRN_DONE are read-only. |
| Partial dispatch balance CSN | When GRN posts partial qty → remaining qty handled by GRN handler creating balance CSN. Not in this gate. |

---

## 4. Verification — Claude Will Check

1. `updateCSNHandler` triggers ETA cascade on any date field change
2. `createSubCSNHandler` sets `mother_csn_id` correctly
3. `deleteSubCSNHandler` blocks deletion if GE is linked
4. LC alert fires correctly (lc_required=true AND lc_opened_date IS NULL AND eta_port <= today+3)
5. Vessel booking alert fires (IMPORT AND vessel_booking_confirmed_date IS NULL AND po_date <= today-3)
6. `getAllAlertCountsHandler` returns both counts in one response
7. Status guard prevents editing ARRIVED/GRN_DONE CSNs
8. All routes added to `procurement.routes.ts`

---

*Spec frozen: 2026-05-12 | Reference: Sections 88, 89, 90*
