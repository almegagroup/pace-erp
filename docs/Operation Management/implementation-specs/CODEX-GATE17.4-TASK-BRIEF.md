# CODEX TASK BRIEF — Gate-17.4 Gate Entry + GRN Frontend

**Gate:** 17.4
**Spec File:** OM-GATE-17.4-GateEntryGRNFrontend-Spec.md
**Dependency:** Gate-16.4 VERIFIED ✅ + Gate-17.3 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.4-GateEntryGRNFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/gate/GateEntryListPage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/gate/GateEntryCreatePage.jsx`
3. CREATE `frontend/src/pages/dashboard/procurement/gate/GateEntryDetailPage.jsx`
4. CREATE `frontend/src/pages/dashboard/procurement/grn/GRNListPage.jsx`
5. CREATE `frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx`
6. MODIFY `procurementApi.js` — add 14 GE + GRN functions
7. MODIFY `operationScreens.js` — add entries
8. MODIFY `AppRouter.jsx` — add routes

## Critical Points

- **GateEntryCreatePage:** CSN dropdown loads `listOpenCSNsForGE` (open CSNs for company). On CSN select: auto-fills po_number, material_name, vendor_name, expected_qty.
- **Gross weight field:** Show if any line's material has weighbridge_required (check material master). Mandatory on submit for those materials.
- **GateEntryDetailPage:** "Create Gate Exit" form appears only if no gate_exit_inbound exists for this GE. After Gate Exit: shows calculated net_weight. "Create GRN" button appears after Gate Exit.
- **GRNDetailPage:**
  - `discrepancy` column = ge_qty - received_qty. Highlight row amber if non-zero.
  - `QA_STOCK` badge on lines where material qa_required = true. Read-only.
  - BULK/TANKER: received_qty pre-filled from net_weight (editable).
  - "Post GRN" button shows confirm dialog: "This will post stock movement. Cannot be undone without reversal."
  - "Reverse GRN" button (POSTED only) — asks reason, calls reverseGRN.

## After Implementation — Update Log
Set Gate-17.4 items to DONE.

---
*Brief frozen: 2026-05-12*
