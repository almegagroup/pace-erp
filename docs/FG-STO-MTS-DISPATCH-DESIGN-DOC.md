# FG STO + MTS Dispatch — Design & Status Document

**Started:** 2026-09-27
**Purpose:** এই doc FG STO (`SO01` "Create FG STO" tab, এখনো placeholder) এবং MTS
Dispatch (IWC/Powder-এর dispatch mechanism)-এর design/implementation track করার জন্য।
Master feasibility doc
(`docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`)
Section 114 (FG Dispatch discovery) এখনো এই কাজের আসল SSOT — এই doc সেটাকে summarize +
extend করে, replace করে না।

**Sequencing (business owner, 2026-09-27):** এই doc-এর কাজ **শুরু হবে
`docs/PROCUREMENT-DESIGN-DOC.md`-এর সব open item বন্ধ হওয়ার পরে** — এটা আগের
(2026-09-22) "Dispatch for MTS আগে, Inward for Bulk পরে" lock-কে override করে।

---

## 1. Historical context — full §114 extraction (FG Dispatch discovery session,
started 2026-07-31, ✅ locked for Admix/HPS/MTEST+IWC scope, 🔴 Powder scope এখনো
IN PROGRESS/not locked)

### 1.1 — চারটা dispatch mechanism (ব্যবসার real practice, §114.1)
1. **Admix / HPS**
2. **MTEST / ZTEST** (business owner confirmed: দুটো নাম একই জিনিস)
3. **Direct**
4. **Depot**

### 1.2 — FG Customer structure + Depot mechanism (§114.2)
- এখন পর্যন্ত সব FG sale **একটাই customer**-কে যায় — **Asian Paints**। (ভবিষ্যতে অন্য
  customer আসতে পারে, কিন্তু এখনই generalize করার দরকার নেই।)
- Asian Paints-এর দুই ধরনের Depot code: **Depot** আর **Virtual Depot**।
- **Depot mechanism:** একটা state-এ Asian Paints-এর **একটাই GST number**, কিন্তু একাধিক
  **physical Depot** (আলাদা address, একই GST) থাকতে পারে। প্রতিটা Depot-এর নিজস্ব **Depot
  Code** — এই code **Asian Paints নিজেই দেয়**, আমরা বানাই না। Address manually বসাতে হবে
  (GST lookup depot-level address দেয় না, GST state-level)। **Bill To = Asian Paints**
  (state-এর GST identity), **Ship To = নির্দিষ্ট Depot Code + manual address**।
- **Structural ইঙ্গিত (locked না, শুধু note):** Depot Code বারবার reuse হয় (একই Depot-এ
  বারবার dispatch) — তাই সম্ভবত দরকার একটা **reusable Depot/Ship-To Master** (একবার সেভ,
  পরে dropdown থেকে select), §113.16-এর per-order Ship-To pattern থেকে ভিন্ন। এখনো build
  হয়েছে কিনা code-এ verify করা বাকি (§3-এর "Depot Code Master" item দেখো)।

### 1.3 — Virtual Depot (business owner CONFIRMED, §114.3)
- **মানে:** জিনিস সরাসরি **end customer**-এর কাছে যায় (কোনো physical Asian Paints Depot-এ
  না), কিন্তু তবুও Asian Paints-এর নিজস্ব Depot Code structure দিয়েই track হয়।
- **Hierarchy:** State → Asian Paints-এর একটাই GST number → একাধিক (Virtual) Depot Code →
  একাধিক end customer/address।
- **CONFIRMED:** Depot Code ↔ Address সম্পর্ক **কখনো strict 1:1 না** — একটা Depot Code
  একাধিক address ধরতে পারে, একটা customer-এর আলাদা address আলাদা Depot Code-এ যেতে পারে,
  এক state বা একাধিক state জুড়ে। Data model-এ এটা flexible many-to-many mapping হতে হবে।

### 1.4 — Depot dispatch order flow + IWC allocation (business owner CONFIRMED, §114.4)
- Depot dispatch সরাসরি **real Depot Code**-এ যায়। Flow ঠিক **RM/PM/INT-এর SO/STO-র মতোই
  ৩-stage: Sales Order → DO → PGI+Invoice** (Tally Invoice Number/Date সহ, §113.15-এর
  একই pattern)। তফাত: rate capture একটু আলাদা (§1.6, SO04)।
- **IWC dispatch allocation — CONFIRMED:** IWC-র দুটো prodshade আছে কিন্তু **batch-manageable
  না** (§83.7/§108-এর MTS/MTEST batch-blind lock-এর সাথে সামঞ্জস্যপূর্ণ)। তাই IWC dispatch-এ
  Admix/HPS/MTEST-এর মতো FO/Packing-PO-number/batch-driven allocation লাগে না — **normal/
  generic SKU-quantity দিয়ে dispatch হয়** (allocation দিক থেকে Powder-এর কাছাকাছি —
  batch-blind), কিন্তু flow-টা এখনো §1.4-এর SO→DO→PGI+Invoice same-day-close-ই থাকে,
  Powder-এর decoupled advance-billing flow না।

### 1.5 — Dispatch Type ↔ Production Type mapping (§114.5)
- Production type নামকরণ: Admix=MTO, Hypershot=HPS, IWC+Powder=MTS (§83.7)।
- **Direct** dispatch-এর ভেতরেই দুই রকম আলাদা method:
  - **Admix/HPS/MTEST(=ZTEST)** — একই Direct-dispatch method।
  - **বাকি MTS (IWC বাদে, মূলত Powder)** — ভিন্ন method।
- **IWC নিজে Direct দিয়ে যায় না** — IWC-র dispatch mechanism হলো **Depot** (§1.4-এর locked
  flow)।

### 1.6 — Direct dispatch-এর দুই sub-method বিস্তারিত (§114.6, LOCKED না — বিস্তারিত যাচাই বাকি)

**Admix/HPS/MTEST — Direct method:**
- SO-র সাথে FO map হয় (§83.18-REVISED Plan Feed mechanism, `plan_feed_packing_order_allocation`)।
- Allocation Packing PO number-wise যায় (প্রতিটা Packing PO আলাদা করে FO-র সাথে map)।
- Direct customer-এর কাছেই যায়।
- **যেদিন dispatch, সেদিনই PGI+Invoice** — physical movement আর billing একসাথে, একই সময়ে
  (§113.15-এর atomic PGI+Invoice pattern-এর সাথে মিলছে)।

**Powder (বাকি MTS) — সম্পূর্ণ আলাদা "Advance Billing" method (এখনো design না, শুধু বাস্তবতা):**
- Billing physical stock movement-এর অনেক আগেই হয়ে যায় — মাসজুড়ে SO/DO/Billing চলতেই থাকে,
  stock থাকুক বা না থাকুক।
- এই SO/DO/Billing-এর সময় **system stock reduce করে না, stock check-ও করে না**।
- আসল physical dispatch (PGI) হয় যেদিন vehicle আসে — তখনই real stock movement।
- **সমস্যা:** vehicle না আসলে — Invoice cancel, DO cancel, সংশ্লিষ্ট SO-র balance prune সব
  করতে হয়।
- **তবুও stock negative না হওয়ার guarantee** কোথাও-না-কোথাও থাকতেই হবে — কোথায় বসবে সেটা
  design করা হয়নি।
- **Quick answers (2026-07-31, বিস্তারিত পরে Powder session-এ):**
  1. Powder-এ "Billing" = একটা **Invoice record** (আলাদা কিছু না)।
  2. "vehicle এলে PGI" trigger — **Vehicle Number + Date বসিয়ে, অথবা অন্য button** (exact
     UI ঠিক হয়নি)।
  3. Stock validation-এর জায়গা — **এখনো ভাবা হয়নি**।
  4. Invoice/DO cancel + SO prune chain — **Powder session-এর নিজস্ব প্রশ্ন**।

### 1.7 — ⚠️ SCOPE DECISION (§114.7, 2026-07-31): L5 session তখন শুধু Admix/HPS/MTEST+IWC
- Sequencing অনুযায়ী §83 (2026-06-02)-এর আগের locked sequencing-এর সাথেই মেলে: "Admix,
  Hypershot, IWC — আগে; Powder — পরে, আলাদা go-live।"
- Powder-এর সব open question (§1.6) তখন থেকে **এই scope-এর বাইরে**, নিজের future session-এর
  জন্য reserved — **আজও (2026-09-27) reserved-ই আছে**, কোনো progress হয়নি।

### 1.8 — IWC/MTS Rate Capture: Monthly Rate Master, SO04 (§114.8, LOCKED না)
- **নতুন page — TX code SO04** (Sales ACL group): company-wise MTS product SKU list,
  প্রতিটার জন্য **month-wise sale rate** সেট করা যাবে, ACL-controlled (role-based, SA-only না)।
- **SO Create-এ ব্যবহার:** SO-তে "Single Month?" Yes/No choice — Yes হলে header-এ একবার
  month select (সব line একই rate নেবে), No হলে per-line month select। যে SKU-র জন্য যে
  month-এ rate configured আছে শুধু সেগুলোই dropdown-এ দেখাবে।
- **CONFIRMED — rate না থাকলে hard block:** কোনো SKU-র কোনো month-এই rate না থাকলে সেই SO
  line তৈরি করা যাবে না, কোনো manual override নেই।

### 1.9 — MTEST rate (§114.11, CONFIRMED, সরল)
- MTEST-এর material-এর বিভিন্ন pack size-এর জন্য Asian Paints নিজেই rate fixed করে রাখে।
- SO-তে rate **সরাসরি manual entry** — কোনো SO04-এর মতো Rate Master/approval mechanism
  লাগে না, প্রতিবার হাতে টাইপ।
- (dispatch mechanism হিসেবে MTEST আগে থেকেই §1.6-এ locked — Admix/HPS-এর same Direct
  method।)

### 1.10 — AC06 Monthly Costing Rate Workspace (§114.23, LOCKED 2026-08-24)
PO11-parity workspace Dispatch-এর জন্য Monthly Costing Rate maintain করার — এটা §1.8-এর
SO04 (customer-facing sale rate) থেকে আলাদা, এটা internal costing rate। পুরো detail →
feasibility doc §114.23 এবং §139 (AC06 Intra-Month Rate Split)।

### 1.11 — Costing status (already done, dispatch-independent)
- **AC05 (MTS SKU Costing)** — 2026-09-24/25-এ design+implement সম্পূর্ণ (vendor-code
  keyed, effective-dated rate table, AC06-cascade)। MTS dispatch-এর **Costing/Reco
  layer**-এর জন্য দরকার ছিল, dispatch mechanism নিজেই না।
- **SO01 Vendor Code header field** — 2026-09-24-এ implement, MTS FG dispatch-কে টার্গেট
  করে বানানো, কিন্তু **prod-এ 2026-09-24 পর্যন্ত zero real MTS FG/SFG line ছিল** — মানে এই
  পুরো generic SO01/DO/PGI pipeline **কখনো একটা real MTS dispatch দিয়ে test হয়নি**।

### 1.12 — 2026-09-27 session-এর নিজস্ব framing (AskUserQuestion, business owner তখন
"darao" বলে FG STO-তে redirect করেছিলেন — এই ৩-option framing-টা এখনো valid, পরে resume
করার সময় এখান থেকেই শুরু হবে)
1. **IWC Dispatch verify + AC05 wiring** — Depot mechanism generic pipeline দিয়ে built
   মনে হচ্ছে, কিন্তু real MTS line দিয়ে কখনো test হয়নি (Prod-এ 0 rows)। AC05-এর rate-কে
   আসল Costing/AP-Reco flow-এ wire করা বাকি।
2. **Powder Dispatch (Advance Billing) — fresh design** — §1.6-এর সব open question,
   কখনো design lock হয়নি, নতুন পূর্ণ discovery session লাগবে।
3. **দুটোই, IWC আগে তারপর Powder** — এক session-এ IWC verify+wiring আগে শেষ করে, তারপর
   Powder-এর fresh discovery শুরু।

## 2. FG STO — current state, open design question (2026-09-27 discussion)

- `SO01Page.jsx`-এ "Create FG STO" tab আজও literal **"Coming Soon" placeholder** —
  কোনো logic নেই (§133.7/§133.9, 2026-08-27/28 থেকে অপরিবর্তিত)।
- **Prothom decision needed:** FG STO কি RM/PM/INT-এর existing CSN→GE→GRN mechanism
  reuse করবে, নাকি নিজের আলাদা, simpler mechanism হবে?
  - RM/PM/INT STO mechanism আজ **fully verified working** (§ Procurement doc দেখো) —
    কিন্তু সেটা purchase/import-tracking-shaped (CSN = Mother/Sub CSN, BOE, vessel, PO
    lineage) — FG STO-র পিছনে কোনো PO/vendor/import নেই।
  - **Claude-এর recommendation (2026-09-27, confirm করা বাকি):** CSN/GE/GRN কিছুই reuse
    না করে, notun unified SO01/DO/PGI pipeline-এর সাথেই মেলানো — sending side একটা
    PGI-shaped stock-OUT (billing/invoice ছাড়া, pure internal), receiving side একটা
    simple direct "Confirm FG STO Receipt" যেটা batch_number+Packing-PO identity carry
    করবে, কোনো GE/weighment/QA ceremony ছাড়া।
  - **এই decision-টা এখনো locked না** — business owner-এর confirm বাকি, Procurement doc
    বন্ধ হওয়ার পরে formally resume হবে।

## 3. MTS Dispatch — open items

1. **IWC (Depot mechanism)** — generic SO01/DO/PGI pipeline দিয়ে কাজ করার কথা, কিন্তু
   কখনো একটা real MTS line দিয়ে end-to-end test হয়নি। **Prod-এ verify করা বাকি** (RM/PM/INT
   STO-র মতোই একটা rolled-back-transaction test, বা real click-through)।
2. **Depot Code Master** — §114.2/114.3-এ discuss করা "reusable Depot/Ship-To Master"
   (একবার Depot Code + address সেভ, পরে dropdown থেকে select) — এখনো build হয়নি বলে মনে
   হচ্ছে, code-এ verify করা বাকি।
3. **Virtual Depot** — Depot Code ↔ Address flexible (one-to-many both ways) mapping —
   design discuss হয়েছে (§114.3), implementation status যাচাই করা বাকি।
4. **Powder "Advance Billing"** — সম্পূর্ণ fresh discovery session লাগবে:
   - Billing = Invoice record (confirmed, §114.6), কিন্তু stock movement/check ছাড়াই।
   - Deferred PGI trigger mechanism (Vehicle Number+Date, বা আলাদা button) — UI চূড়ান্ত
     হয়নি।
   - Stock validation-এর জায়গা (negative stock না হওয়ার guarantee) — অনির্ধারিত।
   - Invoice/DO cancel + SO prune cascade (vehicle না আসলে) — অনির্ধারিত।
5. **Costing/AP-Reco derivation report** — §113.15-addendum অনুযায়ী Dispatch design-এর
   সাথেই একসাথে করতে হবে (আলাদা না) — এখনো build হয়নি।

## 4. SO01 — MTS Excel Upload Design (✅ DESIGN LOCKED + ✅ IMPLEMENTATION COMPLETE —
2026-10-08, business owner)

**Business context:** MTS dispatch-এ এক SO-তে ৪০০-৫০০টা item line আসে — manual row-entry
অবাস্তব। তাই SO01-এ MTS-এর জন্য normal manual entry-র পাশাপাশি একটা **bulk Excel upload
path** যোগ হচ্ছে (RM/PM/INT/অন্য FG type-এর normal manual flow অপরিবর্তিত থাকবে)।

### 4.1 — SO01 Page 2: দুটো নতুন checkbox

Default unchecked, **independent** (একসাথে check করা যায়, কারণ দুজনে দুটো আলাদা অর্থ বহন
করে):

- **Excel Upload** — check করলে নিচের Item Line area সম্পূর্ণ গায়েব হয়ে যায়; SO Create
  করলে সেটা সরাসরি **DRAFT** status-এ তৈরি হবে (কোনো line ছাড়াই, value শূন্য)। Header +
  Bill-To/Ship-To + Payment Terms/Freight অংশ অপরিবর্তিত, শুধু item area বাদ।
- **DD Dispatch** — SO-stage-এ শুধু একটা **flag/marker**, নিজের কোনো কাজ SO-তে নেই। এই
  flag না থাকলে MTS dispatch-এর পরের step (DO/PGI) গুলো করা যাবে না। আসল mechanism
  (deferred Invoice-then-PGI, post-invoice transporter/vehicle change-এর সুযোগ) **পরে
  DO/PGI design session-এ** আসবে, SO01-এর scope-এ শুধু flag store করা। প্রযোজ্য শুধু
  **Dependent(Direct) + MTS** combination-এ — Depot-এ বা MTO/HPS/MTEST-এ (Direct হলেও)
  পুরনো atomic PGI+Invoice rule-ই (§113.15) থাকবে, বদলাবে না। এই matrix-টা আসলে §1.5
  (§114.5)-এর "Direct dispatch-এর দুই আলাদা method" insight-এরই নতুন terminology-তে
  পুনর্নিশ্চিতকরণ:

  | Dispatch Type | Production Type | Behavior |
  |---|---|---|
  | Depot | যেকোনো | অপরিবর্তিত — DO→PGI+Invoice atomic |
  | Direct | MTO/HPS/MTEST | অপরিবর্তিত — atomic, একসাথে |
  | Direct | **MTS** | **নতুন** — Invoice আগে, PGI পরে (truck আসার দিন) |

### 4.2 — "Draft SO and Excel Upload" page (নতুন, SO01-এর বাটন থেকে)

**List scope:** শুধু সেই SO যাদের **Excel Upload flag = true এবং status = DRAFT**।

**Columns (ক্রমানুসারে):** Vendor Code → SO Number → External SO Number → SO Date →
Parent Company → VDC/DC + details → Status (সবসময় DRAFT) → Excel Uploaded (YES/NO) →
Total Number of Items (SKU count) → Total Number of Packs (Pack Qty sum) → Enter SO
(action)।

পুরো list Excel export করা যায়। একই page-এ আলাদা **"Template Download"** বাটন আছে।

### 4.3 — Excel Template (generic/blank, per-SO না)

একটা single template file-এ user একাধিক ভিন্ন SO-র item মিশিয়ে দিতে পারে — Draft SO List
থেকে SO Number/External SO Number cross-reference করে user নিজে প্রতিটা row-এ বসায়।

| Column | Entry type |
|---|---|
| SO Number | manual |
| External SO Number | manual |
| FG Type | dropdown (MTO/HPS/MTEST/MTS) |
| SKU | manual text (dropdown না) |
| HSN | manual যদি Master-এ না থাকে; থাকলে auto-derive হয়ে যায় |
| Pack Qty | manual |
| Rate | manual |
| Rate Basis | dropdown (Pack UoM/Base UoM) |
| GST Treatment | dropdown (Exclusive/Inclusive) |
| GST % | manual |

**বাদ পড়েছে ইচ্ছাকৃতভাবে:** Per Pack (MTS-এ Pack BOM থেকে auto-derive হওয়ার কথা, manual
দেওয়ার দরকার নেই), Stroke Number (MTS-এ প্রযোজ্য না — §83.7/§108-এর batch-blind lock-এর
সাথে সঙ্গতিপূর্ণ), Round Off (template-এ নেই, confirm ধাপে বসে)।

### 4.4 — Upload → কেন্দ্রীয় Review Drawer

**দেখাবে:** uploaded raw data + auto-derived সব column — Document Name, Pack UoM, **real
Base UoM** (hardcoded "KG" না, material-এর আসল base UoM), Base Qty, Amount, CGST/SGST/IGST,
Total Value। **Round Off দেখাবে না।**

**AC05 Rate cross-check (§4.7-এ verify করা AC05 mechanism reuse করে):** Vendor Code + SKU
দিয়ে `erp_production.ac05_mts_sku_rate`-এ lookup করে Outer UoM Rate (effective-dated, SO
date-এর আগে/সমান সবচেয়ে latest row) একটা আলাদা **"AC05 Rate"** column-এ আসবে। Template-এ
টাইপ করা Rate-এর সাথে মিললে green tick; না মিললে দুই rate-এর ঘরেই checkbox, user বেছে
নেবে final rate কোনটা হবে।

**Duplicate detection:** key = **Vendor Code + SKU + Qty + Rate**। মিললে সেই row-জোড়া
**red highlight**, পাশে Remove বাটন। Resolve (remove) না করা পর্যন্ত **Save বাটন
inactive**।

**Stale SO-Number validation (LOCKED 2026-10-08):** প্রতি row-এর **SO Number** আগে
Draft-list-এর বিরুদ্ধে check হবে — user পুরনো download করা template re-use করতে পারে, এর
মধ্যে সেই SO-গুলো অন্য কেউ ইতিমধ্যে confirm করে ফেলতে পারে।
- SO Number আর **Draft status-এ নেই** (already confirmed হয়ে গেছে) → row **skip**, add
  হবে না। **grey/orange highlight**, message: **"SO already confirmed — skipped"**।
  Duplicate-এর মতো Remove বাটন লাগবে না (resolve করার কিছু নেই, এমনিই submit-এ ধরা হবে
  না) — শুধু read-only flag, user দেখবে কেন ওই row বাদ গেল।
- SO Number **ভুল/অস্তিত্বহীন** (typo, কখনো create হয়নি) → একই grey/orange highlight,
  message: **"SO not found — skipped"**।
- এই দুই ধরনের skip **hard block না** — বাকি valid row-গুলো normal-ভাবে submit হবে, user
  চাইলে ঠিক SO Number দিয়ে আলাদাভাবে Add Row করে সেই আইটেম যোগ করতে পারে (batch-এর ভেতরের
  অন্য কোনো valid SO-তে, §4.4-এর "Add Row" নিয়ম মতোই — নতুন SO batch-এর বাইরে যোগ করা
  যাবে না)।

**Row actions:** প্রতি row-এ Remove। **Add Row** দিয়ে নতুন line যোগ করা যায় (manual SO01
item-line-এর সব সুবিধা সহ — §4.9 দেখো), কিন্তু শুধু **এই upload batch-এ already থাকা
SO-গুলোর মধ্যেই** — batch-এর বাইরের নতুন SO যোগ করা যাবে না।

**Submit:** প্রতি row তার নিজের SO-তে allocate হয়; সেই SO-গুলোর **Excel Uploaded = Yes**;
কিন্তু **status তখনো DRAFT-ই থাকে** (auto-confirm হয় না)।

### 4.5 — "Enter SO" → SO01 Page 2 (confirm ধাপ)

Draft SO List থেকে **"Enter SO"**-তে ঢুকলে SO01 Page 2 খোলে — Header fields + দুই checkbox
সব **read-only/locked**। পুরো item list + value/footer area real data দিয়ে populate। User
দরকারে Round Off বসায়, rate review/resolve করে। Save বাটন active হয়, ক্লিক করলে SO
**confirm** হয় (status আর DRAFT থাকে না), Draft SO List থেকে চিরতরে গায়েব।

**Navigation — origin-aware (এই codebase-এর established drill-through/return-to-caller
pattern-এর সাথেই মেলে, নতুন mechanism লাগবে না):**
- Draft SO List → Enter SO → Page 2 → Save → **Draft SO List-এ ফিরে আসে** (পরের SO confirm
  করার জন্য)।
- Normal path দিয়ে (Draft List হয়ে না এসে) Page 2-তে Save করলে → আগের মতোই (SO Detail-এ
  navigate), অপরিবর্তিত।

### 4.6 — FG line: manually enter vs auto-derive (বর্তমান `SO01CreatePage.jsx` থেকে বেসলাইন)

| Manually choose/enter | Auto-derived (readonly) |
|---|---|
| FG Type, SKU, Rate, Rate Basis, GST Treatment, GST %, Round Off | Document Name, Pack UoM, Base Qty (=Pack Qty×Per Pack), Base UoM, Amount, CGST/SGST/IGST, Total Value |
| Stroke Number — শুধু MTO/HPS, **MTS-এ প্রযোজ্য না** | |
| HSN — শুধু manual যদি Master-এ না থাকে, একবার বসালে Master-এ সেভ হয়ে পরে auto-derive হয় | |
| Pack Qty — manual (MTO/HPS/MTS); Per Pack — generic code-এ manual, কিন্তু **MTS-এর জন্য Pack BOM থেকে auto-derive হওয়া উচিত** (বর্তমান কোডে এই special-case শুধু MTEST-এর জন্য আছে, MTS-এর জন্য না — এটা একটা real build-time gap, §4.3-এর template থেকে Per Pack বাদ দেওয়ার কারণও এটাই) | |
| Costing Rate Month — MTS-এ সবসময় hardcoded "Deferred (MTS)", user input না | |

### 4.7 — AC05 (MTS SKU Costing) — verified real/built (২০২৬-১০-০৮, prod DB + code সরাসরি
যাচাই করা, §1.11-এর claim-এর বিপরীতে কিছুটা সংশোধন)

- **Table:** `erp_production.ac05_mts_sku_rate` — prod-এ বাস্তবেই আছে (code: 
  `ac05_mts_sku_rate.handlers.ts`, page: `MtsSkuCostingPage.jsx`)। feasibility doc §142.1-এর
  header "IMPLEMENTATION NOT STARTED" লেখা আছে, এটা **stale** — কোড+DB প্রমাণ দেখাচ্ছে এটা
  build হয়ে গেছে (prod-এ এই মুহূর্তে মাত্র ১টা row — built কিন্তু বাস্তব data-entry প্রায়
  শুরু হয়নি)।
- **Key:** Vendor Code + SKU + Effective Date। তিনটা rate column সম্পূর্ণ independent manual
  entry: `rate_per_base_uom`, `rate_per_inner_pack`, **`rate_per_outer_uom`** (এটাই আমাদের
  "AC05 Rate")।
- **Locked rule (§142.1):** AC05-এর নিজের list page-এ একটা পাশাপাশি calculated/verification
  value-ও দেখায় (AC04 conversion + AC06 RMC/PMC দিয়ে), কিন্তু এটা শুধু sanity-check —
  **SO সবসময় manually-entered Rate per Outer Unit-ই নেয়, calculated value কখনো পড়ে না**।
- **Resolution at SO time:** (Vendor Code, SKU)-এর একাধিক effective-dated row থাকতে পারে
  (append-only, নতুন rate revision = নতুন row)। যে row-এর Effective Date **SO Date-এর আগে
  বা সমান তার মধ্যে সবচেয়ে latest-টাই** ব্যবহার হয়।
- কোনো approval/draft workflow নেই — Save করলেই সরাসরি live (AC06-এর per-row verification
  flow-এর মতো না)।

### 4.8 — DB gap (prod schema সরাসরি verify করা, `erp_procurement.sales_order`) — ✅ FIXED

- `status` CHECK constraint এখন শুধু CREATED/ISSUED/INVOICED/CLOSED/CANCELLED allow করে —
  **`DRAFT` নেই**, migration লাগবে widen করতে। ~~migration লাগবে~~ — **✅ migration
  `20261008100000_so01_excel_upload_draft_flags.sql` দিয়ে `DRAFT` যোগ করা হয়েছে, dev-এ
  apply+reconcile+`NOTIFY pgrst` করা হয়েছে।**
- **Excel Upload flag** column নেই — নতুন column লাগবে। ✅ `is_excel_upload boolean
  NOT NULL DEFAULT false` যোগ করা হয়েছে (একই migration)।
- **DD Dispatch flag** column নেই — নতুন column লাগবে। ✅ `is_dd_dispatch boolean
  NOT NULL DEFAULT false` যোগ করা হয়েছে।
- **Excel Uploaded** tracking (list-এ YES/NO দেখানোর জন্য) — নতুন column/mechanism লাগবে।
  ✅ `excel_uploaded boolean NOT NULL DEFAULT false` যোগ করা হয়েছে — Submit-এ প্রথম সফল
  line allocation-এর পর `true` হয়, status আলাদাভাবে DRAFT-ই থাকে।

### 4.9 — এখনো design হয়নি (পরের ধাপ, এই doc-এর §3-এর সাথে মিলিয়ে)

- **DD Dispatch-এর আসল mechanism** — DO/PGI stage-এ deferred Invoice, post-invoice
  transporter/vehicle change। এটা §3-এর MTS Dispatch open items-এর সাথেই যুক্ত হবে।
  (এই implementation pass-এ শুধু SO01-এ flag store করা হয়েছে, mechanism-টা deliberately
  deferred রাখা হয়েছে, design-এ যেমন ছিল।)
- MTS-এর Per Pack-কে সত্যিই Pack BOM থেকে auto-derive করার backend logic (§4.6-এর gap) —
  এখনো খোলা, এই pass-এর scope-এর বাইরে (Excel Upload template-এ Per Pack নেই বলে, resolved
  SKU-এর material_uom_conversion থেকেই derive হয়, কিন্তু Pack BOM নিজে touch করা হয়নি)।
- Excel upload-এর backend validation/error-reporting granularity — **✅ resolved এই
  implementation-এ**: per-row graceful skip (hard block না) — stale/not-found SO, SKU
  resolve না হওয়া, আর prepareUnifiedSoLine-এর নিজের validation fail (যেমন MTO/HPS-এর
  Costing Rate Month, যা template-এ নেই) — তিনটাই সেই নির্দিষ্ট row skip করে, বাকি batch
  save হয়, user পরে Enter SO/manual entry-তে ঠিক করতে পারে।

### 4.10 — Implementation summary (✅ COMPLETE, 2026-10-08)

**Migration:** `supabase/migrations/20261008100000_so01_excel_upload_draft_flags.sql` —
`sales_order_status_check` widen (DRAFT যোগ) + `is_excel_upload`/`is_dd_dispatch`/
`excel_uploaded` তিনটা boolean column। Dev-এ apply+reconcile (`migration-integrity-check.mjs`
→ `in_sync=true`) + `NOTIFY pgrst, 'reload schema'` করা হয়েছে।

**Backend** (`supabase/functions/api/_core/procurement/sales_order.handlers.ts`):
- `createSalesOrderUnifiedHandler` — `is_excel_upload`/`is_dd_dispatch` body flag; true হলে
  lines-required check skip, status=DRAFT, lines=[] insert skip।
- নতুন `listDraftExcelUploadSalesOrdersHandler` — Draft SO List (§4.2 columns, bulk-resolved
  Vendor Code/Parent Company/VDC-Depot, Total Items/Packs aggregate)।
- নতুন `resolveFgSkuExactMatch()` — Excel row-এর raw SKU text-কে material_id-তে resolve করে,
  `listSalesOrderFgSkuOptionsHandler`-কে in-process black-box হিসেবে reuse করে (duplicate
  না করে) — exact-match ফিল্টার substring-search-এর উপরে বসানো।
- নতুন `reviewExcelUploadBatchHandler` — stateless preview: stale-SO check, SKU resolve,
  AC05 rate cross-check (`resolveAc05RateForMaterial`), GST/amount preview
  (`buildExcelUploadRowPreview`), duplicate detection — কোনো write নেই।
- নতুন `submitExcelUploadBatchHandler` — re-validates সবকিছু server-side, per-SO group করে
  `prepareUnifiedSoLine()`+insert (updateSalesOrderUnifiedHandler-এর "new lines" path-এর
  মতোই), per-row graceful skip, `excel_uploaded=true` flip।
- `updateSalesOrderUnifiedHandler` — নতুন `confirm_draft` body flag (Enter SO Save):
  DRAFT-ই আছে কিনা + ≥1 line আছে কিনা check করে status=CREATED করে। **নতুন route/ACL লাগেনি**
  — existing PUT reuse।
- Routes (`procurement.routes.ts`) + ACL registry (`route-acl-registry.ts`) — ৩টা নতুন route
  (`GET .../draft-excel-upload`, `POST .../excel-upload/review`, `POST .../excel-upload/submit`),
  **প্রতিটাই existing resourceCode/action reuse করে** (`PROC_SO_LIST`/VIEW,
  `PROC_SO_CREATE`/WRITE) — কোনো নতুন ACL resource/capability লাগেনি, business owner-এর
  নির্দেশ অনুযায়ী।

**Frontend:**
- `procurementApi.js` — ৩টা নতুন wrapper (`listDraftExcelUploadSalesOrders`,
  `reviewSoExcelUploadBatch`, `submitSoExcelUploadBatch`)।
- `SO01CreatePage.jsx` — Page 2-এ দুটো checkbox (Excel Upload/DD Dispatch); Excel Upload
  checked হলে Item Line + Totals card গায়েব, zero-line create। নতুন **Enter SO rehydration
  mode** (`getActiveScreenContext()?.enterDraftSoId`) — existing Draft SO হাইড্রেট করে Page 2-এ
  সরাসরি খোলে, header+checkbox লক (disabled/read-only summary), lines real data দিয়ে populate
  (রিয়াল `id` সহ, existing-line edit path দিয়ে), Save → `confirm_draft:true` দিয়ে PUT, origin-aware
  return (DRILL_THROUGH context হলে `popScreen()`)।
- নতুন `DraftSoExcelUploadPage.jsx` — list (ErpDenseGrid, §4.2 columns + Enter SO action),
  Template Download (client-side ExcelJS, dropdown data validation FG Type/Rate Basis/GST
  Treatment), Upload (client-side ExcelJS parse → review API call), Review Drawer
  (center, AC05-rate resolve link, duplicate/stale-SO row highlight, Add Row, Submit)।
- Screen registry (`operationScreens.js`) + route (`AppRouter.jsx`) নতুন
  `PROC_SO_DRAFT_EXCEL_UPLOAD` + SO01Page-এ "Draft SO and Excel Upload" button।

**Verification:** সব ১৬টা `scripts/*-guard.mjs` + `dependency-provisioning-check.mjs
--strict-manifest` (SU24, নতুন page-এর জন্য `PAGE-DEPENDENCY-MANIFEST.json`-এ entry যোগ করা
হয়েছে) + `migration-integrity-check.mjs` (dev, `in_sync=true`) — সব pass। প্রতিটা touched
backend file `deno check` (git-stash before/after zero-new-error প্রমাণ করা হয়েছে), প্রতিটা
touched frontend file `eslint` clean, পুরো frontend `npm run build` সফল।

**এখনো বাকি (deliberately deferred, flagged above):** DD Dispatch-এর আসল DO/PGI mechanism,
MTS Per-Pack-কে Pack BOM থেকে formally auto-derive করা, আর deployed app-এ live click-through
(এই environment-এ dev login নেই)। নতুন gap পাওয়া গেছে, সেটাও pre-existing (এই session-এর নয়):
dev DB-তে `single_machine_auto_allocation`/`mts_urgent_manager_posting` migration file দুটো
remote-এ কখনো apply হয়নি (আগের কোনো concurrent session-এর কাজ) — এই implementation-এর scope-এর
বাইরে, touch করা হয়নি, business owner-কে জানিয়ে দেওয়া হলো।

## 5. Next steps

- [ ] `docs/PROCUREMENT-DESIGN-DOC.md`-এর সব item close হওয়া পর্যন্ত wait — **✅ business
      owner অনুযায়ী এখন সম্পন্ন (2026-10-08), SO01 design এখান থেকেই শুরু হয়েছে**।
- [x] SO01 — MTS Excel Upload Design (§4) — ✅ LOCKED + ✅ IMPLEMENTED 2026-10-08 (§4.10)।
- [x] SO01 Excel Upload — implementation (migration + backend + frontend) — ✅ DONE, §4.10।
- [ ] তারপর: FG STO mechanism decision (§2) confirm করা।
- [ ] তারপর: IWC dispatch-এর real-data verification (§3.1)।
- [ ] তারপর: DD Dispatch-এর আসল DO/PGI mechanism design (§4.9)।
- [ ] তারপর: Powder Advance Billing fresh discovery session (§3.4)।

## 6. SO Map (MTS) — business model discovery session (2026-10-08) —
🔶 আলোচনা চলছে, এখনো LOCKED না

**Context:** SO01 MTS Excel Upload (§4) সম্পূর্ণ হওয়ার পর business owner বললেন "SO MAP-এই
আসল সমস্যা" (real dispatch-mapping mechanism এখনো design-ই হয়নি — §4.9/§5-এর "DD
Dispatch-এর আসল DO/PGI mechanism design" ধাপটাই এখন শুরু হচ্ছে)। এই section সেই আলোচনার
live transcript, ধাপে ধাপে confirm করা হচ্ছে — নিচের প্রতিটা পয়েন্ট ব্যবসার মালিক নিজে
বলেছেন, Claude শুধু restate করে confirm নিয়েছে।

**সূত্র হিসেবে ব্যবহৃত আসল ডেটা:**
- Prod SO `9000000484` (CMP003, External SO Number `0011419953`, `is_excel_upload=true`,
  `is_dd_dispatch=true`, `dispatch_type=DEPENDENT_DIRECT`, bill_to VDC "1661-Asian Paints
  Limited-Kolkatta SO") — ৬টা FG/MTS line, প্রতিটার Pack Qty অনেক বড় (৫০,০০০+ bags)।
- Business owner-এর আপলোড করা আসল Tally sales-register export (`b2ce5fb2-somap.xlsx`,
  4 sheet): **Sheet1** — ৫৪টা real Tax Invoice row, প্রতিটার Buyer সবসময় একই
  ("Asian Paints Limited - Kolkatta SO") কিন্তু Consignee আলাদা আলাদা ছোট dealer/retailer
  (ঠিকানা/transporter/vehicle/bag-count/rate/GST breakup-সহ), সবগুলোরই "Order No." একই
  (`0011419953`) — অর্থাৎ একই SO-র আওতায়। **Sheet4** — সংক্ষিপ্ত রূপ (Invoice No./Date/SKU/
  Qty), মোট ~৮,৩৫০ bags, ৩টা SKU জুড়ে। **Sheet2/Sheet3** — pure SKU name↔code lookup।

**যা এখন পর্যন্ত confirm হয়েছে:**

1. **SO = পুরো মাসের bulk allocation, একবারের dispatch না।** একটা SO তৈরি হলে তার প্রতিটা
   item-এর যে qty থাকে, সেটা পুরো মাস জুড়ে ব্যবহারের জন্য — মাস জুড়ে একই SO থেকে বিভিন্ন
   জায়গায় অল্প অল্প করে dispatch হতে থাকে। এটাই SO-র বড় Pack Qty (৫০,০০০+ bags) বনাম Tally
   Excel-এর ছোট প্রতি-invoice qty (১২৫/২২৫ bags)-এর মধ্যে ফারাকের ব্যাখ্যা — ওটা মাসের
   প্রথম কয়েক দিনের actual dispatch-ই, ভুল data না।

2. **Tally Sheet1-এর "Other References" column (S column)-এর নাম্বারগুলো (সব `5005...` দিয়ে
   শুরু, প্রতি invoice-এ আলাদা) — এটা IBN না, এটা হলো সেই SO-র FO Number।** একটা SO-র
   অধীনে অসংখ্য FO Number থাকতে পারে — প্রতিটা individual dispatch (একটা নির্দিষ্ট dealer-কে
   যাওয়া একটা specific চালান) তার নিজের FO Number বহন করে।
   > ⚠️ **নাম-সংঘর্ষ সতর্কতা:** এই "FO Number" Production module-এর Plan Feed-এর
   > `fo_number` (§83.18, MTO/HPS Admix/Liquid-এর জন্য আলাদা মেকানিজম, `plan_feed` টেবিল)
   > থেকে **সম্পূর্ণ আলাদা জিনিস** — শুধু নামটাই এক। এই নতুন "SO Map FO Number" Sales/
   > Dispatch domain-এর, VDC-scoped, এখনো কোনো নির্দিষ্ট column/টেবিলে map করা হয়নি।

3. **VDC vs DC (Dependent Depot) — দুই আলাদা dispatch mechanism, একই SO থেকেই:**
   - **VDC (Dependent Direct):** প্রতিটা dispatch তার নিজের FO Number বহন করে। এটাই
     **DD Flag**-এর (`sales_order.is_dd_dispatch`) আসল মানে — DD Flag ON থাকলে **Deferred
     PGI flow**: DO + Sales Invoice আগেই তৈরি হয়ে যায়, কিন্তু **PGI (আসল stock movement/
     P601 posting) হয় শুধু physically truck এলে/গেলে** — অর্থাৎ invoice আগেই কাটা যেতে
     পারে, stock posting পরে।
   - **DC (Dependent Depot):** এখানে কোনো FO Number লাগে না। DD Flag এখানে OFF/প্রযোজ্য
     না — **Atomic flow**: DO, PGI, Invoice **তিনটেই একসাথে** হয়ে যায়, কোনো deferred ধাপ
     নেই (এই অংশটা RM/PM/INT-এর জন্য আগে থেকেই তৈরি §113.15-এর
     `createPgiInvoiceHandler`-এর মতোই এক-ধাপ mechanism, নতুন প্যাটার্ন না)।

4. **সিদ্ধান্তকারী switch: `sales_order.is_dd_dispatch` (DD Flag)-ই ঠিক করে দেবে কোন SO
   কোন flow-এ যাবে** — Flag ON = VDC-style Deferred-PGI (FO-number-keyed), Flag OFF =
   DC-style Atomic (FO ছাড়া)।

5. **Ship-To resolution per-FO, per-customer না:** একটা Customer Master record-এর under-এ
   একাধিক Site Address থাকতে পারে (`erp_master.customer_address` — আগে থেকেই আছে, এটাই
   "Site Address" মেকানিজম)। কোনো একটা FO সেই customer-এর Main Address-এ Ship-To হতে পারে,
   আবার অন্য একটা FO (একই customer, একই SO-র আওতায়) তার কোনো একটা Site Address-এ Ship-To
   হতে পারে — অর্থাৎ Ship-To decide হয় **per-dispatch-occasion (per-FO), customer-level fix
   না**।

6. **Excel ↔ Customer Master (MM04) cross-check — real data-quality finding (live DB
   query দিয়ে verify করা):** Tally Excel-এর ৫০টা distinct Consignee নামের মধ্যে CMP003-এর
   Customer Master-এ মাত্র ২১টা নাম কোনো না কোনো রূপে পাওয়া গেছে — **২৯টা একদমই নেই**।
   পাওয়া ২১টার মধ্যে ৪টা name-group-এর একাধিক `customer_master` record একই নামে আছে — তাদের
   address মিলিয়ে দেখা গেছে একটা (KUNDU PAINT HOUSE) সত্যিই duplicate (একই Site Address —
   "Shriram Grand City", শুধু billing-address সম্পূর্ণতা/GST আলাদা), কিন্তু বাকি তিনটা
   (MA LAXMI TRADERS, MAA TRADERS, MONDAL PAINTS) **সম্পূর্ণ ভিন্ন real business, শুধু নাম
   মিলে গেছে** (billing address/district/GST number আলাদা)। সিদ্ধান্ত: শুধু নাম মিলিয়ে
   customer resolve করা অনিরাপদ — true duplicate আর coincidental name-collision দুটোই
   একসাথে বাস্তবে আছে, আর এই ৪টা example দেখেই বোঝা যায় পুরো customer base-এ এই রকম case
   "প্রচুর" (business owner-এর নিজের শব্দ) থাকবে।

7. **আসল challenge, SO Map-এর সবচেয়ে বড় সমস্যা (business owner-এর নিজের ভাষায়, ৩টা
   scenario):**
   - যাদের GST আছে তাদের কোনো সমস্যা নেই — GST দিয়ে direct resolve।
   - কিন্তু Asian-এর export-এ সব customer-এর GST থাকে না।
   - MM04-এর পুরো customer list user-কে download করিয়ে, SO Map upload Excel তৈরি করার সময়
     row-ধরে-row সঠিক customer/site address manually বসানো **practically impossible** —
     কারণ upload Excel-এ row count ৫০০+ পর্যন্ত হতে পারে।

8. **SO Map Excel Template — basic shape (business owner-এর প্রস্তাব):**

   **Template columns:** External SO Number, FO Number, Customer GST, Customer Name,
   Customer Address, Has Site (Yes/No), SKU, Pack Qty।

   - **External SO Number** → PACE-এর SO resolve হয়ে যাবে।
   - **FO Number** → as-is capture (কোথায় store হবে এখনো খোলা, নিচে দেখো)।
   - **SKU, Pack Qty** → সরাসরি column থেকেই নেওয়া, কোনো resolution লাগে না।
   - Customer + Site Address resolution-এর পূর্ণ mechanism point ৯-এ।

9. **Customer + Site Address Resolution — পূর্ণ mechanism (এই session-এ step-by-step
   confirm হয়েছে, এখনো formally document-level LOCKED না কিন্তু প্রতিটা অংশ business
   owner নিজে confirm করেছেন):**

   **MM04-এর real mechanism ground-truth (live code verify করে নিশ্চিত হয়েছে, এই design
   সেগুলোর উপরেই বসছে, নতুন কিছু বানাতে হচ্ছে না):**
   - **"Check GST" (Applyflow)** — `lookupCustomerGstProfileHandler` → `resolveGstProfileWithSource()`
     → Applyflow API (cache-first, `erp_cache.gst_profiles`) থেকে real legal_name + state +
     full_address + pin_code নিয়ে আসে।
   - **Duplicate-detect (§132.8)** — `findCustomerByGstHandler` নতুন create করার আগে সেই GST
     দিয়ে আমাদের নিজের `customer_master`-এ (সব company জুড়ে) আগে থেকেই কোনো record আছে কিনা
     check করে।
   - **Customer create (`createCustomerHandler`)** mandatory fields: customer_name,
     customer_type, delivery_address, billing_state, site_name (প্রথম address-এর জন্য),
     company_id। Create atomic-ভাবে ৩টা row বসায়: `customer_master` + `customer_company_map`
     + প্রথম `customer_address`। Status সরাসরি `ACTIVE`/approved — আলাদা approval ধাপ নেই।
   - **Site Address create (`createCustomerAddressHandler`)** mandatory fields: site_name,
     address_line, **town** (mandatory, optional না), pin_code (optional)। **state স্বাধীনভাবে
     দেওয়া যায় না — এটা সবসময় customer-এর নিজের billing_state-এর সাথে lock থাকে** (mismatch
     হলে reject করে)।
   - **VDC mapping** customer_master-এ নেই — এটা `customer_address.depot_code_id` column-এ
     বসে (site-level), একটা আলাদা update call দিয়ে (`updateCustomerAddressHandler`/
     `bulkMapCustomerAddressesHandler`) — create করার সাথে সাথেই এটা chain করে সেট করতে হবে,
     user-কে আলাদা করে জিজ্ঞেস করতে হবে না (SO-র নিজের VDC তো আগে থেকেই জানা)।

   **Customer resolution flow:**
   - **GST দেওয়া থাকলে:**
     - GST দিয়ে customer + address system resolve করবে, **শুধু সেই SO-র VDC-র under-এই**
       (global search না)। অন্য VDC-তে match হলে — **"GST matched but in Different VDC"**
       আলাদা error state, resolution: GST ঠিক করা বা line remove করা।
     - GST দেওয়া আছে কিন্তু কোথাও MM04-এ নেই → system GST দিয়েই সরাসরি **auto-create** করে
       দেবে (Create button/click), user-কে কিছু করতে হবে না। একই Excel batch-এ একই GST-র
       আরও row থাকলে সেগুলোতেও auto বসে যাবে।
     - **Name-mismatch caveat:** GST lookup-এর `legal_name` সরাসরি customer_name হিসেবে
       বসবে না (proprietorship-এ GST legal_name = প্রোপ্রাইটরের ব্যক্তিগত নাম, দোকানের নাম না)
       — customer_name আসবে Excel-এর নিজের Customer Name column থেকে। GST থেকে আসবে শুধু
       **state/address/pin_code**।
   - **GST না থাকলে — "Create" click করলে center drawer খুলবে (manual mechanism নেই, GST
     case-এর মতোই button/click-ভিত্তিক):**
     - প্রথমে Customer Name দিয়ে existing MM04-তে খোঁজা হয়, **শুধু সেই SO-র VDC-র under-এই**
       (GST-case-এর মতোই VDC-scoped — অন্য VDC-তে একই নামের customer থাকলেও সেটা ধরা পড়বে
       না/দেখাবে না, "কোনো match নেই" ধরে নেওয়া হবে)।
       - একটাই match → direct resolve।
       - একাধিক match (ambiguous) → **"Choose from N"** list — প্রতিটা candidate-এর পাশে
         তার **Address/Town** দেখাবে (শুধু নাম না — একই নামে ভিন্ন real business থাকতে পারে,
         §6 point ৬-এ confirm করা বাস্তব finding), আর Excel row-এর নিজের Customer Address-ও
         পাশে দেখাবে, যাতে user মিলিয়ে বুঝতে পারে। list-এর নিচে **"None of these — Create
         New"** escape hatch থাকবে।
       - কোনো match নেই → সরাসরি Create New drawer।
     - **Create New drawer-এর field:**
       - Customer Name, Customer Address — Excel row থেকে prefilled (editable)।
       - **Billing State** — VDC-র নিজের state থেকে auto (manual input লাগবে না)।
       - Site Name — "Same as Customer" (Customer Name reuse)।
       - **Town, Pin Code** — manual (Excel-এ নেই, এটাই একমাত্র real manual touch-point)।
       - GST Category — default UNREGISTERED।
       - Company, VDC — পুরোপুরি automatic (SO থেকে জানা), দেখানোরও দরকার নেই।
       - একই drawer-এর ভেতরেই **"Add Site Address"** button থাকবে, চাইলে সেখানেই আরও site
         যুক্ত করা যাবে।
     - **Dedup/reuse (business owner confirmed, Claude-suggestion নয়):** এই customer তৈরি
       হওয়ার পর একই upload batch-এ অন্য কোনো row-এ **ঠিক একই Company + Address Line** থাকলে
       সেখানেও এই customer+site automatic বসে যাবে — আবার নতুন করে create করতে হবে না।

   **Site Address resolution (Has Site = Yes marked line-গুলোতেই, No হলে প্রযোজ্য না):**
   - resolved customer-এর under-এ কতগুলো Site Address আছে (N) — এই count Customer column-এর
     পাশে দেখাবে, প্রতিটা Yes-marked line-এ।
   - N=1 → auto-select, পাশে "Add" option (ভুল হলে নতুন লাগাতে)।
   - N>1 → **"Choose from N sites"** — Customer-এর মতোই প্রতিটা candidate-এর Address/Town
     সহ, Excel row-এর address-এর পাশে।
   - N=0 (কোনো Site Address নেই) অথবা N candidate-এর কোনোটাই match না হলে → একই
     **"Add Site Address"** drawer: "Same as Customer" checkbox (টিক দিলে Site Name +
     Address Line auto), Town + Pin Code manual, State auto (customer/VDC-র state)।
   - Add করলে সেটা **সরাসরি সেই row-এ বসে যায়** — আলাদা করে আবার "choose" করতে হয় না।
   - **Dedup + per-row override:** একই Customer + একই Site একাধিক row-এ থাকলে একবার resolve
     হলে বাকি row-এও auto বসে যায়, কিন্তু প্রতিটা row individually **"Change"** করা যায় — Change
     click করলে একই detail-rich (Address/Town সহ) list drawer খোলে, Customer-choose আর
     Site-choose দুটোর জন্যই একই pattern/component reuse হয়।

   **নিশ্চিত করা হয়েছে — MM04 visit লাগবে না:** পুরো mechanism (GST auto-create, Choose-from-N,
   Create New drawer, Add Site Address) SO Map-এর Review screen-এর ভিতরেই ঘটে, আলাদা পেজে
   navigate করতে হয় না। আর এটা আলাদা কোনো shadow table নয় — সরাসরি MM04-এর নিজের
   `customer_master`/`customer_address` টেবিলেই লেখে, status ACTIVE/approved — তাই তৈরি হওয়া
   সাথে সাথেই MM04-এ গিয়ে দেখলে একই data পাওয়া যাবে।

10. **এই পুরো SO Map Excel Template/Upload mechanism শুধু VDC (Dependent Direct)-এর জন্য —
    DC (Dependent Depot)-এর আলাদা কিছু লাগে না।** যুক্তি: DC-এর কোনো FO Number নেই, flow-টাই
    Atomic (DO+PGI+Invoice একসাথে, §113.15-এর RM/PM/INT-এর জন্য আগে তৈরি mechanism-এর মতোই)
    — সেখানে কোনো bulk Excel reconciliation-এর প্রয়োজনই নেই, existing direct DO+PGI+Invoice
    creation screen-ই যথেষ্ট। SO Map/Bulk-DD-SO-Map button + template শুধু VDC flow-এর জন্য,
    যেখানে মাসে অসংখ্য ছোট FO-level dispatch Asian-এর Tally export থেকে bulk-এ আনতে হয়।

11. **Button + Upload + Review Grid — পূর্ণ consolidated flow:**
    - **SO01 → SO Map tab** → **"Bulk DD SO Map"** button → Template Download + Upload, দুই
      option।
    - Template-এর column আর তাদের resolution (point ৮-৯-এ confirm হওয়া সব একসাথে): External
      SO Number (→ PACE SO + তার VDC resolve), FO Number (as-is capture), Customer GST/Name/
      Address (→ point ৯-এর পূর্ণ Customer+Site resolution mechanism), Has Site (Yes/No),
      SKU, Pack Qty।
    - Upload-পরবর্তী **ERP Dense Grid Review page**-এ যা দেখাবে: **SO Number** (resolved),
      **SKU → document_name** (resolved), একটা **"DD Flagged" (Yes/No)** column (সেই SO
      আসলেই DD/VDC-type কিনা confirm), তারপর Customer+Site resolution-এর পূর্ণ UI (inline
      choose/create drawer), সব শেষে নিচে **Save** button। Save করলে সব FO সেই SO-র সাথে
      mapped হয়ে যায়।

12. **Upload Validation mechanism (সম্পূর্ণ confirm হয়েছে):**
    - **Duplicate key = (External SO + FO Number + SKU), Pack Qty দিয়ে compare:**
      - আগের কোনো upload-এ একই key-তে একই Pack Qty থাকলে → plain Duplicate, auto-skip।
      - একই key-তে **ভিন্ন Pack Qty** থাকলে (Asian Paints পরে data revise করে পাঠানোর real
        case) → সেই row **highlighted/coloured**, নতুন qty দেখাবে, পাশে per-row **Confirm**
        button — Confirm করলে পুরনো qty overwrite হয়ে যাবে, ভুল মনে হলে user row remove
        করবে। যতক্ষণ Confirm/Remove না হয়, পুরো **Save button inactive** থাকবে।
      - Wrong/invalid row স্বাভাবিকভাবেই skip হবে।
    - **SKU সেই SO-র নিজের line-list-এর বাইরে হলে** → সেই row highlight হবে, user-কে এই
      page-এই SKU ঠিক করতে হবে — সেই row-এর SKU field-এ একটা **auto-suggest dropdown**
      (সেই SO-র নিজের SKU-গুলো থেকেই) থাকবে।
    - **Qty-vs-Balance hard check** — একটা SKU-র জন্য সব FO row-এর Pack Qty-র sum সেই SKU-র
      **SO-তে অবশিষ্ট balance qty**-কে (ordered qty বাদে আগের dispatch) ছাড়িয়ে যেতে পারবে না —
      এটা soft warning না, hard validation (নিচের "partial consumption tracking" open item
      এটা দিয়েই resolve হয়ে গেছে)।

13. **DO + Invoicing + PGI header fields — business rule (confirm হয়েছে):**
    - **Transporter, LR Number, Invoice Number, Truck Number — DC আর VDC দুটোতেই DO
      create/Invoice post/PGI-এর পরেও change করা যাবে** (header-level edit option লাগবে,
      live code-এ ইতিমধ্যে existing `PROC_DO_EDIT` screen আছে — এটা extend করতে হবে)।
    - **VDC (DD):** DO+Invoice তৈরির সময় Transporter+LR Number জানা থাকে, কিন্তু **Truck
      Number তখনো দেওয়া হয় না** — truck physically এলে Truck Number + Dispatch Date দেওয়া
      হয়, **সেই date-এই PGI post হয়** (এটাই আগের "truck এলো" trigger mechanism-এর উত্তর)।
    - **DC:** Invoice date আর PGI date same/atomic — existing §113.15 design অপরিবর্তিত।
    - **PGI post হওয়ার পূর্ণ শর্ত (VDC):** Transporter + LR Number + LR Date + Truck Number +
      Dispatch Date — এই **পাঁচটাই** পূর্ণ হতে হবে, শুধু Dispatch Date একা দেখেই PGI post হবে
      না।

14. **Bulk DO Upload — SO03 (Delivery Order list)-এ button, দুই dispatch-type-ই একসাথে
    সামলায়:**
    - **একটাই template**, একটা column (FO/SO Number) দুই রকম value নিতে পারে:
      - **VDC row-এ সবসময় FO Number** — SO Map থেকে আগেই resolve হওয়া SO/Customer/
        Ship-To/SKU/Qty এখান থেকেই টানবে।
      - **DC row-এ SO Number** — DC-তে আলাদা Customer/Site resolve লাগে না, কারণ **DC নিজেই
        Bill-To/Ship-To** (সেই depot company নিজেই); সরাসরি SO resolve করবে।
      - Upload-এর পরে system যদি দেখে mismatch হয়েছে (যেমন VDC-এর SO Number ভুলে FO
        Number-এর জায়গায় বসানো হয়েছে, বা উল্টো) → সেই row **skip**, error দেখিয়ে আবার upload
        করতে বলবে।
    - **Template columns (সবগুলোর জন্য common):** FO/SO Number, DO Date, Transporter, LR
      Number, LR Date, SKU, Pack Qty, Tally Invoice Number, Tally Invoice Date, Inbound
      Number, Truck Number, Dispatch Date।
    - **Field split — কে কোথায় ব্যবহার হবে:**
      - **DO নিজের জন্য:** FO/SO Number (resolve), DO Date, Transporter (resolve), LR
        Number, LR Date, SKU, Pack Qty।
      - **DO page-এ লাগে না, কিন্তু preserve হবে SO02 (PGI+Invoice)-এর জন্য:** Tally Invoice
        Number, Tally Invoice Date, Inbound Number, Truck Number, Dispatch Date — এখনই
        capture হবে, পরে SO02-তে গেলে prefilled পাওয়া যাবে।
      - **Truck Number/Dispatch Date independently optional** — বাস্তব data-তে (Asian-এর
        Excel-এ verify করা) অনেক row-এ Truck Number আছে কিন্তু Date নেই — upload-এর সময় Date
        blank থাকলে blank-ই থাকবে, Truck Number থাকলে সেটা preserve হবে, একটা থাকলে
        অন্যটার জন্য wait করতে হবে না।
    - **Review grid:** একটা **"DD Flagged" (Yes/No)** column দেখাবে প্রতিটা row আসলে VDC/DD
      নাকি DC-type।
    - **Transporter resolution** — Customer/Site-এর মতোই পূর্ণ mechanism: existing
      Transporter Master-এর বিরুদ্ধে name-similarity match, single/ambiguous
      (Choose-from-N)/no-match (Create-New drawer) — manual text বসালে সরাসরি accept হবে
      না।

15. **Bulk DO Upload-এর validation (সম্পূর্ণ confirm হয়েছে):**
    - **Format-level:** mandatory blank না — FO/SO Number, DO Date, Transporter, LR Number,
      LR Date, SKU, Pack Qty। (Truck Number, Dispatch Date, Tally Invoice Number/Date,
      Inbound Number optional)। Pack Qty বৈধ positive number, Date column বৈধ date format।
    - **FO/SO Number type-check** — VDC→FO/DC→SO mismatch হলে row skip, re-upload করতে
      হবে।
    - **FO Number** আগে SO Map-এ resolve/mapped হয়ে থাকতেই হবে, না থাকলে error, skip।
    - **SKU/Pack Qty consistency** — FO/SO-র জন্য আগেই resolve হয়ে থাকা SKU/qty-র সাথে
      মিলতে হবে, না মিললে highlight + auto-suggest dropdown (SO Map-এর একই pattern)।
    - **Duplicate key = (FO/SO Number + SKU):**
      - সব field অপরিবর্তিত থাকলে → plain Duplicate, auto-skip।
      - কোনো field-এ **আগে blank ছিল, এখন value এসেছে** (Truck Number/Dispatch Date-এর
        মতো) → row highlighted, per-row **Confirm** (overwrite) / Remove, যতক্ষণ না হয়
        **Save button inactive**।
      - কোনো field-এ **আগে থেকেই value ছিল, এখন ভিন্ন value এসেছে** (true correction) →
        bulk upload দিয়ে overwrite হবে না — শুধু note/flag দেখাবে, user-কে সেই correction
        **DO-র single-row Edit screen থেকেই** করতে হবে।
    - **একটা FO-তে multiple SKU/item** — (FO/SO + SKU) key-এর কারণে স্বাভাবিকভাবেই সাপোর্ট
      করে, প্রতিটা আলাদা row/line হিসেবে independently resolve/validate হয়।

16. **DO Edit — "Edit Transporter Details" mechanism (SO03):**
    - লাইভ কোড-এ `DO01CreatePage.jsx` Edit mode (`isEditMode`/`editDcId`) আগে থেকেই আছে,
      Vehicle Number/Transporter (TransporterPicker — Transporter Master-এর বিরুদ্ধে
      search/pick + নতুন add)/LR Number/LR Date editable — কিন্তু Dispatch Date নেই, আর
      PGI-trigger logic wired নেই।
    - **নতুন mechanism:** SO03-এ **"Edit Transporter Details"** button → click করলে user-কে
      **FO Number** দিতে হবে → সেই FO-র under-এ Transporter, LR Number, LR Date, Truck
      Number, Dispatch Date — এই পাঁচটা field খুলবে → edit করে Save করলেই update হয়ে যাবে।
      এই page শুধু data update করে — **PGI trigger এখানে fire হয় না**, সেটা SO02-এর Bulk
      Posting action-এ হয় (point ১৭)।

17. **SO02 — Bulk Posting page (PGI + Invoice-এর পূর্ণ consolidated design):**
    - এই table **শুধু সেই DO-গুলোই দেখাবে যারা Bulk DO Upload (SO03) দিয়ে তৈরি হয়েছে** — SO03-এ
      Excel upload + Save করলে DO তৈরি হয় (status CREATED), সেই DO-গুলোই এখানে আসে — ঠিক
      existing SO02-এর DO-wise list/"Prepare Invoices" pattern-এরই bulk-select সংস্করণ।
    - উপরে Company resolve, তারপর ERP Dense Grid (Excel-style navigation+filter)।
    - **Column order (left থেকে):** select checkbox (+ header "Select All") → **DD Flag**
      (Yes/No, সবচেয়ে left-এ, VDC/DC কোনটা বোঝানোর জন্য) → SO Number → FO Number → External
      SO Number → Company Code → Vendor Code → SKU → Pack Qty → Base Qty → Tally Invoice
      Number → Tally Invoice Date → Inbound Number → Rate → GST Split → Value → Round Off →
      Parent Company → Bill To → Ship To → Transporter → LR Number → LR Date → Truck Number
      → Dispatch Date।
    - প্রতিটা row-এ checkbox, উপরে **Bulk Post** button — mixed selection (VDC+DC একসাথে)
      handle করবে:
      - **DD/VDC row** → শুধু **Invoice** post হবে (PGI deferred, Truck/Dispatch Date পরে
        আসবে)।
      - **DC row** → **PGI + Invoice দুটোই একসাথে** post হবে (atomic, §113.15 pattern)।
    - Posting হওয়ার পূর্বশর্ত (point ১৩-এর পাঁচটা field পূর্ণ) এখানেও প্রযোজ্য — অসম্পূর্ণ
      row Bulk Post দিয়ে post হবে না।

**এখনো খোলা (পরের point-এ আলোচনা চলবে):**
- FO Number আসলে কোথায় capture/store হবে (নতুন column? কোন table — SO line-level না
  DO-level?), আর SO Map UI-তে কীভাবে ঢোকানো হবে।
- Tally Excel-এর বাকি column-গুলোর (Port/Destination ইত্যাদি) PACE-এ কোথায় bosbe সেটা এখনো
  আলোচনা হয়নি।
- Customer+Site+Transporter resolution mechanism (point ৯, ১৪) এখনো শুধু
  **conversation-level confirm** — কোনো backend/frontend implementation শুরু হয়নি, আর
  document হিসেবেও formally LOCKED ঘোষণা করা হয়নি।
- পরের point: Truck Number + Dispatch Date-এর own bulk-entry/trigger mechanism — আলোচনা
  শুরু হচ্ছে।
