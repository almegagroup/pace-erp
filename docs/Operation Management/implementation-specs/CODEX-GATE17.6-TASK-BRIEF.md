# CODEX TASK BRIEF — Gate-17.6 STO + DC Frontend

**Gate:** 17.6
**Spec File:** OM-GATE-17.6-STODCFrontend-Spec.md
**Dependency:** Gate-16.6 VERIFIED ✅ + Gate-17.5 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.6-STODCFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/sto/STOListPage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/sto/STOCreatePage.jsx`
3. CREATE `frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx`
4. MODIFY `procurementApi.js` — add 10 STO functions
5. MODIFY `operationScreens.js` — add 2 entries
6. MODIFY `AppRouter.jsx` — add 3 routes

## Critical Points

- **STOListPage:** Two-tab or column indicator: MY OUTBOUND | MY INBOUND. Both use same listSTOs with company_id.
- **Dispatch confirm dialog:** Show available stock qty for each line. Warning if any line has insufficient stock.
- **After dispatch:** Info box showing DC number and Gate Exit number (from API response). These are auto-generated — must be visible immediately after dispatch.
- **BULK/TANKER tare weight:** After dispatch, show "Add Tare Weight" form that calls `updateGateExitWeight`.
- **Confirm Receipt:** Only show on DISPATCHED STO, only for receiving company's users (compare receiving_company_id with session company).

## After Implementation — Update Log
Set Gate-17.6 items to DONE.

---
*Brief frozen: 2026-05-12*
