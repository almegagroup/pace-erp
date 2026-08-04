# Next-session prompt — Inventory menu group ACL design

> এই ফাইলটা শুধু reference/backup হিসেবে repo-তে রাখা হলো। আসল কাজ হলো নিচের
> ব্লকটা কপি করে নতুন session-এ প্রথম message হিসেবে পেস্ট করা।

---

## কপি করার জন্য প্রম্পট (নিচের লাইন থেকে শুরু)

আমরা "Inventory" menu group-এর প্রতিটা page-এর জন্য ACL design (কোন department/role কী access পাবে) করব — page by page, discuss করে decision নিয়ে, তারপর prod (আর dev) DB-তে বসিয়ে verify করব। শুরু করার আগে নিচের পুরো context আর rule-গুলো পড়ে নাও।

### আগের session-এ যা পাওয়া গেছে (starting point)

`erp_menu.menu_master`-এ group `GRP_ACL_INVENTORY` ("Inventory")-এর নিচে ৭টা page:

| tx_code | menu_code | Title |
|---|---|---|
| IN01 | PROC_PI_LIST | Physical Inventory |
| IN02 | PROC_STOCK_LEDGER | Stock Ledger |
| IN03 | PROC_CURRENT_STOCK | Current Stock |
| IN04 | PROC_STOCK_VALUATION | Stock Valuation |
| IN05 | PROC_OPENING_STOCK_LIST | Opening Stock |
| IN06 | PROC_OPENING_STOCK_APPROVAL | Opening Stock Approval |
| PR21 | PROD_FG_STOCK_BREAKDOWN | FG Stock Breakdown |

**Live prod (project `bsjpvkigpllichlknmah`) DB সরাসরি চেক করে ধরা পড়েছে:** এই ৭টা page-ই একটামাত্র capability দিয়ে গেট করা — `CAP_PROC_INVENTORY` — আর এই capability শুধুমাত্র **ACL-MASTER** work context-এ assign করা (CMP003-এ DEPT_DPT030, CMP006-এ DEPT_DPT031)। `acl.role_menu_permissions`-এও কোনো alternate path নেই। `precomputed_acl_view` সরাসরি চেক করে **নিশ্চিত হয়েছে — P0076 (ACL-MASTER) ছাড়া কারো কাছেই এই ৭টা page-এর একটাতেও কোনো access নেই**, দুই company-তেই (CMP003/CMP006)।

**⚠️ সবচেয়ে জরুরি implication:** IN05/IN06 (Opening Stock)-এর জন্য আগের session-এ (Task C) একটা real maker-checker chain বানানো হয়েছে — L1_AUDITOR creates → L2_AUDITOR approves → L2_AUDITOR creates → DIRECTOR approves (`acl.approver_map`, resource_code `PROC_OPENING_STOCK_APPROVAL`)। কিন্তু L1/L2 Auditor-রা এই পেজটাই দেখতে পাচ্ছে না ACL গেটের কারণে — তাই সেই chain বাস্তবে ব্যবহারই হচ্ছে না। এই session-এর design-এ **অবশ্যই** L1_AUDITOR/L2_AUDITOR-কে IN05/IN06-এর real access দিতে হবে, নাহলে আগের কাজ অকেজো থেকে যাবে।

### Workflow (এই ভাবেই আগেরবার কাজ হয়েছিল, একই pattern follow করো)

প্রতিটা page-এর জন্য:
1. আমি (business owner) বলব — কোন department (Stores/Accounts/SCM/Auditor/QA/Production ইত্যাদি), কোন role পর্যন্ত (User-tier/Manager-tier), কী action (View/Create/Edit/Delete/Approve) পাবে।
2. তুমি সেটা `acl.capability_menu_actions` + `acl.work_context_capabilities` + `acl.role_capabilities` দিয়ে বাস্তবায়ন করবে — এই তিনটে ভিন্ন table, তিনটেই লাগে (নিচে detail আছে)।
3. ACL version bump করে (capture+generate+activate) live verify করবে।
4. Docs আপডেট করবে।

### Mandatory rules — এগুলো ভাঙা যাবে না (CLAUDE.md + এই session-এর নিজের শেখা)

**generate_acl_snapshot()-এর আসল mechanism (আগের session-এ function-এর source পড়ে বোঝা হয়েছিল) — এইটা না জানলে ভুল design হবে:**
কোনো user একটা capability-র সুবিধা পায় শুধুমাত্র যদি **দুটো গেট-ই** পাশ করে:
  (a) তার work_context-এ সেই capability assign করা থাকে (`acl.work_context_capabilities`), **এবং**
  (b) তার নিজের role সেই একই capability_code-এর জন্য আলাদাভাবে `acl.role_capabilities`-এ enroll করা থাকে।
শুধু department-এ capability assign করলেই হয় না — role_capabilities-এও সেই role থাকতে হবে। **এই session-এই P0076 (DIRECTOR) এই কারণে AC05/AC06-এ Approve করতে পারছিল না** — department capability ছিল, কিন্তু role_capabilities-এ DIRECTOR role যোগ করা ছিল না। প্রতিটা নতুন grant দেওয়ার সময় দুটোই check/insert করো।

**Migration Integrity (CLAUDE.md §8A) — যদি কোনো schema/function change লাগে (সাধারণত এই কাজে লাগবে না, pure ACL data হলে লাগে না):**
- Schema/DDL change হলে migration file বানাও, MCP `apply_migration` দিয়ে prod-এ বসাও, **তারপর একই migration dev project-এও (`ytapuwiqicmvpanmzelb`) বসাও** — আগের session-এ এই ভুল ধরা পড়েছিল (একটা migration শুধু prod-এ ছিল, dev-এ ছিলই না)।
- দুই জায়গাতেই migration history reconcile করো (`apply_migration` remote timestamp ব্যবহার করে, local filename-এর timestamp না — `UPDATE supabase_migrations.schema_migrations SET version = ...`)।
- শেষে `node scripts/migration-integrity-check.mjs` থেকে পাওয়া SQL **দুই project-এই** চালিয়ে `in_sync: true` confirm করো।
- **শুধু business/operational/ACL data হলে migration লাগবে না** — MCP direct SQL যথেষ্ট, dev+prod দুই জায়গাতেই আলাদাভাবে চালাতে হবে (কারণ MCP change শুধু যেখানে চালানো হয় সেখানেই থাকে)।

**ACL Version capture-এর one-time ফাঁদ (CLAUDE.md §8, bug pattern #4):**
`acl.capture_acl_version_source()` একবারই কাজ করে — একই `acl_version_id`-তে দ্বিতীয়বার call করলে **silent no-op** (কোনো error ছাড়াই কিছু আপডেট হয় না)। তাই প্রতিবার live data (capability_menu_actions/role_capabilities/work_context_capabilities) বদলানোর পর:
1. নতুন `acl.acl_versions` row বানাও (version_number += 1, is_active=false প্রথমে)
2. `acl.capture_acl_version_source(new_version_id, company_id, actor)` চালাও
3. `acl.generate_acl_snapshot(new_version_id, company_id)` চালাও
4. পুরনো version-কে `is_active=false`, নতুনটাকে `is_active=true` করো
5. `acl.precomputed_acl_view`-এর নতুন-stale হওয়া পুরনো version-এর row মুছে দাও (`DELETE ... USING acl.acl_versions WHERE is_active IS NOT TRUE`) — এটা routine housekeeping, প্রতিবার করা ভালো।
দুই company (CMP003 আর CMP006)-এর জন্যই আলাদা version row লাগবে (company-scoped)।

**ACL-MASTER (P0076) drift — bug pattern #5:**
প্রতিটা নতুন grant-এর পর `scripts/acl-master-drift-check.mjs` চালিয়ে দেখো P0076 বাকি সবার সমান বা তার বেশি পাচ্ছে কিনা (script SQL print করে, MCP দিয়ে চালাও)।

**approver_map ব্যবহার করলে (যদি কোনো page-এ নতুন approve/reject action লাগে):**
- DIRECTOR-কে approver_map-এ আলাদা row হিসেবে বসিও না — কোডে (`assert*ApproverRole` ফাংশনে) SA/GA-এর পাশে DIRECTOR-ও bypass হিসেবে বসাও (এই session-এর locked pattern, `opening_stock.handlers.ts`/`mts_sku_rate.handlers.ts`/`costing_group.handlers.ts`/`stroke_master.handlers.ts` দেখো রেফারেন্স হিসেবে)।
- `acl.approver_map`-এ per-scope (company+resource+action+subject_role) সর্বোচ্চ **৫টা** approver row রাখা যায় (trigger `enforce_approver_bounds()`, এই session-এই ৩ থেকে ৫-এ বাড়ানো হয়েছে, migration `20260803190000`)।
- নতুন approve handler লিখলে `pickScopedApproverRules` (`_shared/workflow_scope.ts`) ব্যবহার করো, শুধু status flip কোরো না — নাহলে self-approve করা যাবে (bug pattern #7, এই session-এই Opening Stock/AC05/AC06/Stroke Master-এ এই ভুল ধরা পড়ে ঠিক করা হয়েছে)।

**Hardcoded role-check বসিও না (bug pattern #1):**
কোনো নতুন backend handler-এ `MANAGER_OR_SA_ROLES`-স্টাইল hardcoded role list বা `assertManagerOrSARole`-স্টাইল function বসিও না — ACL layer-ই আসল authority হবে।

**Company-scope (bug pattern #2/#11):**
যদি কোনো handler company_id নিয়ে filter/insert/update করে (body বা query string থেকে), অবশ্যই `assertCompanyScope`(বা সমতুল্য local variant) কল করো।

**Resource-code collision (bug pattern #6):**
একই resource_code দুটো আলাদা route domain-এ (যেমন procurement আর production) ব্যবহার কোরো না, যদি না সেটা সত্যিই একটা shared/documented case হয়।

**Batch vs Sequential loop (CLAUDE.md §8B):**
কোনো loop-এ একাধিক independent async DB call থাকলে (যেমন একাধিক user-এর role lookup) `.in()` দিয়ে bulk fetch করো, sequential await-in-loop কোরো না — এই session-এই নিজের লেখা কোডে এই ভুল ধরা পড়ে ঠিক করা হয়েছে।

### শেষে অবশ্যই verify করো (কাজ শেষ, commit করার আগে)

1. যদি কোনো `.ts`/`.tsx`/`.jsx` backend/frontend file বদলাও — `deno check` (backend) চালাও, নতুন কোনো error না আসে দেখো (পুরনো `.range()/.or()/.ilike()/.count` typing noise থাকবেই, সেটা আলাদা করে চিনে নাও — `git diff --stat` দিয়ে edit-এর কাছাকাছি কিনা check করো)।
2. এই ৫টা CI guard চালাও, সব pass করছে কিনা দেখো:
   ```
   node scripts/stock-posting-guard.mjs
   node scripts/company-scope-guard.mjs
   node scripts/hardcoded-role-check-guard.mjs
   node scripts/approver-chain-guard.mjs
   node scripts/resource-code-domain-guard.mjs
   ```
3. এই ৩টা on-demand DB-check script-এর SQL MCP দিয়ে prod-এ চালাও (dev-এও চাইলে), কোনো নতুন drift/gap এসেছে কিনা দেখো:
   ```
   node scripts/acl-master-drift-check.mjs
   node scripts/acl-version-capture-drift-check.mjs
   node scripts/approver-map-integrity-check.mjs
   ```
4. যদি কোনো migration বানাও — `node scripts/migration-integrity-check.mjs` থেকে পাওয়া SQL dev **এবং** prod দুই জায়গাতেই চালিয়ে `in_sync: true` confirm করো।
5. `docs/Operation Management/PROD-ACL-Access-Decisions.md`-এ প্রতিটা page-এর decision লিখে রাখো (আগের Group-গুলোর মতোই format — legend V/C/E/D/A, department-ভিত্তিক টেবিল)।
6. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`-এ কাজের summary যোগ করো — **আগের লেখা মুছো না, নতুন entry হিসেবে append করো**।
7. Commit/push শুধু আমি explicit বললেই করবে — নিজে থেকে করবে না।

### প্রথম প্রশ্ন যেটা আমাকে জিজ্ঞেস করবে

IN01 (Physical Inventory) দিয়ে শুরু করো — জিজ্ঞেস করো কোন department/role-এর কী access (View/Create/Edit/Delete/Approve) হওয়া উচিত। তারপর একে একে IN02 → IN03 → IN04 → IN05 → IN06 → PR21।

---

## কপি এখানে শেষ
