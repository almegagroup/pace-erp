# CODEX TASK BRIEF — Gate-17.3 CSN Tracker + Alerts Frontend

**Gate:** 17.3
**Spec File:** OM-GATE-17.3-CSNFrontend-Spec.md
**Dependency:** Gate-16.3 VERIFIED ✅ + Gate-17.2 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.3-CSNFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx`
3. CREATE `frontend/src/pages/dashboard/procurement/csn/CSNAlertsPage.jsx`
4. MODIFY `procurementApi.js` — add 12 CSN + alert + tracker functions
5. MODIFY `operationScreens.js` — add 2 entries
6. MODIFY `AppRouter.jsx` — add 3 routes

## Critical Points

- **Alert badges:** CSNTrackerPage loads `getAllAlertCounts` on mount. Shows "LC Alerts: N" and "Vessel Booking: N" badges at top. Click opens CSNAlertsPage with relevant tab.
- **Inline edit:** Cells for lr_number, transporter_id, eta fields — click to edit inline, save via inlineUpdateCSN. Only editable for ORDERED/IN_TRANSIT rows.
- **CSNDetailPage conditional fields:** Show Import fields (vessel, BL, ETD/ETA, LC fields) ONLY if csn_type='IMPORT'. Show Domestic fields (LR, transporter) ONLY if csn_type='DOMESTIC'. Show Bulk fields if csn_type='BULK'.
- **Sub CSNs section:** List + add form + delete button. Delete only shown if no linked GE.
- **CSNAlertsPage two tabs:** Tab content loaded separately via getLCAlertList / getVesselBookingAlertList.

## After Implementation — Update Log
Set Gate-17.3 items to DONE.

---
*Brief frozen: 2026-05-12*
