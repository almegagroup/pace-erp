# CODEX TASK BRIEF — Gate-16.3 CSN Backend

**Gate:** 16.3
**Spec File:** OM-GATE-16.3-CSNBackend-Spec.md
**Dependency:** Gate-16.2 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.3-CSNBackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/csn.handlers.ts`
2. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add CSN + alert + tracker routes

## What to Build

Handlers: `listCSNsHandler`, `getCSNHandler`, `updateCSNHandler`, `createSubCSNHandler`, `deleteSubCSNHandler`, `markCSNInTransitHandler`, `markCSNArrivedHandler`, `getLCAlertCountHandler`, `getLCAlertListHandler`, `getVesselBookingAlertCountHandler`, `getVesselBookingAlertListHandler`, `getAllAlertCountsHandler`, `getTrackerHandler`, `inlineUpdateCSNHandler`

## Critical Business Logic

**updateCSNHandler — ETA Cascade:**
On any date field change, recalculate downstream dates using lead_time_master_import or lead_time_master_domestic:
- Import: etd_origin → (+ ocean_transit_days) → eta_destination_port → (+ port_to_plant_days) → eta_plant
- Domestic: lr_date → (+ domestic_transit_days) → eta_plant

**Alert Queries:**
- LC Alert: `lc_required = true AND lc_opened_date IS NULL AND eta_destination_port <= current_date + 3`
- Vessel Booking Alert: `csn_type = 'IMPORT' AND vessel_booking_confirmed_date IS NULL AND po_date <= current_date - 3`

**Status Guard:**
- updateCSNHandler: block edit if status IN ('ARRIVED', 'GRN_DONE') → return 400

**deleteSubCSNHandler:**
- Block if any gate_entry_line references this CSN (check gate_entry_line.csn_id)

## After Implementation — Update Log
Set Gate-16.3 items to DONE.

---
*Brief frozen: 2026-05-12*
