# CODEX TASK BRIEF — Gate-15B: Material Category Group Frontend

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 15B
**Dependency status:** Gate-15 VERIFIED ✅ — proceed
**Your task:** Add MCG (Material Category Group) SA screen + 3 API functions + nav wiring. Nothing else.

---

## Context

The Material Category Group backend is ALREADY DONE:
- DB tables: `erp_master.material_category_group` + `erp_master.material_category_group_member` (Gate-12)
- Backend handlers: `createMaterialCategoryGroupHandler`, `listMaterialCategoryGroupsHandler`, `addMaterialCategoryMemberHandler` (Gate-14)
- Routes in `om.routes.ts`:
  - `POST:/api/om/material/category-group`
  - `GET:/api/om/material/category-groups`
  - `POST:/api/om/material/category-group/member`

You only need to build the frontend.

---

## Step 1 — Read These Files First

1. `frontend/src/pages/dashboard/om/omApi.js`
   → You will ADD 3 functions to this file. Do not touch existing functions.

2. `frontend/src/admin/sa/screens/SAOmUomMaster.jsx`
   → Exact pattern for your new SA screen. Copy the structure.

3. `frontend/src/navigation/screens/adminScreens.js`
   → You will add 1 entry. Do not touch existing entries.

4. `frontend/src/router/AppRouter.jsx`
   → You will add 1 import + 1 route. Do not touch existing routes.

5. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Update Gate-15B section after each item.

---

## Step 2 — What You Are Building

**One SA screen:** `SAOmMaterialCategoryGroups.jsx`

This screen:
- Lists all material category groups (group name, description, active status)
- Shows member count per group in the list
- Has an inline create form: group_name (required), description (optional)
- When a group row is clicked/expanded, shows its members (material_name + is_primary badge)
- Has an "Add Member" form in the expanded section: material search dropdown + is_primary checkbox
- SA role only (the SA shell already enforces this — no role check needed in the component)

---

## Step 3 — Files to Create/Update

### Create (1 new file):
```
frontend/src/admin/sa/screens/SAOmMaterialCategoryGroups.jsx
```

### Update (3 existing files):
```
frontend/src/pages/dashboard/om/omApi.js        ← ADD 3 functions
frontend/src/navigation/screens/adminScreens.js  ← ADD 1 entry
frontend/src/router/AppRouter.jsx                ← ADD 1 import + 1 route
```

---

## Step 4 — API Functions to Add to omApi.js

Add these 3 functions AFTER the existing functions. Do not modify existing functions.

```js
// --- Material Category Group ---

export async function listMaterialCategoryGroups() {
  return fetchJson("GET:/api/om/material/category-groups", "GET", null, "OM_MCG_LIST_FAILED");
}

export async function createMaterialCategoryGroup(payload) {
  return fetchJson("POST:/api/om/material/category-group", "POST", payload, "OM_MCG_CREATE_FAILED");
}

export async function addMaterialCategoryMember(payload) {
  // payload: { group_id, material_id, is_primary }
  return fetchJson("POST:/api/om/material/category-group/member", "POST", payload, "OM_MCG_MEMBER_ADD_FAILED");
}
```

Note: Use whatever internal helper pattern `omApi.js` already uses (it likely has a `fetchJson` or similar helper — follow that pattern exactly).

---

## Step 5 — SAOmMaterialCategoryGroups.jsx

### File header (required):
```jsx
/*
 * File-ID: 15B.2
 * File-Path: frontend/src/admin/sa/screens/SAOmMaterialCategoryGroups.jsx
 * Gate: 15B
 * Phase: 15B
 * Domain: MASTER
 * Purpose: SA screen — Material Category Group list, create, and member management.
 * Authority: Frontend
 */
```

### Behaviour:
- On mount: call `listMaterialCategoryGroups()` → render list
- Each row in the list shows: group_name, description (or "—"), active badge, member count
- Clicking a row toggles an expanded section below it showing:
  - List of members: material_code + material_name + is_primary badge (primary = green)
  - "Add Member" form: material_id dropdown (use `listMaterials()` from omApi), is_primary checkbox, Submit button
  - Submitting Add Member calls `addMaterialCategoryMember({ group_id, material_id, is_primary })` then refreshes
- Above the list: "Create Group" form (always visible, not toggled):
  - group_name input (required)
  - description textarea (optional)
  - Submit → calls `createMaterialCategoryGroup(payload)` → refreshes list
- Loading and error states required

### Important rules:
- `.jsx` extension only
- No `useNavigate()` — this is an SA screen, no cross-screen navigation needed
- `credentials: "include"` on every fetch (handled by omApi functions)
- No hardcoded URLs

---

## Step 6 — adminScreens.js Update

Add this entry to the `ADMIN_SCREENS` object (after the SA_OM_NUMBER_SERIES entry):

```js
SA_OM_MCG: {
  screen_code: "SA_OM_MCG",
  label: "Material Category Groups",
  route: "/sa/om/material-category-groups",
  universe: "ADMIN",
},
```

Do NOT remove or modify any existing entry.

---

## Step 7 — AppRouter.jsx Update

Add import (with other SA OM imports):
```jsx
import SAOmMaterialCategoryGroups from "../admin/sa/screens/SAOmMaterialCategoryGroups";
```

Add route (with other `/sa/om/*` routes):
```jsx
<Route path="om/material-category-groups" element={<SAOmMaterialCategoryGroups />} />
```

Do NOT remove or modify any existing route.

---

## Step 8 — Self-Check Before Submitting

```
[ ] omApi.js — 3 new functions added, existing 30 functions untouched
[ ] listMaterialCategoryGroups — GET /api/om/material/category-groups
[ ] createMaterialCategoryGroup — POST /api/om/material/category-group
[ ] addMaterialCategoryMember — POST /api/om/material/category-group/member
[ ] SAOmMaterialCategoryGroups.jsx — file header present
[ ] SAOmMaterialCategoryGroups.jsx — list loads on mount
[ ] SAOmMaterialCategoryGroups.jsx — create group form works
[ ] SAOmMaterialCategoryGroups.jsx — expand row shows members
[ ] SAOmMaterialCategoryGroups.jsx — add member form works
[ ] SAOmMaterialCategoryGroups.jsx — no useNavigate
[ ] SAOmMaterialCategoryGroups.jsx — .jsx extension
[ ] adminScreens.js — SA_OM_MCG added, nothing else changed
[ ] AppRouter.jsx — 1 import + 1 route added, nothing else changed
[ ] No backend files touched
[ ] No TypeScript files created
```

---

## Step 9 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file:
```
| 15B.X | item name | DONE | path/to/file | - | - |
```

After all 4 items done:
```
Gate-15B implementation complete. All 4 items done. Awaiting Claude verification.
```

---

## Step 10 — Hard Stop

After Gate-15B, stop. Claude verifies.

This is a small gate — 4 file changes only. Do not touch Gate-12B items (those are in a separate brief).

---

*Task issued: 2026-05-09*
*Gate-15 VERIFIED ✅*
*Do not start Gate-12B work — that is a separate brief.*
