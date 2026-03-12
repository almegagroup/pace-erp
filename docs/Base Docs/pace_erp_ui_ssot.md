# PACE‑ERP — UI Single Source of Truth (SSOT)

## Document Status
Authoritative UI specification for the PACE‑ERP frontend. This document defines the rules, architecture, and constraints that must be followed when building the UI. Any UI implementation must comply with this SSOT.

---

# 1. Purpose

This document defines the **official UI architecture and design rules** for PACE‑ERP.

Goals:

- Maintain backend‑authority model
- Align UI with Gate‑7 Menu Snapshot
- Align navigation with Gate‑8 Screen Stack
- Ensure strong UI uniformity
- Provide a professional but minimal ERP interface
- Ensure maintainability and scalability

Frontend must never bypass backend security, ACL, or routing authority.

---

# 2. Core Architectural Principles

## 2.1 Backend Authority

Frontend never decides:

- roles
- permissions
- module access
- data visibility

All authority originates from backend APIs.

Frontend only renders backend decisions.

---

## 2.2 Menu Snapshot Driven Navigation

Sidebar menu is generated from:

GET /api/me/menu

The snapshot determines:

- visible modules
- allowed routes
- navigation hierarchy

If a route is not present in the snapshot, UI must block access.

---

## 2.3 Screen Stack Navigation (Gate‑8)

Navigation uses a stack engine.

Example workflow:

Dashboard
→ push Module List
→ push Record Form
→ pop Module List
→ pop Dashboard

Browser back must respect the stack order.

---

## 2.4 Context Driven UI (Gate‑5)

All ERP operations run inside context:

- Company
- Project
- Department

Context is loaded immediately after login.

Endpoint:

GET /api/me/context

---

# 3. UI Layout Architecture

PACE‑ERP uses a **Hybrid SAP‑style layout**.

Structure:

Header
Sidebar (collapsible)
Workspace

Layout model:

Header
| Sidebar | Workspace |

Workspace is the primary operational area.

---

# 4. Sidebar Navigation Model

Sidebar behavior:

Default state: collapsed

Collapsed width: 64px
Expanded width: 220px

Collapsed example:

| D |
| U |
| C |
| P |

Expanded example:

Dashboard
Users
Companies
Projects
Modules
Reports

Sidebar only visualizes the backend menu snapshot.

---

# 5. Header System

Header contains:

- Logo
- Breadcrumb
- Context Switcher
- Notifications
- User Menu

Header height:

56px

Logo position:

Top‑left

Click behavior:

Logo → /home

---

# 6. Workspace System

Workspace is the main rendering area.

Background:

#F8FAFC

Padding:

24px

All pages render inside the workspace.

Examples:

- dashboards
- module lists
- forms
- reports

---

# 7. Branding System

PACE‑ERP branding includes:

Logo placements:

- header
- login screen
- loading screen
- favicon

Logo variants:

- full logo
- compact logo
- icon logo

Banner usage:

Banner appears only before login.

Flow:

ERP URL → Landing → Login → Dashboard

Banner never appears inside the application workspace.

---

# 8. Theme System

PACE‑ERP uses **Light Theme**.

Color palette:

Primary: #1E3A8A
Background: #FFFFFF
Surface: #F5F6F8
Border: #E5E7EB

Success: #16A34A
Warning: #F59E0B
Danger: #DC2626

Colors must be referenced through tokens.

---

# 9. Typography

Font family:

Inter

Font scale:

Page Title → 20px
Section Title → 16px
Body Text → 14px
Table Text → 13px

Typography must remain consistent across the application.

---

# 10. Spacing System

Spacing grid:

4px
8px
16px
24px
32px

Workspace padding:

24px

Table row padding:

12px

Spacing must use tokens instead of arbitrary values.

---

# 11. Table Design Pattern

ERP interactions are primarily table based.

Standard table layout:

Create Button
Search
Filters

Table

Pagination

Example structure:

ID | Name | Project | Status | Actions

Tables support:

- search
- filters
- pagination
- sorting
- export
- bulk actions

---

# 12. Form Design Pattern

Forms must be minimal and structured.

Structure:

Section Title
Fields
Action Buttons

Example actions:

Save
Submit
Cancel

Forms must prioritize fast data entry.

---

# 13. Component System

All UI elements must use centralized components.

Core components:

- Button
- Table
- Form
- Modal
- Sidebar
- Header
- Breadcrumb
- Toolbar

Pages must not implement their own UI primitives.

---

# 14. Tailwind Usage Policy

Tailwind is allowed but controlled.

Allowed usage:

- layout
- spacing
- grid
- typography

Avoid:

- random utility chains
- inline styling chaos

Components must encapsulate styling.

---

# 15. Icon System

Icon library:

lucide‑react

Icons must remain minimal and consistent.

---

# 16. Global UI System

Global UI logic is centralized.

Layers:

Theme
Design Tokens
Core Components
Layout System
Utilities

Pages must import shared elements from these systems.

---

# 17. Folder Architecture

src

app

core

layouts

components

pages

utils


Core modules include:

api
session
menu
context
screenstack

---

# 18. Screen Layer Model

Public

Landing
Login
Access Request
Request Submitted

Foundation

Session Bootstrap
Context Loader
Menu Loader
Route Guard
Screen Registry
Screen Stack Router

Admin

User Governance
Company Management
ACL Governance
Module Governance
Audit
Diagnostics

User

Dashboard
Context Selector
Modules
Forms

---

# 19. UI Experience Goals

PACE‑ERP UI must feel:

Professional
Industrial
Minimal
Fast
Operationally efficient

Avoid:

- visual clutter
- unnecessary animations
- marketing style interfaces

---

# 20. Implementation Order

Initial UI implementation order:

1. Landing Page
2. Login Page
3. Public Layout
4. Router
5. Session Bootstrap
6. Context Loader
7. Menu Snapshot Loader

These steps allow the ERP UI to boot correctly.

---

# 21. Final Statement

This document is the **official UI Single Source of Truth for PACE‑ERP**.

All UI development must follow this architecture to maintain consistency, maintainability, and enterprise‑grade quality.

