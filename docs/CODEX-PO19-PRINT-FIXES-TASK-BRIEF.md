# CODEX TASK — PO19 "Print PO/STO" — Fix Navigation + Print Layout Bugs

## Objective

PO19 (Print PO/STO, feasibility doc §118) was built this session but has real, reproduced bugs
found during live click-through in dev. Fix all of them. Do not re-design anything — §118.1–118.11
is LOCKED; this is a bug-fix pass against that locked spec, not a new design pass.

Files involved (all already exist, created this session):
- `frontend/src/pages/dashboard/procurement/print/PrintGroupPage.jsx` (Page 1 — landing/list + Group Number prompt, as rebuilt in commit `44570f1d`)
- `frontend/src/pages/dashboard/procurement/print/PrintGroupDetailPage.jsx` (Page 2 — summary strip + document checklist, added in commit `ef127691`)
- `frontend/src/pages/dashboard/procurement/print/PrintPreviewPage.jsx` (Page 3 — printable copy)
- `frontend/src/layout/MenuShell.jsx` (app shell — read-only reference for Bug 2)
- `frontend/src/index.css` (or wherever global CSS lives — add the print fix here)

**Note on scope drift:** the flow is now 3 pages instead of the original 2 (a landing page with a
group list was added, plus a separate detail page). That is fine and does not need to be reverted —
§118.6 only locks what Page "2" (the summary+checklist step, wherever it lives) must show, not the
exact page count. Bug 4 below is a direct consequence of this restructure, though, so read it before
touching navigation code again.

---

## Bug 1 (CONFIRMED, root-caused) — "I confirm" doesn't open Preview, silently returns to Dashboard

**Symptom (live, reproduced):** on Page 2, clicking "Print (N)" → vendor modal → checking the box →
clicking "OK" does not open the Preview page. The app ends up back at the dashboard/home screen.

**Root cause:** `PrintGroupPage.jsx`'s `goToPreview()` calls plain React Router `useNavigate()`:

```js
navigate("/dashboard/procurement/print/preview", { state: { kind, group_number, from, to, selectedIds } });
```

This app does **not** use plain React Router navigation to move between two different registered
screens. It has its own authoritative screen-stack model (`frontend/src/navigation/screenStackEngine.js`)
that both the URL and the shell (title bar, sidebar highlight, Back button, keyboard-intent Back)
must go through — see `openRoute()` / `openScreenWithContext()` / `openRouteWithContext()`.

The bridge between the stack and React Router is `frontend/src/navigation/NavigationStackBridge.jsx`.
Its second effect watches `location.pathname` and, whenever the pathname doesn't match the current
active screen-stack entry's own `route` (and isn't a same-prefix "companion route" sub-path), it force-
navigates back to whatever route *is* on top of the stack. Calling raw `navigate()` changes the URL
without ever pushing a new stack entry, so the stack and the URL disagree — this is what produces the
"silently bounces to a screen that isn't where you tried to go" symptom. (`/procurement/print/preview`
technically starts with `/procurement/print/`, which is why it doesn't reproduce 100% consistently as a
hard redirect in every trace — but it is provably not going through the sanctioned navigation path, and
it is definitely not carrying `state` the way the rest of the app expects context to travel between
screens.)

**Fix:**
1. In `PrintGroupPage.jsx`, replace the `useNavigate()` + `navigate(path, {state})` call with:
   ```js
   import { openRouteWithContext } from "../../../../navigation/screenStackEngine.js";
   ...
   function goToPreview() {
     const ids = Array.from(selectedIds);
     if (ids.length === 0) return;
     openRouteWithContext("/dashboard/procurement/print/preview", {
       kind: result.kind,
       group_number: result.group_number,
       from: result.from,
       to: result.to,
       selectedIds: ids,
     });
   }
   ```
   Remove the now-unused `useNavigate` import if nothing else in the file needs it.
2. In `PrintPreviewPage.jsx`, replace `useLocation().state` with the screen-stack's own context reader:
   ```js
   import { getActiveScreenContext } from "../../../../navigation/screenStackEngine.js";
   ...
   const state = getActiveScreenContext();
   ```
   `getActiveScreenContext()` is a plain synchronous read (not a hook), so keep it in a `useMemo(() => getActiveScreenContext(), [])` or just call it once at the top of the component — check how other pages in this codebase that use `openScreenWithContext`/`getActiveScreenContext` consume it (search the codebase for existing `getActiveScreenContext()` call sites, e.g. `ACL_VERSION_CENTER`-related code in `MenuShell.jsx`) and match that pattern exactly rather than inventing a new one.
3. **Verify the "Back" button from the Preview page** now correctly returns to Page 2 (not the
   dashboard) — since Preview was opened via `openRouteWithContext` (a real stack push), the shell's
   existing Back/Esc handling should already pop back to Page 2 automatically. Confirm this live;
   do not add any new back-handling code for this unless testing shows it's still wrong.
4. Re-verify PrintGroupPage.jsx has no other `navigate(...)` calls left, and grep the whole `print/`
   folder for `useNavigate` to confirm it's fully gone (unless truly still needed for something else,
   which it should not be).

---

## Bug 2 (CONFIRMED, root-caused) — Print/Download captures the entire app shell, not just the document; A4 pagination is broken (pages overlap)

**Symptom (live, reproduced — see screenshot from business owner):** clicking Print / Ctrl+P shows the
entire app chrome in the print preview — sidebar rail, top bar ("FOCUSED WORKSPACE", stack breadcrumb,
"L1_MANAGER DIRECTOR P0004 CMP003..." status line, "ESC Back | Alt+H Home | ..." shortcut footer) —
not just the PO/STO copy. Additionally, page breaks between multiple documents are not clean: content
from one page runs directly into the next with no real page boundary, which would overlap on a
physically printed sheet.

**Root cause (two compounding issues, verified against the live DOM):**

1. **No print stylesheet ever hides the shell.** `PrintPreviewPage.jsx`'s own `<style>` block only
   scopes `@media print` rules to elements *inside* that component (`.no-print`, `.paper`, etc.). But
   this page renders **inside** the persistent app shell — `MenuShell.jsx` wraps every route via
   `<Outlet />`, and none of the shell's own chrome (sidebar rail, top bar, footer) is aware of print
   mode at all. When the browser's native print captures the page, it captures everything currently in
   the DOM, shell included.

2. **The content area scrolls, and print-inside-a-scroll-container is unreliable.** The Outlet is
   rendered inside `<div id="erp-content-scroll" ... className="... overflow-y-auto ...">` (see
   `MenuShell.jsx`, search for `id="erp-content-scroll"`). Printing content inside a CSS
   `overflow: auto`/`scroll` container is a well-known cross-browser print bug — the print engine does
   not reliably paginate a scrollable region the same way it paginates normal document flow, which is
   very likely why `.paper`'s own `page-break-after: always` isn't producing clean, non-overlapping
   pages.

3. **Secondary, smaller bug in the `.paper` sizing math:** `.paper` is set to `width: 794px` (A4's
   *full* width at 96dpi with **no margin accounted for**), while `@page { size: A4; margin: 12mm; }`
   reserves 12mm on every side, shrinking the actual printable width to well under 794px. This mismatch
   will force the browser to either shrink-to-fit (inconsistent scaling) or clip content sideways —
   fix this at the same time as the pagination fix, don't leave it as a second unresolved issue.

**Fix:**

1. Add a **global** print stylesheet rule (put it in whatever global CSS file already exists — e.g.
   `frontend/src/index.css` — do not scope it to just this page, since "printing should only ever show
   the current page's content, never the shell chrome" is correct behavior for the *whole app*, not
   just PO19). Use the standard "isolate one element for print" pattern, targeting the shell's actual
   stable id:
   ```css
   @media print {
     body * {
       visibility: hidden !important;
     }
     #erp-content-scroll,
     #erp-content-scroll * {
       visibility: visible !important;
     }
     #erp-content-scroll {
       position: absolute !important;
       inset: 0 !important;
       overflow: visible !important;
       height: auto !important;
       width: auto !important;
       padding: 0 !important;
       margin: 0 !important;
     }
   }
   ```
   Confirm the exact `id` by re-reading `MenuShell.jsx` yourself before implementing — it was
   `erp-content-scroll` as of this session, but re-verify against the current file, don't just trust
   this brief blindly.
2. In `.paper`'s own print rules (inside `PrintPreviewPage.jsx`), switch `page-break-after: always` to
   the modern `break-after: page` (keep `page-break-after` too as a fallback for older engines, both
   can coexist safely). Add `break-inside: avoid` (and `page-break-inside: avoid` fallback) to
   `.masthead`, `.parties`, `.items` (or at minimum its `<tr>` rows), and `.foot-grid` so a single
   document's own internal blocks don't themselves split mid-block across a page boundary.
3. Fix the `.paper` width math: either (a) reduce `.paper`'s width to the true printable area after a
   12mm margin (≈ 720px, recompute precisely: 210mm − 24mm = 186mm ≈ 703px at 96dpi — use the exact
   number, don't eyeball it), or (b) drop `@page`'s margin to `0` and let `.paper`'s own padding (it
   already has `padding: 38px 48px 36px`) simulate the margin instead. Pick whichever keeps the visual
   spacing closest to what's already been shown to the business owner (option b likely preserves the
   current look with the least visual change) and verify against `.paper`'s current 794px width — the
   two must agree with each other, they cannot both be at their current values.
4. After the fix, do a real click-through test: look up an existing backfilled Group Number (any of
   `9700000001` through `9700000010` — one is a multi-PO group, use that one specifically) and confirm
   in the browser's print preview (Ctrl+P, or the "Print / Download PDF" button) that:
   - No shell chrome (sidebar, top bar, footer, breadcrumb) is visible at all.
   - Each PO/STO copy lands on its own clean page with no visible overlap between documents.
   - The content fits within the page width with no horizontal clipping or forced tiny-scaling.

---

## Bug 3 — Page 2 detail/summary strip — MANDATORY, not optional, must be visibly working

**This is a hard requirement, not a nice-to-have.** §118.6 locks it explicitly: "Page 2 — summary
header (LOCKED), shown above the list, one line: Group Number, From (Buyer Company for a PO group /
Sending Company for an STO), To (Vendor Name for a PO group / Receiving Company for an STO), Date, and
Number of PO/STO." Without this, the user has no way to confirm they looked up the right Group Number
before committing to print — that's the entire reason it's on the locked spec. Do not treat this as
"probably already fine" and move on. It must be visibly present and correct on Page 2 for both a
PO-group Group Number and an STO Group Number before this task can be called done.

**What was checked already, this session, before writing this brief:** re-read the current
`PrintGroupPage.jsx` end-to-end — a summary grid *is* coded (5 columns: Group Number, From, To, Date,
Number of PO/STO, rendered directly above the checkbox table inside the "Step 2: Documents under this
Group Number" card) — and traced the full data path from the backend (`print_group.handlers.ts`'s
`lookupPrintGroupHandler` → `okResponse({kind, group_number, from, to, date, count, documents}, ...)`)
through `fetchProcurement`'s response-unwrapping logic (`procurementApi.js`) to the frontend bindings
(`result.group_number`, `result.from?.company_name`, etc.) — no code-level bug was found in this path
by static reading alone. That does not mean it is confirmed working — it has never been confirmed
working live, only traced on paper.

**Required action:** click through live in dev against a real backfilled Group Number (test both a
PO-group number and the STO group number — one number of each kind is enough) and take a screenshot of
Page 2 showing the summary strip with real values (not "--" placeholders, not blank). If it is not
rendering, or rendering blank/wrong, root-cause it for real (add a temporary `console.log(result)` if
needed to see what the frontend actually received) and fix it. **A screenshot proving Group
Number/From/To/Date/Count are all showing real values on Page 2 is a required deliverable for this
brief, exactly like the Bug 2 screenshot below — do not report Bug 3 as done without it.**

---

## Bug 4 (CONFIRMED, root-caused against live dev DB) — Two competing navigations to Preview cause a transient empty-state that 404s the lookup and 500s the print-log write

**Symptom (live, reproduced — console + backend logs from the business owner):** on landing on the
Preview page, the browser console shows repeated `GET /api/procurement/print-groups` calls returning
`404 PRINT_GROUP_NOT_FOUND`, and the `POST /api/procurement/print-groups/log` call returns `500
PRINT_LOG_CREATE_FAILED` (backend log confirms: ACL passes `PROC_PO_STO_PRINT:WRITE ALLOW`, then the
insert itself throws). The Preview page still ends up showing the *correct* document, which is what
made this easy to miss — the underlying calls are still failing every time. Confirmed via a direct DB
check: `erp_procurement.print_log` has **zero rows** in dev even after multiple successful-looking
prints, and a manually-inserted row with well-formed values succeeds with no error — so the table
itself is fine; the values reaching it are wrong.

**Root cause:** `PrintGroupDetailPage.jsx`'s `goToPreview()` fires two separate navigations to the
same destination, back to back:

```js
openScreen(OPERATION_SCREENS.PROC_PO_STO_PRINT_PREVIEW.screen_code);
navigate(`/dashboard/procurement/print/preview?${params.toString()}`, { state: { kind, group_number, from, to, selectedIds } });
```

`openScreen()` pushes the screen-stack entry, which — via `NavigationStackBridge.jsx`'s subscription
to stack changes — independently fires its **own** `navigate()` call to the screen's plain registered
route (`/dashboard/procurement/print/preview`, no query string, no state), since the stack entry itself
doesn't carry the query params or `state` this component is trying to pass. Then the explicit
`navigate(url_with_query, {state})` call fires right after. Two navigations to the same page landing
back to back means `PrintPreviewPage.jsx` can mount/re-render against the *first* (empty) URL before
the *second* (complete) one lands — during that window, `groupNumber`/`kind` are wrong (empty or
otherwise not matching a real row), which is what produces the 404 on lookup and, if the print-log
`useEffect` fires during/using state from that same window, the 500 on log-create (an empty or
malformed `document_kind` fails the `print_log_document_kind_check` CHECK constraint; an empty
`group_number` won't match a real `print_log` row requirement either — check with `console.log` which
one it actually is, don't guess further than this).

This is the exact class of bug flagged as Bug 1 in the original brief — mixing this app's own
screen-stack navigation with plain React Router navigation. The Bug 1 fix was applied (in commit
`ef127691`, using `openScreen`/`openScreenWithContext` in most places) but this one remaining call
site still does *both* at once instead of picking one.

**Fix — pick exactly one navigation path, do not keep both:**

1. In `PrintGroupDetailPage.jsx`'s `goToPreview()`, remove the explicit `navigate(url_with_query, {state})`
   call entirely. Keep only the screen-stack push, but use `openScreenWithContext()` (not plain
   `openScreen()`) so the payload travels with the stack entry itself instead of through a URL query
   string or React Router `state`:
   ```js
   import { openScreenWithContext } from "../../../../navigation/screenStackEngine.js";
   ...
   function goToPreview() {
     const ids = Array.from(selectedIds);
     if (ids.length === 0 || !result) return;
     openScreenWithContext(OPERATION_SCREENS.PROC_PO_STO_PRINT_PREVIEW.screen_code, {
       kind: result.kind,
       group_number: result.group_number || groupNumber,
       from: result.from,
       to: result.to,
       selectedIds: ids,
     });
   }
   ```
2. In `PrintPreviewPage.jsx`, stop reading `useLocation().state` and the `?group_number=/kind=/selected_ids=`
   query-string fallback entirely. Read the context the same way the rest of the app does:
   ```js
   import { getActiveScreenContext } from "../../../../navigation/screenStackEngine.js";
   ...
   const context = getActiveScreenContext();
   const groupNumber = context?.group_number || "";
   const kind = context?.kind || "";
   const selectedIds = context?.selectedIds || [];
   const printContext = context; // from/to already present, no fallback re-lookup needed at all
   ```
   This also means the `lookupPrintGroup` fallback-refetch branch in `PrintPreviewPage.jsx`'s big
   `useEffect` (the `if (!resolvedContext && groupNumber) { ... }` block) becomes dead code — remove
   it. Context always arrives complete now, in one atomic push, with no race window at all. Delete the
   now-unused `lookupPrintGroup` import from `PrintPreviewPage.jsx` if nothing else in the file needs it.
3. Double-check there is no other place in the `print/` folder still constructing a URL with
   `group_number=`/`kind=`/`selected_ids=` query params for internal navigation between these three
   screens — grep for `selected_ids=` and `URLSearchParams` in the `print/` folder and remove any
   other instance of this pattern once the context-based approach above is in place everywhere.
4. **Also fix the swallowed error** in `createPrintLogHandler` (`print_group.handlers.ts`) so this
   class of bug is diagnosable from the backend logs next time without needing a manual DB check like
   the one done to root-cause this: log `error.message` (the real Postgres error) before throwing the
   generic `PRINT_LOG_CREATE_FAILED`, the same way most other handlers in this codebase already do on
   an insert failure — check a neighboring handler (e.g. `createSTOHandler` in `sto.handlers.ts`) for
   the established pattern and match it, don't invent a new one.
5. **Verify:** after the fix, print an existing backfilled Group Number end to end and confirm (a) no
   404s in the console at any point during the flow, (b) `SELECT * FROM
   erp_procurement.print_log ORDER BY printed_at DESC LIMIT 1;` shows a real new row with the correct
   `group_number`/`document_kind`/`document_ids` immediately after clicking Print/Download, not zero
   rows.

---

## Gap 5 (genuinely missing, not yet built — §118.4/§118.10) — QR code never implemented

**What's locked (§118.4):** a small QR box in the masthead's top-right corner (next to
GSTIN/CIN/Mobile/Email), on both PO and STO copies. Static data only, no scan-to-verify page. It
encodes: **PO No./STO No., Date, the counterpart's code (Vendor Code for PO, Sending/Receiving
Company Code for STO), Approver ID, and Buyer/Receiving Company Code.** No caption/label text under
the box.

**What was left open (§118.10):** which JS library generates it was explicitly deferred — "not yet
chosen." That decision is made now, below, so this is no longer open.

**Confirmed via this session's investigation — nothing renders a QR box anywhere today** (checked
`PrintPreviewPage.jsx` — no QR-related code exists), and no QR library is installed
(`frontend/package.json` has no `qrcode`/`qr-code-styling`/similar dependency). This needs to be
built from scratch, not just re-wired.

**Two backend gaps must be closed first — the letterhead blocks don't carry the codes the QR needs to encode:**

1. `resolveVendorLetterheadBlock()` in `print_group.handlers.ts` selects
   `"vendor_name, gst_number, reg_address_line1, reg_address_city, reg_address_state, reg_address_pin"`
   from `vendor_master` — **add `vendor_code`** to that select list and to the returned object
   (`vendor_code: toTrimmedString(vendor.vendor_code) || null`). This is the "counterpart's code" for
   a PO's QR.
2. `resolveCompanyLetterheadBlocks()` in the same file selects
   `"id, company_name, gst_number, cin_number, mobile_number_1, mobile_number_2, email_1, email_2, full_address"`
   from `companies` — **add `company_code`** to that select list and to the `CompanyLetterheadBlock`
   type + returned object. This is both the "Buyer Company Code" (PO's `from`) and the
   "Sending/Receiving Company Code" (STO's `from`/`to`).

**Approver ID needs no backend change — it's already available, just not read yet.** `getPOHandler`/
`getSTOHandler` already run their full response (including `approval_log`) through
`enrichProcurementUserDisplays()`, which auto-attaches a `<field>_display` companion to every
`*_by` field — so each `approval_log` row's `actioned_by` already has `actioned_by_display` in the
format `"P0004 | Full Name"` (see `formatCodeNameDisplay()` in `po.handlers.ts`). In
`PrintPreviewPage.jsx`, find the `approval_log` row where `action === "APPROVED"` (the only actions
seen in dev data are `APPROVED` and `ESCALATED` — use `APPROVED`; if a document has been approved more
than once, use the most recent one), take its `actioned_by_display`, and split on `" | "` to get just
the code portion (e.g. `"P0004"`) — the QR encodes the code, not the full name.

**Fix:**
1. Install a client-side QR generation library — use the `qrcode` npm package (small, no external
   CDN dependency, actively maintained, supports rendering straight to a `<canvas>` or a data URL,
   which is what's needed here since this must work inside the print stylesheet without extra network
   calls). Add it to `frontend/package.json`.
2. Build the QR payload per document as a single delimited string (pick a plain, unambiguous format —
   e.g. pipe-delimited key:value pairs — since there is no scan-to-verify consumer to match a schema
   against, readability for a human debugging it later matters more than compactness):
   ```
   DOC:<po_number or sto_number>|DATE:<po_date or sto_date>|CPTY:<vendor_code or counterpart company_code>|APPR:<approver code>|BUYER:<buyer/receiving company_code>
   ```
   For STO, there is no "vendor" — `CPTY` is the *other* company in the transfer (Receiving Company
   Code when printing from the Sending side's perspective... re-read §118.2/118.3 to confirm which
   side's letterhead is printing before deciding which code is "counterpart" vs "buyer" for STO
   specifically — do not guess this ordering, it must match the same Vendor/Buyer role mapping already
   used for the rest of the STO copy's party blocks).
3. Render the QR as a small `<canvas>` (or `<img>` from a data URL) positioned in the masthead's
   top-right, next to the existing `CompanyIdBlock` (GSTIN/CIN/Mobile/Email) — same visual area
   §118.4 locks it to. No caption text under it.
4. Generate it client-side, synchronously enough to be present before the user hits Print (the
   `qrcode` package's `toDataURL`/`toCanvas` calls are async — make sure the QR is fully rendered
   before treating the page as "ready to print," e.g. render it in a `useEffect` per document and don't
   assume it appears instantly on first paint).
5. Verify on both a PO copy and an STO copy that the QR renders, is scannable (use any phone QR
   scanner to confirm the encoded string reads back correctly), and sits in the correct masthead
   position without disturbing the existing GSTIN/CIN/Mobile/Email layout.

---

## General verification requirements (same standard as every other change this session)

- `deno check` on any touched backend file (Gap 5 touches `print_group.handlers.ts` — git-stash
  before/after and confirm zero new errors, matching the existing baseline. Bugs 1/3/4 are
  frontend-only.)
- `eslint` clean on every touched frontend file.
- Do not touch `MenuShell.jsx`'s actual layout/behavior — Bug 2's fix is a CSS-only addition, not a
  structural change to the shell. If achieving the fix seems to require changing `MenuShell.jsx`'s JSX
  itself (not just adding a global stylesheet rule), stop and re-read this brief — that would mean the
  `#erp-content-scroll` id assumption above is wrong, and the actual selector needs to be re-derived
  from the current file, not invented.
- Report back with a screenshot proving all five items (Bugs 1–4 + Gap 5) are fixed/built against a
  real backfilled Group Number in dev (include the Bug 4 `print_log` row check and a QR scan
  confirmation, not just screenshots), not just "should work now."
