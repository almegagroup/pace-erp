# CODEX-IN02-STOCK-LEDGER-REDESIGN-TASK-BRIEF

**Domain:** PROCUREMENT / INVENTORY (Reports)
**Reference:** feasibility doc `PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
§117 (read in full first — full reasoning + real dev-data proof behind every decision here).
Also read §116 (the IN03 brief/section) — IN02 reuses several of its components and deliberately
diverges from a couple of its decisions; both are explained in §117 but you need §116's context to
understand the diffs. Also read CLAUDE.md §8A, §8B, and the "11 Bug Patterns" checklist at the top
of CLAUDE.md — §117.9 shows this brief's own pass against all 11, and you should re-verify your
own implementation against them before considering this done, not just trust that the design pass
caught everything.

**Not in scope:** any ACL/department decision for IN02 (that's a separate, still-open session —
`NEXT-SESSION-PROMPT-Inventory-ACL-Design.md`). Also not in scope: wiring the Column Layout system
into IN03 (that's a small follow-up brief after this one lands, since IN03 is mid-implementation
elsewhere — do not touch `CurrentStockPage.jsx` or `getCurrentStockHandler` in this brief).

---

## Status check (read before touching anything)

Current `getStockLedgerReportHandler` (`supabase/functions/api/_core/procurement/stock_reports.handlers.ts`,
~line 102-183) requires a single `material_id` passed as a raw UUID (the frontend literally has a
text input with placeholder "Material UUID" — `StockLedgerReportPage.jsx` ~line 118-126), filters
only by `company_id`/`date_from`/`date_to`, and returns raw `stock_ledger.*` rows with a
client-side-computed `signed_qty`. The frontend renders a flat grid with no Material/Company/
Storage-Location/Batch/Document-Number columns at all, a broken "Running Balance" column (client-
side running sum — wrong under any date filter, since it never accounts for the opening balance
before the filtered window), and pagination state (`offset`) that has no setter anywhere — there
is no way to see a second page. This is a near-full rewrite of both the handler and the page.

Do not touch `stock_ledger`, `stock_document`, `post_stock_movement()`, or any other module's
write paths — this is a **read-only report** rewrite plus one small new **writable** feature (the
Column Layout save/default actions, Change 4).

---

## Change 1 — Backend: rewrite `getStockLedgerReportHandler`

File: `supabase/functions/api/_core/procurement/stock_reports.handlers.ts`

### 1a. New query params (all optional except the date range, which is mandatory)

- `company_ids` — array. **Server-side, independently re-validate every value against the
  caller's `erp_map.user_companies` (or SA/GA/admin bypass), exactly like the existing
  `resolveCompanyScope`/`assertCompanyScope` pattern in this file today.** Do not trust that the
  frontend only ever sends allowed companies — a direct API call could bypass the UI. This is the
  single most important rule in this brief (§117.9 point 2 — this exact mistake shipped once
  already in the IN03 brief and was caught before implementation; don't repeat it here from the
  backend side).
- `material_ids` — array (replaces singular `material_id`, no longer required)
- `storage_location_ids` — array, new
- `batch_numbers` — array, new
- `movement_type_codes` — array, new
- `date_from` / `date_to` — **both required.** Reject with 400 if either is missing, or if
  `date_to - date_from > 365` days. This is a hard validation, not a soft UI hint — enforce it
  here even though the frontend also enforces it, since this endpoint has no pagination to fall
  back on if someone requests unbounded history directly.

### 1b. Query construction

Base query against `stock_ledger`, filtered by the above (company scope via the validated list,
the rest as straightforward `.in()`/`.gte()`/`.lte()` filters), ordered by `posting_date, ledger_seq`.
No `limit`/`offset` — fetch everything matching (bounded by the mandatory ≤365-day window, so this
is never truly unbounded).

### 1c. Bulk-resolve joins (§8B — every one of these is INDEPENDENT, batch with `Promise.all`, no
per-row loops)

- `stock_document` via `stock_ledger.stock_document_id` (`.in("id", stockDocumentIds)`) — pull
  `document_number, item_number, document_year, reference_document_type, reference_document_number,
  reversal_document_id`.
- `material_master` via `material_id` (`.in("id", materialIds)`) — pull
  `pace_code, external_code, material_name, document_name, material_type, pack_code`. Same
  `material_label = document_name ?? material_name` resolution as IN03 Change 1d (§116.3) — reuse
  that exact logic, don't reinvent it differently here.
- `storage_location_master` via `storage_location_id` — `code` only (no name), same as IN03.
- `movement_type_master` via `movement_type_code` — pull `description` (or whatever the actual
  column is called — check the table; the seed migration
  `20260509103000_gate11_11_4_seed_movement_types.sql` shows the shape).
- Company names via the already-validated company list.
- User names via `created_by`/`posted_by` (`stock_ledger.created_by`, or `stock_document.posted_by`
  where relevant) — **grep the codebase for how another handler already resolves a `created_by`/
  `posted_by` UUID to a human-readable identity** (CLAUDE.md's "User Identity Display Format" rule
  applies — never show a raw UUID) and reuse that exact pattern/table join; don't invent a new
  format. `erp_core.users` has `user_code` but no name column directly on it — the display name
  likely comes from a joined HR/profile table; find the existing convention rather than guessing.

### 1d. Vendor/Customer resolution (§117.2, §116's per-reference-type note)

For rows where `stock_document.reference_document_type` is one that plausibly has a vendor or
customer (e.g. `GRN`, `RTV`, and whatever dispatch/DO-side type exists — check
`erp_procurement.goods_receipt.vendor_id` for the GRN case, and the delivery/dispatch side for the
customer case), resolve to a name via that reference's own table. This is a **small dispatch
table in code**, e.g. a `Record<referenceType, resolverFn>` map — not a generic join, since each
reference type points to a different source table/column. Bulk-resolve per reference type (group
rows by `reference_document_type` first, then one `.in()` call per group — still §8B-compliant,
just grouped). Rows whose reference type has no known vendor/customer source return `null` for
both fields, not an error.

**This must be a direct backend table read (`serviceRoleClient.schema(...).from(...)`), never a
call to the GRN/Dispatch page's own ACL-gated API route.** A caller only needs
`PROC_STOCK_LEDGER:VIEW` to see vendor/customer names in this report — they must never need GRN or
PGI/DO page access too. This was an explicit design requirement from the business owner — verify
it holds by testing as a user who has IN02 access but not GRN/DO access (see Verification).

### 1e. Dual UOM (§117.5)

- `base_quantity` / `base_uom_code` — always, straight from `stock_ledger`.
- `pack_quantity` / `pack_uom_code` — only when applicable:
  - RM/PM/INT: reuse the existing §110 Phase C `alt_uom_code`/`alt_quantity` logic (the same
    material-level-fixed-conversion lookup IN03 originally had for FG and is now removing per
    §116.5 — that logic still belongs here, for RM/PM, unchanged).
  - SFG: never — leave both null.
  - FG: resolve the row's linked Packing PO **the same way IN03's Path C does** — via
    `fgStockBreakdownHandler`'s `resolveLotRef()` fallback chain (source_lot_ref →
    reference_document_number when type is PACK_PO → document_number) to get `po_number`, then
    join `packing_order` for `fill_qty_per_pack`. **Unlike IN03, compute
    `pack_quantity = this_row's_own_quantity / fill_qty_per_pack`, not the PO's total
    `num_packs`** — a ledger row's own quantity is not guaranteed to equal the whole PO's output
    (§117.5 explains why: future partial reversals). `pack_uom_code` = the outer pack UOM
    (`pack_code_master.outer_uom_code`), same join as IN03.
  - Extract `resolveLotRef` into a shared helper if it isn't already (check whether IN03's brief
    already did this extraction — if so, import it; if not, do it here and update IN03's file to
    import from the same place rather than duplicating).

### 1f. Response shape

Return every row with all the above resolved fields attached — no raw UUIDs anywhere in the
payload (§8A) except IDs that are never rendered.

---

## Change 2 — Two new backend endpoints (batch/PO-number autocomplete, §117.6 — deliberately
**not shared with IN03**)

Add to `stock_reports.handlers.ts`:

1. `GET /api/procurement/stock-ledger/batch-search?q=&company_id=` — distinct
   `stock_ledger.batch_number` where `batch_number ILIKE '%q%'`, scoped by company, `LIMIT 50`.
2. `GET /api/procurement/stock-ledger/po-search?q=&company_id=` — distinct
   `erp_production.packing_order.po_number` matching `q`, same scoping.

Register both in `procurement.routes.ts`, ACL entries in `route-acl-registry.ts` mirroring
`"GET:/api/procurement/stock-ledger": { skipAcl: false, resourceCode: "PROC_STOCK_LEDGER", action: "VIEW" }`
— same resource code, same action. **Do not** reuse or point these at IN03's equivalent endpoints
or resource code — §117.6 explains why they must stay parallel. If IN03's own batch-search/
po-search endpoints already exist under `PROC_CURRENT_STOCK` by the time you write this, the
underlying SQL logic (distinct value search) can be factored into one shared TypeScript function
both route handlers call — but the two HTTP routes and their two ACL gates must remain separate.

---

## Change 3 — Frontend: rewrite `StockLedgerReportPage.jsx`

File: `frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx`

### Page 1 (filters)

- Company/Material/Storage Location/Batch Number/Movement Type — all via `MultiValueFilterField`
  (the component IN03's brief introduces at
  `frontend/src/components/inputs/MultiValueFilterField.jsx` — if this brief lands before IN03's,
  build the component here instead and update IN03's brief to import from here; whichever lands
  first owns the component, the other imports it. Check before writing a second copy).
  - Company **must** source from `useMenu()`'s `runtimeContext.availableCompanies`, single-company
    users get a read-only label (no popup at all) — **not** `useCompaniesForOmQuery`. This is the
    exact bug caught in IN03's brief (§116.2's correction note) — do not reintroduce it here.
  - Movement Type sources from a one-time fetch of `movement_type_master` (`active=true`), not a
    search endpoint — the list is small enough to load in full and filter client-side inside the
    popup.
  - Batch Number / Packing PO Number source from Change 2's two new endpoints.
- Posting Date range — two date inputs, both required to enable the Search button. Client-side
  reject (with a clear message, before even calling the API) if the span exceeds 365 days.
- No Stock Type filter, no Document Date filter, no Reversed-Documents toggle, no Show-Zero
  toggle — all deliberately excluded, §117.3. Do not add any of these back in "for consistency
  with IN03" — they were each explicitly evaluated and rejected for this report.

### Page 2 (grid)

- Columns per §117.4's table, in that order. Both UOM columns (`base_quantity`/`pack_quantity`,
  Change 1e) always rendered, the pack one showing "—" when null.
- No Running Balance column at all.
- "Columns" button + drawer, same interaction as IN03 (§116.3), but now backed by the real Layout
  system (Change 4) instead of pure client-local toggle state — see Change 4 for what the drawer
  needs beyond IN03's version.
- Fetch is triggered by the Search button (not on every filter change), loads the entire matching
  result into state (bounded by the mandatory ≤365-day window) — no "Next Page" control, no
  `offset` state at all.
- Excel export button using the existing `downloadCsvFile()` from
  `frontend/src/shared/downloadTabularFile.js`, passed the currently-loaded full `rows` array and
  the currently-visible columns (respect the Layout system's active visible-column set for what
  gets exported, not always all columns).

---

## Change 4 — Column Layout system (§117.7) — new, shared/reusable, built here first

### 4a. Migration

New file `supabase/migrations/<timestamp>_report_column_layout.sql` (timestamp = actual creation
time, follow CLAUDE.md §8A migration-integrity rules — apply via `apply_migration`, then reconcile
`supabase_migrations.schema_migrations` to the local filename's timestamp in **both** dev
(`ytapuwiqicmvpanmzelb`) and, when this eventually deploys, prod):

```sql
create table erp_inventory.report_column_layout (
  id uuid primary key default gen_random_uuid(),
  report_code text not null,               -- 'IN02', 'IN03', future reports
  scope text not null check (scope in ('GLOBAL','USER')),
  owner_user_id uuid null,                 -- null for GLOBAL, required for USER
  layout_name text not null,
  visible_columns jsonb not null,          -- ordered array of column keys
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint report_column_layout_owner_ck
    check ((scope = 'GLOBAL' and owner_user_id is null) or (scope = 'USER' and owner_user_id is not null))
);

create table erp_inventory.report_layout_default (
  auth_user_id uuid not null,
  report_code text not null,
  layout_id uuid not null references erp_inventory.report_column_layout(id),
  primary key (auth_user_id, report_code)
);
```

(Adjust types/defaults to match this codebase's actual conventions for new tables — check a
recent migration like `20260713110000_gate27_24_reservation_batch_number.sql` for the house style
on `created_by`/timestamps/RLS if any.)

### 4b. Backend handlers (new file or appended to `stock_reports.handlers.ts` — your call, but
keep it findable, e.g. `report_layout.handlers.ts` if you split it out)

- `GET /api/procurement/report-layouts?report_code=` — list all `GLOBAL` layouts for that
  report_code plus the caller's own `USER` layouts, plus the caller's current default
  (`report_layout_default` row, if any).
- `POST /api/procurement/report-layouts` — create. Body: `report_code, scope, layout_name,
  visible_columns`. **`scope='GLOBAL'` is provisionally gated to SA/GA only** (§117.7 — this is
  not a hardcoded business-role check in the forbidden sense, SA/GA-always-full-access is the
  Key Architecture Rule itself; it's a placeholder until the real ACL session assigns a WRITE/EDIT
  action to `PROC_STOCK_LEDGER`/`PROC_CURRENT_STOCK`, at which point this gate should be swapped
  for that action check — leave a comment saying exactly this, pointing at
  `NEXT-SESSION-PROMPT-Inventory-ACL-Design.md`, so whoever does that session later knows to come
  back here). `scope='USER'` — any caller with `VIEW` on the report can create their own.
- `PATCH /api/procurement/report-layouts/:id` / `DELETE .../:id` — same scope rule: GLOBAL edits
  gated SA/GA-only (provisional), USER layouts editable/deletable only by their own
  `owner_user_id`.
- `POST /api/procurement/report-layouts/:id/set-default` — upserts the caller's
  `report_layout_default` row for that `report_code`. Any caller with VIEW can set their own
  default to any layout they can see (their own USER layouts + all GLOBAL ones for that report),
  not just ones they created.

Register routes + ACL entries (`resourceCode: "PROC_STOCK_LEDGER"`, actions `VIEW`/`WRITE` — reuse
the report's own resource code, don't invent a new one, per bug pattern #6).

### 4c. Frontend

Extend the "Columns" drawer (Change 3) beyond IN03's plain toggle-list version:
- A dropdown/list at the top of the drawer: "My Default" (system baseline if none set) + every
  GLOBAL layout + the caller's own USER layouts. Selecting one applies its `visible_columns`
  immediately.
- "Save current as..." action — prompts for a name, `scope` choice (GLOBAL option only rendered
  if the caller is SA/GA — hide it entirely for everyone else rather than showing a disabled
  option, since the backend will reject it anyway and a hidden option is less confusing).
- "Set as my default" action on whichever layout is currently active.
- Keep the plain per-column checkboxes too (this is still how you build up a `visible_columns`
  set before saving it as a named layout).

---

## Hard rules

1. Read-only for stock data — this brief's only writes are the four new Layout endpoints (4b);
   everything else in Changes 1-3 is `SELECT` only. If you find yourself wanting to write to
   `stock_ledger`/`stock_document`/`stock_snapshot`, stop, you've misread something.
2. §8A — no raw UUIDs anywhere in any response or any rendered column.
3. §8B — every bulk-resolve (material, storage location, movement type, company, user identity,
   vendor/customer-per-reference-type) is one batched `.in()`-style call (or one per
   reference-type group for 1d), never a per-row loop.
4. Company scope: independently re-validated server-side on every request, never trust the
   frontend alone (§117.9 point 2 — this is the one that shipped wrong once already this session,
   on the other report).
5. Do not share the batch-search/po-search endpoints or their ACL resource code with IN03
   (§117.6) — keep them parallel, even if the SQL underneath is factored into a shared function.
6. Do not add Stock Type filter, Document Date filter, Reversed-Documents toggle, or a Running
   Balance column — all three were explicitly designed and rejected, not overlooked (§117.2,
   §117.3, §117.4).
7. Any new route: method + path in `route-acl-registry.ts` must match the real route exactly
   (bug pattern #8).
8. Do not touch IN03's files (`CurrentStockPage.jsx`, `getCurrentStockHandler`) in this brief.

---

## Verification

1. `deno check` on all touched/new backend files — clean (or only pre-existing typing noise,
   confirm via `git diff --stat`).
2. `eslint` on all touched/new frontend files — clean.
3. Reject-path checks: call the ledger endpoint with no `date_from`/`date_to` → 400. Call it with
   a 400-day span → 400. Call it with a `company_ids` value the test user doesn't have access to
   → 403 (`COMPANY_SCOPE_VIOLATION` or equivalent), even though the frontend would never send
   that value — this proves the server-side check (1a) is real, not decorative.
4. Real dev-data (`ytapuwiqicmvpanmzelb`) sanity checks:
   - Any RM movement in the last year → confirm `Material Document Number` column shows a real
     `stock_document.document_number`, not blank.
   - A GRN-origin RM movement → confirm Vendor resolves to a real vendor name.
   - Batch `EV02609` (FG-00008, from the IN03 discussion) → confirm the Packing-PO-linked FG
     ledger rows show the correct `pack_quantity` computed from **that row's own quantity**
     divided by the linked PO's `fill_qty_per_pack`, not the PO's total `num_packs`.
5. Log in as a test user who has `PROC_STOCK_LEDGER:VIEW` but not GRN/DO page access — confirm
   the Vendor/Customer column still resolves correctly and no permission error occurs anywhere in
   the request (proves 1d's "no cross-page ACL dependency" requirement).
6. Log in as a non-SA/GA user — confirm the "Save as Global" option is not rendered, and a direct
   `POST .../report-layouts` with `scope=GLOBAL` from that user's session returns 403.
7. Confirm Excel export downloads the full result set (not just what fits on screen) for a
   multi-hundred-row result, and respects the currently-active column visibility.

## Log + commit

- Append entries to `docs/Codex-Log.md` and `OM-IMPLEMENTATION-LOG.md` (new entry, reference this
  brief and feasibility §117).
- If you touched `migration-integrity` state, run `node scripts/migration-integrity-check.mjs`
  and confirm `in_sync: true` on dev.
- Commit with `Co-Authored-By: Codex`. **Do not push.**
