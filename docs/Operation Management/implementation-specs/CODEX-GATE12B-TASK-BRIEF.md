# CODEX TASK BRIEF — Gate-12B: Cost Center Master + Machine Master

**To:** Codex
**From:** Claude (acting as architect)
**Date:** 2026-05-09
**Gate:** 12B
**Dependency status:** Gate-15 VERIFIED ✅ — proceed
**Your task:** Build two new SA-owned master tables (Cost Center + Machine) — full stack: migration → handler → route → frontend screen. Nothing else.

---

## Step 1 — Read These Files First

1. `supabase/migrations/20260509125000_gate12_12_6_create_vendor_master.sql`
   → Pattern for erp_master schema migrations.

2. `supabase/functions/api/_core/om/uom.handlers.ts`
   → Exact pattern for SA-only handlers (assertOmSaContext, assertOmAdminContext).

3. `supabase/functions/api/_core/om/shared.ts`
   → OmHandlerContext type, assertOmSaContext, assertOmAdminContext.

4. `supabase/functions/api/_routes/om.routes.ts`
   → You will add 4 route cases here.

5. `frontend/src/admin/sa/screens/SAOmUomMaster.jsx`
   → Exact pattern for SA screens.

6. `frontend/src/pages/dashboard/om/omApi.js`
   → You will add 4 functions here.

7. `frontend/src/navigation/screens/adminScreens.js`
   → You will add 2 entries.

8. `frontend/src/router/AppRouter.jsx`
   → You will add 2 imports + 2 routes.

9. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
   → Update Gate-12B section after each item.

---

## Step 2 — What You Are Building

### Cost Center Master
SA-owned. Company-scoped. Used by process orders and stock documents to attribute cost.

**DB table:** `erp_master.cost_center_master`
**Handlers:** `createCostCenterHandler`, `listCostCentersHandler`
**SA screen:** `SACostCenterMaster.jsx`
**Routes:**
- `POST:/api/om/cost-center` → SA only
- `GET:/api/om/cost-centers` → SA + ADMIN

### Machine/Mixer Master
SA-owned. Plant-scoped. Process orders require machine assignment before saving.

**DB table:** `erp_master.machine_master`
**Handlers:** `createMachineHandler`, `listMachinesHandler`
**SA screen:** `SAMachineMaster.jsx`
**Routes:**
- `POST:/api/om/machine` → SA only
- `GET:/api/om/machines` → SA + ADMIN

---

## Step 3 — Files Summary

### Create (6 new files):
```
supabase/migrations/20260509200000_gate12b_cost_center_master.sql
supabase/migrations/20260509201000_gate12b_machine_master.sql
supabase/functions/api/_core/om/cost_center.handlers.ts
supabase/functions/api/_core/om/machine.handlers.ts
frontend/src/admin/sa/screens/SACostCenterMaster.jsx
frontend/src/admin/sa/screens/SAMachineMaster.jsx
```

### Update (4 existing files):
```
supabase/functions/api/_routes/om.routes.ts
frontend/src/pages/dashboard/om/omApi.js
frontend/src/navigation/screens/adminScreens.js
frontend/src/router/AppRouter.jsx
```

---

## Step 4 — DB Migrations

### 12B.1 — cost_center_master

**File:** `supabase/migrations/20260509200000_gate12b_cost_center_master.sql`

```sql
/*
 * File-ID: 12B.1
 * File-Path: supabase/migrations/20260509200000_gate12b_cost_center_master.sql
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Cost center master table for SA-governed cost attribution.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.cost_center_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  cost_center_code    text NOT NULL,
  cost_center_name    text NOT NULL,
  description         text NULL,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,

  UNIQUE (company_id, cost_center_code)
);

CREATE INDEX idx_ccm_company ON erp_master.cost_center_master (company_id);
CREATE INDEX idx_ccm_active  ON erp_master.cost_center_master (active);

COMMENT ON TABLE erp_master.cost_center_master IS
'SA-owned cost centers. Company-scoped. Used by process orders and stock documents for cost attribution.';

GRANT SELECT, INSERT, UPDATE ON erp_master.cost_center_master TO service_role;

COMMIT;
```

### 12B.2 — machine_master

**File:** `supabase/migrations/20260509201000_gate12b_machine_master.sql`

Machine types are: `MIXER`, `FILLING`, `PACKAGING`, `REACTOR`, `OTHER`

```sql
/*
 * File-ID: 12B.2
 * File-Path: supabase/migrations/20260509201000_gate12b_machine_master.sql
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Machine/mixer master table for SA-governed plant equipment.
 * Authority: Backend
 */

BEGIN;

CREATE TABLE IF NOT EXISTS erp_master.machine_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Plant this machine belongs to (references erp_master.projects)
  plant_id            uuid NOT NULL,

  machine_code        text NOT NULL,
  machine_name        text NOT NULL,

  -- Type of machine
  machine_type        text NOT NULL
    CHECK (machine_type IN ('MIXER','FILLING','PACKAGING','REACTOR','OTHER')),

  -- Optional capacity info
  capacity_per_batch  numeric NULL CHECK (capacity_per_batch > 0),
  capacity_uom_code   text NULL,

  description         text NULL,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,

  UNIQUE (plant_id, machine_code)
);

CREATE INDEX idx_mm_plant  ON erp_master.machine_master (plant_id);
CREATE INDEX idx_mm_active ON erp_master.machine_master (active);
CREATE INDEX idx_mm_type   ON erp_master.machine_master (machine_type);

COMMENT ON TABLE erp_master.machine_master IS
'SA-owned machine/mixer master. Plant-scoped. Process orders require machine assignment before saving.';

GRANT SELECT, INSERT, UPDATE ON erp_master.machine_master TO service_role;

COMMIT;
```

---

## Step 5 — Backend Handlers

### 12B.3 — cost_center.handlers.ts

**File:** `supabase/functions/api/_core/om/cost_center.handlers.ts`

```typescript
/*
 * File-ID: 12B.3
 * File-Path: supabase/functions/api/_core/om/cost_center.handlers.ts
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Cost center master CRUD handlers (SA-governed).
 * Authority: Backend
 */
```

**Implement these two handlers:**

**`createCostCenterHandler(req, ctx)`**
- Guard: `assertOmSaContext(ctx)`
- Parse body: `{ company_id, cost_center_code, cost_center_name, description? }`
- Validate: `company_id`, `cost_center_code`, `cost_center_name` all required and non-empty
- Insert into `erp_master.cost_center_master`
- On duplicate (error.code === "23505"): return `okResponse({ code: "OM_CC_EXISTS" }, ctx.request_id, req)` with status 409
- On success: return `okResponse(row, ctx.request_id, req)`

**`listCostCentersHandler(req, ctx)`**
- Guard: `assertOmAdminContext(ctx)`
- Query params: `company_id` (optional filter), `active` (optional: "true"/"false", default all)
- Query `erp_master.cost_center_master` with filters
- Order by `cost_center_code ASC`
- Return `okResponse(rows, ctx.request_id, req)`

Follow the exact same code patterns as `uom.handlers.ts` — same imports, same service role client usage, same error handling. Always use `serviceRoleClient.schema("erp_master").from("cost_center_master")`.

### 12B.4 — machine.handlers.ts

**File:** `supabase/functions/api/_core/om/machine.handlers.ts`

```typescript
/*
 * File-ID: 12B.4
 * File-Path: supabase/functions/api/_core/om/machine.handlers.ts
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: Machine/mixer master CRUD handlers (SA-governed).
 * Authority: Backend
 */
```

**Implement these two handlers:**

**`createMachineHandler(req, ctx)`**
- Guard: `assertOmSaContext(ctx)`
- Parse body: `{ plant_id, machine_code, machine_name, machine_type, capacity_per_batch?, capacity_uom_code?, description? }`
- Validate: `plant_id`, `machine_code`, `machine_name`, `machine_type` all required
- Validate `machine_type` is one of: `MIXER | FILLING | PACKAGING | REACTOR | OTHER`
- Insert into `erp_master.machine_master`
- On duplicate (error.code === "23505"): return 409 with `OM_MACHINE_EXISTS`
- On success: return `okResponse(row, ctx.request_id, req)`

**`listMachinesHandler(req, ctx)`**
- Guard: `assertOmAdminContext(ctx)`
- Query params: `plant_id` (optional), `machine_type` (optional), `active` (optional)
- Query `erp_master.machine_master` with filters
- Order by `machine_code ASC`
- Return `okResponse(rows, ctx.request_id, req)`

---

## Step 6 — Route Updates

### 12B.5 — om.routes.ts

Add these imports at the top (with other imports):
```typescript
import {
  createCostCenterHandler,
  listCostCentersHandler,
} from "../_core/om/cost_center.handlers.ts";
import {
  createMachineHandler,
  listMachinesHandler,
} from "../_core/om/machine.handlers.ts";
```

Add these 4 cases to the switch statement (before the `default: return null`):
```typescript
case "POST:/api/om/cost-center":
  return await createCostCenterHandler(req, ctx);
case "GET:/api/om/cost-centers":
  return await listCostCentersHandler(req, ctx);

case "POST:/api/om/machine":
  return await createMachineHandler(req, ctx);
case "GET:/api/om/machines":
  return await listMachinesHandler(req, ctx);
```

Do NOT change any existing cases.

---

## Step 7 — Frontend

### 12B.6 — omApi.js additions

Add these 4 functions AFTER existing functions in `omApi.js`:

```js
// --- Cost Center ---

export async function listCostCenters(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return fetchJson(`GET:/api/om/cost-centers${qs ? "?" + qs : ""}`, "GET", null, "OM_CC_LIST_FAILED");
}

export async function createCostCenter(payload) {
  return fetchJson("POST:/api/om/cost-center", "POST", payload, "OM_CC_CREATE_FAILED");
}

// --- Machine ---

export async function listMachines(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return fetchJson(`GET:/api/om/machines${qs ? "?" + qs : ""}`, "GET", null, "OM_MACHINE_LIST_FAILED");
}

export async function createMachine(payload) {
  return fetchJson("POST:/api/om/machine", "POST", payload, "OM_MACHINE_CREATE_FAILED");
}
```

Note: Follow the exact internal helper pattern already in `omApi.js`.

### 12B.7 — SACostCenterMaster.jsx

**File:** `frontend/src/admin/sa/screens/SACostCenterMaster.jsx`

**File header:**
```jsx
/*
 * File-ID: 12B.7
 * File-Path: frontend/src/admin/sa/screens/SACostCenterMaster.jsx
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: SA screen — Cost Center master list and create.
 * Authority: Frontend
 */
```

**Behaviour:**
- On mount: call `listCostCenters()` → render list
- List columns: cost_center_code, cost_center_name, description (or "—"), active badge
- Inline create form (always visible): company_id dropdown (use context/session company — or a text input if company selection is needed), cost_center_code (required), cost_center_name (required), description (optional)
- Submit calls `createCostCenter(payload)` → refreshes list
- No cross-screen navigation needed

**Note on company_id:** Use a simple text input for now — SA will know their company IDs. Or if the codebase has a company context hook, use it. Do not build a company dropdown from scratch if one doesn't exist.

### 12B.8 — SAMachineMaster.jsx

**File:** `frontend/src/admin/sa/screens/SAMachineMaster.jsx`

**File header:**
```jsx
/*
 * File-ID: 12B.8
 * File-Path: frontend/src/admin/sa/screens/SAMachineMaster.jsx
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: SA screen — Machine/Mixer master list and create.
 * Authority: Frontend
 */
```

**Behaviour:**
- On mount: call `listMachines()` → render list
- List columns: machine_code, machine_name, machine_type badge, capacity_per_batch + capacity_uom_code (or "—"), active badge
- Inline create form: plant_id input (text — SA knows plant IDs), machine_code (required), machine_name (required), machine_type dropdown (MIXER / FILLING / PACKAGING / REACTOR / OTHER), capacity_per_batch (number, optional), capacity_uom_code (text, optional), description (optional)
- Submit calls `createMachine(payload)` → refreshes list
- No cross-screen navigation needed

### 12B.9 — adminScreens.js

Add 2 entries (after the SA_OM_MCG entry from Gate-15B, or after SA_OM_NUMBER_SERIES if 15B not yet done):

```js
SA_OM_COST_CENTER: {
  screen_code: "SA_OM_COST_CENTER",
  label: "Cost Centers",
  route: "/sa/om/cost-centers",
  universe: "ADMIN",
},
SA_OM_MACHINES: {
  screen_code: "SA_OM_MACHINES",
  label: "Machine Master",
  route: "/sa/om/machines",
  universe: "ADMIN",
},
```

Do NOT modify any existing entry.

### 12B.10 — AppRouter.jsx

Add imports (with other SA OM imports):
```jsx
import SACostCenterMaster from "../admin/sa/screens/SACostCenterMaster";
import SAMachineMaster from "../admin/sa/screens/SAMachineMaster";
```

Add routes (with other `/sa/om/*` routes):
```jsx
<Route path="om/cost-centers" element={<SACostCenterMaster />} />
<Route path="om/machines" element={<SAMachineMaster />} />
```

Do NOT modify any existing route.

---

## Step 8 — Self-Check Before Submitting

```
[ ] cost_center_master migration — erp_master schema, UNIQUE(company_id, cost_center_code), GRANT to service_role
[ ] machine_master migration — erp_master schema, CHECK on machine_type, UNIQUE(plant_id, machine_code), GRANT to service_role
[ ] cost_center.handlers.ts — file header, assertOmSaContext on create, assertOmAdminContext on list, erp_master schema access
[ ] machine.handlers.ts — file header, assertOmSaContext on create, assertOmAdminContext on list, machine_type validated, erp_master schema access
[ ] om.routes.ts — 4 new cases added, all existing cases untouched
[ ] omApi.js — 4 new functions added, all existing functions untouched
[ ] SACostCenterMaster.jsx — file header, list + create form, .jsx extension, no useNavigate
[ ] SAMachineMaster.jsx — file header, list + create form, machine_type dropdown with 5 options, .jsx extension, no useNavigate
[ ] adminScreens.js — 2 new entries added, nothing else changed
[ ] AppRouter.jsx — 2 imports + 2 routes added, nothing else changed
[ ] No TypeScript (.ts) files created for frontend
[ ] No .tsx files created
[ ] No hardcoded API URLs
[ ] credentials: "include" on all fetches (via omApi helpers)
```

---

## Step 9 — Log Update

File: `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`

After each file:
```
| 12B.X | item name | DONE | path/to/file | - | - |
```

After all 10 items done:
```
Gate-12B implementation complete. All 10 items done. Awaiting Claude verification.
```

---

## Step 10 — Hard Stop

After Gate-12B, stop. Claude verifies both Gate-15B and Gate-12B.

When both are VERIFIED, L1 is complete.

---

*Task issued: 2026-05-09*
*Gate-15 VERIFIED ✅*
*Gate-15B and Gate-12B can be implemented in any order or in parallel.*
