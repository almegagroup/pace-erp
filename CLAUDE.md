# PACE ERP — Claude Session Context (SSOT)

> এই file টা প্রতিটা নতুন Claude session এ automatically read হয়।
> নতুন session শুরুতে এই file পড়ে তারপর কাজ শুরু করো।

---

## 1. Claude কীভাবে এই project access করে

### Local Repo Access
- Claude সরাসরি `C:\Users\cpalm\Documents\pace-erp` folder এর সব file read/write করতে পারে
- এটা Claude Desktop এর trusted folder হিসেবে set করা আছে
- Config: `C:\Users\cpalm\AppData\Roaming\Claude\claude_desktop_config.json` → `localAgentModeTrustedFolders`

### Dev Supabase Access (MCP)
- Tool: `@supabase/mcp-server-supabase@latest`
- Protocol: MCP (Model Context Protocol) — Claude সরাসরি SQL execute করতে পারে
- **Dev Project ID:** `ytapuwiqicmvpanmzelb`
- PAT Name: `pace-erp-claude-mcp` (Supabase Dashboard → Account → Access Tokens)

### Prod Supabase Access
- Prod এ কাজ করতে হলে prod project ID দরকার (আলাদা project)
- Workflow: **dev তে কাজ করো → test করো → migration file বানাও → prod এ apply করো**
- Prod এ directly SQL execute করা হয় না, migration file দিয়ে করা হয়

### MCP Config Files (সব জায়গায় একই PAT থাকতে হবে)
| File | Purpose |
|------|---------|
| `C:\Users\cpalm\.claude.json` | **Primary source** (line ~607, mcpServers section) |
| `C:\Users\cpalm\AppData\Roaming\Claude\claude_desktop_config.json` | Claude Desktop global |
| `C:\Users\cpalm\Documents\pace-erp\.mcp.json` | Project-level |
| `C:\Users\cpalm\Documents\pace-erp\.claude\settings.json` | Project-level alternate |

> ⚠️ PAT rotate হলে সব ৪টা file update করো, তারপর Claude Code পুরো বন্ধ করে নতুন session খোলো।
> PAT value কখনো এই file এ লিখবে না।

---

## 2. Session শুরুতে সবসময় করো

```sql
-- MCP connection test
SELECT current_database(), now();
```

Unauthorized error এলে → user কে নতুন session খুলতে বলো (এই session এ MCP কাজ করবে না)।

---

## 3. আমরা কী কাজ করছি এবং কেন

PACE ERP-তে sidebar dynamically generate হয় user এর ACL (Access Control List) থেকে। একজন user কোন screen দেখবে সেটা নির্ভর করে:
- তার **Role** (DIRECTOR, L4_MANAGER... L1_USER)
- তার **Work Company** (কোন company-তে কাজ করছে)
- তার **Work Context** (runtime functional role — যেমন "HR Operations", "Plant Head")

ACL chain:
```
acl.menu_master
    ↓ (menu_code = resource_code join — CRITICAL)
erp_menu.menu_master
    ↓
capability_menu_actions → capabilities → work_context_capabilities → work_contexts → user
    ↓
generate_acl_snapshot()  →  precomputed_acl_view
    ↓
generate_menu_snapshot()  →  user_menu_snapshots
    ↓
Frontend Sidebar
```

---

## 4. এই Session (2026-06-01) এ কী কী হয়েছে

### A. ACL Full Setup — COMPLETE ✅
- `acl.menu_master`: 65টা correct ACL page entries (13টা stale GRP_ACL_* deleted)
- `acl.capabilities`, `acl.capability_menu_actions`, `acl.work_context_capabilities`: seeded
- `erp_acl.work_contexts`: DEPT_ prefix work contexts created for all companies
- `acl.acl_versions`: V1 created + captured for all 4 business companies
- `precomputed_acl_view`: generated for all companies + users
- `erp_menu.menu_snapshot`: generated for P0004, P0007, P0010, P0011, P0003, P0005

### B. Login Bug Fixes — DONE ✅
- `canonical_access.ts`: removed wrong DEPT_ filter in `resolveDefaultWorkContextId`
- `serviceRoleClient.ts`, `authClient.ts`, `login.handler.ts`: bare import → `@supabase/supabase-js`
- `supabase/functions/deno.json`: import map added (Deno resolves bare → npm:)
- Migration `20260601032731`: fix menu_snapshot constraint + generate_menu_snapshot version bug
- Migration `20260601032839`: fix menu_snapshot indices (work_context_id included)

### C. Users Login Status
- P0004 (DIRECTOR, 4 companies, MULTI mode): ✅ Login working, dashboard loading
- P0007 (L2_AUDITOR, CMP003): ✅ Setup done
- SA users: ✅ Always worked

### D. Gate-26 — VERIFIED ✅
- Business Master Governance: assertManagerOrSARole in 12 handlers ✅
- 8 frontend master pages + routes ✅
- Minor bug: DELIVERY_DATE enum mismatch in PaymentTermsMasterPage (non-blocking)

---

## 5. Current DB State (Exact)

### ✅ Complete
- `erp_menu.menu_master`: 64 rows
- `erp_menu.menu_tree`: 64 rows

### 🔴 Needs Fix
- `acl.menu_master`: 10 wrong entries (delete করে নতুন করে দিতে হবে)
- `acl.capabilities`: 0 rows
- `acl.capability_menu_actions`: 0 rows
- `erp_acl.work_contexts`: 0 rows
- `acl.work_context_capabilities`: 0 rows
- `erp_master.departments`: 0 rows
- `erp_master.projects`: 0 rows
- `erp_map.company_projects`: 0 rows
- `acl.module_registry`: 0 rows
- `acl.module_resource_map`: 0 rows
- `acl.acl_versions`: 0 rows

---

## 6. Next Action — ACL Full Setup (16 Steps)

### 🔴 Step 1 — এটা আগে করো: `acl.menu_master` fix

```sql
-- আগে column structure দেখো
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'acl' AND table_name = 'menu_master';

-- পুরনো entries দেখো
SELECT * FROM acl.menu_master;

-- erp_menu এর navigable pages দেখো
SELECT resource_code, menu_label, menu_group 
FROM erp_menu.menu_master ORDER BY display_order;

-- পুরনো entries delete করো
DELETE FROM acl.menu_master;

-- erp_menu থেকে 64টা page insert করো (menu_code = resource_code)
INSERT INTO acl.menu_master (menu_code, menu_name, ...)
SELECT resource_code, menu_label, ...
FROM erp_menu.menu_master WHERE ...; -- column structure দেখে exact SQL বানাও
```

### Step 2–16 (Detail)
`docs/ACL_SETUP_PROGRESS.md` দেখো — প্রতিটা step এর exact SQL সহ।

---

## 7. Workflow Plan (Dev → Prod)

1. **Dev তে কাজ করো** — MCP দিয়ে directly SQL execute (project: `ytapuwiqicmvpanmzelb`)
2. **Test করো** — generate_acl_snapshot + generate_menu_snapshot চালিয়ে verify করো
3. **Migration file বানাও** — `supabase/migrations/` folder এ
4. **Prod এ apply করো** — `supabase db push` বা prod project এ migration apply

---

## 8. Key Architecture Rules (Never Violate)

- `acl.menu_master.menu_code` MUST = `erp_menu.menu_master.resource_code`
- SA/GA always full access — cannot be denied
- Parent Company = HR only (leave, salary, identity)
- Work Company = operational scope
- Work Context = runtime functional role (menu recomputes when changed)
- Default Deny — permission না থাকলে access নেই
- Companion screens menu_master এ নেই — route-only

---

## 9. PACE ERP Build Layers — SAP Equivalent (Design Status)

PACE ERP টা SAP এর equivalent হিসেবে build হচ্ছে। মোট **10টা Layer (L1–L10)**। প্রতিটার design completeness:

| Layer | Scope | Design % | Status | Pending |
|-------|-------|----------|--------|---------|
| **L1 — Foundation** | Material Master, Storage Location, Stock Architecture, Movement Types | **95%** | ✅ Locked | Plant extension detail, FOR_REPROCESS variant |
| **L2 — Procurement** | Plan Mgmt, PO, Gate Entry, GRN, Vendor Master, Invoice Verification | **85%** | ✅ Core locked | Invoice Verification (35%), Procurement Planning-Powder (30%) |
| **L3 — Production & BOM** | Stroke System, Two-Order Model, Batch Number, BOM Design | **68%** | 🔶 Partial | Batch format (business owner to provide), BOM formal session needed |
| **L4 — Quality Management** | Inward QA, Lab results, MCT | **46%** | 🔴 Partial | **Formal L4 session required** |
| **L5 — Dispatch & Returns** | Dispatch Instruction, Returns | **51%** | 🔴 Partial | **Formal L5 session required** |
| **L6 — Plant Transfer** | One-step transfer | **57%** | 🔴 Partial | **Formal L6 session required** |
| **L7 — Physical Inventory & Reports** | PID Design | **52%** | 🔴 Partial | **Formal L7 session required** |
| **L8 — Costing** | Weighted Avg Engine, FOR_REPROCESS Valuation | **65%** | 🔶 Partial | Formal costing session needed post-L3 |
| **L9 — HR** | Leave, Out-Work, Attendance, Payroll | UI built, DB pending | 🔶 | ACL setup required |
| **L10 — Operation Type Templates** | LIQUID_ADMIX, POWDER, Company→Template mapping | **39%** | 🔴 Partial | **Gate-10A session required**, 12 companies need mapping |

### Go-Live Plan
- **Phase-1 (target: 1 July 2026):** L1 + L2 (core) + L3 + L5 + L6 + L9
- **Phase-2 (post go-live):** L4 enhancements, L7, L8 formal
- **Phase-3 (future):** Full FI/CO, bin-level WM, PM, GST API

### L2 Procurement — Partial Freeze Decision (LOCKED)
Core flow frozen, implement শুরু করো। দুটো gap আছে:
- **Invoice Verification** → basic shell বানাও, detail পরে fill করো
- **Procurement Planning (Powder)** → UI বানাও, formula পরে

### Overall Document Readiness: ~45%
- ✅ Fully designed & locked: ~30%
- 🔶 Designed but needs formal session: ~35%
- 🔴 Not yet formally discovered: ~35%

---

## 10. Operation Management — Document Structure

### Primary Documents (এগুলো আগে পড়ো)

| File | Purpose |
|------|---------|
| `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md` | **Master design doc** — সব L1-L10 এর full design এখানে |
| `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` | **Live implementation log** — Codex implement করে, Claude verify করে। Current status এখানে দেখো |
| `docs/Operation Management/implementation-specs/OM-CORRECTION-NOTES.md` | Bug fixes ও corrections |

### Gate Structure
প্রতিটা Gate এর জন্য দুটো file:
- `OM-GATE-XX-...-Spec.md` → DB/Backend/Frontend spec (Codex এর input)
- `CODEX-GATEXX-TASK-BRIEF.md` → Codex কে দেওয়ার জন্য task brief

### Layer → Gate Mapping
| Layer | Gate(s) | Scope |
|-------|---------|-------|
| L1 Foundation | Gate-11, 12 | erp_inventory schema, Material/UOM/Vendor masters |
| L2 Procurement | Gate-13, 13.1–13.9 | PO, CSN, Gate Entry, GRN, Inward QA, STO, RTV, Invoice, Sales |
| Backend | Gate-16.0–16.9 | Stock posting engine + all L2 backends |
| Frontend | Gate-17.1–17.9 | All L2 frontends |
| Number Series | Gate-18 | Document numbering |
| Opening Stock | Gate-19 | Initial stock load |
| Physical Inventory | Gate-20 | PID |
| Advanced | Gate-21–25 | Post go-live features |

### Current Implementation Status (as of 2026-05-26)

| Gate | Scope | Status |
|------|-------|--------|
| Gate-11 | Foundation DB (erp_inventory schema) | ✅ VERIFIED |
| Gate-12 | Master Data (material, vendor, customer, UOM) | ✅ VERIFIED |
| Gate-12B | Cost Center + Machine Master | ✅ VERIFIED |
| Gate-13.1–13.9 | L2 Procurement DB (PO, CSN, GRN, QA, STO, RTV, IV, Sales) | ✅ VERIFIED |
| Gate-14 | L1 Backend (TypeScript handlers) | ✅ VERIFIED |
| Gate-15, 15B, 15C | L1 Frontend (all screens) | ✅ VERIFIED |
| Gate-16.0–16.9 | Stock Posting Engine + all L2 Backends | ✅ VERIFIED |
| Gate-17.1–17.9 | All L2 Frontends | ✅ VERIFIED |
| Gate-18 | Number Series Overhaul | ✅ VERIFIED |
| Gate-19 | Opening Stock | ✅ VERIFIED |
| Gate-20 | Physical Inventory Document (PID) | ✅ VERIFIED |
| Gate-21 | Missing FE Pages (Debit Note, Exchange, Blocked IV, Gate Exit) | ✅ VERIFIED |
| Gate-22 | Procurement Planning View | ✅ VERIFIED |
| Gate-23 | Plant Transfer | ✅ VERIFIED |
| Gate-24 | Core Stock Reports (Stock Ledger, MMBE, Valuation) | ✅ VERIFIED |
| Gate-25 | Document Flow Tab (all detail pages) | ✅ VERIFIED |
| Gate-26 | Business Master Governance (7 masters to L2_MANAGER+) | ✅ VERIFIED |
| Gate-27 | FG Domain (BOM, Process Order, Admix/Powder, Dispatch) | 🔴 Design in progress |

**`OM-CORRECTION-NOTES.md`:** কোনো actual correction নেই (C-001 placeholder only)

**Next OM action:** Gate-27 design (feasibility doc Section 83) — FG Domain (BOM, Process Order, Admix/Powder, Dispatch)

---

## 11. Key Files

| File | Purpose |
|------|---------|
| `docs/ACL_SETUP_PROGRESS.md` | Full 16-step ACL setup plan with SQL |
| `docs/ACL_SSOT.md` | ACL architecture (LOCKED) |
| `docs/GATE_6_G0_ACL_AUTHORITY_LOCK.md` | Gate 6 lock |
| `docs/GATE_8_G1_SCREEN_REGISTRY.md` | Screen registry |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | 62 screens |
| `frontend/src/navigation/screens/projects/hrModule/hrScreens.js` | 26 screens |
| `frontend/src/navigation/routeIndex.js` | Companion routing |
| `supabase/migrations/` | Migration history |
