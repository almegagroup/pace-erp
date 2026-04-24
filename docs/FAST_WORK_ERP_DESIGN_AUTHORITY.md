# PACE ERP — Fast-Work ERP Design Authority
**Classification:** Interaction Architecture Authority — Permanent Design Law  
**Status:** ACTIVE — Claude + Codex Implementation Reference  
**Created:** 2026-04-23  
**Applies to:** All current and future PACE ERP screens  
**Companion:** `FAST_WORK_ERP_IMPLEMENTATION_PLAN.md`

---

## CRITICAL INSTRUCTION FOR CLAUDE AND CODEX

This document is the **single source of truth** for PACE ERP interaction architecture.

Before touching any frontend screen file:
1. Read this document fully
2. Identify which pattern applies to the screen
3. Implement exactly to the pattern — no improvisation
4. Log completion in `FAST_WORK_ERP_IMPLEMENTATION_PLAN.md`

This is not a style guide. This is an **operating architecture law**.

---

## Part 1 — Diagnosis: Why Current ERP Still Feels Like a Web App

### The real problem is not visual. It is architectural.

Even after removing cards, descriptions, side panels — the ERP still feels like a web app because the **interaction model is still web-app structured**.

**Web app interaction model (current PACE ERP):**
- Screen opens → user reads UI → user finds what to do → user clicks → action happens
- The UI is a container that the user navigates inside
- Tables are display surfaces — user reads them
- Forms are fill-and-submit sequences
- Screens are pages with sections

**ERP operating model (SAP/Tally target):**
- Screen opens → user is already in work position → user operates → business event happens
- The screen IS the operation — no navigation needed inside it
- Tables are work registers — user operates from them
- Forms are business transaction entry surfaces
- Screens are operation modes, not pages

### Specific gaps that survive cosmetic cleanup:

**1. Table density gap**
Current tables have web-app row spacing (~48px row height). SAP-grade tables show 28-32px rows. At current density, a user sees ~8 rows. SAP shows 25-35 rows. The user loses context. A register must show enough data to work without scrolling constantly.

**2. No selection screen pattern**
PACE ERP has no SAP-style selection screen. Filter screens are web forms with section cards. SAP selection screens are compact label+input grids — no wrappers, no decoration, pure scope definition. The user fills scope, executes, gets result.

**3. No visible command vocabulary**
In Tally, the right-side button panel always shows available commands. User never hunts for what to do. In current PACE ERP, commands are in buttons/menus — user discovers them. This breaks operating rhythm.

**4. Passive register behavior**
Current list screens show data but do not invite operation. In SAP, the result grid is where the work happens — select row, drill, alter, come back. The grid is the workplace. In PACE ERP, the grid leads to a new screen. The mental model is different.

**5. Form spacing is web-spaced**
Current form rows have 12-16px gaps. SAP/Tally forms are compact — 4-8px between rows. More fields visible. Less scrolling. Faster entry.

**6. No keyboard-led field flow in forms**
Tab moves field to field but there is no deterministic, visible progression. SAP forms have field order that matches business logic. User presses Tab and arrives at the next logically required field — not the next HTML element.

**7. Screen transitions are too frequent**
Web app model: every action = new screen. ERP model: most work happens on one screen. Drill-through returns to the same position. PACE ERP still transitions too often.

---

## Part 2 — Target Operating Philosophy

### The ERP as an Operator Console

PACE ERP must function like an **operator console**, not a web application.

An operator console means:
- Every screen has exactly one operational purpose
- Opening a screen = being in work mode immediately
- No orientation needed — the screen structure reveals its purpose
- Commands are always visible and predictable
- Data is always primary — chrome is minimal

---

### What each screen type must be:

#### Selection Screen
**Purpose:** Define the scope of an operation. What data to work with. What range. What filters.

**Must feel like:** A business control panel. User fills criteria and executes.

**Structure:**
```
[Screen Title — Operation Name]
─────────────────────────────────────────────────
Section label (plain bold, no card)
  Field label          [____input____] to [__input__]
  Field label          [____input____] to [__input__]
  Field label          [____input____]
─────────────────────────────────────────────────
Section label
  Field label          [____input____]
  Checkbox label       [ ]
─────────────────────────────────────────────────
[Execute — F8 / Ctrl+S]    [Footer: F8 EXECUTE  ESC BACK  F9 COMMAND]
```

**Forbidden:** Section cards with borders/backgrounds. Descriptions. Explanatory text. Metric cards. Side panels.

**Keyboard rule:** Tab moves field to field top-to-bottom. F8 or Ctrl+S executes. Esc goes back.

---

#### Register Screen (List / Result Grid)
**Purpose:** The primary work surface. User operates on data from this screen.

**Must feel like:** A dense, live register. Rows of business data. User selects and acts.

**Structure:**
```
[Screen Title]                               [Action buttons]
─────────────────────────────────────────────────────────────
[Quick filter — inline, no card wrapper]
─────────────────────────────────────────────────────────────
COL1    COL2         COL3    COL4    COL5    COL6    STATUS
────────────────────────────────────────────────────────────
val     val          val     val     val     val     val
▶ val   val          val     val     val     val     val   ← selected row (strong highlight)
  val   val          val     val     val     val     val
  val   val          val     val     val     val     val
[25-35 rows visible without scroll]
─────────────────────────────────────────────────────────────
Total: N rows  │  [Totals if applicable]
─────────────────────────────────────────────────────────────
[Footer: ↑↓ NAVIGATE  ENTER OPEN  SPACE SELECT  F8 REFRESH  ESC BACK]
```

**Forbidden:** Section card wrapper around the table. Description above table. Metric cards above table. Decorative row padding.

**Keyboard rule:** Arrow keys navigate rows. Enter drills through. Space selects/deselects. F8 refreshes. Esc returns. The user never needs to reach for the mouse to do primary work.

**Density rule:** Row height max 32px. Font size 12-13px. Visible rows target: 25+ on standard laptop screen.

---

#### Detail / Alter Screen
**Purpose:** View or modify one specific record. Opened from a register via drill-through.

**Must feel like:** A dense form showing one business record. All fields visible. Edit in place.

**Structure:**
```
[Record Identity — e.g., "Leave Request LR-2024-0441"]    [Save  Cancel]
─────────────────────────────────────────────────────────────────────────
Requester      Arun Kumar              Status         APPROVED
Company        Almega Surface Coats    Work Area      PROD_POWDER
From Date      2026-04-15              To Date        2026-04-18
Days           4                       Type           Annual Leave
Reason         [field]
─────────────────────────────────────────────────────────────────────────
[Action strip: APPROVE  REJECT  CANCEL REQUEST]
─────────────────────────────────────────────────────────────────────────
[Footer: CTRL+S SAVE  ESC BACK  F4 REFRESH]
```

**Forbidden:** Sub-section cards. Metric cards. Side panels. Explanatory text. Multiple scrolling sections.

**Keyboard rule:** Tab moves field to field. Ctrl+S saves. Esc goes back to register (with auto-refresh of register).

---

#### Report Screen
**Purpose:** Produce a queryable, operable view of business data across a time range or scope.

**Must feel like:** A Tally ledger. The report IS the work surface. User can drill, filter, export — all without leaving.

**Structure:**
```
[Report Title]              Scope: [Company] [Date Range]      [Export  Refresh]
─────────────────────────────────────────────────────────────────────────────────
[Quick search — inline]
─────────────────────────────────────────────────────────────────────────────────
DATE        REQUESTER       COMPANY     DAYS    STATUS      APPROVER
───────────────────────────────────────────────────────────────────────
2026-04-18  Arun Kumar      ALMEGA      4       APPROVED    Ramesh
2026-04-17  Priya Singh     ALMEGA      2       PENDING     —
[dense rows — 25+]
─────────────────────────────────────────────────────────────────────────────────
Total records: 47  │  Approved: 31  │  Pending: 12  │  Rejected: 4
─────────────────────────────────────────────────────────────────────────────────
[Footer: ↑↓ NAVIGATE  ENTER DRILL  CTRL+S DOWNLOAD  F8 REFRESH  ESC BACK]
```

**Forbidden:** Separate criteria page that replaces the report. Metric cards above the report. Section wrappers.

**Keyboard rule:** Filter inline — user types, report filters live. Arrow keys navigate rows. Enter drills to detail.

---

#### Transaction Entry Screen
**Purpose:** Create a new business record. Leave application. Purchase order. Journal entry.

**Must feel like:** A business voucher entry terminal. Company visible at header. Fields in business order. Execute immediately.

**Structure:**
```
[Transaction Type]     Company: [ALMEGA SURFACE COATS ▼]    Date: [2026-04-23]
───────────────────────────────────────────────────────────────────────────────
From Date      [          ]        To Date        [          ]
Leave Type     [          ▼]       Days           [auto-calc ]
Reason         [                                             ]
Remarks        [                                             ]
───────────────────────────────────────────────────────────────────────────────
[Submit — Ctrl+S]   [Cancel — Esc]
[Footer: CTRL+S SUBMIT  ESC CANCEL  TAB NEXT FIELD]
```

**Forbidden:** Section cards with descriptions around form fields. Separate "confirm" screen before submit. Metric cards.

**Keyboard rule:** Tab follows business field order (not DOM order). Ctrl+S submits. Esc cancels. Company always visible in header — never hidden or inherited silently.

---

#### Approval Inbox Screen
**Purpose:** Work through pending decisions. One queue. One keyboard flow.

**Must feel like:** A work queue that empties as you approve/reject.

**Structure:**
```
[Approval Inbox]          Pending: 12                      [Refresh]
──────────────────────────────────────────────────────────────────────
REQUESTER       TYPE      FROM        TO      DAYS    REQUESTED
Arun Kumar      Leave     2026-04-20  04-22   3       2026-04-18
▶ Priya Singh   Leave     2026-04-21  04-23   3       2026-04-19   ← focused
Ravi Sharma     OutWork   2026-04-22  04-24   3       2026-04-20
──────────────────────────────────────────────────────────────────────
[On row: ENTER VIEW DETAILS  A APPROVE  R REJECT]
[Footer: ↑↓ NAVIGATE  ENTER VIEW  A APPROVE  R REJECT  ESC BACK]
```

**Forbidden:** Opening a full new screen to approve. Confirmation dialogs for routine approvals. Metric cards above queue.

**Keyboard rule:** Arrow keys navigate. A = approve focused row. R = reject focused row. Enter = view details. Bulk approval: Space select multiple, then A.

---

#### Drawer / Popup
**Purpose:** One focused sub-task without leaving the current screen.

**Rule:** A drawer does exactly ONE thing. It does not contain sub-sections, nested cards, or explanatory text.

**Allowed:** Title → form/content → 2 action buttons (Confirm + Cancel). Nothing else.

**Forbidden:** ErpSectionCard inside drawer. Metric display inside drawer. Description paragraphs. Multiple action zones.

**Keyboard rule:** Opens focused on first field. Tab navigates. Ctrl+S confirms. Esc closes.

---

## Part 3 — Fast-Work ERP Design Laws

These are hard laws. Not suggestions. Claude and Codex must follow these without exception.

---

### Law 1 — Density Law
**Every screen must show maximum useful data with minimum vertical space.**

- Table row height: max 32px (target 28px)
- Form row gap: max 8px
- Section gap: max 12px
- No ornamental padding above/below content
- Target: 25+ data rows visible on a 1080p laptop without scrolling

Violation: row height > 40px on a data table. Padding > 16px around a table section.

---

### Law 2 — Command Law
**Every available action must be visible at all times.**

- Footer hints strip is always present and always accurate
- Action buttons in header are always visible (sticky header)
- Keyboard shortcuts must match footer hints exactly
- No hidden actions discoverable only by right-click or hover

Violation: An action exists but has no keyboard shortcut. A shortcut exists but is not in footer hints.

---

### Law 3 — Keyboard Law
**Primary work must be completable without touching the mouse.**

- Every form: Tab/Shift+Tab covers all fields in business order
- Every list: Arrow keys navigate all rows
- Every action: Has an assigned keyboard shortcut
- Esc always does something meaningful (back / close / cancel)
- Enter on a list row always does something (drill / activate)
- Focus is always deterministic — user always knows where focus is

Violation: Any screen where primary work requires a mouse click with no keyboard equivalent.

---

### Law 4 — Register Law
**A list screen IS a work surface. Not a display surface.**

- The list/table is the first element after the page header
- Quick filter sits immediately above the table — no section card wrapper
- Row selection is visually strong (not subtle)
- Actions on selected rows are immediately accessible
- Total/summary row is visible at bottom when applicable

Violation: Table wrapped in a section card with title and padding. Filter inside a bordered section card with gap.

---

### Law 5 — Selection Law
**A filter/criteria screen is a scope definition surface. Not a form.**

- Fields are compact grid rows: label → input → [to → input]
- No section card borders around field groups
- Section groups use plain bold label only (no card, no background)
- Execute action is F8 / Ctrl+S — always keyboard reachable
- Result opens immediately — no intermediate confirmation

Violation: Filter fields inside bordered section cards with background. Execute button requires scrolling to find.

---

### Law 6 — Report Law
**A report is an operating surface. Not a viewing surface.**

- Inline search (not a separate search section)
- Summary totals always visible at bottom of report
- Row navigation: Arrow keys
- Drill-through: Enter
- Export: Ctrl+S
- Refresh: F8 / Alt+R
- Report does not disappear when user drills — it is the anchor

Violation: Report with no drill-through. Report that requires leaving to do anything with the data.

---

### Law 7 — Drill-Through Law
**Every list row that has a detail must support Enter-to-drill. Return must refresh the list.**

- Enter on any row with a detail target → opens detail screen
- Detail screen shows the record in full editable/viewable form
- Esc from detail → returns to list at the same scroll position and row focus
- List auto-refreshes on return (reflects any changes made in detail)
- No "Open" button required — Enter IS the open action

Violation: List row that can only be drilled via a button. Return from detail that loses list position.

---

### Law 8 — Return-and-Refresh Law
**Returning from a drill-through must restore the list state exactly.**

- Same page, same scroll position
- Same filter/search state
- Same selected/focused row (or next row if row was deleted)
- Any changes made in detail are reflected in the list immediately
- No manual refresh required by user after return

Violation: Return from detail resets filter/search. Return from detail shows stale data.

---

### Law 9 — Visibility / Focus Law
**The focused row and focused field must always be visually unambiguous.**

- Selected table row: strong left border (3px accent color) + background change
- Focused table row (keyboard focus): visible focus ring, distinct from selection
- Active form field: clear border/background change
- Focus never disappears without warning

Violation: Focused row looks the same as unfocused row. Active form field has no visible indicator.

---

### Law 10 — Workflow Continuity Law
**Work must not be interrupted unnecessarily.**

- Confirmation dialogs only for irreversible destructive actions (delete, disable)
- Approval, rejection, save: immediate — feedback via toast only
- No "Are you sure?" for routine business actions
- Toast notifications: non-blocking, auto-dismiss, never interrupt work

Violation: Confirmation dialog for approval/rejection. Toast that blocks the screen.

---

### Law 11 — One-Screen Completion Law
**Every primary business operation must complete on one screen.**

- Leave application: one screen (company in header, fields, submit)
- Leave approval: one screen (inbox → keyboard approve, no drill required for routine cases)
- Report with export: one screen (filter inline, export from same screen)
- Screen transitions are reserved for drill-through to detail — not for routine operations

Violation: Submit action navigates to a separate "confirmation" screen. Approval requires opening a new screen.

---

### Law 12 — Transaction Header Law
**Every transactional screen must show company explicitly at the transaction level.**

- Company is always visible in the transaction header
- For single-company users: read-only text
- For multi-company users: dropdown selector in the header
- Company is never silently inherited from a global selector

Violation: Transaction form where company is not visible at the form level.

---

### Law 13 — No-Friction Law
**Every screen must be operable within 2 seconds of opening — no reading required.**

- Screen purpose is self-evident from structure
- First interactive element is focused on mount
- No explanatory text required to understand how to use the screen
- Structure = instruction

Violation: Screen that requires reading labels/descriptions before knowing what to do.

---

### Law 14 — No-Web-App-Ceremony Law
**Remove all web-app structural patterns.**

Forbidden permanently:
- Section cards with borders/backgrounds around tables
- Description paragraphs on any operational screen
- Metric cards (count cards) on any operational screen
- Side panels / context rails / operator notes panels
- "Loading..." cards without inline data
- Empty state illustrations
- Full-screen modal dialogs for sub-tasks (use drawer)

---

## Part 4 — Pattern System (Reusable Components)

### Pattern 1 — ErpDenseGrid
A dense data table for register and report screens.

```
Props:
  columns: [{ key, label, width?, align? }]
  rows: data[]
  rowKey: fn
  onRowActivate: fn (Enter key handler)
  getRowProps: fn (from useErpListNavigation)
  summaryRow?: { label, values }
  stickyHeader: true
  maxHeight: string

Visual spec:
  Row height: 28-32px
  Font: 12px
  Header: bg-slate-800 text-white text-[10px] uppercase tracking-wide
  Row: bg-white border-b border-slate-200
  Row focus: outline 2px accent, z-index 1
  Row selected: bg-sky-100 border-l-[3px] border-sky-600
  Row hover: bg-slate-50
  Cell padding: px-2 py-1
```

### Pattern 2 — ErpSelectionField
A compact label+input field pair for selection screens.

```
Props:
  label: string
  value: string
  onChange: fn
  toValue?: string
  onToChange?: fn
  type: 'text' | 'date' | 'select' | 'number'
  options?: []
  inputRef?: ref

Visual spec:
  Layout: grid grid-cols-[180px_200px_40px_200px] items-center
  Label: text-[11px] font-medium text-slate-700
  Input: border border-slate-400 bg-white px-2 py-1 text-sm
  "to" label: text-[10px] text-slate-500 text-center
  No wrapper card. No border around the row.
  Row gap: 4px
```

### Pattern 3 — ErpCommandStrip (Footer)
The always-visible command vocabulary strip at the bottom of every screen.

```
Props:
  hints: string[]  (e.g. ["F8 REFRESH", "ENTER OPEN", "CTRL+S SAVE"])

Visual spec:
  Position: sticky bottom-0
  Height: 28px
  Background: bg-slate-900
  Text: text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300
  Separator: text-slate-600 mx-3
  Each hint: "KEY ACTION" format
  Always visible — never scroll away
```

### Pattern 4 — ErpDenseFormRow
A compact field row for transaction entry and detail screens.

```
Props:
  label: string
  children: React.ReactNode (the input)
  required?: boolean
  error?: string

Visual spec:
  Layout: grid grid-cols-[160px_1fr] items-start gap-x-3
  Label: text-[11px] font-medium text-slate-600 pt-2
  Row gap: 4px
  No border, no background on the row itself
  Error: text-[11px] text-rose-600 mt-1
```

### Pattern 5 — ErpRegisterHeader
Compact header for register/list screens showing count and inline filter.

```
Props:
  title: string
  count: number
  filterValue: string
  onFilterChange: fn
  filterRef: ref

Visual spec:
  Layout: flex items-center justify-between border-b border-slate-300 pb-2 mb-2
  Title: text-sm font-semibold text-slate-900
  Count: text-[11px] text-slate-500 ml-2
  Filter: inline input, border border-slate-300, text-sm, px-2 py-1, max-w-[240px]
  No section card wrapper
```

### Pattern 6 — ErpSelectionSection
A plain-label group divider for selection screens (no card, no border).

```
Props:
  label: string

Visual spec:
  <div class="mt-4 mb-2">
    <span class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">
      {label}
    </span>
    <div class="mt-1 border-b border-slate-300" />
  </div>
  No background. No card. No shadow.
```

### Pattern 7 — ErpInlineApprovalRow
An approval inbox row with inline approve/reject keyboard actions.

```
Props:
  row: ApprovalRow
  index: number
  isFocused: boolean
  onApprove: fn
  onReject: fn
  onActivate: fn
  rowProps: object (from getRowProps)

Keyboard:
  When row is focused:
    A key → approve (with confirm toast, no dialog)
    R key → reject (opens reason input inline or drawer)
    Enter → open full detail
```

### Pattern 8 — ErpDrillThroughReturn
Standard pattern for all drill-through navigation.

```
Outbound (from list to detail):
  openScreenWithContext(DETAIL_SCREEN, {
    contextKind: 'DRILL_THROUGH',
    recordId: row.id,
    returnScreenCode: CURRENT_SCREEN,
    refreshOnReturn: true,
    returnState: { filter, searchQuery, page, focusKey }
  })

Return (from detail to list):
  popScreen()
  → auto-triggers registered refresh callback on parent
  → restores filter/search/page/focusKey

Both sides must be wired. One-sided drill-through is not complete.
```

---

## Part 5 — Visual and Interaction DNA

### This redesign is NOT:
- A trendy modern enterprise SaaS redesign
- A dashboard-centric redesign
- A card-based redesign with softer cards
- A "cleaner web app"
- A responsive mobile-first redesign
- A visual refresh

### This redesign IS:
- A dense transactional ERP operating surface
- An operator-console interface
- A register-first, report-first work model
- A command-led rhythm (keyboard vocabulary always visible)
- A row-based work speed model
- A deterministic field movement model
- A minimal visual ceremony model
- A speed-optimized daily-work surface

### Color and visual rules:
- Background: white or very light slate (#f8fafc)
- Table header: dark (slate-800 or slate-900) — strong contrast
- Selected row: sky-100 with sky-600 left border — unmistakable
- Focused row: 2px accent outline — visible even without selection
- Error state: rose-600 text, rose-300 border — no icon needed
- Success: emerald-700 text — no card, no icon
- No gradient backgrounds. No shadow cards. No rounded corners on data surfaces.
- Font: system font stack for speed. No decorative font.
- Spacing unit: 4px base. Forms: 4-8px gaps. Tables: 2px cell padding. Sections: 12px.

### Density benchmark:
| Element | Web App (current) | Target ERP |
|---------|-------------------|------------|
| Table row height | 48-56px | 28-32px |
| Form row gap | 12-16px | 4-8px |
| Section gap | 24-32px | 12px |
| Visible rows (1080p) | 8-12 | 25-35 |
| Font size (table) | 14px | 12-13px |
| Header height | 64px | 44px |

---

## Part 6 — Gap Analysis

### Forms
| Aspect | Current | Target |
|--------|---------|--------|
| Row spacing | 12-16px | 4-8px |
| Field wrapper | section card | plain grid row |
| Label width | variable | fixed 160px |
| Section divider | card with border/bg | plain bold label + line |
| Company visibility | global selector only | explicit in transaction header |
| Tab order | DOM order | business logic order |

### Tables / Registers
| Aspect | Current | Target |
|--------|---------|--------|
| Row height | 48-56px | 28-32px |
| Font size | 14px | 12-13px |
| Header style | light slate | dark slate-800 |
| Row selection | subtle bg | strong bg + left border |
| Row focus | browser default | visible 2px ring |
| Wrapper | inside section card | direct in page, no card |
| Visible rows | 8-12 | 25-35 |
| Totals | separate section | inline bottom row |

### Filter / Criteria Screens
| Aspect | Current | Target |
|--------|---------|--------|
| Field layout | section cards | compact label+input grid |
| Section divider | card | bold label + separator line |
| Execute | button in action bar | Ctrl+S / F8 (in footer always) |
| Result navigation | new page | direct transition, same model |

### Keyboard Flow
| Aspect | Current | Target |
|--------|---------|--------|
| Row navigation | arrow keys (hooked) | arrow keys + Home/End/PgUp/PgDn |
| Enter on row | partial (some screens) | all screens with detail target |
| Tab in form | DOM order | business order |
| Esc | partial | always works |
| Approve/reject | button click | A / R key on focused approval row |
| Global shortcut | Ctrl+K | Ctrl+K + F8/F2/F3/Alt+R |

### Drill-Through
| Aspect | Current | Target |
|--------|---------|--------|
| Wired screens | SAUsers→SAUserScope only | all list screens with detail |
| Return refresh | working on SAUsers | all drill-through pairs |
| State restore | partial | filter + search + page + focus |
| HR screens | not wired | all HR list→detail wired |

### Command Visibility
| Aspect | Current | Target |
|--------|---------|--------|
| Footer hints | present on most screens | present + accurate on ALL screens |
| Shortcut language | inconsistent | standardized vocabulary |
| Inline row commands | none | approval screens show A/R hint |

---

## Part 7 — Transformation Strategy

### Principle: Additive, not destructive

Every change must be:
1. **Additive at the component level** — new dense primitives sit alongside existing ones
2. **Screen-by-screen migration** — screens move to new model one at a time
3. **Always working** — no screen is ever in a broken intermediate state
4. **Backward compatible** — old props still accepted where needed (silent, no render)

### Migration path:
```
Phase 1: Build dense primitives (new components — no existing screen touched)
Phase 2: Migrate template layer to use new primitives (invisible to users)
Phase 3: Migrate screen families one by one (HR first, then SA)
Phase 4: Wire all drill-through pairs
Phase 5: Selection screen pattern rollout
Phase 6: Transaction entry density
Phase 7: Report as operating surface
Phase 8: Full validation
```

### Business safety rules:
- No phase touches backend APIs or business logic
- Every screen change is frontend-only
- Approval flows, leave flows, audit flows — business behavior unchanged
- Visual/interaction changes only
- If a screen breaks during migration → revert to previous version, log the issue, do not deploy broken state

---

## Part 8 — Phased Implementation Plan

> Full detail in `FAST_WORK_ERP_IMPLEMENTATION_PLAN.md`

### Phase 1 — Dense Primitive Layer
Build new shared components. No existing screen touched.
- `ErpDenseGrid` component
- `ErpDenseFormRow` component  
- `ErpSelectionField` component
- `ErpSelectionSection` component
- `ErpRegisterHeader` component
- `ErpCommandStrip` update (darker, more Tally-like)
- Dense CSS additions to `index.css`
- **Validation:** Storybook / visual test of all new components

### Phase 2 — Template Layer Update
Update existing templates to use dense primitives.
- `ErpMasterListTemplate` — use ErpDenseGrid
- `ErpEntryFormTemplate` — use ErpDenseFormRow
- `ErpReportFilterTemplate` — use ErpSelectionField
- `ErpApprovalReviewTemplate` — dense layout
- `ErpScreenScaffold` — sticky header height reduction
- **Validation:** All existing screens still work, now denser

### Phase 3 — HR Screen Family Migration
- Leave Apply → transaction entry pattern
- Leave My Requests → register pattern + drill-through
- Leave Approval Inbox → approval inbox pattern with A/R keys
- Leave Approval History → report pattern
- Leave Register → selection screen + dense report
- OutWork Apply → transaction entry pattern
- OutWork My Requests → register pattern + drill-through
- OutWork Approval Inbox → approval inbox pattern with A/R keys
- OutWork Approval History → report pattern
- OutWork Register → selection screen + dense report
- **Validation:** Full HR workflow tested by a user

### Phase 4 — SA Admin Screen Migration
- SA user governance screens → register pattern
- SA company/department/project screens → register pattern
- SA capability/ACL screens → register pattern
- SA report screens → dense report pattern
- All SA selection/filter screens → selection screen pattern
- **Validation:** SA admin can complete full user setup without mouse

### Phase 5 — Drill-Through Completion
Wire all remaining list→detail pairs:
- HR: request row → full request detail
- SA: company row → company detail
- SA: user row → user scope (already done, verify)
- All others per screen inventory
- **Validation:** Every list screen: Enter on row → detail → Esc → back, refreshed

### Phase 6 — Command Layer Polish
- Standardize all footer hints (accurate, consistent vocabulary)
- Approval inbox screens: A/R keyboard actions on row
- Report screens: inline filter live-updates without button press
- **Validation:** Any user can operate any screen from keyboard only

### Phase 7 — Full System Validation
- Walk through every screen family keyboard-only
- Verify density on each screen (row count check)
- Verify command strip accuracy on each screen
- Verify drill-through on all applicable screens
- Verify return-and-refresh on all applicable screens
- Fix any regressions

---

## Part 9 — Component / File Impact Map

### New components to build (Phase 1):
```
frontend/src/components/data/ErpDenseGrid.jsx
frontend/src/components/forms/ErpDenseFormRow.jsx
frontend/src/components/forms/ErpSelectionField.jsx
frontend/src/components/forms/ErpSelectionSection.jsx
frontend/src/components/data/ErpRegisterHeader.jsx
frontend/src/components/layout/ErpCommandStrip.jsx  (update existing footer)
frontend/src/index.css  (dense row CSS variables)
```

### Templates to update (Phase 2):
```
frontend/src/components/templates/ErpScreenScaffold.jsx
frontend/src/components/templates/ErpMasterListTemplate.jsx
frontend/src/components/templates/ErpEntryFormTemplate.jsx
frontend/src/components/templates/ErpReportFilterTemplate.jsx
frontend/src/components/templates/ErpApprovalReviewTemplate.jsx
```

### Screen families to migrate (Phase 3-6):
```
HR screens: ~10 screens in frontend/src/pages/dashboard/hr/
SA screens: ~25 screens in frontend/src/admin/sa/screens/
```

### Navigation utilities (Phase 5):
```
frontend/src/navigation/screenStackEngine.js  (already extended for drill-through)
frontend/src/hooks/useErpListNavigation.js  (already built — extend if needed)
```

---

## Part 10 — Regression-Safe Execution Rules

### Rules for Claude and Codex:

**Rule 1:** Never edit a screen without first reading it fully. Never guess prop names or component structure.

**Rule 2:** Never change backend API calls, auth logic, approval routing, or session behavior. Frontend interaction only.

**Rule 3:** Every phase must be complete before the next phase starts. Do not partially migrate a screen family.

**Rule 4:** After each screen migration, verify:
- Screen opens without error
- Primary action works
- Keyboard navigation works
- No console errors

**Rule 5:** Log every completed screen in `FAST_WORK_ERP_IMPLEMENTATION_PLAN.md` with date and what changed.

**Rule 6:** If a screen cannot be migrated cleanly (complex state, risk of breakage), flag it in the log and skip. Do not force-migrate.

**Rule 7:** Never leave a screen in a hybrid state — half old pattern, half new pattern. Either fully migrated or untouched.

**Rule 8:** Dense primitives (ErpDenseGrid etc.) must be built and tested before any screen migration uses them. Phase 1 must be complete before Phase 2 begins.

**Rule 9:** The footer command strip must be updated simultaneously with the screen — never leave a screen with inaccurate footer hints after migration.

**Rule 10:** Hand-off protocol between Claude and Codex:
- Before stopping work: update the log in `FAST_WORK_ERP_IMPLEMENTATION_PLAN.md`
- Mark each completed item with `✅ DONE [date] [who: Claude/Codex]`
- Mark in-progress items with `🔄 IN PROGRESS [date] [who]`
- Mark blocked items with `⛔ BLOCKED [reason]`
- The next session starts by reading the log — not by re-reading the whole codebase
