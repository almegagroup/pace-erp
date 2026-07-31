# CODEX-GATE27.27-MM05-DISPATCH-CUSTOMER-TASK-BRIEF

**Gate:** 27.27
**Domain:** OM MASTERS (ACL)
**TX Code:** MM05
**Title:** FG Dispatch Customer Master — Parent Company (state-wise GST entity) → Depot Code (real, inline address) or Virtual Depot Code (→ Customer → multiple Address rows), Registered/Unregistered with GST-lookup, State-consistency guard.
**Reference doc:** feasibility doc `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`, **Section 114**, specifically **§114.2/§114.3** (Depot vs Virtual Depot concepts), **§114.12** (why this is a separate master from `om/customer`), **§114.13** (data hierarchy + page fork), **§114.15** (TX code MM05, ACL group, company-scope, `fo_customer_type` reuse), **§114.16** (State-consistency validation). **Read all of §114 before starting** — this is the most structurally involved of the three briefs in this batch and the doc has far more reasoning/examples than this brief repeats.

---

## Before you write any code

1. Read **CLAUDE.md** §8, §8A, §8B.
2. Read `frontend/src/pages/dashboard/om/customer/CustomerCreateForm.jsx` and `supabase/functions/api/_core/om/customer.handlers.ts` in full — MM04 (existing RM/PM Customer Master) is the closest UI/pattern precedent (GST lookup + overwrite, company mapping, billing state) even though MM05 is a **structurally separate master**, not an extension of `customer_master`. Reuse the *patterns* (GST-lookup-then-overwrite UI, company-scope-on-create), not the table.
3. Read `frontend/src/data/indianStates.js` (`INDIAN_STATES`, `matchIndianStateName`) — built this session specifically for this kind of State dropdown. **Every State field in this brief uses this exact shared list/component**, no free text, no separate state list.
4. Read `supabase/functions/api/_core/om/customer.handlers.ts`'s `lookupCustomerGstProfileHandler` / `frontend/.../omApi.js`'s `lookupCustomerGstProfile()` — the GST-lookup endpoint (`GET /api/om/customer/gst-profile?gst_number=`) is **generic**, not customer-specific despite its path. Reuse it as-is for Parent Company, Customer, and the Unregistered→Registered upgrade flow — do not build a second GST-lookup endpoint.
5. **When wiring a fetched GST profile's `state_name` into a State dropdown, run it through `matchIndianStateName()` first** (see the same fix already applied in `frontend/src/admin/sa/screens/SAVendorMaster.jsx`'s `handleGstLookup` this session) — external GST API spelling doesn't always exactly match the canonical list, and an unmatched raw string would silently leave the `<select>` unselected.
6. You have Supabase MCP access to Dev (`ytapuwiqicmvpanmzelb`). Re-verify every table/column referenced here against live Dev before use.
7. **Do NOT touch ACL/menu registration** — Claude's job via MCP afterward. You only add `route-acl-registry.ts` entries.
8. Migration discipline — same as the other two briefs in this batch (§8A Migration Integrity, Dev only).

---

## ⚠️ A naming resolution this brief makes on your behalf — sanity-check it against §114 before coding

§114.13 locks: **MM05's top-level UI fork ("Type: Direct" vs "Type: Depot") IS the same fork as §114.2's real-Depot vs §114.3's Virtual-Depot** — "Direct" uses the Virtual Depot chain (full Parent Company→VD Code→Customer→Address), "Depot" uses the real Depot chain (Parent Company→Depot Code→inline address, no Customer layer). To avoid two different vocabularies for the same fork, this brief names the DB enum to match the **UI's own words** (`DIRECT` / `DEPOT`) rather than introducing a separate `VIRTUAL_DEPOT` DB value — read §114.2/§114.3/§114.13 together and confirm this mapping is right before building; if your own reading of the doc disagrees, log the discrepancy rather than silently picking one.

---

## Ground truth for reuse

- Company-scope: `getCompanyScope`, `TransactionCompanySelector.jsx` — **only relevant if MM05 records end up being company-scoped at all**. Re-read §114.15's company-mapping note: it describes AC05/AC06 as company-specific and describes MM05 the same way ("multi-company হলে company choose") — but Parent Company/Depot Code conceptually belong to a *dispatch relationship*, not one selling company. **Confirm with the referenced doc section (and flag if ambiguous) whether "company" here means the *selling* company (`erp_map.user_companies` scope) attached to each Parent Company/Customer/Address row, or something else** — this brief assumes it's the standard selling-company scope (a `company_id` column on `fg_parent_company`, following the same `getCompanyScope` pattern as every other master this session), matching how AC05/AC06 do it, but this wasn't spelled out as explicitly for MM05 as it was for the other two — verify before assuming.
- GST lookup: `GET /api/om/customer/gst-profile?gst_number=` — generic, reuse as-is (see above).
- Address-state validation: needs a join from address → depot code → parent company → state, or (for real Depot) depot code → parent company → state directly. See Change 4.
- Dense grid / drawer / hotkeys: same components as the AC05/AC06 briefs.

---

## Change 1 — Migration: 4 new tables in `erp_master`

```sql
CREATE TABLE erp_master.fg_parent_company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES erp_master.companies(id),  -- selling company scope, see note above
  company_name text NOT NULL,          -- e.g. "Asian Paints"
  gst_number text,
  state text NOT NULL,                 -- INDIAN_STATES value; one Parent Company row PER STATE (§114.13)
  full_address text,
  pin_code text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (company_id, company_name, state)
);

CREATE TABLE erp_master.fg_depot_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_company_id uuid NOT NULL REFERENCES erp_master.fg_parent_company(id),
  dispatch_type text NOT NULL CHECK (dispatch_type IN ('DIRECT', 'DEPOT')),  -- see naming note above
  code text NOT NULL,                  -- given BY Asian Paints -- manual text entry, never system-generated
  description text,
  -- populated only when dispatch_type = 'DEPOT' (real depot, no separate Customer layer):
  address_line text,
  state text,
  pin_code text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz,
  UNIQUE (parent_company_id, code)
);

CREATE TABLE erp_master.fg_dispatch_customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  registration_type text NOT NULL CHECK (registration_type IN ('REGISTERED', 'UNREGISTERED')),
  gst_number text,
  -- §114.21 LOCKED (2026-07-31, resolves the ambiguity an earlier Codex pass correctly
  -- paused on): "reuse fo_customer_type" means the same column NAME and the same
  -- allowed values as erp_master.customer_master.fo_customer_type (MTO_HPS/ZTEST/MTS)
  -- -- on THIS table's own column. It is explicitly NOT a literal shared row/column
  -- with customer_master. Confirmed by the business owner after the conflict was
  -- raised: §114.12's "structurally separate master" decision stands; "reuse" was
  -- about naming/value consistency, not data-sharing. Proceed with this schema as-is.
  fo_customer_type text CHECK (fo_customer_type IN ('MTO_HPS', 'ZTEST', 'MTS')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz
);

-- one row per (customer, address) -- a customer's different addresses can each
-- route through a DIFFERENT depot_code_id, per §114.3's four scenarios,
-- including across different Parent Companies/states (scenario 4).
CREATE TABLE erp_master.fg_dispatch_customer_address (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES erp_master.fg_dispatch_customer(id),
  depot_code_id uuid NOT NULL REFERENCES erp_master.fg_depot_code(id),  -- must be dispatch_type='DIRECT'
  address_line text NOT NULL,
  state text NOT NULL,                 -- INDIAN_STATES value, mandatory (§114.13)
  pin_code text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz
);
```

Add a CHECK or trigger (your call which is cleaner given this codebase's existing conventions — check how similar "only valid when parent type is X" rules are enforced elsewhere, e.g. `sales_invoice`'s `sales_invoice_customer_xor_sto_check`, before picking) ensuring `fg_dispatch_customer_address.depot_code_id` only ever references a `fg_depot_code` row with `dispatch_type = 'DIRECT'` — a `DEPOT`-type depot code should never have address rows in this table (its address lives inline on `fg_depot_code` itself).

## Change 2 — Backend: `supabase/functions/api/_core/om/fg_dispatch_customer.handlers.ts` (new file)

**Parent Company:**
1. `createParentCompanyHandler` (`POST`) — `{company_id, company_name, state, gst_number}` → optional GST-lookup-fetched fields, all overwritable before save (per §114.13 "Create নতুন হলে GST fetch → overwrite → Save").
2. `listParentCompaniesHandler` (`GET ?company_id=&state=`) — for the "Create or Select" picker.

**Depot Code:**
3. `createOrGetDepotCodeHandler` (`POST`) — `{parent_company_id, dispatch_type, code, description, address_line?, state?, pin_code?}`. For `dispatch_type='DEPOT'`: address fields required. For `dispatch_type='DIRECT'`: address fields must be absent/null (address comes later via the Customer/Address flow).
4. `listDepotCodesHandler` (`GET ?parent_company_id=&dispatch_type=`).

**Customer (DIRECT-type flow only):**
5. `createDispatchCustomerHandler` (`POST`) — `{name, registration_type, gst_number?, fo_customer_type}`. If `registration_type='REGISTERED'`, GST-lookup-fetched fields available for overwrite; `UNREGISTERED` skips GST entirely.
6. `upgradeDispatchCustomerToRegisteredHandler` (`POST /:id/upgrade-gst`) — **separate handler**, matching this batch's established separation-of-duties convention even though this isn't strictly a Draft/Approve case — it's a distinct, deliberate state transition (§114.12's modal flow: GST fetch → overwrite → then choose replace-existing-address-or-add-new). Body: `{gst_number, overwrite_fields: {...}, address_action: 'REPLACE'|'ADD_NEW', target_address_id?}`.

**Address:**
7. `addDispatchCustomerAddressHandler` (`POST /customers/:id/addresses`) — `{depot_code_id, address_line, state, pin_code}`. **Runs the §114.16 state-consistency check before insert** (Change 4).
8. `updateDispatchCustomerAddressHandler` (`PATCH /addresses/:id`) — same state-consistency check on any state/depot_code_id change.
9. `listDispatchCustomerAddressesHandler` (`GET /customers/:id/addresses`) — bulk-resolves each address's `depot_code` (code, description) and `parent_company` (name, state) for display — never raw UUIDs (§8A).

## Change 3 — Frontend: MM05 page

Top-level fork per §114.13:
- **Type = Direct:** Parent Company (Create/Select) → Depot Code create with `dispatch_type='DIRECT'` (or select an existing DIRECT-type code under that Parent Company) + description → Customer (Registered/Unregistered, GST fetch/overwrite) → Address(es) (State mandatory via `INDIAN_STATES`, multiple allowed, each tagged with the specific Depot Code it routes through — reuse the "Create or Select Depot Code" picker again per-address, per §114.13's Add-Address confirmation that Parent Company can *also* be re-picked per address).
- **Type = Depot:** Parent Company (Create/Select) → Depot Code create with `dispatch_type='DEPOT'` + inline address fields directly on the same form (no separate Customer/Address step).

Unregistered→Registered upgrade: a Modal (§114.12) — GST Number + "Check GST" → fetched fields shown for overwrite → if the customer has 2+ existing addresses, ask which to replace vs "add as new."

## Change 4 — State-consistency validation (§114.16, hard block)

On every address create/update (Change 2.7/2.8) and on `fg_depot_code` create/update for `dispatch_type='DEPOT'` rows (their own inline address vs their Parent Company's state):

```
address.state (or depot_code.state for DEPOT-type) MUST equal the linked depot_code's parent_company.state
```

If mismatched: **do not insert/update**, return a 400 with a clear message (frontend shows this as an Alert per §114.16, and blocks Save). This is a genuine data-entry-error guard (wrong Depot Code picked, or wrong State typed) — not a soft warning.

---

## Hard rules

1. `fg_depot_code.code` is **always manually typed**, never system-generated — it comes from Asian Paints, this codebase must not invent a sequence/counter for it (unlike `customer_code`/`vendor_code`, which ARE system-generated — don't copy that pattern here by mistake).
2. State fields everywhere in this brief use `INDIAN_STATES` (`frontend/src/data/indianStates.js`) exclusively — no free-text state input anywhere in MM05.
3. §114.16's state-consistency check is a **hard block**, not a warning-only — re-verify server-side even though the frontend should also prevent submission, same "never trust the client alone" rule as every other hard-block in this codebase.
4. No Approval workflow on MM05 records (§114.15 CONFIRMED) — every create/edit is immediately active. Don't add a Draft/status gate here even though AC05/AC06 (the other two briefs in this batch) have one — MM05 is deliberately different.
5. Company scope validated on every handler that touches `fg_parent_company` (create, list) — per the open question flagged above, confirm what "company" means here before assuming the standard `getCompanyScope` pattern applies unchanged; if it does, apply it consistently (checklist item #2 — company-scope gaps are the single most repeated bug class in this codebase's own audit history).
6. No raw UUIDs anywhere in the UI — every Depot Code/Parent Company/Address reference resolves to its human-readable fields.

## Explicitly out of scope

- SO Create's "Address Drawer" (§114.14) that consumes this master — future brief, not this one. Build the CRUD + list endpoints only; the drawer's specific query shape (matching the Gate-Entry-CSN-drawer UI pattern) is SO's own concern later.
- ACL/menu registration — Claude's job via MCP, same as the other two briefs.
- Real Depot's own multi-address support (if it turns out real Depot ever needs more than one address per Depot Code) — not discussed in §114, this brief assumes one inline address per `DEPOT`-type `fg_depot_code` row. Flag if you find evidence otherwise, don't invent multi-address support for the DEPOT path.

## Verification

1. Create a Parent Company for one state (e.g. "Asian Paints", Punjab).
2. Create a `DEPOT`-type Depot Code under it with a matching Punjab address — confirm save succeeds. Attempt the same with a mismatched state (e.g. Gujarat address) — confirm hard-block.
3. Create a `DIRECT`-type Depot Code under the same Parent Company, then a Customer, then an Address linked to that Depot Code with the correct (Punjab) state — confirm succeeds; mismatched state — confirm hard-block.
4. Create a second Address for the same Customer under a **different** Parent Company/state (scenario 4 from §114.3) — confirm this is allowed (no false "must match a previous address" constraint).
5. Create an Unregistered customer, then run the upgrade-to-Registered flow with 2 existing addresses — confirm the replace-vs-add-new choice is honored correctly in both directions.
6. `deno check` clean against documented baseline. `node scripts/migration-integrity-check.mjs` → `in_sync = true`.

## Log + commit

- Append entries to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md` (Gate-27.27).
- Commit with `Co-Authored-By: Codex`. **Do not push.**
