# Phase 2 UX Component Guidelines — Communication Automation Control

**Applies to:** Communication Automation Phase 2 SA/GA Enrollment UI  
**Status:** REQUIRED ADDENDUM TO PHASE-2 TASK BRIEF  
**Date:** 2026-09-14

This file supplements:

`docs/CODEX-COMMUNICATION-AUTOMATION-PHASE-2-SA-ENROLLMENT-UI-TASK-BRIEF.md`

If there is any ambiguity about UX component choice, follow this addendum.

---

## Core Rule

Use existing PACE ERP components according to the job they are best at.

Do not avoid `ErpDenseGrid`, modal, or drawer just because the page is intended to stay simple. Simplicity means using the right component at the right layer, not flattening everything into one plain form.

Before implementing, inspect current component implementations and strong existing examples in the repository. Reuse those components rather than building lookalikes.

---

## 1. Search Results — Use `ErpDenseGrid`

Search results are row-oriented operational data and should use the existing `ErpDenseGrid` pattern where technically compatible.

Expected columns should stay compact, for example:

- TX Code
- Page Name
- Communication Status
- Enlisted Status
- optional compact action/select affordance

Requirements:

- dense row height consistent with PACE operator/admin UX,
- keyboard-accessible row selection where supported,
- no card-per-search-result UI,
- no oversized table chrome,
- preserve loading / no-result / error states using established grid patterns,
- a row should be visually distinguishable when currently selected,
- communication-ready vs not-ready should be immediately readable without decorative dashboard widgets.

If the existing `ErpDenseGrid` supports sorting/filtering features that are useful here, use them only where they improve the workflow; do not enable irrelevant features simply because they exist.

---

## 2. Page Configuration — Prefer Center Drawer When Effective

The selected page's communication configuration is a focused edit workflow and is a good candidate for the existing PACE center drawer pattern if that pattern is available and appropriate.

Preferred interaction:

1. Search/result grid remains the primary page workspace.
2. Selecting/configuring a communication-ready row opens a **center drawer** containing that page's configuration.
3. Drawer shows:
   - page identity/title,
   - Email ON/OFF,
   - surface checkboxes,
   - Save,
   - De-enlist when applicable.

Why drawer is preferred here:

- user keeps search/results context,
- configuration does not make the base page vertically large,
- matches the future page-level Automation Settings interaction style,
- avoids navigating away for a very small configuration task.

However, Codex must inspect current PACE drawer components first. If the existing drawer component is explicitly unsuitable for admin editing, use the closest established equivalent rather than inventing a new drawer framework.

Do NOT use a drawer as a place to pack unrelated information or multiple future phases.

---

## 3. Modal — Use for Decisions / Confirmation, Not Main Configuration

Use an existing modal/confirmation component for bounded decisions such as:

- confirm De-enlist,
- confirm discard of unsaved changes before switching to another page/closing drawer,
- any destructive or state-losing action that existing PACE UX normally confirms.

A modal should NOT hold the entire normal Communication Enrollment form unless repository conventions make a drawer unavailable/inappropriate.

Preferred division:

- `ErpDenseGrid` = browse/select
- center drawer = configure
- modal = confirm destructive/discard actions

---

## 4. Dirty State + Drawer Close

If the configuration drawer has unsaved changes and the user:

- closes the drawer,
- selects another search result,
- navigates away through an applicable in-page action,

use the existing confirmation modal/pattern before discarding changes.

Do not silently lose changes.
Do not implement a heavyweight draft persistence system.

---

## 5. Configuration Layout Inside Drawer

Keep it dense and obvious.

Suggested order:

### Header
`PO11 — Procurement Planning`

Small status text:

- Enlisted / Not Enlisted
- Communication Ready

### Channel
`Email  [ON/OFF]`

### Placement
`Show Automation Settings on:`

Checkbox list using backend-returned friendly surface labels.

### Footer Actions

- Save
- De-enlist (only if currently enlisted)
- Cancel/Close following existing drawer convention

Do not add cards around each section.
Do not add tab navigation for this small form.
Do not show resource codes/routes unless needed for troubleshooting and already an accepted admin pattern.

---

## 6. Component Reuse Is Mandatory

Before writing custom UI primitives, search the current repo for:

- `ErpDenseGrid`
- center drawer / drawer components
- modal / confirmation components
- toggle/switch components
- checkbox components
- existing admin-page search fields
- toast/notification components

Use existing PACE components and conventions wherever possible.

If an existing component lacks one small capability, prefer a minimal extension that does not break existing callers over creating a duplicate component family.

Do not create components named like `CommunicationTable`, `CommunicationModal`, etc. if they merely reimplement an existing generic PACE component.

---

## 7. Responsiveness / Usability

The control is primarily a desktop ERP admin workflow.

Ensure:

- grid stays usable at normal ERP desktop widths,
- drawer width is sufficient for labels without excessive whitespace,
- long page/surface labels wrap or truncate using current PACE convention,
- primary actions remain visible,
- keyboard focus is handled correctly when opening/closing modal or drawer if existing component provides focus management.

---

## 8. Acceptance Examples

A good Phase-2 interaction should feel like:

```text
Communication Automation Control

Search: [ PO11                         ]

ErpDenseGrid
┌──────┬──────────────────────┬──────────────┬──────────┐
│ TX   │ Page                 │ Ready        │ Enlisted │
├──────┼──────────────────────┼──────────────┼──────────┤
│ PO11 │ Procurement Planning │ Yes          │ Yes      │
└──────┴──────────────────────┴──────────────┴──────────┘

Selecting PO11 → center drawer opens

┌─────────────────────────────────────────────┐
│ PO11 — Procurement Planning                 │
│ Email                              [ ON ]    │
│                                             │
│ Show Automation Settings on                 │
│ ☑ Planning Dashboard                       │
│ ☑ Monthly Plan Input                       │
│ ☐ SLOC Group Setup                         │
│ ☐ Item Group Setup                         │
│ ☐ History / Archive                        │
│ ☑ Planning Dashboard Report                │
│                                             │
│ [Save]                         [De-enlist]   │
└─────────────────────────────────────────────┘
```

Clicking De-enlist → confirmation modal.
Closing/switching with dirty changes → discard-confirmation modal.

---

## 9. Do Not Overuse Components

Correct component use does NOT mean every interaction needs a modal/drawer/grid.

Examples:

- search input stays a normal search input,
- success feedback stays normal toast/status feedback,
- no extra modal after successful Save,
- no nested drawer inside drawer,
- no modal inside modal,
- no grid inside the small configuration drawer unless a future requirement truly needs row data.

The goal is **effective reuse**, not component maximalism.

---

## 10. Verification Requirement

Codex final report must explicitly state:

- where `ErpDenseGrid` was used and why,
- which existing drawer component/pattern was reused,
- which existing modal/confirmation component/pattern was reused,
- any reason an expected component could not be used,
- confirmation that no duplicate generic UI framework was created.
