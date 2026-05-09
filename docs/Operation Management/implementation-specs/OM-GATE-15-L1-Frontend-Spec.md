# OM-GATE-15 — L1 Master Data Frontend Spec
# PACE-ERP Operation Management — Frontend Screens (JSX/React)

**Gate:** 15
**Phase:** Operation Management — Layer 1 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-14 VERIFIED ✅ — proceed
**Implementer:** Codex
**Verifier:** Claude
**Tech Stack:** React JSX + React Router v6 + Vite + TailwindCSS

---

## 1. What This Gate Builds

Gate-15 is the frontend screen layer for all **L1 master data** entities. These are the React JSX pages, screen registry entries, and router wiring for managing:

- Material master (list, create, detail/edit + status change + UOM conversions)
- Vendor master (list, create, detail/edit + status change + payment terms)
- Vendor Material Info / Approved Source List (list, create, detail/edit + status change)
- Customer master (list, create, detail/edit + status change)
- UOM master (SA only — list + create inline)
- Storage location (SA only — list + create)
- Number series (SA only — list + create)

**What you must NOT do:**
- Do NOT create or modify backend files (Edge Functions, migrations)
- Do NOT create `.ts` or `.tsx` files — all frontend files are `.jsx` or `.js`
- Do NOT create SQL files
- Do NOT break existing routes or screens

---

## 2. Files to Create or Update

### New files to CREATE:

| File | Purpose |
|---|---|
| `frontend/src/pages/dashboard/om/omApi.js` | All `/api/om/*` fetch functions |
| `frontend/src/pages/dashboard/om/material/MaterialListPage.jsx` | Material list screen |
| `frontend/src/pages/dashboard/om/material/MaterialCreatePage.jsx` | Material create form |
| `frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx` | Material detail + edit + status + UOM |
| `frontend/src/pages/dashboard/om/vendor/VendorListPage.jsx` | Vendor list screen |
| `frontend/src/pages/dashboard/om/vendor/VendorCreatePage.jsx` | Vendor create form |
| `frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx` | Vendor detail + edit + status + payment terms |
| `frontend/src/pages/dashboard/om/asl/AslListPage.jsx` | Approved Source List screen |
| `frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx` | ASL create form |
| `frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx` | ASL detail + edit + status |
| `frontend/src/pages/dashboard/om/customer/CustomerListPage.jsx` | Customer list screen |
| `frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx` | Customer create form |
| `frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx` | Customer detail + edit + status |
| `frontend/src/admin/sa/screens/SAOmUomMaster.jsx` | SA: UOM master list + inline create |
| `frontend/src/admin/sa/screens/SAOmStorageLocations.jsx` | SA: Storage location list + create |
| `frontend/src/admin/sa/screens/SAOmNumberSeries.jsx` | SA: Number series list + create |

### Existing files to UPDATE:

| File | What to change |
|---|---|
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | Populate with 12 OM screen entries |
| `frontend/src/navigation/screens/adminScreens.js` | Add 3 SA OM screen entries |
| `frontend/src/router/AppRouter.jsx` | Add imports + route entries for all 16 new screens |

---

## 3. Screen Registry

### 3A. `operationScreens.js` — Dashboard/ACL screens

Populate `OPERATION_SCREENS` with these 12 entries. Follow the exact same pattern as `hrScreens.js`:

```js
import { SCREEN_TYPE } from "../../../screenTypes.js";

export const OPERATION_SCREENS = Object.freeze({

  OM_MATERIAL_LIST: {
    screen_code: "OM_MATERIAL_LIST",
    route: "/dashboard/om/materials",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_MATERIAL_CREATE: {
    screen_code: "OM_MATERIAL_CREATE",
    route: "/dashboard/om/material/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_MATERIAL_DETAIL: {
    screen_code: "OM_MATERIAL_DETAIL",
    route: "/dashboard/om/material/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_VENDOR_LIST: {
    screen_code: "OM_VENDOR_LIST",
    route: "/dashboard/om/vendors",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_VENDOR_CREATE: {
    screen_code: "OM_VENDOR_CREATE",
    route: "/dashboard/om/vendor/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_VENDOR_DETAIL: {
    screen_code: "OM_VENDOR_DETAIL",
    route: "/dashboard/om/vendor/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_ASL_LIST: {
    screen_code: "OM_ASL_LIST",
    route: "/dashboard/om/vendor-material-infos",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_ASL_CREATE: {
    screen_code: "OM_ASL_CREATE",
    route: "/dashboard/om/vendor-material-info/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_ASL_DETAIL: {
    screen_code: "OM_ASL_DETAIL",
    route: "/dashboard/om/vendor-material-info/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_CUSTOMER_LIST: {
    screen_code: "OM_CUSTOMER_LIST",
    route: "/dashboard/om/customers",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_CUSTOMER_CREATE: {
    screen_code: "OM_CUSTOMER_CREATE",
    route: "/dashboard/om/customer/create",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  OM_CUSTOMER_DETAIL: {
    screen_code: "OM_CUSTOMER_DETAIL",
    route: "/dashboard/om/customer/detail",
    universe: "ACL",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

});
```

### 3B. `adminScreens.js` — SA screens

Add these 3 entries to the existing `ADMIN_SCREENS` object (before the closing `}`):

```js
  SA_OM_UOM_MASTER: {
    screen_code: "SA_OM_UOM_MASTER",
    route: "/sa/om/uom-master",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_OM_STORAGE_LOCATIONS: {
    screen_code: "SA_OM_STORAGE_LOCATIONS",
    route: "/sa/om/storage-locations",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },

  SA_OM_NUMBER_SERIES: {
    screen_code: "SA_OM_NUMBER_SERIES",
    route: "/sa/om/number-series",
    universe: "ADMIN",
    type: SCREEN_TYPE.FULL,
    keepAlive: false,
  },
```

---

## 4. AppRouter.jsx Changes

### Imports to add (at the top, with other imports):

```jsx
// OM dashboard pages
import MaterialListPage from "../pages/dashboard/om/material/MaterialListPage.jsx";
import MaterialCreatePage from "../pages/dashboard/om/material/MaterialCreatePage.jsx";
import MaterialDetailPage from "../pages/dashboard/om/material/MaterialDetailPage.jsx";
import VendorListPage from "../pages/dashboard/om/vendor/VendorListPage.jsx";
import VendorCreatePage from "../pages/dashboard/om/vendor/VendorCreatePage.jsx";
import VendorDetailPage from "../pages/dashboard/om/vendor/VendorDetailPage.jsx";
import AslListPage from "../pages/dashboard/om/asl/AslListPage.jsx";
import AslCreatePage from "../pages/dashboard/om/asl/AslCreatePage.jsx";
import AslDetailPage from "../pages/dashboard/om/asl/AslDetailPage.jsx";
import CustomerListPage from "../pages/dashboard/om/customer/CustomerListPage.jsx";
import CustomerCreatePage from "../pages/dashboard/om/customer/CustomerCreatePage.jsx";
import CustomerDetailPage from "../pages/dashboard/om/customer/CustomerDetailPage.jsx";
// OM SA-only screens
import SAOmUomMaster from "../admin/sa/screens/SAOmUomMaster.jsx";
import SAOmStorageLocations from "../admin/sa/screens/SAOmStorageLocations.jsx";
import SAOmNumberSeries from "../admin/sa/screens/SAOmNumberSeries.jsx";
```

### SA routes to add (inside `<Route element={<SADashboardShell />}><Route element={<MenuShell />}>` — after the last existing SA route):

```jsx
<Route path="om/uom-master" element={<SAOmUomMaster />} />
<Route path="om/storage-locations" element={<SAOmStorageLocations />} />
<Route path="om/number-series" element={<SAOmNumberSeries />} />
```

### Dashboard routes to add (inside `<Route element={<DashboardShell />}>` — after all existing HR routes):

```jsx
<Route path="om/materials" element={<MaterialListPage />} />
<Route path="om/material/create" element={<MaterialCreatePage />} />
<Route path="om/material/detail" element={<MaterialDetailPage />} />
<Route path="om/vendors" element={<VendorListPage />} />
<Route path="om/vendor/create" element={<VendorCreatePage />} />
<Route path="om/vendor/detail" element={<VendorDetailPage />} />
<Route path="om/vendor-material-infos" element={<AslListPage />} />
<Route path="om/vendor-material-info/create" element={<AslCreatePage />} />
<Route path="om/vendor-material-info/detail" element={<AslDetailPage />} />
<Route path="om/customers" element={<CustomerListPage />} />
<Route path="om/customer/create" element={<CustomerCreatePage />} />
<Route path="om/customer/detail" element={<CustomerDetailPage />} />
```

---

## 5. API Module — `omApi.js`

File: `frontend/src/pages/dashboard/om/omApi.js`

Follow the exact same pattern as `hrApi.js` — plain fetch functions with `import.meta.env.VITE_API_BASE`.

```js
const BASE = import.meta.env.VITE_API_BASE;

async function readJsonSafe(response) {
  try { return await response.clone().json(); } catch { return null; }
}

// ── Material ──────────────────────────────────────────────
export async function createMaterial(payload) { ... POST /api/om/material }
export async function listMaterials(params = {}) { ... GET /api/om/materials?... }
export async function getMaterial(id) { ... GET /api/om/material?id=... }
export async function updateMaterial(payload) { ... PATCH /api/om/material }
export async function changeMaterialStatus(payload) { ... POST /api/om/material/status }
export async function createMaterialUomConversion(payload) { ... POST /api/om/material/uom-conversion }
export async function listMaterialUomConversions(materialId) { ... GET /api/om/material/uom-conversions?material_id=... }

// ── Vendor ────────────────────────────────────────────────
export async function createVendor(payload) { ... POST /api/om/vendor }
export async function listVendors(params = {}) { ... GET /api/om/vendors?... }
export async function getVendor(id) { ... GET /api/om/vendor?id=... }
export async function updateVendor(payload) { ... PATCH /api/om/vendor }
export async function changeVendorStatus(payload) { ... POST /api/om/vendor/status }
export async function addVendorPaymentTerms(payload) { ... POST /api/om/vendor/payment-terms }
export async function getVendorPaymentTerms(vendorId, companyId) { ... GET /api/om/vendor/payment-terms?vendor_id=...&company_id=... }

// ── Vendor Material Info (ASL) ────────────────────────────
export async function createVendorMaterialInfo(payload) { ... POST /api/om/vendor-material-info }
export async function listVendorMaterialInfos(params = {}) { ... GET /api/om/vendor-material-infos?... }
export async function getVendorMaterialInfo(id) { ... GET /api/om/vendor-material-info?id=... }
export async function updateVendorMaterialInfo(payload) { ... PATCH /api/om/vendor-material-info }
export async function changeVendorMaterialInfoStatus(payload) { ... POST /api/om/vendor-material-info/status }

// ── Customer ──────────────────────────────────────────────
export async function createCustomer(payload) { ... POST /api/om/customer }
export async function listCustomers(params = {}) { ... GET /api/om/customers?... }
export async function getCustomer(id) { ... GET /api/om/customer?id=... }
export async function updateCustomer(payload) { ... PATCH /api/om/customer }
export async function changeCustomerStatus(payload) { ... POST /api/om/customer/status }

// ── UOM (SA) ──────────────────────────────────────────────
export async function listUoms(params = {}) { ... GET /api/om/uoms?... }
export async function createUom(payload) { ... POST /api/om/uom }

// ── Storage Location (SA) ─────────────────────────────────
export async function listStorageLocations(params = {}) { ... GET /api/om/storage-locations?... }
export async function createStorageLocation(payload) { ... POST /api/om/storage-location }

// ── Number Series (SA) ────────────────────────────────────
export async function listNumberSeries(params = {}) { ... GET /api/om/number-series?... }
export async function createNumberSeries(payload) { ... POST /api/om/number-series }
```

**Error handling pattern** — identical to existing fetch functions:
```js
export async function createMaterial(payload) {
  const response = await fetch(`${BASE}/api/om/material`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    const error = new Error(json?.code ?? "OM_MATERIAL_CREATE_FAILED");
    error.status = response.status;
    throw error;
  }
  return json.data;
}
```

For GET requests with query params:
```js
export async function listMaterials({ material_type, status, search, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (material_type) params.set("material_type", material_type);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const response = await fetch(`${BASE}/api/om/materials?${params}`, { credentials: "include" });
  const json = await readJsonSafe(response);
  if (!response.ok || !json?.ok) {
    const error = new Error(json?.code ?? "OM_MATERIAL_LIST_FAILED");
    error.status = response.status;
    throw error;
  }
  return json.data; // { data: [], total: N }
}
```

---

## 6. Page Specifications

### 6.1 List Pages

All 4 domain list pages follow the same pattern. Use `ErpMasterListTemplate` or `ErpScreenScaffold` depending on complexity.

**Pattern:**
- `useEffect` loads data on mount and on filter change
- Search input with debounce (300ms)
- Status filter dropdown
- Pagination (limit=50, offset pagination)
- "Create" button → navigates to create screen via `openScreen()`
- Row click → navigates to detail screen via `openScreen()` passing `id` in search params
- Loading state and error state handled

**MaterialListPage — filters:**
- Search (searches material_code + material_name)
- material_type: ALL | RM | PM | INT | FG | TRA | CONS
- status: ALL | DRAFT | PENDING_APPROVAL | ACTIVE | INACTIVE | BLOCKED

**VendorListPage — filters:**
- Search (vendor_code + vendor_name)
- vendor_type: ALL | DOMESTIC | IMPORT
- status: ALL | DRAFT | PENDING_APPROVAL | ACTIVE | INACTIVE | BLOCKED

**AslListPage — filters:**
- vendor_id (dropdown or text)
- material_id (dropdown or text)
- status: ALL | ACTIVE | INACTIVE

**CustomerListPage — filters:**
- Search (customer_code + customer_name)
- customer_type: ALL | DOMESTIC | EXPORT
- status: ALL | DRAFT | PENDING_APPROVAL | ACTIVE | INACTIVE | BLOCKED

---

### 6.2 Create Pages

All create pages use `ErpEntryFormTemplate` or `ErpDenseFormRow` pattern.

**MaterialCreatePage — required fields:**
- material_type (dropdown: RM/PM/INT/FG/TRA/CONS)
- material_name (text)
- base_uom_code (dropdown loaded from GET /api/om/uoms)
- optional: hsn_code, description, is_batch_managed (checkbox)

**VendorCreatePage — required fields:**
- vendor_name (text)
- vendor_type (dropdown: DOMESTIC/IMPORT)
- optional: registered_address, gst_number, primary_contact_person, phone, primary_email, currency_code

**AslCreatePage — required fields:**
- vendor_id (dropdown: load active vendors via listVendors)
- material_id (dropdown: load active materials via listMaterials)
- po_uom_code (dropdown: load UOMs)
- conversion_factor (number, default 1)
- optional: vendor_material_code, lead_time_days

**CustomerCreatePage — required fields:**
- customer_name (text)
- customer_type (dropdown: DOMESTIC/EXPORT)
- delivery_address (text)
- optional: billing_address, gst_number, primary_contact_person, phone, primary_email

---

### 6.3 Detail Pages

All detail pages load the entity by `id` from URL search params (`new URLSearchParams(location.search).get("id")`).

**Sections in each detail page:**
1. **Header** — entity code + name + status badge
2. **View/Edit section** — fields shown as read-only, "Edit" button switches to edit mode
3. **Status action bar** — buttons for valid transitions from current status (DRAFT → PENDING_APPROVAL → ACTIVE etc.)
4. **Domain-specific section** (see below)

**MaterialDetailPage extra section:**
- UOM Conversions tab/section — list current conversions + "Add Conversion" inline form

**VendorDetailPage extra section:**
- Payment Terms History — last 10 entries from getVendorPaymentTerms + "Add Payment Terms" inline form

**AslDetailPage:** No extra sections — basic view/edit/status only.

**CustomerDetailPage:** No extra sections — basic view/edit/status only.

---

### 6.4 SA-only Screens

**SAOmUomMaster:**
- Left: list of all UOMs (code, name, uom_type, active) — loaded on mount
- Right panel or modal: "Create UOM" form (uom_code, uom_name, uom_type dropdown)
- Submit → POST /api/om/uom → refresh list
- No pagination needed (list is small and global)

**SAOmStorageLocations:**
- List: all storage locations (code, name, location_type, active) — searchable
- Create panel: location_code, location_name, location_type dropdown (PHYSICAL/LOGICAL/TRANSIT)
- Submit → POST /api/om/storage-location → refresh list

**SAOmNumberSeries:**
- List: all number series (company_id, document_type, prefix, active) — filterable by company/document_type
- Create panel: company_id (dropdown from companies), document_type (text), prefix (text), padding (number, default 5), financial_year_reset (checkbox)
- Submit → POST /api/om/number-series → refresh list

---

## 7. Navigation Pattern

Use `openScreen()` and `popScreen()` from `screenStackEngine.js` for navigation — same pattern as all other pages:

```js
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";

// Navigate to create page
openScreen(OPERATION_SCREENS.OM_MATERIAL_CREATE.screen_code);

// Navigate to detail page with ID
openScreen(OPERATION_SCREENS.OM_MATERIAL_DETAIL.screen_code, { id: row.id });

// Go back
popScreen();
```

For SA screens, use `ADMIN_SCREENS`:
```js
import { ADMIN_SCREENS } from "../../../../navigation/screens/adminScreens.js";
```

---

## 8. File Header Format

All new files must start with this header:

```jsx
/*
 * File-ID: 15.X
 * File-Path: frontend/src/pages/dashboard/om/.../FileName.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: One sentence.
 * Authority: Frontend
 */
```

File-IDs: `15.1` (omApi.js), `15.2–15.4` (material), `15.5–15.7` (vendor), `15.8–15.10` (asl), `15.11–15.13` (customer), `15.14` (SAOmUomMaster), `15.15` (SAOmStorageLocations), `15.16` (SAOmNumberSeries), `15.17` (operationScreens.js update), `15.18` (adminScreens.js update), `15.19` (AppRouter.jsx update)

---

## 9. Critical Rules

### Rule 1: JSX only — no TypeScript
All files are `.jsx` (pages) or `.js` (api, screens). Never `.ts` or `.tsx`.

### Rule 2: API base from env
```js
const BASE = import.meta.env.VITE_API_BASE;
```
Never hardcode the API URL.

### Rule 3: credentials: "include" on all fetch calls
Session is cookie-based. Every fetch must include `credentials: "include"`.

### Rule 4: Screen navigation via screenStackEngine
Never use `useNavigate()` directly for screen transitions. Always use `openScreen()` / `popScreen()` from `screenStackEngine.js`.

### Rule 5: ID passed via search params
Detail pages receive the entity ID via URL search params:
```js
const [searchParams] = useSearchParams();
const id = searchParams.get("id");
```

### Rule 6: operationScreens.js — import it where needed
The `OPERATION_SCREENS` object must be imported from its file when used in page components. Do not inline screen codes as strings.

### Rule 7: Do NOT touch hrScreens.js or any HR pages
Only modify the files listed in Section 2.

### Rule 8: AppRouter.jsx — only add, never remove
Add imports at the top. Add route entries in the correct sections. Do not touch any existing route.

### Rule 9: Error handling in pages
On API error, show the error code in a toast or inline error message. Use existing `ToastOverlay` pattern if available. Never silently swallow errors.

### Rule 10: Loading state
Every page that fetches data must show a loading indicator while data is loading. Use the existing loading patterns (spinner or skeleton) from other pages.

---

## 10. Self-Check

```
[ ] omApi.js — all 25 fetch functions, credentials: "include", error throws with json?.code
[ ] omApi.js — GET functions build URLSearchParams correctly
[ ] MaterialListPage.jsx — loads list, search+filter, pagination, row click → detail, create button
[ ] MaterialCreatePage.jsx — required fields, UOM dropdown loaded from API, submit → list
[ ] MaterialDetailPage.jsx — loads by id from searchParams, edit mode, status buttons, UOM conversions section
[ ] VendorListPage.jsx — loads list, search+filter, pagination, row click → detail
[ ] VendorCreatePage.jsx — vendor_type dropdown, submit
[ ] VendorDetailPage.jsx — loads by id, edit mode, status buttons, payment terms section
[ ] AslListPage.jsx — loads list, vendor/material filters, row click → detail
[ ] AslCreatePage.jsx — vendor dropdown, material dropdown, UOM dropdown, submit
[ ] AslDetailPage.jsx — loads by id, edit mode, status toggle
[ ] CustomerListPage.jsx — loads list, search+filter, row click → detail
[ ] CustomerCreatePage.jsx — customer_type dropdown, delivery_address required, submit
[ ] CustomerDetailPage.jsx — loads by id, edit mode, status buttons
[ ] SAOmUomMaster.jsx — list + create form, assertOmSaContext implied (SA shell handles auth)
[ ] SAOmStorageLocations.jsx — list + create form
[ ] SAOmNumberSeries.jsx — list + create form with company dropdown
[ ] operationScreens.js — 12 entries, universe: "ACL", all routes correct
[ ] adminScreens.js — 3 new entries added, routes: /sa/om/uom-master etc.
[ ] AppRouter.jsx — 16 new imports, 12 dashboard routes, 3 SA routes added
[ ] No useNavigate() for screen transitions
[ ] No hardcoded API URLs
[ ] All fetch calls have credentials: "include"
[ ] No TypeScript files created
[ ] No backend/migration files created or modified
```

---

## 11. Implementation Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file:
```
| 15.X | item name | DONE | frontend/src/... | - | - |
```

After all items:
```
Gate-15 implementation complete. All 19 items created/updated. Awaiting Claude verification.
```

---

*Gate: 15 | Phase: L1 Frontend | Domain: OPERATION_MANAGEMENT*
*Gate-14 VERIFIED ✅ — proceed*
*Do not start Gate-16 (L2 Procurement Backend) until Claude marks Gate-15 VERIFIED.*
