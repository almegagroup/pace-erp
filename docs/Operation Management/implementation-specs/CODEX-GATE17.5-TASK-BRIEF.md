# CODEX TASK BRIEF — Gate-17.5 Inward QA Frontend

**Gate:** 17.5
**Spec File:** OM-GATE-17.5-InwardQAFrontend-Spec.md
**Dependency:** Gate-16.5 VERIFIED ✅ + Gate-17.4 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.5-InwardQAFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/qa/QADocumentPage.jsx`
3. MODIFY `procurementApi.js` — add 7 QA functions
4. MODIFY `operationScreens.js` — add 1 entry
5. MODIFY `AppRouter.jsx` — add 2 routes

## Critical Points

- **QAQueuePage:** Filters by status IN ['PENDING','IN_PROGRESS'] by default. "Assign to Me" button on unassigned rows.
- **FOR_REPROCESS option:** Hidden from decision dropdown for non-QA_MANAGER roles. Read roleCode from session.
- **Usage Decision rows:**
  - Multiple rows (splits). "Add Split" button.
  - Running total: "Allocated: X of Total: Y". Submit disabled if X != Y.
  - Show remaining qty = total - sum(allocated splits) in real-time.
- **Submit confirmation:** Dialog — "This will post stock movements. Cannot be undone."
- **Post-decision:** Page goes read-only. Shows movement summary.
- **REJECT visual:** Amber highlight on REJECT rows with info "Stock will be blocked for RTV."

## After Implementation — Update Log
Set Gate-17.5 items to DONE.

---
*Brief frozen: 2026-05-12*
