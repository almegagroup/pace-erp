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

## Group 3 — Procurement

Status: ✅ Decided + implemented in prod (2026-07-28), including PO02.

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
| PO14 | Old Purchase Order | Same as PO01 (no separate resource code exists — see note) | | | Same as PO01 |
| PO16 | Legacy STO | Same as PO07 (no separate resource code exists — see note) | | | Same as PO07 |

**PO12 correction mid-session:** business owner initially said "SCM র kache" for the whole group, then corrected PO12 specifically — Plant Transfer isn't SCM's, it's Stores+Logistics+SCM together (all three full V/C/E/D), since it's a physical stock-movement function, not a procurement one. Director stays View-only, matching the rest of the group.

**PO14/PO16 — no independent resource code exists.** Verified against live code: `POCreateOpeningPage.jsx`/`STOCreateOpeningPage.jsx` are thin wrappers that post to the exact same `/api/procurement/purchase-orders`/`/api/procurement/stos` endpoints as PO01/PO07's own create flow — gated by the identical `PROC_PO_CREATE`/`PROC_STO_CREATE` resource codes. Whatever permission PO01/PO07 get, PO14/PO16 get automatically; there is no way to grant them separately today without a route-registry/resource-code split (a genuine code change, not attempted here since it wasn't asked for).

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

| tx_code | Page | Stores | Security | Audit |
|---|---|---|---|---|
| PO04 | Gate Entries | V C E | V C E | |
| PO05 | Goods Receipts (GRN) | V W E **A** (Post — no wait, Stores posts it themselves, matches SAP MIGO) | | **D only** (Reversal — separation of duties) |
| PO17 | Gate Exit | V W | V W | |
| PO18 | Gate Entry Report | Already universal via `CAP_EVERYONE_REPORTS` (every department, every company they have access to — single-company users see their own company, multi-company users see whichever company is currently selected) | | |

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

## Group 8 — Sales (⛔ deliberately deactivated, not designed yet)

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

## Group 9 — Inventory (⛔ deliberately deactivated, not designed yet)

IN01 Physical Inventory, IN02 Stock Ledger, IN03 Current Stock, IN04 Stock
Valuation, IN05 Opening Stock, IN06 Opening Stock Approval, PR21 FG Stock
Breakdown.

**Business owner's call (2026-07-29):** same treatment as Groups 6/7/8 —
not properly designed yet, deactivated for every department except P0076
(ACL MASTER).

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

| tx_code | Page | Production | Quality | SCM | Management | Stores | Audit | Director |
|---|---|---|---|---|---|---|---|---|
| PR00 | Plan Feed | V C E (+ Plant Head fallback) | | | V (+Plant Head = V C E) | V | | V |
| PR05 | Pack BOM Create | V | V | V C E | V | | | V |
| PR06 | Pack BOM Approval | V | V | V (L1-L2_Mgr: + A) | V | | | V |
| PR07 | Change Pack BOM | V | V | V C E | V | | | V |
| PR08 | Change Pack BOM Approval | V | V | V (L1-L2_Mgr: + A) | V | | | V |
| PR09 | Production PO Create | V C E (+ Plant Head fallback) | | | (Plant Head = V C E) | | | V |
| PR10 | Production PO Edit | — | V C E A | — | — | — | — | V |
| PR11 | Production PO Final (up to L2_Manager) | V C E | | | | | | V |
| PR13 | Order List | V (Manager-tier+Director only) | V (Manager-tier+Director only) | | | | V | V |
| PR14 | Batch Variance Report | same as PR13 | same as PR13 | | | | V | V |
| PR20 | Partial Reversal Report | same as PR13 | same as PR13 | | | | V | V |
| PR22 | Old Process PO | V C E | | | | | | V |
| PR23 | Old Packing PO | V C E | | | | | | V |

**Plant Head fallback pattern (same design as Group 5):** since CMP003 has
Nilkamal (dual QUALITY+PRODUCTION, covers PR00/PR09 via plain PRODUCTION
dept membership) but other companies have no dedicated Production manager,
a separate `CAP_PROD_PLANTHEAD_FULL` (MANAGEMENT dept, L3_MANAGER role
only) gives Pradip/Kishor full PR00+PR09 access too — uniform across both
companies per the established "grant it everywhere, even where redundant"
convention from Group 5.

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
- `GET /api/procurement/po-filter-options` returned 500 for Ankan; its own
  rank-check (`assertProcurementReadRole`) is already a no-op, so this is
  an unrelated, still-uninvestigated failure.
Business owner directed: ship this fix first (unblocks PO creation
end-to-end, the critical path), re-test with fresh logs, then chase these
two separately rather than guessing ahead of evidence.
