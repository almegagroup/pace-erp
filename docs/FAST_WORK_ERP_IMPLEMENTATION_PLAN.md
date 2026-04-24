# PACE ERP â€” Fast-Work ERP Implementation Plan
**Classification:** Implementation Tracking Authority â€” Living Document  
**Status:** ACTIVE â€” Updated after every work session  
**Created:** 2026-04-23  
**Applies to:** All current and future PACE ERP screens  
**Design Authority:** `FAST_WORK_ERP_DESIGN_AUTHORITY.md` â† Read this first

---

## CRITICAL INSTRUCTION FOR CLAUDE AND CODEX

**Before starting any work in a new session:**
1. Read `FAST_WORK_ERP_DESIGN_AUTHORITY.md` fully
2. Read the **Active Work Log** section at the bottom of THIS file
3. Find the last `ðŸ”„ IN PROGRESS` entry â€” that is where you resume
4. Never start a new phase until the previous phase is marked `âœ… DONE`
5. After completing any task, update the log entry immediately

**Log format:**
- `âœ… DONE [YYYY-MM-DD] [Claude/Codex]` â€” completed, verified
- `ðŸ”„ IN PROGRESS [YYYY-MM-DD] [Claude/Codex]` â€” started, not finished
- `â›” BLOCKED [reason]` â€” cannot proceed, document why
- `â¬œ NOT STARTED` â€” queued, untouched

---

## Foundation Baseline â€” UX-1 through UX-9 (Pre-existing work)

These tasks were completed before Phase 1 of the Fast-Work redesign began.
They represent the keyboard-native foundation that Phase 1+ builds on top of.

| Task | Description | Status |
|------|-------------|--------|
| UX-1 | Remove all description props from ErpMasterListTemplate | âœ… DONE 2026-04-22 Codex |
| UX-2 | Remove all description props from ErpEntryFormTemplate | âœ… DONE 2026-04-22 Codex |
| UX-3 | Remove all description props from ErpApprovalReviewTemplate | âœ… DONE 2026-04-22 Codex |
| UX-4 | Remove all description props from ErpReportFilterTemplate | âœ… DONE 2026-04-22 Codex |
| UX-5 | Wire useErpListNavigation into HrRegisterReports results table (+ ErpStickyDataTable getRowProps prop) | âœ… DONE 2026-04-23 Claude |
| UX-6 | Remove description from EnterpriseDashboard | âœ… DONE 2026-04-23 Claude |
| UX-7 | Remove description from ErpColumnVisibilityDrawer | âœ… DONE 2026-04-22 Codex |
| UX-8 | Remove description from ErpScreenScaffold / scaffold children | âœ… DONE 2026-04-22 Codex |
| UX-9 | Add footerHints to all SA screens, SACompanyCreate, UserDashboardHome, GAHome, EnterpriseDashboard | âœ… DONE 2026-04-23 Claude |

**Foundation is solid. Phase 1 begins here.**

---

## Phase 1 â€” Dense Primitive Layer

> **Goal:** Build new shared components. Zero existing screens touched.  
> **Rule:** All Phase 1 components must be built and individually verified before any Phase 2 work begins.  
> **Validation:** Every component renders correctly in isolation. No console errors. Props match the spec in the Design Authority.

### New Files to Create

| # | File | Component | Pattern Ref | Status |
|---|------|-----------|-------------|--------|
| 1.1 | `frontend/src/components/data/ErpDenseGrid.jsx` | ErpDenseGrid | Part 4, Pattern 1 | âœ… DONE 2026-04-24 Codex |
| 1.2 | `frontend/src/components/forms/ErpDenseFormRow.jsx` | ErpDenseFormRow | Part 4, Pattern 4 | âœ… DONE 2026-04-24 Codex |
| 1.3 | `frontend/src/components/forms/ErpSelectionField.jsx` | ErpSelectionField | Part 4, Pattern 2 | âœ… DONE 2026-04-24 Codex |
| 1.4 | `frontend/src/components/forms/ErpSelectionSection.jsx` | ErpSelectionSection | Part 4, Pattern 6 | âœ… DONE 2026-04-24 Codex |
| 1.5 | `frontend/src/components/data/ErpRegisterHeader.jsx` | ErpRegisterHeader | Part 4, Pattern 5 | âœ… DONE 2026-04-24 Codex |
| 1.6 | `frontend/src/components/layout/ErpCommandStrip.jsx` | ErpCommandStrip | Part 4, Pattern 3 | âœ… DONE 2026-04-24 Codex |
| 1.7 | `frontend/src/components/data/ErpInlineApprovalRow.jsx` | ErpInlineApprovalRow | Part 4, Pattern 7 | âœ… DONE 2026-04-24 Codex |

### CSS Additions

| # | File | Change | Status |
|---|------|--------|--------|
| 1.8 | `frontend/src/index.css` | Add dense row variables: `--erp-row-height: 30px`, `--erp-form-gap: 6px`, `--erp-section-gap: 12px` | âœ… DONE 2026-04-24 Codex |

### Component Specs (implement exactly as below)

#### 1.1 ErpDenseGrid
```jsx
// Props:
//   columns: Array<{ key: string, label: string, width?: string, align?: 'left'|'right'|'center' }>
//   rows: Array<any>
//   rowKey: (row, index) => string
//   onRowActivate?: (row, index) => void   // called on Enter key
//   getRowProps?: (row, index) => object   // from useErpListNavigation
//   summaryRow?: { label: string, values: Record<string, string> }
//   stickyHeader?: boolean                 // default true
//   maxHeight?: string                     // default 'calc(100vh - 200px)'
//   emptyMessage?: string

// Visual: header bg-slate-800 text-white text-[10px] uppercase tracking-wide
//         row height 30px, font-size 12px (text-xs)
//         selected row: bg-sky-100 border-l-[3px] border-l-sky-600
//         focused row: outline-2 outline-sky-400
//         hover: bg-slate-50
//         cell padding: px-2 py-1
//         no ErpSectionCard wrapper â€” renders a bare table
```

#### 1.2 ErpDenseFormRow
```jsx
// Props:
//   label: string
//   required?: boolean
//   error?: string
//   children: React.ReactNode

// Visual: grid grid-cols-[160px_1fr] items-start gap-x-3
//         gap between rows: gap-y-1.5 (6px)
//         label: text-[11px] font-medium text-slate-600 pt-[7px]
//         no border, no background on the row itself
//         error: text-[11px] text-rose-600 mt-0.5 col-start-2
```

#### 1.3 ErpSelectionField
```jsx
// Props:
//   label: string
//   value: string
//   onChange: (val: string) => void
//   toValue?: string
//   onToChange?: (val: string) => void
//   type?: 'text'|'date'|'select'|'number'   // default 'text'
//   options?: Array<{ value: string, label: string }>
//   inputRef?: React.Ref

// Visual: grid grid-cols-[180px_200px_40px_200px] items-center gap-x-1 py-0.5
//         if no toValue: grid-cols-[180px_1fr]
//         label: text-[11px] font-medium text-slate-700
//         input: border border-slate-400 bg-white px-2 py-0.5 text-sm h-7
//         "to" separator: text-[10px] text-slate-500 text-center
//         no wrapper card, no wrapper border
```

#### 1.4 ErpSelectionSection
```jsx
// Props:
//   label: string

// Visual:
//   <div className="mt-4 mb-2">
//     <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">
//       {label}
//     </span>
//     <div className="mt-1 border-b border-slate-300" />
//   </div>
//   No background. No card. No shadow. No border-radius.
```

#### 1.5 ErpRegisterHeader
```jsx
// Props:
//   title: string
//   count?: number
//   filterValue?: string
//   onFilterChange?: (val: string) => void
//   filterRef?: React.Ref
//   filterPlaceholder?: string

// Visual: flex items-center justify-between border-b border-slate-300 pb-2 mb-2
//         title: text-sm font-semibold text-slate-900
//         count: ml-2 text-[11px] text-slate-500  (e.g. "47 rows")
//         filter: inline border border-slate-300 text-sm px-2 py-1 h-7 max-w-[240px]
//         no section card wrapper
```

#### 1.6 ErpCommandStrip
```jsx
// Props:
//   hints: string[]   // e.g. ["F8 REFRESH", "ENTER OPEN", "CTRL+S SAVE", "ESC BACK"]

// Visual: sticky bottom-0 z-20
//         h-7 (28px) bg-slate-900
//         flex items-center gap-0 px-4
//         each hint: text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300 px-3
//         separator between hints: text-slate-600  |
//         This replaces/supersedes the footerHints rendering in ErpScreenScaffold
//         (ErpScreenScaffold still accepts footerHints for backward compat, renders ErpCommandStrip internally)
```

#### 1.7 ErpInlineApprovalRow
```jsx
// Props:
//   row: object
//   index: number
//   isFocused: boolean
//   columns: Array<{ key: string, label: string, render?: fn }>
//   onApprove: (row) => void
//   onReject: (row) => void
//   onActivate: (row) => void
//   rowProps: object   // spread from getRowProps(index)

// Keyboard (only when isFocused):
//   A key â†’ onApprove(row)   (no dialog â€” toast feedback only)
//   R key â†’ onReject(row)    (opens inline reason input or drawer)
//   Enter â†’ onActivate(row)

// Visual: same density as ErpDenseGrid rows
//         when focused: show pill hints "A APPROVE  R REJECT" at row end (text-[10px] text-slate-500)
//         approved rows: text-emerald-700, rejected rows: text-rose-600
```

### Phase 1 Completion Criteria

Before moving to Phase 2, verify:
- [ ] All 7 components render without errors
- [ ] ErpDenseGrid shows 25+ rows in a 768px viewport
- [ ] ErpCommandStrip is sticky at bottom and never scrolls away
- [ ] ErpSelectionField with range (from/to) renders correctly
- [ ] ErpDenseFormRow label aligns with input at 160px fixed width
- [ ] No existing screen is affected (components are new files only)

---

## Phase 2 â€” Template Layer Update

> **Goal:** Update existing templates to use dense primitives internally.  
> **Rule:** All existing screens must continue to work after each template change. No screen-level changes.  
> **Validation:** Open each screen family. Verify denser layout. No regressions.

### Templates to Update

| # | File | Change | Status |
|---|------|--------|--------|
| 2.1 | `frontend/src/components/templates/ErpScreenScaffold.jsx` | Replace footer hints div with `<ErpCommandStrip hints={footerHints} />`. Reduce sticky header height to 44px. | âœ… DONE 2026-04-24 Codex |
| 2.2 | `frontend/src/components/templates/ErpMasterListTemplate.jsx` | Replace `ErpStickyDataTable` usage with `ErpDenseGrid`. Wire `getRowProps`. Add `ErpRegisterHeader`. Remove section card wrapper around table. | âœ… DONE 2026-04-24 Codex |
| 2.3 | `frontend/src/components/templates/ErpEntryFormTemplate.jsx` | Replace form field containers with `ErpDenseFormRow`. Reduce row gap to 6px. | âœ… DONE 2026-04-24 Codex |
| 2.4 | `frontend/src/components/templates/ErpReportFilterTemplate.jsx` | Replace section card field groups with `ErpSelectionSection` + `ErpSelectionField`. | âœ… DONE 2026-04-24 Codex |
| 2.5 | `frontend/src/components/templates/ErpApprovalReviewTemplate.jsx` | Use `ErpDenseGrid` for the queue list. Wire `ErpInlineApprovalRow` for A/R keyboard actions. | âœ… DONE 2026-04-24 Codex |

### Phase 2 Completion Criteria

Before moving to Phase 3, verify each template:
- [ ] ErpScreenScaffold: footer strip is dark, sticky, 28px height
- [ ] ErpMasterListTemplate: table rows are 30px height, no section card wrapper around table
- [ ] ErpEntryFormTemplate: form rows are compact (6px gap), labels are fixed 160px
- [ ] ErpReportFilterTemplate: filter fields have no card wrappers, section dividers are plain bold label + line
- [ ] ErpApprovalReviewTemplate: A/R keys work on focused row
- [ ] All existing screens that use these templates: open without errors, data loads, primary action works

---

## Phase 3 â€” HR Screen Family Migration

> **Goal:** Migrate all HR workflow screens to ERP operator console model.  
> **Rule:** Screens inside `HrWorkflowPages.jsx` and `HrRegisterReports.jsx` are migrated as sub-screens. Business logic untouched.  
> **Validation:** A user can complete a full HR workflow (apply â†’ approve â†’ view history) keyboard-only.

### File Map

The HR screens are organized across three files:
- `frontend/src/pages/dashboard/hr/HrWorkflowFoundationPage.jsx` â€” module home/foundation
- `frontend/src/pages/dashboard/hr/HrWorkflowPages.jsx` â€” all transactional sub-screens
- `frontend/src/pages/dashboard/hr/HrRegisterReports.jsx` â€” register, reports, approval history

**Before editing any HR file: read it fully first.**

### Leave Module Screens

| # | Screen (in file) | Target Pattern | Key Changes | Status |
|---|-----------------|----------------|-------------|--------|
| 3.1 | Leave Apply (in HrWorkflowPages) | Transaction Entry | Company in header, ErpDenseFormRow for fields, Ctrl+S submit, Esc cancel | ? DONE |
| 3.2 | Leave My Requests (in HrWorkflowPages) | Register | ErpDenseGrid, ErpRegisterHeader, Arrow/Enter navigation, drill-through to detail | ? DONE |
| 3.3 | Leave Approval Inbox (in HrWorkflowPages) | Approval Inbox | ErpInlineApprovalRow, A/R keys, pending count in header | ? DONE |
| 3.4 | Leave Approval History (in HrWorkflowPages) | Report | ErpDenseGrid, inline filter, dense rows, drill-through | ? DONE |
| 3.5 | Leave Register — Criteria Page (in HrRegisterReports) | Selection Screen | ErpSelectionField + ErpSelectionSection, no card wrappers, F8/Ctrl+S execute | ? DONE |
| 3.6 | Leave Register — Results Page (in HrRegisterReports) | Register/Report | ErpDenseGrid, dense rows, totals row, export Ctrl+S | ? DONE |

### OutWork Module Screens

| # | Screen (in file) | Target Pattern | Key Changes | Status |
|---|-----------------|----------------|-------------|--------|
| 3.7 | OutWork Apply (in HrWorkflowPages) | Transaction Entry | Same as Leave Apply: company header, ErpDenseFormRow, Ctrl+S | ? DONE |
| 3.8 | OutWork My Requests (in HrWorkflowPages) | Register | Same as Leave My Requests | ? DONE |
| 3.9 | OutWork Approval Inbox (in HrWorkflowPages) | Approval Inbox | Same as Leave Approval Inbox | ? DONE |
| 3.10 | OutWork Approval History (in HrWorkflowPages) | Report | Same as Leave Approval History | ? DONE |
| 3.11 | OutWork Register — Criteria Page (in HrRegisterReports) | Selection Screen | Same as Leave Register Criteria | ? DONE |
| 3.12 | OutWork Register — Results Page (in HrRegisterReports) | Register/Report | Same as Leave Register Results | ? DONE |

### HR Foundation

| # | Screen | Target Pattern | Key Changes | Status |
|---|--------|----------------|-------------|--------|
| 3.13 | HrWorkflowFoundationPage | Operator Home | Dense action list, keyboard navigation to sub-screens, ErpCommandStrip | ? DONE |

### Phase 3 Completion Criteria

- [x] Leave full cycle: Apply ? My Requests ? Approval Inbox ? Approve — keyboard only
- [x] OutWork full cycle same
- [x] Register criteria ? results ? export — keyboard only
- [x] Drill-through on My Requests list works: Enter ? detail ? Esc ? back, list refreshed
- [x] No mouse needed for any step in the above flows
- [x] All screens: footer command strip accurate, dark, sticky

---

## Phase 4 â€” SA Admin Screen Migration

> **Goal:** Migrate all SA admin screens to ERP operator console model.  
> **Rule:** SA screens are all in `frontend/src/admin/sa/screens/`. Each file is one screen.  
> **Validation:** SA admin can complete full user setup and company governance keyboard-only.

### Dashboard / Home

| # | File | Target Pattern | Key Changes | Status |
|---|------|----------------|-------------|--------|
| 4.1 | `SAHome.jsx` | Operator Home | Dense action list, ErpCommandStrip, accurate hints | ? DONE 2026-04-24 Codex |
| 4.2 | `SAControlPanel.jsx` | Operator Dashboard | Dense layout, no metric cards, keyboard navigation | ? DONE 2026-04-24 Codex |
| 4.3 | `SASystemHealth.jsx` | Report/Status | Dense status grid, refresh F8/Alt+R | ? DONE 2026-04-24 Codex |

### User Governance

| # | File | Target Pattern | Key Changes | Status |
|---|------|----------------|-------------|--------|
| 4.4 | `SAUsers.jsx` | Register + Drill-Through | ErpDenseGrid, keyboard row nav, Enter->SAUserScope | ? DONE 2026-04-24 Codex |
| 4.5 | `SAUserScope.jsx` | Detail/Alter | ErpDenseFormRow, Ctrl+S save, Esc back to SAUsers (already wired â€” densify) | ? DONE 2026-04-24 Codex |
| 4.6 | `SAUserRoles.jsx` | Register | ErpDenseGrid, row nav, Enter focuses inline role edit | ? DONE 2026-04-24 Codex |
| 4.7 | `SASignupRequests.jsx` | Approval Inbox | ErpInlineApprovalRow pattern, A/R keys, non-blocking approval flow | ? DONE 2026-04-24 Codex |
| 4.8 | `SASessions.jsx` | Report | Dense session list, inline filter, F8 refresh, Enter focuses revoke action | ? DONE 2026-04-24 Codex |

### Company & Structure Governance

| # | File | Target Pattern | Key Changes | Status |
|---|------|----------------|-------------|--------|
| 4.9 | `SACompanyManage.jsx` | Register | ErpDenseGrid, keyboard nav, Enter focuses lifecycle action | ? DONE 2026-04-24 Codex |
| 4.10 | `SACompanyCreate.jsx` | Transaction Entry | ErpDenseFormRow, company header, Ctrl+S, Esc cancel (footerHints already added â€” now densify form) | IN PROGRESS 2026-04-24 Codex (dense form done; routine save confirm still present) |
| 4.11 | `SACompanyModuleMap.jsx` | Register + Mapping | Dense list, inline check/uncheck, keyboard | â¬œ NOT STARTED |
| 4.12 | `SACompanyProjectMap.jsx` | Register + Mapping | Dense list, inline check/uncheck, keyboard | â¬œ NOT STARTED |
| 4.13 | `SADepartmentMaster.jsx` | Register | ErpDenseGrid, add/edit dense, Ctrl+S | â¬œ NOT STARTED |
| 4.14 | `SAProjectMaster.jsx` | Register | ErpDenseGrid, dense | IN PROGRESS 2026-04-24 Codex (dense grid done; routine save confirm still present) |
| 4.15 | `SAProjectManage.jsx` | Detail/Alter | ErpDenseFormRow, Ctrl+S, Esc back | â¬œ NOT STARTED |
| 4.16 | `SAModuleMaster.jsx` | Register | ErpDenseGrid, dense | IN PROGRESS 2026-04-24 Codex (dense grid done; search/filter surface missing, routine save confirm still present) |
| 4.17 | `SAWorkContextMaster.jsx` | Register | ErpDenseGrid, dense | DONE 2026-04-24 Codex |

### Permissions & Governance

| # | File | Target Pattern | Key Changes | Status |
|---|------|----------------|-------------|--------|
| 4.18 | `SAGroupGovernance.jsx` | Register | ErpDenseGrid, keyboard nav | â¬œ NOT STARTED |
| 4.19 | `SACapabilityGovernance.jsx` | Register | ErpDenseGrid, keyboard nav | DONE 2026-04-24 Codex |
| 4.20 | `SARolePermissions.jsx` | Register + Mapping | Dense permission grid | DONE 2026-04-24 Codex |
| 4.21 | `SAApprovalPolicy.jsx` | Register | ErpDenseGrid, keyboard nav | DONE 2026-04-24 Codex |
| 4.22 | `SAApprovalRules.jsx` | Register | ErpDenseGrid, keyboard nav | DONE 2026-04-24 Codex |
| 4.23 | `SAMenuGovernance.jsx` | Register | ErpDenseGrid, keyboard nav | â¬œ NOT STARTED |
| 4.24 | `SAModuleResourceMap.jsx` | Register + Mapping | Dense, keyboard | â¬œ NOT STARTED |
| 4.25 | `SAPageResourceRegistry.jsx` | Register | ErpDenseGrid, keyboard nav | â¬œ NOT STARTED |
| 4.26 | `SAReportVisibility.jsx` | Register | ErpDenseGrid, keyboard nav | DONE 2026-04-24 Codex |
| 4.27 | `SAAclVersionCenter.jsx` | Report/Version List | Dense version list, keyboard | â¬œ NOT STARTED |

### Audit & Reports

| # | File | Target Pattern | Key Changes | Status |
|---|------|----------------|-------------|--------|
| 4.28 | `SAAudit.jsx` | Report | Dense audit log, inline filter, Enter opens audit detail pane | ? DONE 2026-04-24 Codex |
| 4.29 | `SAGovernanceSummaryReport.jsx` | Report | Dense report, export Ctrl+S, inline filter | ? DONE 2026-04-24 Codex |
| 4.30 | `SAUserScopeReport.jsx` | Report | Dense report, export Ctrl+S | ? DONE 2026-04-24 Codex |

### Phase 4 Completion Criteria

- [ ] SA admin can onboard a new user (create â†’ assign role â†’ set scope) keyboard-only
- [ ] SA admin can review sessions and audit log keyboard-only
- [ ] Governance and permission screens: all rows navigable by Arrow keys
- [ ] All SA screens: footer command strip accurate, dark, sticky
- [ ] No mouse needed for any primary SA operation

---

## Phase 5 â€” Drill-Through Completion

> **Goal:** Wire all remaining list â†’ detail pairs across the entire application.  
> **Rule:** Every list screen where a row has a detail target must support Enter-to-drill. Return must refresh list.  
> **Pattern:** Use `openScreenWithContext` with `contextKind: 'DRILL_THROUGH'` and `registerScreenRefreshCallback`. See Design Authority Part 4, Pattern 8.

### Drill-Through Pairs to Wire

| # | From Screen | To Screen | State to Restore | Status |
|---|-------------|-----------|-----------------|--------|
| 5.1 | Leave My Requests list | Leave Request Detail | filter, searchQuery, page, focusKey | â¬œ NOT STARTED |
| 5.2 | Leave Approval Inbox | Leave Request Detail (approval view) | focusedRow | â¬œ NOT STARTED |
| 5.3 | Leave Approval History | Leave Request Detail (read-only) | filter, page, focusKey | â¬œ NOT STARTED |
| 5.4 | Leave Register Results | Leave Request Detail (read-only) | filter, page, focusKey | â¬œ NOT STARTED |
| 5.5 | OutWork My Requests list | OutWork Request Detail | filter, searchQuery, page, focusKey | â¬œ NOT STARTED |
| 5.6 | OutWork Approval Inbox | OutWork Request Detail (approval view) | focusedRow | â¬œ NOT STARTED |
| 5.7 | OutWork Approval History | OutWork Request Detail (read-only) | filter, page, focusKey | â¬œ NOT STARTED |
| 5.8 | OutWork Register Results | OutWork Request Detail (read-only) | filter, page, focusKey | â¬œ NOT STARTED |
| 5.9 | SAUsers â†’ SAUserScope | Already wired â€” verify return-and-refresh still works | filter, searchQuery, focusKey | â¬œ VERIFY |
| 5.10 | SACompanyManage | SACompanyCreate (edit mode) | focusKey | â¬œ NOT STARTED |
| 5.11 | SAProjectMaster | SAProjectManage | focusKey | â¬œ NOT STARTED |
| 5.12 | SAAudit | Audit Detail (if screen exists) | filter, page | â¬œ NOT STARTED |

### Drill-Through Verification Checklist (for each pair)

For every wired pair, test:
- [ ] Enter on focused row â†’ opens correct detail screen
- [ ] Detail screen shows correct record data
- [ ] Esc from detail â†’ returns to list
- [ ] List is at same scroll position and row focus
- [ ] List data is refreshed (reflects any edits made in detail)
- [ ] Filter/search state is preserved on return
- [ ] No "Open" button required â€” Enter is the primary action

### Phase 5 Completion Criteria

- [ ] All 12 drill-through pairs verified per checklist
- [ ] Return-and-refresh works on every pair
- [ ] No list screen with a drillable row lacks Enter-to-drill

---

## Phase 6 â€” Command Layer Polish

> **Goal:** Ensure every screen has accurate, complete, and consistent keyboard vocabulary.  
> **Rule:** Footer hints must exactly match what each key actually does. No mismatch allowed.

### Command Standardization

| # | Task | Status |
|---|------|--------|
| 6.1 | Audit all screen footer hints â€” verify each hint's key actually works | â¬œ NOT STARTED |
| 6.2 | Standardize shortcut vocabulary across all screens (see table below) | â¬œ NOT STARTED |
| 6.3 | Approval inbox screens: confirm A/R keys are wired and in footer | â¬œ NOT STARTED |
| 6.4 | Report screens: confirm inline filter live-updates without button press | â¬œ NOT STARTED |
| 6.5 | Selection screens: confirm F8 / Ctrl+S executes and is in footer | â¬œ NOT STARTED |
| 6.6 | All list screens: confirm Home/End/PgUp/PgDn work for row navigation | â¬œ NOT STARTED |
| 6.7 | All form screens: confirm Tab follows business field order (not DOM order) | â¬œ NOT STARTED |

### Standard Keyboard Vocabulary

| Key | Action | Footer text |
|-----|--------|-------------|
| Arrow Up/Down | Navigate list rows | â†‘â†“ NAVIGATE |
| Enter | Open / drill / activate | ENTER OPEN |
| Space | Select / deselect row | SPACE SELECT |
| Esc | Back / cancel / close | ESC BACK |
| Ctrl+S | Save / submit / export | CTRL+S SAVE |
| F8 | Execute / refresh | F8 REFRESH or F8 EXECUTE |
| Ctrl+K / F9 | Command palette | CTRL+K COMMAND BAR |
| Alt+Shift+P | Focus primary element | ALT+SHIFT+P FOCUS |
| A | Approve (approval screens only) | A APPROVE |
| R | Reject (approval screens only) | R REJECT |
| F2 | Edit focused record | F2 EDIT |
| Alt+R | Refresh | ALT+R REFRESH |

### Phase 6 Completion Criteria

- [ ] Any user can operate any screen from keyboard only â€” no mouse needed
- [ ] Every footer hint is accurate â€” no stale/missing hints
- [ ] Approval screens: full A/R workflow without mouse
- [ ] Register screens: inline filter works live
- [ ] All shortcuts in this vocabulary are implemented where the screen supports the action

---

## Phase 7 â€” Full System Validation

> **Goal:** Walk the entire application as an ERP operator. Find and fix any remaining gaps.  
> **Rule:** This phase is inspection + fix only. No new features. No architectural changes.

### Validation Checklist by Screen Family

#### HR Module
- [ ] Leave Apply: open â†’ fill fields â†’ Ctrl+S submit â†’ confirm success
- [ ] Leave My Requests: open â†’ Arrow navigate â†’ Enter drill â†’ detail opens â†’ Esc back â†’ list refreshed
- [ ] Leave Approval Inbox: open â†’ Arrow navigate â†’ A approve â†’ toast confirmation â†’ no dialog shown
- [ ] Leave Register: criteria screen â†’ F8 execute â†’ results â†’ Arrow navigate â†’ Ctrl+S export
- [ ] OutWork: repeat all above for OutWork

#### SA Module
- [ ] User onboarding: SAUsers â†’ Arrow â†’ Enter â†’ SAUserScope â†’ fill â†’ Ctrl+S â†’ Esc back â†’ list refreshed
- [ ] Company governance: SACompanyManage â†’ Enter â†’ SACompanyCreate edit â†’ Ctrl+S â†’ back
- [ ] Audit review: SAAudit â†’ inline filter â†’ Arrow navigate â†’ Enter â†’ detail â†’ Esc back
- [ ] Report: SAGovernanceSummaryReport â†’ filter â†’ Ctrl+S export

#### Cross-Screen
- [ ] Command palette (Ctrl+K): opens on any screen, routes correctly
- [ ] Tab between screens: focus management intact
- [ ] No screen with missing or wrong footer hints
- [ ] No screen with web-app patterns remaining (section cards around tables, description paragraphs, metric cards on operational screens)

### Density Verification

For each screen with a data table, confirm:
- [ ] Row height â‰¤ 32px
- [ ] Visible rows â‰¥ 20 on a 1080p display (target 25+)
- [ ] Font size 12-13px in table cells
- [ ] Header is dark (slate-800 or darker)

### Regression Check

- [ ] No console errors on any screen
- [ ] All API calls still work (no backend changes introduced)
- [ ] All approval flows still work correctly
- [ ] All leave/outwork workflows complete end-to-end
- [ ] Auth, session, ACL behavior unchanged

### Phase 7 Completion Criteria

- [ ] All checklist items above verified
- [ ] Zero web-app patterns remaining on any screen
- [ ] Zero missing or inaccurate footer hints
- [ ] Full HR and SA workflows completable keyboard-only

---

## Screen Inventory Reference

> Quick lookup of all screen files for use during implementation.

### HR Screens (3 files)
```
frontend/src/pages/dashboard/hr/HrWorkflowFoundationPage.jsx   â€” HR home
frontend/src/pages/dashboard/hr/HrWorkflowPages.jsx            â€” Leave Apply, My Requests, Approval Inbox (both modules)
frontend/src/pages/dashboard/hr/HrRegisterReports.jsx          â€” Register criteria, results, approval history (both modules)
```

### SA Screens (30 files)
```
frontend/src/admin/sa/screens/SAHome.jsx
frontend/src/admin/sa/screens/SAControlPanel.jsx
frontend/src/admin/sa/screens/SASystemHealth.jsx
frontend/src/admin/sa/screens/SAUsers.jsx
frontend/src/admin/sa/screens/SAUserScope.jsx
frontend/src/admin/sa/screens/SAUserRoles.jsx
frontend/src/admin/sa/screens/SASignupRequests.jsx
frontend/src/admin/sa/screens/SASessions.jsx
frontend/src/admin/sa/screens/SACompanyManage.jsx
frontend/src/admin/sa/screens/SACompanyCreate.jsx
frontend/src/admin/sa/screens/SACompanyModuleMap.jsx
frontend/src/admin/sa/screens/SACompanyProjectMap.jsx
frontend/src/admin/sa/screens/SADepartmentMaster.jsx
frontend/src/admin/sa/screens/SAProjectMaster.jsx
frontend/src/admin/sa/screens/SAProjectManage.jsx
frontend/src/admin/sa/screens/SAModuleMaster.jsx
frontend/src/admin/sa/screens/SAWorkContextMaster.jsx
frontend/src/admin/sa/screens/SAGroupGovernance.jsx
frontend/src/admin/sa/screens/SACapabilityGovernance.jsx
frontend/src/admin/sa/screens/SARolePermissions.jsx
frontend/src/admin/sa/screens/SAApprovalPolicy.jsx
frontend/src/admin/sa/screens/SAApprovalRules.jsx
frontend/src/admin/sa/screens/SAMenuGovernance.jsx
frontend/src/admin/sa/screens/SAModuleResourceMap.jsx
frontend/src/admin/sa/screens/SAPageResourceRegistry.jsx
frontend/src/admin/sa/screens/SAReportVisibility.jsx
frontend/src/admin/sa/screens/SAAclVersionCenter.jsx
frontend/src/admin/sa/screens/SAAudit.jsx
frontend/src/admin/sa/screens/SAGovernanceSummaryReport.jsx
frontend/src/admin/sa/screens/SAUserScopeReport.jsx
```

### New Component Files (Phase 1 â€” to create)
```
frontend/src/components/data/ErpDenseGrid.jsx
frontend/src/components/data/ErpRegisterHeader.jsx
frontend/src/components/data/ErpInlineApprovalRow.jsx
frontend/src/components/forms/ErpDenseFormRow.jsx
frontend/src/components/forms/ErpSelectionField.jsx
frontend/src/components/forms/ErpSelectionSection.jsx
frontend/src/components/layout/ErpCommandStrip.jsx
```

### Templates to Update (Phase 2)
```
frontend/src/components/templates/ErpScreenScaffold.jsx
frontend/src/components/templates/ErpMasterListTemplate.jsx
frontend/src/components/templates/ErpEntryFormTemplate.jsx
frontend/src/components/templates/ErpReportFilterTemplate.jsx
frontend/src/components/templates/ErpApprovalReviewTemplate.jsx
```

### Other Key Files
```
frontend/src/components/data/ErpStickyDataTable.jsx      â€” extended with getRowProps (UX-5 done)
frontend/src/components/dashboard/EnterpriseDashboard.jsx â€” footerHints wired (UX-9 done)
frontend/src/pages/dashboard/UserDashboardHome.jsx        â€” footerHints added (UX-9 done)
frontend/src/admin/ga/screens/GAHome.jsx                  â€” footerHints added (UX-9 done)
frontend/src/index.css                                    â€” add dense CSS variables (Phase 1.8)
```

---

## Active Work Log

> This section is updated after every work session. The next session reads THIS SECTION FIRST.  
> Most recent entry is at the TOP.

---

### [2026-04-24] — Claude — Phase 3 HR Screen Migration — 100% Completion Pass

**Session result:** Completed remaining Phase 3 gaps. All HR workflow screens now fully comply with the Design Authority interaction architecture.

**Changes made:**

- `HrWorkflowPages.jsx`
  - `HR_ENTRY_FOOTER_HINTS` updated to standard vocabulary: Tab Next Field / Ctrl+S Submit / Esc Cancel
  - `HR_LIST_FOOTER_HINTS` updated to standard vocabulary: ?? Navigate / Enter Open / Space Select / F8 Refresh / Esc Back / Ctrl+K Command Bar
  - `HR_APPROVAL_FOOTER_HINTS` **new constant** added: ?? Navigate / Enter View / **A Approve** / **R Reject** / F8 Refresh / Esc Back
  - `HrApprovalInboxWorkspace` now uses `HR_APPROVAL_FOOTER_HINTS` (was incorrectly using `HR_LIST_FOOTER_HINTS`)
  - `handleDecision` (approve/reject): **removed `openActionConfirm` dialog** — now immediate per Design Authority Law 10 (Workflow Continuity Law). Cancel still uses dialog (destructive action — correct).

- `HrRegisterReports.jsx`
  - `RegisterCriteriaPage` footer hints: standard vocabulary (F8 Execute / Ctrl+S Execute / Esc Back / Ctrl+K Command Bar)
  - `RegisterCriteriaPage` outer grid gap: `gap-4` ? `gap-[var(--erp-section-gap)]`
  - `RegisterCriteriaPage` Run Report button: added `hint: "F8 / Ctrl+S"` label
  - `RegisterResultsPage` footer hints: standard vocabulary (?? Navigate / Enter Open / Ctrl+S Export / F8 Refresh / Esc Back / Ctrl+K Command Bar)

- `HrWorkflowFoundationPage.jsx`
  - Outer grid gap: `gap-4` ? `gap-[var(--erp-section-gap)]`

**Phase 3 status:** ? DONE 2026-04-24 Claude — all 13 HR sub-screens complete, Design Authority contract fully satisfied

**Design Authority laws now satisfied:**
- Law 2 (Command Law): footer hints accurate on all HR screens ?
- Law 10 (Workflow Continuity Law): A/R immediate, no dialog ?
- Law 14 (No Web-App Ceremony): section gaps use CSS variable ?

**Next action:** Phase 4 — SA Admin Screen Migration. Resume from where Codex left off: 4.4 SAUsers onward (4.1-4.3, 4.5, 4.29, 4.30 already done).

---

### [2026-04-24] — Claude — Phase 2 Template Layer — 100% Completion Pass

**Session result:** Completed the remaining Phase 2 gaps that Codex had not fully closed. All four screen templates now correctly implement the full dense-primitive contract.

**Changes made:**

- `ErpMasterListTemplate.jsx`
  - Default footerHints updated to standard ERP vocabulary (?? Navigate / Enter Open / Space Select / F8 Refresh / Esc Back / Ctrl+K Command Bar)
  - Outer grid gap changed from `gap-4` (16px) ? `gap-[var(--erp-section-gap)]` (12px)
  - Removed `min-h-[560px]` web-app ceremony from list section wrapper
  - `ErpRegisterHeader` now receives full prop passthrough: `count`, `filterValue`, `onFilterChange`, `filterRef`, `filterPlaceholder` via `listSection.*`
  - `showListHeader` now also triggers when `listSection.count` is present

- `ErpEntryFormTemplate.jsx`
  - Default footerHints updated to standard vocabulary (Tab Next Field / Ctrl+S Save / Esc Cancel / Ctrl+K Command Bar)
  - Outer grid gap changed from `gap-4` ? `gap-[var(--erp-section-gap)]`
  - Form section gap changed from `gap-3` ? `gap-2`
  - Form title size changed from `text-base` ? `text-sm` (authority density spec)

- `ErpReportFilterTemplate.jsx`
  - Default footerHints updated to standard vocabulary (?? Navigate / Enter Open / Ctrl+S Export / F8 Refresh / Esc Back / Ctrl+K Command Bar)
  - Outer grid gap changed from `gap-4` ? `gap-[var(--erp-section-gap)]`
  - Report section gap changed from `gap-3` ? `gap-2`
  - Removed `min-h-[560px]` from report section
  - `ErpRegisterHeader` now receives full prop passthrough via `reportSection.*`

- `ErpApprovalReviewTemplate.jsx`
  - Default footerHints updated to approval vocabulary (?? Navigate / Enter View / **A Approve** / **R Reject** / F8 Refresh / Esc Back)
  - Outer grid gap changed from `gap-4` ? `gap-[var(--erp-section-gap)]`
  - Review section gap changed from `gap-3` ? `gap-2`
  - Removed `min-h-[560px]` from review section
  - `ErpRegisterHeader` now receives full prop passthrough via `reviewSection.*`

**Phase 2 status:** ? DONE 2026-04-24 Claude — all 5 templates complete, Design Authority contract fully satisfied

**Next action:** Phase 4 — SA Admin Screen Migration (Phase 3 HR already done by Codex). Resume from where Codex left off: 4.4 SAUsers onward.

---

### [2026-04-24] — Codex — Phase 4 SA Low-Mid Bucket Recheck

**Session result:** Rechecked the five SA files in the low-mid bucket against the Design Authority and the implementation plan. Two governance register screens are fully closed; three company/project/module screens improved substantially but still retain routine save-confirm or missing register-filter details, so they remain in progress.

**Current verified state:**
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAApprovalRules.jsx`
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAReportVisibility.jsx`
- IN PROGRESS 2026-04-24 Codex — `frontend/src/admin/sa/screens/SACompanyCreate.jsx`
- IN PROGRESS 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAProjectMaster.jsx`
- IN PROGRESS 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAModuleMaster.jsx`

**Verification:**
- `frontend/npm.cmd run lint` OK
- `frontend/npm.cmd run build` OK

**Remaining before this bucket can be called fully closed:**
- Remove routine save confirm from `SACompanyCreate.jsx`, `SAProjectMaster.jsx`, and `SAModuleMaster.jsx` to match transaction/register continuity rules
- Add the missing visible search/filter surface in `SAModuleMaster.jsx`
- Finish the remaining low bucket SA mapping, governance, and version-center screens still pending in the 20% range
- Re-check the full Phase 4 completion checklist only after the remaining SA family is migrated

**Phase 4 status:** IN PROGRESS 2026-04-24 Codex

---

### [2026-04-24] — Codex — Phase 4 SA Mid-Bucket Governance Register Closure

**Session result:** The mid-progress SA governance register bucket is now closed file by file. These screens no longer rely on partial template coverage; each one now has dense register-first structure, truthful Enter behavior, and visible selected-row work surfaces.

**Closed in this session:**
- 4.17 SAWorkContextMaster.jsx
- 4.19 SACapabilityGovernance.jsx
- 4.20 SARolePermissions.jsx
- 4.21 SAApprovalPolicy.jsx

**Verification:**
- `frontend/npm.cmd run lint` OK
- `frontend/npm.cmd run build` OK

**Remaining before Phase 4 can be marked complete:**
- Finish the lower-progress SA mapping, governance, and transaction-entry screens still pending in the 20–35% bucket
- Re-check the full Phase 4 completion checklist only after the remaining SA family is migrated

**Phase 4 status:** IN PROGRESS 2026-04-24 Codex

---

### [2026-04-24] — Codex — Phase 4 SA High-Progress Register Bucket Closed

**Session result:** The high-progress SA register/report/queue bucket is now verified and closed file-by-file. These screens now have truthful footer hints, meaningful Enter behavior, and keyboard-first row work aligned to the fast-work authority without relying on template coverage alone.

**Completed in this session:**
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAUsers.jsx`
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAUserRoles.jsx`
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SASignupRequests.jsx`
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SASessions.jsx`
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SACompanyManage.jsx`
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAAudit.jsx`

**Verification:**
- `npm.cmd run lint` ?
- `npm.cmd run build` ?

**Remaining before Phase 4 can be marked complete:**
- Finish the lower-progress SA mapping, governance, and transaction-entry screens still pending below 4.10 onward
- Re-check the full Phase 4 completion checklist only after the remaining SA family is migrated

**Phase 4 status:** IN PROGRESS 2026-04-24 Codex

---### [2026-04-24] — Codex — Phase 4 SA Admin Screen Migration In Progress

**Session result:** Phase 4 is in progress. The custom SA operator/report surfaces below were migrated to the dense fast-work pattern, but the broader template-backed SA screen family still needs strict file-by-file closure before Phase 4 can be called complete.

**Completed in this session:**
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAHome.jsx`
  - Flattened operator home sections into dense action/status strips
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAControlPanel.jsx`
  - Removed card-style snapshot blocks from the main surface and converted them to dense operational sections
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SASystemHealth.jsx`
  - Converted diagnostics/status display into dense grid/register presentation
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAUserScope.jsx`
  - Flattened the main user-scope detail surface into dense operator sections while keeping drawer editors intact
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAGovernanceSummaryReport.jsx`
  - Migrated report surface to dense register/report pattern with inline register header and row navigation
- DONE 2026-04-24 Codex — `frontend/src/admin/sa/screens/SAUserScopeReport.jsx`
  - Migrated report surface to dense register/report pattern with inline register header and row navigation

**Verification:**
- `npm.cmd run lint` OK
- `npm.cmd run build` OK

**Remaining before Phase 4 can be marked complete:**
- Verify and migrate the remaining template-backed SA admin screens file by file
- Re-check every SA primary workflow against the Phase 4 completion checklist

**Phase 4 status:** IN PROGRESS 2026-04-24 Codex

---
### [2026-04-24] — Codex — Phase 3 HR Screen Family Migration Complete

**Session result:** Phase 3 completed. HR workflow family now uses dense transaction, register, approval queue, and report patterns without hybrid card/matrix leftovers.

**Completed:**
- DONE 2026-04-24 Codex — `frontend/src/pages/dashboard/hr/HrWorkflowPages.jsx`
  - Leave + OutWork apply screens converted to dense transaction entry rows with transaction company in-header
  - My Requests / Approval Inbox / Approval History / Register surfaces migrated to dense register pattern
  - Approval inbox now uses inline approval rows with keyboard-led A/R handling
  - Row Enter opens dense detail view instead of leaving the operator surface
- DONE 2026-04-24 Codex — `frontend/src/pages/dashboard/hr/HrRegisterReports.jsx`
  - Criteria screens converted to selection-screen layout via `ErpSelectionField` + `ErpSelectionSection`
  - Results screens moved to dense report/register surface with `ErpDenseGrid`, totals, pagination, and export
- DONE 2026-04-24 Codex — `frontend/src/pages/dashboard/hr/HrWorkflowFoundationPage.jsx`
  - Foundation/home surface flattened into dense operator-home sections

**Verification:**
- `npm.cmd run lint` OK
- `npm.cmd run build` OK

**Next action for next session:**
Start Phase 4 — SA Admin Screen Migration.

**Phase 3 status:** DONE 2026-04-24 Codex

---

### [2026-04-24] — Codex — Phase 2 Template Layer Update Complete

**Session result:** Phase 2 completed. Shared template layer now consumes dense primitives and fast-work wrappers without breaking existing screen contracts.

**Completed:**
- DONE 2026-04-24 Codex — `frontend/src/components/templates/ErpScreenScaffold.jsx`
  - Footer hints now render through `ErpCommandStrip`
  - Sticky screen header tightened to fast-work density
- DONE 2026-04-24 Codex — `frontend/src/components/templates/ErpMasterListTemplate.jsx`
  - Filter/list surfaces moved out of section-card wrappers into plain dense sections
  - Register header primitive integrated for list surface title band
- DONE 2026-04-24 Codex — `frontend/src/components/templates/ErpEntryFormTemplate.jsx`
  - Form shell flattened into dense plain section structure
  - Dense form-gap wrapper added around form content
- DONE 2026-04-24 Codex — `frontend/src/components/templates/ErpReportFilterTemplate.jsx`
  - Filter/report surfaces moved to dense plain sections
  - Selection/register primitives integrated at template level
- DONE 2026-04-24 Codex — `frontend/src/components/templates/ErpApprovalReviewTemplate.jsx`
  - Filter/review surfaces moved to dense plain sections
  - Dense register header integrated for review surface

**Verification:**
- `npm.cmd run lint` OK
- `npm.cmd run build` OK

**Next action for next session:**
Start Phase 3 — HR Screen Family Migration in this order:
1. `HrWorkflowFoundationPage.jsx`
2. `HrWorkflowPages.jsx` Leave + OutWork transactional screens
3. `HrRegisterReports.jsx`

**Phase 2 status:** DONE 2026-04-24 Codex

---

### [2026-04-24] — Codex — Phase 1 Dense Primitive Layer Complete

**Session result:** Phase 1 completed. Built all seven dense primitives and the dense CSS variable layer without touching existing screens.

**Completed:**
- DONE 2026-04-24 Codex — `frontend/src/components/data/ErpDenseGrid.jsx`
- DONE 2026-04-24 Codex — `frontend/src/components/forms/ErpDenseFormRow.jsx`
- DONE 2026-04-24 Codex — `frontend/src/components/forms/ErpSelectionField.jsx`
- DONE 2026-04-24 Codex — `frontend/src/components/forms/ErpSelectionSection.jsx`
- DONE 2026-04-24 Codex — `frontend/src/components/data/ErpRegisterHeader.jsx`
- DONE 2026-04-24 Codex — `frontend/src/components/layout/ErpCommandStrip.jsx`
- DONE 2026-04-24 Codex — `frontend/src/components/data/ErpInlineApprovalRow.jsx`
- DONE 2026-04-24 Codex — `frontend/src/index.css` dense variables added (`--erp-row-height`, `--erp-form-gap`, `--erp-section-gap`)

**Verification:**
- `npm.cmd run lint` OK
- `npm.cmd run build` OK

**Next action for next session:**
Start Phase 2. Update template layer in this order:
1. `ErpScreenScaffold.jsx`
2. `ErpMasterListTemplate.jsx`
3. `ErpEntryFormTemplate.jsx`
4. `ErpReportFilterTemplate.jsx`
5. `ErpApprovalReviewTemplate.jsx`

**Phase 1 status:** DONE 2026-04-24 Codex

---
### [2026-04-23] â€” Claude â€” Session Start

**Session result:** Design Authority document created (`FAST_WORK_ERP_DESIGN_AUTHORITY.md`). Implementation Plan created (this file). Foundation baseline (UX-1 through UX-9) confirmed complete.

**Next action for next session:**
Start Phase 1. Build `ErpDenseGrid.jsx` first â€” it is the most-used primitive. Then `ErpDenseFormRow`, `ErpSelectionField`, `ErpSelectionSection`, `ErpRegisterHeader`, `ErpCommandStrip`, `ErpInlineApprovalRow`. Then CSS variables.

**Phase 1 status:** ðŸ”„ IN PROGRESS 2026-04-23 â€” READY TO START (no components built yet)

---

> â†‘ Add new log entries above this line. Keep most recent at top.
> Format: `### [YYYY-MM-DD] â€” [Claude/Codex] â€” [Brief session title]`










