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
   **⚠️ Clarified 2026-08-06 (business owner, applies to every group, not
   just QA):** in practice this default is rarely invoked — DIRECTOR
   (Bijon, the real operational Director, as opposed to DIRECTOR-REPORTS)
   only gets access on a page when this doc **explicitly** states it for
   that page. If a page's row doesn't mention Director separately, Director
   gets nothing there. Basic Rule #3 stays written as the nominal default
   (so a genuinely-forgotten page still falls back to "Director gets
   everything" rather than nothing), but every group decided from
   2026-08-06 onward should treat DIRECTOR access as opt-in per page, not
   assumed.
4. Pure "report" pages (read-only, e.g. Order List, Gate Report, Batch
   Variance) are open to everyone relevant — viewing carries no risk.
5. **L4_MANAGER is never included in a department's normal full-access
   grant** (added 2026-08-06, confirmed applicable to every page, every
   department, not just Production). L4_MANAGER sits structurally with
   DIRECTOR-REPORTS (oversight/view, not hands-on operational
   Create/Edit/Approve) rather than as a normal working rank within their
   own department.
6. **L3_MANAGER does not exist as a normal rank inside any department's own
   ladder — "L3_MANAGER" always means Plant Head** (clarified 2026-08-06,
   locked). A department's own working ranks top out at L2_MANAGER; any
   page whose ceiling was previously described as "up to L3_Manager" really
   means "up to L2_MANAGER within the department, **plus** Plant Head via
   Structural Fallback (Special Rule #5)" — the two were already
   implemented together correctly wherever `CAP_QA_PLANTHEAD`/
   `CAP_PROD_PLANTHEAD_FULL` exist, this just fixes the loose "L3_Manager"
   label that had been used to describe it.
7. **DIRECTOR-REPORTS work context (and, by Basic Rule #5, L4_MANAGER) only
   ever gets access to genuine report-type pages** (clarified 2026-08-06).
   It does not get blanket View on operational pages just because it's a
   "Director-adjacent" or "oversight" context — only pages that are
   themselves reports (Basic Rule #4) carry a DIRECTOR-REPORTS/L4_MANAGER
   grant, and only when this doc explicitly says so for that page, same
   opt-in discipline as Basic Rule #3's Director clarification above.
8. **L1/L2_AUDITOR's real, substantive access is concentrated on specific
   pages, not spread thin as a small add-on everywhere** (clarified
   2026-08-06). Where Auditor doesn't have dedicated real work on a page,
   they get DIRECTOR-REPORTS-style access (Rule #7) at most, not an
   Approve/Manager-tier-adjacent grant "just in case."

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
5. **Structural Fallback** (named 2026-08-06, generalized from the
   pre-existing "Plant Head fallback" instance below): a page's owning
   department gets full access via plain department membership (Basic
   Rule #1) — but company org structure varies (some companies have a
   dedicated department manager, others rely on a generalist role like
   Plant Head to cover it), so a **second, always-on grant** goes to a
   specific rank+department (e.g. L3_MANAGER within MANAGEMENT), applied
   **uniformly to every company regardless of whether it's redundant
   there**. This is role/rank-based, not a named individual (distinct from
   #2/#3/#4) — it exists to make one rule correct across companies with
   different staffing shapes, without special-casing any company or
   person. First seen as "Plant Head fallback" (Group 5, Group 10 — see
   `CAP_PROD_PLANTHEAD_FULL`/`CAP_QA_PLANTHEAD`); any future page needing
   the same shape should cite "Structural Fallback" and reuse this
   reasoning rather than re-deriving it. See PR00's note in Group 10 for
   the canonical example.

---

## Cross-Module Dependency Taxonomy (established 2026-08-06)

When one page needs data or a write from another department's master/page, classify the
dependency BEFORE deciding ACL for it — most turn out to need zero standalone page access for
the dependent department at all:

- **Type ক — Inline quick-create.** An explicit, user-triggered "+New X" action embedded
  directly inside another page's own UI, creating a **new** record in the other module (e.g.
  Plan Feed's "+New Party", GRN's "+Add Transporter" link). Handled via a narrow companion
  CREATE capability wired to the owning resource's CREATE-companion (same pattern as
  `OM_VENDOR_CREATE`/`OM_MATERIAL_CREATE`), `menu_visible=false` on the owning page for the
  dependent department. Mechanical wiring — Claude's part, no per-instance user confirmation
  needed.
- **Type খ — Read/reference lookup.** Pure read access for display/dropdown/existence-check
  purposes, no write at all (e.g. Material dropdown in a PO line, Stroke-existence check in Plan
  Feed). Same treatment as Type ক — narrow VIEW-only companion capability, `menu_visible=false`,
  no confirmation needed.
- **Type গ — Genuine co-ownership.** A department navigates **directly** to another page's own
  UI to do real, standalone work there — not embedded/inline in their own page. This is a real
  business/ownership decision, not mechanical wiring — **requires explicit user confirmation**
  every time, never assumed.
- **Type ঘ — Automatic backend sync-back** (added 2026-08-06, confirmed via GRN/GE↔CSN, Group
  3). The owning page's own handler directly updates fields on an **existing** record in another
  module, as a side effect of its own action — never user-initiated on the other module's page,
  never a create (Type ক), and not a read (Type খ) either. Goes through `serviceRoleClient`
  straight inside the owning handler, **completely bypassing the other module's ACL** — the
  dependent department needs **zero** access of any kind to the other module for this to keep
  working, not even a companion capability. Canonical example: GRN posting writes
  `invoice_number`/`bl_number`/`lr_number` etc. directly into `consignment_note`
  (`grn.handlers.ts:925-953`) as a side effect of Stores' own GRN-post permission — Stores never
  touches CSN Tracker's ACL at all. Note GRN itself has **two different** CSN interactions: the
  "+Add Transporter" quick-add is Type ক, while this invoice/BL/LR sync-back is Type ঘ — same
  page, two different dependency shapes on two different targets (Transporter Master vs CSN).

---

## Identity note (locked 2026-07-29) — who "DIRECTOR" means in this doc

Three prod users hold role_code `DIRECTOR`:

| Name | User code | Role in this doc |
|---|---|---|
| Bijon Kanabar | P0074 | **This is who every "Director" row in this doc governs.** All the page-by-page View/Create/Edit/Approve/Delete decisions above and below are Bijon's actual access. |
| Himanshu Kanabar | P0002 | Separately under the `DIRECTOR-REPORTS` work context (created 2026-07-28) — reports-only, not affected by this doc's per-page decisions. |
| ACL MASTER (P0076) | P0076 | **Full, unrestricted access to every page in the system — deliberately isolated from all the narrowing decisions in this doc.** |

**Why P0076 needed its own work context:** P0076 originally shared the same `DIRECTOR` work context as Bijon. Every time this doc narrows Director's access on a page (e.g. PM06 corrected to View-only, PM01-07 corrected to View-only), that change would have silently also clipped P0076 — which was never the intent. Business owner confirmed P0076 should have full access to *everything*, with zero exceptions, unaffected by any future per-page decision made for Bijon.

**How it's implemented:** a new department + work context (`ACL-MASTER`, one per company: CMP003 `DEPT_DPT030`, CMP006 `DEPT_DPT031`) was created and P0076 moved onto it, off the shared `DIRECTOR` context. This new work context was granted **all 45 capabilities that exist in the system** (`role_capabilities` already included `DIRECTOR` for all 45 — confirmed via direct query — so only the `work_context_capabilities` grants were needed). Verified via `precomputed_acl_view`: 778/778 checks resolve ALLOW for P0076, zero DENY, no `user_overrides` rows on the account either. Menu snapshot rebuilt + old-context orphan rows cleaned (99 menu items visible per company).

**⚠️ Known tradeoff, explicitly accepted (not SA/GA):** this is a **maintenance-based** full-access grant, not the SA/GA kind that bypasses ACL entirely and therefore auto-includes every *future* page/capability with zero extra work. P0076 stays a normal ACL-governed account (by deliberate choice — "SA" was proposed and declined) — so **every future group/page decided in this doc from here on must also explicitly grant it to `ACL-MASTER`'s work context**, or P0076 will not automatically see new pages. Flagging this here so it isn't forgotten in later sessions.

**Coverage audits so far:** Group 5's session (2026-07-29) found and fixed 2 missed capabilities (`CAP_PROC_GRN_REVERSAL_AUDIT` from Group 4, and this group's own 6 new capabilities). A follow-up spot-check the same day (business owner asked "does ACL Master have everything now") found one more miss — `CAP_PROD_START_BATCH` (Production's own broad capability, unrelated to this group, simply never granted to ACL-MASTER when it was created) — fixed, ACL v21. As of v21, `acl.capabilities` vs ACL-MASTER's `work_context_capabilities` diff is empty except the 3 now-dead `CAP_QA_PROD_STANDARD`/`_MANAGER`/`_AUDITOR` capabilities (superseded by Group 5's tiered capabilities, hold zero grants anywhere now, harmless to leave off ACL-MASTER). A quick diff query (`acl.capabilities` minus ACL-MASTER's `work_context_capabilities`, per company) is the fast way to re-check this in future sessions rather than reasoning about it from memory.

---

## Group 1 — Operation Masters

Status: ✅ Decided + implemented in prod (2026-07-28, ACL v8). **✅ Revised + IMPLEMENTED 2026-08-06 (ACL v57, both companies) — session-wide rule reconciliation, see below.**

**⚠️ Revised 2026-08-06:** Group 1 is confirmed genuinely SCM+Director-only — no other
department gets standalone page access on any Group 1 resource, superseding the MM04
Stores/Logistics grant and PM04's direct Production/QA grants below.

- **MM04:** Stores/Logistics' earlier View grant removed. Every cross-department need this
  group serves turns out to be a Type-ক (inline quick-create, e.g. Plan Feed's "+New Party")
  or Type-খ (read/reference lookup) dependency — both handled via a narrow companion-resource
  capability + `menu_visible=false` on the dependent page, never standalone access to MM04's
  own page. No department needs to browse the Customer master directly except SCM+Director.
- **PM04:** Production's direct `V C E` grant removed — already verified via code (see the
  original 2026-07-28 note below) that Stroke Master's/Pack BOM's Alternate Material picker
  resolves category names via its own server-side lookup, bypassing ACL entirely; zero PM04
  access was already safe for Production, this just formalizes it. QA's direct grant removed
  too — QA's category-creation happens via an inline "+New Category" quick-create embedded in
  Stroke Master itself (Type ক), not by navigating to PM04's own page. QA gets a narrow
  companion CREATE capability wired to that inline flow instead (`menu_visible=false` on PM04).
  Auditor's existing `V C E D` grant is **unchanged** — pre-existing standalone audit access,
  not a dependency, out of scope for this revision.
**✅ IMPLEMENTED 2026-08-06 (ACL v57, both companies).**

- **MM04 View:** `CAP_OM_CUSTOMER_VIEW` — removed from LOGISTICS + STORES (zero genuine
  dependency found — searched the Page Dependency Manifest for every DO/Gate/Stores page,
  none reference `OM_CUSTOMER_LIST`/`OM_CUSTOMER_CREATE` at all). Kept for SCM/Director/
  **PRODUCTION** (see below — a real dependency the original design missed).
- **🔴 Real gap found and fixed — Production's own PR00 (Plan Feed) needs Customer
  access, contradicting this section's original premise:** `PlanFeedPage.jsx` (Production's
  own page) calls `GET /api/om/customers` (`OM_CUSTOMER_LIST:VIEW`) for its Party dropdown
  and `POST`/`PATCH /api/om/customer` (`OM_CUSTOMER_CREATE:WRITE`/`EDIT`) for its inline
  "+New Party" — this is literally the doc's own canonical Type-ক example (Cross-Module
  Dependency Taxonomy section above), yet Production's genuine need for it was never
  accounted for when this section was first drafted. Live data already had Production
  holding a working (if inconsistently-scoped) grant (`CAP_OM_CUSTOMER_CREATE_ONLY`,
  `menu_visible=true` but harmless since no `erp_menu.menu_master` row exists for the
  route-only `OM_CUSTOMER_CREATE` resource to show as a page) — left in place, verified
  correct against the manifest, not removed.
- **🔴 Second real gap found — Director's Create/Edit on MM04 (`CAP_OM_CUSTOMER_CREATE`)
  was never actually implemented**, despite the original 2026-07-28 table saying "Director:
  C E" — `work_context_capabilities` had zero row for DIRECTOR on this capability (only
  `SUPPLY CHAIN` + `ACL-MASTER` held it). Added.
- **PM04:** Production's and Quality's `CAP_OM_MATERIAL_CATEGORY_MAINTAIN` (which granted
  BOTH the inline `OM_MATERIAL_CREATE` companion AND standalone `PROC_MATERIAL_CATEGORY_
  MASTER`/PM04 page access) removed entirely from both departments.
- **🔴 Third real gap — the "zero PM04 access is safe for Production" claim (2026-07-28)
  was wrong when checked against live code, not just Stroke Master's read-only Alternate
  Material picker.** `ProductionPOCreatePage.jsx` (PR09, Production's own create page) has
  a real, reachable "+New Category" form (`createMaterialCategoryGroup()`, Packing section)
  that calls `OM_MATERIAL_CREATE:WRITE` — a genuine write dependency the original claim
  missed entirely. New narrow capability `CAP_OM_MATERIAL_CATEGORY_INLINE` (WRITE+EDIT only
  on `OM_MATERIAL_CREATE`, `menu_visible=false`, no VIEW since `OM_MATERIAL_LIST:VIEW`
  already covers the read side, no `PROC_MATERIAL_CATEGORY_MASTER` access at all) granted
  to both PRODUCTION and QUALITY (all 11 roles, department-membership-is-the-gate pattern) —
  covers Stroke Master/Pack BOM/Production PO Create's inline category-create and material-
  patch flows for both departments correctly.
- **Lesson (same class of miss as the Group 10/PR09 Plant Head gap earlier today):** a
  design note claiming "X department needs zero access here" must be checked against the
  Page Dependency Manifest for every page that department actually uses, not just the one
  or two pages the note happened to audit — an incomplete per-page code check produces a
  confidently-wrong "safe to remove" conclusion.
- **`user_overrides` check:** zero rows for any Group 1 resource, no conflict.
- **`generate_acl_snapshot()` join mechanics note (found while debugging the companion
  capability, applies to every future narrow-capability grant this session builds):** a
  capability only takes effect for a work context if it exists in **both**
  `acl.role_capabilities` (role → capability) **and** `acl.work_context_capabilities`
  (work context → capability) — inserting only the work-context row (as first attempted for
  `CAP_PROD_PLANTHEAD_MATERIAL_COMPANION` earlier today) silently produces zero
  `precomputed_acl_view` rows, no error. Both inserts are now standard practice for every
  new companion capability.
- **Verified (`precomputed_acl_view`, v57, both companies):** Production/Quality L3_USER
  (P0069/P0071/P0072/P0075) — `OM_MATERIAL_CREATE` WRITE+EDIT only, zero `PROC_MATERIAL_
  CATEGORY_MASTER`; Production additionally has `OM_CUSTOMER_CREATE` V/W/E +
  `OM_CUSTOMER_LIST` VIEW (Quality does not, correctly — no Customer dependency for QA).
  Bijon (Director) — `OM_CUSTOMER_CREATE` V/W/E now correctly present (was missing before).
  Logistics/Stores — zero rows on either Customer resource. ACL-MASTER drift check — clean.

Original table + notes below (2026-07-28) — kept for history and still-accurate implementation
detail (code fix rationale, capability names, verification results); the revision above is the
current source of truth for who gets standalone access.

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

Status: ✅ Fully decided + implemented in prod (2026-07-28, ACL v14). **⚠️ Revised 2026-08-06 — not yet implemented (see below).**

**⚠️ Revised 2026-08-06:** PM06's Stores+Logistics `V C E` grant removed — GRN's "+Add
Transporter" quick-add (`GRNPostFlow.jsx`'s Transporter tab link, confirmed in the original note
below) is a Type-ক inline dependency, the exact same pattern as Plan Feed's "+New Party."
Handled via a narrow companion CREATE capability wired to GRN's inline flow, `menu_visible=false`
on PM06 itself — not standalone page access for Stores/Logistics. PM06 now matches the rest of
Group 2 exactly: **SCM full authority, Director View-only, no other department.** All other
pages in this group (PM01/02/03/05/07) were already SCM+Director-only, unchanged.
**Not yet implemented** — design decision only; Claude wires the companion capability into GRN
during the batch-implementation pass.

Original table + notes below (2026-07-28) — kept for history and still-accurate implementation
detail; the revision above is the current source of truth for PM06.

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

## Group 3 — Procurement

Status: ✅ Decided + implemented in prod (2026-07-28), including PO02. **⚠️ Revised 2026-08-06 — PO12 only, not yet implemented (see below).**

**⚠️ Revised 2026-08-06 — PO12 (Plant Transfers):** reclassified as a genuinely different,
physical-stock-movement function, not part of SCM's Procurement pipeline proper — but it has
never had a formal redesign session of its own (unlike the rest of Group 3, which is settled
SCM+Director pipeline work). **Deactivated to ACL-MASTER-only pending a dedicated future
redesign session.** This removes Stores/Logistics/SCM's currently-LIVE full `V C E D` access
and the sending-company-`L3_MANAGER` approve chain documented below.

⚠️ **This is the one decision in today's whole reconciliation pass that takes away real,
currently-working access from real users** (Stores/Logistics staff who use PO12 today) —
unlike every other change this session, which either adds structure or touches
already-undesigned/unused surface. **✅ Confirmed by business owner 2026-08-06** — deactivate,
access limited to ACL-MASTER only, pending a dedicated future PO12 redesign session.

All other Group 3 pages (PO01, PO02, PO03, PO07, PO11, PO13, PO14, PO16) — unchanged, confirmed
SCM+Director-only pipeline. CSN Tracker's write path re-verified 2026-08-06, code-level, including
the specific concern that GE/GRN write real CSN detail fields (not just status/qty):
- **Gate Entry** (`gate_entry.handlers.ts:236-277`, `upsertCsnArrival`) — on GE post, writes
  `status`→GED, `gate_entry_date`, `gate_entry_id`, `received_qty`, `total_received_qty`.
- **GRN** (`grn.handlers.ts:925-953`, "CSN sync-back") — on GRN post, writes `status`→GRD,
  `grn_id`, `grn_date`, **`invoice_number`**, `transporter_id`, and either
  `lr_number`/`lr_date` (domestic) or **`bl_number`/`bl_date`/`boe_number`/`boe_date`** +
  port-to-plant LR (import) — i.e. the same Invoice/BL/LR detail fields CSN Tracker itself edits.
- Both go through `serviceRoleClient.schema("erp_procurement").from("consignment_note").update(...)`
  directly inside GE's/GRN's own handler — **zero `PROC_CSN_TRACKER` ACL check involved**, so
  Stores writing these fields via GE/GRN needs no CSN Tracker access at all, confirming
  SCM+Director-only remains safe even for these detail-field writes.

**Not yet implemented** — design decision only.

### PO02 — CSN Tracker

| tx_code | Page | SCM | Director |
|---|---|---|---|
| PO02 | CSN Tracker | V C E D (full authority — CRUD + sub-CSN + dispatch-qty, its own resource `PROC_CSN_TRACKER`) | V |

**Simple in the end, but two real findings surfaced while deciding it:**

1. **Stores' GRN workflow does NOT need any CSN Tracker access.** Investigated because Stores posts GRNs against gate-entry lines that carry a `csn_id`, and the GRN form pre-fills Invoice/BL/Transporter/LR fields "from CSN." Confirmed this is entirely a **backend, automatic** side effect: `createAndPostGRNFromLineHandler`/`reverseGRNHandler` read/write `consignment_note` directly (not via any `PROC_CSN_TRACKER`-gated route), and the pre-filled values Stores sees are plain form fields, not a CSN record or CSN Tracker navigation. No link/button to CSN Tracker exists anywhere in `GRNPostFlow.jsx`. Stores' own GRN permissions already cover everything they need — CSN Tracker access was floated, investigated, and correctly ruled out.
2. **Business owner initially wanted Stores (minus L4_MANAGER) + Plant Head (L3_MANAGER) to get View too, then reversed the decision** ("later I'll surface CSN data to people via a separate report instead") — landed on SCM+Director only, matching the rest of the group. Two things were built, verified working, then **fully removed again** in the same session (capabilities, menu-actions, work_context/role grants — nothing left dangling): `CAP_CSN_TRACKER_VIEW_STORES` (all ranks except L4_MANAGER) and `CAP_CSN_TRACKER_VIEW_PLANTHEAD` (L3_MANAGER only, held under the `MANAGEMENT` work context — verified Plant Head is **not** part of Stores' own work context, so a Stores-only grant would never have reached them).
3. **Real gap found while building the (now-reverted) Plant Head grant, worth remembering for later:** a blanket per-user `acl.user_overrides` DENY exists on the Plant Head's account for `PROC_CSN_TRACKER` (all 4 actions), dated 2026-07-27, reason *"Mgmt managers: no Procurement section"* — a standing policy from an earlier session. `user_overrides` DENY always wins over capability grants, so if Plant Head access to any Procurement-section page is ever wanted in the future, this override must be found and narrowed/revoked first, or a new capability grant will silently do nothing (exactly what happened here before it was caught).

**Pipeline:** ACL v16 (added, verified working) → v17 (reverted, verified clean) — both captured/generated/cleaned per the standard process. Final verified state via `precomputed_acl_view`: SUPPLY CHAIN = full V/W/E/D; DIRECTOR = V only; no other department holds any access.

| tx_code | Page | SCM | Stores | Logistics | Director |
|---|---|---|---|---|---|
| PO01 | Purchase Orders | V C E D (Approve: chain, see below) | | | V (Approve: chain fallback) |
| PO03 | CSN Alerts | V (read-only, no write actions exist) | | | V |
| PO07 | Stock Transfer Orders | V C E (Approve: chain, see below; no Delete action exists) | | | V (Approve: chain fallback) |
| PO11 | Procurement Planning | V (read-only) | | | V |
| PO12 | Plant Transfers | V C E D (Approve: sending company's L3_MANAGER) | V C E D (Approve: sending company's L3_MANAGER) | V C E D (Approve: sending company's L3_MANAGER) | V |
| PO13 | Pending Order Approvals | Same as PO01 (same underlying resource/handler) | | | Same as PO01 |
| PO14 | Old Purchase Order | SCM only, Create+Edit (no Approve — see note) | | | SCM only |
| PO16 | Legacy STO | SCM only, Create+Edit (no Approve — see note) | | | SCM only |
| PO19 | Print PO/STO | V W | | | |

**PO12 correction mid-session:** business owner initially said "SCM র kache" for the whole group, then corrected PO12 specifically — Plant Transfer isn't SCM's, it's Stores+Logistics+SCM together (all three full V/C/E/D), since it's a physical stock-movement function, not a procurement one. Director stays View-only, matching the rest of the group.

**PO14/PO16 correction (2026-08-03) — the earlier "no independent resource code exists" note above was wrong, corrected after live DB verification.** Both `PROC_PO_CREATE_OPENING` (PO14) and `PROC_STO_CREATE_OPENING` (PO16) **do** have their own independent `erp_menu.menu_master` resource codes (existed since 2026-07-06, predating the original note) — the backend API route itself is still shared with PO01/PO07 (no separate `route-acl-registry.ts` entry, so the earlier claim was right about that specific layer), but **sidebar/menu visibility is gated independently** by these codes.
- **PO16 was a real live bug, fixed 2026-08-03:** it was only mapped to `CAP_PROC_LOGISTICS`, VIEW-only, and that capability was held by **ACL-MASTER alone** (not SCM's real "SUPPLY CHAIN" work context) — so SCM's sidebar never showed PO16 at all, despite them having full regular STO access. Business owner's design: PO16 is SCM-only (Create+Edit), same as their other STO/PO access, no approval flow needed for this page. Fixed by mapping `CAP_PROC_STO` (the capability SCM's own work context already holds, VIEW+WRITE+EDIT) onto `PROC_STO_CREATE_OPENING`, and removing the now-redundant `CAP_PROC_LOGISTICS` mapping. ACL-MASTER keeps full access automatically (it already held `CAP_PROC_STO` too). Verified live: P0004/P0005/P0006 (SUPPLY CHAIN, both companies) now resolve VIEW+WRITE+EDIT; P0076 (ACL-MASTER) still resolves VIEW+WRITE+EDIT; zero APPROVE rows anywhere for this resource (correct — no approval page exists). Version bumped v35→v36 both companies.
- **PO14 was NOT the same bug** — `CAP_PROC_BUYER` (which gates `PROC_PO_CREATE_OPENING`) is already correctly held by SCM's own work context, not just ACL-MASTER. But only `VIEW` is registered for *any* capability on this resource — no `WRITE`/`EDIT` at all, for anyone, meaning the sidebar tile shows but the menu-level create/edit gate is effectively VIEW-only today. Flagged here, **not fixed** — business owner only asked about PO16 this round; revisit PO14 the same way if/when asked.

**Structural finding — Approve is a two-layer gate for PO01/PO07/PO13, unlike every other page in this group:**
1. **Route-level ACL** (`route-acl-registry.ts`) — coarse department gate, already correctly wired to `PROC_PO_CREATE:APPROVE`/`PROC_STO_CREATE:APPROVE`, granted to SCM (all ranks) + Director. Unchanged by this session's work.
2. **`acl.approver_map`** (checked *inside* the handler, via `assertProcurementHeadRole`/`assertStoApproverRole`) — a completely separate, per-document maker-checker layer that decides which *specific* person/rank is allowed to actually approve *this* PO/STO. This table was **completely empty in prod** before this session — meaning in practice only DIRECTOR (the built-in fallback) could ever approve anything, regardless of what ACL said.

**Approve-chain design, locked 2026-07-28 (rank-based, not named people):** business owner first asked for a 3-named-person chain (Alim → Prasenjit/Ankan, Prasenjit → Ankan, Ankan → Director), then asked whether this could instead be rank-based so it isn't tied to 3 specific individuals — checked Alim/Prasenjit/Ankan's actual roles (L2_USER/L3_USER/L1_MANAGER) and confirmed the chain generalizes cleanly:

| Creator's role | Approver's role |
|---|---|
| L2_USER | L3_USER **or** L1_MANAGER |
| L3_USER | L1_MANAGER |
| L1_MANAGER | DIRECTOR |

This applies to **anyone** holding that rank in SCM, not just the 3 named individuals — a new SCM L2_USER hired later gets the same chain automatically, no per-person config needed.

**PO12 (Plant Transfer) approve — separate, simpler design:** "sending plant's L3 Manager approves" — company=plant is 1:1 in this business, so this is just "the PTO's own `source_company_id`'s L3_MANAGER", company-wide (not creator-dependent, since Plant Transfer isn't a maker-checker-by-creator flow the way PO/STO are). PO12 previously had **zero** approver_map check of any kind (not even the DIRECTOR-only fallback) — see code-fix note below.

**Code fixes (4 files):**
1. **`po.handlers.ts` / `sto.handlers.ts`** — `assertProcurementHeadRole`/`assertStoApproverRole` (and their `loadPoApproverRules`/`loadStoApproverRules`) previously did a flat "is this user *anywhere* in approver_map for this company+resource+action" check — no creator-awareness beyond a same-person self-approval block. Rewired to use `_shared/workflow_scope.ts`'s `pickScopedApproverRules` (the same engine HR's leave/out-work approval already uses), which understands `scope_type=USER_EXCEPTION` (specific creator) and the newly-added `SUBJECT_ROLE` (creator's rank). Both fall back to DIRECTOR-only when nothing is configured or nothing matches — a plain company-wide setup keeps working untouched, this wasn't a breaking change to any *other* page's approver behavior (there wasn't any real data configured anywhere before this session, so nothing to break).
2. **`pto.handlers.ts`** — `approvePTOHandler` had **no company-scope check at all**: anyone with plain ACL approve-access in *any* company could approve a Plant Transfer belonging to a *different* company. Added `assertPtoVisibleToContext` (mirrors `sto.handlers.ts`'s existing `assertStoVisibleToContext`) requiring the approver's active company to match the PTO's `source_company_id` or `target_company_id`, plus a new `assertPtoApproverRole` using the same shared engine, scoped to the PTO's `source_company_id` specifically (never the approver's own active company, which may legitimately be the receiving side).
3. **`workflow_scope.ts`** — added `requester_role_code`/`subject_role_code` fields and a `SUBJECT_ROLE` branch in `matchesScopeType` (checked right after `USER_EXCEPTION`, before `WORK_CONTEXT`, in the scope-priority order). Purely additive — verified zero new `deno check` errors across all 7 files that import this shared module, including HR's leave/out-work/attendance-correction approval (unaffected).
4. All four handlers now fetch the creator's own `role_code` (a small `getUserRoleCode` lookup) and pass it through as `requester_role_code`.

**Bookkeeping-key workaround (no menu/schema hack):** `acl.approver_map` rows require their `resource_code` to be registered in `acl.module_resource_map`, which itself requires the resource to exist in `erp_menu.menu_master`. `PROC_PO_CREATE`/`PROC_STO_CREATE` are route-only companion resources that deliberately have **no** `erp_menu.menu_master` row (same established pattern as `OM_VENDOR_CREATE` — verified neither has one). Rather than force a menu entry into existence for a non-navigable action, the approver-lookup functions key off each resource's own already-registered sibling instead: **PO uses `PROC_PO_ORDER_APPROVALS`** (PO13's own resource — approving a PO is the same action whether triggered from PO01's page or PO13's queue, both call the identical function), **STO uses `PROC_STO_LIST`**. This is purely an internal bookkeeping key for the `approver_map` lookup — it does **not** change the actual route-level ACL gate, which stays `PROC_PO_CREATE:APPROVE`/`PROC_STO_CREATE:APPROVE` exactly as before.

**Two migrations — real DB constraint bugs found while seeding real chain data (empty table had never been exercised before):**
- `20260728143000_approver_map_subject_user_scope.sql` — `acl.approver_map`'s uniqueness index and 3-approver-per-scope cap both partitioned by `subject_work_context_id` but never by `subject_user_id`, so two different named creators routing to the same approver collided as "duplicates," and a 4-branch chain hit the 3-approver cap even though each branch is a distinct creator scope.
- `20260728150000_approver_map_subject_role_scope.sql` — adds `subject_role_code` column + the `SUBJECT_ROLE` value to the `scope_type` CHECK constraint; found and fixed the **identical bug a second time** on the role-based mirror index (`uq_approver_role_exact_subject_scope`) while seeding the actual L2_USER/L3_USER/L1_MANAGER chain — same partition gap, this time for role-based approvers instead of named ones.
- Both verified in dev first (scratch insert+rollback proving the fix), then via the standard migration-integrity workflow (local file = SSOT, `apply_migration` timestamp reconciled to match local filename, `migration-integrity-check.mjs` confirming `in_sync=true`) before the user's own PR deployed them to prod.
- **⚠️ Process note for future sessions:** an earlier `apply_migration` call targeting prod directly was flagged by the user as wrong (schema/DDL changes must go through git/PR, unlike this initiative's ACL *data* changes which go direct-to-prod) and the tool call was stopped mid-flow — but the database write had **already executed** before the stop took effect, leaving prod with an unreconciled migration row (`20260728171833`, MCP's own timestamp) that had no matching local file, which is exactly what broke the user's first PR deploy (`supabase db push` correctly refused with "remote migration versions not found in local migrations directory"). Fixed by reconciling the version number to match the local filename, after which the PR deployed cleanly. **Lesson: a "stopped" MCP tool call may already have executed server-side — verify directly against the database rather than assuming a stop meant no-op.**

**Final verification (prod, both CMP003 and CMP006):**
- `precomputed_acl_view`: SCM = full V/W/E/D(+A where applicable) on all Group 3 resources; Director = View-only (+Approve on PO_CREATE/STO_CREATE/PO_ORDER_APPROVALS, for the chain fallback); Stores/Logistics = full V/W/E/D/A on `PROC_PLANT_TRANSFER_LIST` only; MANAGEMENT correctly holds **zero** access (removed, matching the rest of this doc's department-narrowing pattern).
- `acl.approver_map`: 18 rows live in prod — 8 for PO (`PROC_PO_ORDER_APPROVALS`) + 8 for STO (`PROC_STO_LIST`) covering the 4-step rank chain × 2 companies, + 2 for PTO (`PROC_PLANT_TRANSFER_LIST`, company-wide `L3_MANAGER`) × 2 companies.
- Migration integrity: `in_sync=true` in both dev and prod, checksums matching local (377 files).

## Group 4 — Receiving

Status: ✅ Decided + implemented in prod (2026-07-29, ACL v19). Director gets nothing in this group — explicit exception, confirmed after the DIRECTOR-identity clarification above (Bijon specifically was asked, answer was "no need").

**✅ Revised + IMPLEMENTED 2026-08-06 (business owner, role-based, no named
individuals) — confirms this group mostly unchanged, adds Plant Head
Structural Fallback (Basic/Special Rule #5/#6) which the original design
didn't have.**

| tx_code | Page | Stores | Security | Plant Head | Audit | Director |
|---|---|---|---|---|---|---|
| PO04 | Gate Entries | V C E, up to L2_Manager | V C E (Prune stays Stores-only, see note) | ✅ (new) | — | — |
| PO05 | Goods Receipts (GRN) | V W E + Approve (Post), up to L2_Manager | — | ✅ (new) | D only (Reversal, unchanged) | — |
| PO17 | Gate Exit | V W, up to L2_Manager | V W | ✅ (new) | — | — |
| PO18 | Gate Entry Report | Open to everyone (all ranks, L1_User through Director) via `CAP_EVERYONE_REPORTS` — unchanged, this is a report page (Basic Rule #4) | | | | ✅ (unchanged) |

**What changed:** only the addition of Plant Head Structural Fallback to
PO04/PO05/PO17 (explicit "Ha kore dao" — company org-structure variance
now covered here too, same reasoning as Production/QA). GE Prune
(`pruneGateEntryHandler`) stays Stores-only, not shared with Security, per
the existing code-level rank check (`isSameOrHigher(ctx.roleCode,
"L3_USER")` within Stores) — confirmed unchanged. GRN Reversal stays
L1/L2_Auditor-only (separation of duties preserved here, unlike PR15 in
Group 5 which moved to QA department). PO18 unchanged — already matches
Basic Rule #4/#7 exactly (report page, open to everyone, no change needed).
Director stays at zero on PO04/05/17 (Basic Rule #3's opt-in default,
nothing stated here so nothing granted), consistent with the original
"Director gets nothing" note above.

**✅ Implemented 2026-08-06 — new `CAP_RECEIVING_PLANTHEAD` capability**
(VIEW on `PROC_GATE_ENTRY_LIST`; VIEW+WRITE+EDIT+APPROVE on `PROC_GRN_LIST`;
VIEW+WRITE on `PROC_GATE_EXIT` — same action set as Stores' own grant),
`role_capabilities` = L3_MANAGER+DIRECTOR (mirrors `CAP_QA_PLANTHEAD`'s
existing shape), `work_context_capabilities` = MANAGEMENT + ACL-MASTER, both
companies. New ACL version (v49, both companies) captured+generated since
v48 was already source-captured earlier today (re-running capture on an
already-captured version is a documented no-op — see §8). Verified via
`precomputed_acl_view`: the real Plant Head users (P0073/CMP003,
P0003/CMP006) now resolve ALLOW on all 3 resources with `menu_visible=true`;
P0076 (ACL-MASTER) still resolves ALLOW on everything (no drift); Stores'
own existing grant unchanged.

**✅ Dependency wiring 2026-08-06 — Page Dependency Manifest cross-check
(the step skipped in the first pass, corrected same session).** PO04/05/17's
frontend pages have 2 cross-module dependencies: `GRNDetailPage.jsx`'s
Document Flow tab needs `PROC_PO_LIST:VIEW` (Type খ), and
`GRNPostFlow.jsx`'s Transporter dropdown + "+Add Transporter" needs
`PROC_TRANSPORTER_MASTER:VIEW/WRITE/EDIT` (Type ক). Two new narrow
companion capabilities, both `menu_visible=false`:
- `CAP_GRN_DOCFLOW_VIEW` (VIEW on `PROC_PO_LIST`) — granted to STORES +
  MANAGEMENT + ACL-MASTER. **Real pre-existing gap found in passing: Stores
  itself had zero access to `PROC_PO_LIST`** before this — the Document Flow
  tab has been silently 403ing for Stores in prod, unrelated to anything
  from today, just never caught until the manifest cross-check ran.
- `CAP_GRN_TRANSPORTER_DEP` (VIEW+WRITE+EDIT on `PROC_TRANSPORTER_MASTER`) —
  granted to MANAGEMENT + ACL-MASTER only. Stores keeps its existing
  full-visible `CAP_PROC_TRANSPORTER_LIMITED` grant for now (Group 2's PM06
  revision, not yet implemented, will consolidate Stores onto this same
  companion when it lands — building Plant Head's copy this way now avoids
  redoing it twice).

**🔴 Second real bug found while verifying the above — `acl.capture_acl_version_source()`
never copied `menu_visible` into the version-scoped table at all**, and that
column defaults to `TRUE` (NOT NULL). Every ACL version bump since the
menu_visible mechanism was built has been silently resetting every hidden
companion capability back to fully visible in the captured version — the
bug was invisible until now because nothing had re-captured a hidden
grant's *first* version bump under close observation. Root-cause fixed in
`acl.capture_acl_version_source()` (now selects `menu_visible` like every
other column) — migration `20260806150000`, applied to dev, committed
(`9db1869e`), **needs the business owner's PR to reach prod**. Prod's
already-wrong v49/v50 version-table rows for the two new companion
capabilities were corrected directly via MCP (data-only fix, safe pending
the function fix) and re-propagated via a fresh v51.

**🔴 Third finding, not a bug — a pre-existing business policy colliding
with today's new decision.** Both real Plant Head accounts (P0073, P0003)
carry a blanket per-user `acl.user_overrides` DENY dated 2026-07-27, reason
*"Mgmt managers: no Procurement section"* / *"no Procurement Masters"*,
covering ~30 `PROC_*` resources — including `PROC_PO_LIST:VIEW` and
`PROC_TRANSPORTER_MASTER:VIEW` specifically, exactly the two dependencies
above. `user_overrides` DENY always outranks capability grants, so both
companion capabilities were silently doing nothing until this was found.
**Business owner's instruction (2026-08-06): the who-gets-what decision is
already made, so resolve conflicts like this permanently, not case-by-case.**
Revoked (via `revoked_at`, not deleted — history preserved) just those 2
specific (resource_code, action_code) override rows for P0073/P0003; the
other ~28 rows in that same 2026-07-27 policy (CSN Tracker, PO/STO create,
Procurement Masters, etc.) are untouched — this was a narrow, targeted
resolution, not a blanket revoke. Re-captured as v51 (both companies).
Verified via `precomputed_acl_view`, v51, active: both dependencies now
resolve ALLOW with `menu_visible=false`; core Group 4 grant (Gate
Entry/GRN/Gate Exit) unaffected; P0076 (ACL-MASTER) has zero non-ALLOW rows
(no drift). **Standing rule going forward:** whenever a new department/user
gets a fresh capability grant, check `acl.user_overrides` for that
user/resource combination before declaring the grant complete — a
correctly-wired capability can still be silently defeated by an older
per-user DENY, exactly as it was here.

**🔴 Real security gap found and fixed during this implementation pass
(2026-08-06) — company-scope gap, `grn.handlers.ts` +
`gate_entry.handlers.ts`.** While checking Bug Pattern #2 as part of the
13-pattern pre-implementation sweep: `createAndPostGRNFromLineHandler`,
`reverseGRNHandler`, `getGRNHandler`, `getGELinesForGRNHandler`, and (via
the shared `fetchGateEntryBundle`/`hydrateGateEntry` helpers)
`getGateEntryHandler`, `getGateEntryByNumberHandler`,
`updateGateEntryHandler`, `createGateExitInboundHandler`,
`pruneGateEntryHandler` all fetched a gate_entry/GRN record by id or
business number and read/posted/reversed/updated it — **without ever
validating the record's `company_id` against the caller's own
`erp_map.user_companies` scope.** A user in one company could view or
mutate another company's GRN/Gate Entry data by id/number alone, no ACL
grant on the wrong company needed. Fixed: `assertCompanyScope(ctx,
record.company_id)` added right after each fetch, before any further
read/write; the two Gate Entry helpers now take `ctx` so the check covers
every call site in one place. Each catch block's status-mapping updated so
`COMPANY_SCOPE_VIOLATION` returns 403 (several previously fell through to a
generic 500). Verified zero new `deno check` errors via git-stash
before/after on both files. Committed (`bdc8e797`), pushed to `dev`. This
was not part of the original Group 4 access-decision scope — found only
because the 13-bug checklist was applied rigorously per the business
owner's explicit instruction, not skipped for a "just wire the capability"
shortcut.

**Two corrections mid-decision, both against the business owner's own initial assumptions — verified against live code before implementing:**
1. **"I don't think there's a Delete here" — wrong.** GRN has a real DELETE-registered action: reversal (`POST /api/procurement/grns/:id/reverse` → `PROC_GRN_LIST:DELETE`). Confirmed via `route-acl-registry.ts`. Once surfaced, business owner assigned it deliberately narrower than Stores' own full access: **only L1/L2 Auditor can reverse a GRN** — Stores posts (Approve) freely but cannot undo their own posting, a genuine separation-of-duties control (Stores creates+finalizes, an independent Auditor is the only one who can undo it).
2. **Gate Entry "mistake" mechanism found and rank-restricted mid-session.** Investigated what happens if a Gate Entry is wrong — found a `pruneGateEntryHandler` (voids the entry, releases linked CSNs back to open, hard-blocked unless all linked GRNs are already reversed first). Business owner then specified Prune should be **Stores' L3_USER and above only**, not every Stores rank — but Prune's ACL action is *the same* `PROC_GRN_LIST:WRITE` that plain GRN creation uses (which every Stores rank needs), so the rank ceiling can't be expressed at the ACL layer alone.

**Code fix (1 file):** `gate_entry.handlers.ts`'s `pruneGateEntryHandler` now has an explicit rank check (`isSameOrHigher(ctx.roleCode, "L3_USER")`, using the existing `_shared/role_ladder.ts` helper) inside the handler, on top of the ACL department gate. `isSameOrHigher` naturally lets SA/GA/Managers/Director through too — ACL's own Stores-only department gate is what keeps this from reaching unrelated departments, the rank check only narrows *within* Stores. Verified zero new `deno check` errors.

**ACL data:** two pre-existing capabilities (`CAP_PROC_RECEIVING`, `CAP_PROC_GATE_SECURITY`) were already purpose-built for exactly this Stores/Security split in an earlier session, but had real gaps: `CAP_PROC_RECEIVING` was over-broadly held by AUDIT/DIRECTOR/MANAGEMENT/SECURITY too (narrowed to STORES only, matching this doc's established pattern); `CAP_PROC_GATE_SECURITY` had the right menu-actions defined but **zero work_context holders at all** — Security had never actually been granted its own capability. Both were also missing the EDIT action entirely (nobody could edit a Gate Entry after creating it). Fixed:
- `CAP_PROC_RECEIVING` narrowed to STORES; added missing EDIT (Gate Entry) and EDIT+APPROVE (GRN) actions.
- `CAP_PROC_GATE_SECURITY` granted to SECURITY work context (both companies); added missing EDIT action.
- New `CAP_PROC_GRN_REVERSAL_AUDIT` capability (VIEW+DELETE on `PROC_GRN_LIST`), granted to AUDIT work context, `role_capabilities` restricted to `L1_AUDITOR`/`L2_AUDITOR` only (not the full role set other capabilities get).

**Verified via `precomputed_acl_view`:** Stores = full V/C/E/W(+Approve on GRN, no Delete); Audit = V+DELETE on GRN only; Security's grant is correctly wired but currently has 0 users assigned in either company (same as Logistics earlier — will apply the moment someone is assigned there).

## Group 5 — Quality Assurance

Status: ✅ Decided + implemented in prod (2026-07-29, ACL v20). No report pages
in this group yet — Director gets **nothing** for now (business owner: report
pages will be split off this group later and get access at that point).

**⚠️ Revised 2026-08-06 (business owner, role-based, no named individuals)
— supersedes the table/notes below where they conflict. Design-phase only,
not yet implemented; see the "Not yet implemented" note at the end of this
revision block.**

| tx_code | Page | QA ceiling | Plant Head | Director | L4_Mgr / Dir-Reports / Auditor |
|---|---|---|---|---|---|
| PO06 | Inward QA | full dept, up to L2_Manager | ✅ | ✅ View (explicit) | ✅ View (explicit) |
| PR01 | Stroke Master | full dept, up to L2_Manager (raised from L1_Manager) | ✅ (new) | — | — |
| PR02 | Stroke Approval | Manager-tier only, L1-L2_Manager (Auditor removed) | ✅ | — | — |
| PR03 | Change BOM Item | = PR01 | ✅ (new) | — | — |
| PR04 | Change BOM Approval | = PR02 (Auditor removed) | ✅ | — | — |
| PR12 | Process PO Verify | full dept, up to L2_Manager | ✅ | — | — |
| PR15 | Reversal (CORS) | full dept, up to L2_Manager (moved from Auditor-only) | ✅ | — | — |
| PR16 (QA-approve part) | QA Approval Queue | full dept, up to L2_Manager | ✅ | — | — |
| PR16 (Start Batch part) | QA Approval Queue | Production dept, up to L2_Manager (now capped — was previously Production's uncapped broad access) | ✅ | — | — |
| PR17 | Batch Number Release | Manager-tier only, L1-L2_Manager | ✅ | — | — |
| PR18 | SFG Result Recording | full dept, up to L2_Manager (raised from L2_Manager ceiling — see note) | ✅ (new) | — | — |
| PR19 | Partial Batch Reversal | full dept, up to L2_Manager (raised — see note) | ✅ (new) | — | — |

**What changed and why (business owner instruction, 2026-08-06):**
- **L3_MANAGER clarified (Basic Rule #6):** it never existed as a QA-internal
  rank — it always meant Plant Head. "Up to L3_Manager" in the original
  table (PO06/PR12/PR16-QA-part) is unchanged in effect, just now correctly
  expressed as "up to L2_Manager + Plant Head via Structural Fallback."
  PR01/PR03/PR18/PR19 are **genuinely raised** — they previously had no
  Plant Head fallback at all (PR01/PR03 capped at L1_Manager with zero
  Management-dept access; PR18/PR19 capped at L2_Manager with zero
  Management-dept access) — now all four get the same full-dept-ceiling +
  Plant Head shape as PO06.
- **PR15 moved from Auditor-exclusive to QA department** (explicit
  instruction — "PR15 o QA r kachei thak, PO06 er moto"). This removes the
  separation-of-duties control the original design had (QA could not
  reverse their own posting; only an independent Auditor could) — flagged
  to the business owner at decision time, confirmed as intentional.
- **PR02/PR04 lose their Auditor add-on** — per Basic Rule #8 (Auditor's
  real work concentrates on specific pages, PR15 now being one of them —
  not spread as a small add-on across every approval page).
- **PR16's two parts, decided separately:** QA-approve part follows the same
  full-dept+Plant-Head shape as PO06 (business owner: "PO06 er moto thik
  ache"). Start Batch part is explicitly **not** QA's job ("start batch to
  QA korle hobena") — it's Production's own pipeline action, but is now
  explicitly capped at "up to L3_Manager" (i.e. up to L2_Manager + Plant
  Head, Basic Rules #5/#6) rather than left on Production's old uncapped
  broad grant (`CAP_PROD_STANDARD`/`CAP_PROD_OPERATOR`) — this is a
  narrowing that also needs to not regress PR09/PR11 (Production's other
  pages), since those capabilities are shared; likely needs its own
  resource-level split at implementation time, same shape as the original
  Start-Batch-vs-Batch-Release split noted below.
- **Director and DIRECTOR-REPORTS/L4_MANAGER/Auditor default to nothing**
  on every page in this group **except PO06**, where Director and
  L4_Manager were explicitly given View (Basic Rules #3/#7's new opt-in
  discipline — this table's blank cells are deliberate, not omissions).

**✅ 2026-08-06 revision IMPLEMENTED (ACL v53→v54, both CMP003/CMP006).**

- **Tier-capability rank cleanup:** `CAP_QA_TIER_L1MGR`/`_L2MGR`/`_L3MGR`
  (discovered to be byte-identical role lists despite the tier naming —
  L1_User through L4_Manager + DIRECTOR all present on all three) stripped
  of L3_MANAGER/L4_MANAGER/DIRECTOR uniformly — L3_Manager-equivalent access
  now comes exclusively through the separate `CAP_QA_PLANTHEAD` mechanism
  (Structural Fallback), never through the department capability itself.
  `CAP_QA_MGR_TIER` similarly capped at L1/L2_Manager.
- **`CAP_QA_PLANTHEAD` extended** to PR01/PR03/PR15/PR18/PR19 (new
  menu-action rows) — Plant Head now gets the same full-dept-ceiling +
  fallback shape on these five pages as PO06/PR12/PR16 already had.
- **`CAP_QA_AUDITOR_TIER` menu-action rows removed** from PR02/PR04 (Basic
  Rule #8 — Auditor's real work concentrates on PR15, not spread thin).
- **PR15 moved from Auditor-exclusive to the QA department capability**
  (business owner: "PR15 o QA r kachei thak, PO06 er moto") — QA dept can
  now self-reverse (CORS), the separation-of-duties control is
  intentionally removed per instruction.
- **New `CAP_PO06_VIEW_EXTRA`** (VIEW only) created and granted to
  DIRECTOR + AUDIT work contexts (both companies) — the explicit
  Director/L4_Manager/Dir-Reports/Auditor View-only opt-in on PO06 that
  Basic Rules #3/#7 require, without touching the department's own full
  grant.
- **PR16 Start Batch investigated, left as-is (no narrowing needed):**
  confirmed `CAP_PROD_START_BATCH` is already scoped narrowly to
  `PROD_START_BATCH:WRITE` only — no PR09/PR11 blast radius exists to
  protect against. The doc's original worry (shared
  `CAP_PROD_STANDARD`/`CAP_PROD_OPERATOR`) turned out to only describe the
  QA-approve half of PR16, not Start Batch.
- **🔴 Real leak found and fixed during this pass, not in the original
  design notes above — `CAP_PROD_OPERATOR` (Production's own OM08-10 +
  PR16 capability) also carried a stray full-CRUD (`VIEW`/`WRITE`/`EDIT`/
  `DELETE`) grant on **PO06** (`PROC_QA_QUEUE`), inserted 2026-08-05
  18:29 UTC — i.e. during this same implementation session, not legacy
  debris. Held by PRODUCTION, MANAGEMENT, AUDIT, and DIRECTOR work
  contexts in both companies, directly contradicting this section's own
  "Director gets nothing except View on PO06" lock (Director was resolving
  full CRUD, not the intended View-only via `CAP_PO06_VIEW_EXTRA`). Fixed
  by deleting the 4 `(CAP_PROD_OPERATOR, PO06's menu_id, *)` rows from
  live `capability_menu_actions` — surgical removal, same pattern as the
  `CAP_PROC_QA`/PO05+PO06 leak found in Group 4's session. `CAP_PROD_OPERATOR`'s
  legitimate OM08/OM09/OM10/PR16 rows are untouched.
- **Dependency manifest + `user_overrides` cross-check (per explicit
  instruction not to repeat Group 4's skipped-dependency miss):** QUALITY
  dept's `PROC_PO_LIST:VIEW` (PO06's Document Flow tab dependency) already
  satisfied via `CAP_GRN_DOCFLOW_VIEW`; `PROC_GRN_LIST:VIEW` already
  satisfied via `CAP_PROC_QA` (scoped only to QUALITY + ACL-MASTER after
  Group 4's cleanup, no leak). Zero `acl.user_overrides` rows exist for any
  Group 5 resource code in either company — no blanket-DENY conflict like
  Group 4's Plant Head case.
- **Verified on v54 (`precomputed_acl_view`, both companies):** Nilkamal
  (P0009, L2_MANAGER dual QUALITY+PRODUCTION) — full VIEW/WRITE/EDIT/
  DELETE/APPROVE on PO06. Pradip/Kishor (Plant Head, L3_MANAGER,
  MANAGEMENT) — same full access via `CAP_QA_PLANTHEAD`. Bijon Kanabar
  (real Director) — **VIEW only** on PO06, zero elsewhere in the group.
  ACL-MASTER (P0076) — full access, both companies, zero drift.

---

**Original design notes below (2026-07-29) — kept for history and
still-accurate implementation detail (capability names, code fixes,
verification results); table above is the current source of truth for
access decisions, not the table immediately below.**

**Business context locked before deciding (business owner, verbatim intent):**
CMP003 has a dedicated Production+QA manager (Nilkamal, L2_MANAGER, holds
*both* the QUALITY and PRODUCTION work contexts). No other company has a
dedicated QA/Production manager — in those companies, the Plant Head
(L3_MANAGER, MANAGEMENT work context) does that work instead. This shaped
every ceiling below: QUALITY-department grants cover the dedicated-manager
case; a separate Plant Head grant (MANAGEMENT work context, role restricted
to L3_MANAGER) covers every other company as a fallback, applied to whichever
pages need Manager-tier action. Applies uniformly including CMP003's own
Plant Head (Pradip) — redundant with Nilkamal there, but granted anyway per
explicit instruction ("Na Pradip keo Grant debo").

| tx_code | Page | QUALITY dept ceiling | Manager-tier / Auditor add | Plant Head fallback |
|---|---|---|---|---|
| PO06 | Inward QA (Inspection Queue) | up to L3_Manager | — | ✅ |
| PR01 | Stroke Master | up to L1_Manager | — | — |
| PR02 | Stroke Approval | — | Manager-tier (L1/L2/L3_Manager) + L1/L2_Auditor | ✅ |
| PR03 | Change BOM Item (Stroke Change Request, create) | up to L1_Manager | — | — |
| PR04 | Change BOM Approval (Stroke Change Request, approve) | — | Manager-tier (L1/L2/L3_Manager) + L1/L2_Auditor | ✅ |
| PR12 | Process PO Verify | up to L3_Manager | — | ✅ |
| PR15 | Reversal (CORS) | — | L1/L2_Auditor only | — |
| PR16 | QA Approval Queue — QA-approve part | up to L3_Manager | — | ✅ |
| PR16 | QA Approval Queue — Start Batch part | Production's own existing broad access (`CAP_PROD_STANDARD`/`CAP_PROD_OPERATOR`), unrelated to this group | — | — |
| PR17 | Batch Number Release | — | Manager-tier only (L1/L2/L3_Manager, no User-tier) | ✅ |
| PR18 | SFG Result Recording | up to L2_Manager | — | — |
| PR19 | Partial Batch Reversal | up to L2_Manager | — | — |

**Real structural bug found in code before implementing (same root-cause
family as PM06/PM01-07 in Group 2, but worse):** `inward_qa.handlers.ts`
(PO06) had `assertQARole`/`assertQAManagerRole` checking against **fake role
codes that don't exist anywhere in `role_ladder.ts`'s real `ROLE` enum** —
`"PROCUREMENT_HEAD"`, `"QA_OFFICER"`, `"STORE_MANAGER"`. Since no real user's
`ctx.roleCode` could ever equal these strings, only SA/GA (which bypass all
handler-level checks) could ever pass — every other role was silently
blocked from PO06 regardless of what ACL said, including plain VIEW. Fixed:
removed all 7 call sites (`listQADocumentsHandler`, `getQADocumentHandler`,
`addTestLineHandler`, `updateTestLineHandler`, `deleteTestLineHandler`,
`submitUsageDecisionHandler`, plus the nested FOR_REPROCESS-specific check),
deleted the now-dead `QA_ALLOWED_ROLES`/`QA_MANAGER_ROLES` constants and the
two functions entirely.

**Same `assertManagerOrSARole` pattern as Group 2, found and removed across
5 more production files (13 call sites total):**
- `stroke_master.handlers.ts` — PR02's approve/reject/revert (3 calls)
- `stroke_change_request.handlers.ts` — PR03's create + PR04's approve/reject (3 calls)
- `process_order.handlers.ts` — PR16's QA-approve/reject, PR12's Verify, PR15's Reversal (4 calls)
- `partial_reversal.handlers.ts` — PR19's create (1 call)
- `batch_series.handlers.ts` — PR17's release (1 call)

Each removal is the same story as PM06: the ACL department gate was already
correctly registered in `route-acl-registry.ts`, but a redundant
handler-level rank check (hardcoded Manager-or-SA, independent of ACL) would
have silently overridden any department-based grant — User-tier QUALITY
staff would still have been blocked from PR01/PR03 regardless of the new
`CAP_QA_TIER_L1MGR` capability, for example. Verified zero new `deno check`
errors across all 6 edited files (git-stash before/after).

**Two shared-resource-code conflicts found and split (same root-cause family
as PM06 vs PM01-07 in Group 2, but requiring a genuine new resource code
rather than just removing a rank check, since both actions are legitimately
different departments):**
1. **"Start Batch" (Production's own click, inside PR16) vs PR17's "Batch
   Release" (QA/Manager's action)** — both used `PROD_BATCH_RELEASE`,
   meaning they could never have independent rank ceilings. Split: Start
   Batch now uses its own `PROD_START_BATCH` resource (`CAP_PROD_START_BATCH`,
   already broadly held by all 11 roles under Production's own access — no
   QUALITY-tier involvement, correctly out of scope for this group's design).
2. **PR16 (QA-approve part) vs PR18 (SFG Result Recording)** — both used
   `PROD_QA_QUEUE`. Split: PR18 now uses its own already-registered
   `PROD_SFG_RESULT_RECORDING` resource (existed in prod `acl.menu_master`
   from an earlier session, only the `route-acl-registry.ts` mapping needed
   fixing — all 5 `sfg-qa-documents` route entries moved off `PROD_QA_QUEUE`).

Both required a `route-acl-registry.ts` edit; the Start Batch split also
needed a new capability (`CAP_PROD_START_BATCH`, already granted broadly —
pre-existing, unaffected by this group's ACL work). Verified zero new `deno
check` errors.

**ACL data — 6 new capabilities built** (the pre-existing 3-tier system,
`CAP_QA_PROD_STANDARD`/`_MANAGER`/`_AUDITOR`, didn't map to these more
granular per-page ceilings — see removal note below):
- `CAP_QA_TIER_L1MGR` (up to L1_Manager) — PR01, PR03 — QUALITY dept
- `CAP_QA_TIER_L2MGR` (up to L2_Manager) — PR18, PR19 — QUALITY dept
- `CAP_QA_TIER_L3MGR` (up to L3_Manager) — PO06, PR12, PR16 (QA-approve part) — QUALITY dept
- `CAP_QA_MGR_TIER` (Manager-tier only, L1/L2/L3_Manager, no User-tier) — PR02, PR04, PR17 — QUALITY dept
- `CAP_QA_AUDITOR_TIER` (L1/L2_Auditor) — PR02, PR04, PR15 — AUDIT dept
- `CAP_QA_PLANTHEAD` (L3_Manager role only) — PO06, PR02, PR04, PR12, PR16 (QA-approve part), PR17 — MANAGEMENT dept

**🔴 Major pre-existing gap found and fixed while verifying: the old
`CAP_QA_PROD_STANDARD`/`CAP_QA_PROD_MANAGER`/`CAP_QA_PROD_AUDITOR`
capabilities were blanket-granted to literally every department in CMP003
and CMP006** (QUALITY, PRODUCTION, MANAGEMENT, AUDIT, DIRECTOR, even
ACL-MASTER) **plus CMP010's AUDIT department** — with `role_capabilities`
covering all 11 roles / 5 Manager-tier roles+Director / 2 Auditor roles
respectively. This completely defeated the new tiered design: every
department's every eligible role already had full access to all 11 Group 5
pages via this old blanket grant, department scoping was not actually in
effect, and — critically — the DIRECTOR department itself held it too,
directly contradicting "Director gets nothing in this group." All 30
`work_context_capabilities` rows for these 3 capabilities were deleted
(their `capabilities`/`role_capabilities` rows left in place as harmless
dead references, not deleted, in case anything else still points at them —
worth a follow-up cleanup pass later).

**🔴 Second gap found during verification: `capture_acl_version_source`
is capture-once, not idempotent.** The function has a guard
(`IF source_captured_at IS NOT NULL THEN RETURN`) — calling it again on an
already-captured `acl_version_id` (which v19 was, from the end of Group 4)
is a silent no-op. All of this group's live-table changes (new capabilities,
the old-capability removal) never actually reached `precomputed_acl_view`
until this was caught — first-pass verification showed Bijon Kanabar (the
real Director) with full access to every Group 5 page, sourced entirely from
the still-cached old blanket grants. Fixed by bumping to a fresh
`acl_versions` row (**v20**, all 3 companies) rather than reusing v19 — this
is the same "bump the version" pattern already used throughout this doc
(v12→v13→...→v19), the one place it was skipped was reusing v19 across two
separate work sessions on the same day. **Correction to the god-mode note
above:** "ACL version capture করাই যথেষ্ট" (CLAUDE.md, 2026-07-19) is only
true for a version's *first* capture — re-running it on an already-captured
version does nothing. Any future MCP-based ACL data session must bump to a
new version, not reuse the last one.

**P0076 (ACL MASTER) god-mode gap, found and fixed in the same pass:**
verifying against `precomputed_acl_view` showed P0076 (role `DIRECTOR`)
missing all 6 new Group 5 capabilities via `role_capabilities` (deliberately
excluded, since Director gets nothing in this group) — the isolation
principle from the note above ("P0076 immune to Director-narrowing
decisions") means this is exactly the case it exists for. Added `DIRECTOR`
to `role_capabilities` for all 6 new capabilities (safe — Bijon only holds
the plain `DIRECTOR` work context, not QUALITY/MANAGEMENT/AUDIT/ACL-MASTER,
so this doesn't leak to him) and granted all 6 to `ACL-MASTER`'s work
context in both companies. **Also found the identical gap already existing
from Group 4:** `CAP_PROC_GRN_REVERSAL_AUDIT` (L1/L2_Auditor-only, GRN
Reversal) was never added to ACL-MASTER or to `DIRECTOR`'s
`role_capabilities` — fixed the same way, same pass. Not a full re-audit of
every earlier group's capabilities against ACL-MASTER — flagging that this
maintenance obligation has already been missed once and may be missed again
elsewhere.

**False start, caught and reverted same session (2026-07-29):** briefly
tried splitting PO06/PR12/PR16's Approve+Delete off to Manager-tier only,
misreading an earlier "result recording — any QA person can do it" note as
implying the *decision* (Usage Decision / UD) itself was Manager-scoped.
**Business owner corrected this immediately: UD is exactly like GRN
posting — any QA staff member does it as their regular job, not an
escalation-style Approve.** `PROC_QA_QUEUE`'s "Approve" action here isn't a
maker-checker workflow gate (the kind Basic Rule #2 is about, e.g. PO/STO's
creator-then-manager chain) — it's the QA tester's own pass/fail call,
so User-tier keeps full V/C/E/D/A same as everyone else in the tier.
Reverted in the same session — `CAP_QA_TIER_L3MGR` restored to its original
full action set, the mistaken addition to `CAP_QA_MGR_TIER` removed. Net
effect after v21→v22→v23: **identical to the original v20/v21 design**,
just with the extra `CAP_PROD_START_BATCH` god-mode grant from the v21 step
still in place. Noted here as a caution for future groups: not every
"Approve" action is a Basic-Rule-style manager escalation — check what the
action actually represents (regular job function vs. workflow gate) before
assuming the rule applies.

**Final verification (prod, `precomputed_acl_view`, v23, both CMP003 and
CMP006):**
- Nilkamal (L2_MANAGER, dual QUALITY+PRODUCTION): full access to PO06,
  PR01-04, PR12, PR17, PR18, PR19 — correctly missing only PR15
  (Auditor-only).
- Pradip / Kishor (Plant Head, L3_MANAGER, MANAGEMENT): full access to PO06,
  PR02, PR04, PR12, PR16 (QA part), PR17 — correctly missing PR01, PR03,
  PR15, PR18, PR19 (not part of the Plant Head fallback).
- SONI (L1_AUDITOR): full access to PR02, PR04, PR15 only.
- Bijon Kanabar (real Director): zero Group 5 access, aside from a residual
  VIEW/WRITE on `PROD_QA_QUEUE` from Production's own pre-existing
  `CAP_PROD_STANDARD` grant (unrelated to this group, not an approve/decide
  action, left as-is).
- P0076 (ACL MASTER): full access to all 11 pages.

## Group 6 — Returns & Claims (⛔ deliberately deactivated, not designed yet)

PO08 Return to Vendor, PO09 Debit Notes, PO10 Exchange References.

**Business owner's call (2026-07-29):** none of these three pages have been
properly designed/finished yet — rather than leave them wide open on old
defaults while undesigned, deactivate them for everyone except P0076
(ACL MASTER) until a proper page-by-page session happens, same as every
other group in this doc.

**What was found before deactivating (code audit, not yet a design
session):**
- Single backend file for all three: `rtv.handlers.ts`. No hardcoded
  rank-check anywhere in it (unlike most other groups) — access here was
  purely ACL-driven already, for better or worse.
- No maker-checker (`acl.approver_map`) on any of the three — whoever holds
  the ACL "Approve" grant today can execute RTV Post / Debit Note
  acknowledge+settle solo, no second-person check.
- **Bug found, not yet fixed:** Exchange Reference's "link replacement GRN"
  action is registered in `route-acl-registry.ts` as a `POST`, but the real
  route in `procurement.routes.ts` checks for `PUT` — a method mismatch.
  Needs a code fix (not ACL data) before this page can be trusted; flagged
  for whenever this group's design session happens.
- **Dead registry entry:** RTV has an `EDIT` action registered in the ACL
  registry with no matching handler/route anywhere in the code — harmless,
  but a cleanup candidate.
- **🔴 Pre-existing gap of the same class as Group 5's:** all three pages
  shared one blanket capability, `CAP_PROC_RETURNS`, granted to **every**
  department in CMP003/CMP006 (Accounts, Audit, Director, Management,
  Stores, Supply Chain, ACL-MASTER) plus CMP010's Audit — meaning any role
  in any department already had full access before this group had ever been
  formally decided. This is exactly the same undesigned-blanket-access
  pattern found in Group 5.

**Fix applied:** deleted all `CAP_PROC_RETURNS` `work_context_capabilities`
grants except the two `ACL-MASTER` rows. ACL v24 (CMP003/CMP006), v21
(CMP010). Verified via `precomputed_acl_view`: only P0076 resolves ALLOW on
`PROC_RTV_LIST`/`PROC_RTV_CREATE`/`PROC_DEBIT_NOTE_LIST`/
`PROC_EXCHANGE_REF_LIST` in either company; every other department is now
zero. `capabilities`/`role_capabilities` rows for `CAP_PROC_RETURNS` left in
place (dead reference, not deleted, same convention as Group 5's now-unused
`CAP_QA_PROD_*`) — will be reactivated with a proper design once this group
gets its formal session.

## Group 7 — Accounts

Status: partially decided (2026-07-29, ACL v25/v22). AC04 designed +
implemented. AC01/AC02/AC03 not ready yet, same treatment as Group 6.
**⚠️ Revised 2026-08-06 (AC04/AC05/AC06 ownership + rank ceiling) — not yet implemented (see below). AC01/AC02/AC03 deliberately left as ACL-MASTER-only for now, not decided this round.**

**⚠️ Revised 2026-08-06:** AC04's ownership moves from Auditor-does-the-writing (Accounts
View-only) to a normal department-owned page — Accounts becomes the maker, matching AC05/AC06's
existing shape instead of being the outlier of the three.

| tx_code | Page | Accounts (L1_USER–L2_MANAGER) | L1/L2 Auditor | L3_MANAGER (Plant Head) / L4_MANAGER / Director | Maker-checker |
|---|---|---|---|---|---|
| AC04 | Conversion Cost Config | V C E D | V C E D | V only | **None** — confirmed zero `acl.approver_map` rows exist for `ACC_CONVERSION_COST`; stays solo-write for both Accounts and Auditor, no checker step. |
| AC05 | MTS SKU Monthly Rate | V C E (maker) | Approver (checker) | V only | **Unchanged** — `acl.approver_map` already has a full `SUBJECT_ROLE` chain (every Accounts rank + both Auditor ranks → L1_AUDITOR/L2_AUDITOR approves), verified live in prod for CMP003+CMP006. Follows as-is. |
| AC06 | SLoc Costing Group | V C E (maker) | Approver (checker) | V only | **Unchanged** — same `SUBJECT_ROLE` chain shape as AC05, already live for both companies. Follows as-is. |

- Rank ceiling applies uniformly across all three: Accounts' own working ranks (L1_USER through
  L2_MANAGER) get full Create/Edit; L3_MANAGER (Plant Head, per Basic Rule #6 — deliberately
  **not** a Structural Fallback full-access grant here, just View), L4_MANAGER, and Director all
  get View only.
- AC04's Auditor grant is **additive**, not maker-checker — both Accounts and Auditor can
  independently create/edit, since no approval step exists for this resource (confirmed via
  direct `acl.approver_map` query, zero rows). Different from AC05/AC06 where Auditor's role is
  strictly the checker in a maker-checker pair, not a second independent writer.
- **Dependency mechanism re-verified safe (2026-08-06):** Process PO Verify reads AC04's rate via
  `serviceRoleClient.rpc("resolve_conversion_rate")` (`process_order.handlers.ts:573-577`) —
  server-side, zero ACL check — confirming Production needs no AC04 access at all to consume the
  conversion rate (same Type-ঘ-shaped backend read pattern as the CSN sync-back finding above).
  AC05/AC06's consumers (MTS/PMTS costing, SLoc-based costing group resolution) presumed to
  follow the same pattern; not re-verified line-by-line this session.
- **Not yet implemented** — design decision only; batch-implementation pass covers this
  alongside the rest of today's pending groups.

AC01/AC02/AC03 — left exactly as-is (ACL-MASTER only), not decided this round; see the original
Group 7 notes below for their current (undesigned) state and the earlier code-audit findings.

| tx_code | Page | Accounts (up to L3_Manager) | L1/L2 Auditor | Director |
|---|---|---|---|---|
| AC04 | Conversion Cost Config | V | V C E | V |
| AC01 | Invoice Verification | ⛔ ACL MASTER only, not designed | | |
| AC02 | Blocked Invoices | ⛔ ACL MASTER only, not designed | | |
| AC03 | Landed Costs | ⛔ ACL MASTER only, not designed | | |

**Code audit before deciding (no edits made, all findings logged for a
future code-fix pass):**
- Single backend file for AC01/AC02: `invoice_verification.handlers.ts`.
  AC03: `landed_cost.handlers.ts`. AC04: `conversion_cost.handlers.ts`
  (lives under `_core/production/`, moved to Accounts ACL 2026-07-18 per
  earlier session).
- No hardcoded rank-check bug in any of the four — all four call a no-op
  stub (`assertAccountsRole`/`assertProdReadRole`, "protected by upstream
  ACL") — unlike most other groups, access here was already purely
  ACL-driven before this session touched it.
- No maker-checker (`acl.approver_map`) on any of the four pages — whoever
  holds the ACL Approve/Write grant executes solo.
- **Real gap found and fixed:** AC04's "add new rate" write action
  (`createConversionRateHandler`) had **no `capability_menu_actions` row at
  all** — only VIEW existed. Nobody could create a conversion rate via ACL
  before this session (SA/GA bypass aside). Added under the new
  `CAP_CONVCOST_AUDITOR` capability.
- **🔴 Same blanket-capability pattern as Groups 5 and 6, this time worse:**
  `CAP_PROC_ACCOUNTS` was granted to every department in CMP003/CMP006
  (Accounts, Audit, Director, Management, Supply Chain) plus CMP010's
  Audit — and unlike Group 6's mostly-VIEW version, this one carried
  **VIEW+WRITE+EDIT+DELETE+APPROVE** on `PROC_IV_CREATE` — meaning any role
  in any department already had full unrestricted power to create, match,
  and Post Invoice Verifications. This was also AC04's original (VIEW-only)
  access source, riding along on the same capability. Fully deleted except
  the two `ACL-MASTER` rows — same fix pattern as Group 6.

**ACL data for AC04:** two new capabilities, `CAP_CONVCOST_VIEW`
(VIEW only — Accounts dept, `role_capabilities` L1_USER through
L3_MANAGER + DIRECTOR) and `CAP_CONVCOST_AUDITOR` (VIEW+WRITE — AUDIT dept,
L1/L2_AUDITOR + DIRECTOR for P0076's god-mode). Both granted to
`ACL-MASTER` in both companies. Director's own live VIEW comes from
`CAP_CONVCOST_VIEW`; separately noticed (not created by this session) Soni
already carries a pre-existing per-user `acl.user_overrides` ALLOW on this
resource (VIEW+WRITE+EDIT) — harmless, consistent with the Auditor-full
decision, left untouched.

**Verified via `precomputed_acl_view` (v25 CMP003/CMP006, v22 CMP010):**
Accounts staff (any rank) = VIEW only on AC04, zero on AC01/02/03; Soni
(Auditor) = full on AC04; Bijon (Director) = VIEW only on AC04; P0076 = full
on all four. `capabilities`/`role_capabilities` rows for `CAP_PROC_ACCOUNTS`
left in place (dead reference for now), same convention as Groups 5 and 6.

## Group 8 — Sales (⛔ deliberately deactivated, not designed yet — ✅ SUPERSEDED, see below)

**⚠️ Superseded 2026-08-06 — this whole group's "deactivated" status below is STALE.**
SO01/SO02 (plus SO03, which didn't exist yet when this group was written) were fully designed
and implemented in **Group 11** (2026-07-31, ACL v33): SO01+SO02 → Accounts, full access,
proper pipeline **up through L3_MANAGER** (Plant Head treated as a normal pipeline rank here —
a deliberate exception to Basic Rule #6's usual Structural-Fallback-View-only treatment,
re-confirmed by business owner 2026-08-06); SO03 → Stores, full access. **Do not re-deactivate
SO01/SO02/SO03 based on the notes below** — they describe the pre-Group-11 undesigned state,
kept only for the code-audit findings (route mismatch bug, dead capability, etc.), which are
still real and still need a code fix. See Group 11 (further down this doc) for the current,
live, correct access design.

---

SO01 Sales Orders, SO02 Sales Invoices.

**Business owner's call (2026-07-29):** same treatment as Groups 6/7 —
Sales ties directly into the still-undesigned Dispatch (L5) module (per
feasibility doc's locked sequencing, Dispatch+Costing must be designed
together before Sales/SO can be finalized). Deactivated for every
department except P0076 (ACL MASTER) until that formal session happens.

**Code audit before deactivating (no edits made, findings logged for the
future design/code-fix pass):**
- Single backend file for both: `sales_order.handlers.ts` (Gate 16.9).
- No hardcoded rank-check bug — only a no-op `assertProcurementReadRole`
  stub, same as Group 7. Access here was already purely ACL-driven.
- No maker-checker (`acl.approver_map`) on either page — SO02's invoice
  Post uses the `APPROVE` ACL action but nothing stops the same person who
  created the invoice from also posting it (no real second-person check).
- **🔴 Bug found, not yet fixed — "Issue Stock" endpoint is unreachable
  today:** `route-acl-registry.ts` registers the pattern
  `/sales-orders/[^/]+/issue-stock`, but the actual wired route in
  `procurement.routes.ts` is `/sales-orders/:id/issue` (no `-stock`
  suffix). A pattern miss fails closed (`ROUTE_ACL_NOT_REGISTERED`), so
  today this endpoint likely errors for every non-SA/GA caller regardless
  of ACL grant — a code fix, not an ACL data fix. Flagged for whenever this
  group's design session happens.
- Same blanket-capability pattern as Groups 5/6/7: `CAP_PROC_SALES` was
  granted to every department in CMP003/CMP006 (Accounts, Audit, Director,
  Logistics, Management, Stores) plus CMP010's Audit.

**Fix applied:** deleted all `CAP_PROC_SALES` `work_context_capabilities`
grants except the two `ACL-MASTER` rows. ACL v26 (CMP003/CMP006), v23
(CMP010). Verified via `precomputed_acl_view`: only P0076 resolves ALLOW on
`PROC_SO_LIST`/`PROC_SO_CREATE`/`PROC_INV_LIST` in either company; every
other department is zero. `capabilities`/`role_capabilities` row for
`CAP_PROC_SALES` left in place (dead reference), same convention as
Groups 5/6/7.

## Group 9 — Inventory

**Status: ✅ Decided 2026-08-06 (role-based, no named individuals) — design
phase only, not yet implemented.** Was "⛔ deliberately deactivated, not
designed yet" until this session; original deactivation note and code-audit
findings kept below for history/reference.

IN01 Physical Inventory, IN02 Stock Ledger, IN03 Current Stock, IN04 Stock
Valuation, IN05 Opening Stock, IN06 Opening Stock Approval, PR21 FG Stock
Breakdown.

| tx_code | Page | Decision |
|---|---|---|
| IN01 | Physical Inventory | Three-stage, mirrors SAP MI01/02 → MI04/05 → MI07: **PID create/edit** (scope of what's being counted) = L1/L2_Auditor only. **Count entry/edit/submit** (the actual counted quantities) = everyone in that company, any department/rank, **except L4_Manager and Director** (Basic Rules #3/#5 — a future MI20-style report will cover them separately, company-scoped, not built this round). **Final approval/post** (the action that actually writes to the stock ledger) = L1/L2_Auditor only — data sitting in draft/count-entry state never touches the ledger until this step. This design directly fixes the "IN06 not a real maker-checker" bug pattern found in the original audit below, applied here to IN01 instead. |
| IN02 | Stock Ledger | Open to **everyone** (L1_User through Director, L1/L2_Auditor included), company-scoped — pure report page (Basic Rule #4). The "create/save layout" action (§117's Column Layout system) is **not** restricted either — anyone who can view the report can also create/save their own layout, no Manager-tier gate. This resolves §117's "provisional SA/GA-only bridge" note — real decision is: everyone. |
| IN03 | Current Stock | Same as IN02 — everyone, company-scoped, pure report page. |
| IN04 | Stock Valuation | **ACL-MASTER only for now** — not designed this round, stays deactivated for every other department (same treatment as Groups 6/8's still-undesigned pages). |
| IN05 | Opening Stock | **ACL-MASTER only for now** — not designed this round, deliberately deferred (Opening Stock's own formal design session is a separate, already-known-pending item per CLAUDE.md §6). |
| IN06 | Opening Stock Approval | Same as IN05 — ACL-MASTER only for now. |
| PR21 | FG Stock Breakdown | Same as IN02/IN03 — everyone, company-scoped, pure report page. |

**Not yet implemented** — tracked for the batch-implementation pass. Real
implementation needs: (1) IN01's three-stage split requires new
resource-code/action separation (create vs count-entry vs approve are
currently likely bundled under one `PROC_PI_LIST` resource — needs
verification against `route-acl-registry.ts` before implementing, since
today's design assumes 3 independently-gatable actions); (2) the
company-scope bug in `createPIDHandler`/`addPIItemHandler` (flagged in the
original audit below) **must** be fixed as part of implementing this design,
not left for later — the whole "everyone in that company, not other
companies" design depends on it; (3) `assertManagerOrSARole` removed from
`opening_stock.handlers.ts` is **not** urgent since IN05/IN06 stay
ACL-MASTER-only this round (the hardcoded check is redundant-but-harmless
while nobody else has the ACL grant anyway) — revisit when Opening Stock
gets its own formal session; (4) IN02's Column Layout `global-layout-create`
gate (currently SA/GA-only per §117) needs revising to allow everyone,
matching this decision.

**Code audit before deactivating (no edits made, findings logged for a
future code-fix pass):**
- Backends: `physical_inventory.handlers.ts` (IN01),
  `stock_reports.handlers.ts` (IN02/IN03/IN04, all three read-only
  reports), `opening_stock.handlers.ts` (IN05/IN06),
  `packing_order.handlers.ts`'s `fgStockBreakdownHandler` (PR21).
- **🔴 Company-scope gap found, not previously flagged — IN01 Physical
  Inventory has NO company check at all.** `createPIDHandler`/
  `addPIItemHandler` derive company purely from the storage location's own
  plant mapping and never verify against the requesting user's
  `erp_map.user_companies`. A user with ACL access to Physical Inventory in
  one company could create/count a PI document against *any* company's
  storage location. This is a different file than the one fixed in the
  §112.8 company-scope pass (2026-07-25/26), so that fix never reached it.
  Real gap, needs a code fix before this page is trusted with real data.
- ✅ IN02/IN03/IN04 (`stock_reports.handlers.ts`) — company-scope fix from
  §112.8 confirmed still in place and working correctly, nothing reverted.
- ✅ PR21 (`packing_order.handlers.ts`) — has its own equivalent
  `assertPackingCompanyScope` check, confirmed correctly applied.
- **🔴 Rank-check bug — same recurring pattern as Groups 2/5, found in
  `opening_stock.handlers.ts` (IN05 + IN06, same file):** every single
  handler calls `assertManagerOrSARole` (SA/GA/DIRECTOR/L4_MANAGER/
  L3_MANAGER/L2_MANAGER only) — hard-blocks anyone below L2_Manager rank
  with a 403, completely independent of and overriding whatever ACL grants
  this doc decides. A future "User-tier can create Opening Stock lines"
  decision would silently do nothing until this is removed, same as the
  PM01-07/PO06/etc. fix pattern already applied elsewhere this session.
- **IN06 "Opening Stock Approval" is not a real maker-checker** — confirmed
  via code: no `acl.approver_map` reference anywhere in this file. It's a
  plain `status` column flip (DRAFT→SUBMITTED→APPROVED→POSTED), gated only
  by the same blanket `assertManagerOrSARole` check + the ACL action grant.
  Nothing stops whoever submitted a document from also approving/posting
  it themselves — no distinct-approver check exists in code today.
- Secondary, smaller gap: `postOpeningStockDocumentHandler` and
  `batchUpdateOpeningStockLinesHandler` don't independently re-verify
  company scope (only `approveOpeningStockDocumentHandler` does) — lower
  risk since these operate on an already-created `documentId`, not a raw
  company_id, but not confirmed fully closed either.
- No maker-checker on any of the other 5 pages (all read-only reports or
  single-actor IN01 actions).
- Same blanket-capability pattern as Groups 5-8: `CAP_PROC_INVENTORY`
  covered IN01-IN06 for every department in CMP003/CMP006 (Accounts, Audit,
  Director, Logistics, Management, Production, Stores, Supply Chain) plus
  CMP010's Audit. PR21 rode along on two *different* shared capabilities
  (`CAP_EVERYONE_REPORTS` and `CAP_PROD_OPERATOR`) that are also used by
  already-decided pages elsewhere (e.g. PO18) — those capabilities were
  **not** touched wholesale (would have broken PO18 etc.); instead only the
  two specific `(capability, PROD_FG_STOCK_BREAKDOWN)` menu-action rows
  were removed, and a fresh `(CAP_PROC_INVENTORY, PROD_FG_STOCK_BREAKDOWN,
  VIEW)` row added so ACL-MASTER (which keeps `CAP_PROC_INVENTORY`) still
  sees it. Verified PO18 unaffected (21 ALLOW rows unchanged) after this.

**Fix applied:** `CAP_PROC_INVENTORY`'s `work_context_capabilities` deleted
for every department except `ACL-MASTER`. ACL v27 (CMP003/CMP006), v24
(CMP010). Verified via `precomputed_acl_view`: only P0076 resolves ALLOW on
any of the 7 resources in either company; every other department is zero.

## Group 10 — Production

Status: ✅ Decided + implemented in prod (2026-07-29, ACL v29/v26).
**✅ 2026-08-06 revision IMPLEMENTED (ACL v52, both companies) — see
"✅ Implemented 2026-08-06" notes inline below for each sub-decision.**

| tx_code | Page | Production | Quality | SCM | Management | Stores | Audit | Director |
|---|---|---|---|---|---|---|---|---|
| PR00 | Plan Feed | V C E† (+ Plant Head fallback) | | | V (+Plant Head = V C E) | V | | V |
| PR05 | Pack BOM Create | V | V | V C E† | V | | | V |
| PR06 | Pack BOM Approval | V | V | V (Approve: chain, see note below) | V | | | V (Approve: chain fallback) |
| PR07 | Change Pack BOM | V | V | V C E† | V | | | V |
| PR08 | Change Pack BOM Approval | V | V | V (Approve: chain, see note below) | V | | | V (Approve: chain fallback) |
| PR09 | Production PO Create | V C E† (+ Plant Head fallback) | | | (Plant Head = V C E) | | | V |
| PR10 | Production PO Edit | — | V C E A† | — | — | — | — | — (see note below — narrower than usual, not even Director) |
| PR11 | Production PO Final (up to L2_Manager) | V C E | | | | | | V |
| PR13 | Order List | V (all ranks — see revision note below) | V (all ranks) | | | | V | V (+ Director-Reports WC) |
| PR14 | Batch Variance Report | same as PR13 | same as PR13 | | | | V | V (+ Director-Reports WC) |
| PR20 | Partial Reversal Report | same as PR13 | same as PR13 | | | | V | V (+ Director-Reports WC) |
| PR22 | Old Process PO | V C E† | | | | | | V |
| PR23 | Old Packing PO | V C E† | | | | | | V |

**† = Basic Rule #5 applied 2026-08-06:** every "no ceiling" full-access
grant in this table (Production on PR00/09/22/23, SCM on PR05/07, QUALITY on
PR10) is capped at **L3_Manager** — L4_Manager is excluded from all of them,
routed to DIRECTOR-REPORTS instead (view/oversight only, not
Create/Edit/Approve). Confirmed by business owner as applying to every page
in this group, not decided page-by-page. **✅ Implemented 2026-08-06** —
`L4_MANAGER` removed from `role_capabilities` on `CAP_PROD_DEPT_FULL`
(PR00/09/22/23), `CAP_PACKBOM_CREATE_SCM` (PR05/07), `CAP_PROCPO_EDIT_QA`
(PR10) — verified each capability's blast radius via
`capability_menu_actions` first (all 3 scoped exactly to this group's own
resources, no leakage). `CAP_PROD_PLANTHEAD_FULL` (Plant Head fallback) was
already `L3_MANAGER`-only by design, no change needed there.

**PR10 (Production PO Edit) — revised 2026-08-06, business owner
instruction:** stays QA-only exactly as originally designed (no change to
department ownership — Production was considered and explicitly declined,
this remains QA's independent pre-approval review step). Two corrections
from the original Group 10 design: (1) **DIRECTOR access removed entirely**
— a Special Rule #1 narrowing ("locked narrower than normal default, not
even Director"), same shape as MM01/MM02; (2) QA's own access capped at
L3_Manager per Basic Rule #5 (L4_Manager excluded). Confirmed: editing via
PR10 does **not** trigger any separate approval of the edit itself — the
Process PO stays at STANDARD status after a PR10 edit and still has to pass
through the normal QA Approval Queue (PR16) afterward, same as any other
Process PO; PR10 and PR16 are both QA's own job, no other department
involved in either step. **✅ Implemented 2026-08-06** — deleted the
`CAP_G10_DIRECTOR_VIEW` → `PROD_PO_EDIT` capability_menu_actions row only
(the capability's other 6 pages untouched); confirmed via
`precomputed_acl_view` that Bijon (Director) now resolves zero rows on PR10.

**PR13/PR14/PR20 (Order List / Batch Variance / Partial Reversal Report) —
revised 2026-08-06, business owner instruction: Basic Rule #4 restored,
narrowing removed.** These are pure report pages — Basic Rule #4 ("report
pages are open to everyone relevant — viewing carries no risk") already
covers this, but Group 10's original implementation narrowed them to
"Manager-tier + Director only" (see the superseded note below) without
recording it as a deliberate Special Rule exception — an unflagged
deviation from the doc's own default. Corrected: **View open to every rank**
in Production and Quality (L1_User through **L3_Manager** — not just
Manager-tier, but L4_Manager is excluded per Basic Rule #5, routed to
DIRECTOR-REPORTS instead), matching plain Basic Rule #4 — access is gated
only by whether the user already has permission to see that company's data
at all (normal company-scope check), not by rank within the company. Audit
and DIRECTOR keep their existing View. **DIRECTOR-REPORTS work context (Himanshu
Kanabar, P0002 — see the "Identity note" above) now explicitly gets these 3
resources** — this WC was created 2026-07-28 specifically for report-only
Director access and deliberately started empty ("to be built up page-by-page
as groups are decided"); this is its first real grant.
**✅ Implemented 2026-08-06** — rather than re-adding the old blanket
`CAP_EVERYONE_REPORTS` rows (which is what leaked User-tier access in the
first place, see the bug note above), added `L1_USER`/`L2_USER`/`L3_USER`/
`L4_USER` to `CAP_ORDERLIST_MGRTIER`'s `role_capabilities` (removed
`L4_MANAGER` from the same, per Basic Rule #5) — this keeps the fix on the
already-correctly-scoped capability instead of reviving the leaky one.
Confirmed via `capability_menu_actions` this capability is scoped to
exactly PR13/14/20, no wider blast radius. `DIRECTOR-REPORTS` work context
granted this same capability (both companies) — it already includes
`DIRECTOR` role, matching P0002 exactly. Verified via `precomputed_acl_view`:
Production/Quality L3_USER users (P0069, P0071) now resolve ALLOW on all 3.

~~**Superseded 2026-08-06 — original PR13/14/20 View design (kept for
history, no longer in effect):** Production/Quality View restricted to
Manager-tier (L1/L2/L3_Manager) + Director only, via `CAP_ORDERLIST_MGRTIER`
— User-tier explicitly excluded, framed as fixing a "leak" from the old
blanket `CAP_EVERYONE_REPORTS` grant. DIRECTOR-REPORTS held no grant on
these 3 resources.~~

**PR06/PR08 (Pack BOM Approval / Change Pack BOM Approval) — revised
2026-08-06, business owner instruction:** originally locked as a flat
"SCM's L1/L2_Manager only" Approve rule (see the superseded note below).
Revised to reuse the **exact same rank-escalation chain already locked for
PO/STO** (Group 3's `acl.approver_map` chain: L2_USER's creation is
approved by L3_USER **or** L1_MANAGER; L3_USER's by L1_MANAGER; L1_MANAGER's
by DIRECTOR) — same reasoning as the general "Standard Escalation Ladder"
default (whoever does the lower-rank job, the rank above approves it),
applied here via the SCM department's already-proven chain rather than a
new one. **Also revised:** DIRECTOR upgraded from View-only to a real
Approve fallback (was a deliberate exception to Basic Rule #3 before;
restored to the Basic Rule #3 default here since Director sits at the top
of this same chain — matches PO/STO's own DIRECTOR-fallback design in
Group 3, not a special case for Pack BOM). View stays open to
Production/Quality/SCM/Management/Director, unchanged.
**✅ Implemented 2026-08-06** (commit `129cf9c7`): (1) `pack_bom.handlers.ts`'s
`approvePackBomHandler`/`rejectPackBomHandler`/
`approvePackBomChangeRequestHandler`/`rejectPackBomChangeRequestHandler` now
call a new `assertPackBomApproverRole()` wired into
`_shared/workflow_scope.ts`'s `pickScopedApproverRules` +
`matchesApprover` (the same engine, including today's department-scope fix)
— replacing the flat capability-only check; all 4 catch blocks updated so
`PROD_BOM_SCOPE_VIOLATION`/`PROD_BOM_APPROVER_ROLE_REQUIRED`/
`PROD_BOM_SELF_APPROVAL_FORBIDDEN` return 403, not the previous flat 500.
(2) 16 new `acl.approver_map` `SUBJECT_ROLE` rows (L2_USER→L3_USER/L1_MANAGER,
L3_USER→L1_MANAGER, L1_MANAGER→DIRECTOR, × 2 resources × 2 companies),
approver scoped to the SUPPLY CHAIN work context (matching PO/STO's own
chain exactly, since Pack BOM's creator department is SCM). (3) `CAP_G10_
DIRECTOR_VIEW` gained a real `APPROVE` action on both `PROD_PACK_BOM_
APPROVAL`/`PROD_CHANGE_PACK_BOM_APPROVAL` (was VIEW-only). Verified zero new
`deno check` errors.

~~**Superseded 2026-08-06 — original PR06/PR08 Approve design (kept for
history, no longer in effect):** flat rule, any SCM L1_Manager or
L2_Manager could approve regardless of who created it; DIRECTOR was
View-only, a deliberate exception to Basic Rule #3.~~

**Plant Head fallback pattern (same design as Group 5) — formally named
"Structural Fallback" 2026-08-06, see Special Rule #5 above:** since CMP003
has Nilkamal (dual QUALITY+PRODUCTION, covers PR00/PR09 via plain PRODUCTION
dept membership) but other companies have no dedicated Production manager,
a separate `CAP_PROD_PLANTHEAD_FULL` (MANAGEMENT dept, L3_MANAGER role
only) gives Pradip/Kishor full PR00+PR09 access too — uniform across both
companies per the established "grant it everywhere, even where redundant"
convention from Group 5. This is PR00's canonical Structural Fallback
example — cite this note when applying the same pattern to a future page.

**PR09/PR10/PR11 three-way department split, verified against real users:**
Production creates (PR09, full dept access + Plant Head), QUALITY alone
edits before further processing (PR10, full access, no ceiling — Production
itself gets zero access here), Production finalizes again but capped at
L2_Manager (PR11) — mirrors the Standard→QA-edit→Final production
lifecycle already locked for Process/Packing PO. Verified: Pabitra
(L3_USER, QUALITY) gets full PR10 access; Nilkamal (L2_MANAGER, dual dept)
gets PR11 via PRODUCTION dept membership at exactly the L2_Manager ceiling.

**Real bug found and fixed while verifying — PR13/14/20 leaked to
User-tier via `CAP_EVERYONE_REPORTS`:** first-pass verification showed
Pabitra (L3_USER, QUALITY) with VIEW on Order List/Batch Variance/Partial
Reversal Report despite the new `CAP_ORDERLIST_MGRTIER` correctly excluding
User-tier — traced to a pre-existing `CAP_EVERYONE_REPORTS` blanket grant
(also covering `PROC_GATE_REPORT`/PO18) that included these 3 resources
too. Removed only the 3 Group-10-specific `(CAP_EVERYONE_REPORTS, menu)`
rows, leaving PO18's row untouched (verified 21 ALLOW rows unchanged on
`PROC_GATE_REPORT` after the fix) — same surgical-removal pattern as Group
9's `PROD_FG_STOCK_BREAKDOWN` fix.

**Old blanket capabilities, two different cleanup treatments:**
- `CAP_PROD_PLANNER`, `CAP_PROD_PACKBOM_CREATE`, `CAP_PROD_PACKBOM_APPROVE`
  were Group-10-exclusive (verified via `capability_menu_actions` — no
  other menu referenced them) — fully deactivated except `ACL-MASTER`,
  same as every other group's blanket-capability fix this session.
- `CAP_PROD_STANDARD`/`CAP_PROD_OPERATOR` are **shared with Group 5's
  `PROD_QA_QUEUE`** (Production's own Start-Batch-related access,
  deliberately preserved in the Group 5 session) **and two SA-only pages**
  (`SA_PROD_BATCH_SERIES`, `SA_PROD_SEGMENT_LOCATIONS`) — their
  department-level `work_context_capabilities` grants were left completely
  untouched; only their menu-action rows for the 9 Group-10 resource codes
  were deleted, verified `PROD_QA_QUEUE`/`SA_PROD_*` rows survived intact.

**Code audit before deciding — both real bugs found here have since been
fixed (2026-07-29, same session), since unlike Groups 6-9 this group's
design is final, not deactivated-pending-design:**
- **✅ FIXED — rank-check bug, same recurring pattern as Groups 2/5/9:**
  `plan_feed.handlers.ts` (all 4 write handlers) and `pack_bom.handlers.ts`
  (all 6 write/approve handlers across PR05-08) called
  `assertManagerOrSARole` — hard-blocking anyone below L2_Manager rank
  regardless of the ACL grants above (a QUALITY/SCM User-tier grant would
  have passed ACL and still 403'd). Removed all 10 call sites + the now-
  unused import in both files, same fix pattern already applied to
  `process_order.handlers.ts`/`stroke_master.handlers.ts`/etc. earlier this
  session.
- **✅ FIXED — company-scope gaps in the same two files:**
  `pack_bom.handlers.ts`'s `assertPackBomCompanyScope` was called only in
  `createPackBomHandler` — the other 5 handlers (approve/reject/change-
  request create/approve/reject) never checked it, so an approver scoped
  to one company could have acted on another company's Pack BOM by ID.
  Added the same check to all 5 (fetching `company_id` directly for the
  BOM handlers, via a `bom:pack_bom!pack_bom_id(company_id)` join for the
  2 change-request handlers whose own table has no `company_id` column).
  `plan_feed.handlers.ts` had the identical gap — only `createPlanFeedHandler`
  checked company scope; added the same `assertCompanyScope` call
  (fetching `company_id` alongside the existing `status` select) to
  `updatePlanFeedHandler`, `cancelPlanFeedHandler`, and
  `upsertFoAllocationHandler`. Verified zero new `deno check` errors on
  both files (clean before and after).
- PR09, PR10, PR11, PR13, PR20, PR22, PR23 handlers are all clean — proper
  company-scope calls confirmed (`assertCompanyScope`/
  `assertPackingCompanyScope`/`assertPartialReversalCompanyScope`), no
  rank-check bugs, no maker-checker anywhere in this group (`acl.approver_map`
  has zero rows for any `PROD_*` resource — separation of duties here is
  done purely via distinct resource_codes/capabilities, e.g. create vs.
  approve being different pages entirely).
- **PR14 quirk (not a bug, just a dependency to remember):** has no
  dedicated backend — `BatchVariancePage.jsx` reuses PR13's
  `PROD_ORDER_LIST` GET and computes variance client-side. Its own
  `PROD_BATCH_VARIANCE` resource only gates sidebar visibility; the ACL
  grants for the two must be kept in sync manually.

**Verified via `precomputed_acl_view` (v29, both CMP003/CMP006):** Nilkamal
gets full PR00/09/11/22/23 + PR10 (via dual dept) + PACKBOM view + PR13/14/20
view; Pabitra (QUALITY, L3_USER) gets full PR10 only + PACKBOM view, zero
on PR00/09/11/13/14/20/22/23; Pradip/Kishor get PR00/09 full (Plant Head) +
PACKBOM view, zero on PR10/11; Prasenjit (SCM, L3_USER) gets PR05/07 create
only; Ankan (SCM, L1_MANAGER) gets PR05/07 create + PR06/08 approve; Bijon
(Director) gets VIEW on all 13; P0076 (ACL MASTER) gets full on everything.

---

## Full-Doc Audit (2026-07-29, ACL v30/v27)

Business owner asked for a comprehensive re-check across every group's live
state (not just the group being actively worked). Method: pulled every
department's full grant list across all ~55 tx_code resources at once for
one reference user per department archetype (Nilkamal, Pabitra, Pradip,
Kishor, Soni, Bijon, P0076, plus a Stores/SCM spot-check), then separately
queried for any capability held broadly (≥3 departments) in either company
to catch blanket grants that hadn't surfaced through normal page-by-page
work.

**🔴 One real leak found and fixed:** `CAP_PROC_QA` — a capability that
predates this whole doc — granted VIEW on **both** `PROC_GRN_LIST` (PO05,
Group 4) and `PROC_QA_QUEUE` (PO06, Group 5) to **every department**
(ACL-MASTER, Audit, Director, Management, Quality in both companies, plus
CMP010's Audit). Missed during both Group 4 and Group 5's cleanup because
neither session's "which capability governs this resource" check happened
to surface it — Group 4 found `CAP_PROC_RECEIVING`/`CAP_PROC_GATE_SECURITY`
as the operative capabilities for GRN and never noticed `CAP_PROC_QA` also
touched it; Group 5 built entirely new tiered capabilities for PO06 without
checking whether an older capability also granted the same page. Concrete
effect: Bijon Kanabar (Director) had VIEW on both PO05 and PO06 despite
"Director gets nothing" being locked for both groups.

Fixed the same way as every other blanket-capability cleanup this session:
deleted `CAP_PROC_QA`'s `work_context_capabilities` rows except the two
`ACL-MASTER` ones (already redundant — `CAP_PROC_RECEIVING`/Stores covers
GRN, `CAP_QA_TIER_L3MGR`/`CAP_QA_PLANTHEAD` covers PO06). ACL v30
(CMP003/CMP006), v27 (CMP010). Verified: Bijon now zero on both
`PROC_GRN_LIST` and `PROC_QA_QUEUE`; Stores (Hiranmoy Dwari) still full on
GRN; Nilkamal still full on PO06 — no regression.

**Everything else checked clean:** the broad-capability sweep (`≥3`
departments) turned up nothing else unaccounted for — every other
multi-department capability found (`CAP_ORDERLIST_MGRTIER`,
`CAP_PACKBOM_VIEW`, `CAP_PLANFEED_VIEW_OTHER`, `CAP_CONVCOST_VIEW`,
`CAP_PROC_PLANT_TRANSFER`, `CAP_OM_CUSTOMER_VIEW`, etc.) matched its
documented design exactly, department-for-department. `CAP_OM_MASTER_DATA`
showed up broadly-held too but has **zero** `capability_menu_actions` rows
— a dead/inert capability, not a leak.

**Lesson for future groups:** when deciding a page's ACL, don't stop at
finding *a* capability that already covers it — check whether *any other*
capability also grants the same `(menu_code, action)` pair before assuming
the department list is complete. A quick
`select capability_code from acl.capability_menu_actions where menu_id = (select id from acl.menu_master where menu_code = 'X')`
per resource_code would have caught this immediately in both Group 4 and 5.

---

## Live Incident (2026-07-29) — PO create broke for non-Manager SCM users

Business owner reported widespread 403/500 errors testing PO creation as
Ankan (L1_MANAGER) and Prasenjit (L3_USER) on prod (`erp.almegagroup.in`).

**Root cause — a second, much larger instance of the recurring
hardcoded-rank-check bug, in a module never touched by this doc's audits:**
`om/vendor.handlers.ts`'s `listVendorsHandler` (and 41 other call sites
across 8 more `om/*.handlers.ts` files — material, customer, cost_center,
location, material_type_category, parent_customer, uom,
vendor_material_info) called `assertManagerOrSARole(ctx)` independently of
ACL. Confirmed via live prod logs: `OM_VENDOR_LIST:VIEW` ACL decision was
`ALLOW` for Ankan, yet the request still 500'd — the ACL gate passed, the
handler's own hardcoded check blocked it anyway, and since the thrown
`MANAGER_OR_SA_REQUIRED` code isn't specially mapped in that handler's
catch block, it fell through to a generic 500 instead of a clean 403. This
had nothing to do with Group 1-10's own ACL grants (already correct) — it
blocked the vendor/material dropdowns the PO Create page depends on,
regardless of what ACL said.

**Fixed:** removed all 42 `assertManagerOrSARole` call sites across the 9
`om/*.handlers.ts` files (bulk script + manual verification), same fix
pattern as every other instance this session. Verified zero new `deno
check` errors (31 pre-existing, unrelated TS errors identical before/after
via git-stash).

**Second, smaller bug found in the same investigation — dashboard querying
approval-inboxes the user can't see:** `UserDashboardHome.jsx`'s
`canOpenApprovalInbox()` matched on `resource_code`/`route_path` presence
in the menu snapshot only, not `is_visible`. Since `/api/me/menu`
deliberately returns *all* rows (visible **and** greyed-out, so the sidebar
can render disabled items — a recent, intentional design change) this
caused the dashboard to fire `HR_LEAVE_APPROVAL_INBOX`/
`HR_OUT_WORK_APPROVAL_INBOX` queries for users whose sidebar correctly hid
those items, generating harmless but alarming 403 console noise. Fixed by
requiring `row.is_visible === true` in the match.

**HR module fully deactivated (business owner decision, separate from the
bug fix):** while investigating, confirmed all 8 `CAP_HR_*` capabilities
(Leave/Out-work self-service+approval, Attendance, Correction) were
blanket-granted across every department in every company system-wide (not
just CMP003/CMP006/CMP010 — this was live everywhere). Business owner
confirmed HR was never meant to be live yet — "not giving it now, will set
it up group-wise later, same process as this doc." Deleted all 8
capabilities' `work_context_capabilities` grants except `ACL-MASTER`. ACL
v31 (CMP003/CMP006), v28 (CMP010). Verified: Ankan zero HR access, P0076
still full. **When HR is formally rolled out, follow this doc's exact
per-page/per-department process — do not re-enable via blanket capability
grants again.**

**Still open, not fixed by this pass — flagged, not resolved:**
- `GET /api/om/cost-centers` returned 403 for Ankan even though its route
  has `skipAcl: true` and the handler has no rank-check of its own — source
  of the 403 not yet identified, needs its own investigation.
Business owner directed: ship this fix first (unblocks PO creation
end-to-end, the critical path), re-test with fresh logs, then chase these
two separately rather than guessing ahead of evidence.

**✅ `po-filter-options` 500 — resolved (2026-07-29), via the new logging
below.** Root cause: `getPoFilterOptionsHandler` (`po.handlers.ts`) used the
literal string `"__none__"` as a "match nothing" placeholder when an
intersected vendor/material ID set came back legitimately empty — but that
string isn't a valid UUID, so Postgres rejected it (`22P02: invalid input
syntax for type uuid`) instead of returning zero rows. This fired for
**every** company today, since `vendor_company_map`/`material_company_ext`
are both completely empty in prod (0 rows) — not a per-company issue.
Because all three sub-queries (company/vendor/material) share one response
and the handler throws on any sub-query error, the whole endpoint 500'd —
including the company list, which had nothing to do with the failing
vendor/material lookup. This is why Ankan's Company dropdown was empty too.
Fixed (commit `841762e9`): when an ID set intersects to empty, skip the
query entirely and return `[]` directly instead of passing an invalid
placeholder to `.in()`. Verified `deno check` zero new errors (diff-scoped
to the changed lines only, git-stash was not used this session per explicit
user instruction).

**Centralized backend error logging added (commit `3e3fb6b8`).**
`_core/response.ts`'s `errorResponse()` — the one function every handler's
error path funnels through — now logs `{event: "ERROR_RESPONSE", decision:
<real internal code>, status, public_code, decision_trace}` before
collapsing the code to the generic Gate-2 public message. Previously the
client only ever saw "Request blocked by security policy" for every 4xx/5xx
regardless of cause (deliberate, enumeration-safe design) — this made
diagnosing anything from the outside impossible. Render logs can now be
searched for `"ERROR_RESPONSE"` to see the real cause+route+status
immediately, without guessing or adding one-off `console.error` calls per
incident. This is what let the `po-filter-options` bug above get diagnosed
directly from one pasted log line instead of another round of hypotheses.

---

## Data/config bugs found alongside the ACL work (2026-07-29, not ACL — logged here since they surfaced from the same incident)

- **PostgREST "Exposed schemas" toggle** — `erp_production` was present in
  Prod's Dashboard → Settings → API → Exposed schemas *list* but not
  actually toggled on, so every `erp_production` query 500'd
  (`PGRST106`-class failure) regardless of ACL/rank-check correctness — hit
  first on Pack Code Master (OM08). Fixed by the business owner directly in
  the Dashboard, no code/DB change. Matches the exact gotcha already
  documented in `CLAUDE.md` §8 ("নতুন schema বানালে PostgREST-এ expose
  করতে হবে") — this is the first time Production module pages were
  actively used in prod, so it had never been caught before.
- **`vendor_code_sequence` counter not advanced after a bulk data copy** —
  Claude bulk-copied all 65 dev vendors directly into prod via SQL
  (`erp_master.vendor_master`, codes V-00004 through V-00068) without also
  advancing `erp_master.vendor_code_sequence.last_number` (still at 8 from
  earlier testing). Next "Create Vendor" click generated V-00009 — a code
  that already existed from the bulk copy — and hit the `vendor_code`
  UNIQUE constraint, surfacing as a 500. Fixed by setting `last_number = 68`
  directly (MCP, no code change). **Lesson for any future bulk copy that
  bypasses an app-level "generate next code" RPC: always check for, and
  advance, the matching counter/sequence table in the same pass.**

---

## ACL-MASTER (P0076) full-access gap — 6 resources found VIEW-only, not full CRUD (2026-07-29)

Business owner challenged the earlier bug-list summary's claim that
"ACL-MASTER gets full access everywhere" — correct catch. Verified against
`acl.precomputed_acl_view` (auth_user_id for P0076) across every resource:
6 resources resolved **VIEW only**, despite the code (`route-acl-registry.ts`)
registering more actions for them.

**Root cause:** these 6 resources' only access path for P0076 was one of
the old blanket capabilities already found and narrowed-to-ACL-MASTER-only
elsewhere in this doc (`CAP_PROC_ACCOUNTS`, `CAP_PROC_RETURNS`,
`CAP_PROC_SALES`, `CAP_PROC_INVENTORY`) — and those capabilities'
`acl.capability_menu_actions` rows had **only ever had VIEW configured**
for these specific resources, predating this session entirely. Deleting the
other departments' grants (correct, per this doc's pattern) just made
ACL-MASTER's own pre-existing narrow grant visible for the first time.

| Group | tx_code | Resource | Had | Code supports | Added |
|---|---|---|---|---|---|
| 7 | AC01 Invoice Verification | `PROC_IV_LIST` | VIEW | VIEW, APPROVE | APPROVE |
| 7 | AC03 Landed Costs | `PROC_LC_LIST` | VIEW | VIEW, WRITE, EDIT, DELETE, APPROVE | WRITE, EDIT, DELETE, APPROVE |
| 6 | PO09 Debit Notes | `PROC_DEBIT_NOTE_LIST` | VIEW | VIEW, WRITE, EDIT, APPROVE | WRITE, EDIT, APPROVE |
| 6 | PO10 Exchange Reference | `PROC_EXCHANGE_REF_LIST` | VIEW | VIEW, WRITE | WRITE |
| 8 | SO02 Sales Invoice | `PROC_INV_LIST` | VIEW | VIEW, WRITE, APPROVE | WRITE, APPROVE |
| 9 | IN01 Physical Inventory | `PROC_PI_LIST` | VIEW | VIEW, WRITE, APPROVE | WRITE, APPROVE |

**Checked and confirmed correct (not a gap):** AC02 Blocked Invoices
(`PROC_BLOCKED_IV_LIST`) — the code itself only has one route (`GET`,
VIEW) for this resource today; there is no unblock/release action wired
anywhere, so VIEW-only for ACL-MASTER is complete, not missing anything.

**Fix:** inserted the missing `(capability_code, menu_id, action)` rows
into `acl.capability_menu_actions` for the 4 capabilities above — safe and
scoped, since each of those capabilities is now held by ACL-MASTER only
(every other department's grant was already deleted earlier in this doc).
Bumped to new ACL versions (v32 CMP003/CMP006, v29 CMP010, since the
previous versions were already captured — see the capture-once gotcha
elsewhere in this doc), captured, `generate_acl_snapshot`'d, and rebuilt
`erp_menu.menu_snapshot` for all of P0076's (company, work_context) pairs.
Verified via `precomputed_acl_view`: all 6 resources now resolve the full
action set matching what the code supports.

**Lesson for future groups (RM/PM Sale, STO, FG Dispatch and beyond):**
"ACL-MASTER still has the row, so it's fine" is not sufficient verification
— the row surviving a blanket-capability cleanup only proves ACL-MASTER
*had some* access before, not that it has the *full* action set the page's
own code actually supports. Cross-check
`select action_code from acl.precomputed_acl_view where auth_user_id = <P0076> and resource_code = 'X'`
against the resource's actual routes in `route-acl-registry.ts` for every
resource touched by a group's cleanup, not just the departments being
newly designed.

## P0076 company mapping + work-context primary fix (2026-07-31)

**Two more P0076 "full authority" gaps found and fixed, same night as the
6-resource gap above:**

1. **`erp_map.user_companies` only had 2 rows for P0076** (CMP003 primary,
   CMP006) out of **13 active BUSINESS companies** in prod
   (CMP003-CMP015 minus the SYSTEM row CMP002). `assertCompanyScope()` (the
   generic company-boundary guard used everywhere — separate from and
   layered on top of ACL) denies P0076 in any of the other 11 companies
   regardless of ACL grants, since P0076 is a normal DIRECTOR-role account
   (not a literal SA/GA bypass) and this guard has no admin exception for
   it. Fixed: inserted `erp_map.user_companies` rows for all 11 missing
   companies (`is_primary=false`). **Still open:** none of those 11
   companies have an `acl.acl_versions` row at all — this whole doc's ACL
   work has only ever touched CMP003/CMP006/CMP010. Company-scope is now
   fixed everywhere, but ACL itself will still fail differently (no
   snapshot) in the other 10 until/unless this doc's full process is
   replicated there.
2. **P0076 held two work contexts per company (DIRECTOR + ACL-MASTER) with
   BOTH marked `is_primary=true`** in `erp_acl.user_work_contexts` — an
   ambiguous double-primary that let session/default resolution land on the
   plain **DIRECTOR** context (view-only almost everywhere in this doc)
   instead of **ACL-MASTER** (full authority). Confirmed live via Render
   log: `ACL_DEFAULT_DENY_NO_MATCH` on `ACC_CONVERSION_COST:WRITE` while
   `work_context_id` in the log matched DEPT_DPT024 = DIRECTOR, not
   DEPT_DPT030 = ACL-MASTER. Fixed: set `is_primary=false` on the DIRECTOR
   row for both companies, leaving ACL-MASTER as the sole primary. Next
   login lands P0076 on ACL-MASTER by default.

## Group 11 — Sales (SO01/SO02/SO03) + Accounts Costing extension (AC05/AC06) + FG Dispatch Customer (MM05) (2026-07-31, ACL v33)

Business owner's instruction, verbatim intent: SO01 (RM/PM Sale = Sales
Order) → Accounts, full, whole department up through L3_Manager (no
manager-tier ceiling, unlike most other groups). SO02 (Sales Invoices) →
Accounts, full including Post/Approve. SO03 (Delivery Order) → Stores,
full. AC05 (MTS SKU Monthly Rate) + AC06 (SLoc Costing Group) → Accounts
full **excluding Approve**, Director gets the **same** full-minus-approve
ceiling (not just view, an explicit deviation from this doc's usual
Director-gets-nothing/view-only default), Management/L3_Manager (Plant
Head pattern) gets View only, L1/L2 Auditor gets the **Approve** action
specifically (matches the AC04 precedent — Accounts drafts, Auditor
approves). MM05 (FG Dispatch Customer) → Accounts full, Plant Head view.

**None of SO03/AC05/AC06/MM05 existed in prod at all before this session**
(dev-only, from the 2026-07-29/30 commits — "Implement AC05/AC06/MM05",
"Add FG Dispatch discovery"). SO01/SO02 already existed (Group 8,
deactivated pending design — this is that design). Registered all 4 missing
resources in prod: `erp_menu.menu_master` + `menu_tree` (parent groups:
SO03→`GRP_ACL_SALES`, AC05/AC06→`GRP_ACL_ACCOUNTS`,
MM05→`GRP_ACL_OM_MASTERS`, all 3 already existed) + `acl.menu_master`
(including the route-only `PROC_DO_CREATE` companion resource, same
pattern as `PROC_PO_CREATE`/`PROC_STO_CREATE` — verified via
`route-acl-registry.ts` that Delivery Order create/cancel actually live on
a separate resource code from the list/get routes).

**Action universe verified against `route-acl-registry.ts` before
designing** (not guessed): `PROC_SO_LIST`(VIEW) + `PROC_SO_CREATE`(VIEW,
WRITE, EDIT); `PROC_INV_LIST`(VIEW, WRITE, APPROVE); `PROC_DO_LIST`(VIEW) +
`PROC_DO_CREATE`(VIEW, WRITE, EDIT); `ACC_MTS_SKU_MONTHLY_RATE`(VIEW,
WRITE, APPROVE); `ACC_SLOC_COSTING_GROUP`(VIEW, WRITE, DELETE, APPROVE);
`OM_FG_DISPATCH_CUSTOMER`(VIEW, WRITE, EDIT — no Approve action exists in
code for this one at all).

**8 new capabilities** (department-vs-resource action sets differ enough
that a shared capability across departments would have over-granted —
e.g. Stores must never get `PROC_SO_CREATE`'s WRITE):
`CAP_SALES_ACCOUNTS`, `CAP_SALES_STORES`, `CAP_DIRECTOR_VIEW_NEWPAGES`
(Director's view-only default on SO01/SO02/SO03/MM05 — not mentioned
explicitly for these 4, so defaulted to this doc's dominant View-only
convention, flagged to business owner as an inferred default),
`CAP_ACC_COSTING` (Accounts + Director, same full-minus-approve ceiling,
one capability since they need identical actions), `CAP_ACC_COSTING_AUDITOR`
(View+Approve only, not Write — Accounts drafts, Auditor approves, a real
maker-checker split, not "auditor also gets create"), `CAP_ACC_COSTING_PLANTHEAD`,
`CAP_OM_FG_DISPATCH`, `CAP_OM_FG_DISPATCH_PLANTHEAD`. `role_capabilities`
for the whole-department capabilities uses this doc's established
all-11-roles pattern (department/work-context membership is the real gate,
role list just sets the ceiling within it). ACL-MASTER granted the
full-access capabilities directly (not a 9th capability) — its own
work_context added as an extra holder of `CAP_SALES_ACCOUNTS`,
`CAP_SALES_STORES`, `CAP_ACC_COSTING`, `CAP_ACC_COSTING_AUDITOR`, and
`CAP_OM_FG_DISPATCH`, giving it the union of every action across all 6
resources including the Auditor-only Approve action.

**False alarm during verification, resolved — worth recording so it isn't
re-investigated from scratch next time:** first-pass verification (grouping
`precomputed_acl_view` by resource_code without filtering `acl_version_id`)
showed AUDIT with unexpected full `PROC_SO_CREATE`/`PROC_RTV_CREATE` access.
Traced through `generate_acl_snapshot()`'s source and confirmed: the
function only ever `DELETE`s rows matching the *specific* `acl_version_id`
being regenerated — it never purges rows from **other, now-inactive**
`acl_version_id`s for the same company. `precomputed_acl_view` has been
accumulating one full copy of every historical version (v12 through v33 and
beyond) forever, including pre-cleanup blanket grants from before this
whole doc's work started. This is **not a live security issue** — verified
`_shared/acl_snapshot.ts`'s `readAclSnapshotDecision()` (the only runtime
read path, called from `_pipeline/acl.ts`'s `stepAcl`) always filters
`.eq("acl_version_id", <the currently-active version>)`, so stale rows from
deactivated versions are never actually served to a real request. Re-ran
the same verification filtered to just v33 (CMP003) / the matching CMP006
version and got the correct, designed result with no leaks. **Housekeeping
item, not urgent:** `precomputed_acl_view` will keep growing unboundedly
across every future version bump — a periodic
`DELETE ... WHERE acl_version_id NOT IN (SELECT acl_version_id FROM acl.acl_versions WHERE is_active = true)`
cleanup would be worth doing eventually, but is not a correctness or
security fix.

**Verified via `precomputed_acl_view` (v33, both CMP003/CMP006, filtered to
the active version only):** ACCOUNTS = full on all 6 resources exactly as
designed (`PROC_SO_LIST` View / `PROC_SO_CREATE` V+W+E / `PROC_INV_LIST`
V+W+Approve / `ACC_MTS_SKU_MONTHLY_RATE` V+W / `ACC_SLOC_COSTING_GROUP`
V+W+D / `OM_FG_DISPATCH_CUSTOMER` V+W+E); STORES = `PROC_DO_LIST` View +
`PROC_DO_CREATE` V+W+E only; AUDIT = View+Approve only on AC05/AC06,
nothing on the Sales resources; DIRECTOR = View-only on the 4 Sales/OM
resources, full-minus-approve on AC05/AC06; MANAGEMENT = View-only on
AC05/AC06/MM05; ACL-MASTER = full on everything including the Auditor-only
Approve action. Symmetric across both companies. Also rebuilt
`erp_menu.menu_snapshot` for P0076's (company, work_context) pairs.

---

## Task C — Real maker-checker for Opening Stock / AC05 / AC06 (2026-08-03)

**Trigger:** Codex's repo-wide 11-bug audit (Task A) flagged Bug #7 (maker-checker
empty/fallback-only) as open for these 3 resources — their Approve handlers were
plain status flips (SUBMITTED→APPROVED / DRAFT→APPROVED) with **no creator-vs-
approver check and no self-approval guard**, unlike PO/STO/PTO which already had
the real `acl.approver_map` + `_shared/workflow_scope.ts` engine (Groups 3/5/10,
earlier this session). Business owner explicitly clarified mid-session: this is
**not** a request for a new "approval inbox" UI (PO13-style) — those buttons
already exist on IN05/AC05/AC06; the only gap is the backend permission check
behind the existing Approve button.

**Design (business owner, verbatim intent):**
- **Opening Stock (`PROC_OPENING_STOCK_APPROVAL`):** L1_AUDITOR creates →
  L2_AUDITOR approves; L2_AUDITOR creates → DIRECTOR approves. ACL-MASTER
  (role=DIRECTOR) always able to act since DIRECTOR is the top of the chain.
- **AC05 (`ACC_MTS_SKU_MONTHLY_RATE`) / AC06 (`ACC_SLOC_COSTING_GROUP`):**
  Accounts department (any rank) creates → **either** L1_AUDITOR or L2_AUDITOR
  may approve; L1_AUDITOR creates → L2_AUDITOR approves; L2_AUDITOR creates →
  DIRECTOR approves. Revised same session: Auditors also need **WRITE** (not
  just View+Approve) so they can draft/create themselves, not only approve.

**Implementation (replicates the exact `po.handlers.ts` `assertProcurementHeadRole`
pattern — SA/GA bypass, `acl.approver_map` SUBJECT_ROLE lookup via
`pickScopedApproverRules`, DIRECTOR fallback when no rows configured, explicit
self-approval-forbidden guard exempting DIRECTOR):**
- `opening_stock.handlers.ts` — added `loadOpeningStockApproverRules`,
  `getOpeningStockUserRoleCode`, `matchesOpeningStockApprover`,
  `assertOpeningStockApproverRole`; wired into `approveOpeningStockDocumentHandler`
  before the status flip, using `document.created_by`.
- `mts_sku_rate.handlers.ts` — same shape, `assertMtsRateApproverRole`, wired
  into `approveMtsSkuRateHandler`. **Difference from PO/STO:** this approve
  action flips *every* DRAFT row for a company+rate_month in one call, and
  those rows can have been saved by different creators across separate calls
  — so the check loops over every **distinct** `created_by` in the batch and
  requires the approver to clear the check for each one (added `created_by`
  to the row select, which wasn't previously fetched).
- `costing_group.handlers.ts` — identical batch-aware shape,
  `assertCostingRateApproverRole`, wired into `approveCostingRateHandler`.
- All 3 files: `deno check` clean (zero errors) individually and combined.
- Verified against live prod schema before wiring: `created_by` confirmed to
  exist on `erp_procurement.opening_stock_document`,
  `erp_production.mts_sku_monthly_rate`, and `erp_production.costing_rate_line`.

**`acl.approver_map` data (prod, MCP):**
- New `acl.module_resource_map` rows required first (a DB trigger,
  `enforce_approver_scope_integrity()`, blocks any `approver_map` insert whose
  `resource_code` isn't bound to a `module_code`): `MOD_INVENTORY` →
  `PROC_OPENING_STOCK_APPROVAL`, `MOD_ACCOUNTS` → `ACC_MTS_SKU_MONTHLY_RATE` /
  `ACC_SLOC_COSTING_GROUP` (both module codes already existed elsewhere in the
  table, reused as-is).
- Opening Stock: 2 rows × 2 companies = 4 total (`L1_AUDITOR→L2_AUDITOR`,
  `L2_AUDITOR→DIRECTOR`, `scope_type='SUBJECT_ROLE'`, `approval_stage=1`).
- AC05 + AC06: 18 rows × 2 resources × 2 companies = 72 total. Per
  resource+company: the same 2 auditor-escalation rows, plus 8 "Accounts
  creator rank" subjects (`L1_USER`..`L4_USER`, `L1_MANAGER`..`L4_MANAGER`) ×
  2 approver alternatives each (`L1_AUDITOR` and `L2_AUDITOR` — both valid,
  same `approval_stage=1`, matched via `matchesXApprover`'s `.some()`, i.e.
  either auditor rank can act). Every rank was included rather than only the
  ranks currently staffed in Accounts, since department membership (who's
  actually "Accounts") is governed by `work_context_capabilities`, not by
  role_code — the approver_map's SUBJECT_ROLE scope (the same mechanism
  already proven for PO/STO/PTO) can only route by the creator's role rank,
  so every plausible rank below Auditor/Director needed its own row.

**`CAP_ACC_COSTING_AUDITOR` revision:** was View+Approve only on both AC05/AC06
menu rows; added `WRITE` on both (`acl.capability_menu_actions` insert). Since
`acl.capture_acl_version_source()` is one-time-per-version (silent no-op on
reuse — CLAUDE.md §"দ্বিতীয় সংশোধন"), this required a genuine version bump:
new `acl_versions` v34 for both CMP003 and CMP006, captured, `generate_acl_snapshot`
run, then v34 activated (v33 deactivated). **Verified live:** P0010 (L1_AUDITOR,
CMP003+CMP006) now resolves `WRITE=ALLOW` on both AC05 and AC06 in
`precomputed_acl_view` at v34; P0074/P0076 (DIRECTOR) still resolve `WRITE=ALLOW`
as before (unaffected, already had full access).

**Self-approval note:** all 3 `assertXApproverRole` functions exempt DIRECTOR
from the self-approval block (matching the PO reference pattern) — both P0076
(ACL-MASTER, confirmed role_code=DIRECTOR via live query, *not* SA/GA) and the
real business-owner DIRECTOR account rely on this exemption, since DIRECTOR is
the top of every chain here and has no one above to approve instead.

**Row-count sanity check (post-insert, live DB):** `ACC_MTS_SKU_MONTHLY_RATE`
= 18/company × 2 companies; `ACC_SLOC_COSTING_GROUP` = 18/company × 2 companies;
`PROC_OPENING_STOCK_APPROVAL` = 2/company × 2 companies — all match the intended
design exactly, no accidental duplicates or missing companies.

**Not yet done:** live click-through in the deployed app (no dev login in this
environment — verified via `deno check` + direct `precomputed_acl_view` queries
only, per this session's established `[No Localhost Preview]` practice).

---

## Addendum — ACL-MASTER (P0076) APPROVE gap on AC05/AC06, found + fixed (2026-08-03)

Found by a new drift-check tool (`scripts/acl-master-drift-check.mjs`, built
this session for 11-bug-pattern #5), not by manual review — P0076 was
missing `APPROVE` on `ACC_MTS_SKU_MONTHLY_RATE`/`ACC_SLOC_COSTING_GROUP` in
both CMP003 and CMP006, contradicting this doc's own Group 11 design
("ACL-MASTER granted the full-access capabilities directly... giving it the
union of every action across all 6 resources including the Auditor-only
Approve action"). Root cause: `CAP_ACC_COSTING_AUDITOR` was mapped to
`work_context_capabilities` correctly for P0076's department, but
`role_capabilities` only ever listed `L1_AUDITOR`/`L2_AUDITOR` for that
capability code — `generate_acl_snapshot()` requires BOTH gates to pass
(department capability AND role enrollment), so DIRECTOR fell through.
Fixed: added `DIRECTOR` to `role_capabilities` for
`CAP_ACC_COSTING_AUDITOR` (global table, both companies covered by one
insert), version bumped v34→v35 for CMP003/CMP006 (capture+generate+activate),
verified live. Full detail in `OM-IMPLEMENTATION-LOG.md`'s "very final"
2026-08-03 entry.

---

## Appendix — Recurring Regression Patterns

Future ACL/company/approval work must check these recurring bug classes before a page/group is marked done:
1. Hardcoded rank-check bypass
2. Company-scope gap
3. Blanket capability leak
4. capture_acl_version_source() no-op trap
5. ACL-MASTER drift
6. Shared resource-code collision
7. Maker-checker empty / fallback-only illusion
8. Route/registry mismatch
9. cl.approver_map scope/index mismatch
10. Small config/data trap
11. Wrong company source / single-company bypass

Use this appendix together with CLAUDE.md's pre-code checklist and OM-IMPLEMENTATION-LOG.md's Bug #n tracking convention. When a new issue fits one of these patterns, log it explicitly instead of treating it as a one-off anomaly.
