# SA Approval Routing Setup Manual

## Purpose

এই manualটা SA operator-এর জন্য।  
এই document follow করে SA user approval থেকে শুরু করে approval policy, approval rule, report visibility, smoke test, এবং go-live readiness পর্যন্ত full setup complete করতে পারবে।

এই manualটা post-fix architecture ধরে লেখা:

- `GENERAL_OPS` personal/self-service workspace
- `DEPT_*` and functional contexts approval routing truth
- new approval-bearing requests must not route by `GENERAL_OPS`

## Scope Of This Manual

এই manual assume করে নিচের foundation already done:

- company created
- group created
- project created
- module created
- pages/resources published
- project-module-resource mapping done

এই manual starts from:

1. user approval
2. role assignment
3. department and work context readiness
4. user scope readiness
5. capability pack attachment
6. approval policy setup
7. approval rule setup
8. report visibility setup
9. smoke test
10. go-live readiness

## Core Rule Before You Start

approval setup করার সময় এই 3টা জিনিস আলাদা ভেবে কাজ করতে হবে:

1. `GENERAL_OPS`
   personal access, self-service, profile, payslip, own apply pages

2. requester business scope
   `DEPT_*` or functional context like `PROD_POWDER`, `PROD_LIQUID`

3. approver access context
   `HR_APPROVER`, `HR_AUDIT`, `HR_DIRECTOR` or other approver-facing contexts

Most common confusion:

- apply page can stay in `GENERAL_OPS`
- but approval routing must use requester business scope
- approval inbox access may sit in `HR_APPROVER`
- but approval rule requester scope should still be `DEPT_*` or functional scope

---

## Mental Map: One New Scope Touches Which Screens

If SA creates one new manual work context, that scope is not complete in one screen only.

Each new scope has up to 5 follow-up touch points:

1. `Work Context Master`
   create the scope itself

2. `Capability Governance`
   attach the correct capability packs to that scope

3. `User Scope Mapping`
   attach that scope to the users who should actually operate in it

4. `Approval Rules`
   use that scope as `Requester Subject Scope` if approvals should route differently for that scope

5. `Report Visibility`
   use that scope if report/register visibility must also be narrower or different

### Example: `PROD_POWDER`

If SA creates `PROD_POWDER`, the mental map is:

- create `PROD_POWDER` in `/sa/work-contexts`
- attach correct pack in `/sa/acl/capabilities`
- give `PROD_POWDER` to actual powder users in `/sa/users/scope`
- create approval rule for `PROD_POWDER` in `/sa/approval-rules`
- create report rule for `PROD_POWDER` in `/sa/report-visibility` only if reporting also needs a split

### Example: `HR_APPROVER`

If SA creates or uses `HR_APPROVER`, the mental map is:

- keep inbox/history screen access in `/sa/acl/capabilities`
- attach `HR_APPROVER` to approver users in `/sa/users/scope`
- do not use `HR_APPROVER` as requester routing scope in `/sa/approval-rules`

### Golden Rule

A scope can mean one of three different things:

1. requester business scope
   used for approval routing truth

2. approver working scope
   used to open approver screens

3. report viewer scope
   used to limit report access

These are related, but they are not identical.

---

## Mental Map: Which Kind Of Scope Goes Where

### `GENERAL_OPS`

Use in:

- `User Scope Mapping`
- `Capability Governance`

Typical purpose:

- self-service
- apply pages
- profile
- payslip
- personal safe workspace

Do not use in:

- `Approval Rules` requester subject scope

### `DEPT_*`

Use in:

- `User Scope Mapping`
- `Approval Rules`
- optionally `Report Visibility`

Typical purpose:

- bulk approval routing
- department-level visibility
- default business routing fallback

### Manual Business Scope Like `PROD_POWDER`

Use in:

- `Work Context Master`
- `User Scope Mapping`
- `Approval Rules`
- optionally `Report Visibility`

Typical purpose:

- rare functional split
- business execution slice inside one department

### Approver Context Like `HR_APPROVER`

Use in:

- `Work Context Master`
- `Capability Governance`
- `User Scope Mapping`

Typical purpose:

- approval inbox access
- approval history access

Do not use in:

- `Approval Rules` requester subject scope

---

## Part 1: Full Flow Overview

Follow this order only:

1. approve user
2. assign role
3. verify department foundation
4. create functional work contexts if needed
5. map user scope
6. attach capability packs
7. enable approval policy on apply pages
8. create approval rules on approval inbox resources
9. create report visibility rules
10. run smoke test
11. go live

Do not start approval rules before user scope and capability packs are ready.

---

## Part 2: Screen List

Use these routes:

- `User approval`: `/sa/signup-requests`
- `User roles`: `/sa/users/roles`
- `Department master`: `/sa/department-master`
- `Work context master`: `/sa/work-contexts`
- `User scope mapping`: `/sa/users/scope`
- `Capability governance`: `/sa/acl/capabilities`
- `Approval policy`: `/sa/approval-policy`
- `Approval rules`: `/sa/approval-rules`
- `Report visibility`: `/sa/report-visibility`

---

## Part 3: Step-By-Step Manual

## Step 1: Approve The User

### Screen

Open: `/sa/signup-requests`

### Goal

pending signup request-কে active ERP user বানানো

### What To Do

1. pending user row select করুন
2. user details check করুন
3. correct company/universe request কিনা confirm করুন
4. `Approve` action click করুন

### Expected Result

user এখন SA user list-এ visible হবে এবং role assign করার জন্য ready হবে

### Important

user approve করেই live-ready ধরা যাবে না  
approval setup-এর জন্য next steps mandatory

---

## Step 2: Assign Role

### Screen

Open: `/sa/users/roles`

### Page

`Sa User Roles / Users`

### Goal

user-এর governing role set করা

### What To Do

1. target user খুঁজুন
2. row open করুন
3. role set করুন

### Example

- employee -> `L2_USER` / `L3_USER`
- line manager -> `L1_MANAGER`
- plant head -> `L3_MANAGER`
- director -> `DIRECTOR`

### Save

role save করুন

### Expected Result

user row-এ role badge update হবে

### Important

role-based approval rules দিলে এই role-টাই use হবে  
wrong role থাকলে approval inbox matching wrong হতে পারে

---

## Step 3: Verify Department Foundation

### Screen

Open: `/sa/department-master`

### Page

`Department Master`

### Goal

real departments এবং derived `DEPT_*` system scopes ready আছে কিনা নিশ্চিত করা

### Create Department If Missing

form fields:

- `Company`
- `Department Name`

action:

- `Create Department`

### Example

- `Company` = target company
- `Department Name` = `PRODUCTION`

repeat for:

- `SUPPLY CHAIN`
- `QUALITY`
- `HR`
- `FINANCE`

### What To Verify After Save

department save হওয়ার পরে list-এ corresponding derived department scope থাকবে:

- `DEPT_DPT003 | PRODUCTION`
- `DEPT_DPT009 | SUPPLY CHAIN`
- etc.

### Important

- manually `DEPT_*` create করবেন না
- if department missing, approval routing cannot derive correct default scope

---

## Step 4: Create Functional Work Contexts If Needed

### Screen

Open: `/sa/work-contexts`

### Page

`Work Context Master`

### Goal

same department-এর ভিতরে finer business routing scope create করা

### When To Use

Use only when department-level routing enough না

Examples:

- `PROD_POWDER`
- `PROD_LIQUID`
- `QA_ADMIX`
- `SCM_IMPORT`
- `SCM_LOCAL`

### Do Not Use This Screen For

- `GENERAL_OPS`
- `DEPT_*`

These are system foundations.

### What To Click

1. `Create Manual Scope`
2. drawer opens: `Create Manual Work Scope`

### Fields To Fill

- `Work Scope Code`
- `Work Scope Name`
- `Department Link`
- `Description`
- active checkbox

### Example Entry

- `Work Scope Code` = `PROD_POWDER`
- `Work Scope Name` = `Production Powder`
- `Department Link` = `PRODUCTION`
- `Description` = `Powder line routing scope`
- active = checked

Save using:

- `Create Scope`

### Repeat Example

- `Work Scope Code` = `PROD_LIQUID`
- `Work Scope Name` = `Production Liquid`
- `Department Link` = `PRODUCTION`
- `Description` = `Liquid line routing scope`

### Expected Result

manual scope list-এ visible হবে and linked department shown হবে

### Important

functional scope only তখনই create করবেন যখন approver split or access split দরকার

---

## Step 5: Prepare User Scope

### Screen

Open: `/sa/users/scope`

### Page

`ERP User Scope Mapping`

### Goal

user কোন company-তে কাজ করবে, কোন department-এর, কোন contexts use করবে, কোন project use করবে সেটা fixed করা

### First Open The User

1. target user open করুন
2. main page-এ দেখুন:
   - role
   - parent company
   - work company count
   - work context count
   - project count
   - department mapping count

### Drawer Buttons You Will Use

- `Select Parent Company`
- `Edit Work Companies`
- `Edit Work Contexts`
- `Edit Projects`
- `Edit Departments`

---

### Step 5A: Set Parent Company

Click:

- `Select Parent Company`

Choose:

- target home company

Save.

### Rule

user belongs to one real home company

---

### Step 5B: Set Department Mapping

Click:

- `Edit Departments`

Choose:

- the user’s real home department

### Example

For Ankan:

- `SUPPLY CHAIN`

For Rahim:

- `PRODUCTION`

Save.

### Important

do not change a user’s home department just to make them approver of another department  
approver authority must be given in approval rules, not by faking department identity

---

### Step 5C: Set Work Companies

Click:

- `Edit Work Companies`

Choose:

- all companies where the user is allowed to operate

### Example

normal employee:

- only home company checked

cross-company approver:

- home company
- target company

Save.

---

### Step 5D: Set Work Contexts

Click:

- `Edit Work Contexts`

### Requester Minimum Setup

Requester user should usually have:

- `GENERAL_OPS`
- correct department scope like `DEPT_DPT003 | PRODUCTION`

If functional split applies, also attach:

- `PROD_POWDER`
- or `PROD_LIQUID`

### Approver Setup

Approver user should usually have:

- `GENERAL_OPS`
- approver-facing context like `HR_APPROVER`

Optionally, if business needs it, also attach operational department context.

### Example: Supply Chain Approver

Ankan:

- `GENERAL_OPS`
- `HR_APPROVER`

### Example: Production Requester

Rahim:

- `GENERAL_OPS`
- `DEPT_DPT003 | PRODUCTION`
- `PROD_POWDER` if powder line requester

Save.

### Important

- requester routing no longer uses `GENERAL_OPS`
- but apply page access may still be through `GENERAL_OPS`

---

### Step 5E: Set Project Access

Click:

- `Edit Projects`

Choose:

- projects the user actually needs

Example:

- `PRJ001 - HR MANAGEMENT`

Save.

---

## Step 6: Attach Capability Packs

### Screen

Open: `/sa/acl/capabilities`

### Page

`Capability Governance`

### Goal

each work context কোন screen pack / capability pack use করতে পারবে সেটা define করা

### Important Separation

This screen controls page access.  
This screen does not decide who approves whom.

### What To Check

each context row-এ `Manage Packs` click করে attached packs verify করুন

### Recommended Pack Logic

#### `GENERAL_OPS`

keep self-service access here:

- leave apply
- out work apply
- my requests
- profile
- personal HR pages

Recommended pack example:

- `CAP_HR_SELF_SERVICE`

#### `HR_APPROVER`

keep approver working pages here:

- leave approval inbox
- out work approval inbox
- approval scope history

Recommended pack example:

- `CAP_HR_APPROVER`

#### `HR_AUDIT`

keep audit/report pages here:

- register
- scope history
- review pages

#### `HR_DIRECTOR`

keep broader report and high-level review pages here

### Important

`CAP_HR_SELF_SERVICE` should remain in `GENERAL_OPS`  
That is correct.

---

## Step 6B: Freeze And Activate ACL Version

### Screen

Stay on: `/sa/acl/capabilities`

### Section

`ACL Versions`

### Card Title

`Immutable company ledger`

### Why This Step Is Mandatory

Capability pack attach করলেই runtime change live ধরে নেওয়া যাবে না.

এই screen-এ governance rows freeze করে company ACL version capture করতে হয়, তারপর intended version activate করতে হয়.

If this is skipped:

- runtime old ACL version use করতে পারে
- new pack attachments expected screen access নাও দিতে পারে
- SA মনে করবে setup complete, but company runtime old rules এ চলতে পারে

### When To Do This

Do this after:

- work context setup done
- user scope setup done
- capability packs attached
- capability governance review complete

### What To Fill

Field:

- `Version description`

Button:

- `Capture Immutable Version`

### What To Write

Write a meaningful release label.

Examples:

- `HR approval routing rollout`
- `Leave and out work ACL baseline`
- `Production and SCM approver access v1`

### What To Click

1. type `Version description`
2. click `Capture Immutable Version`

### Expected Result

A new version row appears below:

- `V<number> | description`
- status shows `Inactive`

### Activate The Runtime Version

In the versions list:

1. find the newly captured version
2. click `Activate`

### Expected Result After Activation

- selected version shows `Active`
- runtime starts using that ACL version

### If You Captured A Wrong Version

If a version is still inactive and should not be used:

- click `Remove`

Do not remove the active version.

### Company Rule

Each company needs its own ACL version capture and activation.

If you configure a second company, repeat this same freeze-and-activate step for that company too.

---

## Step 7: Enable Approval Policy

### Screen

Open: `/sa/approval-policy`

### Page

`Exact Resource Approval Policy`

### Goal

which exact action needs workflow approval সেটা declare করা

### Core Rule

Apply page `WRITE` gets approval policy.  
Approval inbox does not get approval policy here.

### Filter Area

search or select target business resource

### For HR Leave

Select resource:

- `Hr Leave Apply`

In right-side `Policy Editor`:

- `Action` = `WRITE`
- tick `This exact resource-action requires workflow approval`
- `Approval Type` = choose business rule
- `Min Approvers` = set as needed
- `Max Approvers` = set as needed

Save using:

- `Save Policy`

### For HR Out Work

Select:

- `Hr Out Work Apply`

Then set:

- `Action` = `WRITE`
- tick approval required checkbox
- `Approval Type`
- `Min Approvers`
- `Max Approvers`

Save.

### Approval Type Meaning

- `ANYONE`: one matching approver is enough
- `SEQUENTIAL`: stage-by-stage approval
- `ALL`: every required approver must approve

### Recommended Simple Setup

For most first rollout cases:

- `Approval Type` = `ANYONE`
- `Min Approvers` = `1`
- `Max Approvers` = `1`

### What Not To Do

Do not turn on approval for:

- `My Requests` view
- approval history view
- register view
- approval inbox view itself

---

## Step 8: Create Approval Rules

### Screen

Open: `/sa/approval-rules`

### Page

`Who Approves What`

### Goal

requester business scope অনুযায়ী actual approver set করা

### Most Important Rule On This Screen

`Exact Approval Resource` must be approval inbox resource, not apply page.

Correct examples:

- `Hr Leave Approval Inbox`
- `Hr Out Work Approval Inbox`

Wrong examples:

- `Hr Leave Apply`
- `Hr Out Work Apply`

### Field Meaning

- `Action` = `APPROVE`
- `Requester Subject Scope` = requester business scope
- `Approval Stage` = Stage 1, Stage 2, etc.
- `Target Mode` = `Specific User` or `Role`
- `Approver User` or role selection

---

### Step 8A: Department Bulk Rule

Use this for most common setup.

Example: Supply Chain requests go to Ankan

1. choose resource:
   - `Hr Leave Approval Inbox`
2. set:
   - `Action` = `APPROVE`
   - `Requester Subject Scope` = `DEPT_DPT009 | SUPPLY CHAIN`
   - `Approval Stage` = `Stage 1`
   - `Target Mode` = `Specific User`
   - `Approver User` = `ANKAN JYOTI`
3. save:
   - `Save Rule`

Example: Production requests go to Pradip

- `Requester Subject Scope` = `DEPT_DPT003 | PRODUCTION`
- `Approval Stage` = `Stage 1`
- `Approver User` = `PRADIP BHOWMICK`

Save.

### Step 8B: Functional Override Rule

Use this only when a department splits into more specific contexts.

Example: Powder requests go to Sujit

- `Requester Subject Scope` = `PROD_POWDER`
- `Approval Stage` = `Stage 1`
- `Approver User` = `SUJIT`

Example: Liquid requests go to Nilkamal

- `Requester Subject Scope` = `PROD_LIQUID`
- `Approval Stage` = `Stage 1`
- `Approver User` = `NILKAMAL`

Save each rule.

### Step 8C: Fallback Rule

Use this for broader fallback only.

Example:

- `Requester Subject Scope` = `All requester scopes in this company`
- `Approval Stage` = `Stage 2` or `Stage 3`
- `Approver User` = `DIRECTOR`

### Do Not Overuse

do not use `All requester scopes in this company` as the main rule  
keep it only as fallback

### Matching Priority

routing resolves in this order:

1. exact functional context
2. department scope
3. company fallback

That means:

- `PROD_POWDER` wins over `DEPT_PRODUCTION`
- `DEPT_PRODUCTION` wins over company-wide fallback

### Cross-Company Approver Rule

If Ankan from home department Supply Chain must approve another company’s Production requests:

1. add target company in `Edit Work Companies`
2. ensure approver-facing context is available there
3. create approval rule in that target company
4. requester subject scope still points to the requester’s target scope, such as:
   - `DEPT_PRODUCTION`
   - or `PROD_POWDER`

### Repeat For Out Work

After leave rules are done, repeat the same pattern using:

- `Hr Out Work Approval Inbox`

---

## Step 9: Create Report Visibility Rules

### Screen

Open: `/sa/report-visibility`

### Page

`Who Can See Reports`

### Goal

approval authority আর report visibility আলাদা রাখা

### Core Rule

being an approver does not automatically mean being a register/report viewer

### Use Cases

- employee sees own data only
- department approver sees department register
- plant head sees company register
- director sees multi-company if explicitly granted

### Form Logic

Choose:

- exact report resource
- `Action` = `VIEW` or `EXPORT`
- `Requester Subject Scope`
- viewer target user or role

Save using:

- `Save Rule`

### Example: Supply Chain Register Viewer

- resource = relevant leave/out-work register
- `Action` = `VIEW`
- `Requester Subject Scope` = `DEPT_DPT009 | SUPPLY CHAIN`
- viewer = `ANKAN JYOTI`

### Example: Company Audit Viewer

- `Requester Subject Scope` = company-wide
- viewer = audit/director user or role

### Important

private HR visibility must remain narrow  
do not open register access wider than business actually wants

### Report Visibility Mental Map

Think of report visibility as answering only this question:

`Who may see rows that belong to which requester scope?`

Do not think:

- who is the approver
- who has the higher rank
- who opened the page from which context

Think only:

- which exact report or register resource is being opened
- which requester scope those rows belong to
- which viewer user or role should be allowed to see them

### Very Important Separation

These 3 are different:

1. requester business scope  
   decides which business lane the request belongs to

2. approval rule  
   decides who may approve that request

3. report visibility rule  
   decides who may view that request in register, history, or export screens

One person may be:

- approver but not register viewer
- register viewer but not approver
- both approver and register viewer

### How To Read Scope In Report Visibility

Use scope like this:

- own data only  
  do not give any broad department or company register rule

- same department visibility  
  use the department scope like `DEPT_DPT003 | PRODUCTION`

- functional visibility  
  use the exact functional scope like `PROD_POWDER`

- full company visibility  
  use company-wide blank or all-requester-scopes rule inside that company

- cross-company visibility  
  create separate report rules in each target company

### Same Department Example

Business:

- `Pradip` should see only Production leave register

Rule:

- resource = `Hr Leave Register`
- `Action` = `VIEW`
- `Requester Subject Scope` = `DEPT_DPT003 | PRODUCTION`
- viewer = `PRADIP`

Meaning:

- Pradip sees Production rows
- Pradip does not automatically see Supply Chain rows

### Cross Department Example

Business:

- `Ankan` home department is Supply Chain
- but management wants him to see Production register too

Rule:

- create report visibility rule on Production scope
- `Requester Subject Scope` = `DEPT_DPT003 | PRODUCTION`
- viewer = `ANKAN`

Meaning:

- viewer home department does not matter
- report visibility follows explicit rule, not viewer's own department

### Cross Company Example

Business:

- `Director` should see Company A and Company B leave registers

Correct setup:

1. open `/sa/report-visibility`
2. select Company A and create Company A rule
3. select Company B and create Company B rule

Meaning:

- cross-company visibility is never automatic
- every company needs its own explicit rule

### Functional Visibility Example

Business:

- powder register should be visible only to powder manager
- liquid register should be visible only to liquid manager

Rules:

- `PROD_POWDER` -> powder manager
- `PROD_LIQUID` -> liquid manager

Optional fallback:

- audit or director can also get a separate company-wide viewer rule

### Screen Method For SA

Open:

- `/sa/report-visibility`

Then fill the form in this order:

1. choose `Company`
2. choose `Project`
3. choose `Module`
4. choose exact report or register resource
5. choose `Action = VIEW` or `EXPORT`
6. choose `Requester Subject Scope`
7. choose viewer target mode:
   - `Specific User`
   - or `Role`
8. choose the viewer user or viewer role
9. click `Save Rule`

### How SA Should Decide The Scope

If business says:

- "only Production rows"  
  use `DEPT_PRODUCTION`

- "only Powder rows"  
  use `PROD_POWDER`

- "whole company"  
  use company-wide blank or all-requester-scopes rule

- "two companies"  
  create one rule in each company

### What Not To Do

Do not assume:

- approver means report viewer
- higher role means company-wide register access
- same home department means automatic visibility
- cross-company manager means automatic cross-company visibility

All report visibility must be explicit.

---

## Step 10: Example Full Setup Templates

## Template A: Simple Department-Based Routing

Business:

- Supply Chain requests -> Ankan
- Production requests -> Pradip
- both on leave and out work

### Required Setup

1. departments exist:
   - `SUPPLY CHAIN`
   - `PRODUCTION`
2. users mapped:
   - requester users mapped to correct department scopes
   - Ankan has `HR_APPROVER`
   - Pradip has `HR_APPROVER`
3. capability packs attached:
   - `GENERAL_OPS` -> self-service
   - `HR_APPROVER` -> approval inbox/history
4. approval policy enabled:
   - `Hr Leave Apply` + `WRITE`
   - `Hr Out Work Apply` + `WRITE`
5. approval rules:
   - `Hr Leave Approval Inbox` + `DEPT_SUPPLY_CHAIN` -> Ankan
   - `Hr Leave Approval Inbox` + `DEPT_PRODUCTION` -> Pradip
   - `Hr Out Work Approval Inbox` + `DEPT_SUPPLY_CHAIN` -> Ankan
   - `Hr Out Work Approval Inbox` + `DEPT_PRODUCTION` -> Pradip

## Template B: Functional Override With Department Fallback

Business:

- `PROD_POWDER` -> Sujit
- `PROD_LIQUID` -> Nilkamal
- other Production requests -> Pradip
- director fallback if needed

### Required Setup

1. `PROD_POWDER` and `PROD_LIQUID` created in Work Context Master
2. powder requesters mapped to `PROD_POWDER`
3. liquid requesters mapped to `PROD_LIQUID`
4. approval rules:
   - `PROD_POWDER` -> Stage 1 -> Sujit
   - `PROD_LIQUID` -> Stage 1 -> Nilkamal
   - `DEPT_PRODUCTION` -> Stage 2 or Stage 1 fallback -> Pradip
   - company-wide fallback -> Stage 3 -> Director if needed

---

## Part 4B: Future Expansion Method

This section tells SA what to do when a new module, new process, or new functional split is introduced later.

## Case 1: New Business Split Inside Existing Department

Example:

- today only `DEPT_PRODUCTION` exists
- tomorrow business wants separate routing for `PROD_POWDER`

### What SA Must Do

1. open `/sa/work-contexts`
2. create new manual work scope:
   - `Work Scope Code` = `PROD_POWDER`
   - `Work Scope Name` = `Production Powder`
   - `Department Link` = `PRODUCTION`
3. open `/sa/acl/capabilities`
4. attach the correct packs to `PROD_POWDER`
5. open `/sa/users/scope`
6. add `PROD_POWDER` to actual powder users
7. open `/sa/approval-rules`
8. add `Requester Subject Scope = PROD_POWDER`
9. optionally open `/sa/report-visibility`
10. if reporting also needs split, add viewer rule for `PROD_POWDER`
11. capture and activate ACL version

### Decision Rule

Create a manual business scope only if one of these becomes true:

- approver changes
- screen access changes
- report visibility changes
- operational slice needs its own governed identity

If none of those change, stay with department scope only.

---

## Case 2: New Module Needs New Capability Pack

Example:

- tomorrow there is a new Purchase Approval module
- requester pages, approver pages, report pages all need packs

### Screen

Open: `/sa/acl/capabilities`

### Step 1: Create Capability Pack

In the `Screen Packs` area:

- fill `CAPABILITY_CODE`
- fill `Capability Name`
- fill `Description`
- click `Save Capability Pack`

### Naming Method

Use 3-pack thinking whenever possible:

1. requester pack
2. approver pack
3. report-viewer pack

### Example Naming

- `CAP_PURCHASE_REQUESTER`
- `CAP_PURCHASE_APPROVER`
- `CAP_PURCHASE_REPORT_VIEWER`

### Step 2: Fill Capability Matrix

Still in `/sa/acl/capabilities`:

1. choose the new pack from `Capability` dropdown
2. choose `Project`
3. choose `Module`
4. resource rows will appear
5. tick allowed actions for the pack
6. click `Save Capability Matrix`

### How To Think About The Matrix

#### Requester Pack

Usually allow:

- `VIEW`
- `WRITE`
- sometimes `EDIT`

on:

- apply pages
- my requests pages
- self-service requester pages

#### Approver Pack

Usually allow:

- `VIEW`
- `APPROVE`

on:

- approval inbox
- approval scope history
- approver work pages

#### Report Viewer Pack

Usually allow:

- `VIEW`
- sometimes `EXPORT`

on:

- register
- reports
- audit/history screens

### Step 3: Attach The Pack To Work Context

Still in `/sa/acl/capabilities`:

1. find the target context row
2. click `Manage Packs`
3. drawer opens
4. search for the pack
5. click `Attach`

### Which Context Gets Which Pack

#### Requester pack goes to:

- `GENERAL_OPS` if it is self-service requester access
- or a business operational scope if module is not self-service

#### Approver pack goes to:

- approver-facing context like `HR_APPROVER`
- or another dedicated approver scope

#### Report viewer pack goes to:

- `HR_AUDIT`
- `HR_DIRECTOR`
- another reporting scope

### Step 4: Give Context To Users

Open: `/sa/users/scope`

Attach the relevant context to the relevant users.

Important:

- you attach contexts to users
- you do not attach capability packs directly to users

Capability packs attach to work contexts.  
Users get access through those contexts.

### Step 5: Freeze And Activate ACL

After pack creation and attachment:

1. write `Version description`
2. click `Capture Immutable Version`
3. click `Activate`

---

## Case 3: New Module Needs Approval Routing

If a future module has approval, SA must think in this exact order:

1. which page submits the request
2. which business scope should represent the requester
3. which inbox resource will be used by approvers
4. which pack opens requester pages
5. which pack opens approver pages
6. which approval rules route by scope

### Setup Method

1. create or reuse business work scope
2. create or reuse requester pack
3. create or reuse approver pack
4. attach packs to correct contexts
5. map users to contexts
6. in `/sa/approval-policy`, enable approval on apply page `WRITE`
7. in `/sa/approval-rules`, create rules on approval inbox resource
8. in `/sa/report-visibility`, create separate report rules if needed

### Never Skip This Check

Before saving approval rules, ask:

- is this requester subject scope a real business scope?

If the answer is no, do not use it for routing.

---

## Part 4: Smoke Test Checklist

Run these before live:

### Test 1: Self-Service Access

Login as requester.

Verify:

- apply pages open from `GENERAL_OPS`
- `My Requests` opens

### Test 2: Department-Derived Routing

Login as a requester who has no explicit functional context selected.

Submit leave.

Expected:

- request is created
- approval goes by user’s department scope
- request is not silently treated as `GENERAL_OPS`

### Test 3: Functional Override Routing

Login as `PROD_POWDER` requester and submit leave.

Expected:

- powder approver receives request

Repeat for `PROD_LIQUID`.

### Test 4: Wrong Approver Must Not See

Login as unrelated approver.

Expected:

- request must not appear in inbox

### Test 5: Self Approval Block

Login as requester and try to approve own request if any route exposes it.

Expected:

- blocked

### Test 6: Out Work Also Works

Repeat the same tests using out work apply and approval inbox.

### Test 7: Report Visibility

Login as:

- employee
- department approver
- audit/director viewer

Expected:

- each sees only the intended report scope

### Test 8: Legacy Readability

Open old request history and old request register entries.

Expected:

- old records remain readable

---

## Part 5: Go-Live Readiness Checklist

Go live only when all are true:

- all real departments exist
- all required functional contexts exist
- every requester has correct parent company
- every requester has correct department mapping
- every requester has `GENERAL_OPS` plus needed business scope
- every approver has approver-facing context
- self-service packs attached to `GENERAL_OPS`
- approval inbox packs attached to approver context
- immutable ACL version captured after final governance changes
- intended ACL version activated for runtime
- leave apply `WRITE` policy saved
- out work apply `WRITE` policy saved
- approval rules created on approval inbox resources
- report visibility rules created separately
- smoke tests passed
- self-approval blocked
- wrong approver cannot see request
- no hidden dependency remains on `GENERAL_OPS` routing

---

## Part 6: What To Avoid

Never do these:

1. do not use `GENERAL_OPS` as requester subject scope in approval rules
2. do not create approval rules on `Hr Leave Apply` or `Hr Out Work Apply`
3. do not forget to enable approval policy on apply page `WRITE`
4. do not fake a user’s home department just to make them approver elsewhere
5. do not assume approver visibility and report visibility are the same
6. do not use company-wide fallback as the main routing rule everywhere
7. do not skip user scope mapping and expect routing to guess correctly

---

## Part 7: One-Page Quick Reference

If SA needs the shortest possible summary:

1. approve user
2. assign role
3. verify department exists
4. create functional context if business split exists
5. map parent company, department, work companies, work contexts, projects
6. attach self-service pack to `GENERAL_OPS`
7. attach approver pack to `HR_APPROVER`
8. capture immutable ACL version and activate it
9. in approval policy, enable `WRITE` approval on apply resources
10. in approval rules, use approval inbox resources and requester subject scope = `DEPT_*` or functional context
11. in report visibility, separately define who can view register/history
12. run smoke test

---

## Part 8: Final Truth Table

### What Stays In `GENERAL_OPS`

- self-service pages
- profile
- payslip
- own apply pages
- `CAP_HR_SELF_SERVICE`

### What Drives Approval Routing

- `DEPT_*`
- functional contexts like `PROD_POWDER`, `PROD_LIQUID`

### What Gives Approver Screen Access

- `HR_APPROVER`
- `HR_AUDIT`
- `HR_DIRECTOR`
- other approver-facing contexts

### Correct Interpretation

- page access can come from `GENERAL_OPS`
- request routing must come from business scope
- approval inbox access can come from approver context
- approval rule requester scope still points to requester business scope

---

## Part 9: SA Decision Tree

Use this section whenever a new business request comes in and SA must decide what to create, what to reuse, and where to configure it.

## Decision Tree A: Do We Need A New Manual Work Context?

Ask these questions in order:

### Question 1

Does the existing department scope already represent the business correctly?

If `yes`:

- do not create a manual work context
- use `DEPT_*` in approval rules

If `no`:

- go to Question 2

### Question 2

Inside the same department, does one subgroup need:

- different approver
- different screen access
- different report visibility
- different governed business identity

If `yes`:

- create a new manual work context in `/sa/work-contexts`

If `no`:

- stay with department scope only

### Question 3

Is the difference only about who can open approver pages, but not about requester routing?

If `yes`:

- do not create requester business scope for that reason alone
- use or create an approver-facing context like `HR_APPROVER`

### Result

Create a manual business context only when business execution is genuinely different.

Good examples:

- `PROD_POWDER`
- `PROD_LIQUID`
- `SCM_IMPORT`

Bad example:

- creating a new scope only because one user is special, when a user-specific approval rule would solve it

---

## Decision Tree B: Do We Need A New Capability Pack?

Ask these questions:

### Question 1

Does an existing pack already give exactly the needed page-action access?

If `yes`:

- reuse the existing pack
- attach it to the right work context

If `no`:

- go to Question 2

### Question 2

Is the new need one of these three types?

1. requester access
2. approver access
3. report-viewer access

If `yes`:

- create a pack in that family

### Recommended Pattern

For each new governed module, think in 3 packs:

1. requester pack
2. approver pack
3. report-viewer pack

### Examples

- `CAP_HR_SELF_SERVICE` or `CAP_HR_REQUESTER`
- `CAP_HR_APPROVER`
- `CAP_HR_REPORT_VIEWER`

- `CAP_PURCHASE_REQUESTER`
- `CAP_PURCHASE_APPROVER`
- `CAP_PURCHASE_REPORT_VIEWER`

### Question 3

Is the difference only one or two resource actions inside the same module?

If `yes`:

- first check if existing pack can be extended safely
- only create a new pack if mixing them would create over-broad access

### Result

Create new pack when access pattern is meaningfully different and should be reusable.

---

## Decision Tree C: Which Context Should Receive The Pack?

Ask:

### If it is requester self-service access

Attach to:

- `GENERAL_OPS`

Examples:

- apply page
- my requests
- profile/personal HR

### If it is operational business access

Attach to:

- `DEPT_*`
- or manual business scope

Examples:

- production operational screens
- powder-only operation screens

### If it is approver working access

Attach to:

- `HR_APPROVER`
- or another approver-facing context

Examples:

- approval inbox
- approval history

### If it is report/audit access

Attach to:

- `HR_AUDIT`
- `HR_DIRECTOR`
- or another report-viewer context

Examples:

- register
- export
- audit review

### Golden Rule

Pack attaches to context.  
User gets access because the user has that context.

Never think:

- “pack attach to user”

Always think:

- “pack attach to context”
- “context assign to user”

---

## Decision Tree D: Which Scope Goes Into Approval Rules?

Always ask:

### Question 1

What is the requester’s business identity for this workflow?

Use one of:

- exact functional scope like `PROD_POWDER`
- department scope like `DEPT_PRODUCTION`
- company fallback only if intentionally broad

### Question 2

Am I accidentally trying to use screen-access scope instead of requester business scope?

If you are using:

- `GENERAL_OPS`
- `HR_APPROVER`
- `HR_AUDIT`
- `HR_DIRECTOR`

then stop and re-check.

Those are usually not requester routing scopes.

### Safe Rule

Approval rules should normally use:

1. functional business scope
2. department scope
3. company fallback

---

## Decision Tree E: New Module With Approval

When a new approval module comes later, follow this exact sequence:

1. identify apply page resource
2. identify approval inbox resource
3. decide requester business scope
4. decide whether department scope is enough or manual functional scope is needed
5. create or reuse requester pack
6. create or reuse approver pack
7. create or reuse report-viewer pack
8. attach packs to correct contexts
9. assign contexts to users
10. enable approval policy on apply page `WRITE`
11. create approval rules on approval inbox resource
12. create report visibility rules separately
13. capture ACL version
14. activate ACL version
15. smoke test

If SA cannot answer step 3 clearly, do not proceed to approval rules yet.

---

## Decision Tree F: Override Or New Scope?

When business says “this one user is different”, ask:

### Case 1: only one specific user needs a different approver

Use:

- explicit override rule in `/sa/approval-rules`

Do not create a new manual business scope only for one exception.

### Case 2: a whole subgroup inside a department behaves differently

Use:

- new manual work context
- plus approval rule for that context

### Case 3: same approver, but different report access

Use:

- `Report Visibility`

Do not create new approval rules if approval path is unchanged.

### Case 4: same routing, but user needs inbox page access

Use:

- `Capability Governance`
- `User Scope Mapping`

Do not change requester routing scope.

---

## Decision Tree G: Final SA Self-Check Before Save

Before saving any new setup, SA should ask these 7 questions:

1. Is this a requester business scope issue, screen-access issue, or report-visibility issue?
2. Do I need a new manual work context, or is `DEPT_*` enough?
3. Do I need a new pack, or can I safely reuse an existing pack?
4. Am I attaching the pack to a context, not to a user?
5. Am I assigning the right context to the right users?
6. Am I putting the approval rule on the approval inbox resource, not the apply page?
7. After governance changes, did I capture and activate a new ACL version?

If any answer is unclear, pause there and resolve it before going live.

---

## Decision Tree H: Report Visibility Scope Selection

Use this whenever SA is confused about which report visibility scope to choose.

### Question 1

Should the viewer see only one department?

If `yes`:

- use that department `DEPT_*` scope

### Question 2

Should the viewer see only one functional slice inside a department?

If `yes`:

- use the exact manual business scope such as `PROD_POWDER`

### Question 3

Should the viewer see the whole company?

If `yes`:

- use company-wide blank or all-requester-scopes rule in that company

### Question 4

Should the viewer see more than one company?

If `yes`:

- repeat the rule separately in each company

### Question 5

Is the viewer allowed to approve, but business did not explicitly ask for register or report visibility?

If `yes`:

- do not add report visibility automatically

### Final Rule

Approval authority never creates report visibility by itself.  
Report visibility must always be granted separately and deliberately.

---

## Appendix A: Ready-Made Report Visibility Examples For Current HR Setup

Use this appendix as a fill-up reference for the current organization structure already discussed in this project.

Assumed current examples:

- company = `CMP003 | ALMEGA SURFACE COATS LLP`
- project = `PRJ001 | HR MANAGEMENT`
- main departments:
  - `DPT003 | PRODUCTION`
  - `DPT009 | SUPPLY CHAIN`
- known users:
  - `P0003 | PRADIP BHOWMICK`
  - `P0004 | ANKAN JYOTI`
  - `P0002 | HIMANSHU KANABAR`

If your real master data differs, keep the same logic and replace only the company, scope, and user selections.

### Appendix Rule 1: Production Leave Register Viewer

Use when:

- `Pradip` should see only Production leave rows

Open:

- `/sa/report-visibility`

Fill:

1. `Company` = `CMP003 | ALMEGA SURFACE COATS LLP`
2. `Project` = `PRJ001 | HR MANAGEMENT`
3. `Module` = HR leave module
4. exact resource = `Hr Leave Register`
5. `Action` = `VIEW`
6. `Requester Subject Scope` = `DEPT_DPT003 | PRODUCTION`
7. target mode = `Specific User`
8. viewer user = `P0003 | PRADIP BHOWMICK`
9. `Save Rule`

Meaning:

- Pradip sees Production leave rows only

### Appendix Rule 2: Supply Chain Leave Register Viewer

Use when:

- `Ankan` should see only Supply Chain leave rows

Fill:

1. `Company` = `CMP003 | ALMEGA SURFACE COATS LLP`
2. `Project` = `PRJ001 | HR MANAGEMENT`
3. exact resource = `Hr Leave Register`
4. `Action` = `VIEW`
5. `Requester Subject Scope` = `DEPT_DPT009 | SUPPLY CHAIN`
6. target mode = `Specific User`
7. viewer user = `P0004 | ANKAN JYOTI`
8. `Save Rule`

Meaning:

- Ankan sees Supply Chain leave rows only

### Appendix Rule 3: Production Out Work Register Viewer

Use when:

- `Pradip` should see only Production out-work rows

Fill:

1. `Company` = `CMP003 | ALMEGA SURFACE COATS LLP`
2. `Project` = `PRJ001 | HR MANAGEMENT`
3. exact resource = `Hr Out Work Register`
4. `Action` = `VIEW`
5. `Requester Subject Scope` = `DEPT_DPT003 | PRODUCTION`
6. target mode = `Specific User`
7. viewer user = `P0003 | PRADIP BHOWMICK`
8. `Save Rule`

### Appendix Rule 4: Supply Chain Out Work Register Viewer

Use when:

- `Ankan` should see only Supply Chain out-work rows

Fill:

1. `Company` = `CMP003 | ALMEGA SURFACE COATS LLP`
2. `Project` = `PRJ001 | HR MANAGEMENT`
3. exact resource = `Hr Out Work Register`
4. `Action` = `VIEW`
5. `Requester Subject Scope` = `DEPT_DPT009 | SUPPLY CHAIN`
6. target mode = `Specific User`
7. viewer user = `P0004 | ANKAN JYOTI`
8. `Save Rule`

### Appendix Rule 5: Plant Head Company-Wide Leave Viewer

Use when:

- plant management should see all leave rows of this company

Fill:

1. `Company` = `CMP003 | ALMEGA SURFACE COATS LLP`
2. `Project` = `PRJ001 | HR MANAGEMENT`
3. exact resource = `Hr Leave Register`
4. `Action` = `VIEW`
5. `Requester Subject Scope` = leave blank or choose company-wide all-requester-scopes option
6. target mode = `Specific User`
7. viewer user = `P0003 | PRADIP BHOWMICK`
8. `Save Rule`

Meaning:

- Pradip sees all leave rows in this company
- this should be used only if business truly wants company-wide visibility

### Appendix Rule 6: Director Company-Wide Leave And Out Work Viewer

Use when:

- director should see all HR register rows of this company

Create two rules:

1. one for `Hr Leave Register`
2. one for `Hr Out Work Register`

For both:

1. `Company` = `CMP003 | ALMEGA SURFACE COATS LLP`
2. `Project` = `PRJ001 | HR MANAGEMENT`
3. `Action` = `VIEW`
4. `Requester Subject Scope` = leave blank or choose company-wide all-requester-scopes option
5. target mode = `Specific User`
6. viewer user = `P0002 | HIMANSHU KANABAR`
7. `Save Rule`

### Appendix Rule 7: Cross Department Viewer Example

Use when:

- `Ankan` home department is Supply Chain
- but business wants him to see Production register too

This is allowed.

Create:

1. exact resource = `Hr Leave Register`
2. `Requester Subject Scope` = `DEPT_DPT003 | PRODUCTION`
3. viewer user = `P0004 | ANKAN JYOTI`
4. `Save Rule`

Meaning:

- home department does not restrict report visibility
- explicit viewer rule is the real authority

### Appendix Rule 8: Cross Company Viewer Example

Use when:

- one director or audit user should see HR report rows in another company too

Correct method:

1. open `/sa/report-visibility`
2. choose Company A and save Company A rule
3. choose Company B and save Company B rule
4. repeat per resource:
   - `Hr Leave Register`
   - `Hr Out Work Register`

Meaning:

- cross-company report visibility always needs separate company-wise rules

### Appendix Rule 9: Functional Visibility Example

Use only if later you create manual contexts such as:

- `PROD_POWDER`
- `PROD_LIQUID`

Then report visibility can also split like this:

1. `Hr Leave Register`
2. `Requester Subject Scope` = `PROD_POWDER`
3. viewer = powder manager

and separately:

1. `Hr Leave Register`
2. `Requester Subject Scope` = `PROD_LIQUID`
3. viewer = liquid manager

This should be used only when report visibility genuinely needs the same functional split.

### Appendix Rule 10: What SA Should Choose In Current Setup

If business intent is:

- "Ankan sees Supply Chain only"  
  use `DEPT_DPT009 | SUPPLY CHAIN`

- "Pradip sees Production only"  
  use `DEPT_DPT003 | PRODUCTION`

- "Pradip sees full company"  
  use company-wide blank or all-requester-scopes rule

- "Director sees full company"  
  use company-wide blank or all-requester-scopes rule

- "Ankan sees Production too"  
  add explicit Production viewer rule for Ankan

- "Director sees another company too"  
  create a new rule in that other company also
