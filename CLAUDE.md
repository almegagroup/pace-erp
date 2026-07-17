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

## 4. এই Session (2026-06-12) এ কী কী হয়েছে

### A. tx_code Sidebar / Command Bar এ দেখাচ্ছিল না ✅ FIXED

**Root cause (2-step):**
1. `acl_runtime.ts` এর SA ও ACL SELECT string এ `tx_code` column ছিল না → snapshot JSON এ null
2. `.schema("erp_menu").rpc()` silently fail করে — PostgREST `erp_menu` schema expose করে না। RPC call error ছাড়াই ignored হত, snapshot rebuild হত না।

**Fix:**
- `public.rebuild_sa_menu_snapshot` ও `public.rebuild_acl_menu_snapshot` wrapper functions তৈরি (erp_menu.generate_menu_snapshot কে internally call করে)
- `acl_runtime.ts` এ SA ও ACL RPC call এ public wrappers use করা হয়েছে
- SELECT strings এ `tx_code` add করা হয়েছে
- Migration: `20260612043111_fix_menu_snapshot_rpc_public_wrappers.sql`
- Sidebar এ tx_code font size → 14px (MenuShell.jsx)

**Files changed:**
- `supabase/functions/api/_shared/acl_runtime.ts`
- `supabase/migrations/20260612043111_fix_menu_snapshot_rpc_public_wrappers.sql`
- `frontend/src/layout/MenuShell.jsx`

---

### B. Inactivity Lock দেরিতে আসছিল / আসছিল না ✅ FIXED

**Root cause:** `SessionWatchdog.jsx` এ `visibilitychange` listener `recordUserActivity()` call করত → tab এ ফিরলেই idle clock reset → lock কখনো fire করত না।

**Secondary:** Browser background tab এ `setInterval` throttle করে → probe অনেক দেরিতে fire হত।

**Fix:**
- `visibilitychange` থেকে `recordUserActivity()` সরানো হয়েছে
- Tab visible হলে `lastPassiveProbeAtRef.current = 0` + immediate `tick()` call → background throttling bypass হয়

**File changed:** `frontend/src/components/SessionWatchdog.jsx`

---

### C. OM02 Storage Locations Page — Full Redesign ✅ DONE

**2-tab layout:**
- **Tab 1 — Locations:** Row-click inline edit (name + type), activate/deactivate toggle per row, friendly errors, create form on right
- **Tab 2 — Plant Assignments:** Company + Plant dropdown → assigned locations list (checkbox multi-remove) + unassigned list (checkbox multi-assign)

**Backend (4 new handlers):** update, toggle, list-plant-assignments, unmap
**Routes:** PATCH/POST/GET/POST new endpoints in om.routes.ts
**Frontend:** omApi.js +4 functions, SAOmStorageLocations.jsx full rewrite

**Commit:** `c0526bc` — pushed to `dev`

---

## 4-old. পূর্ববর্তী Session (2026-06-01) এ কী কী হয়েছিল

### A. Bug Fix 1 — Login 403 for ACL Users ✅ FIXED

**Root cause:** `resolveDefaultWorkContextId` (canonical_access.ts) এ একটা filter ছিল:
```typescript
return wc?.is_active === true && !wc.work_context_code?.startsWith("DEPT_");
```
সব work context `DEPT_*` prefix এ তৈরি হয়েছিল → filter সব বাদ দিত → null return → 403।
SA login হতো কারণ SA work context resolution skip করে।

**Fix:** `!wc.work_context_code?.startsWith("DEPT_")` condition সরানো হয়েছে।

**Files changed:**
- `supabase/functions/api/_shared/canonical_access.ts` — DEPT_ filter removed

---

### B. Bug Fix 2 — Render Backend Crash (npm: import) ✅ FIXED

**Root cause:** Previous fix added `npm:@supabase/supabase-js` prefix (Deno requires it).
Render এর Node.js server same files import করে → `Cannot find module 'npm:@supabase/supabase-js'` crash।

**Fix:** `supabase/functions/deno.json` import map তৈরি করা হয়েছে:
```json
{ "imports": { "@supabase/supabase-js": "npm:@supabase/supabase-js" } }
```
Deno import map দিয়ে resolve করে। Node.js bare import থেকে node_modules নেয়।

**Files changed:**
- `supabase/functions/deno.json` — new file, import map
- `supabase/functions/api/_shared/serviceRoleClient.ts` — bare import restored
- `supabase/functions/api/_core/auth/authClient.ts` — bare import restored
- `supabase/functions/api/_core/auth/login.handler.ts` — bare import restored

---

### C. Bug Fix 3 — Dashboard Blank (menu_snapshot work_context_id) ✅ FIXED

**Root cause (chain of 2 issues):**

**Issue 1 — Unique constraint missing work_context_id:**
পুরনো 3-param `generate_menu_snapshot` সব ACL rows এ `work_context_id = NULL` store করত।
নতুন 4-param version `work_context_id = UUID` দিয়ে insert করতে গেলে:
- version calculation শুধু নিজের UUID এর rows count করত → সবসময় version 1
- Old NULL rows ও version 1 এ আছে
- Unique constraint `(user_id, company_id, universe, snapshot_version, menu_code)` → conflict
- INSERT fail → session snapshot তে 0 rows → dashboard blank

**Issue 2 — generate_menu_snapshot version calculation bug:**
4-param function এ version query তে `AND work_context_id = p_work_context_id` ছিল।
Multiple work contexts একই company তে version collision করত।

**Fix:**
- Migration `20260601032731`:
  - DELETE stale NULL work_context_id ACL rows
  - DROP old `ux_menu_snapshot_acl` constraint
  - CREATE new partial indices: SA (no work_context), ACL (with work_context_id)
  - FIX 4-param `generate_menu_snapshot`: version query এ `work_context_id` filter সরানো
- Migration `20260601032839`: corrective drop+recreate (IF NOT EXISTS স্কিপ করেছিল বলে)

---

### D. Migration Naming Fix ✅ FIXED

**Root cause:** MCP `apply_migration` tool remote DB-তে নিজের timestamp (032731, 032839) দিয়ে record করে।
Local files এ আমরা 000001, 000002 দিয়েছিলাম → `supabase db push` error:
`Remote migration versions not found in local migrations directory`

**Fix:** Local files rename করা হয়েছে remote timestamp এ মেলাতে।

---

### E. Users Current Login Status

| User | Role | Companies | Work Contexts | Login |
|------|------|-----------|---------------|-------|
| SA/GA users | SA/GA | — | — | ✅ সবসময় |
| P0004 | DIRECTOR | 4 | 4 (DEPT_*) | ✅ Working, GLOBAL_ACL MULTI mode |
| P0007 | L2_AUDITOR | 1 (CMP003) | 1 | ✅ Working |
| P0003 | L1_USER | 1 | 1 | ✅ Setup done |
| P0005 | L2_USER | 1 | 1 | ✅ Setup done |
| P0010 | L3_MANAGER | 4 | 4 | ✅ Setup done |
| P0011 | L4_USER | 1 | 1 | ✅ Setup done |
| P0006 | L2_MANAGER | 1 | **0** | ❌ Work context নেই |
| P0008 | L3_USER | 1 | **0** | ❌ Work context নেই |
| P0009 | L4_MANAGER | 2 | **0** | ❌ Work context নেই |
| P0002 | L1_AUDITOR | **0** | **0** | ❌ Company + work context নেই |
| P0001 | DIRECTOR | 4 | 0 | ⚠️ Intentionally skipped |

---

### F. Gate-26 — VERIFIED ✅
- `assertManagerOrSARole` — 6 roles correct (SA, GA, DIRECTOR, L4_MANAGER, L3_MANAGER, L2_MANAGER)
- 12টা write handler সব `assertManagerOrSARole` use করে
- 8টা frontend master page (26.2–26.9) exist + AppRouter তে lazy import + Route wired
- 8টা PROC_*_MASTER screen code operationScreens.js এ
- ⚠️ Minor bug: `PaymentTermsMasterPage` এ `DELIVERY_DATE` dropdown option আছে কিন্তু backend `REFERENCE_DATES` set এ নেই → validation fail। Fix পরে করতে হবে।

---

## 5. Current DB State (2026-06-01)

### ✅ Complete
- `erp_menu.menu_master`: 65 rows (64 navigable pages + 9 groups — ACL universe)
- `erp_menu.menu_tree`: 64 rows
- `acl.menu_master`: 65 rows (resource_code = menu_code — correct mapping)
- `acl.capabilities`: seeded (CAP_STORES, CAP_SUPPLY_CHAIN, CAP_HR_ADMIN, CAP_HR_ATTENDANCE, etc.)
- `acl.capability_menu_actions`: seeded
- `erp_acl.work_contexts`: DEPT_ prefix work contexts for all 4 companies
- `acl.work_context_capabilities`: seeded for all relevant work contexts
- `acl.acl_versions`: V1 active + source_captured for all 4 business companies
- `acl.precomputed_acl_view`: generated for all companies + assigned users
- `erp_menu.menu_snapshot`: generated with `work_context_id` (4-param function, correct)
- `erp_cache.session_menu_snapshot`: GLOBAL_ACL for P0004 working

### ⚠️ Incomplete (login হবে না)
- P0006, P0008, P0009: `erp_acl.user_work_contexts` তে entry নেই → login করলে 403
- P0002: `erp_map.user_companies` তে entry নেই → company assignment সহ work context দিতে হবে

---

## 6. Next Actions

### 🔴 Immediate — Remaining User Setup
P0006, P0008, P0009, P0002 এর work context assign করতে হবে।
প্রতিটার জন্য:
1. `erp_acl.user_work_contexts` এ entry দাও (correct DEPT_ work_context_id)
2. `generate_menu_snapshot` চালাও (4-param)
3. Login test করো

### 🔶 Page Review — OM03 পর্যন্ত
OM02 ✅ done (2026-06-12). এরপর OM03 (Number Series), OM04, OM05... page by page review করতে হবে।

### 🔶 Minor Bug Fix
`PaymentTermsMasterPage.jsx` এ `REFERENCE_DATE_OPTIONS` fix করো:
```javascript
// Wrong:
const REFERENCE_DATE_OPTIONS = ["INVOICE_DATE", "DELIVERY_DATE"];
// Correct (match backend REFERENCE_DATES set):
const REFERENCE_DATE_OPTIONS = ["INVOICE_DATE", "GRN_DATE", "BL_DATE", "SHIPMENT_DATE", "N_A"];
```

### 🔴 Next OM Gate — Gate-27
L3 Production design — **Liquid first** (Admix + Hypershot + IWC), Powder পরে।
Reference: feasibility doc Section 83 (Admix/Liquid discovery — IN PROGRESS)
Scope: Stroke Master, Process PO, Packing PO, FG Declaration, Machine Assignment, FG Receipt, FG QA, P231/P232/P267/P268 movement types।

**Design strategy (2026-06-02 session decision):**
- Admix, Hypershot, IWC — পুরো design + implement আগে
- Powder — পরে (separate go-live, separate opening stock at Powder go-live date)
- L1/L2 reform/polish — সব layer implement হওয়ার পরে একসাথে করবো (consistency এর জন্য)

**L1/L2 Liquid readiness:**
- Material Master: ✅ shade_code, pack_code, external_sku, production_mode সব আছে
- L2 Procurement (RM/PM): ✅ 100% ready, কোনো change লাগবে না
- Missing movement types: ❌ P231/P232 (FG Receipt/Reversal), P267/P268 (FOR_REPROCESS → Production/Reversal) — Gate-27 এ add করতে হবে

**Go-live plan:**
- 1 July 2026: Liquid (Admix/Hypershot/IWC) RM+PM+FG opening stock দিয়ে শুরু
- Powder: পরে আলাদা go-live date এ Powder এর physical count দিয়ে opening দেবো

**Gate-27 Design Progress:**

| Session | Date | কী হলো |
|---------|------|--------|
| General Admix Concept Session | 2026-06-08 | পুরো Admix business mechanism বোঝানো হলো। Foundation locked। Feasibility doc updated। |
| Formal Section Lock Session 1 | 2026-06-09 | 83.1–83.5 locked, 83.7/83.14/83.17 updated, 83.4 major revision |
| Formal Section Lock Session 2 | 2026-06-10 | 83.4 production cycle locked, MTEST/PTEST added, batch number rules locked |
| Formal Section Lock Session 3 | 2026-06-11 | 83.4 storage location + SAP equivalent locked, 83.18 Plan Feed page locked |

**2026-06-09/10 Sessions — Decisions Locked:**

**83.1 — Order Number Structure (LOCKED):**
- FO linking to Packing PO happens POST-VERIFY (after internal confirmation) — not at creation
- SO links to FO (not Packing PO directly) — at SO creation time in system
- Balance Packing PO → no FO link (PACE internal stock)
- FO cancel → delink all Packing POs → cancel → re-link with new FO if needed

**83.2 — Production Types (LOCKED):**
- Admix = MTO, Hypershot = HPS, IWC+Powder = MTS
- Universal: Two-Order Model, Standard→Final→Verify, Process↔Packing link
- Dispatch unit: Admix=Packing PO, HPS=Batch+qty, IWC=SKU+qty
- HPS SO: batch-specific allocation, FIFO suggested, partial allowed

**83.3 — Stroke Master (LOCKED):**
- Header: Prodshade, Description, Stroke Number (numeric only), Created by/date
- RM lines: RM + alternate + Dosage% (same RM can appear twice)
- Validation: Prodshade+Stroke combo unique, Dosage total must = 100
- QA creates → Manager reviews+edits → Manager Save = Approved

**83.4 — Process PO / Packing PO (MAJOR UPDATE):**
- **PO Types:** MTO, HPS, MTS, INT, MTEST (Process) | PMTO, PHPS, PMTS, PTEST (Packing)
- **MTEST/PTEST:** AP test batches (5-10kg), no stroke/BOM, fully manual, one-step cycle, Pack Code 001
- **Production Cycle:** Standard → QA Online Approval → [Start Batch] → Final → Verify
- **QA Approval:** Between Standard and Final — checks SKU/Stroke/Qty. Approve=proceed, Reject=PO locked
- **Start Batch:** Production clicks button post-QA approval → Batch Number generated (FIFO, per company)
- **Batch Number generation timing:** At "Start Batch" click (not Standard, not QA approval)
- **Final:** Actual qty entry. Can add items. Cannot remove (enter 0). No stock movement.
- **Verify:** QA confirms actuals vs batch paper. Can edit qty, add items. Wrong formulation = prune+redo. Stock movement HERE (P261+PM+P231).
- **Reversal:** Step-by-step from any stage back to beginning
- **Availability check at PO creation:** Unrestricted stock only (no In-Transit, no QA). Exception: INT planned output for INT materials.
- **Pack Type Change:** Delink → PRUNE → new Packing PO → relink (corrected from "auto-delete")
- **SO → FO link** (corrected: SO links to FO, not Packing PO)

**83.5 — Intermediate RM (LOCKED):**
- Caustic Flakes + Water → Caustic Liquid (INT) — dual source (internal + purchased)
- Simple cycle, no Standard/Final/Verify, no batch number
- INT PO planned output counts as available for FG PO at Standard (prevents negative stock)
- Hard check at Final: INT must be completed before FG PO can go to Final

**83.7 — Batch Number Rules (LOCKED — 2026-06-10 final):**
- MTO: Company level, SA configures Prefix+Count (all Admix Prodshades share one series)
- HPS: **Per Prodshade**, SA configures Prefix+Count per Prodshade (same structure as IWC)
- IWC: **Per Prodshade**, SA configures Prefix+Count per Prodshade
- Powder: Manual entry by user (no system generation)
- MTEST: Company level, custom Prefix+Count
- Reset: per financial year, per company

**83.14 — Barrel Mechanics (UPDATED):**
- "Order qty always divisible" rule REMOVED
- Balance barrel = separate Packing PO (same 599, lower fill qty) — no FO link
- Fill qty per barrel = mandatory field on every Packing PO with 599

**83.17 — Pack Code Master + Prodshade Pack Config (NEW — LOCKED):**
- Pack codes: 599 (barrel, per barrel), 510 (IBC, per KG), 000 (tanker, per KG), 001 (MTEST only)
- Prodshade Pack Config: Company + Prodshade level — Manager (Admix) or SA (others)
- Config page: add/edit/delete pack codes + fill sizes per Prodshade
- Prerequisite: config must exist before Process PO can be created

**83.18 — Plan Feed Page (NEW — LOCKED — 2026-06-11):**
- 3-tab page: Plan Feed (create) | Plan Edit | Total Table (summary)
- Tab 1 — Create: FO Number (manual), Party (select or inline create), SKU, Description, Ordered Qty (KG), Pack Qty, Order Date, Scheduled Delivery Date
- Tab 2 — Edit: FO Number lookup → edit all fields → cancel order; edit-locked once Process PO exists
- Tab 3 — Summary: 10 separate columns — FO Number, Party Name, SKU, Description, Ordered Qty (KG), Pack Qty, KG Linked to Packing POs, Packing PO Count (clickable modal → PO list + Process PO + Batch + Qty), Dispatched Qty, Pending Dispatch
- Summary rows sorted by Order Date + Scheduled Delivery Date; live updates; pagination; smart filters

**83.4 — Storage Location Integration (LOCKED — 2026-06-11):**
- Production Segment Location Config: company + segment → rm_sloc, pm_sloc, shopfloor_sloc, fg_sloc
- Verify এ: P261 (RM from rm_sloc) + P261 (PM from pm_sloc) + P231 (FG → shopfloor_sloc S003)
- P261 issue location: default = segment config, override allowed at Standard phase (cross-segment materials)
- GRN landing: default = material_plant_ext.default_storage_location_id, Stores can override at GR time
- S003 → F003 transfer: per Packing PO qty, FO link doesn't matter
- F003 stock: Material + Batch + Packing PO ref + FO ref + Qty
- FO ref on F003 stock populated when Packing PO gets FO link (before or after transfer)

**83.4 — SAP Equivalent (LOCKED — 2026-06-11):**
- ZCoR1 = Standard, ZCoR2 = edit/pruning, COR6 = Final+Verify, COID = PO list, CORS = reversal, ZBatVar = qty variance only
- Activity confirmation → Section 104 defer
- Individual RM/PM reversal → P262 from COR6 equivalent
- Shop floor print → not required

**104.7 — Costing Scenario Discovery (2026-06-29 — NOT LOCKED):**
- Core principle (directional): Stock Layer always shows 100% physical actual; Reco Layer (AP recognition/billing) entirely separate, never adjusts stock
- Scenario 3 (unapproved deviation mixed into current dispatch, e.g. mistake+correction inflating output) — OPEN, no resolution. Needs Accounts/Commercial + possibly Asian Paints alignment
- Scenario 4 (small separable excess, e.g. 5-50kg) — tentative: deferred recognition via Salvage stock, not a loss
- RM-line approval status (Approved/Unapproved per deviation) — NOT rule-based, explicit manual tracking, workflow undecided
- Cross-PO RM/PM derivation (Process PO batch → multiple Packing POs) — resolved: ratio of qty drawn ÷ batch total
- See feasibility doc Section 104.7 for full detail — full costing session still required

**83.15 — Pack BOM is company-wise + mandatory OUTPUT/INPUT rows (LOCKED — 2026-07-11, corrects "global" assumption):**
- Pack BOM (PR05-08) is company-scoped after all — the OUTPUT row's Storage Location is company-specific, one global BOM per SKU can't carry a single location value across companies. `pack_bom` needs `company_id`; unique key becomes (company_id, sku_material_id). Prodshade Pack Config (OM08 Tab 2) stays global — only Pack BOM itself moved to company-wise
- OUTPUT (SKU) and INPUT (SFG/Prodshade) rows are mandatory and auto-populated in every Pack BOM regardless of BOM Required Yes/No — only PM lines are optional/zero for 599/000/001. Previously my PackBomCreatePage.jsx implementation never created the SFG INPUT row at all — real gap, not yet fixed
- SFG material for a given SKU is derived by matching the SKU's own shade_code+pack_code against prodshade_pack_config -> linked Prodshade material (no direct FK exists on material_master)
- ~~OUTPUT row Storage Location is user-entered~~ **Corrected 2026-07-13 — see full lock below:** OUTPUT row is F0xx (Finished Goods) location, user-picks from that SKU's own mapped F-prefixed locations, not a free entry. INPUT (SFG) row Storage Location stays read-only, pulled from that Prodshade's Stroke Master Default Storage Location (mandatory since 83.3) — unchanged.
- Movement types: OUTPUT=P101, INPUT(SFG)=P261 (both already-existing codes, no new ones)

**83.15 — Pack BOM Full Design Lock, session 2 (LOCKED — 2026-07-13, resolves SKU sourcing, storage location, UOM conversion, batch/lot granularity):**
- **Page 1 flow (mirrors PR09/Process PO pattern):** Company (TransactionCompanySelector) → Type (MTO/HPS/MTS/MTEST) → Packing PO Type auto-resolves (PMTO/PHPS/PMTS/PTEST) → FG SKU dropdown filtered by (a) company-mapped via `material_plant_ext` and (b) Type-matched via that company's `stroke_master.po_type` for the SKU's underlying Prodshade
- **SKU↔Company mapping:** reuses the existing generic Material Detail Page "Plant Extension" flow (`extendMaterialToPlantHandler` → `erp_master.material_plant_ext`) — same mechanism as RM/PM, no new endpoint. Explicit/manual per company, NOT auto-inherited from the Prodshade's own plant extensions.
- **OUTPUT (FG) storage location — corrected:** NOT free-entry. User picks from that SKU's own **F-prefixed** (`F001`/`F002`/`F003`...) `material_plant_ext` rows for the selected company; auto-select with no dropdown if exactly one F-location is mapped. This is the same F0xx "Finished Goods Store" location family already defined in §83.1 (2026-06-11, "F003 stock record"). Replaces the older vague "S003 → F003 Transfer" step (§83.2 diagrams, 2026-06-11) — that transfer *is* Packing PO Final's own posting: P261 (SFG issue, from the automatic Stroke-default S0xx location) + P101 (FG receipt, into the user-picked F0xx location), both in one transaction, no separate transfer movement.
- **Base UOM for every FG SKU = KG, always** — verified in code (`pack_config.handlers.ts`'s `ensureFgMaterialForConfig`, hardcoded), no exception even for flexible-fill 599/000/001 (their outer unit — Barrel/Tanker — is never the Base UOM).
- **Conversion factor placement:** lives on the FG SKU's own `material_uom_conversion` (Material Master UOM Conversion tab) — never on `pack_code_master`, since the outer-pack-unit→KG ratio is density/product-specific, not pack-code-specific. System has **no multi-hop/chain conversion resolution anywhere** (verified — same single-hop pattern as `stroke_master.conversion_uom_code`+`conversion_factor`); any real-world multi-layer conversion must be pre-collapsed into one direct factor by whoever enters it.
- **`pack_code_master` gap (flagged, not yet built):** needs a new `outer_uom_code` column (BTL/JAR/CTN/IBC/BBL/DRUM/PKT/TANKER — one fixed code per pack code) so Pack BOM's OUTPUT row and the SKU's own conversion row can reference the same UOM code. Only the **outermost/dispatch unit** is stored here regardless of how many inner packaging layers exist (e.g. 20×1KG pouches inside one 20KG bag) — inner layers are captured purely as Pack BOM PM lines (their own material, own base UOM=EA, no UOM-hierarchy needed), never added to `pack_code_master`.
- **Pack BOM → Material Master conversion auto-sync (new mechanism, not yet built):**
  - `BOM Required=Yes` → PR06 Approve auto-writes a **fixed** `material_uom_conversion` row on the SKU (`variable_conversion=false`), factor derived straight from that Pack BOM's own SFG INPUT qty (OUTPUT qty is always 1 for these types) — e.g. 20 KG SFG per bag → BAG→KG factor=20.
  - New PM-line flag **"Is Primary Container?"** (Yes/No) on Pack BOM's PM lines — Yes-flagged lines (e.g. Pouch, inner bottle — anything that directly holds product) also get an auto-derived secondary conversion row (factor = SFG qty ÷ that PM line's qty); No-flagged lines (Label, Cap) never do.
  - `BOM Required=No` (599/000/001) → PR05 auto-ACTIVE writes only a **`variable_conversion=true`** flag row on the SKU, no fixed factor value — the real per-instance ratio lives solely on that specific Packing PO's own `fill_qty_per_pack`/`num_packs` (already-existing columns), never centralized on the material.
  - BOM Required Yes/No lookup for any of the above: `material_master` has no own column for this — join `material_master.pack_code` → `erp_production.pack_code_master.pack_code` → `bom_required` (verified working against live Dev data).
- **FG batch/lot identity (MTO/HPS/MTEST — MTS has no variable-fill issue, out of scope here):**
  - `stock_ledger.batch_number` stays = the parent **Process PO's** batch_number, unchanged — required for AP/QA recognizability, can never be swapped for a Packing PO number.
  - Granular per-fill-group breakdown (e.g. 2 barrels @230KG vs 1 barrel @115KG from the same Process batch) uses the **already-mandatory** `stock_document.document_number` (§8C) = that specific **Packing PO's own `po_number`** — no new column or series needed.
  - **Real gap found:** `stock_snapshot` never splits by batch — both `post_stock_movement()` overloads hardcode `batch_id IS NULL` in the snapshot lookup/upsert, so there is only one blended running total per (company, location, material, stock_type); no per-batch balance is cached anywhere. **Decision: leave as-is** (derive per-batch balance on demand by summing `stock_ledger` rows filtered by `batch_number`) — extending `stock_snapshot` to also split by batch is a core §8C engine change affecting RM/PM/SFG/INT too, deferred until a real performance need arises.
  - **FG stock breakdown report** (our MMBE/ZMB51 equivalent): `stock_ledger` (P101 IN rows) JOIN `stock_document` (`document_number`) JOIN `packing_order` (`po_number` match, for `num_packs`/`fill_qty_per_pack`), grouped by `batch_number` — this exact shape was already envisioned in §83.1 (2026-06-30, "F003 Stock Record — Container Count" table); this session re-derived and confirmed the join path from first principles. The **same query/table doubles as the future Dispatch (L5) selection UI** (pick a barrel-group to dispatch by count) — build once, reuse both places. Per-Packing-PO-group remaining-balance-after-partial-dispatch is deferred to the formal L5 session; the underlying linkage (batch_number + document_number) is already schema-compatible.
  - **Packing PO Final — 3-movement posting, real gap closed:** verified current `packing_order.handlers.ts` posts **only** PM issue (P261) at Final — no SFG issue, no FG receipt, ever. Fix: Final posts all three in one transaction — SFG issue (P261 OUT, from Pack BOM INPUT row's S0xx) + PM issue (P261 OUT, per line) + FG receipt (P101 IN, into Pack BOM OUTPUT row's F0xx) — all sharing `document_number=po_number` + `batch_number`=parent Process PO's batch (via the Gate-27.19 batch-aware overload, unused in this file today).
  - **Matching CORS reversal:** must reverse all 3 (today only reverses PM) — SFG via P262 (existing pairing), FG via P102 (existing §83.4 pairing), each tied back via `reversalOfId`.
  - **SO↔FO chain:** FO↔Packing PO link already exists (`packing_order.plan_feed_id` → `erp_production.plan_feed`, which holds `fo_number`) — but **SO↔FO does not exist yet** in `erp_procurement.sales_order_line` (no `fo_id`/`fo_number` column; that table is still the legacy pre-Gate-27 L2 Sales schema). Deferred to the formal Dispatch (L5) design session.
- **PID for FG batches:** not formally designed — deferred together with Opening Stock (MTO/HPS/MTEST), same as before. This session only sketched a direction (count/enter at batch level; book qty = on-demand ledger-sum for that batch; variance posts tagged to the same batch_number; no Packing-PO-level attribution needed at count time) — **not locked**, revisit at that formal session.
- **Non-Fixed pack code (599/000/001) reconfirmed:** no PR06 approval ever — PR05 save goes straight to ACTIVE, immediately usable by Packing PO (this was already locked 2026-06-30; today's session just reconfirmed it holds under the company-wise + auto-sync changes above).
- **Packing PO has no Verify step** (reconfirms the existing lock — CLAUDE.md §6 "Sequencing locked 2026-07-11" line + feasibility doc §83.4 "Verify phase (Process PO only — Packing PO has no Verify)"). Lifecycle is Create(Standard)→Final only. Feasibility doc §83.4's TX-code scope note ("PR09/PR11/PR12/PR15 serve both Process PO and Packing PO") is superseded for PR12 specifically — **PR12/Verify is Process-PO-only**. If a "Packing PO Verify"-named page/route already exists in code, repurpose it under a different name rather than deleting it. Post-Final corrections for Packing PO use the same COR6 (add/edit lines) + CORS (full reversal) pattern family as Process PO — no Verify stage involved.

**83.4 — Packing PO FG receipt reuses P101/P102, no new P231/P232 codes (LOCKED — 2026-07-11):**
- Corrected across the whole feasibility doc (13 occurrences, several sections predating this session): Packing PO's FG receipt at Final was documented as movement type "P231" with a "P232" reversal — neither code exists in `movement_type_master` and was never going to be created. Reuses existing P101 (receipt)/P102 (reversal), same codes Process PO's SFG output and INT's output already use
- Packing PO's FG receipt is one of the already-locked P101 QI-hold exceptions (posts straight to Unrestricted, no P321 needed) — this correction doesn't change that
- Old "New movement types needed: P231/P232" notes from earlier discovery sessions (2026-06-01/02) struck through with a correction annotation rather than deleted, per doc-history convention

**83.4 — Process PO FO field removed, MTEST lifecycle, SFG Result Recording (LOCKED — 2026-07-11):**
- Process PO header does NOT carry any FO reference (not even informal) — corrects the earlier "FO number = informal reference at creation" text. FO link exists only on Packing PO
- MTEST confirmed single-action like INT (no Standard/Final/Verify stages) — but unlike INT, MTEST DOES get a batch number (company-level, at that single save)
- SFG Result Recording page = exact identical mechanism to the existing Inward QA page (same qa_test_method_master/qa_category_test_config infra, same workflow) — build as a direct clone, not a fresh design
- STO/Location Transfer reservation implementation details deferred to later

**83.4 — process_order_line_reco write timing = Verify only (LOCKED — 2026-07-11):**
- Final's draft entry (Actual Qty, Approved toggle) lives as draft columns on process_order_line itself (needs approved_status/ap_approved_qty/variance_qty added — actual_qty already exists on that table), still editable by QA at Verify
- process_order_line_reco only gets written when Verify actually saves/posts stock — Final never writes to it
- Final page's header auto-sum reads from process_order_line's draft columns; only switches to reading process_order_line_reco once status = VERIFIED

**83.4 — CORS reversal set + process_order_line_reco append behavior (LOCKED — 2026-07-11):**
- VERIFIED->STANDARD CORS now reverses 3 movements (P262, then P322 Unrestricted->QA, then P102) not 2 — original 2026-07-04 design predates the P321 usage-decision step
- process_order_line_reco is append-on-CORS, not reset-in-place: existing rows get is_voided=true/voided_at set (history preserved), a fresh Final/Verify run inserts new rows. Reporting filters is_voided=false; audit can see all attempts. Matches the "nothing truly deleted" principle used for Prune/soft-reject/RELEASED batch numbers

**83.4 — process_order_line_reco table for Reco/Costing layer (LOCKED — 2026-07-11):**
- stock_ledger has no "Approved"/"AP Approved Qty" concept — Reco/Costing needs its own table
- One data-entry action (Final/Verify/COR6 Correction) writes both universes at once: Actual -> stock_ledger, AP Approved -> process_order_line_reco
- Fully denormalized/flat (COID-style) — company/po_number/batch_number/po_type/prodshade/stroke/machine/segment duplicated onto every line row, no joins needed for Reco reporting
- No dedicated OUTPUT row — Actual Output/AP Approved/Variance are always SUM() of INPUT rows
- Directly feeds the 104.7 cross-PO derivation formula (ratio of qty drawn ÷ batch total) for dispatch-level costing

**83.5 — Stock check severity per stage (LOCKED — 2026-07-11, deliberately stricter than SAP):**
- Standard: hard block if any line short on Available (Unrestricted@location − open reservations) vs Standard Qty — SAP's default is a soft warning that still allows save, we chose stricter to stop unnecessary Process Orders being created
- Final: hard block only for INT shortfall (linked INT PO must be VERIFIED, not just planned) — no general RM/PM re-check, already physically consumed by then
- Verify (P261): DB/ledger hard block, no negative stock — matches SAP's real enforcement point (Goods Issue), non-negotiable

**83.4 — Verify Usage Decision = P321 (LOCKED — 2026-07-11):**
- MTO/HPS/MTS Verify posts 3 ledger entries in one transaction: P261 (RM/PM/INT issue) → P101 (SFG receipt IN to QUALITY_INSPECTION) → P321 "QA → Unrestricted" (auto-release, same code Inward QA's Release decision uses)
- INT/MTEST skip P321 — their P101 targets Unrestricted directly
- Deferred/not designed: QA later routing a partial qty to Blocked instead (P323/P344) — acknowledged, doesn't change the P321 design

**83.5 — Reservation sources + 101 QI-hold exceptions (LOCKED — 2026-07-11):**
- Reservation now keyed by material+plant+**storage location** (not just material+plant)
- 5 reservation sources resolved: Process PO (Standard→Verify), Packing PO (Standard-equiv→Final), Sales Order (Dispatch Instruction created→P601), STO (same Dispatch Instruction doc type→P601), Location Transfer/P311 (created→posted)
- P101 (production output receipt) defaults to QUALITY_INSPECTION per movement_type_master — applies to MTO/HPS/MTS SFG output. Exceptions posting straight to Unrestricted: INT, MTEST, Packing PO's FG(SKU) receipt
- MTO/HPS/MTS: no separate QA-release screen — Verify (PR12) IS the QA action, so QI→Unrestricted auto-releases in the same transaction. Still need a separate "SFG Result Recording" page for lab/quality test results (backlog, not yet designed — likely reuses qa_test_method_master/qa_category_test_config)
- INT has NO batch number, NO Standard/Final/Verify — single-page create+complete action (confirmed: uses Stroke like MTO/HPS, Machine mandatory, output storage location = Stroke's own default_storage_location_id, movement type reuses P101)

**83.5-addendum — Packing PO Reservation, batch-specific SFG (LOCKED — 2026-07-13):**
- PM lines: generic `(material_id, storage_location_id)` reservation, identical to Process PO — no change.
- SFG line: **must be batch-specific** — `reservation_document.batch_number` column added (migration `20260713110000_gate27_24_reservation_batch_number.sql`, applied to Dev) — a Packing PO draws from one specific existing Process PO batch, not a generic pool, so material+location alone would let it reserve against the wrong batch.
- Availability check for the SFG line must filter both the `stock_ledger` sum and the open-reservation subtraction by that `batch_number`, not just material+location.
- Multiple Packing POs routinely share one Process PO batch (§83.14 "balance barrel = separate PO") — the batch-aware check must sum *all* open SFG reservations for that batch across every Packing PO drawing from it, not just the one being created.
- Lifecycle: 2 states only — OPEN at create, CLOSED at Final (no QA gate, matches "Packing PO has no Verify").
- COR6 (post-Final correction) needs a fresh batch-level check that Process PO's own COR6 never needed — `stock_snapshot` doesn't split by batch, so the ledger's generic negative-stock guard can't catch a batch-specific overdraw (could silently push one batch negative while borrowing from a sibling batch at the same location). Not yet implemented — reservation engine itself still needs building (see feasibility doc's "Packing PO Reservation — Batch-Specific SFG Line" subsection, inside §83.4, for full detail).

**83.4 — Two-layer Stock vs AP Reco/Costing model (LOCKED — 2026-07-11):**
- Corrects an earlier three-way split: Costing is NOT a separate layer from AP Reco — "costing" in this business means what gets billed/recognized to Asian Paints (APL), so Costing = Reco
- **Stock/Physical layer:** Actual Material (post-substitution) + Actual Qty (full physical, matches P261) — never filtered by approval
- **AP Reco = Costing layer:** Formulation Material (always, ignores substitution) + AP Approved Qty (from Yes/No/Partial toggle) — this is what APL is billed for
- The gap between the two layers (material substitution cost diff + qty variance) is entirely PACE's own exposure, never passed to APL — rate/booking mechanics for this gap still NOT locked, ties into open 104.7 scenarios, needs dedicated Section 104 session

**83.3 — Default Storage Location mandatory + auto-prefill (LOCKED — 2026-07-11):**
- `default_storage_location_id` on Stroke Master header is now mandatory for both SFG and INT — was optional, most existing strokes ended up NULL (found via live DB check on CMP003: 4 of 5 APPROVED strokes had NULL header storage location, would silently break Verify-phase P101 posting)
- Auto-prefill: selecting an existing Prodshade material that already has ≥1 prior stroke_master row (any status, same company) prefills the new Stroke's Default Storage Location from that prior entry — user can still override
- Applies to both PR01 (StrokeMasterPage.jsx create/edit) and PR02 (StrokeApprovalPage.jsx header edit at DRAFT)
- Dev data fix (MCP, not migration): backfilled CMP003's 5 existing APPROVED strokes to S003 (Construction Chemical Shop Floor) since they predate this rule

**83.7 — Batch Number Series correction (LOCKED — 2026-07-11, business owner override of 2026-06-10 version):**
- HPS moves from per-Prodshade to company-level — MTO/HPS/MTEST are now all company-level (no Prodshade scoping)
- IWC + Powder unified under one "MTS" batch_type, per-Prodshade (Powder no longer manual-entry-only)
- No financial-year reset — `fy_reset` column dropped entirely (was never actually implemented, was misleading). Batch number wraps `99999` → `1` on overflow, 5-digit zero-padded format
- Migration: `20260710183331_gate27_batch_series_mts_rename_drop_fy_reset.sql` — renamed `IWC`→`MTS` in `batch_type` CHECK constraint, dropped `fy_reset` column (dev had zero existing rows, no data backfill needed)
- Fixed alongside: `active`/`is_active` field-name mismatch (Active toggle silently did nothing), `current_count` edit was silently dropped by backend, SA config page had raw-UUID company/prodshade inputs (now comboboxes)
- Files: `supabase/functions/api/_core/production/batch_series.handlers.ts`, `process_order.handlers.ts` (startBatchHandler batchTypeMap), `frontend/src/admin/sa/screens/SAProductionBatchSeriesPage.jsx`

**83.4/83.3 — SFG/FG output (P101) location authority corrected (LOCKED — 2026-07-11, business owner override):** P101 receipt location (Verify, and INT/MTEST completion) is `stroke_master.default_storage_location_id` — **not** `production_segment_location_config.shopfloor_sloc_id`. This was already locked for INT specifically (see 83.5 line above) but the original §83.4 "Storage Location Integration" text (2026-06-11) was never corrected to match, and Gate-27.6's implementation missed it for MTO/HPS/MTS too. Business owner confirmed the rule is uniform across MTO/HPS/MTS/INT/MTEST — every stroke has a mandatory default output location (83.3), so segment config is not needed for this value. Segment config's `rm_sloc_id`/`pm_sloc_id` still govern P261 RM/PM issue defaults (unchanged). **Code fix pending** — `process_order.handlers.ts`'s `verifyProcessOrderHandler`, `completeIntProcessOrderHandler`, and the MTEST branch of `createProcessOrderHandler` all currently read `segConfig.shopfloor_sloc_id` for the P101 target and need to switch to the stroke's `default_storage_location_id`.

**Bug found (not a design gap) — INT detection checks the wrong column (2026-07-11):** `checkStockAvailability()`, `finalizeProcessOrderHandler`'s INT-dependency check, and the Verify reco `line_material_type` classification all filter on `material.production_mode === "INT"` — but `production_mode` is NULL on every material in Dev. The real classification lives in `material_master.material_type` (confirmed populated: RM=48, PM=41, FG=8, SFG=4, INT=1). Code fix pending — replace `production_mode` checks with `material_type = 'INT'`.

**SFG Result Recording — TX code PR18 + third test group "Concrete Trial" (LOCKED — 2026-07-11):** Gate-27.16's SFG Result Recording page is registered as tx_code **PR18** (`erp_menu.menu_master`/`acl.menu_master` rows added via MCP, `CAP_PROD_OPERATOR` capability mapped VIEW/WRITE/EDIT/APPROVE — same pattern as PR17). A third test group **"Concrete Trial" (`CT`)** is added alongside MCT (mandatory)/OTHR (optional) — optional like OTHR, same shared `qa_test_method`/`qa_category_test_config` mechanism, scoped to this page only (Procurement's Inward QA page's own frontend hardcodes MCT/OTHR only, unaffected). See feasibility §83.4 for the full note. **Code fix pending:** migration to widen `qa_test_method.test_group` CHECK to allow `'CT'`, plus a third `renderMethodGroup("CT", ...)` section in `SfgResultRecordingPage.jsx` only.

**Packing PO storage-location authority (LOCKED — 2026-07-11):** No segment-config-style default lookup for Packing PO at all — every line's SLoc comes from Pack BOM (SFG/INPUT row = Stroke's default location per 83.15; FG/OUTPUT row = user-entered when Pack BOM was set up) or manual entry for BOM-not-required pack types. Stock check always runs against the SLoc value present on the line at that moment — see §83.4 PR09 Packing PO mode in the feasibility doc.

**`external_code`/`external_sku` are reporting-only, never a business-logic dependency (LOCKED — 2026-07-11):** See feasibility doc §83.3 for the full note. Only populated systematically for SFG/INT (Prod+Shade combo at Stroke Master creation) — RM/PM must never be assumed to have it, and no handler/UI may key off it for RM/PM. Use `pace_code — material_name` for RM/PM labels, always.

**83.9 — MTEST exempt from mandatory Machine (LOCKED — 2026-07-11):**
- `MTEST` does not require machine assignment — `machine_id` stays optional/null for MTEST only
- Machine remains mandatory for `MTO`, `HPS`, `MTS`, and `INT` — already implemented correctly (`REQUIRED_MACHINE_TYPES` in `process_order.handlers.ts`)

**✅ Gate-27 Process PO chain — FULLY CLOSED OUT (2026-07-11).** Standard → QA → PR10 Edit → Start Batch → INT-complete → Final → Verify → CORS, location-aware stock/reservation, PR16/PR17 rebuild, SFG Result Recording (PR18) + Concrete Trial test group, sidebar-visibility fix — all done, Codex-run, Claude-verified, committed (`26ef4d8`, `17a845d`, `0256b5e`, `b319c50`, `107c335`, `23c3c18`, `a226ef0`, `8b00fa3`, `2d15b72`). Full detail: `OM-IMPLEMENTATION-LOG.md` Gate-27.6/27.14/27.15/27.16/27.17 entries.

**➡️ Sequencing locked (2026-07-11, refined 2026-07-13):** Packing PO (full Standard→Final cycle, no Verify, no QA step either — reconfirmed 2026-07-13) → **then** Reservation engine (finalize its design — Packing PO is one of §83.5's 5 reservation sources but the mechanism was never built for it specifically) → **then** Plan Feed (FO) page build + FO↔SKU map/unmap actions (§83.18) → **then** SO (blocked until FO is ready — SO links to FO, can't build SO without FO existing first) → **then** Dispatch/L5 (blocked until SO is ready). PID and FG Opening Stock (RM+PM+FG together, per §83.2) come **later**, after this chain, not before. Do not jump ahead of this order.

**Next: Packing PO.** Still broken/ID-based create (list/get/create/update-lines only — no Standard→Final lifecycle, no QA, no batch, no reservation). This is the next full brief to write. Small prerequisite: Pack BOM company-wise + mandatory SFG INPUT row gap (below) should land first since Packing PO's PM/SFG auto-population depends on it.

**⚠️ Heads-up for the next two items in the sequence — neither is implementation-ready yet, both need a design pass first (same discipline as Gate-27):**
- **Opening Stock (RM + PM + FG together, Liquid go-live):** RM/PM's opening-stock mechanism (Gate-19) is already ✅ VERIFIED and reuses P561/P563/P565 — but that was verified for RM/PM's simpler (non-batch) shape. FG is batch-tracked (§83.7), so the FG portion of the SAME go-live exercise needs its own field-level design before assuming the existing page/handler just works as-is: does FG opening stock need a Batch Number per lot, which storage location (F003?), manual batch entry or reuse of the production batch series. Treat this as one combined RM+PM+FG go-live exercise, not three separate ones — needs its own doc-first session before any brief.
- **Dispatch module (L5):** per Layer table (CLAUDE.md §9), only ~51% designed, explicitly flagged **"🔴 Partial — Formal L5 session required."** This is the least-ready of the three — expect a full dedicated design session, not just an implementation brief, before Codex can touch it.

**⚠️ Still open (not blockers, revisit later):**
- MTS stroke-selection mechanism at Process PO create (83.3) — deferred; current manual-pick UI (same as MTO/HPS) stays as interim behavior, no schema/backend impact either way
- FG Costing System (83.13 → Section 104) — dedicated session deferred ~1 week, after the full Process PO + Packing PO production cycle is built (see §104.6 for the query checklist, including 3 new items added 2026-07-11)
- SFG Result Recording page detail — already built as a direct Inward QA clone (Gate-27.16); no further design gap
- Admix FG SKU creation timing (83.12, SOD-deferred) — to be discussed alongside Packing PO
- Pack BOM full design (company-wise scope, mandatory OUTPUT/INPUT rows, F0xx storage location, UOM conversion auto-sync, batch/lot granularity — locked in feasibility §83.15, session 2, 2026-07-13) — **still not implemented in code**; `pack_bom` has no `company_id` column, `pack_code_master` has no `outer_uom_code` column, no "Is Primary Container" flag exists on PM lines, and `PackBomCreatePage.jsx` still never creates the SFG INPUT row (only OUTPUT+PM) — real gap, needs its own brief before Packing PO's rebuild

**🔴 Gate-27 costing/batch discovery session (2026-07-12) — 2 of 5 issues LOCKED, 2 remaining:**
Deep-dive into how HPS/MTO's batch-level costing/dispatch/salvage actually works surfaced a real, previously-unknown engine gap: `post_stock_movement()` had no batch parameter at all, and `stock_ledger.batch_id` was dead (no FK, never written).
- ✅ **Issue 1 — Batch Number Persistence** — LOCKED, see feasibility §83.7 "Batch Number Persistence Mechanism". Task brief written: `CODEX-GATE27.19-BATCH-NUMBER-PERSISTENCE-TASK-BRIEF.md`. Not yet implemented in code.
- ✅ **Issue 2 — Partial Batch Reversal (PR19 + PR20 report)** — LOCKED, see feasibility §83.7 "PR19 — Partial Batch Reversal + PR20 — Partial Reversal Report". This single mechanism **absorbed and replaced** the earlier separate "salvage-blend granular RM decomposition" idea — there is no receiving-batch insertion, everything happens through PR19's reversal with an optional Salvage Batch Number tag. Also replaced the earlier "reusable vs single-use PM flag on material_master" idea — PR19's per-line checkbox (manual every time, no stored default) is the entire mechanism now. Not yet implemented in code, no task brief written yet.
- 🔴 **Issue 3 — Partial return + pack-type-change workflow** (e.g. tanker return, partial qty, repack into barrels) — **BLOCKED, business owner decision 2026-07-12: do not design until Dispatch (L5) has its formal session** (a return references what was dispatched — designing Return Receipt on top of an undesigned Dispatch layer risks the same doc-first-workflow miss already seen once with PR09). Stress-testing PR19 against two worked examples (13000-unit tanker batch, 12000 MT returned; 26-barrel batch, 22 barrels returned) surfaced the exact open question that must be resolved when this gets designed: PR19's SKU-row reversal always dissolves down to RM/PM (no way to stop at SFG and hand it straight to a new pack-type's Packing PO) — full detail + the pre-existing unused P651-P658 return movement-type family written into feasibility §83.6 "Customer Return + Pack-Type-Change Reversal — BLOCKED on Dispatch design". **Mandatory future work, explicitly not dropped** — sequencing: Dispatch (L5) session → Return Receipt + QA Usage Decision design → this pack-type-change reversal design.
- MTS/INT/MTEST explicitly deferred — this whole batch-persistence/reversal effort is MTO/HPS-scoped only, do not extend without a dedicated session

**✅ PR10 (Process PO Edit) — redesigned + LOCKED (2026-07-12), second correction same day, business owner override:** Edit window flips from "after QA approval" to **before it** — see feasibility §83.4's "PR10 (ZCoR2) — Edit Rules — SECOND CORRECTION" (supersedes the 2026-07-04 lock and its own earlier 2026-07-12 correction). Scope for this brief: **Process PO, MTO/HPS only**, available at STANDARD status before QA approves. Editable: Machine, Batch Qty (recalculates RM lines live), per-line Storage Location (reverses the old "blocked" rule), per-line Alternate/Actual Material (only where a registered alternate exists) — plus a mandatory stock-availability re-check on save (§83.5 hard-block severity). Page 1 is PO Number only, no Company field — confirmed via direct DB check that `document_number_series` has no `company_id` column, `po_number` is a single global counter. **Deferred, not dropped:** MTS/INT's "before Final" window (piggybacks on the already-deferred MTS/INT batch session) and Packing PO's own PR10 half (deferred to land with Packing PO's Standard→Final rebuild, already next in the locked sequencing — do not bolt it onto the legacy `updatePackingOrderLinesHandler`). Implementation note: build PR10 as its own dedicated handler+page (PR09/PR11/PR12 pattern) — do not reuse the legacy `updateProcessOrderLinesHandler`/`ProcessOrderPage.jsx`, which predates the Gate-27 TX-code rebuild and allows far more than PR10's narrow scope. Task brief: `CODEX-GATE27.21-PR10-PROCESS-PO-EDIT-TASK-BRIEF.md`.

**⚠️ Known risk (2026-07-11):** two Claude/Codex sessions running against this same working directory concurrently can clobber each other's uncommitted doc edits — a `git checkout` run by one session to revert Codex's unauthorized doc edits silently wiped this session's own legitimate, user-approved edits to the same files (MTEST-machine note + §104.6 queries, both lost once and re-applied above). Commit doc-only locks promptly instead of leaving them uncommitted when another session may be active.

**🔴 PR18 sidebar-visibility gap - root cause + fix documented (2026-07-11 follow-up audit):** live click-through of the deployed Gate-27 batch (user-directed, against `dev.myerpdev.xyz`) found PR09's actual build does not match locked design at all, despite the OM-IMPLEMENTATION-LOG entries claiming "Codex-run, Claude-verified, fully closed out." Confirmed root cause: the exact page-by-page PR09 flow (3-page gated Standard create: Company/PO Type/Material -> Stroke gate -> Machine/Batch Size/Material Table) was discussed and mockup-approved in chat but **never written into the feasibility doc** - a doc-first-workflow miss. Codex therefore built PR09 from only the mechanism-level doc content (Reservation, stock-check severity, Alternate Material concept - all of which ARE correctly implemented), producing a flat single-page form with no Material Table at all, plus an unrequested "Segment" field. Recovered spec now written into feasibility doc (see new "PR09 - Standard Create: Page-by-Page UI Spec" subsection in §83.4). Two concrete live bugs also found and fixed same session:
- `GET /api/production/prodshades` ACL mis-mapped to `SA_OM_PACK_CODE_MASTER` (an unrelated SA-only resource) - dropdown always empty for non-SA roles. **Code fix still pending.**
- `GET /api/om/machines` returns 403 for DIRECTOR/Production roles despite `skipAcl: true` in the route registry - root cause is a separate hardcoded gate inside `machine.handlers.ts`'s `listMachinesHandler` (`assertOmAdminContext`, SA/ADMIN only) that ACL's `skipAcl` cannot bypass. **Code fix still pending** - List should allow broader read access; Create/Update/Toggle should stay SA-only.
- PR18 menu-tree parent link was missing (`parent_menu_id = NULL`), making it show as a top-level main-menu item instead of nested under "Production" — **fixed via MCP** (menu_tree row inserted + snapshot regenerated for all 9 test users x 4 companies).

**Cross-checked doc vs session transcript for PR10-PR17 (2026-07-11):** unlike PR09, these ARE faithfully captured in the doc — traced PR16 (QA Queue), PR17 (Batch Release), movement-type mapping (P261->P101->P321), stock-check severity, and `process_order_line_reco` design directly against the session transcript quotes and confirmed no drift. These are safe to treat as ground truth for a live-app audit; PR09 was the one exception where chat and doc diverged.

**Next:** live-audit PR10 through PR18 one at a time against this now-confirmed-accurate doc spec (same rigor as PR09 — do not trust "Claude-verified" log entries without independent live confirmation), then write a Codex brief to rebuild PR09's frontend (add the Material Table, remove Segment/Notes fields) and fix the two ACL bugs above.

---

## 7. Workflow Plan (Dev → Prod)

1. **Dev তে কাজ করো** — MCP দিয়ে directly SQL execute (project: `ytapuwiqicmvpanmzelb`)
2. **Test করো** — generate_acl_snapshot + generate_menu_snapshot চালিয়ে verify করো
3. **Migration file বানাও** — `supabase/migrations/` folder এ
4. **Prod এ apply করো** — `supabase db push` বা prod project এ migration apply

---

## 8. Document Number Series — SAP-Style Range Design (LOCKED 2026-07-07)

> **⚠️ 2026-07-17 — বড় evolution চলছে (feasibility doc Section 106, LOCKED):** পুরো numbering
> foundation SAP Material Document (MBLNR+MJAHR) model-এ যাচ্ছে — business number আর material
> movement আলাদা layer হবে, আর reset-policy দুই ভাগ: **Year-scoped** (Material Document,
> Accounting/FI, Costing/Reco, Invoice, Debit/Credit Note, + business-decision হিসেবে PO/SO/STO)
> বনাম **Continuous** (Process/Packing PO, GRN, Gate, QA, RTV, OS ইত্যাদি)। Year-scoping engine
> `erp_inventory.number_series_master` (System C) আগে থেকেই বানানো ছিল, এখন কাজে লাগানো হচ্ছে।
> **Phase 1 ✅ DONE** (`generate_material_doc_number()` + MATDOC series, 4 company, FY April-start)।
> **Phase 2 ✅ CODE COMPLETE (2026-07-17)** — Step A (stock_document এ `document_year` +
> `reversal_document_year` + year-aware unique key), Step B (`post_stock_movement()` এ ৫টা optional
> MatDoc/reference param — backward-compatible, live verified), Step C (**১১টা module-ই** migrate:
> Opening Stock, GRN, STO, Inward QA, RTV, Sales Order, PID, PTO, Process PO, Packing PO, PR19 —
> প্রত্যেকে event প্রতি একটা MatDoc, business number reference-এ; `-REV` suffix hack বাদ)। Shared
> helper: `_shared/materialDocument.ts`। **Phase 3 ✅ CODE COMPLETE (2026-07-17)** —
> `process_order_line_reco` এ `reco_document_number`+`reco_document_year`+`source_txn_type`
> (PRODUCTION/RETURN/PARTIAL_REVERSAL/COR6_CORRECTION)+reference; FY logic generic হলো
> (`generate_year_scoped_doc_number(company, doc_type)`, MATDOC সেটাকে delegate করে); RECO series
> (৪ company, April-FY); Verify → PRODUCTION rows, **PR19 → negative PARTIAL_REVERSAL credit rows**
> (আগে Stock reverse হতো কিন্তু Costing layer পুরো consumption APL কে bill করেই যেত)। Net costing
> live verified: 10,060.5 − 10% = 9,054.45। **বাকি:** live end-to-end verification (deployed app-এ
> real posting), আর `RETURN`/`COR6_CORRECTION` writer এখনো নেই (RETURN আসবে §83.6 Return design এ)।
> **এখন §83.6 Return design এর blocker সরে গেছে।** নিচের §8 table এখনো valid (continuous business
> ranges), Material Document layer তার উপরে বসেছে। কাজ শুরুর আগে Section 106 পুরোটা পড়ো।
>
> ⚠️ **`stock_ledger` append-only** — `stock_ledger_no_delete`/`stock_ledger_no_update`
> (`ON ... DO INSTEAD NOTHING`) rule আছে, DELETE/UPDATE চুপচাপ no-op করে। কোনো correction কখনো
> edit নয়, সবসময় নতুন reversing posting।

`erp_procurement.document_number_series` তে প্রতিটা doc type এর আলাদা number range — SAP এর মতো range দেখেই doc type বোঝা যায়। **Prefix নেই।**

| doc_type | Range start | Range |
|----------|------------|-------|
| GE | 100001 | 1xxxxx |
| GEX | 150001 | 15xxxx |
| GXO | 160001 | 16xxxx |
| GRN | 200001 | 2xxxxx |
| CSN | 300001 | 3xxxxx |
| IV | 400001 | 4xxxxx |
| LC | 450001 | 45xxxx |
| QA | 500001 | 5xxxxx |
| OS | 600001 | 6xxxxx |
| PI | 650001 | 65xxxx |
| PT | 700001 | 7xxxxx |
| RTV | 800001 | 8xxxxx |
| DN | 810001 | 81xxxx |
| EXR | 820001 | 82xxxx |
| SO | 900001 | 9xxxxx |
| DC | 910001 | 91xxxx |
| SALES_INVOICE | 920001 | 92xxxx |
| SFG_QA | 950001 | 95xxxx |
| PROC_PO | 930001 | 93xxxx |
| PACK_PO | 940001 | 94xxxx |

> ⚠️ Prod deploy এর আগে prod DB তেও same MCP SQL চালাতে হবে (starting_number set)।
> Schema/code change নেই — pure data config।

**PROC_PO/PACK_PO correction (2026-07-13):** Process PO ও Packing PO আগে ভুলভাবে company-scoped, FY-prefixed number নিতো (`erp_procurement.company_doc_number_series`/`generate_company_doc_number()` — format যেমন `ASCPROC2627-0001`), এই §8-এর global-range convention থেকে ভিন্ন — Gate-27 বানানোর সময় production module নিজের আলাদা mechanism ব্যবহার করেছিল। এখন ঠিক করা হয়েছে: উপরের table-এ `PROC_PO`/`PACK_PO` নতুন global range পেয়েছে, পুরনো company-scoped ৮টা row (৪ company × ২ doc type) `active=false` করা হয়েছে dev-এ, আর `process_order.handlers.ts`/`packing_order.handlers.ts`-এর কোড নতুন `generateGlobalDocNumber()` (production.utils.ts) ব্যবহার করছে — `generate_doc_number()` RPC দিয়ে, company param ছাড়াই। পুরনো `ASCPROC2627-0001` স্টাইলের PO numbers historical data হিসেবে থেকে যাবে, নতুন সব PO plain global number পাবে (৯৩০০০১, ৯৪০০০১ থেকে শুরু)। **Prod deploy-এর আগে prod DB-তেও এই একই MCP data change (নতুন row insert + পুরনো row deactivate) চালাতে হবে** — এটাও pure data config, migration না।

---

## 8. Key Architecture Rules (Never Violate)

- `acl.menu_master.menu_code` MUST = `erp_menu.menu_master.resource_code`
- SA/GA always full access — cannot be denied
- Parent Company = HR only (leave, salary, identity)
- Work Company = operational scope
- Work Context = runtime functional role (menu recomputes when changed)
- Default Deny — permission না থাকলে access নেই
- Companion screens menu_master এ নেই — route-only
- `stock_document.document_number` = business document (SAP MKPF header), UNIQUE শুধু `(document_number, item_number)` জোড়ায় — `post_stock_movement()` নিজে item_number বসায়, caller কখনো suffix বানাবে না (দেখো Section 8C)
- **নতুন schema বানালে PostgREST-এ expose করতে হবে (platform config, migration নয়):** `serviceRoleClient.schema("X")` কাজ করবে না যদি `X` Supabase Dashboard → Settings → API → **Exposed schemas** list-এ না থাকে — না থাকলে `PGRST106: Invalid schema` → সব call 500 (grants ঠিক থাকলেও, কারণ PostgREST route-ই করে না)। এটা migration-এর সাথে travel করে না — **dev ও prod দুই Dashboard-এ আলাদাভাবে add করতে হবে**। ইতিহাস: `erp_menu` (Session 2026-06-12), `erp_production` (Gate-27.1, 2026-07-10)। নতুন কোনো `erp_*` schema-র প্রথম page live করার আগে এই list চেক করো।

---

## 8A. PACE ERP Mandatory Development Rules (সব Gate, সব Screen)

এই rules ভাঙা যাবে না। প্রতিটা Gate VERIFIED হওয়ার আগে এই rules against চেক করতে হবে।

### কোনো Business Data UUID হিসেবে দেখাবে না
UI তে কোথাও raw UUID দেখানো যাবে না। প্রতিটা foreign key অবশ্যই human-readable value হিসেবে resolve হয়ে আসবে।

- **Backend:** Handler এ সব FK bulk resolve করো — `.in()` দিয়ে একবারে, map বানাও, response এ name attach করো
- **Frontend:** `row.material_name` দেখাও, `row.material_id` নয়। Name না এলে `"—"` — কখনো raw ID fallback নয়

| Raw field | UI তে দেখাবে |
|-----------|-------------|
| `material_id` | `material_code — material_name` |
| `vendor_id` | `vendor_code — vendor_name` |
| `csn_id` | `csn_number` |
| `po_id` | `po_number` |
| `gate_entry_id` | `ge_number` |
| `grn_id` | `grn_number` |
| `storage_location_id` | `location_code — location_name` |
| `*_by` / `*_staff_id` / `*_user_id` | `employee_code — full_name` অথবা field omit |

### Back-and-forth Navigation এ Data Reload চলবে না
API থেকে data fetch করে এমন প্রতিটা page অবশ্যই `useQuery` use করবে। `useEffect` + `setState` দিয়ে API call forbidden।

- Back করে ফিরলে cache থেকে instant দেখাবে — আবার wait করতে হবে না
- Mutation এর পরে: `queryClient.setQueryData(key, result)` দিয়ে cache update করো
- Refresh button: `queryClient.invalidateQueries(...)` — never `setTick` বা অন্য hack

### List Endpoint এ Accurate Display Data থাকবে
List page per-row detail endpoint call করবে না। List এ দেখানোর জন্য সব data — names, numbers, quantities — list endpoint থেকেই আসবে। Backend bulk fetch করে সব resolve করে দেবে।

### MCP vs Migration — সঠিক পথে কাজ করো
- **Migration file** → Schema change, DDL, system design config (document number ranges, constraint, index, function)
- **MCP direct SQL** → Business/operational data (user setup, ACL snapshot, test data fix) — dev ও prod আলাদাভাবে run করতে হয়

Migration file PR এর সাথে travel করে → prod deploy এ automatically apply হয়।
MCP change শুধু যে DB তে run করা হয় সেখানেই থাকে।

---

## 8B. Batch vs Sequential Loop Rule (Mandatory — LOCKED 2026-07-08)

**কেন:** PO confirm, vendor-material list ইত্যাদি page slow হওয়ার root cause খুঁজতে গিয়ে ধরা পড়ে — অনেক handler এ `for`/`for...of` loop এর ভিতরে `await` দিয়ে row-by-row DB/RPC call হয়। Codex দিয়ে পুরো ERP audit করানো হয়েছে (`docs/Codex-Audit-Sequential-Loops.md`, 2026-07-08) — ~50টা এই ধরনের loop পাওয়া গেছে। Blanket "সব batch করো" rule লেখা হয়নি, কারণ কিছু loop এ row-order আসলেই matter করে (stock posting) — সেগুলো batch করলে data corruption হতে পারে।

### প্রতিটা loop লেখার/দেখার সময় আগে classify করো

**INDEPENDENT** — এক iteration এর DB কাজ অন্য iteration এর result/commit এর উপর নির্ভর করে না (আলাদা row, আলাদা material, আলাদা vendor ইত্যাদি validate/insert/update করছে)।
→ **MUST batch।** Sequential `for...of` + `await` ভিতরে **forbidden**।
- Read: `.in("id", ids)` দিয়ে একবারে সব fetch করো, তারপর in-memory Map বানাও।
- Independent write (insert/update/delete, একটার সাথে আরেকটার সম্পর্ক নেই): `Promise.all([...])` দিয়ে parallel করো।

**DEPENDENT** — stock/balance posting, running total, বা iteration N এর correctness iteration N-1 এর committed state এর উপর নির্ভর করে (উদাহরণ: RM/PM issue movement, GRN reversal, RTV/STO dispatch posting, opening stock posting, PI difference posting, QA usage-decision posting)।
→ Sequential রাখো, কিন্তু loop এর ঠিক উপরে একটা comment দাও: `// DEPENDENT: <কেন order matter করে, এক লাইনে>`। এই comment ছাড়া কোনো DEPENDENT loop merge হবে না — নাহলে পরে কেউ "optimize" করতে গিয়ে race condition/negative stock ঢুকিয়ে দেবে।

### Doc-number / counter function rule
নতুন কোনো number-series বা counter function বানালে অবশ্যই single atomic `UPDATE ... RETURNING` pattern ব্যবহার করো (যেমন `erp_procurement.generate_doc_number`) — কখনো `SELECT MAX(...)` করে পরে আলাদা `INSERT`/`UPDATE` করবে না। এটাই parallel call কে race-condition-free রাখে।

### Truly atomic multi-step write দরকার হলে
যদি একটা operation সত্যিই multi-step এবং all-or-nothing হতে হয় (যেমন PO confirm এ N লাইনের CSN create), সেটা TypeScript এ `Promise.all` দিয়ে hand-roll না করে একটা Postgres function (plpgsql) এ পুরো কাজ লিখে একটাই RPC call দিয়ে চালানো ভালো — তাতে network round-trip ও কমে, transaction-level atomicity ও পাওয়া যায়।

### Reference
`docs/Codex-Audit-Sequential-Loops.md` — existing ~50 loop এর file:line, round-trip count, INDEPENDENT/DEPENDENT classification, severity সহ baseline checklist। নতুন করে re-audit না করে এখান থেকে ধরে ধরে fix করো।

### Enforcement
Code review এ নতুন `for`/`for...of` loop এ `await` দেখলে সাথে সাথে জিজ্ঞেস করো — এটা INDEPENDENT (batch করতে হবে) না DEPENDENT (comment আছে কিনা চেক করো)। শুধু prose rule যথেষ্ট না, review এ actively গ্রেপ করে ধরতে হবে।

---

## 8C. Stock Posting Engine — document_number / item_number (Mandatory — LOCKED 2026-07-09)

**কেন:** Inward QA usage-decision লাইভ testing-এ ধরা পড়ে — `erp_inventory.stock_document.document_number`-এ আগে bare `UNIQUE` constraint ছিল, কিন্তু `post_stock_movement()`-কে অনেক caller-ই **একই business document number দিয়ে একাধিকবার** call করে (Inward QA-র RELEASE/BLOCK/REJECT/FOR_REPROCESS decision-এ OUT+IN দুইটা call; partial decision-এ multiple batch; RTV-র `isDirectPath`-এ ৩টা call — সবই নিজ নিজ document number দিয়ে বারবার)। দ্বিতীয়/পরবর্তী call-ই সবসময় `23505 duplicate key`-এ fail করতো — **প্রথম call ততক্ষণে commit হয়ে গেছে**, ফলে stock এক জায়গা থেকে বেরিয়ে গিয়ে আর কোথাও credit হয়নি (silent stock-integrity gap)। বিস্তারিত: feasibility doc Section 105।

### সমাধান (SAP MKPF/MSEG মডেল, LOCKED)
- `stock_document`-এ `item_number` column, constraint এখন `UNIQUE(document_number, item_number)`
- `post_stock_movement()` (দুই overload-ই — `p_plant_id` সহ ও ছাড়া) নিজে থেকেই `MAX(item_number)+1` বসায় (row lock দিয়ে, concurrent call serialize করার জন্য) — **caller কখনো item_number/suffix handle করবে না**
- `document_number` সবসময় caller-এর নিজের business document number-ই থাকবে (qa_number, grn_number, rtv_number, so_number...) — এটাকে unique রাখার জন্য কখনো suffix (`-OUT`, `-1` ইত্যাদি) জোড়া লাগানো **নিষিদ্ধ**, engine নিজেই সেটা handle করে

### নতুন কোনো handler লেখার সময়
`post_stock_movement()`-কে একই document_number দিয়ে একাধিকবার call করা সম্পূর্ণ safe — প্রতিটা call আলাদা item হিসেবে বসবে, কোনো collision হবে না। Migration: `supabase/migrations/20260709025725_stock_document_item_number.sql`।

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
