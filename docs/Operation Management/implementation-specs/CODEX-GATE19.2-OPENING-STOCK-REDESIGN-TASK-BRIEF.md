# CODEX-GATE19.2-OPENING-STOCK-REDESIGN-TASK-BRIEF

**Gate:** 19.2 (follow-up to Gate-19 Opening Stock Migration)
**Domain:** PROCUREMENT / INVENTORY
**Title:** Redesign IN05 (Opening Stock entry) dense-table UI, add IN06 (Opening Stock Approval), enforce company-scoping ACL
**Scope:** Frontend rewrite of `OpeningStockDetailPage.jsx`'s entry table + new `OpeningStockApprovalPage.jsx` + backend company-scoping check + routes/ACL/menu wiring
**Reference doc:** feasibility Section 29.5 "IN05/IN06 Opening Stock Page Redesign" (LOCKED — 2026-07-12) — read this in full before starting, it is the single source of truth for every field, column, and rule in this brief.

**Mandatory — read `CLAUDE.md` in full before starting, specifically:**
- §8A — no raw UUIDs anywhere: Material Name/Pace Code/Storage Location must all resolve to human-readable labels, bulk-fetched.
- §8B — batch vs sequential DB loops: the IN06 batch-save (multiple corrected lines saved together) must batch its updates, not loop one row per round trip.
- §8C — stock posting document_number/item_number: unchanged, already correct in the existing `postOpeningStockDocumentHandler` — do not modify the posting engine itself.
- MCP vs migration scope: the company-scoping check is a code change (handler logic), no schema change needed — do not write a migration for it.

---

## Why this brief exists

The Gate-19 Opening Stock UI shipped as oversized cards with no visual consistency with the rest of the app, no dedicated approval step separate from data entry, and no check that a user creating or approving a document is actually scoped to that document's company. Business owner redesigned it end to end (2026-07-12), modeled on the Process PO Create Page 3 dense-table look.

---

## Change 1 — IN05 entry page: dense table redesign (`OpeningStockDetailPage.jsx`)

Replace the current Bulk Entry grid (the paginated `ErpDenseGrid` added in the prior session) with a **plain HTML `<table>`** styled exactly like `ProductionPOCreatePage.jsx`'s Page 3 Material Table:
- Card wrapper: `rounded-lg border border-slate-200 bg-white`, with a small header bar (`border-b border-slate-200 px-4 py-3`, `<h4 className="text-sm font-semibold text-slate-800">`).
- `<table className="w-full min-w-[...] border-collapse text-sm">`, header row `bg-slate-50 text-xs uppercase tracking-wide text-slate-500`, cells `border-b border-slate-100 px-3 py-2`.

Columns, in this exact order: **Sl No | Material Type | Material Name | Pace Code (auto) | Storage Location (dropdown, no location-type restriction) | Status (stock type dropdown) | Base UOM (auto, read-only) | Counted Stock (input) | Zero Stock (checkbox) | Rate (input, optional/blank) | Total Value (computed) | Action (remove)**.

- Material Name column wide (this is the primary lookup field — keep it a full `ErpComboboxField`). Storage Location / Status / Counted Stock columns comparatively narrow.
- **Material Type** is a new column not present before — derive it from the selected material (`material_master.material_type`: RM/PM/FG/SFG/INT), resolved via the existing materials list, no new endpoint needed.
- **Remove pagination entirely from this page** — the 10-row `BULK_PAGE_SIZE` pagination added in the immediately-prior session must be deleted. All rows render in one scrollable table.
- Keep Single Entry / Bulk Entry toggle buttons as-is (already correct per business owner).
- Keep Add Row, Submit For Approval, Back To List, Refresh actions as-is.

**Currency — matches the already-established PO/CSN/STO pattern, do not invent a new mechanism.** `POCreatePage.jsx` already does exactly this: `const CURRENCY_OPTIONS = ["INR", "USD"];`, default `"INR"`, a plain `<select>`, stored as a `currency_code` TEXT column (no master table, no FX conversion — `csn.handlers.ts` just reads back whichever line's stored value). Apply the same here:
- Add `currency_code TEXT NOT NULL DEFAULT 'INR'` to `erp_procurement.opening_stock_document` (one small migration — this is a genuine schema addition, unlike the company-scoping check).
- Frontend: same `CURRENCY_OPTIONS = ["INR", "USD"]` constant, a `<select>` on the document header (Page 1, next to Cut-off Date), default `"INR"`.
- `Intl.NumberFormat` calls for Total Value formatting read the document's stored `currency_code` (map `"INR"` → locale `"en-IN"`, `"USD"` → `"en-US"`) instead of the old hardcoded `"en-BD"/"BDT"`.
- IN06's approval page displays the same stored `currency_code`, read-only (currency is set once at creation, not re-chosen at approval).

---

## Change 2 — IN06 Opening Stock Approval (new page + backend)

**TX code:** `IN06` (confirmed next-available in the `erp_menu.menu_master` IN-series via direct DB check — IN01 through IN05 already assigned).

**Backend — new handlers** (in `opening_stock.handlers.ts`, reusing existing document/line fetch helpers already in that file):
1. `GET /api/procurement/opening-stock/by-number/:documentNumber` (or similar — check existing route conventions in `procurement.routes.ts` before inventing a new one) — looks up a document by its global `document_number`, returns full hydrated document + lines (reuse `hydrateOpeningStockDocument`).
2. A batch line-update endpoint — receives an array of corrected lines in one request, updates them all in one batched operation (§8B — do not loop one `UPDATE` per line sequentially if they're independent; a single `UPSERT`/multi-row update is fine since these are truly independent row edits).
3. Reuse the existing `approveOpeningStockDocumentHandler` and `postOpeningStockDocumentHandler` for the actual Approve action — **do not duplicate the posting logic**, this brief only adds the batch-correction step in front of it.

**Backend — company-scoping check (applies to BOTH IN05 create and IN06 approve):**
- In `createOpeningStockDocumentHandler`: for non-admin roles, reject (403) if the submitted `company_id` doesn't match `ctx.context.companyId`. For SA/GA (`ctx.context.isAdmin === true`, or however admin is already detected elsewhere in this codebase — check `role_ladder.ts`/`isSuperAdmin`/`isGlobalAdmin` before inventing a new check), bypass this restriction entirely.
- In `approveOpeningStockDocumentHandler` (or wherever Approve is actually gated): same check — reject with a clear error message ("You are not scoped to company X — switch your work context to approve this document") if `ctx.context.companyId !== document.company_id`, again bypassed for SA/GA.
- `ctx.context.companyId` comes from `_pipeline/context.ts`'s already-resolved `ContextResolution` — this is the SAME mechanism every other ACL-gated handler in this codebase already relies on. Do not build a new company-membership check from `erp_map.user_companies` from scratch; the pipeline has already done that resolution before the handler runs.

**Frontend — new `OpeningStockApprovalPage.jsx`:**
- Page 1: single field, Document Number → Enter (no Company field — document number is globally unique).
- Page 2: full line table, same dense-table visual style as Change 1, but **with pagination — 25 rows/page** (this is the one place pagination belongs in this whole redesign). Every field is editable inline. Row edits accumulate in local component state across page navigation (switching pages must not lose unsaved edits — same `keepAlive`-style local-state pattern already used for IN05's bulk grid before pagination was removed from it). A single "Save Corrections" action batch-saves all edited rows via Change 2's batch endpoint. Only after that succeeds does "Approve" become available, which calls the existing approve+post flow.
- `useQuery`, not `useEffect` + manual fetch (CLAUDE.md standing rule).

**Frontend — routes/ACL/menu wiring:**
- Register `OpeningStockApprovalPage.jsx` route in `procurement.routes.ts`/whatever route file already carries IN05, following the exact same pattern.
- Register `PROC_OPENING_STOCK_APPROVAL` menu entry (`erp_menu.menu_master` + `acl.menu_master`), tx_code `IN06`, nested correctly under the same parent group IN05 lives under (`GRP_ACL_INVENTORY`) — get `parent_menu_id` right the first time, do not repeat the PR18 sidebar-visibility bug from Gate-27.
- Grant `CAP_PROC_INVENTORY` VIEW+WRITE on the new menu entry, same capability IN05 already uses.

---

## Hard rules

1. Do not touch the actual stock-posting RPC call (`post_stock_movement`) or its P561/P563/P565 movement-type selection — this brief is entry/approval UX and an ACL gate only.
2. Currency is resolved per Change 1: add the `opening_stock_document.currency_code` column (default `'INR'`), matching PO's existing pattern exactly — do not add a full currency master table, FX conversion, or per-line currency (Opening Stock is document-level, one currency per document).
3. SA/GA must bypass the company-scoping check entirely — do not accidentally block them.
4. No raw UUIDs anywhere in either page (R-01).
5. IN05's entry table has no pagination; IN06's approval table has pagination (25/page). Do not swap these.

## Out of scope

- A real currency master table or FX conversion — only the PO-style hardcoded `["INR","USD"]` + stored `currency_code` column, per Change 1
- Any change to WAR/costing (Section 104, separate deferred item)
- Opening Stock's UOM-conversion mechanism (flagged in a prior session note — only one material in Dev has a registered alternate UOM and its conversion factor isn't even set; not touched here)

## Verification

1. Confirm the IN05 entry table renders with zero pagination and matches the Process PO Page 3 visual style (screenshot comparison).
2. Confirm a non-admin user creating an Opening Stock document for a company outside their resolved work context gets a clear 403, not a silent wrong-company document.
3. Confirm the same block applies to IN06's Approve action for a mismatched multi-company approver.
4. Confirm IN06's Page 2 pagination preserves unsaved row edits across page changes before the batch save.
5. Confirm Approve still posts via the existing P561/P563/P565 engine unchanged.
6. Confirm the new IN06 menu entry nests correctly under Inventory (not top-level) on first load — verify directly, don't assume.
7. `deno check` and `eslint`/`npm run build` clean (only pre-existing shared-typing errors already documented in prior Gate-27 log entries, zero new).

## Log + commit

- Append one entry to `docs/Codex-Log.md`
- Do not run git commands
