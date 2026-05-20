# CODEX TASK BRIEF — Gate-17.1 L2 Masters Frontend

**Gate:** 17.1
**Spec File:** OM-GATE-17.1-L2MastersFrontend-Spec.md
**Dependency:** Gate-16.1 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.1-L2MastersFrontend-Spec.md` in full. Follow the same patterns as Gate-15/15B/15C (L1 frontend).

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/procurementApi.js` — 14 initial functions
2. CREATE `frontend/src/admin/sa/screens/SAPaymentTermsMaster.jsx`
3. CREATE `frontend/src/admin/sa/screens/SAPortMaster.jsx`
4. CREATE `frontend/src/admin/sa/screens/SAPortTransitMaster.jsx`
5. CREATE `frontend/src/admin/sa/screens/SALeadTimeMasters.jsx` (2 tabs)
6. CREATE `frontend/src/admin/sa/screens/SATransporterMaster.jsx`
7. CREATE `frontend/src/admin/sa/screens/SACHAMaster.jsx` (includes port mapping section)
8. MODIFY `frontend/src/navigation/screens/adminScreens.js` — add 6 entries
9. MODIFY `frontend/src/router/AppRouter.jsx` — add 6 imports + routes

## Critical Points

- `procurementApi.js`: use same pattern as `omApi.js` — fetch helper with credentials:'include'
- Payment Terms form: payment_method dropdown must have all 7 options (CREDIT/ADVANCE/LC/TT/DA/DP/MIXED)
- Transporter list: `direction` column shown. Filter param passed in listTransporters call.
- SALeadTimeMasters: two tabs (IMPORT / DOMESTIC), not two separate files
- SACHAMaster: includes "Port Assignments" expandable section with map CHA to port form
- Do NOT modify existing SA screen entries in adminScreens.js

## After Implementation — Update Log
Set Gate-17.1 items to DONE.

---
*Brief frozen: 2026-05-12*
