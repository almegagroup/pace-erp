# CODEX TASK — Fix Master-Picker Fetch-Limit Truncation (PO06 root cause)

## Objective

`frontend/src/hooks/queries/useOmMasterQueries.js` exports `useMaterialOptionsQuery`,
`useVendorOptionsQuery`, `useCustomerOptionsQuery` — each wraps a `useQuery` that
fetches a full master-data list **once** with a hardcoded `limit`, then the calling
page builds an in-memory `Map` (`new Map(materials.map(m => [m.id, m]))`) to resolve
`material_id`/`vendor_id`/`customer_id` → display name/category, or to populate a
dropdown's option list, entirely client-side.

Many pages hardcode `limit: 200` (or `300`/`500`) in this call. As the master table
grows past that number, rows sorting beyond the limit are silently missing from the
client-side Map — **with zero error**. The symptom looks exactly like a data bug
("material has no category", raw UUID shown instead of a name, or a dropdown that
mysteriously can't find a valid material/vendor) but it is actually a pagination bug.

Fix it once, centrally, and sweep every call site — not a per-page patch.

---

## Confirmed root cause (live prod data, 2026-08-10, project `bsjpvkigpllichlknmah`)

`erp_master.material_master` has **413** rows: `FG=201, INT=1, PM=45, RM=66, SFG=100`.
The backend list query (`listMaterialsHandler`, `material.handlers.ts`) orders by
`material_type, material_name` ascending. `FG` sorts first and is **201 rows alone**
— meaning any `limit: 200` fetch on this table returns **zero** RM/PM/SFG/INT
materials, ever, full stop.

This is exactly what broke the Inward QA Queue (PO06) page reported by the business
owner: it showed a raw UUID in the Material column and "This material has no category
set on the material master" for material `RM-00057` (HIMFLOWCRETE HWR 9F02) — which
actually has a perfectly valid category (`PCE-WR`) in the DB. The material was simply
never inside the capped 200-row fetch (`QAQueuePage.jsx`'s
`useMaterialOptionsQuery({ limit: 200, offset: 0 })`).

`erp_master.vendor_master` = 78 rows, `erp_master.customer_master` = 15 rows — vendor/
customer picker sites using `limit: 200` are **not** broken yet (78, 15 ≪ 200) but
carry the exact same latent bug shape and will break the same silent way once those
tables grow past 200. Fix them in the same pass.

**Why this "suddenly" appeared:** while material count was under 200, this hardcoded
limit never mattered. Once FG alone crossed 200 rows, every page using this pattern
broke simultaneously, with no code change and no error — just quietly wrong displays.

---

## Step 1 — Add a shared constant

In `frontend/src/hooks/queries/useOmMasterQueries.js`, after the imports and before
`useVendorsQuery`, add:

```js
// Client-side picker/lookup queries (useMaterialOptionsQuery, useVendorOptionsQuery,
// useCustomerOptionsQuery) fetch a master table ONCE and build an in-memory id -> row
// Map on the client, for both display-name resolution and dropdown option lists. A
// too-small `limit` silently truncates whatever rows sort past it as the table grows --
// no error, just blank names / raw UUIDs shown instead of names, or missing dropdown
// options for anything outside the window.
//
// Real incident (2026-08-10): Inward QA Queue (PO06) started showing a raw material
// UUID and "no category" for a real, valid RM material once erp_master.material_master
// crossed ~200 rows (FG alone is 201 rows and sorts first by material_type -- so any
// limit:200 fetch on this table returns ZERO non-FG materials). Over a dozen pages
// across procurement/production shared this exact hardcoded limit:200/300/500 pattern.
//
// Use this constant instead of a magic number for any "load the full picker list"
// query on material/vendor/customer -- one place to raise if a master table ever
// outgrows it. (413 materials / 78 vendors / 15 customers as of 2026-08-10 -- this
// gives generous headroom for all three.)
export const MASTER_PICKER_FETCH_LIMIT = 5000;
```

---

## Step 2 — Replace every hardcoded low limit at these call sites

For every file below: (a) add `MASTER_PICKER_FETCH_LIMIT` to that file's existing
named-import list from `useOmMasterQueries.js` (the hook itself is already imported
there — just add the new name to the same `import { ... } from ".../useOmMasterQueries.js"`
statement, preserving whatever relative path depth the file already uses), and
(b) replace the hardcoded `limit: N` (200/300/500/1000) **inside the specific
`useMaterialOptionsQuery(...)` / `useVendorOptionsQuery(...)` / `useCustomerOptionsQuery(...)`
call** with `limit: MASTER_PICKER_FETCH_LIMIT`.

Do **not** touch any other `limit:` usage in these files (list-page pagination strips,
GRN/PO list limits, etc.) — only the ones inside these three specific hook calls.
Verify the exact current snippet yourself with `grep -n` before editing — line numbers
below are approximate, don't assume they're still exact.

### `useMaterialOptionsQuery` call sites

1. `frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx` (~98, `{ limit: 200, offset: 0 }`)
2. `frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx` (~57, `{ status: "ACTIVE", limit: 500, offset: 0 }`)
3. `frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx` (~176, `{ status: "ACTIVE", limit: 500 }`)
4. `frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx` (~153, `{ status: "ACTIVE", limit: 500 }`)
5. `frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx` — **two** call sites: ~199 `{ status: "ACTIVE", material_type: "PM", limit: 500 }`, and ~928 `{ status: "ACTIVE", limit: 500 }`
6. `frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx` (~66, `{ limit: 200, offset: 0 }`)
7. `frontend/src/pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx` (~57, `{ limit: 500, offset: 0 }`)
8. `frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx` (~93, `{ limit: 500, offset: 0, status: "ACTIVE" }`)
9. `frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockApprovalPage.jsx` (~194, `{ limit: 500, status: "ACTIVE" }`)
10. `frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx` (~48, `{ limit: 200, offset: 0 }`)
11. `frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx` (~285, `{ limit: 500, status: "ACTIVE" }`)
12. ~~`frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx` (~106, `{ limit: 200, offset: 0 }`)~~ — **skip this one in Step 2.** Step 3 below removes this file's `materialQuery` entirely (R-03 fix, not a limit raise) — do not also apply the Step 2 limit-raise pattern here, it would be dead code immediately removed by Step 3.
13. `frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx` (~94, `{ status: "ACTIVE", limit: 1000, company_id: companyId }`)
14. `frontend/src/pages/dashboard/procurement/print/PrintPreviewPage.jsx` (~367, `{ limit: 200, offset: 0 }, { enabled: kind === "STO" }` — has a second `options` arg, preserve it)
15. `frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx` (~150, `{ status: "ACTIVE", limit: 1000, company_id: companyId }`)
16. `frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx` (~79, `{ limit: 200, offset: 0 }`)
17. `frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx` (~50, `{ limit: 200, offset: 0 }`)
18. `frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx` (~73, `{ limit: 300, offset: 0 }`)
19. `frontend/src/pages/dashboard/procurement/transfer/PlantTransferListPage.jsx` (~117, `{ limit: 200, offset: 0 }`)
20. `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx` (~49, `{ limit: 300, offset: 0 }`)
21. `frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx` (~282, `{ limit: 300, offset: 0, status: "ACTIVE" }`)
22. `frontend/src/pages/dashboard/procurement/sto/StoCreateFormPage.jsx` (~227, `{ material_type: materialType || undefined, limit: 200, offset: 0 }` — has a second `options` arg with a comment on following lines, preserve it)
23. `frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx` (~140, `{ limit: 200, offset: 0 }`)

### `useVendorOptionsQuery` call sites

24. `frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx` (~56, `{ status: "ACTIVE", limit: 500, offset: 0 }` — same file as #2, different hook)
25. `frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx` (~49)
26. `frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx` (~47 — same file as #10)
27. `frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx` (~65 — same file as #6)
28. `frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx` (~37)
29. `frontend/src/pages/dashboard/procurement/accounts/BlockedIVListPage.jsx` (~52)
30. `frontend/src/pages/dashboard/om/customer/CustomerCreateForm.jsx` (~91, `{ status: "ACTIVE", limit: 500, offset: 0 }`)
31. `frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx` (~70)
32. `frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx` (~67)
33. `frontend/src/pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx` (~56)
34. `frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx` (~49 — same file as #17, different hook)
35. `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` (~155)
36. `frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx` (~60)
37. `frontend/src/pages/dashboard/procurement/po/POListPage.jsx` (~55)
38. `frontend/src/pages/dashboard/procurement/po/POOrderGroupListPage.jsx` (~35)
39. `frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx` (~78 — same file as #16, different hook)

### `useCustomerOptionsQuery` call sites

40. `frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx` (~72 — same file as #18, different hook)
41. `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx` (~48 — same file as #20, different hook)

---

## Step 3 — Proper R-03 fix for `QAQueuePage.jsx` (the specific page reported)

`OM-IMPLEMENTATION-LOG.md`'s Mandatory Rules R-01 and R-03 apply directly here, and
a plain limit-raise on this one page is not enough to satisfy them — R-03 says a
list endpoint must return its own accurate display data, never make the frontend
fetch a separate list and join client-side. `QAQueuePage.jsx` currently does exactly
what R-03 forbids: it fetches a capped `materialQuery` purely to resolve
`material_name`/`material_category` for display. Fix this at the source instead of
only raising its limit (the limit-raise from Step 2 still applies to this file, but
this additional step removes the need for it entirely on this specific page).

### 3a — Backend: bulk-resolve material fields into the QA queue list response

In `supabase/functions/api/_core/procurement/inward_qa.handlers.ts`,
`listQADocumentsHandler` (~line 320) currently selects
`"id, qa_number, grn_id, grn_line_id, material_id, vendor_id, qa_stock_qty, uom_code, status, qa_created_at, company_id"`
from `inward_qa_document` and returns rows with a raw `material_id`, no name/category.
Add a bulk resolve step, mirroring the existing `decidedByDoc` bulk-fetch pattern
already in this same function (collect all `material_id`s from `rows`, one
`.in("id", materialIds)` query against `erp_master.material_master` selecting
`id, pace_code, material_name, material_category`, build a `Map`, then attach
`material_name`, `pace_code`, `material_category` onto each returned item alongside
the existing fields). Follow CLAUDE.md §8A's bulk-resolve convention exactly (one
`.in()` call, not per-row).

### 3b — Backend: same for the detail endpoint

`getQADocumentHandler` → `fetchQaDocumentDetails` (~line 167) also returns a raw
`material_id` with no resolved name/category (used by `QaExpandedPanel`'s
`materialCategory` today, indirectly, via the parent's client-side lookup — see 3c).
Add the same one-row `material_master` lookup (single `.eq("id", qaDocument.material_id).single()` selecting `pace_code, material_name, material_category` is fine here, this
endpoint returns one document, not a list) and attach `material_name`, `pace_code`,
`material_category` to the returned object.

### 3c — Frontend: drop the client-side material picker entirely on this page

In `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx`:

- Remove the `materialQuery` (`useMaterialOptionsQuery({ limit: 200, offset: 0 })`,
  ~line 106), the `materials` variable, and the `materialMap` (~line 147) — no longer
  needed once the backend attaches the fields directly.
- Everywhere the component currently does `materialMap.get(row.material_id)` to get
  a `material` object, read the resolved fields straight off `row` instead:
  `row.material_name`, `row.pace_code` (in place of `material?.material_code`),
  `row.material_category`. This applies to: the `filteredRows` search haystack
  (~line 157-158), the table cell rendering (~line 321-324, replace
  `material?.material_name || material?.material_code || row.material_id || "—"`
  with `row.material_name || row.pace_code || "—"` — note: still no raw-ID fallback,
  per R-01), and the `<QaExpandedPanel material={material} ... />` prop (~line 347,
  pass `material={row}` instead, or restructure `QaExpandedPanel` to read
  `row.material_category` directly instead of a separate `material` prop — your
  choice, whichever is the smaller diff).
- `QaExpandedPanel`'s own `materialCategory` (~line 386,
  `material?.material_category || ""`) should now read from the detail endpoint's
  response (`detail?.material_category`, from Step 3b) once `detailQuery` resolves,
  falling back to the row-level value from the list (Step 3a) while detail is still
  loading, so the category-dependent test-config queries (`categoryConfigQuery`
  etc.) don't have to wait unnecessarily.
- Update `loading` (~line 114) and the refresh handler (~line 119) to no longer
  reference `materialQuery`.

Also remove `useMaterialOptionsQuery` from this file's import line if nothing else
in the file still needs it (confirm with grep before removing the import).

---

## What NOT to do

- Do not touch any other `limit:` value in these files (pagination strips, GRN/PO
  lists, etc.) — only the three named hooks above.
- Do not touch `useMaterialsQuery`/`useVendorsQuery`/`useCustomersQuery` (the
  non-"Options" base hooks) unless a listed call site directly uses one of them —
  check each site's actual hook name before editing.
- Steps 1–2 are frontend-only — the backend already respects whatever `limit` is
  passed, no server-side cap exists, so do not touch any backend/`.ts` file for the
  limit-raise sweep. Step 3 is the one deliberate exception (`inward_qa.handlers.ts`)
  — that's a distinct, R-03-driven fix, not part of the limit-raise pattern.
- Do not touch files not in the lists above **unless** your Step 4 sweep finds more —
  if so, fix those too with the same pattern and note them in your report.

---

## Step 4 — Verify

1. Re-grep `useMaterialOptionsQuery\(|useVendorOptionsQuery\(|useCustomerOptionsQuery\(`
   across `frontend/src` after your edits. Confirm no remaining call site has a bare
   numeric `limit: 200`/`300`/`500`/`1000` literal — all should now use
   `MASTER_PICKER_FETCH_LIMIT` or have no `limit` at all. Fix anything this brief's
   list missed and note it in your report.
2. From `frontend/`, run `npx eslint <every file you touched>` — zero new errors.
3. For `inward_qa.handlers.ts`, run
   `deno check supabase/functions/api/_core/procurement/inward_qa.handlers.ts`
   before (git-stash) and after — zero new errors, same pattern as every other fix
   this session.
4. Report: total files touched, confirmation the constant was added, confirmation of
   the `QAQueuePage.jsx` R-03 rewrite (Step 3a/3b/3c all done, no leftover
   `materialQuery`/`materialMap` in that file), eslint + deno check results, and any
   extra call sites found beyond this brief's list.

---

## Step 5 — Commit

Clear commit message stating the fix and its root cause (hardcoded fetch-limit
truncation on master-data picker queries, confirmed against live prod data showing
413 materials with FG alone exceeding the 200-row cap). `Co-Authored-By: Codex` per
this repo's convention. Scope: only the files listed in Steps 1–3 (plus anything
genuinely found in the Step 4 sweep) — no unrelated changes.
