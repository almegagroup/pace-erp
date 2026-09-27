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

## 4. Next steps

- [ ] `docs/PROCUREMENT-DESIGN-DOC.md`-এর সব item close হওয়া পর্যন্ত wait।
- [ ] তারপর প্রথমে: FG STO mechanism decision (§2) confirm করা।
- [ ] তারপর: IWC dispatch-এর real-data verification (§3.1)।
- [ ] তারপর: Powder Advance Billing fresh discovery session (§3.4)।
