# PACE ERP Clean Access Model

## Purpose

This document is the business-readable source of truth for access, approval, and visibility in PACE ERP.

The primary rule is simple:

`A user gets only the responsibility that SA explicitly grants.`

Nothing should be implied from title alone.
Not from `L4`.
Not from `Manager`.
Not from `Director`.

## Core Model

PACE ERP should be understood through only 5 business concepts.

### 1. User

A real person such as:

- Prasenjit
- Sujit
- Ankan

### 2. Company

The legal or operating company where work is being done.

Examples:

- Company A
- Company B

### 3. Business Area

The area of work inside one company.

This is the business meaning behind current `work context`.

Examples:

- HR
- Supply Chain
- Production Powder
- Production Admix
- Management

Rules:

- A business area belongs to one company only.
- A department is organization structure.
- A business area is runtime operating area.
- A business area may be equal to a department, or may be narrower than a department.

### 4. Access Pack

This is the business meaning behind current `capability`.

An access pack answers:

`What screens and actions can this user use?`

Examples:

- HR Requester
- HR Approver
- HR Report Viewer
- Supply Chain Operator
- Production Supervisor

Rules:

- Menu comes only from access packs.
- Approval rule membership must never create menu visibility by itself.
- Report visibility must never be implied by approval assignment.

### 5. Approval Grant

An approval grant answers:

`For requests coming from this business area, who can approve?`

Examples:

- Sujit approves Leave for Production Powder
- Plant Head approves Leave company-wide
- Director approves Out-work company-wide

Rules:

- Approval is explicit.
- Approval never comes automatically from role title.
- Approval never comes automatically from menu visibility.

## What Current Technical Terms Mean

### Role

Current meaning:

- baseline identity bucket

Business meaning:

- default person class

Examples:

- L4 User
- Manager

Rule:

- Role must not be treated as approval authority by itself.

### Work Context

Current meaning:

- technical scope identifier

Business meaning:

- business area
- runtime work lane

### Capability

Current meaning:

- technical permission bundle

Business meaning:

- access pack

## Clean Operating Rules

### Rule 1: Access and approval are different

Access asks:

- Can the user open this page?
- Can the user use this feature?

Approval asks:

- Can the user approve this request for this business area?

Both may exist together, but they are not the same thing.

### Rule 2: Menu comes from access only

If a user sees a menu item, it must be because SA granted access for that function.

Not because:

- the user is an approver
- the user is L4
- the user is manager

### Rule 3: Approval comes from explicit grant only

If a user can approve a request, it must be because SA explicitly granted that approval authority.

Not because:

- role title sounds senior
- the user can see the page
- the user has report access

### Rule 4: Company and business area must both be explicit

A user may work in:

- one company and one business area
- multiple companies and one business area in each
- one company and multiple business areas

But this must be granted explicitly.

### Rule 5: Multi-company handling defaults to context switch

Default model:

- one active company at a time
- one active business area at a time

Example:

- Ankan switches from `Company A > Supply Chain` to `Company B > Supply Chain`

This is the clean default.

Cross-company same-page visibility should exist only if explicitly granted as a special case.

## Setup Order For SA

Every user should be configured in this order.

### Step 1: Assign operating area

Choose:

- which companies this user works for
- which business areas inside those companies this user works in

### Step 2: Attach access packs

Choose:

- what the user can open
- what the user can do

### Step 3: Attach approval grants

Choose:

- what the user can approve
- from which business area
- for which request type

### Step 4: Attach report visibility only if needed

Choose:

- what reports or registers the user can see

Do not merge this with approval unless explicitly required.

## User Examples

### Example A: Prasenjit

- Works In:
  - Company A > HR
- Access Packs:
  - HR Requester
- Approval Grants:
  - none
- Report Visibility:
  - none

### Example B: Sujit

- Works In:
  - Company A > Production Powder
- Access Packs:
  - HR Requester
  - HR Approver
- Approval Grants:
  - Leave approval for Production Powder
- Report Visibility:
  - only if separately granted

### Example C: Ankan

- Works In:
  - Company A > Supply Chain
  - Company B > Supply Chain
- Access Packs:
  - Supply Chain Operator
- Approval Grants:
  - only if explicitly granted
- Report Visibility:
  - only if explicitly granted

## How To Judge Whether The Design Is Clean

The design is clean only if SA can answer these four questions in less than 10 seconds for any user:

1. Where does this user work?
2. What can this user use?
3. What can this user approve?
4. What can this user see?

If SA needs to think about:

- raw resource codes
- VWED flags
- technical scope names
- hidden menu logic

then the design is still too technical.

## Target UI Language

Use this language in admin screens whenever possible:

- `Business Area` instead of `Work Context`
- `Access Pack` instead of `Capability`
- `Approval Grant` instead of only `Approver Rule`
- `Report Visibility` as its own concept
- `Role Permissions` only as advanced screen language

## Advanced Screen Policy

These screens are advanced and should not be the main daily setup surface:

- Role Permissions
- raw resource matrices
- low-level ACL mutation screens

Primary business setup should happen through:

1. People Assignment
2. Access Packs
3. Approval Grants
4. Report Visibility

## Final Design Principle

PACE ERP should feel like:

`People + Responsibility + Access + Approval`

not:

`Roles + Work Context + Capability + Resource Matrix + Hidden ACL`
