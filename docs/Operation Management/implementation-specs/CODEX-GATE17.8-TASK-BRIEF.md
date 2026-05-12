# CODEX TASK BRIEF — Gate-17.8 IV + Landed Cost Frontend

**Gate:** 17.8
**Spec File:** OM-GATE-17.8-IVLandedCostFrontend-Spec.md
**Dependency:** Gate-16.8 VERIFIED ✅ + Gate-17.7 VERIFIED ✅

---

## Read First
Read `OM-GATE-17.8-IVLandedCostFrontend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx`
2. CREATE `frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx`
3. CREATE `frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx`
4. CREATE `frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx`
5. CREATE `frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx`
6. MODIFY `procurementApi.js` — add 16 IV + LC functions
7. MODIFY `operationScreens.js` — add 2 entries
8. MODIFY `AppRouter.jsx` — add 5 routes

## Critical Points

- **IV line table:** `rate_variance_pct` column — if > 50: RED cell highlight + "BLOCKED" badge on that line.
- **BLOCKED banner:** Red alert banner at top of IVDetailPage if iv.status = 'BLOCKED'. No Post button shown.
- **MATCHED banner:** Green banner + "Post IV" button shown.
- **Run Match button:** DRAFT only. After run match: page refresh showing updated match statuses.
- **GST match flag:** Show ✓ or ✗ next to invoice_gst_amount column.
- **Landed Cost create:** No date restriction. Note: "Can be entered any time after GRN — retroactive allowed."
- **CHA dropdown:** In LC line form, show CHA dropdown ONLY when cost_type = 'CHA_CHARGES'.
- **LC total:** Auto-calculate and show total_cost = sum of line amounts as user adds/edits lines.

## After Implementation — Update Log
Set Gate-17.8 items to DONE.

---
*Brief frozen: 2026-05-12*
