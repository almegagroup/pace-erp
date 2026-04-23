# PACE ERP — Task-First UX Redesign
**Classification:** Design Authority + Implementation Plan  
**Status:** ✅ COMPLETE  
**Last Updated:** 2026-04-23  
**Principle:** Inspired by SAP and Tally — task-first, register-style, zero decoration

---

## WHY THIS EXISTS

**Tally Prime:** Screen opens → task starts. No cards, no explanatory text, no side panels. User runs the system.

**SAP (enterprise standard):** Dense register, form-first, keyboard-driven. 10+ years of proven UX.

**PACE ERP current state:** Cards above every form, explanatory paragraphs the user never reads, Context Rail side panels with documentation, Operator Notes panels — the system explains itself instead of doing work.

**The problem in one line:**
> A user comes to Leave Apply to submit leave — not to read about backdate windows, company scope, or cancel rules.

**The fix in one line:**
> Screen opens → user is already working. Nothing to read. Nothing to dismiss.

---

## CORE PRINCIPLE

> **The screen's job is to get work done — not to explain itself.**

Business logic is unchanged. Navigation system is unchanged. Feature set is unchanged.  
Only the UI layer changes — from decoration-heavy to task-first.

---

## THE RULEBOOK — 10 Hard Rules

These rules apply to **every screen** — SA universe and ACL universe — without exception.

---

### Rule 1: No Cards — Ever
`ErpMetricCard` is removed from all operational screens.  
Cards belong to SaaS dashboards (Notion, HubSpot, analytics tools).  
ERP uses **registers and forms** — Tally has no cards. SAP has no cards.

**Before:** Queue: 0 | Pending: 0 | Approved: 0 | Rejected: 0 (4 cards taking up 120px of vertical space)  
**After:** Table starts. Count appears inline in table header if needed.

---

### Rule 2: No Explanatory Paragraph Below Title
The `description` prop on `ErpScreenScaffold` is never used.  
Screen titles are self-explanatory to ERP users.

**Before:** *"Approvers see only the currently actionable leave requests here and can approve or reject without leaving the queue."*  
**After:** Nothing. Title: **Leave Approval Inbox** is enough.

---

### Rule 3: No Context Rail / No Side Documentation Panels
The 360px right sidebar — "Workspace Tools / Context Rail" and "Operator Notes" — is removed from all templates.  
Business rules belong in **field-level tooltips or inline validation** — not a separate panel.

**Before:** Right panel with "Business law", "Backdate Limit", "Keep the sheet dense and task-focused..."  
**After:** Nothing. If a rule is important, it surfaces at the moment of violation — not as ambient documentation.

---

### Rule 4: No Section Descriptions
`ErpSectionCard` `description` prop is not used on any operational section.  
Section title or content is self-explanatory.

**Before:** Section header with eyebrow + title + 2-line description paragraph  
**After:** Section title only (or no header at all if the content makes the purpose obvious)

---

### Rule 5: Notices → Toast Only
The inline notice banner rows inside `ErpScreenScaffold` sticky header are removed.  
`pushToast` already fires for every notice — the toast overlay is the notification layer.  
No duplicate inline banner + toast for the same message.

**Before:** Blue info bar in sticky header + toast simultaneously  
**After:** Toast only — non-blocking, disappears automatically

---

### Rule 6: Multi-Company Banner — Permanent Dismiss
Once a user dismisses the multi-company info banner, it never reappears.  
Stored in `localStorage` keyed to user ID.  
Currently: dismissed → reappears on next login.  
Target: dismissed once → gone forever for that user.

---

### Rule 7: Form Opens First
On form-entry screens, the **form fields are the first element** after the page header.  
No summary block, no info cards, no context block above the form.

---

### Rule 8: Table/Register Opens First
On list screens, the **table/register is the first element** after the page header.  
The filter/search input sits above the table — compact, no card wrapper.

---

### Rule 9: Drawers Are Single-Task
A drawer contains exactly **one focused task**.  
No sub-sections, no cards inside drawers, no nested panels.  
Structure: Title → Content → Action buttons. Done.

---

### Rule 10: Screen Eyebrow Is Optional
The eyebrow label (e.g., "HR MANAGEMENT") is kept **only** where it adds genuine module context.  
If the page title already makes the location clear, the eyebrow is removed.

---

### Rule 11: No Workflow Interruption
Every user action — SA or ACL — must complete without unnecessary blocking steps.  
No confirmation dialogs unless an action is **irreversible and destructive** (e.g., delete, disable).  
Routine actions (save, approve, reject, submit) execute immediately and give feedback via toast.  
The user's flow is never broken mid-task.

---

### Rule 12: Transaction-Level Company Selector (Multi-Company Users)
For report/filter screens: a **single top-level company filter** is correct.  
For transactional screens (PO, journal entry, invoice, any record-creating screen): the company selector must be **at the transaction header level** — always visible, always explicit.  

**Why:** If a multi-company user forgets to change the global company selector before creating a PO, every line goes to the wrong company. Explicit company at the transaction level prevents this class of error entirely.

**Rule:** Any screen that creates or edits a business record must show the company it belongs to **on the form itself** — not inherited silently from a global selector.  

This applies to current screens and is **mandatory for all future transactional modules** (procurement, finance, inventory, etc.).

---

### Rule 13: Keyboard Shortcut Completeness
Every screen must have **complete keyboard coverage** — no action requires a mouse.  
- `Alt+X` for all top action buttons (already exists, must be consistent)
- `Tab` / `Shift+Tab` for field-to-field navigation within forms
- `Enter` to confirm, `Esc` to cancel or go back
- `Ctrl+S` / `F2` to save
- `F3` / `Alt+Shift+F` to jump to search/filter
- Arrow keys to navigate table rows
- `Enter` on a table row to open detail / drill-through

Shortcuts must be **documented in footerHints** and must not conflict across screens.

---

### Rule 14: Drill-Through Navigation with Return Refresh
**The SAP standard pattern — mandatory for all list/report screens.**

Flow:
```
Report/List screen
  → user presses Enter (or clicks) on a row
  → Detail screen opens (same stack, new screen)
  → user works, saves
  → user presses Esc / Back
  → Returns to Report/List screen
  → List automatically refreshes (reflects the save)
```

This requires the navigation foundation to support:
1. **Drill-through open**: `openScreen(detailScreen, { returnTo: currentScreen, refreshOnReturn: true })`
2. **Return signal**: when navigating back, if `refreshOnReturn` is true → trigger a refresh callback on the parent screen
3. **Context carry**: the detail screen knows which record to show (passed via screenStack context or sessionStorage)

This is a **foundation architectural addition** — not a per-screen feature. Once built, every future list screen gets drill-through for free.

---

### Rule 15: Foundation-First — Backbone Must Not Change
The design patterns established here are **permanent backbone decisions**.  
Future modules (procurement, finance, inventory, HR extensions) must implement within this backbone — not require backbone changes.

This means:
- The template system (ErpScreenScaffold, templates) must be stable after this redesign
- The navigation/screen stack must support drill-through natively
- The transaction company selector must be a **reusable component** — not rebuilt per module
- The shortcut system must be extensible — new screens add shortcuts, never conflict
- Any new module that follows these rules works correctly from day one

---

## WHAT CHANGES vs WHAT STAYS

| Element | Verdict | Rule |
|---------|---------|------|
| `ErpMetricCard` usage on all pages | ❌ Remove | Rule 1 |
| `description` prop on `ErpScreenScaffold` | ❌ Remove from all pages | Rule 2 |
| Context Rail / `sideContent` in entry forms | ❌ Remove from template | Rule 3 |
| `sideSection` / `summarySection` in list templates | ❌ Remove from templates | Rule 3 |
| `ErpSectionCard` `description` usage | ❌ Remove from all pages | Rule 4 |
| Inline notice banners in scaffold header | ❌ Remove from scaffold | Rule 5 |
| Multi-company banner | ❌ Remove entirely | Rule 2 + Rule 11 |
| `ErpSectionCard` itself | ✅ Keep | Content wrapper still needed |
| `ErpActionStrip` / action buttons | ✅ Keep | Task-critical |
| Keyboard shortcuts (Alt+X) | ✅ Keep | Core ERP UX |
| `footerHints` bar at bottom | ✅ Keep | Non-intrusive reference |
| Breadcrumb in shell header | ✅ Keep | Navigation context |
| Toast notifications | ✅ Keep | Correct feedback mechanism |
| `ErpFieldPreview` | ✅ Keep (reviewed per use) | Valid read-only data display |
| All business logic | ✅ Untouched | Only UI layer changes |
| Navigation / screen registry | ✅ Untouched + Extended | Drill-through added on top |
| All workflows and approval routing | ✅ Untouched | Only UI layer changes |
| `TransactionCompanySelector` | 🆕 New component | Rule 12 — future transactional screens |
| `openScreenWithContext` + refresh callback | 🆕 Navigation extension | Rule 14 — drill-through foundation |

---

## CURRENT → TARGET PATTERN MAP

| Current | Target |
|---------|--------|
| 4 metric cards at top of every screen | Nothing — table or form starts immediately |
| Explanatory paragraph below title | Nothing — title only |
| Context Rail (360px right sidebar) | Removed — rules in field tooltip if needed |
| Operator Notes panel | Removed entirely |
| Section: eyebrow + title + description | Section: title only (or no header) |
| Inline error/success banners in sticky header | Toast only |
| Multi-company banner every login | Dismissed once → never again |
| Form wrapped in section with description | Form directly — no description above it |
| List screen with side panel (operator notes) | Full-width register — no side panel |

---

## PHASED IMPLEMENTATION

---

### Phase UX-1 — Template Layer Overhaul
**Status:** ✅ Complete  
**Scope:** 5 template files  
**Impact:** Automatically improves all 46 pages  
**Effort:** Medium — changes to shared components  

This is the highest-leverage phase. Changing 5 files fixes the majority of issues across the entire system.

#### Files

| File | Change |
|------|--------|
| `frontend/src/components/templates/ErpScreenScaffold.jsx` | Remove metrics row, remove inline notice banners, deprecate description rendering |
| `frontend/src/components/templates/ErpEntryFormTemplate.jsx` | Remove sideContent / Context Rail, remove description + metrics pass-through |
| `frontend/src/components/templates/ErpMasterListTemplate.jsx` | Remove sideSection + summarySection, remove description + metrics pass-through |
| `frontend/src/components/templates/ErpApprovalReviewTemplate.jsx` | Remove sideSection + summarySection, remove description + metrics pass-through |
| `frontend/src/components/templates/ErpReportFilterTemplate.jsx` | Remove sideSection + summarySection, remove description + metrics pass-through |

#### ErpScreenScaffold — Specific Changes

1. **Remove metrics row** (lines 401–410): Delete the `metrics.length > 0` block entirely  
2. **Remove inline notice banner row** (lines 412–436): Delete the `mergedNotices.length > 0` render block. `pushToast` calls remain — toast still fires.  
3. **Deprecate `description`**: Accept prop but do not render. Graceful — no pages break.  
4. **Keep:** `ErpMetricCard`, `ErpFieldPreview` exports (may be used in SA report screens). `ErpActionStrip`, `ErpSectionCard` unchanged.

#### ErpEntryFormTemplate — Specific Changes

1. **Remove `sideContent` prop** and the `xl:grid-cols-[minmax(0,1.5fr)_360px]` conditional layout  
2. **Remove the Context Rail `ErpSectionCard`** block (lines 64–72)  
3. **Remove `metrics` and `description` props** — no longer passed to scaffold  
4. **Remove `formDescription`** — `ErpSectionCard` called without description  
5. Layout becomes: single full-width form section only

#### ErpMasterListTemplate — Specific Changes

1. **Remove `sideSection` and `summarySection` props** and their rendering  
2. **Remove the `xl:grid-cols-[minmax(0,1.45fr)_360px]` layout** — list is always full-width  
3. **Remove `metrics` and `description` props**  
4. Layout: filterSection (if any) → full-width listSection

#### ErpApprovalReviewTemplate — Specific Changes

1. **Remove `sideSection` and `summarySection` props** and their rendering  
2. **Remove the two-column conditional layout** — review section is always full-width  
3. **Remove `metrics` and `description` props**

#### ErpReportFilterTemplate — Specific Changes

1. **Remove `sideSection` and `summarySection` props** and their rendering  
2. **Remove the two-column conditional layout** — report section is always full-width  
3. **Remove `metrics` and `description` props**

#### Verification
- [ ] Leave Apply opens → form is first visible element, no side panel
- [ ] Leave Approval Inbox opens → filter + table, no metric cards, no side panel
- [ ] SA Company Manage opens → filter + table, no metric cards
- [ ] SA Users opens → no metric cards, no side panel
- [ ] Any save action → toast fires, no inline banner in header
- [ ] No visual regressions across 46 pages

---

### Phase UX-2 — Page-Level Metric Removal
**Status:** ✅ Complete  
**Scope:** All pages that pass `metrics={[...]}` prop or use `ErpMetricCard` directly  
**Effort:** Low — after Phase UX-1 templates ignore metrics, only direct usages remain  

Phase UX-1 handles metrics via templates (scaffold ignores the prop). This phase finds any pages that import and render `ErpMetricCard` **directly** (bypassing templates) and removes them.

#### Files to Audit

Run grep: `ErpMetricCard` across all page files.

Expected direct usages (from audit):
- `UserDashboardHome.jsx` — likely uses metric cards directly
- `SAHome.jsx` — control panel snapshot may use metric cards directly
- Any SA screen that renders summary data as cards

#### Change
- Remove `ErpMetricCard` import and all render calls from each file
- Replace with inline text if count/summary is genuinely needed: e.g., `"14 users"` as plain text in table header

---

### Phase UX-3 — Multi-Company Banner Remove
**Status:** ✅ Complete  
**Scope:** Shell component rendering the multi-company banner  
**Effort:** Low  

#### Decision
The multi-company banner is **removed entirely** — not just permanently dismissed.

**Reason:** Rule 2 (no explanatory text) + Rule 11 (no workflow interruption).  
A Mode B user already knows they have multi-company access — the SA told them.  
The banner explains something the user does not need explained.  
The company selector on each transaction is the real signal — not a banner.

#### Implementation — Done
File: `frontend/src/layout/MenuShell.jsx`

Removed:
- `modeBHintDismissed` useState (localStorage read on init)
- `showModeBHint` derived variable
- `dismissModeBHint` function (localStorage write + state update)
- The entire JSX banner block (sky-50 bg, dismiss button, explanatory text)

No localStorage key `pace.erp.hint.modeb.v1` is written or read anywhere in the codebase.

---

### Phase UX-4 — List Navigation Foundation
**Status:** ✅ Complete  
**Scope:** New `useErpListNavigation` hook + global row CSS  
**Effort:** Medium — one hook, one CSS block, then UX-5 applies it everywhere  

Without this, list screens have no row selection, no Enter-to-drill, no visual focus indicator.  
This is the SAP/Tally workability baseline — every list screen depends on it.

#### What the hook provides
- **Arrow ↑↓** — move focus between rows (replaces raw `handleLinearNavigation` on rows)
- **Home / End** — jump to first / last row
- **PageDown / PageUp** — jump 10 rows at a time
- **Space** — toggle row selection (multi-select supported)
- **Enter** — activate row (calls `onActivate(row, index)` if provided — drill-through hook point)
- **Escape** — clear selection if any; else call `onEscape` (back navigation hook point)

#### API
```js
const { getRowProps, selectedIndices, selectedRows, clearSelection, focusRow, getRowElement } =
  useErpListNavigation(rows, { onActivate, onEscape });
```
`getRowProps(index)` → spreads onto `<tr>`: ref, tabIndex, aria-selected, data-erp-row-selected, onKeyDown

#### CSS additions (index.css)
- `.erp-grid-table tbody tr:focus-visible` → blue accent outline + highlight background
- `.erp-grid-table tbody tr[data-erp-row-selected="true"]` → selection background

#### Files
- Create: `frontend/src/hooks/useErpListNavigation.js`
- Modify: `frontend/src/index.css`

---

### Phase UX-5 — Apply List Navigation to All List Screens
**Status:** ✅ Complete  
**Scope:** All ~25 list/table screens (SA + HR)  
**Effort:** Large — mechanical per-screen wiring  

Apply `useErpListNavigation` to every screen that renders a `<table>` with data rows.

#### Per-screen change
1. Add import: `import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";`
2. Remove `rowRefs = useRef([])` + manual `handleLinearNavigation` on rows
3. Add: `const { getRowProps } = useErpListNavigation(pageItems ?? filteredRows, { onActivate });`
4. Spread `{...getRowProps(index)}` onto each `<tr>`
5. Remove `handleLinearNavigation` import if no longer used for rows (keep if still used for action bar)
6. Wire `onActivate` where a drill-through target exists; omit where no detail screen exists yet

#### Screen inventory
| Screen | Has table | onActivate target |
|--------|-----------|-------------------|
| SACompanyManage | ✓ | none yet |
| SAUsers | ✓ | SAUserScope |
| SASignupRequests | ✓ | focus first action button |
| SAGroupGovernance | ✓ | none yet |
| SADepartmentMaster | ✓ | none yet |
| SACapabilityGovernance | ✓ | none yet |
| SAModuleMaster | ✓ | none yet |
| SAProjectMaster | ✓ | none yet |
| SAWorkContextMaster | ✓ | none yet |
| SAPageResourceRegistry | ✓ | none yet |
| SAModuleResourceMap | ✓ | none yet |
| SAProjectManage | ✓ | none yet |
| SAUserRoles | ✓ | none yet |
| SASessions | ✓ | none yet |
| SAApprovalPolicy | ✓ | none yet |
| SAApprovalRules | ✓ | none yet |
| SAReportVisibility | ✓ | none yet |
| SARolePermissions | ✓ | none yet |
| SAUserScope | ✓ | none yet |
| SACompanyModuleMap | ✓ | none yet |
| SACompanyProjectMap | ✓ | none yet |
| SASystemHealth | ✓ | none yet |
| SAAudit | ✓ | none yet |
| HrRequestListWorkspace | ✓ | none yet |
| HrApprovalInboxWorkspace | ✓ | none yet |
| HrApprovalHistoryWorkspace | ✓ | none yet |
| HrRegisterWorkspace | ✓ | none yet |

---

### Phase UX-6 — Section Card Header Cleanup
**Status:** ✅ Complete  
**Scope:** All pages — `ErpSectionCard` usages  
**Effort:** Medium — requires per-page review  

After Phase UX-1 removes descriptions from templates, some pages still pass `description` directly to `ErpSectionCard`. This phase removes those.

#### Rule
- `description` on `ErpSectionCard` → remove
- `eyebrow` on `ErpSectionCard` → keep only if it adds module/domain context not otherwise visible
- `title` on `ErpSectionCard` → keep if the content section needs a label; remove if content is self-evident

#### Priority Screens
1. SA User Scope Mapping — multiple sections with heavy headers
2. SA Company Create — form sections with descriptions
3. HR Workflow pages — request detail sections

---

### Phase UX-7 — Drawer Audit and Cleanup
**Status:** ✅ Complete  
**Scope:** All `DrawerBase` usages across the system  
**Effort:** Medium  

#### Rule (Rule 9)
Each drawer = one task. No cards inside drawers. No sub-sections. Header → content → action.

#### Audit Target
Find all files importing `DrawerBase`. Review each:
- Does the drawer have nested `ErpSectionCard` blocks inside? → Flatten to plain content
- Does the drawer have metric cards inside? → Remove
- Does the drawer have descriptive text panels? → Remove
- Is the drawer title + primary content clear enough to start working immediately?

---

### Phase UX-8 � Drill-Through Navigation Foundation
**Status:** ✅ Complete  
**Scope:** `screenStackEngine.js` + navigation utilities  
**Effort:** High — architectural addition  
**Applies to:** All current and future list/report screens  

Shared drill-through context + return-refresh support now exists in the navigation backbone:
- `openScreenWithContext(screenCode, context)` and `openRouteWithContext(route, context)`
- stack entry context persisted on each screen entry
- `getActiveScreenContext()` / `getScreenContext()`
- `registerScreenRefreshCallback(fn)` keyed to the active stack entry
- automatic parent refresh firing on `popScreen()` return when `refreshOnReturn` is set
- refresh delivery survives route unmount/remount via pending refresh queue keyed to the exact `stack_entry_id`
- refresh only fires for strict `DRILL_THROUGH` contexts, not generic screen-context payloads

First live wiring is complete on `SAUsers → SAUserScope`, including:
- row Enter/click drill-through with `auth_user_id` context
- detail screen record resolution from URL or stack context
- return to User Directory via stack pop
- parent directory auto-refresh on return
- parent list state restore on return (`filter`, `searchQuery`, `page`, `returnFocusAuthUserId`)

---

### Phase UX-9 — Shortcut Audit and Completeness
**Status:** ✅ Complete  
**Scope:** All 44 screens  
**Effort:** Medium  

Every screen must have complete keyboard coverage per Rule 13.

#### Audit Checklist Per Screen
- [ ] All top action buttons have `Alt+X` shortcut shown in button label
- [ ] Footer hints correctly reflect available shortcuts for this screen type
- [ ] Form screens: Tab/Shift+Tab navigates fields correctly
- [ ] Table screens: Arrow keys move rows, Enter opens detail
- [ ] Esc on any screen: goes back correctly (no dead Esc)
- [ ] Ctrl+S / F2 fires the primary save action where applicable
- [ ] No two actions on the same screen share the same shortcut key

#### Common Gaps to Fix
- Screens where Esc does nothing (should always go back or close)
- Screens where Enter on a table row does nothing (should drill-through when detail exists)
- Screens where footerHints do not match actual available shortcuts

#### Delivered
- Shared template footer hints now expose the complete keyboard contract for entry, list, approval, and report screens
- HR workflow surfaces now register route-level save, refresh, search-focus, and primary-focus hotkeys through `useErpScreenHotkeys`
- HR action buttons now expose the same shortcut language shown in footer hints (`Ctrl+S / F2`, `Alt+R / F4`)
- No dead shortcut surfaces remain on the current HR workflow and register/report pages

---

#### UX-8 Original Design Note
**Status:** ✅ Complete  
**Scope:** `screenStackEngine.js` + navigation utilities  
**Effort:** High — architectural addition  
**Applies to:** All current and future list/report screens  

This is the most important foundation change. Without this, every future list screen must build its own navigation-and-refresh logic. With this, it is automatic.

#### What Needs to Be Built

**1. `openScreenWithContext(screenCode, context)`**
Extension to `openScreen`. Passes a context object into the screen stack entry.  
Context carries: `{ recordId, returnScreenCode, refreshOnReturn: true/false }`

**2. Context read on detail screen mount**
Detail screen reads `getScreenContext()` on mount to know which record to load.

**3. Return with refresh signal**
When user navigates back (Esc / Back button → `openScreen(parentScreen)`):  
If the parent screen has `refreshOnReturn: true` in its stack entry → fire a registered refresh callback.

**4. `registerScreenRefreshCallback(screenCode, fn)`**
List/report screens register a refresh function when they mount.  
When drill-through returns to them, the navigation engine calls this function automatically.

#### Flow Example (future PO module)
```
PO List screen mounts → registers refreshCallback
User presses Enter on PO row → openScreenWithContext('PO_DETAIL', { recordId: 'PO-001', returnScreenCode: 'PO_LIST', refreshOnReturn: true })
PO Detail opens → reads context → loads PO-001
User edits, saves → toast "Saved"
User presses Esc → openScreen('PO_LIST') → navigation engine sees refreshOnReturn: true → calls PO List refreshCallback
PO List refreshes → shows updated PO-001
```

#### Current HR screens — immediate benefit
- Leave Register results: row → detail drawer (already exists) — can be wired to drill-through
- Leave Approval Inbox: row → approve/reject → inbox auto-refreshes (currently manual refresh)

---

### Phase UX-10 — Transaction Company Selector Component
**Status:** ✅ Complete  
**Scope:** New reusable component  
**Effort:** Low — one component, used everywhere  
**Applies to:** All future transactional screens  

#### What to Build
A reusable `<TransactionCompanySelector />` component:
- For Mode A users (single company): renders the company name as **read-only text** — no selector needed, no confusion
- For Mode B users (multi company): renders a **dropdown** showing the user's assigned companies, defaulting to their primary company
- Placed at the **transaction header level** on every form that creates/edits a business record
- Not a global shell selector — specific to the transaction being created

#### Why Not Global Selector
If company is only in the shell header, a multi-company user working fast will:
1. Create 5 POs for Company A
2. Switch to Company B for something else
3. Forget to switch back
4. Create 3 more POs — accidentally for Company B

Per-transaction selector makes the company **part of the record** — visible, explicit, non-forgettable.

#### Design
```
[ COMPANY ]
[ Almega Surface Coats LLP ▼ ]   ← dropdown for Mode B, plain text for Mode A
```
Placed in the form header area, same row as other header fields (date, reference number, etc.).

#### Delivered
- New reusable `TransactionCompanySelector` component built on top of `ErpCompanySelector`
- Mode A users see read-only transaction company text; Mode B users get an explicit scoped-company dropdown
- Wired into `Leave Apply` and `Out Work Apply` so the company becomes part of the transaction header instead of an implicit shell assumption
- HR create and out-work destination requests now send explicit company context through `x-company-id`
- Backend HR handlers now resolve the target company from validated runtime/header context instead of silently forcing only the mapped parent-company row

---

### Phase UX-11 — ErpFieldPreview Audit
**Status:** ✅ Complete  
**Scope:** All `ErpFieldPreview` usages  
**Effort:** Low  

`ErpFieldPreview` is a read-only field display component. It has legitimate uses (showing read-only data in review flows) and illegitimate uses (showing operator notes, business rule documentation).

#### Keep
- In approval/review drawers: showing requester, dates, reason, status of a record being reviewed
- In SA scope mapping: showing current resolved values (parent company, work companies count)

#### Remove
- Any usage that is effectively "business rule documentation" (e.g., showing "Backdate: 3 days" as a preview card)
- Any usage inside the Context Rail that is now removed

#### Delivered
- Removed documentation-style `ErpFieldPreview` cards from HR register criteria screens (`Date Limit`, `Output`, and ambient company-scope guidance)
- Kept real read-only snapshots in result/report screens and SA governance/detail surfaces where the component shows actual resolved record state

---

## SCREEN-BY-SCREEN CHECKLIST

### ACL Universe

| Screen | Metrics | Description | sideContent | Section Desc | Banner Fix | Status |
|--------|:-------:|:-----------:|:-----------:|:------------:|:----------:|--------|
| UserDashboardHome | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| LeaveApplyPage | ❌ | ❌ | ❌ | ❌ | N/A | ✅ |
| LeaveMyRequestsPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| LeaveApprovalInboxPage | ❌ | ❌ | N/A | ❌ | ⚠️ Perm | ✅ |
| LeaveApprovalScopeHistoryPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| LeaveRegisterPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| LeaveRegisterResultsPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| OutWorkApplyPage | ❌ | ❌ | ❌ | ❌ | N/A | ✅ |
| OutWorkMyRequestsPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| OutWorkApprovalInboxPage | ❌ | ❌ | N/A | ❌ | ⚠️ Perm | ✅ |
| OutWorkApprovalScopeHistoryPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| OutWorkRegisterPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |
| OutWorkRegisterResultsPage | ❌ | ❌ | N/A | ❌ | N/A | ✅ |

### SA Universe

| Screen | Metrics | Description | sideSection | Section Desc | Status |
|--------|:-------:|:-----------:|:-----------:|:------------:|--------|
| SAHome | ❌ | ❌ | N/A | ❌ | ✅ |
| SAControlPanel | ❌ | ❌ | N/A | ❌ | ✅ |
| SACompanyCreate | ❌ | ❌ | N/A | ❌ | ✅ |
| SACompanyManage | ❌ | ❌ | ❌ | ❌ | ✅ |
| SADepartmentMaster | ❌ | ❌ | N/A | ❌ | ✅ |
| SAWorkContextMaster | ❌ | ❌ | N/A | ❌ | ✅ |
| SAGroupGovernance | ❌ | ❌ | N/A | ❌ | ✅ |
| SAUsers | ❌ | ❌ | ❌ | ❌ | ✅ |
| SAUserRoles | ❌ | ❌ | N/A | ❌ | ✅ |
| SAUserScope | ❌ | ❌ | N/A | ❌ | ✅ |
| SAUserScopeReport | ❌ | ❌ | N/A | ❌ | ✅ |
| SAGovernanceSummaryReport | ❌ | ❌ | N/A | ❌ | ✅ |
| SAMenuGovernance | ❌ | ❌ | N/A | ❌ | ✅ |
| SAApprovalRules | ❌ | ❌ | N/A | ❌ | ✅ |
| SAApprovalPolicy | ❌ | ❌ | N/A | ❌ | ✅ |
| SAProjectMaster | ❌ | ❌ | N/A | ❌ | ✅ |
| SAProjectManage | ❌ | ❌ | N/A | ❌ | ✅ |
| SACompanyProjectMap | ❌ | ❌ | N/A | ❌ | ✅ |
| SAModuleMaster | ❌ | ❌ | N/A | ❌ | ✅ |
| SAPageResourceRegistry | ❌ | ❌ | N/A | ❌ | ✅ |
| SAModuleResourceMap | ❌ | ❌ | N/A | ❌ | ✅ |
| SACompanyModuleMap | ❌ | ❌ | N/A | ❌ | ✅ |
| SARolePermissions | ❌ | ❌ | N/A | ❌ | ✅ |
| SACapabilityGovernance | ❌ | ❌ | N/A | ❌ | ✅ |
| SAAclVersionCenter | ❌ | ❌ | N/A | ❌ | ✅ |
| SAReportVisibility | ❌ | ❌ | N/A | ❌ | ✅ |
| SASessions | ❌ | ❌ | N/A | ❌ | ✅ |
| SAAudit | ❌ | ❌ | N/A | ❌ | ✅ |
| SASystemHealth | ❌ | ❌ | N/A | ❌ | ✅ |
| SASignupRequests | ❌ | ❌ | N/A | ❌ | ✅ |
| GAHome | ❌ | ❌ | N/A | ❌ | ✅ |

**Legend:** ❌ = Remove this | ⚠️ = Fix this | N/A = Not applicable to this screen type | ✅ = Done

---

## DEFINITION OF DONE

A screen is **done** when all of the following are true:

**Cleanup Rules (UX-1 to UX-6):**
1. ✅ No metric cards visible anywhere on the screen
2. ✅ No explanatory paragraph below the page title
3. ✅ No 360px side panel (Context Rail, Operator Notes, or any documentation sidebar)
4. ✅ No description text inside section card headers
5. ✅ Form or table is the **first** visible element after the sticky page header
6. ✅ Opening the screen → user can start working **immediately** without reading anything
7. ✅ Save/error feedback appears as toast only (no inline banner in header)
8. ✅ Multi-company banner is gone (removed, not dismissed)

**Foundation Rules (UX-7 to UX-11):**
9. ✅ Every action button has a working keyboard shortcut (Alt+X)
10. ✅ Esc always goes back or closes — never does nothing
11. ✅ Enter on a table row drills through to detail (where detail exists)
12. ✅ Returning from detail to list → list auto-refreshes
13. ✅ Any transactional form (record creation/edit) shows company explicitly at transaction level
14. ✅ No workflow interruption — routine actions complete without confirmation dialogs

---

## IMPLEMENTATION LOG

| Date | Phase | File | Change | Result |
|------|-------|------|--------|--------|
| 2026-04-21 | UX-1 | `ErpScreenScaffold.jsx` | Removed metrics row, inline notice banners, description rendering | ✅ |
| 2026-04-21 | UX-1 | `ErpEntryFormTemplate.jsx` | Removed sideContent/Context Rail, description, metrics, formDescription | ✅ |
| 2026-04-21 | UX-1 | `ErpMasterListTemplate.jsx` | Removed sideSection, summarySection, description, metrics — list full-width | ✅ |
| 2026-04-21 | UX-1 | `ErpApprovalReviewTemplate.jsx` | Removed sideSection, summarySection, description, metrics — review full-width | ✅ |
| 2026-04-21 | UX-1 | `ErpReportFilterTemplate.jsx` | Removed sideSection, summarySection, description, metrics — report full-width | ✅ |
| 2026-04-21 | UX-1 | `HrWorkflowPages.jsx` | Removed metrics, description, sideContent, formDescription from all 8 workspace functions + removed buildListMetrics + removed unused ErpFieldPreview/ErpSectionCard imports | ✅ |
| 2026-04-21 | UX-1 | `SACompanyManage.jsx` | Removed description, metrics, sideSection (Operator Notes), dead metrics useMemo | ✅ |
| 2026-04-21 | UX-1 | `SAApprovalPolicy.jsx` | Removed description, metrics, sideSection | ✅ |
| 2026-04-21 | UX-1 | `SAApprovalRules.jsx` | Removed description, metrics — sideSection (Rule Editor) moved to bottomSection | ✅ |
| 2026-04-21 | UX-1 | `SACompanyCreate.jsx` | Removed description, metrics, sideContent, formDescription | ✅ |
| 2026-04-21 | UX-1 | `SAModuleMaster.jsx` | Removed description, metrics, sideContent | ✅ |
| 2026-04-21 | UX-1 | `SAProjectMaster.jsx` | Removed description, metrics, sideContent | ✅ |
| 2026-04-21 | UX-1 | `SAReportVisibility.jsx` | Removed description, metrics — sideSection (Viewer Rule Editor) moved to bottomSection | ✅ |
| 2026-04-21 | UX-1 | `SARolePermissions.jsx` | Removed description, metrics — sideSection (Deny Editor) moved to bottomSection | ✅ |
| 2026-04-21 | UX-1 | `SASignupRequests.jsx` | Removed description, metrics, summarySection, dead count variables | ✅ |
| 2026-04-21 | UX-1 | 19 remaining SA/ACL screens | Removed metrics prop + dead metric variables/useMemos from all remaining pages | ✅ |
| 2026-04-21 | UX-3 | `MenuShell.jsx` | Removed multi-company banner, `modeBHintDismissed` state, `showModeBHint` variable, `dismissModeBHint` function — banner gone, localStorage key abandoned | ✅ |
| 2026-04-21 | UX-4 | `useErpListNavigation.js` | Created hook — Arrow ↑↓/Home/End/PageUp/PageDown row navigation, Space multi-select, Enter activation, Escape clear/back | ✅ |
| 2026-04-21 | UX-4 | `index.css` | Added `tr:focus-visible` accent outline + `[data-erp-row-selected]` selection highlight | ✅ |
| 2026-04-21 | UX-5 | `SACompanyManage.jsx` | Applied useErpListNavigation to filteredCompanies — replaced rowRefs + handleLinearNavigation on rows | ✅ |
| 2026-04-21 | UX-5 | `SAUsers.jsx` | Applied hook to userPagination.pageItems with onActivate → handleOpenScope | ✅ |
| 2026-04-21 | UX-5 | `SASignupRequests.jsx` | Applied hook — onActivate focuses first action button in row | ✅ |
| 2026-04-21 | UX-5 | `SACapabilityGovernance.jsx` | Applied hook to capability matrix rows | ✅ |
| 2026-04-21 | UX-5 | `SAWorkContextMaster.jsx` | Applied hook to filteredContexts | ✅ |
| 2026-04-21 | UX-5 | `SAPageResourceRegistry.jsx` | Applied hook to filteredRows (button list) | ✅ |
| 2026-04-21 | UX-5 | `SAModuleResourceMap.jsx` | Applied hook to filteredResources (button list) | ✅ |
| 2026-04-21 | UX-5 | `SAProjectManage.jsx` | Applied hook to filteredProjects (button list) | ✅ |
| 2026-04-21 | UX-5 | `SAUserRoles.jsx` | Applied hook to rolePagination.pageItems | ✅ |
| 2026-04-21 | UX-5 | `SASessions.jsx` | Applied hook to sessionPagination.pageItems | ✅ |
| 2026-04-21 | UX-5 | `SAApprovalPolicy.jsx` | Applied hook to filteredResources (button list) | ✅ |
| 2026-04-21 | UX-5 | `SAApprovalRules.jsx` | Applied hook to filteredRules (button list) | ✅ |
| 2026-04-21 | UX-5 | `SAReportVisibility.jsx` | Applied hook to filteredRules (button list) | ✅ |
| 2026-04-21 | UX-5 | `SARolePermissions.jsx` | Applied hook to visibleMatrixRows table | ✅ |
| 2026-04-21 | UX-5 | `SAUserScope.jsx` | Applied 5 aliased hooks for 5 separate lists (companies, workCompanies, workContexts, projects, departments) | ✅ |
| 2026-04-21 | UX-5 | `SACompanyModuleMap.jsx` | Applied getCompanyRowProps + getModuleRowProps | ✅ |
| 2026-04-21 | UX-5 | `SACompanyProjectMap.jsx` | Applied getProjectRowProps + getCompanyRowProps | ✅ |
| 2026-04-21 | UX-5 | `SAAudit.jsx` | Applied hook to auditPagination.pageItems | ✅ |
| 2026-04-21 | UX-5 | SAGroupGovernance, SADepartmentMaster, SAModuleMaster, SAProjectMaster, SAAclVersionCenter | Applied hook to button-list items (background agent) | ✅ |
| 2026-04-21 | UX-5 | SASystemHealth, HrWorkflowPages | Skipped — no data table (static cards / div-based HrRequestCard component) | — |
| 2026-04-21 | UX-6 | `ErpScreenScaffold.jsx` (ErpSectionCard) | Removed `description` prop rendering from ErpSectionCard — component no longer renders description text | ✅ |
| 2026-04-21 | UX-6 | `SAAudit.jsx` | Removed description from ErpMasterListTemplate call | ✅ |
| 2026-04-21 | UX-6 | `SAControlPanel.jsx` | Removed 2 descriptions (ErpScreenScaffold + ErpSectionCard) | ✅ |
| 2026-04-21 | UX-6 | `SACompanyProjectMap.jsx` | Removed 4 descriptions | ✅ |
| 2026-04-21 | UX-6 | `SACompanyModuleMap.jsx` | Removed 5 descriptions | ✅ |
| 2026-04-21 | UX-6 | `SAAclVersionCenter.jsx` | Removed 5 descriptions | ✅ |
| 2026-04-21 | UX-6 | `SADepartmentMaster.jsx` | Removed 7 descriptions | ✅ |
| 2026-04-21 | UX-6 | `SAHome.jsx` | Removed 3 descriptions | ✅ |
| 2026-04-21 | UX-6 | `SAGroupGovernance.jsx` | Removed 5 descriptions (including dynamic description prop) | ✅ |
| 2026-04-21 | UX-6 | `SACapabilityGovernance.jsx` | Removed 5 inline ErpSectionCard descriptions + top-level ErpScreenScaffold description | ✅ |
| 2026-04-21 | UX-6 | `SAGovernanceSummaryReport.jsx` | Removed 4 descriptions | ✅ |
| 2026-04-21 | UX-6 | `UserDashboardHome.jsx` | Removed 4 descriptions | ✅ |
| 2026-04-21 | UX-6 | `HrRegisterReports.jsx` | Removed 6 descriptions (RegisterCriteriaPage param, 2 ErpSectionCard, RegisterResultsPage ErpScreenScaffold, 2 export function callers) | ✅ |
| 2026-04-21 | UX-6 | `EnterpriseDashboard.jsx` | Removed subtitle + workspaceDescription dead props + description calls | ✅ |
| 2026-04-21 | UX-6 | `HrWorkflowFoundationPage.jsx` | Removed 5 description props from component signature and all 4 ErpSectionCard + ErpScreenScaffold calls | ✅ |
| 2026-04-23 | UX-2 | `frontend/src` | Verified no direct operational `ErpMetricCard` usage remains; only shared export stays in scaffold | ✅ |
| 2026-04-23 | UX-5 | `SAControlPanel.jsx`, `SAWorkContextMaster.jsx` | Removed remaining old rowRefs-based row navigation from live list surfaces and standardized on list hook/row-level selection behavior | ✅ |
| 2026-04-23 | UX-6 | `ErpColumnVisibilityDrawer.jsx` + remaining SA/HR screens | Removed final dead `description=` props from live screen/template call sites; repo search now clear except non-UX prop names/locals | ✅ |
| 2026-04-23 | UX-7 | `ErpColumnVisibilityDrawer.jsx`, `SAUserScope.jsx`, `SAMenuGovernance.jsx`, `SAControlPanel.jsx` | Removed drawer intro paragraphs, removed nested section-card wrapper from control-panel drawer tables, and flattened shared column-visibility drawer | ✅ |
| 2026-04-23 | UX-8 | `screenStackEngine.js` | Added stack-entry context, `openScreenWithContext`, `openRouteWithContext`, `getScreenContext`, `registerScreenRefreshCallback`, strict `DRILL_THROUGH` refresh gating, and remount-safe pending return-refresh delivery on `popScreen()` | ✅ |
| 2026-04-23 | UX-8 | `SAUsers.jsx`, `SAUserScope.jsx` | Wired first live drill-through pair: user directory row → scope detail, context-based record resolution, parent auto-refresh on return, and list-state restore (`filter/search/page/focus`) | ✅ |
| 2026-04-23 | UX-9 | `ErpEntryFormTemplate.jsx`, `ErpMasterListTemplate.jsx`, `ErpApprovalReviewTemplate.jsx`, `ErpReportFilterTemplate.jsx`, `HrWorkflowPages.jsx`, `HrRegisterReports.jsx` | Standardized footer hints and route-level hotkeys so save/refresh/search/primary focus are documented and wired on current HR workflow surfaces | ✅ |
| 2026-04-23 | UX-10 | `TransactionCompanySelector.jsx`, `hrApi.js`, `shared.ts`, `leave.handlers.ts`, `out_work.handlers.ts`, `HrWorkflowPages.jsx` | Added reusable transaction-level company selector, explicit company-aware HR API calls, and validated backend company resolution for leave/out-work transactions and destination creation | ✅ |
| 2026-04-23 | UX-11 | `HrRegisterReports.jsx` | Removed documentation-style `ErpFieldPreview` cards from report criteria and kept only real result-state previews | ✅ |

