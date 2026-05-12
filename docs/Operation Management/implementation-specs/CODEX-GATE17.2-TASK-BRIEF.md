# CODEX TASK BRIEF — Gate-17.2 Purchase Order Frontend

**Gate:** 17.2
**Spec File:** OM-GATE-17.2-POFrontend-Spec.md
**Dependency:** Gate-16.2 VERIFIED ✅ + Gate-17.1 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.2-POFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/po/POListPage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx`
3. CREATE `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx`
4. MODIFY `frontend/src/pages/dashboard/procurement/procurementApi.js` — add 12 PO functions
5. MODIFY `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` — add 2 entries
6. MODIFY `frontend/src/router/AppRouter.jsx` — add 3 routes

## Critical Points

- **Approve/Reject buttons:** Only shown if `ctx.roleCode === 'PROC_HEAD' || ctx.roleCode === 'SA'`. Read roleCode from session/context.
- **Incoterm field:** Show ONLY if delivery_type from import vendors (or delivery_type = 'IMPORT'). Hidden for DOMESTIC.
- **Amendment form:** Separate modal/form. Only: rate (per line), qty (per line), delivery_date, remarks. Rate/qty shows warning text: "Requires Procurement Head approval."
- **PODetailPage sections:** 5 sections — header, lines, CSNs, approval log, amendment log. All 5 must be present.
- **CSN links:** Each CSN in the CSNs section is a clickable link → CSN detail page (path: `/dashboard/procurement/csns/:id`).
- Do NOT modify existing operationScreens.js entries.

## After Implementation — Update Log
Set Gate-17.2 items to DONE.

---
*Brief frozen: 2026-05-12*
