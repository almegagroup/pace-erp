# OM-GATE — Inward QA Page Redesign (Full Spec)
# PACE-ERP Operation Management — erp_procurement

**Supersedes/Extends:** Gate-13.6 (DB), Gate-16.5 (Backend), Gate-17.5 (Frontend) — all previously VERIFIED
**Status:** FROZEN — Ready for implementation
**Design Reference:** Section 101 (Inward QA — original) + this document (redesign, locked 2026-07-08)
**Locked in session:** 2026-07-08

---

## 1. Why This Redesign

Original Gate-17.5 frontend (`QAQueuePage.jsx` + `QADocumentPage.jsx`) shipped with three problems discovered in this design session:

1. **No reusable test method / limits master.** Every GRN's QA required free-typing test parameter names and had no LSL/USL concept — pure text fields, no reuse, no standardization, spelling-mistake risk.
2. **Storage location was a manual QA input** (free-text UUID field with a datalist) — wrong, because Stores already fixes the storage location at GRN time. QA usage decision never physically moves the material between storage locations; it only reclassifies stock type (QUALITY_INSPECTION → UNRESTRICTED/BLOCKED/FOR_REPROCESS/SCRAP) at the *same* location. PACE ERP has no bin-level WM yet (Phase-3 item), so there is nothing for QA to "choose."
3. **Frontend blocked partial usage decisions** (`decisionSubmitDisabled` required `allocatedQty === totalQty` exactly), even though the original DB/backend spec (Gate-13.6, Gate-16.5) explicitly designed for partial decisions (`status: PENDING → IN_PROGRESS → DECIDED`, multiple `inward_qa_decision_line` rows summing to `qa_stock_qty` over time). This was a frontend regression against the original design, not a new capability.

This document is the full, locked spec for the redesigned page. It reuses the CSN Tracker (`CSNTrackerPage.jsx`) expandable-row UI pattern instead of a separate detail-page navigation.

---

## 2. Roles & Permissions

| Role | Can view queue | Can enter test results | Can submit UD (incl. FOR_REPROCESS) | Can create Test Method Config | Can edit Test Method Config | Can delete Test Method (MCT only, untested) |
|---|---|---|---|---|---|---|
| QA_OFFICER | ✅ | ✅ | ✅ (no FOR_REPROCESS) | ✅ | ❌ | ❌ |
| QA_MANAGER (STORE_MANAGER/PROCUREMENT_HEAD role code) | ✅ | ✅ | ✅ (incl. FOR_REPROCESS) | ✅ | ✅ | ✅ |
| **DIRECTOR** | ✅ | ✅ | ✅ (incl. FOR_REPROCESS) | ✅ | ✅ | ✅ |
| SA | ✅ (all companies) | ✅ | ✅ (incl. FOR_REPROCESS) | ✅ | ✅ | ✅ |

> **Director gets full authority for now** (same level as QA Manager/SA) — explicit decision for this phase. Revisit later if a narrower Director scope is wanted.

Backend role constant changes (`inward_qa.handlers.ts`):
```ts
const QA_ALLOWED_ROLES  = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "QA_OFFICER", "STORE_MANAGER"];
const QA_MANAGER_ROLES  = ["SA", "DIRECTOR", "PROCUREMENT_HEAD", "STORE_MANAGER"];
```

---

## 3. Page 1 — QA Queue (List + Expandable Row)

**Screen code:** `PROC_QA_QUEUE` | **TX Code:** `PO06` | **Route:** `/dashboard/procurement/qa-queue`
**UI pattern:** Same component family as `CSNTrackerPage.jsx` — dense grid with a per-row expand toggle (▼/▲) that opens an inline panel below the row. No separate detail-page navigation (`PROC_QA_DOCUMENT` screen code is retired/merged into this page).

### 3.1 Company Resolution
- **DIRECTOR** → company selector dropdown shown, user picks any company they have access to
- **All other roles** → company auto-resolved from work context / parent company (no dropdown), matches existing `runtimeContext.selectedCompanyId` pattern

### 3.2 Filters (top of page)
| Filter | Options | Default |
|---|---|---|
| Status | PENDING / IN_PROGRESS / DECISION_MADE / ALL | **ALL** (main page shows everything; selecting a value narrows it) |
| Date range | GRN posting date — from/to | blank (no restriction) |
| Search | free text — GRN number, material, assignee | blank |

### 3.3 List Columns (per row, collapsed state)
| Column | Source |
|---|---|
| GRN Number | `goods_receipt.grn_number` via `grn_id` |
| Material | `material_master.material_name` (never raw ID) |
| Category | `material_master.material_category` (per R-01, resolved label, not ID) |
| Quantity | `inward_qa_document.qa_stock_qty` + `uom_code` |
| Status flag | PENDING (amber) / IN_PROGRESS (sky) / DECISION_MADE (emerald) — also show **Remaining Qty** badge if `qa_stock_qty − Σ decision_qty > 0` |
| Expand toggle | ▼ opens inline panel |

### 3.4 Expandable Row Panel — full layout

```
┌───────────────────────────────────────────────────────────┐
│ GRN 200006 · Material X · Category: Biocide · 500 KG       │
│ Storage Location: WH-01 — Main RM Store   (read-only)       │
├───────────────────────────────────────────────────────────┤
│  TEST RESULTS                                               │
│   ┌─ MCT ─────────────────────────────────────────────┐     │
│   │ pH          LSL 6.5   USL 8.0   Result:[__] PASS   │     │
│   │ Viscosity   LSL 100   USL 200   Result:[__] FAIL   │     │
│   │ [+ Add Method]                                     │     │
│   └─────────────────────────────────────────────────────┘   │
│   ┌─ OTHR ────────────────────────────────────────────┐     │
│   │ Colour      LSL —     USL —     Result:[__] (opt.) │     │
│   │ [+ Add Method]                                     │     │
│   └─────────────────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────┤
│  USAGE DECISION                                             │
│   Total: 500 KG   Decided: 480 KG   Remaining: 20 KG         │
│   ┌─ Split 1 ──────────────────────────────────────────┐    │
│   │ Qty:[480]  Decision:[RELEASE ▼ (suggested)]         │    │
│   │ Storage Location: WH-01 — Main RM Store (read-only) │    │
│   │ Remarks:[___]                                       │    │
│   └──────────────────────────────────────────────────────┘  │
│   [+ Add Split]                     [Submit Decision]        │
│                                                               │
│  (Remaining 20 KG stays in QUALITY_INSPECTION — row stays    │
│   open with status IN_PROGRESS until fully decided)          │
├───────────────────────────────────────────────────────────┤
│  POSTED DECISIONS (read-only, once submitted)                │
│   Split 1: RELEASE 480 KG · P321 · POSTED                    │
└───────────────────────────────────────────────────────────┘
```

---

## 4. New Master — Test Method Configuration

### 4.1 Concept
- **Test Group**: fixed enum for now — `MCT`, `OTHR`. (Extendable later if needed — deferred, not in this phase.)
- **Test Method**: a named test (e.g. "pH", "Viscosity"). Stored **per company, per test group** — a *global pool*, not category-bound. The same method can be reused across multiple categories via a dropdown (avoids retyping / spelling mistakes).
- **Category Test Config**: the actual assignment — for a given **Company + Material Category + Test Method**, defines **LSL** and **USL**. This is what actually drives what shows up when QA opens a GRN of that category.

### 4.2 Behavior
- First time QA works a GRN of a **new category** (e.g. Biocide, never configured before): QA (or Manager) picks Test Group (MCT/OTHR), then either selects an **existing method from the group's global dropdown** (if a similar one exists from another category) or types a **new method name** (which is added to the global pool for that group), then sets **LSL/USL** for this category.
- Next time a **different category** (e.g. SR) is being configured and shares a method name (e.g. "pH" also used for Biocide): the method shows up in the dropdown — QA just picks it and sets **SR's own LSL/USL** for it (LSL/USL values are always category-specific, method name is shared).
- Once a category has a config, subsequent GRNs of that category **don't need re-setup** — the existing method + LSL/USL list is used directly for result entry. QA can still **add** more methods to that category's config at any time.

### 4.3 Field Rules
| Field | MCT | OTHR |
|---|---|---|
| Result entry | **Mandatory** — blocks Usage Decision submit if empty | Optional — does not block submit |
| Pass/Fail | Auto-computed from Result vs LSL/USL (numeric compare) | Not computed (or computed if LSL/USL present, else n/a) |
| LSL/USL | Required when creating the method config | Optional |

### 4.4 CRUD Permissions
| Action | Who |
|---|---|
| Create new Test Method / Category Config | QA_OFFICER, QA_MANAGER, DIRECTOR, SA |
| Edit LSL/USL on existing config | QA_MANAGER, DIRECTOR, SA only |
| Delete a Test Method from a category config | QA_MANAGER, DIRECTOR, SA only — **AND only if `test_group = 'MCT'` AND no result has ever been entered against it** (untested). OTHR methods are never deletable via this rule (no delete path defined for OTHR in this phase). |

---

## 5. Test Result Entry

- For the GRN's material category, the expandable panel loads the Category Test Config (MCT list + OTHR list) for that company + category.
- QA enters Result value per method. Pass/Fail auto-calculated for numeric methods against LSL/USL (Result < LSL or > USL → FAIL, else PASS).
- If the category has **no config yet** (first time), the panel shows an inline "Set up test methods for this category" mini-form instead (Section 4.2 flow), then proceeds to result entry once saved.

---

## 6. Usage Decision (UD)

### 6.1 Storage Location — auto-inherited, read-only
- QA does **not** choose a storage location.
- Defaulted from the GRN line's `storage_location_id` (already set by Stores at GRN posting time).
- Displayed as `location_code — location_name` (read-only field), never editable in this page.
- Backend: `submitUsageDecisionHandler` derives `storage_location_id` from the GRN line automatically — the request payload no longer needs to send it.

### 6.2 Quantity Split + Decision Dropdown
- Multiple split rows allowed (add/remove), same pattern as current code.
- Each split: Quantity + Decision dropdown (`RELEASE` / `BLOCK` / `REJECT` / `SCRAP` / `FOR_REPROCESS` — last one only visible to QA_MANAGER/DIRECTOR/SA) + Remarks.
- **Default dropdown suggestion** (pre-selected, not hard-locked):
  - All mandatory (MCT) test results PASS → default **RELEASE**
  - Any MCT result FAIL → default **BLOCK**
  - QA/Manager can override to any option regardless of test result — **no hard block based on pass/fail**. Business judgment (rate dispute, partial reprocess decision, etc.) can override the suggested default.

### 6.3 Partial Decisions — restoring original DB-level design
- Submit is allowed for **less than the full remaining quantity**. This matches the original Gate-13.6 DB design (`status: PENDING → IN_PROGRESS → DECIDED`), which the Gate-17.5 frontend had incorrectly blocked.
- After submit: `remaining_qty = qa_stock_qty − Σ(decision_qty across all decision lines, all time)`.
  - `remaining_qty > 0` → document status stays **IN_PROGRESS**, row stays visible/open in the queue, showing the remaining balance.
  - `remaining_qty = 0` → document status becomes **DECIDED** (queue shows `DECISION_MADE`).
- Any decision option (RELEASE/BLOCK/REJECT/SCRAP/FOR_REPROCESS) can be used for any partial batch — no requirement that all splits use the same decision.

### 6.4 Immutability After Posting
- Once a decision line is posted (`posting_status = POSTED`), it is **never edited or reversed from this page**.
- If a released/blocked/etc. lot needs to be re-routed later (discovered defect after release, etc.), that is **out of scope for this page** — handled by a separate future Stock Reclassification page (movement types `P322`/`P323`/`P324`/`P343`/`P349`/`P350` already exist in `movement_type_master` and are reserved for that future flow — not used here).

---

## 7. Data Model Changes

### 7.1 New Tables (erp_master schema — company-scoped masters)

```sql
-- Test Method — global pool per company + test group
CREATE TABLE erp_master.qa_test_method (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,                          -- cross-schema, plain uuid
  test_group    text NOT NULL CHECK (test_group IN ('MCT', 'OTHR')),
  method_name   text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, test_group, method_name)
);

-- Category Test Config — LSL/USL per Company + Material Category + Method
CREATE TABLE erp_master.qa_category_test_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,                       -- cross-schema, plain uuid
  material_category text NOT NULL,                       -- matches material_master.material_category value
  test_method_id    uuid NOT NULL REFERENCES erp_master.qa_test_method(id) ON DELETE RESTRICT,
  lsl               numeric(20,6) NULL,
  usl               numeric(20,6) NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_updated_by   uuid NULL,
  last_updated_at   timestamptz NULL,
  UNIQUE (company_id, material_category, test_method_id)
);
```

> **Note:** `material_category` today is a free-text column on `material_master` (no formal master table populated yet — see separate finding from this session). `qa_category_test_config.material_category` matches against that same free-text value. If/when a formal `material_category_master` gets populated and `material_master` gets an FK to it, this table should switch to `material_category_id` at that time — not in this phase.

### 7.2 Alter Existing Tables

```sql
-- inward_qa_test_line: link to the new method master instead of free text
ALTER TABLE erp_procurement.inward_qa_test_line
  ADD COLUMN test_method_id uuid NULL REFERENCES erp_master.qa_test_method(id) ON DELETE RESTRICT,
  ADD COLUMN lsl numeric(20,6) NULL,   -- snapshot at time of test, from category config
  ADD COLUMN usl numeric(20,6) NULL;

-- inward_qa_decision_line: storage_location no longer a manual QA input
-- (value still stored for audit — but populated by handler from GRN line, not from request payload)
```

### 7.3 Removed Frontend-Only Restriction
- Delete the `decisionSubmitDisabled` clause requiring exact `allocatedQty === totalQty` match. Replace with: `allocatedQty <= remainingQty` (partial allowed, over-allocation blocked).

---

## 8. Backend Handler Changes (`inward_qa.handlers.ts`)

| Handler | Change |
|---|---|
| `submitUsageDecisionHandler` | Remove exact-sum validation; validate `Σ decision_qty (this submit) <= remaining_qty`. Derive `storage_location_id` from GRN line, ignore/reject if client sends one. Status → `IN_PROGRESS` if remaining > 0 after this submit, `DECIDED` if remaining reaches 0. |
| `assertQARole` / `assertQAManagerRole` | Add `DIRECTOR` to both role arrays per Section 2. |
| New: `listTestMethodsHandler` | `GET /api/procurement/qa-test-methods?company_id=&test_group=` — list global method pool for dropdown reuse. |
| New: `createTestMethodHandler` | `POST /api/procurement/qa-test-methods` — QA_OFFICER+ can create. |
| New: `listCategoryTestConfigHandler` | `GET /api/procurement/qa-category-test-config?company_id=&material_category=` — returns methods + LSL/USL for a category. |
| New: `upsertCategoryTestConfigHandler` | `POST /api/procurement/qa-category-test-config` — add method to category (QA_OFFICER+); edit LSL/USL (QA_MANAGER+ only). |
| New: `deleteCategoryTestConfigHandler` | `DELETE /api/procurement/qa-category-test-config/:id` — QA_MANAGER+ only, only if `test_group='MCT'` and no `inward_qa_test_line` references this `test_method_id` + category with a non-null result. |

---

## 9. Movement Types Reference (unchanged, for completeness)

| Usage Decision | Movement | Flow | Reversal |
|---|---|---|---|
| RELEASE | P321 | QUALITY_INSPECTION → UNRESTRICTED | P322 |
| BLOCK | P344 | QUALITY_INSPECTION → BLOCKED | P343 |
| REJECT | P344 | QUALITY_INSPECTION → BLOCKED (+ `RTV_PENDING` remark) | P343 |
| SCRAP | P553 | QUALITY_INSPECTION → (destroyed, OUT only) | P554 |
| FOR_REPROCESS | P905 | QUALITY_INSPECTION → FOR_REPROCESS | P906 |

GRN inward (unchanged): **P101** → QUALITY_INSPECTION if `qa_required_on_inward = true`, else straight to UNRESTRICTED (no QA doc created).

---

## 10. Out of Scope (this phase)

- Formal `material_category_master` seeding/normalization (separate cleanup item, noted but not required to ship this redesign)
- Stock Reclassification page for post-decision re-routing (P322/P323/P324/P343/P349/P350 flows)
- LAB test type integration (still manual entry, Phase-2 per original spec)
- Extending Test Group beyond MCT/OTHR
- OTHR method deletion rule (deferred — add later if needed)

---

## 11. Verification Checklist (for future Claude verification pass)

1. `PROC_QA_QUEUE` page uses expandable-row pattern, no separate detail-page navigation
2. DIRECTOR added to `QA_ALLOWED_ROLES` and `QA_MANAGER_ROLES`
3. Storage location field is read-only, auto-derived from GRN line, not in submit payload
4. Partial usage decision submits succeed when `Σ decision_qty (this batch) < remaining_qty`; status stays `IN_PROGRESS`
5. Status becomes `DECIDED` only when `remaining_qty` reaches 0
6. Decision dropdown pre-selects RELEASE/BLOCK based on MCT pass/fail but allows any override — no hard block
7. `qa_test_method` is a global per-company-per-group pool; dropdown across categories reuses existing methods
8. `qa_category_test_config` stores LSL/USL per company+category+method
9. Test Method create → QA_OFFICER allowed; edit LSL/USL → QA_MANAGER/DIRECTOR/SA only; delete → QA_MANAGER/DIRECTOR/SA only, MCT + untested only
10. Once `posting_status = POSTED` on a decision line, no edit/reversal path exists on this page

---

*Spec frozen: 2026-07-08 | Locked in design session | Reference: Section 101 + this document*
