# CODEX TASK BRIEF — Gate-15: L1 Master Data Frontend

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 15
**Dependency status:** Gate-14 VERIFIED ✅ — proceed
**Your task:** Create 16 new JSX/JS files + update 3 existing files. Nothing else.

---

## Step 1 — Read These Files First

1. `docs/Operation Management/implementation-specs/OM-GATE-15-L1-Frontend-Spec.md`
   → Complete spec. Screen table, API module, page descriptions, router wiring all there.

2. `frontend/src/navigation/screens/projects/hrModule/hrScreens.js`
   → Exact pattern for `operationScreens.js`.

3. `frontend/src/router/AppRouter.jsx`
   → Understand how HR routes are wired. Add OM routes the same way.

4. `frontend/src/pages/dashboard/hr/hrApi.js`
   → Exact pattern for `omApi.js`.

5. `frontend/src/admin/sa/screens/SADepartmentMaster.jsx`
   → Pattern for SA screens (list + inline create).

6. `frontend/src/navigation/screens/adminScreens.js`
   → You will add 3 entries here.

7. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Update after each item. Gate-15 section already added.

---

## Step 2 — What You Are Building

React JSX frontend screens for all L1 master data. 

**Dashboard screens** (under `/dashboard/om/`, ACL universe):
- Material: list → create → detail (with UOM conversions)
- Vendor: list → create → detail (with payment terms)
- Vendor Material Info (ASL): list → create → detail
- Customer: list → create → detail

**SA screens** (under `/sa/om/`, ADMIN universe):
- UOM Master: list + create inline
- Storage Locations: list + create
- Number Series: list + create

---

## Step 3 — Files Summary

### Create (16 new files):
```
frontend/src/pages/dashboard/om/omApi.js
frontend/src/pages/dashboard/om/material/MaterialListPage.jsx
frontend/src/pages/dashboard/om/material/MaterialCreatePage.jsx
frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx
frontend/src/pages/dashboard/om/vendor/VendorListPage.jsx
frontend/src/pages/dashboard/om/vendor/VendorCreatePage.jsx
frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx
frontend/src/pages/dashboard/om/asl/AslListPage.jsx
frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx
frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx
frontend/src/pages/dashboard/om/customer/CustomerListPage.jsx
frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx
frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx
frontend/src/admin/sa/screens/SAOmUomMaster.jsx
frontend/src/admin/sa/screens/SAOmStorageLocations.jsx
frontend/src/admin/sa/screens/SAOmNumberSeries.jsx
```

### Update (3 existing files):
```
frontend/src/navigation/screens/projects/operationModule/operationScreens.js
frontend/src/navigation/screens/adminScreens.js
frontend/src/router/AppRouter.jsx
```

---

## Step 4 — Critical Rules (Read All Before Writing)

### Rule 1: JSX only — never TypeScript
`.jsx` for components, `.js` for api/screens. Never `.ts` or `.tsx`.

### Rule 2: API base
```js
const BASE = import.meta.env.VITE_API_BASE;
```

### Rule 3: credentials: "include" on every fetch
```js
const response = await fetch(`${BASE}/api/om/material`, {
  method: "POST",
  credentials: "include",          // ← always
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

### Rule 4: Screen navigation — never useNavigate
```js
// CORRECT
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
openScreen(OPERATION_SCREENS.OM_MATERIAL_DETAIL.screen_code, { id: row.id });
popScreen();

// WRONG
const navigate = useNavigate();
navigate("/dashboard/om/material/detail");
```

### Rule 5: ID from search params in detail pages
```js
import { useSearchParams } from "react-router-dom";
const [searchParams] = useSearchParams();
const id = searchParams.get("id");
```

### Rule 6: Error pattern in API functions
```js
if (!response.ok || !json?.ok) {
  const error = new Error(json?.code ?? "OM_MATERIAL_CREATE_FAILED");
  error.status = response.status;
  throw error;
}
return json.data;
```

### Rule 7: operationScreens.js — 12 entries, universe: "ACL"
Copy the exact pattern from hrScreens.js. All OM dashboard screens have `universe: "ACL"`.

### Rule 8: adminScreens.js — ADD only, never remove
Add 3 entries to the existing `ADMIN_SCREENS` object. Do not touch any existing entry.

### Rule 9: AppRouter.jsx — ADD only, never remove
Add imports at the top. Add route entries after existing HR routes. Do not touch any existing route.

### Rule 10: SA screens inherit auth from the shell
The SA shell (`/sa/*`) already guards for SA role. Your `SAOmUomMaster.jsx` etc. do NOT need to do their own role check — just call the API and display.

---

## Step 5 — Route Table Quick Reference

```
Screen Code               Route                                    Component
OM_MATERIAL_LIST          /dashboard/om/materials                  MaterialListPage
OM_MATERIAL_CREATE        /dashboard/om/material/create            MaterialCreatePage
OM_MATERIAL_DETAIL        /dashboard/om/material/detail            MaterialDetailPage
OM_VENDOR_LIST            /dashboard/om/vendors                    VendorListPage
OM_VENDOR_CREATE          /dashboard/om/vendor/create              VendorCreatePage
OM_VENDOR_DETAIL          /dashboard/om/vendor/detail              VendorDetailPage
OM_ASL_LIST               /dashboard/om/vendor-material-infos      AslListPage
OM_ASL_CREATE             /dashboard/om/vendor-material-info/create AslCreatePage
OM_ASL_DETAIL             /dashboard/om/vendor-material-info/detail AslDetailPage
OM_CUSTOMER_LIST          /dashboard/om/customers                  CustomerListPage
OM_CUSTOMER_CREATE        /dashboard/om/customer/create            CustomerCreatePage
OM_CUSTOMER_DETAIL        /dashboard/om/customer/detail            CustomerDetailPage
SA_OM_UOM_MASTER          /sa/om/uom-master                        SAOmUomMaster
SA_OM_STORAGE_LOCATIONS   /sa/om/storage-locations                 SAOmStorageLocations
SA_OM_NUMBER_SERIES       /sa/om/number-series                     SAOmNumberSeries
```

---

## Step 6 — Self-Check Before Submitting

```
[ ] omApi.js — 25 functions, all have credentials: "include", all throw error with json?.code
[ ] MaterialListPage — loads data, search + material_type + status filters, create button, row click
[ ] MaterialCreatePage — material_type dropdown, material_name, base_uom_code from API, submit
[ ] MaterialDetailPage — loads by id from searchParams, edit mode, status buttons, UOM conversions
[ ] VendorListPage — loads, search + vendor_type + status filters, create + row click
[ ] VendorCreatePage — vendor_name, vendor_type dropdown, submit
[ ] VendorDetailPage — loads by id, edit, status, payment terms history + add form
[ ] AslListPage — vendor/material filters, row click
[ ] AslCreatePage — vendor dropdown, material dropdown, UOM dropdown, conversion_factor
[ ] AslDetailPage — loads by id, edit, status toggle
[ ] CustomerListPage — search + customer_type + status, create + row click
[ ] CustomerCreatePage — customer_name, customer_type, delivery_address required
[ ] CustomerDetailPage — loads by id, edit, status buttons
[ ] SAOmUomMaster — list + create form (uom_code, uom_name, uom_type)
[ ] SAOmStorageLocations — list + create form
[ ] SAOmNumberSeries — list + create form
[ ] operationScreens.js — 12 entries, universe: "ACL", correct routes
[ ] adminScreens.js — 3 new entries added, /sa/om/* routes
[ ] AppRouter.jsx — 16 new imports, 12 dashboard routes, 3 SA routes
[ ] No useNavigate() used for screen transitions
[ ] No hardcoded API URLs
[ ] No TypeScript files
[ ] No backend files touched
```

---

## Step 7 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file:
```
| 15.X | item name | DONE | frontend/src/... | - | - |
```

After all 19 items:
```
Gate-15 implementation complete. All 19 items done. Awaiting Claude verification.
```

---

## Step 8 — Hard Stop

After Gate-15, stop. Claude verifies.

After Gate-15 is VERIFIED, L1 is complete. Gate-13 (Procurement DB) can then be implemented, followed by Gate-16 (L2 Procurement Backend).

---

*Task issued: 2026-05-09*
*Gate-14 VERIFIED ✅*
*Do not start any Gate-16+ work until Claude marks Gate-15 VERIFIED.*
