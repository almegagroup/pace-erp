# CODEX TASK BRIEF — Gate-15C: L1 Critical Fixes + Missing Views

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 15C
**Dependency:** Gate-12B VERIFIED ✅ — proceed
**Your task:** Fix 6 existing files. No new files. No backend changes.

---

## Why This Gate Exists

Gate-15 verification missed that 5 backend routes have no frontend function and no UI.
Additionally, several detail pages have incomplete functionality.
This gate fixes all of them.

---

## Step 1 — Read These Files First

1. `frontend/src/pages/dashboard/om/omApi.js` — you will add 5 functions
2. `frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx` — you will add 3 sections
3. `frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx` — you will add 2 sections + fix 1 bug
4. `frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx` — you will add 1 section + fix 1 validation
5. `frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx` — you will fix status lifecycle + add pack_size
6. `frontend/src/admin/sa/screens/SAOmStorageLocations.jsx` — you will add 1 section
7. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` — update after each file

---

## Step 2 — Files to Update (6 files, no new files)

```
frontend/src/pages/dashboard/om/omApi.js
frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx
frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx
frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx
frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx
frontend/src/admin/sa/screens/SAOmStorageLocations.jsx
```

---

## Step 3 — omApi.js: Add 5 Missing Functions

Add these 5 functions after the existing functions. Do NOT touch existing functions.

```js
// --- Material Extensions ---

export async function extendMaterialToCompany(payload) {
  // payload: { material_id, company_id, procurement_allowed?, valuation_method_override?, hsn_override? }
  return fetchJson("POST:/api/om/material/extend-company", "POST", payload, "OM_MATERIAL_EXTEND_COMPANY_FAILED");
}

export async function extendMaterialToPlant(payload) {
  // payload: { material_id, plant_id, default_storage_location_id?, safety_stock?, reorder_point?, min_order_qty?, lead_time_days? }
  return fetchJson("POST:/api/om/material/extend-plant", "POST", payload, "OM_MATERIAL_EXTEND_PLANT_FAILED");
}

// --- Company Maps ---

export async function mapVendorToCompany(payload) {
  // payload: { vendor_id, company_id }
  return fetchJson("POST:/api/om/vendor/company-map", "POST", payload, "OM_VENDOR_COMPANY_MAP_FAILED");
}

export async function mapCustomerToCompany(payload) {
  // payload: { customer_id, company_id }
  return fetchJson("POST:/api/om/customer/company-map", "POST", payload, "OM_CUSTOMER_COMPANY_MAP_FAILED");
}

// --- Storage Location Plant Map ---

export async function mapStorageLocationToPlant(payload) {
  // payload: { storage_location_id, plant_id }
  return fetchJson("POST:/api/om/storage-location/plant-map", "POST", payload, "OM_SLOC_PLANT_MAP_FAILED");
}
```

Use the same internal `fetchJson` helper already in omApi.js.

---

## Step 4 — MaterialDetailPage.jsx: Add 3 Sections

Read the file first. Then add these 3 sections to the detail view (below the UOM conversions section).

### Section A — "Extend to Company"

A collapsible/accordion section titled "Company Extensions":
- Small form with: `company_id` (text input, required, label "Company ID")
- Optional fields: `procurement_allowed` (checkbox, default true), `hsn_override` (text, optional)
- Submit button: "Extend to Company"
- On submit: call `extendMaterialToCompany({ material_id: id, company_id, procurement_allowed, hsn_override })`
- On success: show "Extension saved" message
- On error: show error code

Note: This is an upsert — submitting the same company_id again updates the existing extension.

### Section B — "Extend to Plant"

A collapsible/accordion section titled "Plant Extensions":
- Small form with: `plant_id` (text input, required, label "Plant ID")
- Optional fields: `safety_stock` (number), `reorder_point` (number), `min_order_qty` (number), `lead_time_days` (number)
- Submit button: "Extend to Plant"
- On submit: call `extendMaterialToPlant({ material_id: id, plant_id, safety_stock, reorder_point, min_order_qty, lead_time_days })`
- On success: show "Plant extension saved"
- On error: show error code

Note: This is an upsert.

### Section C — "Approved Vendors" (ME1M view)

A collapsible/accordion section titled "Approved Vendors (ASL)":
- On expand: call `listVendorMaterialInfos({ material_id: id })` — this function already exists in omApi.js
- Show results in a table: vendor_code | vendor_name | po_uom_code | conversion_factor | lead_time_days | status badge
- If no results: show "No approved vendors for this material"
- Loading state while fetching

Add import for `listVendorMaterialInfos` to the imports from omApi.js at top of file.

---

## Step 5 — VendorDetailPage.jsx: Add 2 Sections + Fix 1 Bug

### Fix — Payment Terms Grid Column Keys

Read the `ErpDenseGrid` columns array for the payment terms grid.
Check the column `key` values. The correct DB column names from the backend are:
- `payment_days` (not `payment_terms_days`)
- `payment_method`
- `notes` (not `terms_notes`)
- `recorded_at`
- `recorded_by`

Fix any column key that doesn't match these exact names.

### Section A — "Company Mapping"

A collapsible/accordion section titled "Company Mapping":
- Small form with: `company_id` (text input, required, label "Company ID")
- Submit button: "Map to Company"
- On submit: call `mapVendorToCompany({ vendor_id: id, company_id })`
- On success: show "Vendor mapped to company"
- On error: show error code

Add import for `mapVendorToCompany` at top of file.

### Section B — "Approved Materials (ASL)" (ME1L view)

A collapsible/accordion section titled "Approved Materials (ASL)":
- On expand: call `listVendorMaterialInfos({ vendor_id: id })` — already exists in omApi.js
- Show results in a table: material_code | material_name | po_uom_code | conversion_factor | lead_time_days | status badge
- If no results: show "No approved materials for this vendor"
- Loading state while fetching

Add import for `listVendorMaterialInfos` at top of file.

---

## Step 6 — CustomerDetailPage.jsx: Add 1 Section + Fix 1 Validation

### Fix — delivery_address JS Validation

In the `handleSave` function (or equivalent submit handler):
Before calling `updateCustomer`, add:
```js
if (!form.delivery_address || !form.delivery_address.trim()) {
  setError("DELIVERY_ADDRESS_REQUIRED");
  return;
}
```

### Section A — "Company Mapping"

A collapsible/accordion section titled "Company Mapping":
- Small form with: `company_id` (text input, required, label "Company ID")
- Submit button: "Map to Company"
- On submit: call `mapCustomerToCompany({ customer_id: id, company_id })`
- On success: show "Customer mapped to company"
- On error: show error code

Add import for `mapCustomerToCompany` at top of file.

---

## Step 7 — AslDetailPage.jsx: Fix Status Lifecycle + Add pack_size

### Fix A — Full Status Lifecycle

Currently the page only shows "Set Active" and "Set Inactive" buttons.

Replace this binary toggle with a proper status transitions map — same pattern as MaterialDetailPage.

```js
const ASL_TRANSITIONS = {
  DRAFT:              ["PENDING_APPROVAL"],
  PENDING_APPROVAL:   ["ACTIVE", "DRAFT"],
  ACTIVE:             ["INACTIVE", "BLOCKED"],
  INACTIVE:           ["ACTIVE"],
  BLOCKED:            ["ACTIVE"],
};
```

Render only the allowed target buttons based on `record.status`. Use the same pattern as MaterialDetailPage's status section.

### Fix B — pack_size Editable

In the edit form, add `pack_size_description` as an editable text field:
- Label: "Pack Size Description"
- Optional field
- Include it in the `form` state
- Include it in the `updateVendorMaterialInfo` payload on save

---

## Step 8 — SAOmStorageLocations.jsx: Add Plant Assignment Section

Read the file. Below the storage locations list, add a section titled "Assign Location to Plant":
- Dropdown or text input: storage_location_id — either a select from the loaded list, or a text input for the ID
- Text input: plant_id (required, label "Plant ID")
- Submit button: "Assign to Plant"
- On submit: call `mapStorageLocationToPlant({ storage_location_id, plant_id })`
- On success: show "Storage location assigned to plant"
- On error: show error code

Add import for `mapStorageLocationToPlant` at top of file.

---

## Step 9 — Self-Check Before Submitting

```
[ ] omApi.js — 5 new functions added, all existing functions untouched
[ ] extendMaterialToCompany → POST /api/om/material/extend-company
[ ] extendMaterialToPlant → POST /api/om/material/extend-plant
[ ] mapVendorToCompany → POST /api/om/vendor/company-map
[ ] mapCustomerToCompany → POST /api/om/customer/company-map
[ ] mapStorageLocationToPlant → POST /api/om/storage-location/plant-map

[ ] MaterialDetailPage — "Company Extensions" section added
[ ] MaterialDetailPage — "Plant Extensions" section added
[ ] MaterialDetailPage — "Approved Vendors (ASL)" section added (ME1M view)
[ ] MaterialDetailPage — no existing sections removed

[ ] VendorDetailPage — payment terms grid column keys fixed (payment_days, payment_method, notes, recorded_at)
[ ] VendorDetailPage — "Company Mapping" section added
[ ] VendorDetailPage — "Approved Materials (ASL)" section added (ME1L view)
[ ] VendorDetailPage — no existing sections removed

[ ] CustomerDetailPage — delivery_address JS validation added in handleSave
[ ] CustomerDetailPage — "Company Mapping" section added
[ ] CustomerDetailPage — no existing sections removed

[ ] AslDetailPage — full status lifecycle (DRAFT/PENDING_APPROVAL/ACTIVE/INACTIVE/BLOCKED)
[ ] AslDetailPage — pack_size_description editable in edit form
[ ] AslDetailPage — no existing functionality removed

[ ] SAOmStorageLocations — "Assign Location to Plant" section added
[ ] SAOmStorageLocations — no existing functionality removed

[ ] No new files created
[ ] No backend files touched
[ ] No TypeScript files created
[ ] No useNavigate() added
[ ] No hardcoded API URLs
```

---

## Step 10 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

Gate-15C section is already in the log. After each file:
```
| 15C.X | item | DONE | path/to/file | - | - |
```

After all 6 files:
```
Gate-15C implementation complete. All 6 files updated. Awaiting Claude verification.
```

---

## Step 11 — Hard Stop

After Gate-15C, stop. Claude verifies.
When Gate-15C is VERIFIED, L1 is truly complete.

---

*Task issued: 2026-05-09*
*Gate-12B VERIFIED ✅*
