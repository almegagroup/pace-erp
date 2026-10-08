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

## 4. SO01 — MTS Excel Upload Design (✅ DESIGN LOCKED — 2026-10-08, business owner,
IMPLEMENTATION NOT STARTED)

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

### 4.8 — DB gap (prod schema সরাসরি verify করা, `erp_procurement.sales_order`)

- `status` CHECK constraint এখন শুধু CREATED/ISSUED/INVOICED/CLOSED/CANCELLED allow করে —
  **`DRAFT` নেই**, migration লাগবে widen করতে।
- **Excel Upload flag** column নেই — নতুন column লাগবে।
- **DD Dispatch flag** column নেই — নতুন column লাগবে।
- **Excel Uploaded** tracking (list-এ YES/NO দেখানোর জন্য) — নতুন column/mechanism লাগবে।

### 4.9 — এখনো design হয়নি (পরের ধাপ, এই doc-এর §3-এর সাথে মিলিয়ে)

- **DD Dispatch-এর আসল mechanism** — DO/PGI stage-এ deferred Invoice, post-invoice
  transporter/vehicle change। এটা §3-এর MTS Dispatch open items-এর সাথেই যুক্ত হবে।
- MTS-এর Per Pack-কে সত্যিই Pack BOM থেকে auto-derive করার backend logic (§4.6-এর gap)।
- Excel upload-এর ঠিক backend validation/error-reporting mechanism (ভুল SKU হলে সম্পূর্ণ
  block, নাকি শুধু সেই row flag — এখনো আলোচনা হয়নি)।

## 5. Next steps

- [ ] `docs/PROCUREMENT-DESIGN-DOC.md`-এর সব item close হওয়া পর্যন্ত wait — **✅ business
      owner অনুযায়ী এখন সম্পন্ন (2026-10-08), SO01 design এখান থেকেই শুরু হয়েছে**।
- [x] SO01 — MTS Excel Upload Design (§4) — ✅ LOCKED 2026-10-08, implementation বাকি।
- [ ] SO01 Excel Upload — implementation (migration + backend + frontend)।
- [ ] তারপর: FG STO mechanism decision (§2) confirm করা।
- [ ] তারপর: IWC dispatch-এর real-data verification (§3.1)।
- [ ] তারপর: DD Dispatch-এর আসল DO/PGI mechanism design (§4.9)।
- [ ] তারপর: Powder Advance Billing fresh discovery session (§3.4)।
