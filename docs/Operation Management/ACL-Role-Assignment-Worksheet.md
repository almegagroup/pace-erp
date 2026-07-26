# ACL Role Assignment Worksheet — Who Can Do What

> **Purpose:** Before Dispatch/Costing design, lock down create/approve
> permissions for every page already built (as visible in DIRECTOR's full
> ACL menu today), then restructure `acl.capability_menu_actions` +
> `acl.approver_map` + work-context mapping to match. Future modules
> (Dispatch, Costing, Accounts redesign, WAR) will have their role
> assignment finalized as part of their own design session and added here,
> then implemented in the same final pass.
>
> **Process (locked 2026-07-25):** Go through DIRECTOR's menu group by
> group, page by page. For each page, decide who creates and who approves.
> Nothing gets implemented until this whole worksheet is finalized —
> then one pass builds the ACL config for everything at once.

---

## ✅ IMPLEMENTED — 2026-07-25 (Dev, `ytapuwiqicmvpanmzelb`)

Every group below marked "✅ Decided" has been **built and verified live in Dev**,
not just documented. Inventory (held back) and HR (untouched, out of scope) are
unaffected, exactly as decided.

**What was built:**
- 8 new capabilities (`CAP_QA_PROD_STANDARD/MANAGER/AUDITOR`, `CAP_PROD_STANDARD`,
  `CAP_PROD_PACKBOM_CREATE/APPROVE`, `CAP_OM_MATERIAL_CATEGORY`, `CAP_EVERYONE_REPORTS`)
  with correct role-tier (`role_capabilities`) and department (`work_context_capabilities`)
  wiring, including the MANAGEMENT-mirror rule for both Manager-tier and Auditor-tier.
- `CAP_PROD_OPERATOR` narrowed from "every department" to PRODUCTION+MANAGEMENT only,
  and its bundled QA-only pages (PR01-04/12/15/17-19) removed (moved to the new QA
  capabilities instead).
- Existing capabilities (`CAP_PROC_ACCOUNTS/LOGISTICS/RETURNS/SALES/OM_MASTER_DATA`)
  extended with the missing departments per this worksheet's decisions.
- `PM04` moved out of `CAP_PROC_SETUP` into its own capability (SCM+Production+all roles).
- Menu-group re-parenting (PR01-04/12/15/16/17-19 → Quality Assurance; PM04 → Operation
  Masters; PR21 → Inventory) done via `erp_menu.menu_tree` updates.

**Real bugs found and fixed along the way (not just design gaps):**
1. `acl.capture_acl_version_source()` is **one-time-only per version** — re-running it
   against an already-captured version silently no-ops. Fixed by creating fresh
   `acl_versions` rows (v6→v8) each time and activating those instead of reusing v4/5.
2. Adding SCM to `CAP_PROC_RECEIVING` (to reach PM06) accidentally also granted SCM the
   whole bundle (PO01/04/05/17/18) — reverted; PM06 was already reachable via
   `CAP_PROC_SETUP`, no new grant was needed there at all.
3. **Stale `menu_snapshot` rows never got cleaned up** when the 9 dev users were
   reassigned from DIRECTOR (4 companies) to their narrower real roles earlier this
   session — old broad snapshots for companies/work-contexts they no longer hold kept
   polluting every verification query. Deleted all orphaned ACL-universe snapshot rows
   (globally, not just for these 9 users) as a general hygiene fix.
4. DIRECTOR does not automatically inherit Auditor-exclusive grants (MANAGER family
   never inherits AUDITOR-tier capabilities, by the ACL engine's own design) — added
   DIRECTOR explicitly to `CAP_QA_PROD_AUDITOR` so PR04 (Change BOM Approval) is truly
   exception-free for DIRECTOR, matching the blanket rule.
5. `acl.role_menu_permissions` (a separate, legacy direct role→menu grant table) turned
   out to be harmless — verified it contains **zero VIEW-action rows**, so it can only
   ever add supplementary APPROVE/DELETE/EDIT/WRITE/EXPORT to a menu a user already
   sees via a capability; it cannot leak menu visibility. No changes made to it.
6. Corrected two of this worksheet's own notes that were checked against live data
   during rollout and found stale: (a) "Inventory = DIRECTOR-only" was found wrong —
   it was actually already broadly wired via the pre-existing `CAP_PROC_INVENTORY`
   capability — **business owner then explicitly chose to make it DIRECTOR-only for
   real** (not just "leave broad state as-is" anymore): `CAP_PROC_INVENTORY`'s
   `role_capabilities` narrowed to `DIRECTOR` only (10 other roles removed), pending a
   proper distribution decision later. Same treatment for HR self-service
   (`CAP_HR_LEAVE_SELF`, `CAP_HR_OUT_WORK_SELF` — LV01/02, OW01/02) — these were
   broadly available to everyone by design (every employee applies for their own
   leave), but business owner asked to pull them back to DIRECTOR-only too, until a
   real HR-role distribution session happens; (b) the PR05-08 segregation-of-duties
   note now correctly says the "Manager-creator ⇒ Auditor-only-approves" rule is
   enforced by a **generic self-approval block** (still a pending Codex code task —
   see below), not a hardcoded creator-role condition.

**⚠️ Reminder for the future distribution session:** IN01-06 (Inventory) and
LV01/02+OW01/02 (HR self-service — Apply Leave/Out-Work + My Requests) are now
DIRECTOR-only in Dev, deliberately, as of 2026-07-25. This is NOT their final state —
Inventory still needs its own formal design pass (already flagged as held-back
earlier), and HR self-service needs to go back to being available to every employee
once a real distribution decision is made (right now literally nobody but DIRECTOR
can apply for their own leave in Dev — acceptable only because Dev is pre-go-live).

**Deferred to a Codex task brief (data/ACL side is done, this is a code change):**
Add a self-approval check to `approvePackBomHandler` and
`approvePackBomChangeRequestHandler` (`pack_bom.handlers.ts`), reusing the existing
PO/STO pattern: `if (createdBy === ctx.auth_user_id && role !== "DIRECTOR") throw
SELF_APPROVAL_FORBIDDEN`.

**Verified against live `menu_snapshot` for all 9 dev users** — each user's actual
menu now matches this worksheet's decisions exactly (department + role-tier +
MANAGEMENT/Auditor mirrors + segregation-of-duties all confirmed correct per user).

---

## Menu Groups (from live `erp_menu.menu_tree`, ACL universe, order = DIRECTOR's actual
menu `display_order`, corrected 2026-07-25 — we go in this order, not table-alphabetical)

| Order | Group | Pages | Status |
|---|---|---|---|
| 10 | Operation Masters | 5 (+PM04, moved from Procurement Masters 2026-07-25) | ✅ Decided |
| 15 | Procurement Masters | 6 (PM04 moved out) | ✅ Decided |
| 20 | Procurement | 9 | ✅ Decided |
| 30 | Receiving | 4 | ✅ Decided |
| 40 | Quality Assurance | 11 (+PR01/02/03/04/12/15/16/17/18/19, moved from Production 2026-07-25) | ✅ Decided |
| 60 | Returns & Claims | 3 | ✅ Decided |
| 70 | Accounts | 4 | ✅ Decided |
| 80 | Sales | 2 | ✅ Decided |
| 90 | Inventory | 7 | 🔒 Held back — DIRECTOR-only, unchanged |
| 95 | Production | 13 (PR21 moved to Inventory; PR01/02/03/04/12/15/16/17/18/19 moved to Quality Assurance) | ✅ Decided |
| 110 | HR — Leave Management | 6 | ⬜ Not started |
| 120 | HR — Out-Work | 5 | ⬜ Not started |
| 130 | HR — Attendance | 10 | ⬜ Not started |

---

## Dev Test Users (locked 2026-07-25)

11 total roles exist (excluding SA/GA): DIRECTOR, L4_MANAGER, L3_MANAGER, L2_MANAGER,
L1_MANAGER, L2_AUDITOR, L1_AUDITOR, L4_USER, L3_USER, L2_USER, L1_USER.

9 P-code dev users exist (all were DIRECTOR before this reassignment). L1_USER and
L2_AUDITOR are deliberately left unassigned (no test user covers them right now).

| User Code | Role | Company Scope | Applied |
|---|---|---|---|
| P0004 | DIRECTOR | CMP003, CMP005, CMP006, CMP007 | ✅ (unchanged) |
| P0006 | L1_MANAGER | CMP003, CMP005, CMP006, CMP007 | ✅ (unchanged) |
| P0007 | L1_AUDITOR | CMP003, CMP005, CMP006, CMP007 | ✅ (unchanged) |
| P0002 | L1_MANAGER *(changed from L4_MANAGER)* | CMP003 only | ✅ |
| P0003 | L3_MANAGER | CMP003 only | ✅ |
| P0005 | L2_MANAGER | CMP003 only | ✅ |
| P0008 | L4_USER | CMP003 only | ✅ |
| P0009 | L3_USER | CMP003 only | ✅ |
| P0010 | L2_USER | CMP003 only | ✅ |
| *(none)* | L1_USER — deliberately unassigned | — | — |
| *(none)* | L2_AUDITOR — deliberately unassigned | — | — |

✅ **Applied (dev, 2026-07-25, via MCP)**, verified by re-query. `role_rank` matches
`_shared/role_ladder.ts`'s `ROLE_RANK` exactly. `erp_map.user_companies` rows for
CMP005/CMP006/CMP007 were deleted (not just hidden) for the 6 CMP003-only users;
`is_primary` on the remaining CMP003 row set to `true`.

### Work context assignment (round 2, 2026-07-25)

| User | Role | Company | Work Context |
|---|---|---|---|
| P0002 | L1_MANAGER | CMP003 | PRODUCTION |
| P0003 | L3_MANAGER | CMP003 only | MANAGEMENT (= "Plant Head" of CMP003 — no distinct Plant Head work context exists, mapped to MANAGEMENT) |
| P0004 | DIRECTOR | 4 companies | MANAGEMENT |
| P0005 | **L2_USER** *(changed from L2_MANAGER)* | CMP003 | STORES |
| P0006 | L1_MANAGER | 4 companies | SUPPLY CHAIN (all 4) |
| P0007 | L1_AUDITOR | 4 companies | MANAGEMENT |
| P0008 | L4_USER | 4 companies | SUPPLY CHAIN (all 4) |
| P0009 | L3_USER | CMP003 | PRODUCTION |
| P0010 | L2_USER | CMP003 | QUALITY |

**Two users share the same role by design, at different scope breadths:**
- L1_MANAGER: P0002 (CMP003 only) vs P0006 (all 4 companies)
- L2_USER: P0005 (STORES) vs P0010 (QUALITY)
- SUPPLY CHAIN: P0006 (L1_MANAGER, all 4) vs P0008 (L4_USER, all 4)

⚠️ **No "Plant Head" work context/department exists** in `erp_master.departments` or
`erp_acl.work_contexts` — CMP003's fixed department list is exactly: ACCOUNTS, STORES,
QUALITY, PRODUCTION, LOGISTICS, ENGINEERING, SUPPLY CHAIN, MANAGEMENT, SECURITY,
ENGINEERING STORES. P0003 was mapped to MANAGEMENT as the closest equivalent — flagged
to business owner, not yet explicitly confirmed as correct vs. needing a real new
"Plant Head" department.

---

## Decisions

_(filled in as we go, one group at a time)_

### Operation Masters (4 pages) — decided 2026-07-25

| Page | What it does | Access |
|---|---|---|
| MM01 — Materials | Material Master (RM/PM/FG/SFG/INT/CONS create/edit/view) | ✅ **Fixed (2026-07-25)** — see below. |
| MM02 — Vendors | Vendor Master (create/edit/view) | ✅ **Fixed (2026-07-25)** — see below. |
| MM03 — Vendor-Material Links (ASL) | Which vendor supplies which material, at what rate/UOM | ✅ Correct as-is — normal SCM read/write, no change. |
| MM04 — RM/PM Sales Customer | Customer Master (RM/PM sales side only) | SCM **and** Stores, both full access. |
| PM04 — Material Categories | Category groups — backs Stroke Master's Alternate Material grouping | **SCM + Production + L1_AUDITOR** — moved here from Procurement Masters, 2026-07-25 (already re-parented live in `erp_menu.menu_tree`, `display_order=5`) |

**ACL capability-grant scope (2026-07-25, business owner):** whoever's menu ends up
including MM01/MM02 gets a **VIEW-only** capability grant (no WRITE/EDIT/APPROVE
action, regardless of role) — MM01/MM02 are read-only for everyone by ACL design, not
just for the specific roles the frontend code currently gates. MM03/MM04, by contrast,
get the **full** action set (VIEW+WRITE+EDIT, whatever applies) for whoever is granted
access — no read-only restriction there. This is the `acl.capability_menu_actions`
grant shape to use when this group's ACL config is actually built in the
implementation pass.

**UI rule noted for MM04 (likely reusable elsewhere):** Company selector shows a
**dropdown only when the logged-in user has more than one company** in their own
scope (e.g. SCM users like P0006/P0008 — 4 companies); if the user has exactly **one**
company (e.g. Stores — P0005, CMP003 only), the company **auto-resolves**, no dropdown
shown. Likely already implemented as `TransactionCompanySelector` (used on Process
PO/Packing PO) — reuse that component, don't build a new one.

**MM01/MM02 fix implemented (2026-07-25):** investigated before assuming — the List
pages (`MaterialListPage.jsx`, `VendorListPage.jsx`) already correctly hid "Create"
from non-SA roles (Vendor's list never had Create at all — comment there already
says "Vendor Master is SA-managed"). The real gap was the **Detail** pages
(`MaterialDetailPage.jsx`, `VendorDetailPage.jsx`) — Edit/Save/status-change/company-
extension/company-mapping/payment-terms/contacts/emails were all visible and
clickable to **every** role, with zero frontend gating (only the backend's
`assertManagerOrSARole` — SA/GA/DIRECTOR/L4_MANAGER/L3_MANAGER/L2_MANAGER — stood
between a lower role and a 403). Fixed by adding a `canEdit` check (mirroring that
exact backend role set, from `_shared/role_ladder.ts`) to both detail pages: every
write control is now hidden (not just disabled) when the signed-in role isn't in that
set, and the pages fall back to their already-existing read-only preview rendering.
This does **not** touch or narrow Gate-26's already-locked Manager+ edit access —
DIRECTOR/L2-L4_MANAGER can still edit exactly as before. For SCM specifically
(P0006=L1_MANAGER, P0008=L4_USER — both below L2_MANAGER), this makes MM01/MM02
genuinely read-only, matching the ask. No backend or ACL config changes needed.

**Not yet implemented** — the ACL capability grants for MM03/MM04 (SCM + Stores)
and the MM04 company-selector dropdown-vs-auto-resolve behavior will be built in
the final implementation pass, once every group is decided.

### Procurement Masters (6 pages, PM04 moved out) — decided 2026-07-25

| tx_code | Page | What it does | Access |
|---|---|---|---|
| PM01 | Payment Terms | Vendor payment terms master | SCM only |
| PM02 | Ports | Port master (import) | SCM only |
| PM03 | Port Transit Times | Port-to-plant transit time master | SCM only |
| PM05 | Lead Times | Import lead time master | SCM only |
| PM06 | Transporters | Transporter master | **SCM + Stores** |
| PM07 | Customs House Agents | CHA master (import) | SCM only |

**PM04 (Material Categories) moved to Operation Masters, 2026-07-25 — already executed
live** (see Operation Masters section below), not just noted for later. Fits next to
Material Master (MM01) instead of here, since it's confirmed a Production dependency
(Stroke Master's Alternate Material grouping), not a procurement-specific classification.

**PM04 → Production, why:** verified `material_category_group`/`material_category_group_member`
is read by `stroke_master.handlers.ts` (Alternate Material picker) plus `pack_bom`,
`process_order`, `packing_order`, `stroke_change_request` handlers — a real Production
dependency, not just a procurement classification. Confirmed with business owner.

**PM04 → L1_AUDITOR too (2026-07-25):** business owner needs L1_AUDITOR (P0007, 4-company
scope) to see which material belongs to which category group, per company — same access
level as SCM + Production get (not a separate view-only carve-out), across all of
P0007's own company scope.

**PM06 → Stores, why:** GRN's Transporter search (`GRNPostFlow.jsx`) shows an inline
"Add to Transporter Master →" link when no match is found, but it's gated by
`isRouteAllowed(allowedRoutes, "/dashboard/procurement/masters/transporters")` — i.e. it
only appears for whoever already has PM06 in their own ACL menu; it's the same permission,
not a separate mechanism. So giving Stores the quick-add-during-GRN capability means
giving Stores PM06 itself. Confirmed with business owner.

**Not yet implemented** — ACL capability grants for all 7 pages will be built in the
final implementation pass, once every group is decided.

### Procurement (9 pages) — decided 2026-07-25

| tx_code | Page | What it does | Access |
|---|---|---|---|
| PO01 | Purchase Orders | PO list/create/view | SCM + DIRECTOR |
| PO02 | CSN Tracker | Consignment Note tracker | SCM + DIRECTOR |
| PO03 | CSN Alerts | CSN alert/exception view | SCM + DIRECTOR |
| PO07 | Stock Transfer Orders | STO list/create/view | SCM + DIRECTOR |
| PO11 | Procurement Planning | Planning view | SCM + DIRECTOR |
| PO12 | Plant Transfers | Plant-to-plant transfer | **SCM + DIRECTOR + Stores** |
| PO13 | Pending Order Approvals (PO/STO) | Approval queue | SCM + DIRECTOR |
| PO14 | Old Purchase Order | Opening-genealogy legacy PO entry | SCM + DIRECTOR |
| PO16 | Legacy Stock Transfer Order | Opening-genealogy legacy STO entry | SCM + DIRECTOR |

**PO12 → Stores too, why:** business owner's own call — Plant Transfer is a Stores-side
physical movement, so Stores needs it alongside SCM/DIRECTOR.

**⚠️ Flagged, not blocking this decision:** business owner says the Plant Transfer page
itself ("Plant Transfer page thik thak nei") is not correctly designed yet — a proper
design pass is deferred to later. Access is still assigned now (SCM+DIRECTOR+Stores) so
the ACL implementation pass isn't blocked on that redesign; the page's own mechanics can
be fixed independently afterward without touching who has access to it.

**Not yet implemented** — ACL capability grants for all 9 pages will be built in the
final implementation pass, once every group is decided.

### Receiving (4 pages) — decided 2026-07-25

| tx_code | Page | What it does | Access |
|---|---|---|---|
| PO04 | Gate Entries | Inbound gate entry (vehicle + PO/STO/CSN linking) | **Stores + Security** + DIRECTOR |
| PO05 | Goods Receipts | GRN posting | Stores + DIRECTOR |
| PO17 | Gate Exit | Outbound gate exit | **Stores + Security** + DIRECTOR |
| PO18 | Gate Entry Report | Gate entry report/history | **Everyone** (all roles) + DIRECTOR |

**Data scoping rule (applies to PO18, and generally to every page going forward):**
company scope comes from the user's own `erp_map.user_companies` rows, not from the
page grant — a single-company user only ever sees that one company's data; a
multi-company user sees data for exactly the companies already in their own scope.
This is the existing standard behavior, not a new mechanism — noted here because PO18
being granted to "everyone" only makes sense combined with this (nobody sees data
outside their own company scope, no matter how broad the page grant is).

**DIRECTOR — no change, on every page, permanently:** business owner's explicit rule
for this whole worksheet — DIRECTOR already has full access to everything today and
keeps full access to everything after this restructure, on every group, with no
exception. Applies retroactively to Operation Masters/Procurement Masters/Procurement
above too (their tables didn't spell out DIRECTOR each time, but the rule is the same).

**MANAGEMENT work context — gets every page's capability too, permanently (Option B,
locked 2026-07-25):** verified in `acl.generate_acl_snapshot()` that role-rank
inheritance (L1_USER ⊆ L2_USER ⊆ ... ⊆ DIRECTOR) only cascades **within the same
work_context/department** — a Plant Manager (e.g. P0003, mapped to MANAGEMENT per the
Dev Test Users section) does NOT automatically inherit a page granted to, say, QUALITY
just by outranking QA staff, since their own `erp_acl.user_work_contexts` row is
MANAGEMENT, a different bucket. Business owner's fix: whichever department(s) a page
is granted to in this worksheet, **also grant the same capability to the MANAGEMENT
work context** — so Plant Manager (sitting in MANAGEMENT) sees everything across every
department without needing to switch work-context or hold a row in every department.
This is now a **blanket rule for the rest of this worksheet** — going forward, pages
are written as "Department X" and MANAGEMENT is implied on top, not repeated every
time. **Applies retroactively** to every group decided above too (Operation Masters,
Procurement Masters, Procurement, Receiving, Quality Assurance, Returns & Claims,
Accounts, Sales) — MANAGEMENT gets all of those too, same as DIRECTOR.

**⚠️ Gap found + closed, 2026-07-25 — L1/L2_AUDITOR-specific grants must ALSO mirror
into MANAGEMENT.** While building an access-verification table, found that P0007
(L1_AUDITOR, work context = MANAGEMENT, 4 companies) would see almost nothing under
the rule as first written — every "+ L1/L2_AUDITOR" grant so far (PR02, PR03, PR04,
PM04) was created under the department it was decided alongside (QA or SCM's own
`work_context_capabilities`), and AUDITOR-family role-rank cascade only pulls from
AUDITOR-tier grants (per `generate_acl_snapshot()`'s family-isolation rule) — so an
Auditor sitting in MANAGEMENT, a different work_context, never reaches them.
**Business owner's decision: whatever L1_AUDITOR is supposed to be able to do, make
sure it actually can** — so the MANAGEMENT-mirror rule above is **extended to cover
the Auditor-tier component too, not just Manager-tier**. Concretely: PR02/PR03's
L1/L2_AUDITOR grant, PR04's exclusive L1/L2_AUDITOR grant, and PM04's L1_AUDITOR grant
must all also be mirrored into MANAGEMENT's own `work_context_capabilities` (same
capability/action, MANAGEMENT as the work_context instead of QA/SCM) — same mechanism
as the Manager-tier mirror, just for the Auditor tier too. Do this in the same
implementation-pass step as the rest of the MANAGEMENT mirroring.

**Not yet implemented** — ACL capability grants for all 4 pages will be built in the
final implementation pass, once every group is decided.

### Production (13 pages, 10 moved to Quality Assurance + PR21 to Inventory) — decided 2026-07-25

_(MANAGEMENT + DIRECTOR implied on every row per the blanket rule above, not repeated.)_

| tx_code | Page | Access |
|---|---|---|
| PR00 | Plan Feed | Production |
| PR05 | Pack BOM Create | SCM — User tier up to L4_USER + L1_MANAGER (flat department grant, cascades to full Manager tier automatically). |
| PR06 | Pack BOM Approval | SCM Manager tier (L1_MANAGER+) + L1/L2_AUDITOR both get Approve access. **Enforcement mechanism revised 2026-07-25:** original plan needed a creator-role-conditional rule (Manager-tier creator ⇒ only Auditor may approve) — verified `pack_bom.handlers.ts`'s `approvePackBomHandler` has **no self-approval block at all** today (checked: PO/STO handlers have one, Pack BOM doesn't). Simpler fix chosen instead: add a **generic self-approval block** (reuse the existing PO/STO pattern — `createdBy === ctx.auth_user_id && role !== DIRECTOR` ⇒ reject), same as workflow engine already does elsewhere. Business owner confirmed: since there is currently **no second SCM Manager** in the real org, blocking self-approval naturally routes approval to the Auditor in practice anyway — without hardcoding it, so a future second SCM Manager could also approve without a code change. **Code task for Codex:** add this self-approval check to `approvePackBomHandler` + `approvePackBomChangeRequestHandler` (PR06/PR08). |
| PR07 | Change Pack BOM | Same as PR05 — SCM User tier up to L4_USER + L1_MANAGER |
| PR08 | Change Pack BOM Approval | Same as PR06 — SCM Manager tier + L1/L2_AUDITOR, same self-approval-block code task |
| PR09 | Production PO Create | Production |
| PR10 | Production PO Edit | Same — Production |
| PR11 | Production PO Final | Production |
| PR13 | Order List | Everyone (scoped by own company access, same rule as PO18) |
| PR14 | Batch Variance Report | Same — Everyone, company-scoped |
| PR20 | Partial Reversal Report | Everyone, company-scoped |
| PR22 | Old Process PO | Production |
| PR23 | Old Packing PO | Production |

**PR01/02/03/04/12/15/16/17/18/19 moved to Quality Assurance group** (see below) — real
menu-group mismatch caught mid-review: these are all QA-performed actions that were
sitting under "Production" while the dedicated "Quality Assurance" group had only 1
page. **Already re-parented live** in `erp_menu.menu_tree` on 2026-07-25 (not just
noted for later) — business owner confirmed "abossoi move koro" (definitely move it).
**PR16 was a second pass** — initially left in Production since Production also
performs a real action there (Start Batch, not just viewing), but business owner
decided it moves too. Confirmed against `generate_menu_snapshot()`: the sidebar tree
is built per-user from only the pages that user is actually ALLOWed on (plus their
ancestor groups) — so a Production user with only PR16 granted under Quality
Assurance will see the "Quality Assurance" group with just PR16 inside it, not the
other 9 QA-only pages. Access itself is unchanged (QA + Production both still use it,
QA approves / Production clicks Start Batch) — only which group it's filed under moved.

**PR21 moved to Inventory group** (see there) — real bug found: it was a true orphan
in `menu_tree` (no parent at all, invisible to everyone including DIRECTOR) before
this session; now correctly parented under Inventory.

**⚠️ Go-live user-setup reminder (2026-07-25):** regular QA staff and regular
Production staff stay single-department (one `work_context` row each, matching the
Dev test-user pattern — P0002=PRODUCTION only, P0010=QUALITY only, no change needed
there). But business owner confirmed **the Manager above both departments is the same
one person, at every plant so far** — that specific Manager's account needs **two**
`erp_acl.user_work_contexts` rows (QUALITY + PRODUCTION, same company) at go-live, not
one. Without the QUALITY row they can't do PR02/03/17 (Stroke Approval, Change BOM,
Batch Release); without the PRODUCTION row they won't even see PR00/09/10/11/22/23 in
their menu at all, regardless of rank cascade — a department's pages only appear for a
user who actually holds a `work_context` row for that specific department. Not a
schema/design change, just a data-setup fact to apply when real (non-Dev) users are
created — flag this in the eventual Opening Stock / go-live user-setup session.

### Quality Assurance (11 pages, 10 moved in from Production 2026-07-25) — fully decided

| tx_code | Page | What it does | Access |
|---|---|---|---|
| PO06 | Quality Inspection Queue | Inward material QA decision (Release/Block/Reject/For-Reprocess) | QA |
| PR01 | Stroke Master | RM formulation/recipe define | QA |
| PR02 | Stroke Approval | PR01's approve/reject | QA — Manager tier only (L1/L2_MANAGER, not User tier) + L1/L2_AUDITOR |
| PR03 | Change BOM Item | Approved Stroke's RM composition change request | Same as PR02 — QA, Manager tier + L1/L2_AUDITOR |
| PR04 | Change BOM Approval | PR03's approve/reject | **Exclusively L1/L2_AUDITOR** — no Manager tier |
| PR12 | Production PO Verify | QA action, stock posting happens here | QA |
| PR15 | Reversal (CORS) | Process/Packing PO reverse | QA |
| PR16 | QA Approval Queue | Standard approval + Start Batch trigger | QA + Production both see it — QA does the Approve action, Production does the "Start Batch" action (per §83.4 flow) |
| PR17 | Batch Number Release | VOIDED batch → RELEASED | QA — Manager tier (L1/L2_MANAGER grant; L3/L4_MANAGER + DIRECTOR get it automatically via rank cascade) |
| PR18 | SFG Result Recording | Lab test result, Inward QA clone | QA |
| PR19 | Partial Batch Reversal | Salvage/cross-PO reversal | QA |

**PR02 correction note:** first pass wrote "Production" by mistake — business owner
clarified the "L1/L2 manager" they meant for approval were the **QA** managers, not
Production's, since Stroke Master (PR01) creation is QA's job and its approval (PR02)
stays within QA too. Real-world note: at every plant so far, one single person holds
both the Production Manager and QA Manager role for that department — so in practice
today the same person ends up with both anyway, but the ACL grant itself is QA-scoped.

**PO06 decided 2026-07-25:** simple QA-department grant, same as the rest of this
group — no extra nuance ended up applying despite the earlier "onek kichu dhukbe" flag.

**Not yet implemented** — ACL capability grants for all 10 pages will be built in the
final implementation pass, once every group is decided.

### Returns & Claims (3 pages) — decided 2026-07-25

| tx_code | Page | What it does | Access |
|---|---|---|---|
| PO08 | Return to Vendor (RTV) | Return material to vendor | **SCM + Stores + Accounts** |
| PO09 | Debit Notes | Debit note against vendor (RTV/rate discrepancy claim) | **SCM + Stores + Accounts** |
| PO10 | Exchange References | Exchange/replacement tracking | **SCM + Stores + Accounts** |

**Not yet implemented** — ACL capability grants for all 3 pages will be built in the
final implementation pass, once every group is decided.

### Accounts (4 pages) — decided 2026-07-25

| tx_code | Page | What it does | Access |
|---|---|---|---|
| AC01 | Invoice Verifications | Vendor invoice verification | **SCM + Accounts** |
| AC02 | Blocked Invoices | Blocked invoice queue | **SCM + Accounts** |
| AC03 | Landed Costs | Freight/Duty/CHA/Loading/etc. cost entry | **SCM + Accounts** |
| AC04 | Conversion Cost Config | Production conversion rate config (§104-5) | **SCM + Accounts** |

**Not yet implemented** — ACL capability grants for all 4 pages will be built in the
final implementation pass, once every group is decided.

### Sales (2 pages) — decided 2026-07-25

| tx_code | Page | What it does | Access |
|---|---|---|---|
| SO01 | RM/PM Sale | RM/PM sales order | **Stores + Logistics + Accounts** |
| SO02 | Sales Invoices | Sales invoice | **Stores + Logistics + Accounts** |

**Not yet implemented** — ACL capability grants for both pages will be built in the
final implementation pass, once every group is decided.

### Inventory (7 pages) — held back 2026-07-25, DIRECTOR-only unchanged

| tx_code | Page | What it does |
|---|---|---|
| IN01 | Physical Inventory | PID count/reconciliation |
| IN02 | Stock Ledger | Full movement history (MB51-equivalent) |
| IN03 | Current Stock | Live balance (MB52-equivalent) |
| IN04 | Stock Valuation | WAR/rate-based valuation report |
| IN05 | Opening Stock | Opening balance entry (go-live) |
| IN06 | Opening Stock Approval | IN05's approval step |
| PR21 | FG Stock Breakdown | **Everyone, company-scoped** (same rule as PR13/PR20/PO18) — moved here from Production, 2026-07-25 |

**⚠️ Explicitly held back — not designed yet (IN01-IN06 only).** Business owner's
instruction: this group is not fully designed yet, don't give it to anyone else right
now — leave it exactly as it is today. **Correction (2026-07-25, caught during live
verification):** "as it is today" is NOT DIRECTOR-only — checked live, IN01-06 already
sit on the pre-existing `CAP_PROC_INVENTORY` capability, which is broadly wired to
nearly every department across all 4 companies, predating this whole worksheet. That
broad state is exactly what "leave it as it is" preserves — nothing was touched here,
correctly, but the earlier note calling it "DIRECTOR only" was wrong and is now fixed.
Do not implement any grant *change* for IN01-IN06 in the final pass until the business
owner comes back to design it properly. **PR21 above is a decided exception** —
business owner explicitly set its access (everyone, company-scoped) despite the rest
of the group being held back, so implement that one normally.

**🔴 Real bug found while checking PR21 (2026-07-25):** live `erp_menu.menu_tree` has
**no parent row at all** for PR21 (`menu_code=PROD_FG_STOCK_BREAKDOWN`, `is_active=true`)
— it's a true orphan, invisible in DIRECTOR's own sidebar today despite being active.
**Fix needed in the implementation pass:** insert a `menu_tree` row linking PR21 under
the Inventory parent menu, then rebuild the menu snapshot. Until then this page cannot
be reached by anyone, DIRECTOR included, regardless of any ACL grant.
