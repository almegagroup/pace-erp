# CODEX TASK BRIEF — Gate-17.7 RTV + DN + Exchange Frontend

**Gate:** 17.7
**Spec File:** OM-GATE-17.7-RTVFrontend-Spec.md
**Dependency:** Gate-16.7 VERIFIED ✅ + Gate-17.6 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.7-RTVFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx`
3. CREATE `frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx`
4. MODIFY `procurementApi.js` — add 14 RTV + DN + EXR functions
5. MODIFY `operationScreens.js` — add 2 entries
6. MODIFY `AppRouter.jsx` — add 3 routes

## Critical Points

- **RTVCreatePage — two steps:** (1) GRN selection first. (2) Then header + lines. The return_qty per line shows available BLOCKED stock as hint/max.
- **RTVDetailPage — settlement mode drives what appears after DISPATCHED:**
  - DEBIT_NOTE: show "Create Debit Note" button only
  - EXCHANGE: show "Create Exchange Reference" button only
  - NEXT_INVOICE_ADJUST: show info banner "Pending credit ₹[amount] tracked on vendor's next invoice"
- **Debit Note section:** After DN created, show DN status lifecycle buttons (Mark Sent → Acknowledge → Settle) in sequence.
- **Exchange Reference section:** "Link Replacement GRN" button on PENDING exchange refs.
- **Post RTV confirm:** "This will post P122 movement — stock returned to vendor."

## After Implementation — Update Log
Set Gate-17.7 items to DONE.

---
*Brief frozen: 2026-05-12*
