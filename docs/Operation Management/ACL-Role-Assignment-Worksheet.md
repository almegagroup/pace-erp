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

## Menu Groups (from live `erp_menu.menu_tree`, ACL universe, 2026-07-25)

| Group | Pages | Status |
|---|---|---|
| Procurement | 8 | ⬜ Not started |
| Receiving | 4 | ⬜ Not started |
| Returns & Claims | 3 | ⬜ Not started |
| Quality Assurance | 1 | ⬜ Not started |
| Sales | 2 | ⬜ Not started |
| Accounts | 4 | ⬜ Not started |
| Inventory | 6 | ⬜ Not started |
| Procurement Masters | 7 | ⬜ Not started |
| Operation Masters | 4 | ✅ Decided |
| Production | 21 | ⬜ Not started |
| HR — Attendance | 10 | ⬜ Not started |
| HR — Leave Management | 6 | ⬜ Not started |
| HR — Out-Work | 5 | ⬜ Not started |

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
