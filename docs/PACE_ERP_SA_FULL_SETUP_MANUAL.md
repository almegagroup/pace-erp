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
- `Runtime Functional Context` = which lanes the user can enter
- `Department Mapping` = official department identity

### Typical setup

#### Normal employee

- `GENERAL_OPS`
- own department lane

#### HR approver

- `GENERAL_OPS`
- own department lane
- `HR_APPROVER`

#### HR audit viewer

- `GENERAL_OPS`
- own department lane
- `HR_AUDIT`

#### Director

- `GENERAL_OPS`
- own department or business lane if needed
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

- Supply Chain person
- HR approver for Supply Chain

Setup:

- role: `L4_USER` or business-approved manager role
- user scope:
  - `GENERAL_OPS`
  - `DEPT_SUPPLY_CHAIN`
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

## 18. Final Operating Rule

For any user, explain setup in this format:

- role
- work companies
- runtime lanes
- packs received from those lanes
- approval rules
- report visibility rules

If that explanation is clean, the setup is clean.
