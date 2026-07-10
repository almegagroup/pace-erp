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

**83.4 — Process PO FO field removed, MTEST lifecycle, SFG Result Recording (LOCKED — 2026-07-11):**
- Process PO header does NOT carry any FO reference (not even informal) — corrects the earlier "FO number = informal reference at creation" text. FO link exists only on Packing PO
- MTEST confirmed single-action like INT (no Standard/Final/Verify stages) — but unlike INT, MTEST DOES get a batch number (company-level, at that single save)
- SFG Result Recording page = exact identical mechanism to the existing Inward QA page (same qa_test_method_master/qa_category_test_config infra, same workflow) — build as a direct clone, not a fresh design
- STO/Location Transfer reservation implementation details deferred to later

**83.5 — Reservation sources + 101 QI-hold exceptions (LOCKED — 2026-07-11):**
- Reservation now keyed by material+plant+**storage location** (not just material+plant)
- 5 reservation sources resolved: Process PO (Standard→Verify), Packing PO (Standard-equiv→Final), Sales Order (Dispatch Instruction created→P601), STO (same Dispatch Instruction doc type→P601), Location Transfer/P311 (created→posted)
- P101 (production output receipt) defaults to QUALITY_INSPECTION per movement_type_master — applies to MTO/HPS/MTS SFG output. Exceptions posting straight to Unrestricted: INT, MTEST, Packing PO's FG(SKU) receipt
- MTO/HPS/MTS: no separate QA-release screen — Verify (PR12) IS the QA action, so QI→Unrestricted auto-releases in the same transaction. Still need a separate "SFG Result Recording" page for lab/quality test results (backlog, not yet designed — likely reuses qa_test_method_master/qa_category_test_config)
- INT has NO batch number, NO Standard/Final/Verify — single-page create+complete action (confirmed: uses Stroke like MTO/HPS, Machine mandatory, output storage location = Stroke's own default_storage_location_id, movement type reuses P101)

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

**⚠️ PENDING (next session):**
- P261 issue location override — not yet confirmed by user
- S003 → F003 transfer trigger — who, when (not yet discussed)
- 83.4 Process PO / Packing PO header + line fields (not yet discussed)
- 83.6, 83.8–83.12 review and lock
- Section 104 dedicated costing session (see 104.7 open items above)

---

## 7. Workflow Plan (Dev → Prod)

1. **Dev তে কাজ করো** — MCP দিয়ে directly SQL execute (project: `ytapuwiqicmvpanmzelb`)
2. **Test করো** — generate_acl_snapshot + generate_menu_snapshot চালিয়ে verify করো
3. **Migration file বানাও** — `supabase/migrations/` folder এ
4. **Prod এ apply করো** — `supabase db push` বা prod project এ migration apply

---

## 8. Document Number Series — SAP-Style Range Design (LOCKED 2026-07-07)

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

> ⚠️ Prod deploy এর আগে prod DB তেও same MCP SQL চালাতে হবে (starting_number set)।
> Schema/code change নেই — pure data config।

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
