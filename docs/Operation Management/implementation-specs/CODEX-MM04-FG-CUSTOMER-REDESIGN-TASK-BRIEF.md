# CODEX-MM04-FG-CUSTOMER-REDESIGN-TASK-BRIEF

Full design authority: `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
Section 129 (LOCKED 2026-08-22). Read Section 129 in full before touching any code — this brief
is the build checklist derived from it, not a replacement for it. Where this brief and §129
disagree, §129 wins; report the discrepancy instead of guessing.

## 0. Non-negotiable rules

- CLAUDE.md §8A-§8E apply in full: no raw UUIDs in any UI, `useQuery` not `useEffect`+`setState`,
  bulk-resolve on list endpoints, MCP-vs-migration discipline, migration integrity reconciliation
  (`node scripts/migration-integrity-check.mjs` must show `in_sync=true` on dev after every schema
  change), `NOTIFY pgrst, 'reload schema';` after every column/table add, batch vs sequential loop
  classification (§8B) for any new bulk-resolve code, `fetchInChunks()` (§8E) for any `.in()` id
  array that isn't provably small/bounded.
- Do not touch `erp_production.fg_dispatch_customer`, `fg_dispatch_customer_address`, or
  `erp_master.parent_customer_master`/`customer_master.parent_customer_id` beyond what §129.9
  says (remove the dead `parent_customer_id` field from the two forms; do not drop columns, do
  not write new code against `fg_dispatch_customer`/`fg_dispatch_customer_address`).
- This is Claude-designed, Codex-implemented, Claude-verified — standard project workflow. Do not
  skip the verification steps in section 7 to save time; every prior session in this codebase that
  skipped a step here shipped a live bug (see §128.9's own account of two bugs caught mid-build by
  following this exact discipline, and CLAUDE.md's bug-pattern #14/#15 incidents).
- Run the 15-bug-pattern checklist (§129.10) again yourself, in your own words, against the actual
  diff before calling this done — §129.10 is Claude's own pre-implementation pass; it does not
  substitute for your own pass against the code you actually wrote.

## 1. Current-state audit you must confirm before implementing

Confirm these facts (already verified live against dev+prod during design, but re-verify against
whatever branch you're building on — do not assume they're still true):

- `erp_production.fg_parent_company` and `fg_depot_code` are 0 rows in prod; already have working
  CRUD (see §3.1 below) — **reuse, do not rebuild.**
- `erp_production.fg_dispatch_customer`/`fg_dispatch_customer_address` are 0 rows, permanently
  unused — **do not touch.**
- `erp_master.parent_customer_master` is 0 rows; `customer_master.parent_customer_id` is NULL on
  all 64 prod customers — dead field, confirm before removing from the two forms.
- `customer_master.gst_number` is NULL on all 64 prod customers — no backfill/migration decision
  needed for GST, confirmed in §129.4.
- `frontend/src/pages/dashboard/om/customer/CustomerListPage.jsx`,
  `CustomerDetailPage.jsx`, `CustomerCreateForm.jsx`, `CustomerEditForm.jsx` — read all four in
  full before editing; §129.8 describes their current structure precisely, confirm it still
  matches.
- `frontend/src/components/data/ErpDenseGrid.jsx` — confirm the `cellNavigate`/`virtualize`/
  `onRowActivate` contract described in §129.8 is unchanged.
- `frontend/src/components/layer/DrawerBase.jsx` / `BlockingLayer.jsx` — confirm whether stacking
  two `DrawerBase` instances (Customer drawer containing an Address sub-action) is actually
  supported before assuming it in the frontend plan (§4.3 flags this as unconfirmed).

## 2. DB work

### 2.1 New migration — `customer_address` table

```sql
CREATE TABLE erp_master.customer_address (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES erp_master.customer_master(id),
  site_name text NOT NULL,
  address_line text NOT NULL,
  town text NOT NULL,
  state text NOT NULL,
  pin_code text,
  depot_code_id uuid REFERENCES erp_production.fg_depot_code(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by uuid,
  last_updated_at timestamptz
);
CREATE INDEX ON erp_master.customer_address(customer_id);
CREATE INDEX ON erp_master.customer_address(depot_code_id);
```

`depot_code_id` is **nullable** — this is deliberate (§129.3), do not copy
`fg_dispatch_customer_address.depot_code_id`'s `NOT NULL` constraint, that table's constraint is
wrong for this design.

Confirmed live via `list_tables` (2026-08-22): `fg_parent_company` and `fg_depot_code` both live
in `erp_master`, same schema as `customer_master` — no cross-schema FK needed, the migration
above is correct as written.

### 2.2 Backfill (structural only — see §129.3, Stage 2 data cannot be auto-derived)

One `customer_address` row per existing `customer_master` row, seeded from
`delivery_address`→`address_line`, `billing_state`→`state`, `town`→`town`. `site_name` and
`depot_code_id` left NULL. Confirm `delivery_address`/`billing_state`/`town` are non-null enough
on all 64 prod rows to backfill cleanly before running this — if any row has a NULL `billing_state`
or `delivery_address`, flag it rather than inserting an invalid row (Stage-1 fields are supposed
to be mandatory going forward, but historical data may predate that).

### 2.3 India GST-state-code lookup

No such table exists anywhere in the codebase (confirmed by search). Build one — either a small
static TS/JS constant (`_shared/gstStateCodes.ts`, ~37 entries, state name → 2-digit code) used
server-side only (frontend never needs to compute this itself, per §129.4's single-source-of-truth
rule — backend returns `display_code`/`gst_state_code` on enriched rows), or a tiny lookup table
if you'd rather keep it DB-editable — a plain TS constant is simpler and matches this codebase's
existing `INDIAN_STATE_NAMES` pattern (`_shared/indianStates.ts`, already used by
`fg_dispatch_customer.handlers.ts` — reuse that file's state-NAME list as the source order, add
the codes). Verify the 37-code list against the real published CBIC GST state-code table, not
memory.

### 2.4 Migration integrity

Apply via MCP on dev, reconcile `supabase_migrations.schema_migrations` per §8A, run
`node scripts/migration-integrity-check.mjs` → `in_sync=true`, run `NOTIFY pgrst, 'reload schema';`
on dev. Do not touch prod until dev is fully verified end-to-end (standard workflow, §7 of
CLAUDE.md).

## 3. Backend work

### 3.1 Reuse as-is (no rebuild) — `fg_dispatch_customer.handlers.ts`

`createParentCompanyHandler`, `listParentCompaniesHandler`, `createOrGetDepotCodeHandler`,
`listDepotCodesHandler` (lines 195-349 of that file) are already correctly built against
`fg_parent_company`/`fg_depot_code` and are being kept. Two things about them you must know before
reusing:

- `createOrGetDepotCodeHandler` is **idempotent by design** — POSTing an existing
  `(parent_company_id, code)` pair returns the existing row instead of erroring. This means the
  frontend's "select existing VDC or create new" UX (§129.8) can be **one form, one endpoint** —
  it does not need a separate "pick from list" vs "create new" code path on the frontend, though a
  searchable existing-VDC picker is still good UX and should still be built (§4.2).
- `code` uniqueness is `(parent_company_id, code)`, not global. This is existing, correct
  behavior — do not change it. The business owner's "External Virtual Code, users already know
  this" description implies these are human-assigned and naturally distinct across parent
  companies in practice; the constraint doesn't force that, it just doesn't prevent reuse across
  different parent companies either.
- Handler-level authorization is currently a no-op (`assertOmReadContext` in
  `supabase/functions/api/_core/om/shared.ts:34` does literally nothing — `export function
  assertOmReadContext(_ctx) {}`). This is fine ONLY because the real gate is route-level (§3.2)
  plus the in-handler `assertCompanyScope`/`assertParentCompanyScope` calls. Do not assume this
  handler-level no-op means these routes are unprotected — but do confirm the route-level fix in
  §3.2 actually lands, since that is the only real authorization these routes have today.

**Missing, must be added:** `updateParentCompanyHandler` (PATCH, name/GST/address/pin_code
editable, same GST-overwrite semantics as §129.5 — no Keep/Overwrite choice, fields just get
whatever the frontend sends) and `updateDepotCodeHandler` (PATCH, `parent_company_id` re-pointable
— i.e. "Change" the VDC's Parent Company per the Step-7 mock — plus `code`/`description`/
`address_line`/`state`/`pin_code`/`gst_number` editable; **`fg_depot_code` has no `gst_number`
column today**, add it in the same migration as §2.1 if the design calls for VDC-level GST, which
it does, §129.5). Add both to `fg_dispatch_customer.handlers.ts` (keep them physically alongside
the create/list functions they extend, do not create a parallel file for just these two) with
routes:
```
PATCH:/api/om/fg-parent-company/:id  → updateParentCompanyHandler
PATCH:/api/om/fg-depot-code/:id      → updateDepotCodeHandler
```
(Adjust to match this codebase's actual path-param routing convention — some routes here use
`case "PATCH:/api/x"` exact-match with the id in the body, others use path-segment regex like the
existing `fg-dispatch-customers/:id/addresses` pattern at `om.routes.ts:344-351`. Match whichever
convention the rest of `om.routes.ts` predominantly uses for single-resource PATCH, for
consistency — do not introduce a third style.)

### 3.2 Route-ACL registry fix — REQUIRED, not optional

**Concrete Bug-Pattern-#8 finding from this session's own audit:** `route-acl-registry.ts` lines
339-343 currently gate all 4 of these routes (`GET/POST fg-parent-compan{y,ies}`,
`GET/POST fg-depot-code{,s}`) on `resourceCode: "OM_FG_DISPATCH_CUSTOMER"` — MM05's own resource
code. Nobody has ever been granted `OM_FG_DISPATCH_CUSTOMER` (the tables are 0 rows — it was never
actually used). Now that these routes serve MM04's UI, **repoint them to MM04's own resource
codes**, matching the existing sibling pattern two lines above them (`parent-customer` routes use
`OM_CUSTOMER_CREATE`):

```
GET:/api/om/fg-parent-companies   → resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"
POST:/api/om/fg-parent-company    → resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE"
PATCH:/api/om/fg-parent-company/:id → resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"
GET:/api/om/fg-depot-codes        → resourceCode: "OM_CUSTOMER_LIST",   action: "VIEW"
POST:/api/om/fg-depot-code        → resourceCode: "OM_CUSTOMER_CREATE", action: "WRITE"
PATCH:/api/om/fg-depot-code/:id   → resourceCode: "OM_CUSTOMER_CREATE", action: "EDIT"
```

Without this fix, every Production/Stores/Accounts user who already has MM04 access (granted
2026-08-21) would get a silent 403 the first time they try to map an address to a VDC or edit a
Parent Company, despite having "full" MM04 access by every visible signal. Verify this specific
scenario against a real non-admin user's `precomputed_acl_view` after the fix, not just that the
registry text changed.

Also confirm — do NOT leave `OM_FG_DISPATCH_CUSTOMER`-gated duplicate route entries; there should
be exactly one registry entry per route/method after this change, pointing at the MM04 resource
codes.

### 3.3 New handler file — `_core/om/customer_address.handlers.ts`

CRUD for `erp_master.customer_address`. Route pattern to mirror: `customer.handlers.ts`'s own
company-scope discipline — **do not re-derive company scope locally**, call through
`assertCustomerCompanyScope(ctx, customerId, resourceCode, actionCode)` (already built
2026-08-21 in `customer.handlers.ts`, checks real EDIT/VIEW-tier ACL at the customer's mapped
companies, not just membership — reuse it, do not write a second version).

- `listCustomerAddressesHandler` (GET, by `customer_id`) — bulk-resolve `depot_code_id` →
  `fg_depot_code` (`code`, `dispatch_type`, `parent_company_id` → `fg_parent_company.company_name`)
  in one batch per §8A, not per-row.
- `createCustomerAddressHandler` (POST) — Stage-1 fields mandatory (`site_name`, `address_line`,
  `town`, `state`); `state` should default from the parent customer's own `state` if the caller
  doesn't override (§129.3 — addresses share the customer's state).
- `updateCustomerAddressHandler` (PATCH) — same field set editable, plus `depot_code_id`
  (map/remap/unmap an address to a VDC — this is the Step-5 "Map this address to a VDC" action).
- Route registry: `resourceCode: "OM_CUSTOMER_CREATE"` (WRITE/EDIT) / `"OM_CUSTOMER_LIST"` (VIEW),
  same family as the parent customer resource — do not invent a new resource code for this (Bug
  Pattern #6 — don't split one screen's actions across resource codes without a reason).

### 3.4 `customer.handlers.ts` changes

- `enrichCustomerRows` — add `display_code` (computed `"{gst_state_code}-{customer_name}"` per
  §129.4, using the GST-state-code table from §2.3, falling back to the state-derived code when
  `gst_number` isn't set yet) to every returned row. This is the only place this label is
  computed — frontend must never recompute it locally (single source of truth, §129.4).
- `createCustomerHandler`/`updateCustomerHandler` — stop requiring/reading `parent_customer_id`
  (§129.9); confirm no other code path still depends on it before removing.
- Confirm `lookupCustomerGstProfileHandler` needs zero changes — it's already generic (§129.5),
  just gets called from three more frontend surfaces (VDC edit, Parent Company edit, in addition
  to Customer edit).

## 4. Frontend work

### 4.1 `CustomerListPage.jsx`

Add `cellNavigate virtualize` to the existing `ErpDenseGrid`. Change `onRowActivate` from
`openScreen(...)` (route navigation) to opening a center `DrawerBase` (`side="center"`, width
matching AC01's `min(1480px, calc(100vw - 24px))`) that renders the Customer Detail content in
place — mirror `AC01Page.jsx`'s `openDrawer(row)`/`closeDrawer()` state-management pattern
exactly (`selectedCustomerId` + `drawerOpen` boolean, reset on close, never a screen-stack pop).

### 4.2 Customer Detail drawer content

Inside the drawer: Customer header (Name/State/GST + Check GST, auto-overwrite per §129.5, plus
the `display_code` badge from §3.4) → Address list as a nested `ErpDenseGrid` (`cellNavigate
virtualize`), columns: Site Name, Address, Town, State, VDC status badge (Not mapped / `{code} —
{parent_company_name}`), no GST column (§129.4). Each address row's activate action opens the
VDC-mapping UI (§129.3/§129.8's Step 5): a searchable existing-VDC picker (calls
`GET /api/om/fg-depot-codes?parent_company_id=...` — note this needs a parent-company-agnostic
search too, i.e. search across all VDCs by code text, not just within one already-chosen parent
company; check whether `listDepotCodesHandler`'s current filter set supports that or needs a
`search` param added) plus an inline "create new" form (Parent Company select-or-create → VDC
Code/State/Address/GST) that POSTs through `createOrGetDepotCodeHandler`'s idempotent endpoint.

**Confirm before building:** whether nesting a second `DrawerBase`/expand-panel for the VDC-map
action works cleanly with the outer Customer drawer already open (§1's audit item) — if stacked
`DrawerBase` isn't clean, use an inline expand-in-place row (accordion-style) inside the Address
grid instead of a second drawer; either is acceptable, just confirm and pick one rather than
assuming.

### 4.3 "+ Add another address" (the third flow, §129.7)

A button inside the Customer Detail drawer's Address section that adds one more
`customer_address` row via `createCustomerAddressHandler` — reuses the same Stage-1 field set as
Customer creation (Site Name/Address/Town/State), never touches Customer Name/GST, `depot_code_id`
starts NULL.

### 4.4 `CustomerCreateForm.jsx` / `CustomerEditForm.jsx`

- Remove the "Parent Company" field (§129.1/§129.2/§129.9's dead `parent_customer_id` field) —
  the whole select-or-create-inline-mini-form for it goes away.
- `CustomerCreateForm`: no structural change to the Stage-1 5-field minimal path used by Plan
  Feed's quick-create (Production-facing) — that stays exactly 5 fields (Name/Address/State/Town/
  Site Name), GST/Contact/Email stay absent from that specific surface per §129.7. The FULL form
  (used by MM04's own "Create Customer" route and by Stores/Accounts) keeps GST + Check GST
  (auto-overwrite, §129.5), loses Parent Company, gains nothing else new — VDC mapping happens
  after creation, in the detail drawer, not at create time.
- `CustomerEditForm`: same Parent-Company removal; GST section switches to auto-overwrite (no
  Keep/Overwrite buttons, §129.5).

### 4.5 Plan Feed integration

- `PlanFeedPage.jsx`'s existing "+ New Party" and "Edit Customer" entry points keep working
  unchanged (§129.7's Stage-1 flows were already correct going into this session) — just confirm
  they still call the same `CustomerCreateForm`/`CustomerEditForm` after §4.4's edits (Parent
  Company removal must not break either call site — check both `companyMode` variants still
  render correctly with one fewer field).
- Add "+ Add another address" (§4.3) to Plan Feed's Edit-Customer surface too, not just MM04's own
  detail drawer — the business owner explicitly asked for this exact flow from Plan Feed
  (§129.7's third flow).
- Confirm `plan_feed`/Total Table's Town/Site Name display: decide (and document the decision,
  don't leave it implicit) whether Total Table's Town/Site Name should keep reading the flat
  `customer_master.town` field (added 2026-07-24, now effectively superseded by per-address Town)
  or switch to reading the FO's own selected `customer_address` — §129 does not lock a
  `plan_feed.address_id` FK; if Plan Feed's FO creation needs a specific address selected (not
  just the customer), that FK and its UI are a separate follow-up, flag it rather than silently
  building it into this brief's scope.

### 4.6 PACE component rule

Every column showing a foreign key (`depot_code_id`, `parent_company_id`, `customer_id`) must
render the resolved human-readable value, never a raw UUID (§8A). Every data-fetching component
uses `useQuery`, never `useEffect`+`setState` (§8A).

## 5. ACL and menu work

- No new tx_code, no new `acl.menu_master`/`erp_menu.menu_master` row — this design deliberately
  reuses MM04's existing resource codes throughout (§129.10 point 4/5 — confirmed N/A). Do NOT
  create new ACL menu rows for this feature.
- The only ACL change is the route-registry resourceCode repointing in §3.2 — that's a code
  change (`route-acl-registry.ts`), not a data/menu change, so it needs no `capture_acl_version_
  source`/`generate_acl_snapshot` MCP sequence (§8's ACL-menu-registration rule applies to new
  `capability_menu_actions` grants, not to which resource code an existing route checks).
- After §3.2's fix, re-run `scripts/route-acl-registry-guard.mjs` and confirm no regression.

## 6. Explicit bug-check pass you must document

Re-run §129.10's 15-point list against your actual diff (not the design's hypotheticals) before
calling this done. At minimum, explicitly re-verify these three, since they surfaced concrete,
non-hypothetical findings during design and are the ones most likely to bite if implemented
carelessly:

- **#2 company-scope** — every new handler in `customer_address.handlers.ts` goes through
  `assertCustomerCompanyScope`, never a locally re-derived check.
- **#8 route/ACL mismatch** — the §3.2 fix actually lands and is verified against a real
  non-admin user's `precomputed_acl_view`, not just read back from the registry file.
- **#15 API-client double-unwrap** — every new `fetchXxx()` call added on the frontend for
  addresses/VDC/parent-company is checked against its own handler's response shape
  (`pagination` key present or not) before assuming `res.data` vs `res`.

## 7. Verification checklist

### 7.1 DB / backend
- `deno check` on every touched `.ts` file, git-stash before/after, zero new errors.
- `node scripts/migration-integrity-check.mjs` → `in_sync=true` on dev.
- Full CI guard suite: `stock-posting-guard`, `company-scope-guard`,
  `company-scope-write-acl-guard`, `hardcoded-role-check-guard`, `wrong-company-source-guard`,
  `route-acl-registry-guard`, `approver-chain-guard`, `resource-code-domain-guard`,
  `frontend-payload-guard`, `jsx-no-undef-guard`.
- Rolled-back MCP transactions (`BEGIN...ROLLBACK`) against real dev data for: create address,
  map address to new VDC, map address to existing VDC (idempotent-reuse path), create Parent
  Company with GST, update VDC's parent company link, `display_code` computation with and
  without GST set.

### 7.2 ACL / scope tests
- A real non-admin Production/Stores/Accounts test user (already has MM04 access per 2026-08-21)
  can: create a customer, add a second address, map an address to a new VDC, map an address to an
  existing VDC, edit a Parent Company's GST — all without a 403, confirmed via
  `precomputed_acl_view` plus an actual handler call, not just the registry text.
- A user WITHOUT MM04 access still gets a real 403 on all of the above (negative test — don't only
  test the positive path).

### 7.3 Frontend
- `eslint` clean on every touched `.jsx` file, git-stash before/after.
- `jsx-no-undef-guard.mjs` clean.
- Manual walk of all three flows from §129.7/§129 discussion: new customer (5-field, from Plan
  Feed), edit existing customer, add a new address to an existing customer — from BOTH Plan Feed
  and MM04's own drawer.
- `cellNavigate`/`virtualize`/Enter→drawer behavior actually matches AC01's (arrow-key cell nav,
  Enter opens drawer, Escape closes it, no page-level keydown listener needed).

### 7.4 Consistent with feasibility doc
- Re-read §129 once more after implementation and confirm every LOCKED line has a corresponding
  built behavior — if anything in §129 turned out to be unbuildable as written, that's a stop-and-
  report situation, not a silent deviation.

## 8. Deliverables

- Migration file(s) for `customer_address` + GST-state-code support + `fg_depot_code.gst_number`
  column, applied+reconciled on dev.
- `customer_address.handlers.ts` (new), `fg_dispatch_customer.handlers.ts` (2 new update
  handlers), `customer.handlers.ts` (`display_code`, Parent-Company field removal),
  `route-acl-registry.ts` (§3.2 fix), `om.routes.ts` (new routes wired).
- `CustomerListPage.jsx`, `CustomerDetailPage.jsx`→drawer-based, `CustomerCreateForm.jsx`,
  `CustomerEditForm.jsx`, `PlanFeedPage.jsx` (all updated per §4).
- An `OM-IMPLEMENTATION-LOG.md` entry in the established dated-heading style (§128's own entries
  are the template) once this is verified, listing exactly what was built, what was found broken
  along the way (route-ACL mismatch, dead Parent-Company field), and what's left (address-level FK
  on `plan_feed` if that turns out to be needed per §4.5's flagged open point).

## 9. Out of scope

- MM05 (RM/PM/INT sale customer) redesign — deferred, business owner's own explicit sequencing
  (§129.1/§129.11).
- Dispatch/L5's own use of `dispatch_type` (Direct vs Depot) — not designed here, belongs to the
  still-paused Dispatch/L5 formal session (§114).
- SO/FO's own address-selection UI consuming the Bill-To/Ship-To chain (§129.6) — this brief
  builds the data model and MM04's own pages only; wiring §129.6's resolution into SO01/Plan Feed's
  actual order-creation screens is a follow-up, not this brief's scope, unless §4.5's flagged
  `plan_feed.address_id` question resolves to "yes, needed now" during implementation — if so,
  stop and confirm with the design owner before expanding scope, don't silently build it.
