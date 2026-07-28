# PROD ACL — Final Access Decisions (page-by-page, business owner dictated)

> Process (locked 2026-07-27): go group by group, page by page. For each page:
> tx_code + what it does is shown; business owner says who gets View / Create /
> Edit / Approve / Delete. Nothing gets implemented in prod until a group is
> fully decided here — this file is the single source of truth for prod ACL
> from this point on (supersedes ad-hoc conversational changes made earlier
> the same day, which were found to be inconsistent/leaky and are being
> redone properly through this doc).

Departments in play: **SCM (Supply Chain), Accounts, Production, Quality (QA),
Stores, Security, Management, Director, Auditor.**

Legend: V=View, C=Create, E=Edit, A=Approve, D=Delete. Blank = no access.

## Rules (locked 2026-07-28)

**Basic Rule (default — applies automatically, not repeated per page):**
1. The department that owns a page's function gets View+Create+Edit.
2. Approve is Manager-tier and above only (User-tier never gets Approve), for
   any page that has an approval step.
3. DIRECTOR always gets everything, every page, no exception — never
   repeated per row.
4. Pure "report" pages (read-only, e.g. Order List, Gate Report, Batch
   Variance) are open to everyone relevant — viewing carries no risk.

**Special Rule (only stated when it overrides the Basic Rule):**
1. A page locked narrower than its normal department default (e.g.
   MM01/MM02 — SCM only, not even Director).
2. A named person holding more than one department (e.g. Nilkamal —
   Production + Quality).
3. A named person whose access is deliberately less/more than their
   role/department would normally give (e.g. Tanmoy/Ramen — Manager title,
   view-only power).
4. A named person's exclusive capability (e.g. AC04 create/edit — Soni
   only, everyone else in that department stays view-only).

---

## Group 1 — Operation Masters

Status: ✅ Decided + implemented in prod (2026-07-28, ACL v8)

| tx_code | Page | SCM | Stores | Logistics | Production | Director | Director-Reports | Management | Management-Reports | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|
| MM01 | Materials | V C E | | | | | | | | |
| MM02 | Vendors | V C E | | | | | | | | |
| MM03 | Vendor-Material Links (ASL) | V (C/E via MM02's Vendor-Create) | | | | V | | | | |
| MM04 | RM/PM Sales Customer — view | V | V | V | | V | | | | |
| MM04 | RM/PM Sales Customer — create/edit | C E | | | | C E | | | | |
| PM04 | Material Categories | V C E D | | | V C E (no D)¹ | V | | | | V C E D |

**Notes:**
- MM01/MM02: SCM only, no exception — not even Director/Director's hierarchy. Create/Edit lives on a
  separate companion resource (`OM_MATERIAL_CREATE`/`OM_VENDOR_CREATE`), not the list page itself
  (list page is VIEW-only by ACL design, matches the original dev-worksheet lock).
- MM03 (ASL): create/edit is not a separate mechanism — it reuses `OM_VENDOR_CREATE` (Vendor's own
  companion resource), so whoever can edit Vendors (SCM) can edit ASL too. Split into its own
  capability `CAP_OM_ASL` (view) so its department list could diverge from MM04's, since they
  used to share one bundled capability (`CAP_OM_MASTER_DATA`).
- MM04: split into `CAP_OM_CUSTOMER_VIEW` (SCM+Stores+Logistics+Director) and
  `CAP_OM_CUSTOMER_CREATE` (SCM+Director only) — Stores/Logistics can look up customers but not
  create new ones, matching the "only the owner department creates" pattern used everywhere else
  in this group.
- PM04: MANAGEMENT (the plant-head managers, Pradip/Kishor) removed — group is SCM, Production,
  QA, Auditor, Director only, per explicit instruction. No Director-Reports/Management-Reports
  access on any Group 1 page (none of these are report pages under the Basic Rule).
- ¹ PM04 (2026-07-28 correction): **QA also has V C E (no Delete)** — table has no QA column so
  noting here. QA creates Material Categories too (not just Production/SCM), but neither
  Production nor QA should be able to Delete a category (only SCM/Auditor keep Delete).
  Verified via code that this does NOT break Stroke Master's or Pack BOM's "Alternate Material"
  picker for QA/Production even with zero PM04 access — those pages resolve category names via
  their own server-side lookup (`serviceRoleClient`, bypasses ACL entirely), gated by Stroke
  Master's/Pack BOM's own permission, not PM04's.
- Director / Director-Reports / Management-Reports departments created 2026-07-28 specifically to
  stop MANAGEMENT-narrowing decisions from accidentally clipping Director too (recurring issue hit
  3+ times before this fix). Director dept currently mirrors whatever MANAGEMENT held at
  creation time (28 capabilities) plus whatever gets added explicitly per group from here on.
  Director-Reports/Management-Reports start with just `CAP_EVERYONE_REPORTS`, to be built up
  page-by-page as groups are decided (may diverge from each other later, per business owner).

---

## Group 2 — Procurement Masters

Status: ✅ Fully decided + implemented in prod (2026-07-28, ACL v14).

| tx_code | Page | SCM | Stores | Logistics | Director |
|---|---|---|---|---|---|
| PM01 | Payment Terms | V C E D | | | V |
| PM02 | Ports | V C E D | | | V |
| PM03 | Port Transit Times | V C E D | | | V |
| PM05 | Lead Times (Import + Domestic) | V C E D | | | V |
| PM06 | Transporters | V C E D | V C E | V C E | V |
| PM07 | Customs House Agents | V C E D | | | V |

**PM06 correction (2026-07-28, ACL v14):** Director corrected from full
power (V C E D) down to View-only, matching the Director-view-only pattern
now used consistently across the rest of Group 2. New `CAP_PROC_TRANSPORTER_VIEW`
(VIEW only) created and DIRECTOR work contexts moved onto it (both CMP003
and CMP006), off the full `CAP_PROC_TRANSPORTER` capability (which now
applies to SUPPLY CHAIN only). Pure ACL data change — no code involved, since
Director having/not-having Delete was always going to be enforced correctly
by the existing route-acl-registry gate once the redundant rank check was
removed for PM06 (already done). Verified via `precomputed_acl_view`.

**Revised decision (2026-07-28, supersedes the earlier "view-only, rank-gated"
note below for PM01/02/03/05/07):** business owner gave SCM full authority
(Create/Edit/Delete, not just View) on all five, Director drops to View-only
on these five specifically — a deliberate Special Rule override of the
"Director always gets everything" Basic Rule, same pattern already used for
MM01/MM02 in Group 1.

**Code fix — same root cause as PM06, now closed for all of Group 2
(2026-07-28):** PM01/02/03/05/07's write handlers had the identical
`assertManagerOrSARole` rank-check PM06 had — giving SCM a department
capability in ACL would have done nothing while that check stood, since any
User-tier SCM staff member would still be blocked (only Manager-tier+/SA
could write, regardless of department). Removed `assertManagerOrSARole(ctx)`
from all 30 remaining write/edit/delete/contact/email/map handlers across
Payment Terms, Ports, Port Transit, Import + Domestic Lead Times, and CHA in
`supabase/functions/api/_core/procurement/l2_masters.handlers.ts`.
`createMaterialCategoryHandler` (PM04, Group 1, already decided/implemented
separately) deliberately left untouched — out of scope here. Route-level ACL
gating (`route-acl-registry.ts`) for all 5 resource codes
(`PROC_PAYMENT_TERMS_MASTER`, `PROC_PORT_MASTER`, `PROC_PORT_TRANSIT_MASTER`,
`PROC_IMPORT_LEAD_TIME_MASTER`, `PROC_DOMESTIC_LEAD_TIME_MASTER`,
`PROC_CHA_MASTER`) was already correctly registered, so removing the
redundant rank check was the entire fix. Verified zero new `deno check`
errors via git-stash before/after (same 4 pre-existing `.count`/`.range`/
`.ilike` TS2339 errors, unrelated lines). Committed + pushed to `dev`
(`211b05e` for PM06; a second commit for this Group-2-wide fix) — user opens
the prod PR themselves, per standing instruction.

**ACL data (prod, done 2026-07-28, v13):** split the old `CAP_PROC_SETUP`
(previously VIEW-only, shared by DIRECTOR + SUPPLY CHAIN on all 6 menus) into
`CAP_PROC_SETUP` (now full VIEW+WRITE+EDIT+DELETE, kept on SUPPLY CHAIN only)
and new `CAP_PROC_SETUP_VIEW` (VIEW only, moved DIRECTOR onto it), across all
6 menu codes (5 pages, PM05 counted twice for Import+Domestic) and both
CMP003/CMP006. `role_capabilities` mirrored for the new capability. Pipeline
re-run: new `acl_versions` v13 for all 3 prod companies,
`capture_acl_version_source` + `generate_acl_snapshot`, stale v12
`precomputed_acl_view` rows deleted. Verified via `precomputed_acl_view`:
SUPPLY CHAIN = V/W/E/D all present on all 6 resource codes in both companies;
DIRECTOR = V only, on all 6, in both companies.

**PM06 — code fix + real department-based writes (2026-07-28):**
- **Root cause:** PM06's write handlers had the same `assertManagerOrSARole`
  rank-check as PM01/02/03/07, completely independent of ACL — so giving
  Stores/Logistics a Create/Edit capability in ACL would have done nothing,
  since the handler-level check would still block anyone below Manager rank.
- **Code fix:** removed `assertManagerOrSARole(ctx)` from the 9
  Transporter-specific handlers (`createTransporterHandler`,
  `updateTransporterHandler`, `deleteTransporterHandler`, contacts/emails/
  company-map get+upsert handlers) in
  `supabase/functions/api/_core/procurement/l2_masters.handlers.ts`.
  ~~PM01-03/05/07's handlers deliberately untouched — still Manager-rank-gated
  by design (not asked to change).~~ **Superseded 2026-07-28 same day:**
  business owner then asked for SCM full authority on PM01/02/03/05/07 too —
  see the Group 2 "Code fix" note above the table, which closes this for the
  remaining 30 handlers. Route-level ACL gating
  (`route-acl-registry.ts`, resource `PROC_TRANSPORTER_MASTER`, actions
  VIEW/WRITE/EDIT/DELETE) was already correctly registered, so removing the
  redundant rank check was the entire fix. Verified zero new `deno check`
  errors via git-stash before/after (4 pre-existing `.count`/`.range`/
  `.ilike` TS2339 errors, unrelated lines, confirmed present on the
  unmodified file too). Committed + pushed to `dev` (`211b05e`) — user opened
  the prod PR themselves (not pushed to prod by Claude, per standing
  instruction).
- **ACL data (prod, done 2026-07-28, v12):** split the old `CAP_PROC_TRANSPORTER`
  (VIEW-only) into two capabilities on the same `PROC_TRANSPORTER_MASTER`
  menu — `CAP_PROC_TRANSPORTER` now carries VIEW+WRITE+EDIT+DELETE (kept on
  DIRECTOR + SUPPLY CHAIN work contexts), and new
  `CAP_PROC_TRANSPORTER_LIMITED` carries VIEW+WRITE+EDIT only (STORES +
  LOGISTICS work contexts moved onto it, both CMP003 and CMP006).
  `role_capabilities` mirrored for the new capability (same role set as the
  original — role rank isn't the gate here anymore, department is). Pipeline
  re-run: new `acl_versions` v12 for all 3 prod companies,
  `capture_acl_version_source` + `generate_acl_snapshot`, stale v11
  `precomputed_acl_view` rows deleted. Verified via `precomputed_acl_view`:
  SCM+Director = V/C/E/D all ALLOW; Stores = V/C/E ALLOW, no DELETE row.
  Logistics has 0 users assigned in either company today, so it produces no
  snapshot rows yet — grant is wired correctly and will apply the moment
  someone is assigned there. Menu-snapshot rebuild skipped deliberately —
  VIEW/visibility didn't change, only the finer C/E/D grants (checked live
  via `precomputed_acl_view` at request time, not baked into
  `menu_snapshot.is_visible`).
- **Stores → GRN quick-add flow confirmed intact:** `GRNPostFlow.jsx`'s "Add
  to Transporter Master →" link (Transporter tab) gates on
  `isRouteAllowed(allowedRoutes, "/dashboard/procurement/masters/transporters")`
  — Stores already having View access keeps this working; this fix is what
  makes clicking through and actually creating + company-mapping a
  transporter succeed instead of a 403/silent-Manager-only block.

## Group 3 — Procurement (⬜ not started)
PO01 Purchase Orders, PO02 CSN Tracker, PO03 CSN Alerts, PO07 Stock Transfer Orders, PO11 Procurement Planning, PO12 Plant Transfers, PO13 Pending Order Approvals, PO14 Old Purchase Order, PO16 Legacy STO

## Group 4 — Receiving (⬜ not started)
PO04 Gate Entries, PO05 Goods Receipts, PO17 Gate Exit, PO18 Gate Entry Report

## Group 5 — Quality Assurance (⬜ not started)
PO06 QA Inspection Queue, PR01 Stroke Master, PR02 Stroke Approval, PR03 Change BOM Item, PR04 Change BOM Approval, PR12 PO Verify, PR15 Reversal, PR16 QA Approval Queue, PR17 Batch Number Release, PR18 SFG Result Recording, PR19 Partial Batch Reversal

## Group 6 — Returns & Claims (⬜ not started)
PO08 Return to Vendor, PO09 Debit Notes, PO10 Exchange References

## Group 7 — Accounts (⬜ not started)
AC01 Invoice Verifications, AC02 Blocked Invoices, AC03 Landed Costs, AC04 Conversion Cost Config

## Group 8 — Sales (⬜ not started)
SO01 Sales Orders, SO02 Sales Invoices

## Group 9 — Inventory (⬜ not started)
IN01 Physical Inventory, IN02 Stock Ledger, IN03 Current Stock, IN04 Stock Valuation, IN05 Opening Stock, IN06 Opening Stock Approval, PR21 FG Stock Breakdown

## Group 10 — Production (⬜ not started)
PR00 Plan Feed, PR05 Pack BOM Create, PR06 Pack BOM Approval, PR07 Change Pack BOM, PR08 Change Pack BOM Approval, PR09 Production PO Create, PR10 Production PO Edit, PR11 Production PO Final, PR13 Order List, PR14 Batch Variance Report, PR20 Partial Reversal Report, PR22 Old Process PO, PR23 Old Packing PO
