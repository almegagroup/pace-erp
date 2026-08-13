# PACE ERP — Session Handoff Brief (as of 2026-08-13)

> **Purpose:** paste/reference this doc at the start of a new Claude session so it can
> continue accurately without re-deriving context. `CLAUDE.md` is still the primary SSOT
> (auto-loaded every session) — this doc does **not** duplicate it. It (a) summarizes what
> changed in the session that just ended (2026-08-12/13, git log `4e9462f9`..`27a8fe89`),
> which CLAUDE.md itself hasn't fully absorbed yet, and (b) gives one consolidated,
> accurate "what's pending, where do I find the detail" index across the 13 bug patterns,
> SU24, OM Implementation Log, ACL docs, and the feasibility doc.
>
> **First thing a new session should do:** read `CLAUDE.md` in full (it auto-loads), then
> this doc, then jump straight to whichever "Pending Work" item below is being picked up —
> each entry names the exact file/section to open next, no rediscovery needed.

---

## 1. What happened in the session that just ended (2026-08-12/13)

Commits, in order (`dev` branch, all pushed to `origin/dev`):

| Commit | What |
|---|---|
| `af379dea` | SAP-style COR6 correction mechanism for Process PO Verify (PR12) + Packing PO Final (PR11) — backend handlers + frontend correction-mode UI |
| `ff129fc5` | Corrected COR6 movement type to be **user-picked from a dropdown**, not sign-inferred (business owner override of the original design) |
| `9c41038f` | Baselined `correctProcessOrderHandler` in `company-scope-write-acl-guard.mjs` (new handler hit a known, already-tracked pattern) |
| `871a278e` | **Started Phase 2** of the company-scope write-ACL gap fix (see §3 below) — Production module's `process_order.handlers.ts` (10 handlers) + `packing_order.handlers.ts` (7 handlers), built a reusable shared helper. Found + fixed **2 real pre-existing live ACL bugs** along the way (see §3). |
| `e9b4498b` | Fixed PR11 correction mode: PM material dropdown was always empty (wrong `enabled:` gate on the query) |
| `27a8fe89` | Fixed CSN Tracker: `invoice_date` never synced from GRN, Domestic-CSN Transporter field always blank (wrong column), and relaxed the GED/GRD hard edit-lock into a one-time confirm-at-save |

**Net effect for a new session:**
- The full SAP-style COR6 correction feature (Process PO Verify + Packing PO Final) is **built, DB-verified against real prod data, and live** — do not re-design this, it's done. See `frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx` (PR12) and `ProductionPOFinalPage.jsx`'s `PackingPoFinalTab` (PR11), backend in `process_order.handlers.ts::correctProcessOrderHandler` / `packing_order.handlers.ts::correctPackingOrderHandler`.
- Company-scope write-ACL gap Phase 2 is **started, not finished** — 17 of ~127 handlers done. See §3.
- CSN Tracker had 3 real bugs, all fixed. See §5.
- **No new migration files were created this session** — every fix was code + MCP data (dev, and where confirmed necessary, prod). Nothing pending on the migration side from this session's work.

---

## 2. The 13 Bug Patterns — where they live, current status

**Canonical description: `CLAUDE.md`'s "Recurring 13 Bug Patterns" section** (under
"আমরা কী কাজ করছি এবং কেন"). Do not re-derive these from memory — read that section
directly, it is kept in sync (a 2026-08-06 note in `PROD-ACL-Access-Decisions.md`
explicitly warns a second copy drifted out of sync once already; `CLAUDE.md` is the one
true copy now).

Quick status snapshot (guard scripts = automated, permanent enforcement; CI-wired in
`.github/workflows/ci-basic.yml`):

| # | Pattern | Guard script | CI-wired? | Status |
|---|---|---|---|---|
| 1 | Hardcoded rank-check bypass | `hardcoded-role-check-guard.mjs` | ✅ | Ratchet at 0 new, baseline swept |
| 2 | Company-scope gap (read paths) | `company-scope-guard.mjs` | ✅ | Ratchet at 0 new |
| — | Company-scope gap (**write** paths, distinct shape) | `company-scope-write-acl-guard.mjs` | ✅ | **Phase 2 in progress — see §3** |
| 3 | Blanket capability leak | (judgment call, no script) | — | Check manually per new capability reuse |
| 4 | `capture_acl_version_source()` one-time trap | (documented rule in CLAUDE.md) | — | Known trap, apply the rule each time |
| 5 | ACL-MASTER (P0076) maintenance drift | `acl-master-drift-check.mjs` | Manual (prints SQL, run via MCP) | Run after any ACL data change |
| 6 | One resource code reused for two actions | `resource-code-domain-guard.mjs` | ✅ | Ratchet at 0 new |
| 7 | Maker-checker empty/fallback behavior | (judgment call) | — | Check via `PROD-ACL-Access-Decisions.md`'s Post-Implementation Checklist |
| 8 | Route/ACL registry mismatch | `route-acl-registry-guard.mjs` | ✅ | 0 missing matches |
| 9 | `acl.approver_map` scope/uniqueness shape | (judgment call) | — | Check per new approval chain |
| 10 | Small config/data traps | (judgment call) | — | e.g. sentinel junk values, stale snapshots |
| 11 | Wrong company source / single-company bypass | `wrong-company-source-guard.mjs` | ✅ | 0 violations |
| 12 | Local hardcoded role-array (2nd shape of #1) | `hardcoded-role-check-guard.mjs` (extended) + frontend sweep done | ✅ | Backend + frontend both swept clean |
| 13 | Frontend payload missing backend-required field | `frontend-payload-guard.mjs` | ✅ | 0 violations outside baseline |

**A new pattern surfaced this session, not yet numbered among the 13 — worth folding in
during the next design-doc pass:** *"Route/handler references a resourceCode that was
never actually provisioned in the ACL catalog"* — found twice in one verification pass
(§3 below). Unlike pattern #8 (route/registry file mismatch), this is specifically about
a resourceCode that **is** correctly wired in the registry but has **zero real grant rows**
in `acl.menu_master`/`acl.capability_menu_actions` — meaning the route silently 403s (or
worse, its handler's own secondary check silently always-denies) for every non-admin user,
invisible in dev because dev test users are all admin/full-access. **No guard script
exists for this yet** — the only way it was caught was manually running `select
resource_code, count(*) from acl.precomputed_acl_view where resource_code = '...' group by
1` for every resourceCode touched before trusting it. Worth building a guard: cross-
reference every `resourceCode` string in `route-acl-registry.ts` against
`acl.menu_master.menu_code` existence, both dev and prod.

Run all 9 CI-wired guards locally any time before trusting a change is clean:
```bash
for s in stock-posting-guard route-acl-registry-guard company-scope-guard company-scope-write-acl-guard hardcoded-role-check-guard wrong-company-source-guard approver-chain-guard resource-code-domain-guard frontend-payload-guard; do node scripts/$s.mjs; done
```

---

## 3. Company-Scope Write-ACL Gap — Phase 2 (in progress, most important pending item)

**Full detail: memory file `project_company_scope_write_acl_gap.md`** (auto-loaded via
`MEMORY.md` index every session) — read that file in full before touching this again, it
has the exact remediation pattern, the shared helper's location, and both live-bug
writeups. Summary here for orientation only:

- **The gap:** ~127 write handlers across the whole backend resolve a caller-supplied
  `company_id` (body/query/fetched-row) and mutate, but only check company **membership**
  (`assertCompanyScope`), not an EDIT-level ACL grant at that *specific* company. A
  multi-company user with EDIT at their session's active company could write to any other
  company they're merely a member of.
- **Fix pattern:** `_shared/companyResourceAccess.ts`'s `canMaintainCompanyResource(ctx,
  companyId, resourceCode, actionCode)` — a generic helper (works for any module). Call it
  right after the existing `assertCompanyScope()` block, using the SAME resourceCode:action
  the route itself already requires (look it up in `route-acl-registry.ts`, don't re-derive).
- **Progress:** Production module's `process_order.handlers.ts` (10 handlers) and
  `packing_order.handlers.ts` (7 handlers) — **17 of ~127 done**. Removed from the guard's
  `BASELINE` list as each was fixed (ratchet correctly shrank, `node
  scripts/company-scope-write-acl-guard.mjs` confirms 0 violations right now).
- **Remaining scope:** om/ (8 files, 16 handlers), procurement/ (15 files, 53 handlers),
  production/ remaining (12 files, ~41 handlers — `costing_group`, `mts_sku_rate`,
  `opening_genealogy`, `pack_bom`, `partial_reversal`, `plan_feed`, `segment_location`,
  `sfg_qa`, `stroke_change_request`, `stroke_master`, `batch_series`,
  `conversion_cost`). The guard script's own `BASELINE` array is the authoritative list of
  exactly which `file::functionName` pairs are still unfixed — read it directly rather than
  trusting this count as it will drift.
- **Recommended next module:** whichever the business owner picks — no technical
  dependency between modules, pure "pick one, sweep it" work. Given today's pattern (2 live
  bugs found via cross-checking resourceCode existence), **budget extra time per module for
  that verification step**, not just the mechanical fix.
- **Two real, independently-discovered live bugs, found + fixed while verifying today's
  17 fixes** (same root cause as the new pattern noted in §2 — a resourceCode with zero
  real ACL grants):
  1. `PROD_PACKING_PO_FINAL` (Packing PO's `/correct` route) — never existed in
     `acl.menu_master`, live since 2026-07-13. Fixed by reusing `PROD_PO_FINAL` instead.
  2. `PROD_START_BATCH` — never provisioned in dev's ACL catalog (though **prod already
     had it correctly set up** via a dedicated `CAP_PROD_START_BATCH` capability — dev and
     prod had drifted). Dev now provisioned to match functionally (via broader
     `CAP_PROD_OPERATOR`/`CAP_PROD_STANDARD` capabilities instead of prod's dedicated one —
     business owner explicitly said leave this dev/prod capability-model mismatch as-is,
     both work).
- **Prod deploy note:** none needed for this session's Phase 2 code changes — every
  resourceCode:action pair the 17 fixed handlers now check is a pre-existing, already-live-
  in-prod resource (confirmed for `PROD_PO_CREATE`/`PROD_PO_EDIT`/`PROD_QA_QUEUE`/
  `PROD_PO_FINAL`/`PROD_PO_VERIFY`/`PROD_REVERSAL`). The `PROD_PACKING_PO_FINAL`→
  `PROD_PO_FINAL` code fix needs no prod data change either (target resource already exists
  there). `PROD_START_BATCH` needed no prod data change (already correct there).

---

## 4. SU24 — automatic dependency-provisioning mechanism (not started)

- **Status:** brief written, ready to hand to Codex, **implementation not started.**
- **Brief location:** `docs/CODEX-SU24-DEPENDENCY-PROVISIONING-TASK-BRIEF.md`
- **What it's for:** auto-detecting missing cross-module ACL/menu dependencies by
  matching `docs/Operation Management/implementation-specs/PAGE-DEPENDENCY-MANIFEST.json`
  against live ACL data (the manifest itself may be stale — re-verify before trusting it,
  per its own header note).
- **Dependency:** none blocking — can be picked up any time. Task tracker also has this as
  item "Build SU24-style automatic dependency-provisioning mechanism" (still pending as of
  this session).

---

## 5. CSN Tracker — 3 real bugs found + fixed this session (Procurement, PO/CSN module)

Not previously tracked anywhere else — new ground covered this session, worth a memory
entry if picked up again. Full detail in git commit `27a8fe89`'s message. Summary:

1. `grn.handlers.ts`'s GRN→CSN sync-back never included `invoice_date` (only
   `invoice_number`) — fixed, both Domestic and Import branches now sync it.
2. `CSNTrackerPage.jsx`'s expand-drawer "Transporter" field was hardcoded to read/write
   `transporter_id` only — but Domestic CSNs store their transporter in a **separate**
   `domestic_transporter_id` column (the GRN sync writes to the right one; the UI was
   reading the wrong one). Fixed: now branches on `csn_type`.
3. **Design change (business owner override):** CSN edits used to hard-block (400) once
   status reached `GED`/`GRN_DONE` (GATE_ENTRY_DONE/GRN_DONE) — now only `CANCELLED`/
   `KNOCKED_OFF` stay blocked. Editing a post-GE/GRN CSN now shows a one-time English
   confirm ("Gate Entry / GRN has already been posted... are you sure?") at Save click
   (not per field). Backend: `EDIT_BLOCKED_CSN_STATUSES` in `csn.handlers.ts`. Frontend:
   `POST_PROCESS_CSN_STATUSES` + `openActionConfirm()` gate in `saveExpandedRow()`.
- One specific prod CSN (`CSN-3000000020`) was backfilled via MCP (its stuck-null
  `invoice_date`, with a proper `csn_field_history` audit row) since the code fix only
  helps future GRNs.
- **Not yet done:** any similar audit of the *other* modules with the same "resourceCode
  might be provisioned in code but not in ACL data" or "GRN-style sync-back might be
  silently missing a field" risk pattern — this was found by chance while investigating a
  user-reported symptom, not a systematic sweep. If the business owner wants this pattern
  hunted elsewhere, that's new, unscoped work.

---

## 6. OM Implementation Log — where Gate-by-Gate history lives

- **File:** `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`
  (~3900 lines, chronological, Codex-implemented-Claude-verified entries per
  `[[project_claude_codex_workflow]]`'s standing default).
- **Latest entries** (as of this session, unrelated to this session's own work — this
  session's fixes were Claude-direct, not through the Codex loop, so they are *not* logged
  here, only in git commit messages + this handoff doc + memory): PO11 (Procurement
  Planning) hardening passes, 2026-08-09.
- **Gate status table:** CLAUDE.md §10 has the authoritative Gate-11 through Gate-27
  status table (all ✅ VERIFIED through Gate-26; Gate-27 "🔴 Design in progress" — though
  in practice Gate-27's FG Domain work is now extensively built per CLAUDE.md §6's detailed
  session-by-session log, that status line is stale relative to the detailed narrative
  further down the same file — trust the detailed §6 narrative over the summary table for
  Gate-27 specifically).
- **Next OM action per CLAUDE.md §10:** none currently blocking — Gate-27's remaining
  pieces (Dispatch/L5, Return design) are sequenced in CLAUDE.md §6, see §7 below.

---

## 7. Feasibility doc — pending design sections (not yet locked)

**File:** `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
(~17,700 lines — never read in full, always jump to the specific section number named in
CLAUDE.md §6's narrative).

**Locked sequencing (CLAUDE.md §6, do not jump ahead of this order):**

1. ~~Packing PO (full Standard→Final cycle)~~ — ✅ done, extended with COR6 correction this session.
2. ~~Reservation engine~~ — ✅ done (Packing PO's own batch-specific SFG reservation, §83.5-addendum).
3. ~~Plan Feed (FO) page~~ — ✅ redesigned + implemented (§83.18-REVISED).
4. ~~SO~~ / ~~Dispatch/L5 groundwork (Sales Module Stage 1-3)~~ — ✅ **Sales Module fully
   implemented** through PGI + Invoice (§113.15), RM/PM/INT scope. **FG Dispatch (Phase 2)
   explicitly NOT started** — separate future session.
5. **Next up, locked order:** Dispatch (L5) + Costing/AP-Reco derivation report — **must be
   designed together, same session** (business owner's own explicit lock, 2026-07-21 —
   Dispatch's design IS the AP-Reco formula's numerator). → then Return Receipt + QA Usage
   Decision → then extend PR19 to cover return-salvage. This 3-step chain is the next
   **major undesigned area** — do not start coding against a guessed Dispatch shape.
6. **§111 WAR/Landed-Cost gap** — documented, deferred, explicit 4-step priority order
   locked (Dispatch → Costing/AP-Reco → Accounts Module redesign → WAR implementation).
   Not started.
7. **MTS/MTEST Opening Stock** — flagged as needing its own dedicated sign-off session
   (deferred 2026-07-22, not yet held).
8. **PID (Physical Inventory, L7)** — noted as needing a formal session, not started.

**Recently locked, implementation complete, safe to build on top of (do not re-design):**
IN02/IN03 redesigns (§116/§117), Opening Rate Recalculate mechanism (§109, full RM→SFG→FG
cascade verified), SAP-identical Multi-UoM (§110, Phases A-C done, D/E deferred to PID/L5
sessions), Pack BOM company-wise + auto-sync (§83.15), MTS/IWC discovery (§108, List A
items 1-7 done, item 8 — batch-blind reversal for PMTS — check current status before
assuming done).

---

## 8. ACL documentation — the full doc set, one paragraph each

- **`docs/Operation Management/PROD-ACL-Access-Decisions.md`** — the SSOT for *every*
  ACL group's page-by-page prod decision. Has the Post-Implementation Checklist (run after
  implementing any ACL group) and the Appendix pointer to CLAUDE.md's 13-pattern list.
  Read this before touching ANY ACL group's data.
- **`docs/Operation Management/implementation-specs/PAGE-DEPENDENCY-MANIFEST.json`** —
  every frontend page's declared API/resource dependencies. May be stale (SU24's whole
  purpose is auto-verifying this) — re-verify before trusting.
- **`scripts/acl-master-drift-check.mjs`** — run after every ACL data change; finds gaps
  where ACL-MASTER (P0076) doesn't have a capability a lesser role does.
- **`supabase/functions/api/_acl/route-acl-registry.ts`** — ground truth for which
  resourceCode:action gates every backend route. **Now proven not to be sufficient on its
  own** — a resourceCode can be correctly wired here and still have zero real ACL grants
  (see §2's new pattern, §3's two live-bug writeups). Cross-check against
  `acl.precomputed_acl_view` before trusting a resourceCode is truly live.
- **`docs/ACL_SETUP_PROGRESS.md`** — the original 16-step ACL setup plan with SQL.
- **`docs/ACL_SSOT.md`** — ACL architecture (LOCKED).
- **`_shared/companyResourceAccess.ts`** — new this session, the reusable
  `canMaintainCompanyResource()` helper for Phase 2's write-ACL fix (§3).
- **`_shared/acl_snapshot.ts`** — `readAclSnapshotDecisionAny()`, the low-level
  `precomputed_acl_view` lookup the helper above wraps.

---

## 9. Consolidated pending-task checklist (everything not yet done, one list)

**High-priority, explicitly tracked, business-owner-confirmed as must-do:**
- [ ] Company-scope write-ACL gap Phase 2 — 17/127 handlers done, ~110 remain across
  om/procurement/production (§3).
- [ ] Dispatch (L5) + Costing/AP-Reco derivation report — formal design session needed,
  locked as the next major undesigned area (§7).
- [ ] Return Receipt + QA Usage Decision, then PR19 return-salvage extension — sequenced
  after Dispatch (§7).

**Tracked, lower urgency / explicitly deferred:**
- [ ] SU24 automatic dependency-provisioning mechanism (§4) — brief ready, not started.
- [ ] §111 WAR/Landed-Cost gap — 4-step priority order locked, not started (§7).
- [ ] MTS/MTEST Opening Stock — needs its own sign-off session (§7).
- [ ] PID (Physical Inventory, L7) formal session — not started (§7).
- [ ] FG Dispatch (Sales Module Phase 2) — explicitly separate future session (§7).
- [ ] Build a guard script for "resourceCode wired in registry but zero real ACL grants"
  — the new pattern found twice this session (§2). No script exists yet.
- [ ] Task tracker also carries these as still-pending from earlier sessions (verify
  current status before resuming, may be stale):
  - Fix hardcoded `QA_ALLOWED_ROLES` bypass in `qa_test_method.handlers.ts` (pattern #1/#12).
  - Audit `sto.handlers.ts`, `csn.handlers.ts`, `sales_order.handlers.ts`,
    `rtv.handlers.ts`, `gate_entry.handlers.ts` for company-scope gaps (in progress).
  - Add JSDoc + `checkJs` for real-time payload-shape checking (dev-time signal for
    pattern #13, complementing the existing CI guard).
  - Step 4 pilot: Capability Pyramid for Production department (in progress, unclear
    exact remaining scope — check `docs/Operation Management/implementation-specs/`
    for the relevant brief before resuming).

**Explicitly NOT pending (verify before re-doing):**
- COR6 correction mechanism (Process PO Verify + Packing PO Final) — done, verified
  against real prod data, this session (§1).
- CSN Tracker's 3 bugs — done, this session (§5).
- Sales Module (SO/STO through PGI+Invoice, RM/PM/INT scope) — done (§7).
- IN02/IN03/Opening-Rate-Recalculate/Multi-UoM/Pack-BOM — done (§7).

---

## 10. How to resume — recommended reading order for a fresh session

1. `CLAUDE.md` (auto-loaded) — full read, especially §3 (13 bug patterns), §6 (session
   history + locked sequencing), §8/8A-8D (architecture rules, mandatory dev rules).
2. This doc, in full.
3. Whichever memory file matches the task being picked up (check `MEMORY.md`'s index
   first — every memory file's one-line description tells you if it's relevant).
4. Only then open the specific feasibility-doc section, OM-IMPLEMENTATION-LOG.md tail, or
   PROD-ACL-Access-Decisions.md section named for that task above — don't read those files
   in full, they're too large; jump to the named section/entry.
