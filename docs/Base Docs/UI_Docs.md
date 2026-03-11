# PACE-ERP UI Architecture Design (Full-Proof)

## 1. Purpose

This document defines the **complete UI architecture blueprint** for PACE-ERP.

Goals:

* Ensure UI strictly follows backend authority model
* Align UI with **Gate-7 Menu Snapshot**
* Align navigation with **Gate-8 Screen Stack**
* Maintain **zero authority frontend**
* Allow ERP to scale across modules

The UI must never bypass backend logic.

---

# 2. UI Architecture Principles

## Principle-1: Backend Authority

Frontend never decides:

* permissions
* roles
* module access
* data visibility

All authority originates from backend APIs.

Frontend only renders.

---

## Principle-2: Menu Snapshot Driven UI

Sidebar menu is generated from:

```
GET /api/me/menu
```

Menu snapshot determines:

* visible modules
* allowed routes
* hierarchy

If a route is not in the snapshot → UI must block it.

---

## Principle-3: Screen Stack Navigation

Navigation follows **Screen Stack Engine**.

Concept:

```
Dashboard
  ↓ push
Module List
  ↓ push
Record Form
  ↓ pop
Module List
```

Browser back button must follow stack validation.

---

## Principle-4: Context Driven UI

Every request must run inside context:

```
Company
Project
Department
```

UI must load context immediately after login.

---

## Principle-5: Admin Universe Separation

Two UI universes exist:

### Admin Universe

Routes:

```
/sa/*
/ga/*
```

Capabilities:

* configure ERP
* manage ACL
* manage users
* manage companies
* manage modules

---

### ACL User Universe

Routes:

```
/home
/modules/*
```

Capabilities:

* operate ERP modules
* submit transactions
* approve workflows

---

# 3. ERP User Lifecycle

## Step-1 Identity Creation

User creates identity through Access Request page.

Flow:

```
Access Request Page
↓
Supabase Auth user created
↓
ERP user row created
status = PENDING
```

---

## Step-2 Admin Approval

Super Admin reviews pending requests.

Admin actions:

* approve request
* reject request

On approval:

```
ERP user_code generated
status = ACTIVE
```

---

## Step-3 System Setup (Admin)

Super Admin configures system:

```
Companies
Groups
Projects
Departments
```

Then binds structure.

Example:

```
Company → ALMEGA_CO
Project → Paint Plant
Department → Production
```

---

## Step-4 User Assignment

Admin assigns:

```
Company
Project
Department
Role
```

Example:

```
User → P0005
Role → L2_MANAGER
Project → Plant-1
```

---

## Step-5 Permission Governance

Admin configures authorization.

Controls:

```
Role VWED matrix
Capability packs
User overrides
Module enablement
Approver chains
```

---

## Step-6 Menu Snapshot Generation

Backend generates:

```
ACL snapshot
↓
Menu snapshot
↓
/api/me/menu
```

UI uses snapshot to build sidebar.

---

## Step-7 User Login

User logs in.

System executes:

```
session resolver
context resolver
ACL resolver
menu snapshot
```

User enters dashboard.

---

# 4. UI Layout System

The ERP UI has three layouts.

## Public Layout

Used before login.

Pages:

```
Landing
Login
Access Request
```

---

## Admin Layout

Used by SA and GA.

Structure:

```
Sidebar
Header
Content Area
```

Admin pages appear here.

---

## User Layout

Used by operational users.

Structure:

```
Sidebar
Header
Workspace
```

Modules appear here.

---

# 5. UI Components

Reusable UI components:

```
Sidebar
Header
Table
Form
Modal
Context Switcher
Breadcrumb
Action Toolbar
```

These ensure UI consistency.

---

# 6. Generic Module System

Modules should not require new UI architecture.

Use generic components:

### Generic List Screen

Displays records.

Features:

```
filters
pagination
export
actions
```

---

### Generic Form Screen

Used for create/edit operations.

Features:

```
validation
dynamic fields
ACL action binding
```

---

# 7. Security Rules

Frontend must enforce:

### Route Guard

Block routes not in menu snapshot.

---

### Intent Guard

Keyboard shortcuts must map to declared actions.

---

### Context Guard

Context must exist before module access.

---

# 8. Admin Tools

Admin universe includes:

```
User management
Company management
Project management
Department management
Role matrix
Capability packs
Module enablement
Approver mapping
Menu administration
Audit logs
Session viewer
Diagnostics
```

---

# 9. Observability Tools

Admin diagnostic pages include:

```
session viewer
audit logs
system diagnostics
```

These assist debugging.

---

# 10. UI Folder Structure

```
src
 ├ app
 ├ core
 ├ layouts
 ├ pages
 │  ├ public
 │  ├ admin
 │  └ user
 ├ components
 └ utils
```

This architecture ensures maintainability.

---

# 11. Final UI Flow

```
Landing
↓
Access Request
↓
Admin Approval
↓
User Login
↓
Menu Snapshot
↓
Dashboard
↓
Modules
```

This defines the full ERP UI lifecycle.

---

# End of Document


src
│
├── app
│   ├── App.tsx
│   ├── router.tsx
│   └── providers.tsx
│
├── core
│   ├── api
│   │   ├── client.ts
│   │   └── endpoints.ts
│   │
│   ├── session
│   │   ├── sessionBootstrap.ts
│   │   └── sessionStore.ts
│   │
│   ├── menu
│   │   ├── menuLoader.ts
│   │   └── menuStore.ts
│   │
│   ├── context
│   │   ├── contextLoader.ts
│   │   └── contextStore.ts
│   │
│   └── screenstack
│       ├── screenRegistry.ts
│       ├── stackEngine.ts
│       └── navigationHooks.ts
│
├── layouts
│   ├── PublicLayout.tsx
│   ├── AdminLayout.tsx
│   └── UserLayout.tsx
│
├── pages
│
│   ├── public
│   │   ├── LandingPage.tsx
│   │   ├── LoginPage.tsx
│   │   ├── AccessRequestPage.tsx
│   │   └── RequestSubmittedPage.tsx
│
│   ├── admin
│   │   ├── dashboard
│   │   │   └── SADashboard.tsx
│   │   │
│   │   ├── users
│   │   │   ├── PendingRequests.tsx
│   │   │   ├── UserList.tsx
│   │   │   └── UserDetail.tsx
│   │   │
│   │   ├── company
│   │   │   ├── CompanyList.tsx
│   │   │   ├── CompanyCreate.tsx
│   │   │   └── CompanyEdit.tsx
│   │   │
│   │   ├── project
│   │   │   ├── ProjectList.tsx
│   │   │   └── ProjectCreate.tsx
│   │   │
│   │   ├── department
│   │   │   ├── DepartmentList.tsx
│   │   │   └── DepartmentCreate.tsx
│   │   │
│   │   ├── acl
│   │   │   ├── RoleMatrix.tsx
│   │   │   ├── CapabilityPacks.tsx
│   │   │   └── UserOverrides.tsx
│   │   │
│   │   ├── menu
│   │   │   └── MenuAdminPanel.tsx
│   │   │
│   │   └── diagnostics
│   │       ├── AuditLogs.tsx
│   │       ├── SessionViewer.tsx
│   │       └── DiagnosticsPanel.tsx
│
│   └── user
│       ├── dashboard
│       │   └── UserDashboard.tsx
│       │
│       ├── context
│       │   ├── ProjectSelector.tsx
│       │   └── DepartmentSelector.tsx
│       │
│       └── modules
│           ├── GenericList.tsx
│           └── GenericForm.tsx
│
├── components
│   ├── sidebar
│   ├── tables
│   ├── forms
│   └── modals
│
└── utils
    ├── routeGuard.ts
    └── permissions.ts

Step,Layer,Screen_ID,Screen_Name,Purpose,Route,Depends_On,Notes
1,Public,UI-1,Landing Page,System public entry with login + request access links,/,None,Minimal marketing/entry page
2,Public,UI-2,Login Page,User login screen calling /api/login,/login,Gate-2 Auth,Primary ERP entry
3,Public,UI-3,Access Request Page,User submits ERP access request,/request-access,Gate-4.1 Signup Request,Creates ERP user PENDING
4,Public,UI-4,Access Request Submitted Page,Confirmation page after request,/request-submitted,Gate-4,User waits for SA approval

5,Foundation,UI-5,Session Bootstrap,Call /api/me to detect login state,Global,Gate-2 Auth,Auto redirect logic
6,Foundation,UI-6,Menu Snapshot Loader,Load menu via /api/me/menu,Global,Gate-7 Menu Snapshot,Build sidebar
7,Foundation,UI-7,Route Guard,Block routes not present in snapshot,Global,Gate-7.6 Route Guard,Security
8,Foundation,UI-8,Screen Registry,Register all screen metadata,Global,Gate-8 Navigation,Required for Screen Stack
9,Foundation,UI-9,Screen Stack Router,Bind router to Screen Stack navigation,Global,Gate-8 Navigation,SAP style navigation
10,Foundation,UI-10,Context Loader,Resolve company/project/department context,Global,Gate-5 Context,Initialize user context

11,Admin,UI-11,SA Dashboard,Super Admin landing dashboard,/sa/home,Gate-9.1,Admin universe entry
12,Admin,UI-12,Pending Access Requests,Approve reject ERP access requests,/sa/users/pending,Gate-4.2,User onboarding
13,Admin,UI-13,ERP User List,View ERP users,/sa/users,Gate-9.6,User governance
14,Admin,UI-14,User Detail Page,Edit user assignments,/sa/users/:id,Gate-9.6,User management
15,Admin,UI-15,Role Assignment Panel,Assign role to user,/sa/users/:id/roles,Gate-9.6A,ACL ladder

16,Admin,UI-16,Company List,View companies,/sa/companies,Gate-9.2,Organization master
17,Admin,UI-17,Company Create Page,Create company,/sa/companies/new,Gate-9.2,Master data
18,Admin,UI-18,Company Edit Page,Edit company,/sa/companies/:id,Gate-9.2,Master data

19,Admin,UI-19,Group List,View groups,/sa/groups,Gate-9.3,Group governance
20,Admin,UI-20,Group Create Page,Create group,/sa/groups/new,Gate-9.3,Group structure
21,Admin,UI-21,Company Group Mapping,Map companies to groups,/sa/groups/map,Gate-9.3A,Org hierarchy

22,Admin,UI-22,Project List,View projects,/sa/projects,Gate-9.4,Operational scope
23,Admin,UI-23,Project Create Page,Create project,/sa/projects/new,Gate-9.4,Operational scope
24,Admin,UI-24,Project Edit Page,Edit project,/sa/projects/:id,Gate-9.4,Operational scope

25,Admin,UI-25,Department List,View departments,/sa/departments,Gate-9.5,HR structure
26,Admin,UI-26,Department Create Page,Create department,/sa/departments/new,Gate-9.5,HR master

27,Admin,UI-27,Role Permission Matrix,Edit VWED permissions,/sa/roles,Gate-9.7,ACL governance
28,Admin,UI-28,Capability Pack Manager,Manage capability packs,/sa/capabilities,Gate-9.7A,Permission grouping
29,Admin,UI-29,User Override Panel,Grant per-user overrides,/sa/overrides,Gate-9.8,Exception control

30,Admin,UI-30,Company Module Map,Enable modules per company,/sa/modules,Gate-9.9,Module enablement
31,Admin,UI-31,Approver Map Editor,Configure approver chains,/sa/approvers,Gate-9.10,Workflow governance
32,Admin,UI-32,ACL Version Viewer,View rollback ACL versions,/sa/acl/versions,Gate-9.11,Change safety

33,Admin,UI-33,Menu Admin Panel,Edit menu master and tree,/sa/menu,Gate-9.12,Menu governance
34,Admin,UI-34,Preview As User,Simulate system as ACL user,/sa/preview,Gate-9.13,Permission debugging

35,Admin,UI-35,Admin Audit Logs,View admin actions,/sa/audit,Gate-9.14,Accountability
36,Admin,UI-36,Session Viewer,View revoke active sessions,/sa/sessions,Gate-9.15,Security control
37,Admin,UI-37,Diagnostics Panel,System health diagnostics,/sa/diagnostics,Gate-9.16,Observability

38,User,UI-38,User Dashboard,Normal ERP user home,/home,Gate-7 Menu Snapshot,Operational entry
39,User,UI-39,Project Context Selector,Switch project context,/context/project,Gate-5 Context,Operational scope
40,User,UI-40,Department Context Selector,Switch department context,/context/department,Gate-5 Context,HR context

41,User,UI-41,Generic Module List,Reusable module list screen,dynamic,Gate-6 ACL,Module UI framework
42,User,UI-42,Generic Module Form,Reusable create/edit form,dynamic,Gate-6 ACL,Module UI framework