# CODEX TASK BRIEF — SO03 "APL Invoice Case"

Business owner request, 2026-10-14 (CMP003 live use). Build exactly what is
described below. Before writing any code, read and check everything listed in
"Read first". If anything you find contradicts this brief, or a rule here is
ambiguous, STOP and report it instead of guessing.

## Read first (mandatory)

1. `CLAUDE.md` — all of it, especially:
   - the 15 recurring bug patterns (#1, #2, #6, #8, #11, #12, #13, #14, #15 apply here),
   - §8A (no raw UUIDs, `useQuery` only, list endpoints carry display data,
     MCP vs migration, migration integrity, `NOTIFY pgrst, 'reload schema'`),
   - §8B (batch vs sequential loops), §8D (stock posting only through the
     existing atomic paths — `scripts/stock-posting-guard.mjs` must not go up),
   - §8E (chunk every unbounded `.in()` with `fetchInChunks`).
2. `docs/Operation Management/PROD-ACL-Access-Decisions.md` (ACL rules + Post-Implementation Checklist).
3. Existing code you must reuse, not re-implement:
   - SO03 page: `frontend/src/pages/dashboard/procurement/sales/DOListPage.jsx`
     (the new button sits next to "Edit Transporter Details";
     `EditTransporterDetailsDrawer.jsx` is the closest UI pattern — FO lookup → form → Save).
   - FO → DO lookup: `findDoByFoNumberHandler` in
     `supabase/functions/api/_core/procurement/do_bulk.handlers.ts`.
   - DD (VDC) cancellation cascade: `cancelVdcDeliveryOrderHandler` in
     `supabase/functions/api/_core/procurement/vdc_invoice.handlers.ts` and the
     migrations `20261009152000_vdc_cancel_cascade.sql`,
     `20261009154223_vdc_created_do_cancel_cascade.sql` (DRAFT invoice cancel +
     DO cancel + reservation release in one transaction; POSTED invoice → P602
     reversal through `post_document`, then DO cancel).
   - Non-DD cancellation/reversal: `reverseSalesInvoiceHandler`,
     `cancelDeliveryOrderHandler` (`delivery_order.handlers.ts`),
     `cancelPgiInvoiceGroupsHandler` (`do_unified.handlers.ts`).
   - Access helper pattern: `canMaintainDoBulkAccess` (`do_bulk.handlers.ts`) and how
     `postVdcTruckDispatchUploadHandler` (`vdc_truck_dispatch.handlers.ts`) calls
     `completeVdcPgiOnlyHandler(..., { doAccessChecked: true })` so a Stores /
     Logistics user can run a posting step without Invoice access.
   - Route ACL: `supabase/functions/api/_acl/route-acl-registry.ts`.

## What to build

### 1. Button
SO03 (Delivery Order list) → new action button **"APL Invoice Case"**, placed
right next to **"Edit Transporter Details"**.

### 2. Lookup
Clicking it opens a drawer with one field:
**"Enter FO Number or Invoice Number"** (English label). The user enters either one.
- FO Number = the external FO number (original or revised) used by SO Map.
- Invoice Number = the Tally Invoice Number on the DO / its sales invoice, and
  also accept this ERP's own invoice number. Check both; do not assume.
- If the value matches more than one DO, list them (DO number, FO, invoice no.,
  party, status) and let the user pick one. If none, say so clearly.
- Show the chosen DO's key details (DO number, FO, invoice number/date, party,
  status, whether PGI is done) — human-readable, never raw ids.

### 3. "APL Invoice Received?" — Yes / No
After a DO is found, show the option **APL Invoice Received: Yes / No**.
- **No** → Save records "not received" for that DO (who, when).
- Later, when the APL invoice arrives, the user looks up the same FO / invoice
  number, chooses **Yes**, enters **Received Date** (mandatory with Yes), Save.
- Both saves are just records; they never post stock or touch the invoice.
- Show the current recorded state when a DO is looked up (Not recorded / No
  since <date> / Yes, received <date>).

### 4. "Cancel Posting"
Only for a DO whose state is **No** (not received): instead of Yes, the user can
click **Cancel Posting** (with a confirm dialog and a mandatory reason). This must:
- cancel the invoice;
- if PGI was already done, reverse the PGI (stock back, same reversal the
  existing cancel/reverse paths use — P602 at the original leg's rate);
- cancel the DO;
- release the DO's reservation;
- **change nothing in SO or SO Map.** After cancellation the FO's quantity
  must be free again so the user restarts from the stage after SO Map (create a
  new DO). Verify this is really true with the existing "drawn qty" logic
  (cancelled DO lines must not count) — prove it, don't assume.
- Everything for one DO in one transaction, as the existing cascades do. Reuse
  them; do not add a new direct `post_stock_movement` call.
- Mark the APL case as CANCELLED (keep the history).

### 5. Scope check you must do
The existing DD cascade covers DD (pgi_deferred) DOs in CREATED / INVOICED /
DISPATCHED. Check whether non-DD Sales DOs (atomic PGI + Invoice) can also be an
"APL Invoice Case" in real data (CMP003 prod is read-only for you; use dev for
writes). If the non-DD path needs different handling, implement it with the
existing non-DD reversal handlers and explain what you did; if it is unclear,
stop and ask.

### 6. Access (important)
SO03 belongs to Accounts **and** Stores and Logistics. All of them must be able to
use APL Invoice Case, including Cancel Posting.
- Gate the new routes on the SO03 DO resource (`PROC_DO_CREATE`: VIEW for
  lookup, EDIT for saves and Cancel Posting), like the Truck & Dispatch upload.
  In CMP003 prod, `CAP_STORES_LOGISTICS_DO` (which holds `PROC_DO_CREATE`) is on
  STORES, LOGISTICS, ACCOUNTS, MANAGEMENT and ACL-MASTER — re-verify this, and
  check every other active company too; report gaps rather than silently
  changing ACL data.
- The existing cascade handlers check `canMaintainSalesInvoice` (Invoice
  access). Do not widen them for everyone; follow the `doAccessChecked` pattern
  so only this flow, after its own DO-access check, can call them.
- Company scope on every read and write (`assertCompanyScope`). Add every new
  route to `route-acl-registry.ts` with the exact method/path.

### 7. Data
Store the APL case per DO (status NO / YES / CANCELLED, received date, reason,
who/when for each change, history kept). Design the table/columns yourself, as a
migration file (not MCP-only). Apply to dev, reconcile
`supabase_migrations.schema_migrations` to the local filename version, run
`NOTIFY pgrst, 'reload schema';`, and confirm with
`node scripts/migration-integrity-check.mjs`.

### 8. Visibility
Add an "APL Invoice" column to the SO03 list (Not recorded / No / Yes <date> /
Cancelled) so users can see the state at a glance, and include it in the SO03
Excel export.

## Done means
- `deno check` on every touched backend file: zero new errors (compare with
  `git stash` before/after).
- `npx eslint` clean on touched frontend files; `npx vite build` passes.
- Every CI step in `.github/workflows/ci-basic.yml` passes locally, including
  `node scripts/dependency-provisioning-check.mjs --strict-manifest` (SU24) —
  add manifest entries for new API calls/pages if needed.
- In dev, a rolled-back transaction test of Cancel Posting for (a) an invoiced
  DD DO without PGI and (b) a DO with PGI done: stock, invoice, DO, reservation
  and SO Map allocation state checked before/after.
- A short report: what you built, which existing paths you reused, the access
  check results per company, and anything you found that contradicts this brief.
