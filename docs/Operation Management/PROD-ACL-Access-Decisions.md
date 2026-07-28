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

Status: 🟨 PM01/02/03/07 decided (view-only, rank-gated writes — see structural
note); PM06 decided + code-fixed to real department-based writes (2026-07-28,
ACL v12); **PM05 still pending** (business owner explicitly excluded it from
"same as the others" and hasn't given its own decision yet).

| tx_code | Page | SCM | Stores | Logistics | Director |
|---|---|---|---|---|---|
| PM01 | Payment Terms | V | | | V |
| PM02 | Ports | V | | | V |
| PM03 | Port Transit Times | V | | | V |
| PM05 | Lead Times | ⬜ pending | ⬜ pending | ⬜ pending | ⬜ pending |
| PM06 | Transporters | V C E D | V C E | V C E | V C E D |
| PM07 | Customs House Agents | V | | | V |

**Structural note — PM01/02/03/07 (still true, PM06 is now the exception):**
These four pages are VIEW-only at the ACL/department level — no department-scoped
Create/Edit. Actual write authority (create/edit/delete a Payment Term, Port,
CHA, etc.) is governed by a separate, pre-existing backend rule
(`assertManagerOrSARole` in `l2_masters.handlers.ts`): any Manager-tier role
(L1_MANAGER+) or SA/GA, regardless of department, can write — not gated by ACL
capability. A User-tier SCM staff member can view but not create/edit; only an
SCM Manager (or Director/SA) can. Deliberately left as-is — business owner only
asked for PM06 to change (Stores/Logistics need Create/Edit because managers
aren't always present when a GRN needs a new transporter).

**PM06 — code fix + real department-based writes (2026-07-28):**
- **Root cause:** PM06's write handlers had the same `assertManagerOrSARole`
  rank-check as PM01/02/03/07, completely independent of ACL — so giving
  Stores/Logistics a Create/Edit capability in ACL would have done nothing,
  since the handler-level check would still block anyone below Manager rank.
- **Code fix:** removed `assertManagerOrSARole(ctx)` from the 9
  Transporter-specific handlers (`createTransporterHandler`,
  `updateTransporterHandler`, `deleteTransporterHandler`, contacts/emails/
  company-map get+upsert handlers) in
  `supabase/functions/api/_core/procurement/l2_masters.handlers.ts`. PM01-03/
  05/07's handlers deliberately untouched — still Manager-rank-gated by
  design (not asked to change). Route-level ACL gating
  (`route-acl-registry.ts`, resource `PROC_TRANSPORTER_MASTER`, actions
  VIEW/WRITE/EDIT/DELETE) was already correctly registered, so removing the
  redundant rank check was the entire fix. Verified zero new `deno check`
  errors via git-stash before/after (4 pre-existing `.count`/`.range`/
  `.ilike` TS2339 errors, unrelated lines, confirmed present on the
  unmodified file too). **Not yet committed to git** (dev branch) — pending
  user confirmation; will not be pushed to prod by Claude either way (user
  handles prod rollout via their own PR, per standing instruction).
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
