# PACE ERP SA Full Setup Manual

This manual is the operator guide for Super Admin setup in the current PACE ERP model.

It is written for the current final decisions:

- Separate lane model is active
- `GENERAL_OPS` is the self-service lane
- `HR_APPROVER` is the approval lane
- `HR_AUDIT` is the report/audit lane
- `HR_DIRECTOR` is the director review lane
- Business department or split lanes are separate from HR responsibility lanes
- Approval Rules decide who approves
- Report Visibility decides who sees reports
- ACL Version Center decides when access changes must be published

## 1. Final Mental Model

Use this exact mental model in all setup decisions:

1. `Role`
- authority ladder
- examples: `L4_USER`, `L2_MANAGER`, `DIRECTOR`

2. `Capability Pack`
- reusable access bundle
- examples: `CAP_HR_SELF_SERVICE`, `CAP_HR_APPROVER`

3. `User Scope`
- where the user can work
- company, work context, department

4. `Approval Rule`
- who approves which request

5. `Report Visibility`
- who can see which register/report

6. `ACL Version Center`
- publishes access-governance changes to runtime users

## 2. Golden Rules

1. `Role` does not by itself make someone an approver.
2. `Approver access` does not by itself decide scope.
3. `Approval Rule` decides exact approval scope.
4. `Report Visibility` is separate from approval.
5. `GENERAL_OPS` is for self-service only.
6. `HR_APPROVER` is for approval work only.
7. `HR_AUDIT` is for report/audit work only.
8. `HR_DIRECTOR` is for director review only.
9. Department or split lanes should stay clean for future business modules.
10. After access-related changes, check `ACL Version Center`.

## 2A. Identity Department vs Operational Work Area

This distinction is now intentional and important:

- `Department` = identity / home department
- `Work Context` = operational work area

One user can now have:

- one identity department
- multiple operational work areas
- multiple work companies

Example:

- identity department: `QA`
- operational work areas:
  - `GENERAL_OPS`
  - `PROD_LIQUID`
  - `STORES_POWDER`
  - `HR_APPROVER`

So the department stays as HR identity truth, but day-to-day operational work can span multiple lanes.

## 3. Page Order

Use this order every time:

1. `SA Home / Signup Requests`
2. `SA Users / User Roles`
3. `SA Users / User Scope`
4. `SA Home / Work Context Master`
5. `SA Home / Capability Governance`
6. `SA Home / Role Permissions`
7. `SA Home / Approval Policy`
8. `SA Home / Approval Rules`
9. `SA Home / Report Visibility`
10. `SA Home / ACL Version Center`

## 4. After User Signup Request

Go to:

`SA Home / Signup Requests`

Do:

1. Open the signup request
2. Verify identity and target company
3. Approve the signup request
4. Confirm the user record is created

Result:

- user is now available in `SA Users`
- now role, scope, and business responsibilities can be assigned

## 5. Set User Role

Go to:

`SA Users / User Roles`

Choose the user and assign the base role.

Examples:

- normal worker: `L1_USER` / `L2_USER` / `L3_USER` / `L4_USER`
- manager: `L1_MANAGER` / `L2_MANAGER` / `L3_MANAGER` / `L4_MANAGER`
- director: `DIRECTOR`
- auditor: `L1_AUDITOR` / `L2_AUDITOR`

Use role for authority class only.

Do not use role alone to decide:

- approval scope
- report visibility
- work lane

## 6. Work Context Master Meaning

Go to:

`SA Home / Work Context Master`

### What this page means

`Work Context = runtime lane`

It answers this question:

`When the user is working, which desk or mode are they currently in?`

### System rows

Keep:

- all `DEPT_*` rows
- `GENERAL_OPS`

These are system foundations.

### Manual rows

Keep:

- `HR_APPROVER`
- `HR_AUDIT`
- `HR_DIRECTOR`

Keep manual split lanes only if they are real business lanes:

- `PROD_LIQUID`
- `PROD_POWDER`
- `QUALITY_LIQUID`
- `QUALITY_POWDER`
- `STORES_LIQUID`
- `STORES_POWDER`

### Department Link Rule

Use:

- `No department link` for `GENERAL_OPS`, `HR_APPROVER`, `HR_AUDIT`, `HR_DIRECTOR`
- department link for split operational lanes like `PROD_LIQUID`

## 7. Capability Packs

The four HR packs are:

1. `CAP_HR_SELF_SERVICE`
2. `CAP_HR_APPROVER`
3. `CAP_HR_AUDIT_VIEW`
4. `CAP_HR_DIRECTOR`

### `CAP_HR_SELF_SERVICE`

Tick:

- `HR_LEAVE_APPLY` -> `VIEW`, `WRITE`
- `HR_LEAVE_MY_REQUESTS` -> `VIEW`, `EDIT`
- `HR_OUT_WORK_APPLY` -> `VIEW`, `WRITE`
- `HR_OUT_WORK_MY_REQUESTS` -> `VIEW`, `EDIT`

Do not tick:

- approval inbox
- approval scope history
- register/report resources

### `CAP_HR_APPROVER`

Tick:

- `HR_LEAVE_APPROVAL_INBOX` -> `VIEW`, `APPROVE`
- `HR_LEAVE_APPROVAL_SCOPE_HISTORY` -> `VIEW`
- `HR_OUT_WORK_APPROVAL_INBOX` -> `VIEW`, `APPROVE`
- `HR_OUT_WORK_APPROVAL_SCOPE_HISTORY` -> `VIEW`

Do not tick:

- self-service pages
- register/report pages

### `CAP_HR_AUDIT_VIEW`

Tick:

- `HR_LEAVE_REGISTER` -> `VIEW`, `EXPORT`
- `HR_OUT_WORK_REGISTER` -> `VIEW`, `EXPORT`

Optional:

- approval scope history `VIEW` if audit needs history pages

Do not tick:

- approval inbox
- self-service pages

### `CAP_HR_DIRECTOR`

Tick:

- `HR_LEAVE_APPROVAL_INBOX` -> `VIEW`, `APPROVE`
- `HR_LEAVE_APPROVAL_SCOPE_HISTORY` -> `VIEW`
- `HR_LEAVE_REGISTER` -> `VIEW`, `EXPORT`
- `HR_OUT_WORK_APPROVAL_INBOX` -> `VIEW`, `APPROVE`
- `HR_OUT_WORK_APPROVAL_SCOPE_HISTORY` -> `VIEW`
- `HR_OUT_WORK_REGISTER` -> `VIEW`, `EXPORT`

## 8. Work Context To Pack Attachment

Go to:

`SA Home / Capability Governance`

Use this exact mapping:

| Work Context | Attach Pack |
|---|---|
| `GENERAL_OPS` | `CAP_HR_SELF_SERVICE` |
| `HR_APPROVER` | `CAP_HR_APPROVER` |
| `HR_AUDIT` | `CAP_HR_AUDIT_VIEW` |
| `HR_DIRECTOR` | `CAP_HR_DIRECTOR` |
| `DEPT_*` rows | no HR pack now |
| split business lanes like `PROD_LIQUID`, `PROD_POWDER` | no HR pack now |

Why:

- `GENERAL_OPS` = self-service desk
- `HR_APPROVER` = approval desk
- `HR_AUDIT` = audit/report desk
- `HR_DIRECTOR` = director oversight desk
- department lanes stay clean for future business modules

## 9. User Scope

Go to:

`SA Users / User Scope`

For every user, set:

1. `Parent Company`
2. `Work Company Scope`
3. `Runtime Functional Context`
4. `Department Mapping`

### Rule

- `Parent Company` = HR identity base
- `Work Company Scope` = which companies the user can work in
- `Runtime Functional Context` = which operational lanes the user can enter
- `Department Mapping` = official department identity

Important:

- department no longer auto-adds a matching work context
- department no longer removes cross-department operational work areas
- work contexts now save exactly as checked, as long as they belong to the selected work companies

### Typical setup

#### Normal employee

- `GENERAL_OPS`
- one or more real operational lanes as needed

#### HR approver

- `GENERAL_OPS`
- one or more operational lanes as needed
- `HR_APPROVER`

#### HR audit viewer

- `GENERAL_OPS`
- one or more operational lanes as needed
- `HR_AUDIT`

#### Director

- `GENERAL_OPS`
- one or more operational lanes if needed
- `HR_DIRECTOR`
- `HR_APPROVER` only if director must also approve

## 10. Role Permissions

Go to:

`SA Home / Role Permissions`

This page is for broad baseline only.

Use it conservatively.

### Recommended rule

Do not broadly give these role-wide unless every person in that role truly needs them:

- `HR_LEAVE_APPROVAL_INBOX`
- `HR_OUT_WORK_APPROVAL_INBOX`
- `HR_LEAVE_REGISTER`
- `HR_OUT_WORK_REGISTER`

If you use role-wide HR baseline at all, keep it limited to common self-service:

- `HR_LEAVE_APPLY` -> `VIEW`, `WRITE`
- `HR_LEAVE_MY_REQUESTS` -> `VIEW`, `EDIT`
- `HR_OUT_WORK_APPLY` -> `VIEW`, `WRITE`
- `HR_OUT_WORK_MY_REQUESTS` -> `VIEW`, `EDIT`

Approval and report powers should mainly come from:

- packs
- approval rules
- report visibility rules

## 11. Approval Policy

Go to:

`SA Home / Approval Policy`

Set workflow law here.

### For leave

Use:

- resource: `HR_LEAVE_APPLY`
- action: `WRITE`
- approval required: `YES`
- min approvers: `1`
- max approvers: `3`

### For out work

Use:

- resource: `HR_OUT_WORK_APPLY`
- action: `WRITE`
- approval required: `YES`
- min approvers: `1`
- max approvers: `3`

### For inbox/history/register

Usually:

- approval required: `NO`

Because:

- apply page triggers workflow
- inbox page is where approver acts
- history and register are not request-submission actions

### Approval Type Meaning

- `ANYONE` = any one eligible approver can approve
- `SEQUENTIAL` = stages move in order
- `MUST_ALL` = all required approvers must approve

## 12. Approval Rules

Go to:

`SA Home / Approval Rules`

Here you decide who approves.

### Scope Type Meaning

- `Company-wide`
  - everyone in the company
- `Department`
  - one full department
- `Work Context`
  - one exact lane or split lane
- `User Exception`
  - one exact requester
- `Director Broad`
  - use only when business wants director-wide broad scope

### Target Mode Meaning

- `Specific User`
  - use when one exact person approves
- `Role`
  - use when the whole role is the approver target

### Recommended rule

- use `Department` when the scope is one full department like `Supply Chain`
- use `Work Context` when the scope is one split lane like `PROD_LIQUID` or `PROD_POWDER`
- use `Company-wide` for Plant Head style scope
- use `User Exception` for one-off requester routing

## 13. Report Visibility

Go to:

`SA Home / Report Visibility`

This page decides who can see reports and registers.

### Rule

Report visibility is separate from approval.

Do not assume:

- approver = report viewer
- report viewer = approver

### Typical actions

- `VIEW`
- `EXPORT`

### Typical scopes

- `Company-wide`
- `Department`
- `Work Context`
- `User Exception`
- `Director Broad`

## 14. ACL Version Center

Go to:

`SA Home / ACL Version Center`

This is the publish desk.

### What it does

System checks tracked access-governance changes and tells SA whether a new ACL version is required.

SA does not need to remember this manually.

### New version is required when access-related setup changes

Examples:

- capability matrix changed
- work context to pack binding changed
- role permissions changed
- role capability changed
- company module access changed
- user role or user scope changes that affect runtime access snapshot

### New version is not required when only these change

- approval rules
- report visibility rules

### How to use

1. Open the page
2. Search or filter the company if needed
3. Select the company
4. Read the recommendation
5. If publish is required, fill or accept the version description
6. Click `Capture And Activate Now`
7. If needed, activate an older inactive version from the ledger

## 15. Example Users

### Prasenjit

Business meaning:

- normal user
- self-service only

Setup:

- role: `L4_USER`
- user scope:
  - `GENERAL_OPS`
  - own department or split lane
- packs:
  - from `GENERAL_OPS` he gets `CAP_HR_SELF_SERVICE`
- approval rules:
  - none
- report visibility:
  - none

### Sujit

Business meaning:

- specific approver for `PROD_POWDER`

Setup:

- role: `L4_USER`
- user scope:
  - `GENERAL_OPS`
  - `PROD_POWDER`
  - `HR_APPROVER`
- approval rule:
  - company = target company
  - resource = `HR_LEAVE_APPROVAL_INBOX`
  - action = `APPROVE`
  - scope type = `Work Context`
  - requester work context = `PROD_POWDER`
  - target mode = `Specific User`
  - approver user = `Sujit`
- if out-work too:
  - same with `HR_OUT_WORK_APPROVAL_INBOX`

### Nilkamal

Business meaning:

- `L2_MANAGER`
- manager of `PROD_LIQUID`
- can submit own requests
- can approve `PROD_LIQUID`

Setup:

- role: `L2_MANAGER`
- user scope:
  - `GENERAL_OPS`
  - `PROD_LIQUID`
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Work Context = PROD_LIQUID`
  - out-work inbox -> `Work Context = PROD_LIQUID`

### Ankan

Business meaning:

- Supply Chain identity
- works in Supply Chain and Production operational areas
- HR approver for Supply Chain

Setup:

- role: `L4_USER` or business-approved manager role
- department identity: `Supply Chain`
- user scope:
  - `GENERAL_OPS`
  - `DEPT_SUPPLY_CHAIN`
  - `PROD_LIQUID` or `PROD_POWDER` as needed
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Department = Supply Chain`
  - out-work inbox -> `Department = Supply Chain`

### Pradip

Business meaning:

- `L3_MANAGER`
- Plant Head
- company-wide approver

Setup:

- role: `L3_MANAGER`
- user scope:
  - `GENERAL_OPS`
  - own operational lane if needed
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Company-wide`
  - out-work inbox -> `Company-wide`
  - target mode = `Specific User`
  - approver user = `Pradip`

### Bijon

Business meaning:

- `DIRECTOR`
- but only Supply Chain approver now
- later may approve other scopes in other companies

Setup now:

- role: `DIRECTOR`
- user scope:
  - `GENERAL_OPS`
  - `HR_APPROVER`
  - own operational lane if needed
- approval rules:
  - leave inbox -> `Department = Supply Chain`
  - out-work inbox -> `Department = Supply Chain`
  - target mode = `Specific User`
  - approver user = `Bijon`

Important:

- do not use `Director Broad` unless Bijon really needs broad director scope

## 16. How To Decide Approval Scope

Use this rule:

- all users of one department -> `Department`
- one split lane -> `Work Context`
- all users in company -> `Company-wide`
- one exact requester -> `User Exception`
- director-wide leadership scope -> `Director Broad`

## 17. Common Mistakes To Avoid

1. Giving approval inbox broadly in `Role Permissions`
2. Putting `CAP_HR_APPROVER` on `GENERAL_OPS`
3. Putting `CAP_HR_SELF_SERVICE` on `HR_APPROVER`
4. Assuming approval rule also gives report visibility
5. Forgetting `ACL Version Center` after access-related changes
6. Using `Director Broad` when simple department or work-context scope is enough

## 18. ACL User Runtime UX

Current ACL user UI now follows this model:

- sidebar still carries company and work-area switching where runtime scope has multiple choices
- ACL home page is now a clean `Work Start` desk, not a card-heavy dashboard
- ACL home page shows:
  - current company
  - current work area
  - immediate tasks
  - all routeable workspaces from the current ACL snapshot
- work does not begin from random cards; it begins from exact tasks

Important:

- `Company` in the shell decides which company the current runtime session is operating inside
- `Work Area` in the shell decides which operational work area is active for ACL/menu projection
- if later a task page adds its own company selector, that task page must still validate against the user's allowed company scope

## 19. Final Operating Rule

For any user, explain setup in this format:

- role
- work companies
- runtime lanes
- packs received from those lanes
- approval rules
- report visibility rules

If that explanation is clean, the setup is clean.

## 20. SA User Scope Report

Use this report when SA needs one flat exportable inventory of users, their roles, ranks, companies, identity department, projects, and work areas.

Path:

- `SA Users -> Scope Report`
- or `SA Home -> User Scope Report`

What it shows:

- one row per assignment
- separate columns, not mixed text blobs
- user code
- user name
- auth user id
- current user state
- role code
- role rank
- designation
- phone number
- parent company code and name
- identity department code and name
- assignment type
- assignment company code and name
- project code and name
- work area code and name
- work area department code and name
- primary work area yes/no
- created at

How to use:

1. Open `SA Users -> Scope Report`
2. Choose one company, or keep `All companies`
3. Use page search if needed
4. Click `Download Excel CSV`

When to use:

- before rollout, to circulate final access inventory
- after access cleanup, to share one audited list
- when management asks who has what role, company, or scope

Important:

- this report is for SA only
- it is flat by design so Excel sorting, filtering, and circulation stay easy

## 21. Leave Register Report Flow

The leave register now works in two steps:

1. criteria page
2. separate results page

Path:

- `HR Management -> Leave Register`

### 21.1 Criteria Page

The criteria page is where the user prepares the report.

Fields:

- `From Date`
- `To Date`
- `Company`

Rules:

- both dates are required
- date range cannot be more than one year
- company must be chosen
- `* | All Companies In Scope` means all companies the current user is allowed to see
- if the user does not have scope to a company, that company will not appear in the dropdown

Dropdown behavior:

- each company option shows `company code | company name`
- `*` means all companies inside current user scope

What happens on `Run Report`:

- system validates date range
- system validates company selection
- system opens a separate results page
- criteria values are remembered so browser back returns to the same prepared state

### 21.2 Results Page

The results page shows the filtered register output.

Features:

- current criteria summary
- quick search inside loaded rows
- pagination
- downloadable Excel-ready CSV
- `Back To Criteria`

Important:

- browser back returns to the criteria page
- the same criteria stays filled
- export downloads the currently filtered rows

Columns include:

- requester
- requester user id
- company code and name
- work area code and name
- from date
- to date
- total days
- reason
- status
- approval type
- workflow id
- created at

Scope behavior:

- users only see rows within their allowed scope
- `*` does not mean all companies in the ERP
- `*` means all companies inside that user's permitted scope

## 22. Out Work Register Report Flow

The out-work register follows the same two-step model.

Path:

- `HR Management -> Out Work Register`

### 22.1 Criteria Page

Fields:

- `From Date`
- `To Date`
- `Company`

Rules:

- same one-year maximum
- same company dropdown format
- same `* | All Companies In Scope` behavior

### 22.2 Results Page

Features:

- separate result page
- quick search
- pagination
- download filtered report as Excel-ready CSV
- browser back returns to the original criteria page

Columns include:

- requester
- requester user id
- company code and name
- work area code and name
- destination name
- destination address
- from date
- to date
- total days
- reason
- status
- approval type
- workflow id
- created at

## 23. Report Visibility vs Report Export

Remember this distinction:

- `Report Visibility` decides who may open the register/report page
- the page itself now supports export
- export never gives extra data beyond the current user's scope

So:

- visibility gives page access
- scope decides rows
- export downloads the visible filtered result

## 24. User Dashboard Identity Strip

ACL user home now shows:

- `Name`
- `User ID`
- `Role Code`
- current company
- current work area

Why:

- operators should immediately know which identity the runtime is using
- this reduces confusion when company and work area change

## 25. End-To-End SA Setup From Signup To Go-Live

This is the recommended full sequence.

### Step 1. Approve signup request

Path:

- `SA Home -> Signup Requests`

Do:

- review signup details
- approve or reject

After approval:

- user becomes available for role and scope setup

### Step 2. Assign role

Path:

- `SA Users -> User Roles`

Do:

- choose user
- assign one canonical role

Examples:

- `Prasenjit` -> `L4_USER`
- `Sujit` -> `L4_USER`
- `Nilkamal` -> `L2_MANAGER`
- `Pradip` -> `L3_MANAGER`
- `Bijon` -> `DIRECTOR`

### Step 3. Assign user scope

Path:

- `SA Users -> User Scope`

Do:

- choose parent company
- choose work companies
- choose project mapping
- choose identity department
- choose runtime work areas

Rules:

- `Department` is identity
- `Work Areas` are operational lanes
- user can have multiple work companies
- user can have multiple work areas
- work areas may cross departments if business needs it

### Step 4. Configure capability packs

Path:

- `SA Home -> Capability Governance`

Attach packs only where they belong:

- `GENERAL_OPS -> CAP_HR_SELF_SERVICE`
- `HR_APPROVER -> CAP_HR_APPROVER`
- `HR_AUDIT -> CAP_HR_AUDIT_VIEW`
- `HR_DIRECTOR -> CAP_HR_DIRECTOR`

Do not attach HR packs to department lanes in the separate-lane model.

### Step 5. Keep role permissions minimal

Path:

- `SA Home -> Role Permissions`

Purpose:

- broad baseline only

Do not use this page to make one specific person an approver.

### Step 6. Set approval policy

Path:

- `SA Home -> Approval Policy`

Typical HR setup:

- `HR_LEAVE_APPLY / WRITE` -> approval required `YES`
- `HR_OUT_WORK_APPLY / WRITE` -> approval required `YES`
- min approvers `1`
- max approvers `3`

Inbox/history/register resources do not themselves require approval policy.

### Step 7. Create approval rules

Path:

- `SA Home -> Approval Rules`

Choose scope based on business meaning:

- `Company-wide` -> whole company approver
- `Department` -> department-level approver
- `Work Context` -> one split lane or work area
- `User Exception` -> exact requester exception
- `Director Broad` -> director-wide scope

Use `Specific User` when one exact person should approve.
Use `Role` only when all users of that role are intended approvers for that scope.

### Step 8. Create report visibility rules

Path:

- `SA Home -> Report Visibility`

Use when a user should see a register/report page.

Remember:

- approver rule does not automatically give report visibility
- report visibility does not automatically make a user an approver

### Step 9. Publish ACL changes

Path:

- `SA Home -> ACL Version Center`

Use this after access-governance changes such as:

- capability matrix change
- role permission change
- work-area-to-pack attachment change
- company module access change
- user role change
- user scope change

The system recommends when publish is needed.

### Step 10. Verify using reports

Use:

- `SA Users -> Scope Report`
- leave register
- out-work register

This lets SA verify:

- user scope
- company coverage
- work areas
- final report visibility

## 26. Example Setups

### 26.1 Prasenjit

Business meaning:

- identity department `QA`
- works in QA, Production, and Stores areas
- not an HR approver

Setup:

- role: `L4_USER`
- parent company: his home company
- work companies: needed companies
- identity department: `QA`
- work areas:
  - `GENERAL_OPS`
  - `DEPT_DPT004 / QUALITY`
  - `PROD_POWDER` or `PROD_LIQUID` if needed
  - `STORES_POWDER` or `STORES_LIQUID` if needed
- packs received:
  - from `GENERAL_OPS` -> `CAP_HR_SELF_SERVICE`
- approval rules:
  - none
- report visibility:
  - add only if management wants him to see report pages

### 26.2 Sujit

Business meaning:

- identity department `Production`
- works in `Production Powder`
- HR approver for `Production Powder`

Setup:

- role: `L4_USER`
- work areas:
  - `GENERAL_OPS`
  - `PROD_POWDER`
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Work Context = PROD_POWDER`
  - out-work inbox -> `Work Context = PROD_POWDER`
- report visibility:
  - only if he should see related registers

### 26.3 Nilkamal

Business meaning:

- `L2_MANAGER`
- identity department `Production`
- works in `Production Liquid`
- approver for `Production Liquid`

Setup:

- role: `L2_MANAGER`
- work areas:
  - `GENERAL_OPS`
  - `PROD_LIQUID`
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Work Context = PROD_LIQUID`
  - out-work inbox -> `Work Context = PROD_LIQUID`

### 26.4 Ankan

Business meaning:

- identity department `Supply Chain`
- works across Supply Chain and Production areas
- HR approver for Supply Chain

Setup:

- role: `L4_USER` or manager role as approved
- work areas:
  - `GENERAL_OPS`
  - `DEPT_DPT009 / SUPPLY_CHAIN`
  - `PROD_LIQUID` or `PROD_POWDER` if business needs it
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Department = Supply Chain`
  - out-work inbox -> `Department = Supply Chain`
- report visibility:
  - add Production reports if needed via visibility rules

### 26.5 Pradip

Business meaning:

- `L3_MANAGER`
- Plant Head
- company-wide approver

Setup:

- role: `L3_MANAGER`
- work areas:
  - `GENERAL_OPS`
  - `DEPT_DPT010 / PLANT_MANAGEMENT` if needed
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Company-wide`
  - out-work inbox -> `Company-wide`
  - target mode -> `Specific User`
  - approver user -> `Pradip`

### 26.6 Bijon

Business meaning:

- `DIRECTOR`
- currently only Supply Chain approver
- later may get other company or scope approvals

Setup now:

- role: `DIRECTOR`
- work areas:
  - `GENERAL_OPS`
  - `HR_APPROVER`
- approval rules:
  - leave inbox -> `Department = Supply Chain`
  - out-work inbox -> `Department = Supply Chain`
  - target mode -> `Specific User`
  - approver user -> `Bijon`

Do not use `Director Broad` unless he truly needs broad director-wide scope.
