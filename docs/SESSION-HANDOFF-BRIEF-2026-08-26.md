# Session Handoff Brief — 2026-08-26

> এই brief-টা 2026-08-26 session-এর কাজ + next task (RM/PM/INT Sale Module Revisit) সেট আপ করার
> জন্য লেখা। নতুন session শুরু করার আগে এই পুরো file-টা পড়ো, তারপর নিচের "পড়ার ক্রম" section-এ
> বলা document গুলো পড়ো।

---

## পড়ার ক্রম (নতুন session শুরুর আগে)

1. **`CLAUDE.md`** পুরোটা — বিশেষ করে §8A-8E (mandatory dev rules), ১৫টা bug pattern checklist,
   Bug-Pattern Guard Playbook, আর §6-এর "🔒 নতুন locked sequence (2026-08-13)" ব্লক (নিচে §2-এ
   summary আছে)।
2. **`docs/Operation Management/PROD-ACL-Access-Decisions.md`** — যেকোনো ACL/permission কাজের
   আগে এটাই SSOT।
3. **`docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`**
   Section 113 (Sales Module Redesign — SO/STO/DO/PGI/Invoice, RM/PM/INT scope) — আজকের কাজের
   বিষয়বস্তু।
4. **`docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`** — শেষের দিকের
   entry গুলো (2026-08-25/26) — আজকের session-এ কী কী হয়েছে তার detail এখানে লেখা আছে, এই brief
   শুধু pointer + summary।
5. `git log --oneline -20` — recently touched file-এর context।

---

## ১. এই session-এ (2026-08-25/26) কী কী হয়েছে

সংক্ষেপে, commit অনুযায়ী (নতুন থেকে পুরনো):

- **`ddfdfae3`** — AC01 drawer-এ Material Name/External Code/Vendor Name যোগ (আগে শুধু raw
  material_id/vendor_id ছিল, resolve হতো না)।
- **`cb874714`** — **Live prod incident, নিজে ঘটিয়ে নিজেই fix করেছি** — `save_ac01_grn_cost()`
  RPC-এ নতুন param যোগ করতে গিয়ে `CREATE OR REPLACE` পুরনো signature replace না করে **নতুন
  overload** বানিয়ে ফেলেছিল, ফলে PostgREST-এর RPC call ambiguous হয়ে AC01-এর প্রতিটা Save fail
  করছিল prod-এ। Fix: পুরনো signature explicit `DROP FUNCTION` করা হয়েছে (dev+prod দুটোতেই),
  migration file-ও সংশোধন করা হয়েছে যাতে fresh apply-তে এই বাগ আবার না হয়। **শিক্ষা: `CREATE OR
  REPLACE FUNCTION`-এ parameter list বদলালে সবসময় `pg_proc`-এ query করে exactly একটাই signature
  আছে কিনা verify করতে হবে, "replace" শব্দে ভরসা করা যাবে না।**
- **`ef44ed46`** — **AC01 "Considered Qty" ফিচার** (business owner directive)। নতুন
  `goods_receipt.considered_qty` column — GRN তৈরির সময় সবসময় Invoice Qty (ge_qty) দিয়ে prefill
  হয়, AC01 drawer-এ user edit করতে পারে। Vendor Payable **এবং** Landed Cost/unit (যেটা
  `recalculate_valuation_at_row()` দিয়ে material-এর আসল WAR ঠিক করে) দুটোই এখন Considered Qty
  দিয়ে হিসাব হয় — Received Qty (physical stock) কখনো touch হয়নি। এই সিদ্ধান্তটা business owner-এর
  নিজের, একটা tradeoff দেখানোর পরে (Received Qty দিয়ে stock valuation qty-consistent থাকে, কিন্তু
  Considered Qty দিয়ে vendor payment term সরাসরি per-unit cost নির্ধারণ করে) — উনি Considered Qty
  বেছে নিয়েছেন, ভবিষ্যতে দরকার হলে বদলাবেন।
- **`ba44e09d`** — GRN 2000000019 (VISFLOW VW 220, CMP006)-এর GE Qty data correction — CSN-এর
  real Dispatch Qty (29870) দিয়ে GE/GRN-এর ge_qty (আগে ভুল করে 29770 ছিল) ঠিক করা হয়েছে। এখান
  থেকেই পুরো Considered Qty ফিচারের দরকার পড়ে।
- **`ae22ceee`** — AC06-এর "Execute Full Report" বাটন click করলে সরাসরি Dashboard-এ bounce করত —
  `routeIndex.js`-এর `companionRoutePairs`-এ AC06-এর `/report` companion route pair যোগ করাই
  ছিল না, fix করা হয়েছে।
- AC06-এর আরও ২টা fix (আলাদা commit, একই session-এ আগে): **orphan sidebar item** (৪টা companion
  resource code `erp_menu.menu_master`-এ ভুল করে PAGE হিসেবে ছিল, কোনো parent group ছাড়া —
  `erp_menu.*` থেকে delete করা হয়েছে, `acl.menu_master` অক্ষত রাখা হয়েছে), আর **"Manage
  Materials" bulk checkbox multi-select** (Material Company Mapping-এর মতোই select-many+bulk
  action, backend আগে থেকেই batch সাপোর্ট করত)।
- **PO11 (Procurement Planning) fix** — Available Qty আগে open reservation deduct করত না
  (raw Unrestricted stock দেখাত), IN03-এর মতো এখন Net Available (Unrestricted − Reserved) দেখায়।

**Migration আজকে prod+dev দুটোতেই apply+reconcile+verify (in_sync=true) হয়েছে:**
`20260826100000_ac01_considered_qty.sql` (পরে সংশোধিত, DROP FUNCTION যোগ করে)।

**Verify করা হয়েছে, bug না:**
- **Opening/Reco coverage** — PR22 (SFG side): 39/39 opening Process PO, 412/412 line — ১০০%
  `process_order_line_reco`-তে আছে। PR23 (PM side): 23টার মধ্যে 20টাতে reco row আছে, বাকি ৩টা
  (batch BM5685/BM3793/EV02625) **tanker (pack code 000)**, PM লাগে না বলেই reco row নেই —
  business owner নিজেই confirm করেছেন, bug না।

**ACL-এ কোনো change হয়নি আজকের কোনো fix/feature-এ** (PO11/AC06×3/AC01×3/GE-Qty সবগুলোই হয় pure
calc/UI/data fix, নয়তো existing grant reuse করেছে)। AC04/P0079 provisioning ACL change আজকের
session-এরই আগের ধাপে হয়েছিল, আলাদা, ইতিমধ্যে committed।

**⚠️ এখনো live click-through verify করা হয়নি** (এই environment-এ dev login নেই) — Considered
Qty ফিচার আর Material/Vendor identity fields — code+DB level verify করা হয়েছে (deno check,
eslint, guard script, direct SQL simulation), কিন্তু business owner-কে deployed app-এ একবার
click করে দেখতে বলা হয়েছে।

**⚠️ PR প্রশ্ন এখনো খোলা** — `dev` branch এখন `main`-এর চেয়ে **~1340+ commit** এগিয়ে। Business
owner-কে জিজ্ঞেস করা হয়েছিল পুরো scope-এর একটা বড় PR চান কিনা, নাকি নিজে manage করবেন (আগের
session-এর pattern অনুযায়ী) — এখনো সরাসরি উত্তর পাওয়া যায়নি, পরবর্তী session-এ জিজ্ঞেস করো।

---

## ২. Locked sequence — এখন কোথায় আছি (CLAUDE.md §6-এর 2026-08-13 lock)

```
1. PID (IN01)                          ✅ DONE
2. MTEST + ZTEST redesign              ✅ DONE (Codex, verified)
3. RM Sale Module Revisit              ➡️ এটাই পরের session-এর কাজ
4. Dispatch + Costing/AP-Reco + Return Receipt   (একসাথে, এখনো শুরু হয়নি)
```

**Step 4 সম্পর্কে মনে রাখার জিনিস** (§113-14, CLAUDE.md থেকে):
- `process_order_line_reco`/`packing_order_line_reco` (data capture layer) সম্পূর্ণ ready
  (Actual/AP-Approved/Variance ঠিকমতো জমা হচ্ছে) — আজকেই verify করা হয়েছে, উপরে §1 দেখো।
- কিন্তু **AP Reco derivation report** (এই দুটো table জোড়া লাগিয়ে এক dispatch-এর জন্য এক AP
  Reco নম্বর বানানো — `ratio = qty this Packing PO drew ÷ Process PO batch's total actual output`
  তারপর `AP Reco = ratio × ap_approved_qty`) **এখনো বানানো হয়নি** — আর এটা Dispatch design-এর
  **সাথেই** বানানোর কথা, আলাদা করে আগে না (কারণ formula-র numerator-ই Dispatch-এর নিজের shape)।
  **তাই step 3 শেষ না করে step 4-এ ঝাঁপ দিও না।**
- FG Dispatch (Phase 2) সম্পূর্ণ আলাদা, এই ৪-ধাপ sequence-এর বাইরে — নিজের formal L5 session লাগবে
  (মাত্র ~৫১% designed)।

---

## ৩. পরের কাজ: RM/PM/INT Sale Module Revisit (Step 3)

**Scope:** §113-এ যা build হয়েছে তার **test + fix + finalize** — নতুন design না, existing code
verify করা। FG Dispatch এই scope-এর বাইরে (Phase 2, touch করা হবে না)।

**যা ইতিমধ্যে built (§113, feasibility doc-এ full detail):**
- **SO01** — Sales Orders (`/dashboard/procurement/sales-orders`) — create/edit, approval লাগে না
- **PO07** — Stock Transfer Orders (Procurement group-এ, SCM-owned, approval লাগে — PO13-এ)
- **SO03** — Delivery Order (`/dashboard/procurement/delivery-orders`) — SO+STO দুটোরই unified DO
- **SO02** — Sales Invoices (`/dashboard/procurement/sales-invoices`) — PGI+Invoice queue/trigger
- **MM04** — FG Sales Customer master (`/dashboard/om/customers`) — GST/Ship-To সহ

**শুরু করার আগে confirm করে নিও (business owner-কে জিজ্ঞেস করো):**
- কোনো নির্দিষ্ট bug/সমস্যা মাথায় আছে কিনা যেটা দিয়ে শুরু করা উচিত, নাকি পুরো flow (SO create →
  DO → PGI/Invoice) একটা real test case ধরে step-by-step verify করবে।
- Customer creation flow (MM04, GST lookup সহ) টাও এই ধাপেরই অংশ — user নিজেই বলেছিলেন
  "RM PM INT Sale, tader Customer toiri" — তাই Customer Master flow-ও scope-এ ধরে নাও।

**মনে রাখার মতো পুরনো note (memory: MM04 Customer Master Dual-Use):** MM04 আসলে Plan Feed-এর FG
party-দের সাথেই একই table শেয়ার করে (prod-এর ~100% row আজকেও তাই) — ইচ্ছাকৃতভাবে আলাদা করা হয়নি,
শুধু সত্যিকারের RM/PM customer এলে revisit করার কথা।

---

## ৪. এই session-এর discipline (পরের session-এও একই ভাবে করো)

- **কখনো ধরে নিও না, verify করো** — আজকে PO11/AC06/AC01-এর প্রতিটা "সমস্যা" আসলে কী, সেটা লাইভ DB
  query করে বের করা হয়েছে, শুধু code পড়ে অনুমান করা হয়নি।
- **ACL decision layer vs sidebar/menu_snapshot layer আলাদা করে verify করো** — AC06-এর orphan
  item bug ধরা পড়েছিল ঠিক এই পার্থক্যটা বোঝার কারণেই (ACL ঠিক ছিল, menu_master-এ ভুল রেজিস্ট্রেশন
  ছিল)।
- **`CREATE OR REPLACE FUNCTION`-এ parameter list বদলালে সবসময় `pg_proc` query করে single
  signature confirm করো** — নতুন শেখা lesson, আজকেই একটা live incident ঘটিয়েছি এটা না করে।
- **প্রতিটা backend change-এর পর `deno check` (git-stash before/after)**, প্রতিটা frontend change-এর
  পর `eslint` + relevant guard script (`jsx-no-undef-guard`, `company-scope-guard`,
  `frontend-payload-guard`)।
- **Schema change করলে migration apply + reconcile + `NOTIFY pgrst, 'reload schema'` + `migration-integrity-check.mjs`** — dev ও prod দুটোতেই, প্রতিবার।
- **আজকে ছাড়া কমিট করা অন্য সব file touch কোরো না** — এই session জুড়ে একটা সমান্তরাল
  MTEST/PTEST work-stream (অন্য session/terminal থেকে) চলছিল, বারবার `git status`-এ দেখা যাচ্ছিল —
  সেগুলো ইচ্ছাকৃতভাবে touch করা হয়নি, শুধু নিজের file-ই stage+commit করা হয়েছে প্রতিবার।
