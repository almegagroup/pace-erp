# SA Setup Playbook
## Dev To Prod-like HR Governance Setup

Prepared for: Super Admin (SA) operator  
Language mode: Bengali + English mixed  
Goal: Dev environment-ke current Prod HR governance model-er moto ready kora  
Out of scope: Exact user assignment, exact company choice, exact approver/viewer person mapping

## 1. Document Purpose

Ei playbook follow kore SA manually dev setup korte parbe jate dev-er HR governance structure prod-er moto hoye jay.

Ei document-er core principle holo:

1. Company aar user exact rows dev aar prod-e same na holeo structure same korte hobe.
2. Manual access publish korte hobe only sob structural step shesh hole.
3. Prod-ke source of truth dhore dev-e screen-by-screen mirror korte hobe.
4. Jekono user-specific decision, exact approver person, exact report viewer person, aar exact company onboarding decision SA alada business instruction onujayi nibe.

## 2. Scope

Ei playbook-er moddhe included:

1. Project setup
2. Company-project mapping pattern
3. Module setup
4. Menu and page governance
5. Module-resource ownership
6. Capability pack setup
7. Work context setup
8. Work context capability binding
9. Work context project inheritance
10. Company-module enablement
11. Role permission baseline
12. Approval policy
13. Final ACL publish

Ei playbook-er baire:

1. Company create/edit exact values
2. User signup approval
3. User role assignment
4. User scope assignment
5. Exact approver person mapping
6. Exact report viewer person mapping

## 3. Golden Rules

1. `ACL Version Center` e publish korbe na jotokkhon na Step 1 theke Step 11 complete hoye jay.
2. `Prod` side-by-side open rekhe `Dev`-e copy korbe.
3. Jekhane row count beshi, sekhane filter use kore module-wise copy korbe.
4. Jodi kono page prod-e inactive thake, dev-e o active korbe na.
5. `GENERAL_OPS` holo self-service lane.
6. `HR_APPROVER`, `HR_AUDIT`, `HR_DIRECTOR`, `HR_ACCESS`, `CORRECTION_APPROVER` holo manual business/HR lanes.
7. `Approval Rules` aar `Report Visibility` ei playbook-e optional-later, karon exact user/company decision SA pore nibe.
8. Dev-e purono legacy setup thakle blindly delete korbe na; first new target setup complete korbe, tarpor old rows retire korbe.

## 4. Final Target Shape From Prod

Prod-er current HR governance model theke confirmed target:

1. Project:
   - `PRJ001`
   - `HR MANAGEMENT`

2. Modules:
   - `PRJ001_HR_ACCESS_MODULE`
   - `PRJ001_LEAVE_MODULE`
   - `PRJ001_OUT_WORK_MODULE`

3. Capability packs:
   - `CAP_HR_ACCESS`
   - `CAP_HR_SELF_SERVICE`
   - `CAP_HR_APPROVER`
   - `CAP_HR_AUDIT_VIEW`
   - `CAP_HR_DIRECTOR`
   - `CAP_HR_PLANT_HEAD`

4. Core manual work contexts found in prod:
   - `GENERAL_OPS`
   - `HR_ACCESS`
   - `HR_APPROVER`
   - `HR_AUDIT`
   - `HR_DIRECTOR`
   - `CORRECTION_APPROVER`

5. Department-derived work contexts also exist in prod. SA company-wise department rows onujayi segulo maintain korbe.

6. Specialized operational work contexts also exist in prod, for example:
   - `PROD_LIQUID`
   - `PROD_POWDER`
   - `PROD_RESIN`
   - `PROD_SBP`
   - `PROD_WB`
   - `QUALITY_LIQUID`
   - `QUALITY_POWDER`
   - `QA_PAINTS`
   - `QA_RESIN`
   - `STORES_LIQUID`
   - `STORES_POWDER`

7. Core menu group shape in prod:
   - `HR_MANAGEMENT`
   - `HR_ACCESS`
   - `LEAVE_MANAGEMENT`
   - `OUTWORK_MANAGEMENT`

## 5. Exact Sequence To Follow

Only ei order follow korbe:

1. Project Master
2. Company Project Map
3. Module Master
4. Menu Governance
5. Page Resource Registry verification
6. Module Resource Map
7. Capability Governance - Pack Definitions
8. Work Context Master
9. Capability Governance - Work Area Bindings
10. Work Context Project Attachment
11. Company Module Map
12. Role Permissions
13. Approval Policy
14. Optional later: Approval Rules
15. Optional later: Report Visibility
16. ACL Version Center publish

## 6. Pre-Run Preparation

Before starting:

1. Prod aar Dev dui environment login kore ready rakhbe.
2. Duita browser tab pair banabe:
   - left: prod
   - right: dev
3. Same screen prod-dev side-by-side rakhbe.
4. Ekta manual checklist maintain korbe:
   - done
   - pending
   - skipped by business decision

## 7. Step 1 - Project Master

Screen:

- Route: `/sa/project-master`
- Screen title: `Project Master`

Goal:

- Dev-e prod-like HR project identity ready kora.

What SA must do:

1. Prod-e `Project Master` open korbe.
2. Dev-e `Project Master` open korbe.
3. Check korbe dev-e `PRJ001 / HR MANAGEMENT` ache ki na.
4. Jodi na thake, `project_name` field-e `HR MANAGEMENT` likhe save korbe.
5. Save success notice-e generated project code verify korbe.
6. Jodi dev-e old row `PRJ007 / HR MANAGEMENT SYSTEM` thake, immediately delete korbe na.
7. New target row create hole tarpor downstream mapping notun row-er upor korbe.

Stop condition:

- Dev-e active HR project row prod model-er moto present.

## 8. Step 2 - Company Project Map

Screen:

- Route: `/sa/projects/map`
- Screen title: `Company Project Map`

Goal:

- Jey company-gulo dev-e HR module use korbe, tader target HR project-er sathe attach kora.

What SA must do:

1. Prod-e `Company Project Map` open korbe.
2. Project dropdown theke `PRJ001 / HR MANAGEMENT` select korbe.
3. Dev-e same screen open kore target HR project select korbe.
4. Company list theke business-approved dev companies map korbe.
5. Jodi dev-e company set prod-er moto na hoy, exact prod company code follow korar dorkar nei.
6. Rule holo: je dev company-ke HR governance-er under ante hobe, shei company-ke map korte hobe.
7. Each row-te map/unmap action kore success notice confirm korbe.

Important:

- Ei step-e company business choice SA nibe.
- Kintu project-er logical coverage pattern prod-er moto broad hote hobe.

Stop condition:

- Target dev HR companies sob project-e mapped.

## 9. Step 3 - Module Master

Screen:

- Route: `/sa/module-master`
- Screen title: `Module Master`

Goal:

- Prod-er moto exact 3-module HR model create kora.

Create these exact modules:

1. `HR ACCESS MODULE`
   - approval required: `Yes`
   - approval type: `SEQUENTIAL`
   - min approvers: `1`
   - max approvers: `3`

2. `LEAVE MODULE`
   - approval required: `Yes`
   - approval type: `ANYONE`
   - min approvers: `2`
   - max approvers: `3`

3. `OUT WORK MODULE`
   - approval required: `Yes`
   - approval type: `ANYONE`
   - min approvers: `2`
   - max approvers: `3`

What SA must do:

1. Prod-e module row details dekhe nibe.
2. Dev-e target project select korbe.
3. Uporer 3 module exact naming-e create korbe.
4. Jodi old legacy module `PRJ007_LEAVE_MODULE` ba `PRJ007_OUT_WORK_MODULE` thake, note korbe but notun module create agei old row touch korbe na.
5. New module create hoye gele code preview/proper generated code verify korbe.

Stop condition:

- Dev module registry-te prod-like 3 module active.

## 10. Step 4 - Menu Governance

Screen:

- Route: `/sa/menu`
- Screen title: `Super Admin menu governance`

Goal:

- Prod-er ACL universe menu tree dev-e publish kora.

Target group structure:

1. `HR_MANAGEMENT`
2. `HR_ACCESS`
3. `LEAVE_MANAGEMENT`
4. `OUTWORK_MANAGEMENT`

What SA must do:

1. Universe filter `ACL` rakhbe.
2. Prod screen-e active `GROUP` rows dekhe dev-e same group tree create korbe.
3. Each group-er:
   - `menu_code`
   - `title`
   - `parent_menu_code`
   - `display_order`
   prod-onujayi mirror korbe.
4. Tarpor `PAGE` rows publish korbe.
5. Each page create/edit korar somoy:
   - `menu_code`
   - `resource_code`
   - `title`
   - `route_path`
   - `parent_menu_code`
   - `display_order`
   - `active / inactive`
   prod side theke copy korbe.

Minimum pages that prod model-e dev-e thaktei hobe:

1. `HR_LEAVE_APPLY`
2. `HR_LEAVE_APPROVAL_INBOX`
3. `HR_LEAVE_APPROVAL_SCOPE_HISTORY`
4. `HR_LEAVE_MY_REQUESTS`
5. `HR_LEAVE_REGISTER`
6. `HR_OUT_WORK_APPLY`
7. `HR_OUT_WORK_APPROVAL_INBOX`
8. `HR_OUT_WORK_APPROVAL_SCOPE_HISTORY`
9. `HR_OUT_WORK_MY_REQUESTS`
10. `HR_OUT_WORK_REGISTER`
11. `HR_LEAVE_TYPE_MANAGE`
12. `HR_CALENDAR_MANAGE`
13. `HR_ATTENDANCE_CORRECTION`
14. `HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX`
15. `HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY`
16. `HR_ATTENDANCE_CORRECTION_PENDING_LIST`
17. `HR_ATTENDANCE_DAILY_REGISTER`
18. `HR_ATTENDANCE_DEPARTMENT_REPORT`
19. `HR_ATTENDANCE_LEAVE_USAGE`
20. `HR_ATTENDANCE_MONTHLY_SUMMARY`
21. `HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY`

Inactive-but-registered pages prod-e thakle dev-e same state rakhbe:

1. `HR_LEAVE_REQUEST_DETAIL`
2. `HR_LEAVE_REGISTER_RESULTS`
3. `HR_OUT_WORK_REQUEST_DETAIL`
4. `HR_OUT_WORK_REGISTER_RESULTS`
5. `HR_ATTENDANCE_CORRECTION_REQUEST_DETAIL`

Important:

- `DASHBOARD_HOME` jodi dev-e orphan page hishebe thake, prod-er tree-r sathe match kore clean-up korte hobe.
- Jekono page create-r por route conflict/error hole prod row-ta abar compare korbe.

Stop condition:

- Dev ACL menu tree prod-er moto group + page coverage peyechhe.

## 11. Step 5 - Page Resource Registry Verification

Screen:

- Route: `/sa/page-registry`
- Screen title: `ACL Page And Resource Registry`

Goal:

- Published page row-gulo actually registry-te esheche kina verify kora.

What SA must do:

1. Prod-e `Page Registry` open korbe.
2. Dev-e same screen open korbe.
3. Search use kore prod-er prottek required resource code check korbe.
4. `is_published` aar `is_active` prod-er sathe match korbe.
5. Missing row pele back to `Menu Governance` giye publish kore abar ekhane verify korbe.

Stop condition:

- Required prod ACL resources sob page registry-te present.

## 12. Step 6 - Module Resource Map

Screen:

- Route: `/sa/module-pages`
- Screen title: `Module-to-page resource ownership`

Goal:

- Prottek resource-ke correct module-er under assign kora.

Target assignment pattern:

1. `PRJ001_HR_ACCESS_MODULE`
   - `HR_LEAVE_TYPE_MANAGE`
   - `HR_CALENDAR_MANAGE`
   - sob attendance correction pages
   - sob attendance report/register pages

2. `PRJ001_LEAVE_MODULE`
   - sob leave pages

3. `PRJ001_OUT_WORK_MODULE`
   - sob out-work pages

What SA must do:

1. Prod-e module-resource screen open korbe.
2. Filter `UNASSIGNED` / `ALL` use kore dev-e missing rows identify korbe.
3. Bulk assign drawer use kore resource selected module-e attach korbe.
4. Jodi kono resource wrong owner module-e thake, age unassign, tarpor correct module-e assign korbe.

Stop condition:

- Dev-e active ACL business resources sob correct module owner peyechhe.

## 13. Step 7 - Capability Governance: Pack Definitions

Screen:

- Route: `/sa/acl/capabilities`
- Screen title: `Screen Packs and Business-Area Binding`
- Tab: `Pack Definitions`

Goal:

- Prod capability pack names dev-e create kora.

Create / verify these packs:

1. `CAP_HR_ACCESS`
2. `CAP_HR_SELF_SERVICE`
3. `CAP_HR_APPROVER`
4. `CAP_HR_AUDIT_VIEW`
5. `CAP_HR_DIRECTOR`
6. `CAP_HR_PLANT_HEAD`

Recommended names/descriptions:

1. `CAP_HR_ACCESS` = HR Admin Access
2. `CAP_HR_SELF_SERVICE` = HR Self Service
3. `CAP_HR_APPROVER` = HR Approver
4. `CAP_HR_AUDIT_VIEW` = HR Audit
5. `CAP_HR_DIRECTOR` = HR Director
6. `CAP_HR_PLANT_HEAD` = HR Plant Head

What SA must do:

1. Prod-e `Pack Definitions` tab open korbe.
2. Dev-e missing pack create korbe.
3. Code exact same rakhbe.
4. Name/description prod-er moto rakhbe jodi available thake.

Stop condition:

- Dev capability pack master prod-er code shape-er moto complete.

## 14. Step 8 - Work Context Master

Screen:

- Route: `/sa/work-contexts`
- Screen title: `Work Context Master`

Goal:

- Prod-er manual HR lanes aar specialized operational lanes dev-e toiri kora.

What SA must do:

1. Company-wise kaaj korbe.
2. Prod-er ek company select kore oi company-r `work_context_code`, `work_context_name`, `department link`, `active state` note korbe.
3. Dev-e corresponding company select korbe.
4. Missing manual context create korbe.

Minimum manual contexts to create where business-relevant:

1. `GENERAL_OPS`
2. `HR_ACCESS`
3. `HR_APPROVER`
4. `HR_AUDIT`
5. `HR_DIRECTOR`
6. `CORRECTION_APPROVER`

Specialized contexts create only if that company/business lane dev-e actually needed:

1. `PROD_LIQUID`
2. `PROD_POWDER`
3. `PROD_RESIN`
4. `PROD_SBP`
5. `PROD_WB`
6. `QUALITY_LIQUID`
7. `QUALITY_POWDER`
8. `QA_PAINTS`
9. `QA_RESIN`
10. `STORES_LIQUID`
11. `STORES_POWDER`

Rules:

1. `GENERAL_OPS`, `HR_ACCESS`, `HR_APPROVER`, `HR_AUDIT`, `HR_DIRECTOR`, `CORRECTION_APPROVER` usually manual context.
2. Department-derived contexts company department setup-onujayi system/manual bhabe already thakte pare.
3. Same code use korbe, random alternate code use korbe na.

Stop condition:

- Dev company-wise work context inventory prod operating model-er moto ready.

## 15. Step 9 - Capability Governance: Work Area Bindings

Screen:

- Route: `/sa/acl/capabilities`
- Tab: `Work Area Bindings`

Goal:

- Work context-er sathe correct capability attach kora.

Confirmed prod binding pattern:

1. `GENERAL_OPS` -> `CAP_HR_SELF_SERVICE`
2. `HR_ACCESS` -> `CAP_HR_ACCESS`
3. `HR_APPROVER` -> `CAP_HR_APPROVER`
4. `HR_AUDIT` -> `CAP_HR_AUDIT_VIEW`
5. `HR_DIRECTOR` -> `CAP_HR_DIRECTOR`
6. `CORRECTION_APPROVER` -> `CAP_HR_PLANT_HEAD`

What SA must do:

1. Company select korbe.
2. `Work Area Bindings` tab-e jabe.
3. Prod-er same context row খুঁজে attached capability compare korbe.
4. Dev-e attach/unattach kore same pattern banabe.

Stop condition:

- Core HR manual contexts sob correct capability pack peyechhe.

## 16. Step 10 - Work Context Project Attachment

Screen:

- Route: `/sa/work-contexts`
- Action inside selected context: project attachment drawer

Goal:

- Je work contexts project inheritance use korbe, tader HR project-er sathe attach kora.

Why this matters:

- Dev-e ei layer missing chhilo.
- Prod-e operational HR contexts project inheritance peyechhe.

What SA must do:

1. `Work Context Master` e target context select korbe.
2. `Project attachment` action open korbe.
3. Prod-e same context-e kon project attached ache dekhe nibe.
4. Dev-e minimum `HR MANAGEMENT` project attach korbe jekhane HR runtime reach dorkar.

Practical rule:

- Core HR contexts and required operational contexts-ke HR project-er sathe attach korte hobe.

Stop condition:

- Required work contexts-e project inheritance attached.

## 17. Step 11 - Company Module Map

Screen:

- Route: `/sa/acl/company-modules`
- Screen title: `Company module workspace`

Goal:

- Target dev companies-ke correct modules enable kora.

What SA must do:

1. Prod-e company by company module enablement dekhe nibe.
2. Dev-e target company select korbe.
3. Usually prod pattern holo:
   - `HR ACCESS MODULE` enabled
   - `LEAVE MODULE` enabled
   - `OUT WORK MODULE` enabled
4. Jodi business instruction bole kono company-te `HR ACCESS MODULE` lagbe na, sheta consciously skip korbe.
5. Legacy dev inconsistency jemon only out-work enabled thakle, eta correct korbe.

Stop condition:

- Target dev companies prod-like module coverage peyechhe.

## 18. Step 12 - Role Permissions

Screen:

- Route: `/sa/acl/role-permissions`
- Screen title: role permission matrix

Goal:

- Role baseline permission breadth prod-er moto ana.

Important:

- Ei screen-e row onek beshi hote pare.
- Best method holo prod aar dev same role, same project, same module filter diye side-by-side mirror kora.

What SA must do:

1. Role choose korbe.
2. Project filter set korbe `PRJ001`.
3. Module filter set korbe one-by-one:
   - `PRJ001_HR_ACCESS_MODULE`
   - `PRJ001_LEAVE_MODULE`
   - `PRJ001_OUT_WORK_MODULE`
4. Prod row-er allow flags dev-e same korbe:
   - `VIEW`
   - `WRITE`
   - `EDIT`
   - `DELETE`
   - `APPROVE`
   - `EXPORT`
5. Ek role complete hole next role-e jabe.

Recommended execution order:

1. `DIRECTOR`
2. `L1_MANAGER`
3. `L2_MANAGER`
4. `L3_MANAGER`
5. `L1_USER`
6. `L2_USER`
7. `L3_USER`
8. Audit roles if prod-e in use

Stop condition:

- Role baseline matrix prod-er visible behavior-er sathe aligned.

## 19. Step 13 - Approval Policy

Screen:

- Route: `/sa/approval-policy`
- Screen title: `Exact Resource Approval Policy`

Goal:

- Resource/action level approval requirement prod-er moto set kora.

What SA must do:

1. Prod screen-e resource by resource dekhe nibe.
2. Dev-e same resource open korbe.
3. Policy save korbe action-wise.

Known prod-like patterns:

1. Leave requester flow:
   - `HR_LEAVE_APPLY / WRITE`
   - approval required `Yes`
   - approval type prod-onujayi

2. Out-work requester flow:
   - `HR_OUT_WORK_APPLY / WRITE`
   - approval required `Yes`
   - approval type prod-onujayi

3. Attendance correction flow:
   - correction request resource/action
   - prod side theke exact values copy korbe

Important:

- Inbox/history/register page-gulor jonno usually policy na-o lagte pare.
- Prod value theke copy korle safest.

Stop condition:

- Dev resource approval policy prod-er required rows cover kore.

## 20. Optional Later - Approval Rules

Screen:

- Route: `/sa/approval-rules`

Use only when:

1. Exact approver person/role business theke final hoye jabe.
2. User/company assignment complete hobe.

Current note:

- Structural prod-dev gap analysis-e role-based approver rows empty chhilo.
- Tai ei playbook-er main clone phase-e approval rules mandatory na.

## 21. Optional Later - Report Visibility

Screen:

- Route: `/sa/report-visibility`

Use only when:

1. Exact viewer person/role final.
2. User scope complete.

Current note:

- Structural prod-dev gap analysis-e role-based report viewer rows empty chhilo.
- Tai ei step post-structure phase-e korbe.

## 22. Final Step - ACL Version Center Publish

Screen:

- Route: `/sa/acl/version-center`
- Screen title: `ACL Version Center`

Goal:

- Sob governance change runtime-e publish kora.

What SA must do:

1. Ensure Step 1 to Step 13 complete.
2. `ACL Version Center` open korbe.
3. Publish-required company rows identify korbe.
4. Each target company select korbe.
5. Suggested description thakle use korte pare, otherwise pattern:
   - `<COMPANY_CODE> ACL publish <date time>`
6. `Capture And Activate Now` / equivalent publish action click korbe.
7. Success notice confirm korbe.

Do not publish before:

1. module setup complete
2. menu/resource setup complete
3. capability binding complete
4. company-module enablement complete
5. role permissions and approval policy complete

Stop condition:

- Target dev companies show fresh active version and no immediate pending publish requirement.

## 23. Final Validation Checklist

Publish-er pore SA ei checklist follow korbe:

1. `Project Master` e target HR project ache.
2. `Company Project Map` e target HR companies mapped.
3. `Module Master` e 3 module active.
4. `Page Registry` e required ACL pages published.
5. `Module Resource Map` e active page-gulo owner module peyechhe.
6. `Capability packs` complete.
7. `Work Context Master` e manual HR lanes complete.
8. `Work Area Bindings` prod pattern follow kore.
9. `Company Module Map` e target company-gulo module enabled.
10. `Role Permissions` broad matrix copied.
11. `Approval Policy` requester resources-e set.
12. `ACL Version Center` e fresh publish done.

## 24. Safe Execution Notes For SA

1. Jodi kono screen-e mismatch dekho, first prod screen compare korbe, tarpor save korbe.
2. Jodi dev-e purono `PRJ007` structure thake, new `PRJ001` structure fully ready howar age old row retire korbe na.
3. Jodi kono company business-ready na hoy, take map/enable na kore pending list-e rekho.
4. Jodi exact approver/viewer business bole na, `Approval Rules` aar `Report Visibility` skip kore structure complete koro.
5. Publish sesh hole ekbar logout-login ba runtime smoke check korte hobe.

## 25. One-Line Summary For SA

Prod-ke source of truth dhore dev-e age project-module-menu-capability-work-context skeleton complete koro, tarpor role permission aar approval policy mirror koro, shob seshe ACL Version Center theke publish koro.
