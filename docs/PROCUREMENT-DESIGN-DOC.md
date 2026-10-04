# Procurement (L2) — Design & Status Document

**Started:** 2026-09-27
**Purpose:** এই doc-টা Procurement module-এর (PO → CSN → Gate Entry → GRN → Inward QA →
STO → RTV → Invoice) **সম্পূর্ণ, verified, done** state-এ নিয়ে যাওয়ার জন্য কাজের তালিকা এবং
running status। এটা master feasibility doc
(`docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`)-কে
replace করে না — সেটাই SSOT, বিস্তারিত design decision-এর জন্য সবসময় সেটাই refer করতে হবে।
এই doc শুধু "Procurement সম্পূর্ণ করার" কাজটাকে trackable রাখার জন্য — কোনটা DONE, কোনটা
OPEN, কোনটা এখনো design-ই হয়নি, সেটা এক জায়গায়।

**Sequencing context (business owner, 2026-09-27):** Dispatch/FG-STO/MTS-Dispatch design
শুরু করার **আগে** পুরো Procurement module design + implement সম্পূর্ণ করা হবে। এটা
2026-09-22-এর আগের lock ("Dispatch for MTS আগে, তারপর Inward for Bulk") থেকে **আলাদা,
নতুন সিদ্ধান্ত** — business owner explicitly এই নতুন order confirm করেছেন। FG STO +
MTS Dispatch-এর নিজস্ব doc আলাদা: `docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md` — সেটা এই
doc সম্পূর্ণ হওয়ার পরেই শুরু হবে।

---

## 1. Status Inventory (evidence-based, 2026-09-27 হিসাবে)

| Area | Status | Evidence / Gap |
|---|---|---|
| **PO (Purchase Order)** | ✅ Done, mature | Gate-13.2/16/17, one-material-per-PO (§87.12A), amendment/approval workflow live, prod-verified extensively. |
| **CSN (Consignment Note)** | ✅ Done, mature | Mother/Sub CSN, distribution scenarios, CSN Tracker — §88/89/90/91, prod-verified. Recent fixes: GRN→CSN invoice_date sync, Domestic Transporter column, GED/GRD relax (2026-08-12/13 session). |
| **Gate Entry (GE)** | ✅ Core done, ⚠️ 1 known gap | Multi-line design (§88.1), PO+STO both supported. **Gap:** CSN-picker drawer doesn't exclude already-picked lines across rows in the same GE — a user could accidentally select the same STO line twice. Not yet fixed (flagged 2026-09-27, business owner hasn't confirmed priority). |
| **GRN** | ✅ Done, mature | Per-line GRN redesign (2026-07-08), AC01 Landed Cost Hub (2026-08-21), HSN/Last-Mile-Transporter. Prod-verified extensively via real GRNs (CMP006 alone has 88). |
| **STO — Sending side** | ✅ Done + verified 2026-09-27 | Sep 11 rewrite (`create_sto_atomic`/`transition_sto_atomic`/`save_delivery_order_unified_atomic`/`post_sales_invoice_groups_atomic`), both INTER_PLANT and CONSIGNMENT_DISTRIBUTION types. |
| **STO — Receiving side (GE+GRN+Confirm+Close)** | ✅ Done + verified 2026-09-27 | **Real bug found and fixed today**: `guard_sto_line_change()` trigger (added 2026-09-11) blocked every real GRN receipt because it guarded `line_status` — the exact field `updateStoLineReceipt()` needs to flip OPEN→RECEIVED — against any change while a DO exists, and a DO is *always* active by the time GRN happens. Fixed via migration `20260927120000_fix_sto_line_guard_receipt_status.sql` (Dev+Prod applied, migration-integrity confirmed both in_sync). Full send→receive→close cycle verified end-to-end against real Prod data (CMP003→CMP006), both STO types, in a rolled-back transaction — zero residue. |
| **Inward QA (RM/PM, post-GRN)** | 🔶 ~90% built, "redesign" flagged but **undefined scope** | Full usage-decision flow (RELEASE/BLOCK/REJECT/FOR_REPROCESS) exists and works (§101, Gate-13.6). A 2026-09-22 note calls a future "Inward QA redesign" **DEFERRED** but never specifies what that redesign actually covers — no spec exists yet. **This needs a discovery session before it can be scoped**, not blind implementation. |
| **RTV (Return to Vendor)** | 🔶 Built, ⚠️ zero real Prod usage | Gate-13.8, P651-family movement types NOT this (that's customer-return, different — see below). Code complete (`rtv.handlers.ts`) but 0 real rows in Prod ever — see §2.3/§4.6. |
| **Debit Note / Exchange (PO10)** | 🔶 Built, ⚠️ zero real Prod usage | Gate-13.8, Gate-21 (missing FE pages built), AC01 hub integration. 0 real rows in Prod ever — see §2.3/§4.6. |
| **PTO / Plant Transfer Order (PO12)** | 🔶 Built, ⚠️ zero real Prod usage, own Layer (L6) only 57% designed, **decision locked: finish, not retire; actual redesign still open** | Separate mechanism from STO (SAP MB1B-equivalent vs STO's ME21N-equivalent) — see §2.4/§4.5. Redesign scope now includes CRCP cross-company movement tracking (§3.2.6), but deliberately sequenced *after* the CSN phase (§3.2.3-3.2.5) — see build sequence in §3.7. |
| **CRCP — Cross-Company Material Movement + Bulk invoicing (new discovery)** | 🟡 Discovery complete (6/6 scenarios); Bulk-invoicing track (Track 2) mechanism **locked** (Points 3.5.2/3.5.3/3.5.6/3.5.7/3.5.8 — "Bulk Cost Component Mapper"); CRCP track (Track 1, Points 3.2.x/3.3/3.4.x) mechanism still open | Business-owner scenario walkthrough (2026-09-27) — see §3, closed. See §3.7 for the point-by-point Design Lock Tracker and the two-track Recommended Build Sequence. See §4.7 — largest single item in this doc; Track 2 is ready for Page/BE/DB design, Track 1 needs its mechanism locked point-by-point first. |
| **Invoice Verification** | 🔶 ~35% (stale figure, needs re-check) | Layer table (CLAUDE.md §9) flags this as a known gap — "basic shell বানাও, detail পরে fill করো" was the original plan. Needs a fresh audit against current code before trusting the old 35% number; a lot has been built around it since (AC01 Landed Cost Hub) that may have absorbed part of this scope. |
| **Procurement Planning (Powder)** | 🔶 ~30% (stale figure, needs re-check) | Same layer-table flag — "UI বানাও, formula পরে". PO11 (Procurement Planning Workspace, 2026-08-08 onward) may have superseded/absorbed much of this — needs verification, not a blind rebuild. |
| **LC / Vessel Booking / Import tracking** | ✅ Done | §90, PO/CSN extended tracking fields, live in CSN Tracker. |
| **Landed Cost (AC01)** | ✅ Done | Full hub, 2026-08-21+, GST/party-payable/considered-qty all built. |

---

## 2. Mechanism Inventory — PO, STO, PO10 (Exchange Reference) (2026-09-27)

Business owner asked for every mechanism under these three, as they currently exist in
code, gathered in one place.

### 2.1 PO (Purchase Order)

**Classification dimensions** (not a single "type" field — several independent axes):

| Dimension | Values | Effect |
|---|---|---|
| Vendor Type | `DOMESTIC` / `IMPORT` | Gates whether import-only fields apply |
| Delivery Type | `STANDARD` / `BULK` / `TANKER` | **Corrected 2026-09-27 (was wrong — see §3.3):** `BULK` skips CSN creation entirely (`createCsnsForPo` returns immediately, `po.handlers.ts:934-936`); `TANKER` still creates a normal CSN via the same path as `STANDARD` (`deriveCsnType` only ever returns `IMPORT`/`DOMESTIC`, never `BULK` — the `csn_type='BULK'` enum value's real origin is unconfirmed, likely unused/legacy). Both `BULK` and `TANKER` require `gross_weight` at Gate Entry (`BULK_DELIVERY_TYPES` set in `gate_entry.handlers.ts`) — the weighment mechanism itself (`gross_weight` → `net_weight_from_weighbridge` → `received_qty`) is separate from CSN creation. |
| Import Trade Type (IMPORT-only) | `DIRECT_IMPORT` / `HIGH_SEA_SALE` / `BONDED_WAREHOUSE` / `EPCG_ADVANCE_AUTH` | |
| Shipment Mode (IMPORT-only) | `FCL` / `LCL` / `AIR` / `COURIER` | |
| Customs Movement Type (IMPORT-only) | `DPD` / `CFS` / `ICD` | |
| Freight Term | `FOR` / `FREIGHT_SEPARATE` / `FREIGHT_AT_ACTUALS` / `EX_TRANSPORTER_GODOWN` | Commercial responsibility for freight |
| GST Terms | `INCLUSIVE` / `EXCLUSIVE` | |
| `is_opening_po` flag | boolean | Marks go-live/legacy manual entries — allows duplicate `po_number` (old practice used one number across materials; PACE is one-material-per-PO since §87.12A) |
| `order_group_id` | → `po_order_group` | Internal-only batch-approval grouping when several materials are raised together for one vendor; never shown to the vendor, each PO keeps its own number |

**Lifecycle (status):** `DRAFT → PENDING_APPROVAL → APPROVED → CONFIRMED → CLOSED | CANCELLED`.

**Handlers** (`po.handlers.ts`): create, update, delete (DRAFT only), confirm, approve,
reject, amend (+ separate amendment-approval), cancel, knock-off (line + whole-PO),
PO-order-group list/get/confirm/approve/reject, material-UOM-conversion lookup for
Procurement.

**Real Prod data (2026-09-27):** 108 POs total — 96 DOMESTIC/STANDARD, 6 DOMESTIC/TANKER,
6 IMPORT/STANDARD. **Zero** IMPORT/BULK or IMPORT/TANKER POs ever — the import
sub-classification fields (trade type, shipment mode, customs movement) exist in schema
but have never been exercised with real data.

**Rule:** one PO = one material (§87.12A) — a "PO with multiple items" in the old SAP
sense doesn't exist here; multi-material raising happens via `po_order_group` producing
N separate one-material POs instead.

### 2.2 STO (Stock Transfer Order)

**Classification dimensions:**

| Dimension | Values | Effect |
|---|---|---|
| STO Type | `INTER_PLANT` (direct company-to-company) / `CONSIGNMENT_DISTRIBUTION` (Sub-CSN transform) | Different CSN-creation mechanism — INTER_PLANT confirms into a fresh per-line Independent CSN; CONSIGNMENT_DISTRIBUTION transforms an existing Sub-CSN in place |
| Delivery Type | `STANDARD` / `BULK` / `TANKER` | CSN-creation lives in the `transition_sto_atomic` SQL function (not TS), not yet traced line-by-line — **assume it mirrors §2.1's corrected PO behavior (BULK skips CSN) until verified**, don't take it for granted. |
| `is_opening_sto` flag | boolean | Same go-live/legacy purpose as PO's flag |

**Lifecycle (status):** `DRAFT → PENDING_APPROVAL → CREATED → DISPATCHED → RECEIVED →
CLOSED | CANCELLED`.

**Full mechanism, both sending and receiving (✅ verified end-to-end 2026-09-27):**
1. **Create** (`create_sto_atomic`) — header + N lines, starts DRAFT.
2. **Confirm** (`transition_sto_atomic`, DRAFT→CREATED) — creates the CSN(s): one
   per-line Independent CSN for INTER_PLANT, or transforms the existing Sub-CSN in place
   for CONSIGNMENT_DISTRIBUTION (mother/PO lineage preserved for traceability).
3. **Dispatch** — via the *same* unified SO01/DO/PGI pipeline RM/PM/INT sales use
   (`save_delivery_order_unified_atomic` for the DO, `post_sales_invoice_groups_atomic`
   for PGI — P601 OUT at the sending company). The dedicated `dispatchSTOHandler` is
   retired (`STO_DISPATCH_USE_SO03`) — SO03/SO02 is the only path now.
4. **Receive** — a real Gate Entry (`ge_type='INBOUND_STO'`) at the receiving company,
   then a GRN per GE line (`createGrnFromGateEntryLineHandler`) posting P101 IN, updating
   the STO line's `received_qty`/`balance_qty`/`line_status` (`updateStoLineReceipt()`).
5. **Confirm Receipt** (`confirmSTOReceiptHandler`) — STO status → RECEIVED once a
   POSTED GRN exists and no line has an open, non-knocked-off balance.
6. **Close** (`closeSTOHandler`) — RECEIVED → CLOSED once every line is fully received
   or knocked off.
7. **Cancel** (`cancel_sto_atomic`) — only before dispatch (DRAFT/PENDING_APPROVAL/
   CREATED); for CONSIGNMENT_DISTRIBUTION restores the Sub-CSN to its pre-transform
   state via a saved snapshot.
8. **Knock-off** (`knockOffSTOLineHandler`) — drops a line before it's dispatched, with
   a mandatory reason; inactivates any linked CSN.

**Amendment:** `amendSTOHandler` + `approveSTOAmendmentHandler`, mutable fields include
quantity/transfer_price/expected_delivery_date/payment_term_id/freight_term/remarks/
cost centers — but a **DB trigger** (`guard_sto_line_change`, see §5 item 2 for the
2026-09-27 bug found+fixed in it) blocks any change to quantity/transfer_price/
gst_rate/material_id/uom_code once a non-cancelled DO exists against that line — the
same "Mapped-but-no-DO = editable, DO created = lock" principle SO/DO already use.

**Real Prod data:** 2 STOs, both `INTER_PLANT`/`STANDARD` (JI/PO36, ACP/PO87). Zero
`CONSIGNMENT_DISTRIBUTION` STO ever created in Prod — the mechanism is proven correct
(via today's rolled-back-transaction test) but has no real-world track record.

### 2.3 PO10 (Exchange Reference) — one of RTV's 3 settlement modes

PO10 is not standalone — it's one leg of **Return to Vendor (RTV)**'s settlement
mechanism. RTV has three `settlement_mode` values (`rtv.handlers.ts`):

| Mode | Mechanism |
|---|---|
| `DEBIT_NOTE` | Auto-creates a `debit_note` row (`createDebitNoteHandler`) — formal claim on the vendor. Pricing = material value (return_qty × original GRN rate) + proportional landed-cost components (freight/insurance/customs/CHA, pulled from the linked Landed Cost record) + manual loading/unloading/other charges. Lifecycle: `DRAFT → SENT → ACKNOWLEDGED → SETTLED` (`markDebitNoteSentHandler`/`acknowledgeDebitNoteHandler`/`settleDebitNoteHandler`). |
| `EXCHANGE` (**this is PO10**) | Auto-creates an `exchange_reference` row (`createExchangeRefHandler`) linking the return leg (RTV) to a future replacement GRN. Lifecycle: `RETURN_DISPATCHED → REPLACEMENT_RECEIVED → SETTLED`. The replacement GRN references the `exchange_ref_number` on receipt (`linkReplacementGRNHandler`); settlement = new invoice value − return value, net. |
| `NEXT_INVOICE_ADJUST` | No separate document — the return value is simply adjusted against the vendor's next invoice (handled inline in `postRTVHandler`, no follow-up table). |

**Real Prod data:** RTV = 0, Debit Note = 0, Exchange Reference = 0. **None of the three
settlement modes have ever been used in Prod** — this entire branch of Procurement
(return-to-vendor and its two follow-up documents) is fully built (Gate-13.8 + Gate-21's
missing frontend pages) but has zero real-world track record, same pattern as PTO
(§2.4 below).

### 2.4 Adjacent finding — PO12 (Plant Transfer Order / PTO) is a separate, parallel mechanism

Found while checking PO10/PO12 tx-codes. **Not the same thing as STO.** `plant_transfer_order`
(Gate-23, its own Layer — **L6 "Plant Transfer"**, separate from L2 Procurement/STO):

| | STO | PTO (PO12) |
|---|---|---|
| Materials per document | Multiple lines | **One material** per document |
| Receiving | Full CSN→GE→GRN chain | **None** — transport (vehicle/transporter/LR/e-way bill) captured directly on the PTO header |
| Type | INTER_PLANT / CONSIGNMENT_DISTRIBUTION | `ONE_STEP` (issue+receive as one posting) / `TWO_STEP` (issue and receive as two separate, simpler actions) |
| Movement types | Generic engine (P601/P101 etc.) | Dedicated `P301`/`P303`/`P305` (+ `P311` for storage-location-only transfer) |

Conceptually this mirrors two real SAP mechanisms: STO ≈ ME21N Stock Transport Order
(PO-shaped, needs a goods receipt), PTO ≈ MB1B direct stock-transfer posting (simple,
movement-type-only, no document chain). Both frontend (List + inline Create form +
Detail page) and backend (create/approve/one-step/issue/receive/cancel/storage-location-
transfer, all in `pto.handlers.ts`) are fully built. **Real Prod data: 0 rows, ever**,
despite existing since 2026-05-20. Layer table (CLAUDE.md §9) flags L6 at only 57%,
"Formal L6 session required" — design was never actually completed, which likely
explains the zero usage. **Open question for business owner:** is PTO still needed
(finish its design, same rigor as STO), or has STO fully superseded whatever PTO was
meant to cover (in which case it should be explicitly retired, not left as unused
dead-weight)?

**✅ Resolved 2026-09-27 (see §3.2.6 below):** PTO is needed — finish its design, do not
retire. The CRCP (Cross-Company) discovery below makes PTO the mechanism that records
cross-company GE/GRN movement, so its redesign scope now explicitly includes CRCP support
in addition to whatever L6 originally covered.

---

## 3. Real Business Scenarios — Cross-Company Material Movement (business owner walkthrough, 2026-09-27)

Business owner walked through real day-to-day operational scenarios, using CMP003/CMP011/
CMP005 as concrete real-world examples — but every scenario below is meant to be
**universal/generic**, applicable to any pair of companies, not just these three. Purpose:
match each scenario against what the codebase actually does today, find the gaps, and only
then design fixes — one scenario, one gap, at a time. **Discovery is complete** (6 of 6
scenarios, confirmed closed by business owner — see §3.8) — nothing in this section is a
locked design yet, it is a precise record of what was discussed, for the design pass that
follows. **§3.7 is the point-by-point Design Lock Tracker** — that's where each point's
`Final Design:` gets filled in as it's locked, one point at a time.

### 3.1 Scenario 1 — Straightforward (✅ fully covered, no gap)

**Business:** A company (any of CMP003/CMP011/CMP005) issues a PO to a vendor. The vendor
Bills-To and Ships-To that same company. Material unloads at that company's own location;
GE and GRN both happen under that company. Confirmed identical for both `STANDARD` and
`TANKER` delivery types — no difference between the two for this scenario.

**Mechanism match — 100%, no gap:**
- `purchase_order.company_id` is a single field — buyer = bill-to = ship-to = receiver, all
  the same company, by construction.
- `createGateEntryHandler` (`gate_entry.handlers.ts:409`) hard-enforces
  `po.company_id === companyId` — a GE can only be raised by the PO's own company.
- No design work needed here.

### 3.2 Scenario 2 — Cross-Company Vendor Delivery (CRCP) — 🔴 major gap, full design needed

**Business trigger (real example):** CMP011 and CMP005 are only 4KM apart. Often, material
against CMP011's PO (Standard delivery — Tanker has the same issue) cannot be unloaded at
CMP011 due to space constraints, so it unloads fully or partially at CMP005 instead — or
vice versa (CMP005's material partly/fully unloading at CMP011). Meant as a universal
mechanism, not specific to these two companies.

#### 3.2.1 Confirmed blocking gap — the other company's gate staff can't even see the PO

`listOpenPOsForGEHandler` (`gate_entry.handlers.ts:865-868`) filters strictly by
`po.company_id = own companyId` — a PO issued by Company A never appears in Company B's own
PO list when B's gate staff tries to raise a Gate Entry. Even if the PO number were typed
manually, `createGateEntryHandler` (line 409-410) hard-rejects with `GE_COMPANY_SCOPE`
whenever `po.company_id !== companyId`. **Today this scenario is completely blocked at the
very first step (GE creation) — there is no workaround, it simply cannot be done.**

#### 3.2.2 Proposed mechanism — CRCP (Cross Company) flag

Business owner's proposed design: add a **CRCP (Cross Company)** toggle to PO, STO, Legacy
PO, and Legacy STO. When ON, the creator (issuing company) decides which other companies
are allowed to participate in / receive against that document's CSN(s). Once allowed,
those companies' own users can run the full **GE → GRN → QA → Book Stock** chain under
their own company, for full or partial quantity, matching whatever actually gets unloaded
where — without necessarily needing a separate STO leg (the key alternative being explored,
vs. always routing it through the existing Mother/Sub-CSN→STO
`CONSIGNMENT_DISTRIBUTION` pattern, which requires the issuing company to fully receive
first — see §3.2.3).

#### 3.2.3 CSN ownership / misleading-information problem

`consignment_note.company_id` (migration `20260511030000`) is a **single, `NOT NULL`
field**, populated from the PO's issuing company. Under CRCP, if GE/GRN happens at an
allowed company different from the PO's own, this field would still show the original
issuing company — misleading, doesn't reflect where the material actually landed or whose
books received the stock.

Related-but-different existing mechanism found: CSN already supports a **Mother/Sub-CSN
split** (`is_mother_csn`, `mother_csn_id`, `sto_id` on `consignment_note`;
`createSubCSNHandler`, `csn.handlers.ts:1514`) where a Sub-CSN can "transform" into an STO —
this is the base of the existing `CONSIGNMENT_DISTRIBUTION` STO type. But that pattern is
strictly **post-receipt**: the issuing company fully receives (GRNs) the shipment first, and
only afterward decides to internally redistribute part of it via STO to a sister company.
It does **not** cover the CRCP case, where the truck goes straight to the other company
**before** any GRN happens at the issuing company (pre-receipt cross-company delivery).

#### 3.2.4 Manual vs. automatic Sub-CSN creation

Confirmed via code: `createSubCSNHandler` (`csn.handlers.ts:1514-1584`) is entirely
**manual** — a procurement user explicitly creates the Sub-CSN, typing in
`consignee_company_id` and the split quantity by hand, with `dispatch_qty` starting at 0
(filled in before dispatch). This assumes the split is **known and planned in advance**, at
the procurement/dispatch stage.

CRCP breaks this assumption: nobody knows in advance where the truck will actually end up
unloading — that's decided in real time at the gate, based on space available at that
moment. So Sub-CSN creation must become **automatic**, triggered reactively at GE/GRN time,
driven by the *actual* unloading company and *actual* unloaded quantity — not pre-planned by
procurement.

#### 3.2.5 Qty-split logic — full vs. partial unload

- **Full unload** at a different (allowed) company: may not need a Sub-CSN at all — could
  simply redirect/reassign the CSN's effective receiving company.
- **Partial unload** (split between the issuing company and one or more allowed companies):
  the split ratio is **not known in advance** — it must be derived automatically from the
  actual quantities entered at GE/GRN time on each side, and CSN's `dispatch_qty` /
  `total_received_qty` must recalculate in real time to reflect the true split.

#### 3.2.6 PO12 (PTO) role — resolves the §2.4/§4.5 open question

The cross-company GE/GRN data (once posted) flows into **PO12 (Plant Transfer Order)** —
PTO becomes the mechanism that records/tracks this physical cross-company movement, plus
whatever additional new features CRCP needs. This **resolves the earlier §2.4/§4.5 "finish
or retire" question in favor of finish** — PTO is needed, and its redesign scope now
explicitly includes the CRCP settlement mechanism below (§3.2.7).

#### 3.2.7 Settlement — Return vs. Invoice (the accounting reconciliation problem)

Once a cross-company GE/GRN happens, the material is physically usable at the receiving
company (e.g., in that company's own production) — but "books of accounts" don't recognize
that as valid, since the two companies are separate legal entities. This must be formally
settled, one of two ways, **decided by the two companies per-transaction** (not a fixed
system rule — mirrors RTV's own per-transaction `settlement_mode` choice, §2.3):

- **(A) Return** — a genuine **physical** transfer back (real truck movement, a real
  GE + Dispatch + GRN cycle, in the reverse direction). Can be done fully at once, or
  partially/in installments over time, until the outstanding "borrowed" balance clears to
  zero. This reuses STO's forward-flow execution mechanics (Create → Dispatch → Receive),
  but with a critical twist: **today's `createSTOHandler` always requires the quantity to
  be planned *first*, at creation time** (`balance_qty: line.quantity` set at create,
  confirmed in code — `sto.handlers.ts:944, 1058`) — there is **no existing mechanism to
  create an STO *retroactively*, against an already-existing accumulated balance** from
  prior cross-company GRNs. This retroactive/balance-referencing STO creation is a
  genuinely **new** mechanism that needs to be designed. It should be creatable either
  against **one specific** cross-company GRN, or against the **total accumulated balance**
  across **multiple** cross-company GRNs (an aggregate settlement, not necessarily tied 1:1
  to a single source document) — similar to an open-item/running-balance reconciliation in
  accounting.
- **(B) Invoice** — the issuing company raises a **Sale Invoice** to the receiving company
  for that quantity; ownership permanently transfers via a commercial sale; **no physical
  return happens once invoiced** (final). This can reuse the **existing** STO → Delivery
  Order → PGI → Sales Invoice mechanism (already built, §113.13-115 of the feasibility doc,
  `complete_pgi_invoice_action_with_sto_commercials`).
- **Constraint (confirmed by business owner):** if the material has already been
  **consumed** (e.g., used in production) before settlement, that portion can no longer be
  physically returned — so that portion **must** go via Invoice; only the still-available/
  unused portion can go via Return. A single outstanding cross-company balance can therefore
  be **split/mixed** between Return and Invoice settlement.

#### 3.2.8 Generalization — Return vs. Invoice is NOT CRCP-specific

Confirmed by business owner and by code: this Return-vs-Invoice settlement decision is a
**universal requirement for any inter-company physical stock movement** — not just
CRCP-triggered cross-company GRNs, but also **plain, deliberate STO transfers** (a company
sending its own stock to a sister company, with no vendor/PO involved at all). Confirmed via
code: `sto.handlers.ts` has **no "Return" concept anywhere today** — only Cancel
(pre-dispatch) and the eventual Invoice/Sale settlement path exist. So today, STO's *only*
settlement path is Invoice; Return doesn't exist for STO at all, CRCP-triggered or not.

**Design implication:** the Return-vs-Invoice settlement mechanism should be built as a
**shared, general capability of the STO/PTO lifecycle itself** — applicable whenever
material moves inter-company for any reason — not as a CRCP-only feature bolted onto one
code path.

#### 3.2.9 CRCP timing — must be settable *after* PO/STO approval, not only at creation

Business owner correction: the CRCP allow-list **cannot** be fixed only at PO/STO/Legacy-PO/
Legacy-STO creation time, because where the material will ultimately unload is often still
unknown at that point (true even for Bulk, despite §3.3 below — see the nuance there). So
CRCP must be a **post-approval-editable** setting: the allowed-company list can be turned on
and updated even after the PO/STO is already `APPROVED`/`CONFIRMED`. This is effectively an
access-control list, not a commercial term — it should **not** be forced through PO/STO's
heavier amendment-approval workflow (which exists for commercial-term changes); it needs its
own lightweight action. Enforcement stays as today's default-deny: only companies in the
allow-list (plus the PO/STO's own issuing company) can see/raise a GE against that document;
everyone else gets `GE_COMPANY_SCOPE` exactly as now.

### 3.3 Scenario 3 — Bulk delivery type (all of Scenario 2 applies, consistently, plus its own gaps)

**Business:** Scenarios 1 and 2 were discussed for `STANDARD`/`TANKER`. Bulk is different
enough to need its own scenario. Every issue in Scenario 2 (§3.2) applies to Bulk too — and
for Bulk it happens **consistently**, not as an occasional exception. Bulk also has its own
confirmed Bill-To ≠ Ship-To pattern: the PO's own company (e.g. CMP003) is the commercial
Bill-To, but the physical Ship-To is routinely CMP011 or CMP005.

**Mechanism check — confirmed via code:**
- `createCsnsForPo` (`po.handlers.ts:934-936`) returns immediately for
  `po.delivery_type === "BULK"` — **no CSN is ever created for Bulk POs**, at all. (This
  corrects §2.1's original "BULK/TANKER → weighment-based Bulk CSN" line — see the fix
  applied there.)
- Because there's no CSN, a Bulk GE references `po_line_id` **directly**
  (`gate_entry.handlers.ts:374-414`, `hasCsnReference = false` path) — and hits the exact
  same `GE_COMPANY_SCOPE` block (line 409) as Scenario 2's blocking gap (§3.2.1). The fix is
  identical: CRCP allow-list.
- Since there's no CSN to be "misleading" (§3.2.3 doesn't apply the same way), there is also
  **nothing at all** tracking a cross-company Bulk movement today except the GE/GRN rows
  themselves — the automatic-split problem (§3.2.4/§3.2.5) becomes purely a GE/GRN + PO12
  (PTO) problem for Bulk, with no CSN layer to lean on either way.
- The Bill-To ≠ Ship-To pattern for Bulk raised the §3.2.9 question above (can CRCP be set
  at PO creation for Bulk, since it's allegedly known upfront?) — **answered by §3.2.9: no**,
  the allow-list must be editable post-approval regardless, because the actual unload
  destination is still not reliably known even for Bulk at creation time.

### 3.4 Scenario 4 — Mother-issuer visibility + weekly consolidated settlement invoice

**Business:** Continuing from Scenario 2/3's cross-company unload — whichever settlement
path applies (Return or Invoice, any mix), the receiving companies (CMP011/CMP005) currently
email their Bill-To/Ship-To/receipt details to CMP003 (the "mother issuer" — the PO's own
company), and CMP003 settles it via a **Sales Invoice issued weekly**, not per-transaction.

**Confirmed requirements (four distinct points):**
1. **Cross-company read visibility for the issuing company.** CMP003's own users need to
   **see** CMP011's/CMP005's cross-company entries directly in the system (not via email) —
   to track them and tally against the invoice they issue. This is a **new kind of
   cross-company grant**, distinct from CRCP's write-allow-list (which lets a *receiving*
   company act under itself): this one gives the **issuing** company read-only visibility
   into what happened downstream at the receiving companies. Today's `assertCompanyScope`
   pattern only ever scopes a user to their own company — there is no "read into a
   CRCP-linked sister company" capability anywhere in the codebase.
2. **Weekly consolidated (aggregate) invoice.** One Sales Invoice settles an entire week's
   worth of cross-company transactions across potentially multiple GRNs/movements, not 1:1
   per transaction. This is a second, concrete confirmation of §3.2.7's "aggregate balance
   settlement" idea — now confirmed needed for the **Invoice** settlement path too, not just
   Return.
3. **Non-material components ride on the same invoice.** Freight and other charges get added
   to the settlement invoice alongside material value — a composite bill, not pure material
   value. Likely reuses an existing "additional charge line" pattern (Packaging Cost on
   Sales Invoices, or Landed Cost/AC01's charge-component model) rather than inventing a new
   one — needs checking at design time.
4. **Period-boundary backdating risk.** CMP003 sometimes issues the invoice on the 1st of the
   *next* month, dated for the *previous* month's last week. Tally tolerates this; **PACE's
   own system may not** — `sales_invoice` date validation, GST-period logic, and §106's
   FY-scoped Material Document numbering (April-start FY, year-scoped counters) all need to
   be checked for cross-month/cross-FY-boundary backdating tolerance before assuming this
   "just works" the way it does in Tally. **Flagged as a real risk, not yet verified.**

### 3.5 Scenario 5 — Bulk vendor-side invoicing has no structural match today (8 confirmed points)

**Business:** Bulk PO's vendor-side commercial documentation is fundamentally different from
Standard/Tanker's PO→CSN→GRN pattern. Eight distinct points raised:

1. **No CSN for Bulk, and none wanted.** Confirms §3.3 — intentional, not a gap.
2. **Invoice doesn't travel with the truck; delivery challan sometimes does; one invoice
   later covers multiple trucks together.** Confirmed via schema: `goods_receipt` is
   strictly **one GRN per Gate Entry** (`UNIQUE(gate_entry_id)`, "cannot span multiple GEs"),
   and a GE is itself tied to one truck (`vehicle_number`). So today's architecture is a
   rigid **1 Truck = 1 GE = 1 GRN** chain, with no structural way to group N GRNs under one
   vendor invoice — `invoice_number` lives only on `goods_receipt_line` as free text (no
   vendor-invoice header table exists to associate multiple GRNs to one invoice).
3. **Same seller, different loading points → different freight per shipment.** Freight
   cannot be a flat rate per PO/vendor; it varies per truck/shipment based on loading point.
4. **Weighment-driven aggregate billing.** Confirmed the weighment mechanism itself already
   works exactly as described: `gate_entry_line.gross_weight` → `goods_receipt_line
   .net_weight_from_weighbridge` (Gross − Gate Exit Tare) → `received_qty` defaults to it.
   What's missing is the **aggregation/invoicing layer on top** — using the accumulated
   weighed quantity across many trucks to later generate one consolidated bill.
5. **Same backdating pattern as Scenario 4, vendor-side.** Bills dated for the previous
   month often get raised on the 4th of the next month. Same §3.4-point-4 risk, now on the
   incoming vendor-invoice side (Invoice Verification / GRN `invoice_number`/date fields)
   rather than the outgoing settlement-invoice side.
6. **Delivery challan often absent; container number used instead; invoicing granularity
   varies (one invoice per multiple containers, or per single container).** Confirmed via
   schema: `gate_entry_line.challan_or_invoice_no` is a **single free-text field** holding
   either a delivery challan number or an invoice number — **no dedicated `container_number`
   field exists anywhere** in GE or GRN. There is no structural way today to key GRNs to an
   invoice by container number, at any granularity.
7. **Freight billing mirrors whatever grouping the seller used for the goods bill.** Per
   truck, per container, or aggregated across multiple containers — freight invoicing needs
   the **same flexible many-to-many linking** as point 6, not its own separate logic.
8. **Volume — ~200 Bulk line items/month makes line-by-line AC01 entry infeasible.** Manually
   entering one Landed Cost component row per delivery/GRN at that volume isn't workable.
   **Business owner has a solution in mind, to be described later — not designed yet, no
   assumptions made here.**

### 3.6 Scenario 6 — Phase 2 forward-compatibility note: transporter container-list upload

**Business:** Future (explicitly **Phase 2**, not now) — allow uploading the transporter's
own Excel container list as a reference/master list (scoped to a PO/STO/shipment). At GE
creation, the user would **pick** the container from that pre-uploaded list instead of typing
it freely; a container **not** on the list would automatically flag as a cross-tally
mismatch/discrepancy for reconciliation.

**Design guidance for now:** do not implement this yet, but the §3.5-point-6 container_number
field/mechanism (being designed now) must **not** be built as a pure free-text field with no
structure — it needs to leave room for a master-list-driven picker + cross-tally check to be
added later **without a rearchitecture**.

### 3.7 Design Lock Tracker — point-by-point (Business / System / Gap / Final Design)

**Purpose:** business owner wants to lock a final design **one point at a time**, in this
exact Business/System/Gap format, with a **Final Design** slot filled in against each point
the moment it's locked. Point IDs below match the §3.2-§3.6 and §3.9 subsection numbers
above — use those IDs when saying "lock point X". Every `Final Design:` line currently reads
`⏳ NOT YET LOCKED` — that is the only thing that changes as each point gets locked, in place,
without renumbering anything else in this doc. Once a point is locked here, its actual Page
UI / Backend / DB-level design happens **separately, when that point's build turn comes up**
— this tracker only locks the *mechanism*, not the implementation spec.

**Recommended Build Sequence (dependency-ordered, 2026-09-27) — two independent tracks:**

*Track 1 — CRCP (Cross-Company Movement), Scenarios 2/3/4:*
- **Phase A:** Point 3.2.2 + Point 3.2.9 together — the CRCP allow-list flag itself, built
  post-approval-editable from the start. Resolves Point 3.2.1 as a byproduct (with the known
  interim limitation noted in Point 3.2.1 — Standard/Tanker uses the CSN-less path until
  Phase B ships). Point 3.4.1 (mother-issuer read visibility) can be built alongside this
  phase — it only needs the CRCP relationship to exist, not the full settlement chain.
- **Phase B (reordered 2026-09-27, was Phase C):** Point 3.2.3 + Point 3.2.4 + Point 3.2.5
  together — CSN ownership, the drawer-visibility filter fix, automatic split, full/partial
  qty logic, one cohesive unit, for the Standard/Tanker (CSN-based) path. Needs Phase A first.
  **Also bundles the STO GE-creation page build (business owner, 2026-09-27) — a dedicated
  GE-creation flow/page for STO doesn't exist yet today; since STO's cross-company GE depends
  on the same CSN/consignment-ownership fixes this phase already covers, building the STO GE
  page as a standalone step first would risk rework once Phase B lands. Build them together.**
- **Phase D (moved ahead of Phase C, business owner, 2026-09-28):** Point 3.3 — the same CRCP
  mechanism (Phase A) applied to Bulk's CSN-less case, including the Bulk GE-page redesign
  (Bulk's own GE-creation flow adapted for CRCP's direct-`po_line_id` path — no separate build
  step, it's the same work as Point 3.3 itself). Needs Phase A. **Accepted trade-off:** Phase D
  still relies on PTO (Phase C, below) for full cross-company movement *tracking/recording* —
  building Phase D first means Bulk's CRCP GE-access works immediately, but the actual
  recorded-movement/settlement trail for those Bulk GEs stays incomplete until the merged
  Phase C lands. Business owner explicitly chose this order over waiting for PTO first.
- **Phase D.5 — reversed (business owner, 2026-10-02):** the GRN "Ship To Leg" mechanism
  (Final Design locked under Point 3.2.7 above — new GRN field, "SHIP TO LOCATION MENTIONED
  IN INVOICE") is now built **immediately, in the same batch as Phase A/D**, not deferred —
  superseding the 2026-09-27 decision to wait until after Phase B+D landed. Both Phase B (STO
  GE) and Phase D (Bulk GE) are already implemented (not yet Prod) by the time this reversal
  was made, so the original sequencing concern (validate the field against all three GE paths
  before building) is moot — all three paths already exist to validate against, in the same
  pending batch. This also closes the timing/backfill risk flagged under Point 3.2.7 (data
  captured per-GRN, unrecoverable once posted without it) before any of Phase A/B/D reaches
  Prod.
- **Early/parallel validation (do before locking Phase C's invoice-date design):** Point 3.4.4
  + Point 3.5.5 together — one shared investigation into whether the system tolerates
  cross-month/cross-FY backdating the way Tally does.
- **Phase C (merged with the former Phase E, business owner, 2026-09-28) — PTO + Settlement,
  one unified design:** Point 3.2.6 + Point 3.2.7 + Point 3.2.8 + Point 3.4.2 together, not
  sequentially. **Why merged:** business owner's own insight — PTO isn't just a movement-record
  page, it is meant to be the place from which the Invoice-vs-Return/Settlement decision itself
  gets made, and it must also support a plain, deliberate company-to-company transfer with no
  CRCP/vendor trigger at all (exactly Point 3.2.8's generalization). Designing PTO's mechanism
  (Point 3.2.6) without already knowing the settlement decision it has to drive (Points
  3.2.7/3.2.8) would risk building the wrong shape and redoing it once Phase C/E's original
  split was attempted separately — so they are locked together as one design, covering:
  CRCP-triggered cross-company GR capture, plain inter-company transfer, and the
  Return-vs-Invoice settlement decision surfaced from the same page, with aggregate-balance
  support built in from day one (not bolted on later for the weekly invoice case). **`Final
  Design` for Point 3.2.6 remains only a decision lock ("finish, don't retire") until this
  merged design session actually happens — the real mechanism is still fully open.** Sequenced
  after Phase D/D.5 per business owner's explicit build-order choice above (not a hard
  dependency — PTO's own design doesn't strictly require Bulk's GE work to exist first, this is
  a scheduling choice). Point 3.4.3 (freight/components on the invoice) rides on top of this,
  once the invoice mechanism itself exists. **Note:** for the Scenario 7 multi-invoice-
  commingled edge case specifically (not the general CRCP case), this phase's settlement amount
  also needs Point 3.9.2's output as an input — see Track 3 below.
- **Phase E — MERGED INTO PHASE C ABOVE (2026-09-28).** Kept as a heading only so
  `Point 3.2.7`/`3.2.8`/`3.4.2` references elsewhere in this doc still resolve to a phase name
  — the design and build both happen as part of Phase C now, not as a separate later phase.

*Track 2 — Bulk Vendor-Invoicing / AC01 Bulk Cost-Component Mapper, Scenario 5 — fully
independent of Track 1, can run in parallel or first:*
- **Step 1 (scope broadened by Point 3.9.4):** originally just "add a `container_number`
  field" — now understood to be a **Bulk-specific GE line redesign**, since Bulk's real
  reference documents vary (Delivery Challan / Container / Weighment slip / eventual Invoice
  via Point 3.9.2), not one free-text field plus one new column. Must still leave room for
  Point 3.6's Phase-2 master-list picker without a rearchitecture.
- **Step 2:** Points 3.5.2 + 3.5.3 + 3.5.7 + 3.5.8 together, as **one build** — the generic
  Bulk Cost Component Mapper tool (see each point's own Final Design below for the locked
  mechanism). This single tool resolves all four points at once; they were never four
  separate mechanisms.
- Point 3.5.1 and Point 3.5.4 need no design work (already correct/intentional as-is).
- Point 3.6 stays deferred to Phase 2, a constraint on Step 1's field design, not a build
  step of its own right now.

*Track 3 — Scenario 7, Multi-Invoice Commingled Transport (§3.9) — depends on pieces of
BOTH tracks, build last of the three:*
- Point 3.9.1 needs no build — it's the analysis that established Track 3 is necessary.
- Point 3.9.2 (PO↔Invoice sequential balance-fill) is its **own new mechanism**, structurally
  separate from Track 2's Bulk Cost Component Mapper — needs Track 2 Step 1's Bulk GE
  redesign to exist first (it reads the same GE/GRN reference data), and its sequencing-order
  field (`invoice_date`/`invoice_number`) needs explicit business-owner sign-off before
  build.
- Point 3.9.3 extends Track 1 Phase A's Point 3.4.1 scope (design Point 3.4.1 broadly enough
  from the start to cover both use cases) — its write-authority question needs a decision
  before build.
- Point 3.9.4 is not a separate build step — it's already folded into Track 2 Step 1 above.

**Point 3.1 — Scenario 1 (Straightforward)**
- Business: company issues PO to vendor, vendor Bills-To/Ships-To that same company, GE+GRN
  happen under that company. Same for Standard and Tanker.
- System: `purchase_order.company_id` single field = buyer = bill-to = ship-to = receiver;
  `createGateEntryHandler` (`gate_entry.handlers.ts:409`) enforces `po.company_id === companyId`.
- Gap: none.
- Final Design: ✅ No design needed — already correct as-is.

**Point 3.2.1 — PO/GE cross-company visibility**
- Business: when material for one company's PO unloads at a sister company (space
  constraint or otherwise), that sister company's gate staff need to find and act on the PO.
- System: `listOpenPOsForGEHandler` (`gate_entry.handlers.ts:865-868`) filters
  `.eq("company_id", companyId)` — own company only. `createGateEntryHandler` line 409-410
  hard-rejects with `GE_COMPANY_SCOPE` if `po.company_id !== companyId`.
- Gap: completely blocked today, no workaround.
- Final Design: ✅ **LOCKED 2026-09-27 (code+Prod-verified, no blockers found).** Resolved by
  Point 3.2.2's CRCP allow-list: `createGateEntryHandler`'s check becomes
  `po.company_id === companyId OR companyId IN po_crcp_allowed_companies`, replacing today's
  hard rejection. **Shared-balance/closing rule (the actual runtime mechanics once GE is
  allowed):** all CRCP-allowed companies (the PO's own + every shared company) draw against
  **one shared pool** — the PO line's own quantity balance — not a separate allocation per
  company; strictly first-come-first-served, **no reserved/priority share for the issuing
  company** (confirmed explicitly by business owner — if a shared company consumes the full
  balance first, the issuing company itself can no longer GE against its own PO). Once the
  pool is exhausted, **no company** (issuing or shared) can raise further GE against that PO
  line; it reopens only by cancelling the exhausting GE (pre-GRN) or, once GRN has posted,
  only via GRN+GE reversal — no other path.
  **Verified needs zero new backend balance-logic:** `updatePoLineReceipt`/
  `reversePoLineReceipt` (`grn.handlers.ts:213-249`) already decrement/restore
  `purchase_order_line.open_qty` with **no `company_id` check anywhere in either function** —
  this is *already* a company-agnostic shared pool exactly matching the rule above. Also
  verified: GRN posting (`grn.handlers.ts`) has no secondary `po.company_id` re-check beyond
  the GE-creation gate, so fixing that one gate is sufficient — the rest of the chain needs no
  change at all.
  **Interim behavior for Standard/Tanker until Phase C ships (found 2026-09-27, code-verified):**
  `listOpenCSNsForGEHandler` (`gate_entry.handlers.ts:826-836`) has its **own independent**
  `.eq("company_id", companyId)` filter, scoped to the caller's own company — separate from
  the PO-level gate this point fixes. So even after this point ships, a CRCP-shared company's
  user will **not see the original CSN** in the GE drawer for a Standard/Tanker PO (the CSN
  still belongs to the issuing company). **Explicit decision (business owner, 2026-09-27):**
  Phase A ships as-is, without touching this filter — Standard/Tanker CRCP cross-company GE
  works via the same CSN-less/direct-`po_line_id` path Bulk already uses, until Phase C
  (Point 3.2.3) is built. The CSN Tracker will show stale/inconsistent data for that PO in the
  interim — expected, not a bug, until Phase C closes it. **This filter fix is folded into
  Point 3.2.3's own scope below, not treated as a separate Phase A extension.**

**Point 3.2.2 — CRCP (Cross Company) flag**
- Business: a CRCP toggle on PO/STO/Legacy-PO/Legacy-STO; when ON, the issuing company picks
  which other companies may participate in/receive against that document's CSN(s).
- System: no such flag or allow-list exists anywhere.
- Gap: net-new mechanism.
- Final Design: ✅ **LOCKED 2026-09-27 (code+Prod-verified, no blockers found).**
  **Holder level differs by document shape:** on **PO**, the flag lives **per PO** (i.e. per
  item-row in a `po_order_group` creation batch) — verified against real Prod data that one
  batch window commonly creates several separate one-material POs at once (one group found
  with 6 POs), consistent with §87.12A's one-PO-one-material rule; on **STO**, the flag lives
  at the **header level**, since one STO can carry multiple lines.
  **UI when the flag is ON:** a multi-select list of companies, always shown as
  `Company Code — State Code — Company Name` (never a raw ID, per CLAUDE.md §8A). The
  document's own company is always included and **cannot be deselected**; the user adds one
  or more additional companies from the list.
  **Never externally visible:** the CRCP flag/company-list must be excluded from every
  printed/exported PO or STO copy. Verified this is a single shared surface —
  `frontend/src/pages/dashboard/procurement/print/PrintPreviewPage.jsx` renders both PO and
  STO print views (backed by the shared `PROC_PO_STO_PRINT` ACL resource) — so the exclusion
  guard needs to be added in exactly one place, not duplicated per document type.

**Point 3.2.3 — CSN ownership / misleading info**
- Business: once GE/GRN happens at an allowed sister company, the CSN must correctly reflect
  where the material actually landed, not just the original issuing company.
- System: `consignment_note.company_id` is a single `NOT NULL` field set from the PO's issuing
  company. Existing Mother/Sub-CSN→STO transform (`createSubCSNHandler`, `csn.handlers.ts:1514`,
  base of `CONSIGNMENT_DISTRIBUTION`) only covers the **post-receipt** case (issuing company
  fully receives first, then redistributes). **Also in scope here (found 2026-09-27, see
  Point 3.2.1's interim-behavior note):** `listOpenCSNsForGEHandler`
  (`gate_entry.handlers.ts:826-836`) filters CSNs by the caller's own `company_id` only — a
  CRCP-shared company can't see the issuing company's CSN in the GE drawer at all. This point
  must resolve **every** CSN-side aspect together: ownership/display, the drawer-visibility
  filter, and the automatic-split mechanism (Points 3.2.4-3.2.5) — not piecemeal.
- Gap: no mechanism for the **pre-receipt** CRCP case (truck never touches the issuing
  company at all); CSN drawer itself is invisible cross-company on top of that.
- Final Design: ✅ **LOCKED 2026-09-28 (code-verified, no blockers found).** Scope: **Standard
  and Tanker only** — Bulk has no CSN at all (Point 3.3), so nothing to change there; business
  owner explicitly ruled out over-designing this. **Full unload is trivial and needs no new
  mechanism**, only Partial needed real design (see below). Explicitly **not** the
  Mother/Sub-CSN→STO transform (`sto_id`, `CONSIGNMENT_DISTRIBUTION`) — that stays a separate,
  untouched post-receipt redistribution flow; this point never sets `sto_id`.
  **Verified the foundation already exists, ~90% reusable, no new schema needed:**
  `consignee_company_id` (added `20260625100000_csn_consignee_company.sql`) already means
  exactly "which company this [sub-]CSN is destined for, distinct from the mother CSN's own
  `company_id`" — this **is** the "Unloaded At" field business owner asked for, just under an
  existing name; `enrichTrackerRows` (`csn.handlers.ts:961+`) already bulk-resolves and
  displays it in CSN Tracker; `mother_csn_id`/`is_mother_csn` hierarchy and the "Sub CSNs —
  Linked splits and allocated quantities" UI section (`CSNTrackerPage.jsx`) already exist.
  **Full unload (any company, including cross-company via CRCP):** set that CSN's own
  `consignee_company_id` directly to the actual GE company — no new record.
  **Partial unload (split across companies, same physical consignment):** reuses
  `createSubCSNHandler`'s exact clone logic (`csn.handlers.ts:1514`), but **auto-triggered from
  `createGateEntryHandler`** (see Point 3.2.4) instead of the manual "+" button — new Sub-CSN
  gets `consignee_company_id` = that GE's company, `dispatch_qty` = that GE's actual qty (not
  `0`/manual); the GE line's own `csn_id` points to this new Sub-CSN, not the mother.
  **Drawer-visibility fix (folded in per the 2026-09-27 scope note above):**
  `listOpenCSNsForGEHandler`'s `company_id`-only filter needs to also match a CRCP-shared
  company against the CSN's underlying PO's allow-list, mirroring Point 3.2.1's GE-creation fix.
  **Pool-balance integrity — verified, not a new concern:** however many CSN/Sub-CSN rows
  exist is purely a tracking/display layer; `purchase_order_line.open_qty` decrements via GRN
  keyed to `po_line_id` (Point 3.2.1), with zero dependency on `csn_id` — confirmed in Phase A,
  unaffected by any of this.

**Point 3.2.4 — Manual vs. automatic Sub-CSN**
- Business: the actual unload company/qty is only known in real time at the gate, not
  plannable in advance by procurement.
- System: `createSubCSNHandler` (`csn.handlers.ts:1514-1584`) is entirely manual — procurement
  types in `consignee_company_id` and qty by hand, ahead of dispatch.
- Gap: needs to become automatic, triggered reactively at GE/GRN time.
- Final Design: ✅ **LOCKED 2026-09-28 (code-verified, no blockers found).** Trigger point is
  **Gate Entry, not GRN** (business owner, 2026-09-28) — GE is the actual physical-unload
  moment; no need to wait for GRN/QA to complete. The auto-Sub-CSN-creation logic (Point
  3.2.3) runs inside `createGateEntryHandler`, at exactly the point Phase A's CRCP
  company-scope check already sits (`gate_entry.handlers.ts` PO/STO branches, ~lines 429-439 /
  485-504) — the moment a CRCP-shared company is confirmed allowed, this logic decides
  full-vs-partial (Point 3.2.5) and either updates the CSN in place or spawns the Sub-CSN, all
  within the same GE-creation call. The manual "+ Create Sub CSN" button in CSN Tracker stays
  for its original (non-CRCP) use case, untouched.

**Point 3.2.5 — Full vs. partial unload qty-split**
- Business: full unload at the sister company, or a partial split across two companies, both
  happen; the ratio is only known at the moment of unload.
- System: no split-ratio derivation mechanism exists.
- Gap: full-unload needs a simple CSN reassignment path; partial-unload needs real-time
  split-ratio calculation feeding `dispatch_qty`/`total_received_qty`.
- Final Design: ✅ **LOCKED 2026-09-28 (code-verified, no blockers found).** No "ratio
  derivation" needed at all — there is no pre-known ratio to calculate. Each actual GE **is**
  the real, actual split, as it happens: **full** = the GE's qty equals the CSN's entire
  remaining `dispatch_qty` → update that CSN's `consignee_company_id` in place, no split.
  **Partial** = the GE's qty is less than the remaining `dispatch_qty` → auto-create a Sub-CSN
  (Point 3.2.3/3.2.4) carrying exactly that GE's qty as its own `dispatch_qty`; the mother
  CSN's own remaining `dispatch_qty` reduces by the same amount. Multiple partial GEs against
  the same mother simply keep producing sibling Sub-CSNs, each exactly matching its own GE —
  the split is a direct readout of actual transactions, never a calculation.

**STO GE-Creation Drawer — Design (LOCKED 2026-09-28, business owner + code-verified).**
Bundled into Phase B (see Recommended Build Sequence above) — a dedicated GE-creation flow for
STO doesn't exist in the frontend today; this covers both the plain/Normal case and the CRCP
case with the same mechanism.
- **Trigger:** on the main GE creation page's existing `"PO / STO *"` cell (already a combined
  field today, per `GateEntryCreatePage.jsx`), entering an STO number causes the system to
  sense it's an STO (not a PO) and open a large center drawer — needed because one STO can
  carry many line items, unlike one PO line.
- **Drawer header (all read-only, informational):** STO Number, and — **only when the STO's
  type is `CONSIGNMENT_DISTRIBUTION`** — **Mother PO Number**, **Mother Invoice Number**,
  **Mother BOE Number**. Verified the full chain already exists in schema, no new column
  needed: STO → (reverse lookup) the Sub-CSN whose `consignment_note.sto_id` equals this STO's
  id (set at "Sub-CSN transforms to STO" time) → that Sub-CSN's own `mother_csn_id` → the
  Mother CSN, which already carries `po_id` (→ join `purchase_order.po_number`),
  `invoice_number`, `boe_number`. Blank/hidden for `INTER_PLANT` STOs (no such chain exists for
  that type).
- **Drawer table (ErpDenseGrid), one row per STO line, mirrors the existing PO-flow shape
  exactly, plus one addition:** STO Number, CSN, Material, UOM, Expected qty, **GE quantity**
  (defaults to Expected qty — editable only when there's a real mismatch, matching the
  "everything comes prefilled, edit only what needs editing" principle set for this whole
  drawer), Invoice No, LR/BL date, row-delete action — **same columns as today's PO/CSN drawer
  (`GateEntryCreatePage.jsx`'s existing table)** — plus a new **select/deselect checkbox** per
  row (default checked) so the gate user can uncheck line items that did not actually arrive
  on this particular vehicle.
  **Invoice No / LR/BL date prefill — verified, needs no new mechanism or data entry:** for a
  Distribution STO, `complete_pgi_invoice_action_with_sto_commercials`
  (`20260912172116_sto_invoice_commercial_resolution.sql`, §113.15/116) already writes
  `invoice_number`, `invoice_date`, `lr_number`, `lr_date`, `vehicle_number`, `transporter_id`
  onto that STO line's own linked CSN the moment the **sending** company posts its PGI+Invoice
  — i.e. this data is already sitting on the CSN well before the truck ever reaches the gate.
  These are the exact same CSN fields the PO-flow's "Invoice / BOE no" and "LR / BL date"
  columns already read — the STO drawer reuses them unchanged, no new field or data-capture
  step anywhere.
- **Save behavior:** only the checked (selected) rows get pushed into the main GE page's line
  table, prefilled; the gate user edits only whatever genuinely needs changing (typically just
  GE quantity on a mismatch), then the main GE save proceeds as normal.
- **Multi-document append:** entering a second STO (or a PO) on the same main GE page reopens
  the appropriate drawer for that document; on save, its rows are **appended after** whatever
  rows the previous document(s) already contributed — never replacing them. One vehicle
  carrying a mix of PO and STO items across multiple documents is fully supported this way,
  matching how PO-line addition already works today.
- **Bulk's version of this mechanism is explicitly deferred** — business owner will describe
  Bulk-specific behavior when that phase is reached; nothing here should be assumed to extend
  to Bulk without that separate discussion.

**Phase B — Implementation Log (2026-09-28)**

> Covers Points 3.2.3/3.2.4/3.2.5 (CSN full/partial cross-company split) and the STO
> GE-Creation Drawer design above. **No migration** — every field reused already existed
> (`consignee_company_id`, `mother_csn_id`, `dispatch_qty`, `sto_line_id`, the CSN↔STO-line
> unique index). Not yet committed/pushed, not yet applied to Prod (N/A — no schema change),
> not yet click-tested live.

- **Backend — Gate Entry (`supabase/functions/api/_core/procurement/gate_entry.handlers.ts`):**
  - New `resolveCrossCompanyCsnLink(csnId, geQty, companyId, actorId)` — the actual
    full-vs-partial decision engine. Reads the CSN's own remaining `dispatch_qty`; if the GE
    qty consumes it entirely, tags `consignee_company_id` on the same row; otherwise clones a
    Sub-CSN (same shape as `csn.handlers.ts`'s manual `createSubCSNHandler`) carrying exactly
    the GE's qty as its own `dispatch_qty`, and reduces the mother's `dispatch_qty` by that
    amount. Deliberately does **not** null `sto_id` on the clone (unlike the classic
    PO-origin Sub-CSN path) so an STO-origin split stays traceable to the same STO instead of
    displaying as a "detached" Sub-CSN in CSN Tracker (`enrichTrackerRows`'s
    `isDetachedSubCsn` reads exactly this field) — but **does** null `sto_line_id`, since
    `consignment_note_sto_line_unique` allows only one CSN per STO line and the mother keeps
    that ownership.
  - Wired into both branches of `createGateEntryHandler`, right where Phase A's
    `isCrcpSharedCompany` check already sits: once a CRCP-shared company is confirmed allowed
    (PO or STO), and a CSN is linked, `resolveCrossCompanyCsnLink` runs and its result becomes
    the `csn_id` actually written onto the new `gate_entry_line` row — not necessarily the
    `csn_id` the client originally sent, since a partial split may redirect it to a freshly
    created Sub-CSN.
  - `listOpenCSNsForGEHandler` (Point 3.2.3's drawer-visibility fix): widened from
    `.eq("company_id", companyId)` to also match any CSN whose `po_id`/`sto_id` is in that
    company's CRCP allow-list — same `.or()` pattern Phase A already used for
    `listOpenPOsForGEHandler`/`listOpenSTOsForGEHandler`.
  - `listOpenSTOsForGEHandler` extended for the drawer: each STO line now carries
    `expected_qty` (from its linked CSN's `dispatch_qty`, synced automatically from the
    sending side's actual dispatch — falls back to the line's own `quantity` only if no CSN
    is found), `csn_id`, `csn_number`, `invoice_number`, `lr_date`, `boe_number`,
    `mother_csn_id`. Each STO header additionally carries a `mother` object (Mother PO
    Number/Invoice/BOE, resolved via the line CSN's `mother_csn_id` chain) whenever
    `sto_type === 'CONSIGNMENT_DISTRIBUTION'`.
  - Exported `getCsnById`/`generateProcurementDocNumber` from `csn.handlers.ts` (were
    file-local) so `gate_entry.handlers.ts` could reuse them instead of duplicating the
    lookup/numbering logic.
- **Backend — CRCP write-ACL gap found and fixed (same session, via
  `company-scope-write-acl-guard.mjs`):** running the **full** guard suite for the first time
  against Phase A's own code (not just the 4 guards originally run for Phase A) surfaced a
  real, pre-existing gap in `po.handlers.ts`'s `setPoCrcpHandler` — it resolves `company_id`
  from the PO's own row (not the session's active company) and only called
  `assertCompanyScope` (membership only), never verifying the caller's ACL grant at that
  specific company is actually `EDIT` on `PROC_PO_CREATE`. Same root-cause shape already
  documented and fixed once before in `planning.handlers.ts` (`canMaintainPlanning`/
  `requirePlanningEditAccess`, found live 2026-08-11). Fixed by adding the analogous
  `canMaintainPoCrcp()` (reads `precomputed_acl_view` via `readAclSnapshotDecisionAny` for
  `PROC_PO_CREATE:EDIT` at the PO's own company) and calling it right after the existing
  `assertCompanyScope` check. **The guard's regex didn't catch the STO twin of this bug**
  (`sto.handlers.ts`'s `setStoCrcpHandler` uses `assertStoVisibleToContext`, a differently
  named wrapper with the identical membership-only gap) — found by inspection, not the guard,
  and fixed the same way (`canMaintainStoCrcp()`, checked against both `sending_company_id`
  and `receiving_company_id`, allowed if either grants `PROC_STO_CREATE:EDIT`, mirroring
  `assertStoVisibleToContext`'s own either-side fallback shape). Re-ran the guard after both
  fixes: `0 without a secondary EDIT-level ACL check` (was 1).
- **Frontend (`GateEntryCreatePage.jsx`):** new `stoDrawer` state, `openStoDrawer`/
  `closeStoDrawer`/`updateStoDrawerRow`/`confirmStoDrawer`. Selecting an STO in the existing
  `"PO / STO *"` cell now opens this new center `DrawerBase` (`side="center"`, ~920px) instead
  of the old small CSN-picker drawer — header shows Mother PO/Invoice/BOE when the STO is
  `CONSIGNMENT_DISTRIBUTION`; an `ErpDenseGrid` table lists every open STO line with a
  select-checkbox (default checked), Expected qty (read-only), GE quantity (**defaults to
  Expected qty, editable** — resolved per business owner's "everything prefilled, edit only
  what needs editing" principle), Invoice No and LR/BL Date (both prefilled from the line's
  CSN, editable). Confirming pushes only the checked rows into the main `lines` table — each
  constructed with a `csn` object shaped exactly like the existing PO/CSN-drawer flow expects
  (`material_id`, `material_name`, `po_uom_code`, `dispatch_qty`, `invoice_number`,
  `boe_number`, `lr_date`, `csn_type: "DOMESTIC"`) so the existing row-rendering and
  save-payload code needed **zero changes** to handle these rows correctly — replaces the
  triggering placeholder row and appends the rest at the end of `lines`, so a second
  STO/PO entered afterward lands after these, matching the "everything sits below, one after
  another" requirement. Bulk's own version of this drawer is out of scope here, per the
  locked design note above.
- **Verification performed:**
  - `deno check` on all 4 touched backend files, git-stash before/after, location-diffed (not
    raw count, which is non-deterministic per Phase A's own established finding) — **zero new
    errors** on both the gate-entry/CSN pair and the PO/STO pair.
  - `npx eslint` on `GateEntryCreatePage.jsx` — 0 errors, both before and after the
    `material_id` fix below.
  - **Real bug caught and fixed before this was considered done:** the first draft of
    `confirmStoDrawer`'s `csn` object omitted `material_id` — harmless for on-screen display
    (which only needed `material_name`) but would have made `handleSave`'s payload-building
    resolve `material_id: ""` for every STO-drawer-added line, since it reads
    `l.csn?.material_id`, not `l.stoLine?.material_id`. Caught by tracing the exact save-path
    field resolution before declaring the drawer complete, not by a test run.
  - **Full guard suite run per explicit instruction (covering Phase A too, not just Phase
    B):** all 13 runnable local guards green
    (`hardcoded-role-check-guard`, `jsx-no-undef-guard`, `wrong-company-source-guard`,
    `route-acl-registry-guard`, `company-scope-guard`, `company-scope-write-acl-guard`,
    `resource-code-domain-guard`, `frontend-payload-guard`, `stock-posting-guard`,
    `migration-column-scan`, `migration-order-scan`, `approver-chain-guard`,
    `sto-migration-cli-compat-test`) — one real failure found and fixed (the CRCP write-ACL
    gap above), all green on re-run.
  - **`dependency-provisioning-check.mjs` (SU24):** generated report (304 dependency triples,
    whole-app scope) checked for any CRCP-related entry — **zero matches**, confirming Phase A/B
    introduced no new page-to-dependency gap (expected: no new frontend page, no new resource
    code). Did **not** execute the report's broader suggested SQL — that covers ~300 unrelated
    pre-existing triples across the whole app, out of this change's scope, and applying it
    blindly would alter live ACL dependency data for many unrelated features.
  - `acl-master-drift-check.mjs`/`acl-version-capture-drift-check.mjs`/
    `approver-map-integrity-check.mjs`/`migration-integrity-check.mjs` — all whole-DB audits;
    confirmed not applicable to this change (no ACL/capability/menu data touched, no migration
    added — migration count still 609, matching Phase A's last verified state).
  - **Not performed:** live UI click-through (no dev login in this environment).

**Phase D — Implementation Log (2026-09-30)**

> Covers Point 3.3 (Bulk CRCP — confirmed already works unchanged, no
> `delivery_type` branching anywhere in the CRCP allow-list check) plus the two
> new subsections above: "Bulk PO/STO — Effective Date + Cutoff mechanism" and
> "Bulk GE-Creation Drawer — Design". Migration:
> `supabase/migrations/20260930040511_bulk_po_sto_effective_date_ge_fields.sql`
> — applied to **Dev only** (project `ytapuwiqicmvpanmzelb`), reconciled via
> `UPDATE supabase_migrations.schema_migrations SET version = '20260930040511' ...`
> + `NOTIFY pgrst, 'reload schema'`. **Not yet applied to Prod.** Not yet
> committed/pushed, not yet click-tested live (no dev login in this
> environment). **GRN-side carry-forward of the `bulk_*` fields is
> deliberately out of scope for this phase** — business owner's own
> sequencing: "eta implement hoye gele amra GRN side e jabo" (once this is
> implemented, we move to the GRN side) — that is the next phase, not part of
> Phase D.
>
> **✅ GRN-side carry-forward done 2026-10-02** — see "GRN Invoice Mapping +
> Ship-To Leg + Bulk Carry-Forward — Implementation Log" under §3.9.2 below.

- **Migration** adds: `purchase_order.effective_start_date`/`cutoff_date`,
  `stock_transfer_order.effective_start_date`/`cutoff_date` (both Bulk-only,
  nullable), `gate_entry.person_name` (general, all GE types), and
  `gate_entry_line.bulk_challan_number`/`bulk_challan_date`/
  `bulk_invoice_number`/`bulk_invoice_date`/`bulk_container_number`/
  `bulk_ewaybill_number`/`bulk_lr_number` (Bulk-only capture, since Bulk has
  no CSN to carry these). `rst_number` already existed as a generic
  gate-entry-line column pre-dating this phase — reused as-is, not
  duplicated.
- **Backend — `po.handlers.ts`:**
  - `createPOHandler` — parses `effective_start_date`, hard-blocks creation
    when `delivery_type === "BULK"` and it's missing, persists it on the
    `purchase_order` insert.
  - New `setPoEffectiveDateHandler` (`PATCH
    /api/procurement/purchase-orders/:id/effective-date`) — BULK-only,
    company-scoped, gated on the existing `canMaintainPoCrcp()` EDIT check
    (Phase B's own write-ACL fix, reused rather than duplicated), blocked on
    CANCELLED/CLOSED — editable any time otherwise, per the design's "same as
    CRCP" rule.
  - New `resolveBulkCutoffRequirement(poId, companyId, vendorId, materialId,
    deliveryType, cutoffDateInput)` — looks for a successor PO (same
    vendor+company+material, a later `effective_start_date`); if none exists
    and no `cutoff_date` was supplied, returns
    `PROCUREMENT_BULK_CUTOFF_DATE_REQUIRED`; otherwise persists the supplied
    cutoff and returns null (no-op for non-BULK).
  - Wired into `knockOffPOLineHandler` (using the target line's own
    `material_id`) and `knockOffPOHandler` (using the PO's single line, since
    a Bulk PO always has exactly one).
- **Backend — `sto.handlers.ts`:** STO twin of the above —
  `createSTOHandler` parses/validates/persists `effective_start_date`; new
  `setStoEffectiveDateHandler` (`PATCH /api/procurement/stos/:id/effective-date`)
  gated on `canMaintainPoCrcp`'s STO twin `canMaintainStoCrcp` (either sending
  or receiving company); new `resolveBulkCutoffRequirementSto`, grouped by
  `(sending_company_id, receiving_company_id, material_id)` since STO has no
  external vendor. **Wired into `cancelSTOHandler`, not
  `knockOffSTOLineHandler`** — traced via code reading that the line-level
  handler already hard-blocks knock-off once `dispatched_qty > 0`
  (`STO_LINE_ALREADY_DISPATCHED`), so it can never reach the
  in-transit-orphaned risk this mechanism exists to close; `cancelSTOHandler`
  *can* cancel an already-DISPATCHED STO, making it the actual correct hook
  point.
- **Backend — `gate_entry.handlers.ts` (Bulk GE-Creation Drawer):**
  - `isSecurityDepartmentUser(ctx)` — resolves the caller's department via
    `ctx.context.workContextId` → `erp_acl.work_contexts.department_id` →
    `erp_master.departments.department_name === 'SECURITY'` (confirmed live
    against Dev that a real "SECURITY" department exists per company:
    DPT028/038/048/058).
  - `resolveGePersonName(ctx, personNameInput)` — non-Security: auto-fills
    from `erp_core.signup_requests.name` (name only, no user code, per
    business owner's explicit "without ID, Name chole asbe"); Security:
    requires manual input, errors `GE_PERSON_NAME_REQUIRED` if blank. Wired
    into `createGateEntryHandler`, `person_name` added to the `gate_entry`
    insert.
  - New `GET /api/procurement/gate-entries/person-name-context` handler
    (`getGePersonNameContextHandler`) — lets the Create GE page prefill/lock
    the field before the user ever submits, without duplicating the
    Security-department resolution logic client-side.
  - `resolveBulkDocumentWindowUpperBound(table, documentId, groupingFilters,
    materialId, currentEffectiveDate, currentCutoffDate)` — generic
    PO/STO window-upper-bound resolver (successor's `effective_start_date`,
    or this document's own `cutoff_date` if none); `validateBulkDocumentDate`
    checks a vendor-document date against `[effective_start_date, upper
    bound)`.
  - `validateAndPrepareBulkLineFields(...)` — the actual GE-line gate: at
    least one of Challan/Invoice/Container/Ewaybill Number is mandatory, a
    filled Challan/Invoice Number makes its own paired Date mandatory,
    whichever date(s) are filled are checked against the window. Wired into
    **both** the PO branch and the STO branch of `createGateEntryHandler`
    (BULK only — TANKER stays on the existing CSN-based path).
  - `listOpenPOsForGEHandler`/`listOpenSTOsForGEHandler` extended: PO lines
    now carry `ordered_qty`→`expected_qty`; both POs and STOs, when
    `delivery_type === "BULK"`, get a computed `bulk_window_upper_bound`
    attached server-side (via the same `resolveBulkDocumentWindowUpperBound`,
    resolved in parallel per §8B) — lets the frontend drawer validate dates
    in real time with zero extra round trips per keystroke.
- **Routes + ACL registry:** `PATCH .../purchase-orders/:id/effective-date`
  and `PATCH .../stos/:id/effective-date` added to
  `procurement.routes.ts`/`route-acl-registry.ts` reusing
  `PROC_PO_CREATE`/`PROC_STO_CREATE:EDIT` (Phase B's own pattern, not a new
  resource code); `GET .../gate-entries/person-name-context` added reusing
  `PROC_GATE_ENTRY_CREATE:VIEW`. `route-acl-registry-guard.mjs` confirms every
  dispatched route still resolves.
- **Frontend — `POCreatePage.jsx`/`StoCreateFormPage.jsx`:** new "Effective
  Start Date" field, shown only when `delivery_type === "BULK"`, mandatory
  (blocks `handleSubmit` with an inline error otherwise), sent as
  `effective_start_date` (null for non-BULK).
- **Frontend — `EffectiveDateEditModal.jsx`** (new, shared like
  `CrcpEditModal.jsx`): single date field, wired into both `PODetailPage.jsx`
  and `STODetailPage.jsx` as a new header action ("Set Effective Date" /
  "Effective Date: <date>"), shown only for BULK, same edit-guard as CRCP
  (not CANCELLED/CLOSED).
- **Frontend — Cutoff Date retry flow (`PODetailPage.jsx`'s
  `handleKnockOffPo`/`handleKnockOffLine`, `STODetailPage.jsx`'s
  `handleCancel`):** each now attempts the action first; on
  `PROCUREMENT_BULK_CUTOFF_DATE_REQUIRED`, prompts for a Cutoff Date
  (`openActionPrompt`, `YYYY-MM-DD` validated client-side) and retries once
  with `cutoff_date` included — no new modal component needed, reuses the
  existing text-prompt store.
- **Frontend — `GateEntryCreatePage.jsx` (Bulk GE-Creation Drawer):**
  - New "Person Name" header field — auto-filled read-only for non-Security
    users (fetched via the new `getGePersonNameContext()` API call on mount),
    blank + editable + mandatory for Security users; blocks the main Save
    button when blank for a Security user.
  - `selectRef` restructured: BULK sensing (PO **or** STO, checked before the
    existing STO/PO branches) now opens a new single-item-shaped
    `bulkDrawer` instead of the CSN picker or the multi-row STO drawer — Bulk
    always has exactly one material regardless of document type.
  - New `bulkDrawer` state + `openBulkDrawer`/`closeBulkDrawer`/
    `updateBulkDrawer`/`confirmBulkDrawer`/`getBulkDrawerErrors`. The drawer
    shows the 6 header fields (Challan/Invoice Number+Date, Container
    Number, Ewaybill Number) + optional LR Number + RST Number, the vendor
    name (PO) or nothing (STO, no external vendor), the document's own
    Effective Start Date for context, and a single-row table (Material/UOM
    read-only, Ordered/Expected Qty read-only, GE Quantity editable).
    `getBulkDrawerErrors` mirrors the backend's
    `validateAndPrepareBulkLineFields` exactly (same mandatory-identifier and
    paired-date rules) plus the window check against
    `item.effective_start_date`/`item.bulk_window_upper_bound` — runs on
    every keystroke (no debounce needed, pure in-memory comparison), driving
    **real-time red English validation messages** under each offending field
    and disabling the drawer's own "Save to line" button whenever any error
    exists, per the business owner's explicit final instruction. The same
    `getBulkDrawerErrors` check is reused for the main "Save GE" button
    (disabled while any Bulk line in the grid still has an unresolved error)
    and inside `handleSave`'s own pre-submit validation loop, so all three
    surfaces (drawer, row grid, final submit) enforce identically.
  - Re-opening a Bulk row (the row's "Edit Bulk details" button) prefills the
    drawer from that row's already-captured `bulk*` fields instead of
    starting blank.
  - `handleSave`'s per-line payload construction branches cleanly on a new
    `isBulkLine(l)` module-level helper (checks `l.po?.delivery_type ??
    l.sto?.delivery_type`) — the pre-existing code only ever checked
    `l.po?.delivery_type`, meaning a Bulk-type **STO** was silently never
    detected as Bulk at all before this fix (a real latent gap, not
    introduced by this phase — STO Bulk sensing simply never existed until
    now).
- **Verification performed:**
  - `deno check` on the full touched-backend set
    (`po.handlers.ts`+`sto.handlers.ts`+`gate_entry.handlers.ts`+
    `procurement.routes.ts`+`route-acl-registry.ts` together), git-stash
    before/after, location-diffed — **99 errors before, 99 after, zero new**
    (individual-file baselines: 19 for the PO/STO pair, 12 for
    `gate_entry.handlers.ts` alone — both unchanged).
  - `npx eslint` on every touched/added frontend file — 0 new errors (one
    pre-existing unrelated warning on `PODetailPage.jsx`'s `csns`
    dependency, confirmed via diff to predate this phase).
  - Full guard suite: `hardcoded-role-check-guard`, `jsx-no-undef-guard`,
    `frontend-payload-guard`, `wrong-company-source-guard`,
    `company-scope-guard`, `company-scope-write-acl-guard`,
    `resource-code-domain-guard`, `stock-posting-guard`,
    `route-acl-registry-guard` — all green, zero new findings.
  - `migration-integrity-check.mjs` run against Dev: this migration's own
    row (`20260930040511_bulk_po_sto_effective_date_ge_fields`) reconciled
    correctly, confirmed by direct query. Remote count is 611 vs local 610 —
    entirely the pre-existing, unrelated `20260928060000
    inward_qa_test_line_skip_flag` drift flagged earlier in this session
    (no local file exists anywhere in git history for it); not this phase's
    migration, not fixed here (out of scope, someone else's gap).
  - `dependency-provisioning-check.mjs` (SU24): this phase adds no new
    frontend page and no new ACL resource code (the new PATCH/GET routes all
    reuse existing `PROC_PO_CREATE`/`PROC_STO_CREATE`/
    `PROC_GATE_ENTRY_CREATE` resource codes), so no new dependency-mapping
    gap is expected or was found.
  - **Not performed:** live UI click-through (no dev login in this
    environment); Prod migration apply (needs explicit go-ahead, per
    standing dev-then-prod workflow).

**Point 3.2.6 — PO12 (PTO) role**
- Business: the cross-company GE/GRN movement needs to be recorded somewhere structured.
- System: PTO (`pto.handlers.ts`, Gate-23, L6) exists, fully built, 0 real Prod rows —
  "finish or retire" was an open question.
- Gap: the finish-or-retire *decision* is resolved; the actual redesign/implementation gap is
  **not** — PTO still needs substantial real design work (own L6 scope plus the new CRCP
  recording shape), corrected 2026-09-27 after this was first marked fully locked.
- Final Design: 🟡 **DECISION LOCKED 2026-09-27 (finish, don't retire) — mechanism NOT yet
  designed.** Sequencing correction (business owner, 2026-09-27): PTO's actual design is
  deliberately built **after** Point 3.2.3-3.2.5 (CSN, Phase B), not before or in parallel —
  PTO's cross-company recording shape depends on how the CSN-side ownership/attribution model
  ends up being represented, so designing PTO first would risk a mismatch. See the
  Recommended Build Sequence above — this is now Phase C, not Phase B.
  **Further correction (business owner, 2026-09-28):** this point's design is now **merged**
  with the former Phase E (Points 3.2.7/3.2.8/3.4.2) into one unified "Phase C" design — PTO
  must be designed together with the Return-vs-Invoice settlement decision it is meant to
  drive, not separately (see Point 3.2.7's own note and the Recommended Build Sequence above).
  Phase D (Bulk's CRCP variant) was also moved ahead of this merged Phase C in build order —
  a scheduling choice, not a design dependency change.
  **Tab 1 design LOCKED 2026-10-03 — see "PO12 (PTO) — Tab 1 Design" below** (after Point
  3.2.7/the Phase C GST note): the 2-tab split (Tab 1 = CRCP discrepancy + settlement,
  everyone with PO12 access; Tab 2 = physical Transfer/Receive, restricted to an
  SA-configured allow-list of physically-capable company pairs) is business owner's own
  framing. **Tab 2 itself remains undesigned** — explicitly deferred, not part of this lock.

**Point 3.2.7 — Settlement: Return vs. Invoice**
- Business: after a cross-company GE/GRN, the two companies must formally settle — either a
  genuine physical Return (full or installment-based, until the balance clears) or a Sale
  Invoice (final, no physical reversal); already-consumed quantity can only go via Invoice.
- System: `createSTOHandler` always plans quantity first at creation (`balance_qty:
  line.quantity`, `sto.handlers.ts:944,1058`) — no retroactive/balance-referencing STO
  creation exists. Invoice can reuse the existing STO→DO→PGI→Sales Invoice mechanism
  (§113.13-115).
- Gap: Return needs a genuinely new retroactive-STO mechanism (against one GRN or an
  aggregate balance); Invoice path is largely reusable; the consumed-qty
  Return/Invoice-mixing rule has no enforcement anywhere.
- Final Design: ⏳ NOT YET LOCKED

**Phase C — Design Session Started (2026-10-02) — GST legal grounding reframes "Return vs.
Invoice" from an equal business choice into a legally-ordered default + exception.**

Business owner supplied external reference material (GST Bill-To/Ship-To treatment) that
reframes Point 3.2.7:

- Under GST law, a Bill-To (A) ≠ Ship-To (B, as named on the vendor's documents) ≠ Actual
  Physical Receiver (C) scenario is **legally two separate supplies**, not one: **Leg 1**
  (Vendor → Company A — the vendor's own invoice; A is the "deemed recipient" and claims
  ITC on it) and **Leg 2** (Company A → Company C — a **mandatory** Tax Invoice to
  regularize the fact that the goods physically sit with C, not A).
- **Reframes "Return vs. Invoice" as NOT a free business choice for the default case.**
  Invoice (Leg 2, A→C) is the GST-mandatory path whenever C **retains/consumes** the
  goods — which is the normal case, since C-retaining-the-goods is the entire point of
  CRCP. **"Return" only applies when C does NOT want to keep the goods and sends them back
  physically** (to A, or onward) — a genuine reversal, no Leg-2 invoice needed since nothing
  was transacted at C's end.
- **The external material's own "Action Item"** (Company C should record an internal
  Material Receipt Note acknowledging vehicle number + vendor's delivery challan) **is
  already satisfied by Phase A-D's existing CRCP work** — the CRCP-shared company (C) is
  the one who actually performs the GE+GRN (not A), and that GE/GRN already captures
  vehicle number, vendor delivery challan/invoice, etc. No new mechanism needed for this
  part of the legal requirement.
- **Open structural question raised, not yet resolved:** in the CRCP flow, stock physically
  posts under **Company C's own GRN** (C does its own GE+GRN, per Phase A's
  `isCrcpSharedCompany` gate) — **Company A never holds physical stock for this material at
  all.** So Leg 2 (A→C) may need **zero `stock_ledger` movement** on either side (A never
  had stock to move out; C's stock, already GRN-posted, doesn't change) — making Leg 2 a
  **pure financial/value settlement document** (Qty × Rate + GST), not a physical transfer.
  This puts PTO's (PO12's) own physical-movement-type design (P301/P303/P305, Point 3.2.6)
  in question for this specific use case — two options floated, **neither decided yet:**
  1. Leg 2 becomes a **new "Cross-Company Settlement Invoice"** mechanism, reusing the
     existing Sales Invoice/PGI pattern (§113.15) but with no stock posting at all — PTO
     stays untouched, scoped to its own original L6 (physical plant transfer) purpose only.
  2. PTO itself gets redesigned to also support an **invoice-only / no-movement mode** for
     this specific Leg-2 case, alongside its existing physical-movement modes.
- **Resolved 2026-10-03 — Option 2 wins, in spirit:** business owner's own PO12-specific
  idea (see "PO12 (PTO) — Tab 1 Design" below, after Point 3.2.7) settles this as PTO itself
  carrying the invoice-only/no-movement mode — but as its own **separate tab** (Tab 1) rather
  than a mode toggle inside Tab 2's existing physical-movement screens. So PTO absorbs Leg 2
  as designed, without disturbing Tab 2's original L6 physical-transfer purpose at all —
  effectively Option 2's intent, delivered via a tab split instead of a mode flag.

**GRN-level "Ship To Leg" capture — Final Design: ✅ LOCKED 2026-10-02 (business owner +
design session). Scope: CRCP-general — applies to a GRN against any CRCP-enabled PO/STO,
any `delivery_type` (Standard/Tanker/Bulk/STO alike), not Bulk-specific.**
- Replaces the earlier "predetermined Leg 2/3 at CRCP setup" idea (rejected — unworkable for
  Scenario 1's ad-hoc/first-come-first-served pool, since the actual split is unknowable in
  advance). Instead, capture the real Ship-To **per GRN, at the moment the actual vendor
  invoice is in hand** — no prediction, no pre-declaration, purely actual-data-driven (same
  principle as the settlement-leg-amount discussion above).
- New GRN field, **"SHIP TO LOCATION MENTIONED IN INVOICE"** — a dropdown, single-select.
  Shows **Company Code, Name, and State** per option (same display convention as
  `CrcpEditModal`'s own company list). An English helper line tells the user to pick whichever
  company the physical invoice itself names as Ship-To.
- **Default** = the PO/STO's own issuing company.
- **Dropdown options constrained to the PO/STO's own issuing company plus only its
  CRCP-allowed companies** (`purchase_order_crcp_company`/`stock_transfer_order_crcp_company`)
  — never any other company in the system.
- **Hidden entirely when `crcp_enabled = false`** — no field/tab shown at all in the
  non-CRCP case (implicitly the issuing company, no ambiguity to resolve).
- **Mandatory when `crcp_enabled = true`** — GRN's Save button stays disabled until a value
  is selected, same real-time-gating discipline as Phase D's own Bulk Effective Date/GE-drawer
  validation.
- This alone gives the settlement engine (§3.2.7/merged Phase C) all three data points it
  needs, for both the direct (Scenario 1) and chained (Scenario 2) cases, with zero manual
  leg-assignment anywhere: **Bill-To** = the PO/STO's own `company_id` (always, unchanged);
  **Invoice-stated Ship-To** = this new GRN field; **Actual physical receiver** = the GRN's own
  company (already known — whichever CRCP-shared company is performing that GRN).
- **Timing — build now, not deferred:** this data is captured **per-transaction, at GRN
  time** — unlike a config field, it cannot be reconstructed retroactively once a GRN has
  already posted without it (same class of problem as §109's Opening Rate/WAR discussion —
  data missed at transaction time is permanently missed). Business owner confirmed
  (2026-10-02): build this **now**, in the same batch as Phase A/D, before either reaches
  Prod — not deferred to the full Phase C settlement-mechanism build.

**PO12 (PTO) — Tab 1 Design — Final Design: ✅ LOCKED 2026-10-03 (business owner + design
session). Resolves Point 3.2.6's "mechanism NOT yet designed" status for Tab 1 specifically —
Tab 2 (physical Transfer/Receive) stays explicitly un-designed, business owner's own
instruction ("Tab 2 niye akhon vebona").**

**✅ IMPLEMENTATION COMPLETE (2026-10-04, commit `8d32ced`).** Covers every section locked
in this whole Phase C scope end to end — Tab 1 Discrepancy List, CRCP Cost Component Entry,
AC01 "ITC To" + cross-company visibility, Settlement (Leg 2 Invoice) create/reverse/print,
AC01 "Settlement Invoice" column + View/Print, and PO12's own Excel export (the
ErpDenseGrid AutoFilter capability itself was already built separately, commits
`49bc253`/`17189d1`). Migrations: `landed_cost.itc_owner_company_id` + backfill, `SETTLEMENT`
doc-series row, `erp_procurement.settlement_invoice` table + `goods_receipt.
settlement_invoice_id` link + atomic `create_settlement_invoice()`/`reverse_settlement_invoice()`
— verified in rolled-back Dev transactions, including the quantity-mismatch hard-gate firing
correctly. Backend: `crcp_discrepancy.handlers.ts` (Tab 1 list + CRCP Cost Component Entry,
with its own `canWriteCrcp()`/`requireCrcpWriteAccess()` — company-scope-write-acl-guard.mjs
caught the same "resolves a company other than ctx.context.companyId without a secondary
ACL-decision check" gap already fixed once in `ac01.handlers.ts`'s `canWriteAC01()`, same fix
shape applied here), `settlement.handlers.ts` (create/reverse/pending-list/lookup/print-data),
`ac01.handlers.ts` (broadened read + Settlement Invoice column data) — all reusing the
existing `PROC_PLANT_TRANSFER_LIST` resource, no new menu/resource registered. Frontend:
`PlantTransferPage.jsx` (new Tab1/Tab2 wrapper — Tab 2 is the pre-existing
`PlantTransferListPage.jsx`, rendered unchanged), `CrcpDiscrepancyPage.jsx`,
`SettlementInvoicePage.jsx`, `SettlementInvoicePrintPage.jsx` (reuses
`SalesInvoicePrintPage.jsx`'s own `InvoiceCopy`, now exported, as-is), AC01's new column.
Verification: `deno check`/`eslint` both confirmed zero *new* errors via git-stash baseline
diff (93 and 1 pre-existing respectively), all 13 relevant guard scripts clean,
`migration-integrity-check.mjs` confirms both new migrations byte-exact in sync with Dev,
`dependency-provisioning-check.mjs --strict-manifest` clean (added the one missing
`PlantTransferPage.jsx` manifest entry it caught). **Found, not caused by this work:**
pre-existing Dev drift — one old `20260710004438` name mismatch, and 4 remote-only migrations
(`inward_qa_test_line_skip_flag`, `pi_block_company_scope`, `pi_block_lifecycle_cleanup`,
`enable_rls_remaining_business_tables`, `ac06_fg_type_group_scope`) applied to Dev by a
different/concurrent session whose local files this checkout never had — flagged here per
CLAUDE.md's own "two sessions against the same working directory" risk note, not touched.
**Deliberately not built, per explicit business-owner deferral already recorded above (not a
gap):** CRCP Cost Component Entry's own frontend UI/button placement — decide together with
AC01's future Bulk Component Mapper UI. **Not yet done:** live click-through on the deployed
app (no dev login in this environment, per this doc's own established limitation elsewhere).

**PO12 Tab 1 — ACL decision — Final Design: ✅ LOCKED 2026-10-04 (business owner).**
Triggered by checking Prod directly: `PROC_PLANT_TRANSFER_LIST` (the resource Tab 1 and Tab
2 both share) currently has **zero real grant in Prod** — `acl.work_context_capabilities`
shows its 3 existing capabilities (`CAP_PROC_PLANT_TRANSFER` full V/W/E/D/Approve,
`CAP_PROC_LOGISTICS` VIEW-only, `CAP_PROC_PLANT_TRANSFER_VIEW` VIEW-only) assigned **only to
each company's ACL-MASTER work context** — the 2026-08-06 "Stores+Logistics+SCM full
V/W/E/D" lock in `PROD-ACL-Access-Decisions.md` was apparently never actually pushed to a
real (non-ACL-MASTER) work context in Prod, only written down. This correction belongs in
that doc too, not just here — flagged, not yet written there.
- **Locked decision:** Accounts = full access (VIEW+WRITE+EDIT: Discrepancy List, CRCP Cost
  Component Entry, Settlement create/reverse) at **every** CRCP company, not just the ones
  with a physical Stores/Logistics presence. L3_MANAGER and DIRECTOR = full access too.
  P0076 (ACL-MASTER) = full access, as always, automatic. Stores and SCM = VIEW only (they
  need to see the discrepancy/settlement picture, but Tab 1's actions are an Accounts/
  Commercial function, not theirs to write).
- **No new capability needed — reuses the exact AC01 Accounts capability family as-is, found
  live in Prod to already match this split perfectly:** `CAP_ACC_GRN_COST_MAKER` (already
  role-mapped to L1_MANAGER/L1_USER/L2_MANAGER/L2_USER/L3_USER/L4_USER — "Accounts") and
  `CAP_ACC_GRN_COST_PLANTHEAD` (already role-mapped to exactly `L3_MANAGER` + `DIRECTOR`) —
  both already live-granted via `work_context_capabilities` to real Accounts work contexts at
  every CRCP company for AC01 itself, so granting these two capabilities VIEW+WRITE+EDIT on
  `PROC_PLANT_TRANSFER_LIST` needs only new `acl.capability_menu_actions` rows (6 total: 2
  capabilities × 3 actions) — no new `work_context_capabilities` row at all, since the same
  people already hold these capabilities for AC01.
- **Stores/SCM VIEW reuses the existing `CAP_PROC_LOGISTICS` capability** ("Stock transfers
  and plant transfers" — already VIEW-only on this exact resource, confirmed above) — this
  one DOES need new `work_context_capabilities` rows, since it currently has zero real
  (non-ACL-MASTER) grant anywhere in Prod.
- **Rollout sequence (per CLAUDE.md §8's locked "new (capability, menu) grant" rule — insert
  live rows, then `capture_acl_version_source` on a version that has NOT already been
  captured, or a fresh `acl_versions` row if it has, then `generate_acl_snapshot` +
  `rebuild_acl_menu_snapshot`):** build and verify in Dev first (this feature's own migrations
  are Dev-only today, see the implementation note above), then repeat the identical MCP
  sequence in Prod once the code itself is deployed there — same two-step workflow this
  codebase always uses for a schema+ACL pair. Not yet executed in either environment as of
  this lock — next step.

**0. Two-tab architecture (business owner's own framing):**
- **Tab 1 — CRCP discrepancy + settlement + tracking.** Open to every company with PO12
  access, including a pure Bill-To company (e.g. CMP003) that never physically touches the
  material. This is where today's design work below applies.
- **Tab 2 — Transfer/Receive (physical movement).** The existing `plant_transfer_order`
  mechanism (Gate-23, L6 — `pto.handlers.ts`, ONE_STEP/TWO_STEP, 0 real Prod rows today).
  Access restricted to only the companies an SA-configured allow-list flags as
  physical-transfer-capable (business owner's own example: Jayashree ↔ Coatings, 4km apart,
  real Return/transfer physically feasible; companies far apart never get this tab at all,
  they only ever go through the Invoice/Leg-2 path). **Not designed yet** — config shape
  (per-pair vs flat company list), and the tab's own screen/flow, are open for a later
  session.
- **Why Tab 1 alone can carry CMP003's visibility need (resolves this doc's own earlier "PTO
  has no PO/GRN reference, so a non-source/target company can never see it" concern):** Tab
  1 does not filter by `plant_transfer_order.source_company_id`/`target_company_id`
  membership at all — it is a GRN-sourced discrepancy list (§1 below) plus a settlement
  action, neither of which requires CMP003 to ever be a PTO source/target. The concern is
  resolved by construction, not by adding a new reference column to `plant_transfer_order`.

**1. Discrepancy List — row-inclusion rule (corrects this doc's own first draft of the
rule, caught live during this session):**
- **Trigger: `Bill-To ≠ Actual-Receiver`** — not "the underlying PO/STO has `crcp_enabled =
  true`." A GRN on a CRCP-enabled PO/STO that happens to still be received by the issuing
  company itself (Bill-To = Actual-Receiver) is the ordinary/straightforward case and must
  NOT appear here, even though CRCP is technically available on that document.
- The three source fields (no new schema — all already captured): **Bill-To** = the PO/STO's
  own `company_id`; **Ship-To (invoice-stated)** = `goods_receipt.ship_to_company_id`;
  **Actual Receiver** = `goods_receipt.company_id` (whichever CRCP-shared company performed
  the GE+GRN).
- **Per-company visibility, three distinct roles, same underlying rows:**
  - **Bill-To viewer** (e.g. CMP003): sees every row where it is Bill-To and
    Bill-To ≠ Actual-Receiver — regardless of whether Ship-To equals Actual-Receiver (a
    direct, non-chained CRCP case) or differs from it (the fuller 3-way chain case). This
    was the first-draft rule's own bug — it originally required Ship-To ≠ Actual-Receiver
    too, which would have wrongly hidden the simple direct A→C case from CMP003.
  - **Ship-To-named viewer** (e.g. CMP005 in the chain case): sees rows where it is named
    Ship-To but Actual-Receiver differs — **purely informational/audit, no settlement
    action** for this company on this row (see §2 below — Leg 2 settles A→C directly, never
    through the named-but-wrong party).
  - **Actual-Receiver viewer** (e.g. Jayashree): sees rows where it is the actual receiver
    and Bill-To differs.

**2. Settlement Invoice (Leg 2) — a separate button inside Tab 1 (business owner's own
placement decision; its own detailed create-flow is still pending, revisit separately):**
- **Zero `stock_ledger` movement, "direct."** Company A (Bill-To) never had physical stock
  of this material (no GRN exists under its own `company_id`) — there is nothing to receive
  (101) or issue (601). Company C (Actual Receiver) keeps what it already GRN-posted — this
  is the Invoice case precisely because C retains/consumes the goods, so nothing physically
  moves at C's end either. The whole thing is a pure financial/value document: Qty × Rate +
  GST (+ cost components, §3 below).
- **Always issued directly A → C (Actual Receiver), never through a named-but-wrong Ship-To
  party**, confirmed against the business owner's own GST reference material: "Leg 2
  (Company A → Company C)" is stated directly in those terms, not A→B→C. So in the 3-way
  chain case, CMP003 invoices Jayashree directly; CMP005 (named but not actual receiver) is
  never an economic party to this leg, consistent with §1's "informational/audit only" rule
  for that viewer.
- **GRN selection happens at Settlement Invoice creation time** — the invoice itself carries
  the list of GRNs it settles (same pattern as other documents in this codebase that pick
  source rows at create time, e.g. DO picking SO/STO lines). This is also why variance
  tracking (below) needs no separate per-GRN breakdown mechanism — the invoice's own
  GRN-list already is that mapping.
- **Provisional/FOR-inclusive invoicing, for late-arriving transporter bills:** the
  transporter's actual freight bill routinely arrives after the Settlement Invoice must be
  issued. CMP003 issues the invoice now on a FOR (delivered/inclusive) basis, using an
  estimated freight folded into the rate — not broken out as its own line — rather than
  waiting.
- **Variance (provisional estimate vs. actual, once the real bill lands via §3's Bulk Cost
  Component Mapper flow): tracked at the Settlement-Invoice level (aggregate), not per-GRN**
  — business owner's own call, since the invoice's GRN-list is already the per-GRN record if
  ever needed later.
- **Correction is manual, never automatic.** No auto-generated Debit/Credit Note. The
  Debit/Credit Note mechanism itself (how the correction document actually gets created,
  numbered, posted) is explicitly deferred to the already-locked future **Accounts Module
  redesign** session (§111's priority order: Dispatch → Costing/AP-Reco → Accounts Module →
  WAR). Today's lock only establishes that the variance must be visible/flagged for that
  later manual action — not how that action itself works.

**3. CRCP Cost Component Entry (Freight/other, entered by the Bill-To company) — reuses
AC01's existing schema, does not widen AC01's own access model:**
- **Same underlying table, not a mirror.** Tab 1's cost-entry action writes into the exact
  same `erp_procurement.landed_cost`/`landed_cost_line` rows AC01 already uses for this GRN
  — there is still only one landed-cost document per GRN, never two parallel ones to
  reconcile.
- **New, separate write-path — not a change to `canWriteAC01()`/`requireAC01WriteAccess()`.**
  AC01's own access model stays exactly as today: strictly scoped to the GRN's own
  `company_id`. CMP003 never gets AC01 page access to a GRN it doesn't own. Instead, Tab 1
  gets its **own dedicated handler**, gated by PO12's own ACL
  (`PROC_PLANT_TRANSFER_LIST:WRITE`) plus a CRCP condition (the GRN's underlying PO/STO has
  `crcp_enabled = true` AND the caller's company is that PO/STO's own `company_id`, i.e. its
  Bill-To) — a structurally separate authorization path, deliberately not a widening of
  AC01's own check (avoids any risk of that check's semantics drifting for its other,
  unrelated callers).
- **No `cost_type` restriction.** Business owner explicitly declined a system-enforced split
  (e.g. "Bill-To may only add FREIGHT, never UNLOADING") — any party with a valid write-path
  (its own AC01, or this new PO12 path) may add any component, trusted to only enter what it
  was actually billed for.
- **Full mutual visibility by construction, no sync needed.** Because both paths write the
  same rows: the unloading/actual-receiving company (e.g. CMP005) sees CMP003's PO12-entered
  Freight line the next time it opens its own AC01 for that GRN, and can edit/delete it there
  with its own ordinary AC01 write access (no "entered-by" lock distinguishing the two
  origins). CMP003, conversely, sees CMP005's own AC01-entered Unloading Charge from within
  Tab 1 — but only ever through Tab 1's narrow view, never full AC01 (no rate-confirmation
  workflow, no other GRN fields, no page access).
- **Multi-vendor, single-rake freight bill (business owner's own real example — JK White-
  style rail rake, 3 vendors, one transporter bill covering all their containers' freight,
  per-container or proportionate rate, vendor-specific rate):** no new mechanism — reuses the
  already-locked **Bulk Cost Component Mapper** (§3.5.8) as-is, run **once per vendor**
  against the same `bill_reference` (its existing duplicate-prevention warning already
  anticipates this exact repeat-usage shape). **One confirmed refinement to that tool's own
  build, not yet explicit in its original §3.5.8 lock:** its right-side GRN filter list must
  carry **Vendor as an explicit, first-class filter column** (the original text only said "or
  any other column," which is not strong enough given this business rule — freight rate is
  always vendor-specific even when multiple vendors share one rake/bill).
- **Explicitly deferred, not solved now:** the UX efficiency of picking/entering each
  vendor's subset separately against one bill (business owner's own flag — "khub time
  taking hobe") is left for the dedicated future AC01/PO12 Bulk Map UI design session, not
  this round.
- **Still open, not yet decided:** whether the "Add Component" action is a per-row button on
  the Discrepancy List grid itself, or a separate header-level flow (parallel to the
  Settlement Invoice button in §2) — revisit before building Tab 1's frontend.

**4. Material Receipt Note (MRN) — researched, explicitly deferred, not part of this lock:**
- Confirmed via web research (not assumed): MRN/GRN is **not a GST-statutory document** —
  GST law only prescribes the Tax Invoice, Delivery Challan, and E-way Bill. No fixed MRN
  format exists to match against.
- The ITC legal basis for why Company A (CMP003) can claim ITC despite never physically
  touching the goods: CGST Act 2017, **Section 16(2)(b)'s Explanation** — a registered
  person is **deemed to have received** goods delivered to a third party "on the direction
  of" that registered person. So CMP003's own audit trail for its ITC claim is **its own PO
  (crcp_enabled + the CRCP company allow-list, proving it directed delivery to that specific
  company) together with the Actual Receiver's own GRN** (vehicle number + challan,
  already-captured fields, proving the delivery itself genuinely happened) — not a
  separate MRN artifact given to/by anyone.
- **MRN is never "given" between companies** — it is each physical receiver's own internal
  record of its own receipt. In the 3-way chain case, only the Actual Receiver (e.g.
  Jayashree) would ever hold one; the named-but-wrong Ship-To company (CMP005) and the
  Bill-To company (CMP003) never physically receive anything, so neither prepares or
  receives an MRN at all.
- **A formatted/printable MRN view, auto-generated purely from existing GRN fields (zero new
  data, zero new schema)** is technically feasible and was discussed, but business owner
  deferred the decision ("MRN niye pore vaba jabe") — not built, not scheduled, revisit
  later.

**5. AC01 "ITC To" + cross-company visibility — Final Design: ✅ LOCKED 2026-10-04.**
Resolves a real gap this same session's own §4 (MRN) note left open: Section 16(2)(b)'s
deeming Explanation gives CMP003 the *legal* basis for ITC, but PACE itself had nowhere to
*record/report* that ITC — AC01 is GRN-company-scoped (CMP003 never sees it), and the old
`invoice_verification`/`invoice_verification_line` mechanism (Gate-16.8, `IVDetailPage.jsx`/
`BlockedIVListPage.jsx`), while still technically wired (routes live, tables exist), is
**confirmed by business owner to be practically dead** — "আগের AC01-কে change করেই current
AC01 করা হয়েছে" (the old AC01 was redesigned INTO the current one; there is no still-living
separate predecessor). So fixing/extending the old IV mechanism (an earlier draft of this
same lock) was the wrong target — discarded.

**Two ideas considered and rejected before this one, kept here so neither gets re-proposed
later:**
- **P101 (receipt) → auto-generate STO → P601 (GI for dispatch) at CMP003**, purely to give
  CMP003 a legitimate "receipt" event to hang GST/ITC data on, reusing the already-built
  STO→DO→PGI→Sales-Invoice pipeline instead of a bespoke Settlement mechanism. **Rejected —
  double-counting risk:** the Actual Receiver (e.g. Jayashree) already posted its own real
  GRN against the vendor's delivery; if the STO's own receiving leg also posted a receipt at
  Jayashree, the same physical material would be counted twice in its stock. Would only be
  salvageable by making the STO's receiving leg a pure no-op/paper reference — a bespoke,
  awkward variant of an already-built mechanism, not reused cleanly.
- **A plain grid column showing the GRN's own Invoice Number/Rate/GST** (readable by eye,
  already true of the already-locked Discrepancy Grid). **Rejected as insufficient on its
  own** — business owner's own correction: "CMP003 jeta korche seta Sale only, tai ITC
  dekhate gele to inward ba equivalent kichu dekhate hobe" (what CMP003 does is Sale-only;
  to show ITC there must be an inward-equivalent too). A human reading a grid column is not
  the same as PACE's own data having a reportable "this is CMP003's own ITC-relevant entry"
  attribution — a future GST/ITC report could never correctly group/sum by company from a
  value that structurally still belongs to Jayashree's own row.

**Locked mechanism — no stock movement, no new document, one new column + one broadened
visibility rule on AC01 itself:**
- **New column, `landed_cost.itc_owner_company_id`** (header-level, one per GRN — **not**
  per-line: confirmed sufficient because Unloading Charge never actually carries GST in this
  business, option exists in the UI but is never used in practice, so there is no competing
  claim to reconcile between it and Freight's own, genuinely GST-bearing, ITC owner).
  Defaults to the GRN's own `company_id` for the ordinary, non-CRCP case (so an ordinary
  purchase's "ITC To" is simply that same company, exactly matching today's reality with
  zero behavior change) — explicitly set to the PO/STO's own Bill-To `company_id` for a
  CRCP-flagged GRN.
- **Two distinct tags, not one — do not conflate them:** `itc_owner_company_id` (who the
  GST credit legally belongs to — this is what any GST report groups/sums by) is **not**
  the same as "who physically keyed this line in" (a separate audit-trail concern, already
  covered by the table's own `created_by`; no new field needed for that half). Caught live
  in this same session: Jayashree might be the one who happens to key in a cost line, while
  the GST credit on that exact line still belongs to CMP003 — an "entered by" tag would
  have wrongly implied Jayashree owns that ITC.
- **AC01's own list/read query is broadened** (its *write* path stays exactly as already
  locked — unchanged, still strictly GRN-company-scoped, no widening of
  `canWriteAC01()`/`requireAC01WriteAccess()`): a company's AC01 now lists a GRN whenever
  EITHER it owns the GRN (`goods_receipt.company_id`, today's existing rule) OR it is that
  GRN's `itc_owner_company_id` (the new CRCP case). CMP003 therefore sees this GRN's full
  row in its own AC01 — vendor, rate, every existing field — but **read-only**: CMP003 has
  no write access there (per the already-locked rule), its only write path for this GRN
  remains PO12's own Cost-Component-Entry action.
- **Live, two-way sync by construction, not by any new sync code:** since both views read
  the exact same `landed_cost`/`landed_cost_line` rows, a Freight line CMP003 adds via PO12
  appears immediately in Jayashree's own (fully editable) AC01 view of that GRN, and an
  Unloading Charge line Jayashree adds via its own AC01 appears immediately in CMP003's
  (read-only) mirrored view — no additional plumbing needed beyond the one new column and
  the one broadened query.
- **Unloading Charge's own existing GST Yes/No toggle on `landed_cost_line` is completely
  untouched** — business owner's explicit instruction: the option to mark GST on Unloading
  stays exactly as coded today (user's own free choice per line); this lock changes nothing
  about that toggle, it only adds the new `itc_owner_company_id` column alongside it.

**6. Tab 1 Discrepancy Grid — UI (ErpDenseGrid, full Excel-style keyboard navigation),
LOCKED column order:**
1. **CRCP Triangle** — Bill-To Company, Ship-To Company (invoice-stated), Actual Receiving
   Company (all company_code — company_name, never raw UUID, per §8A)
2. **Quantity** — GRN Quantity + Base UOM
3. **Identification** — GRN Number, GRN Date, PO Number / STO Number, Vendor Name, Material
   Name + External Code
4. **Document Numbers + Dates** — Invoice Number + Date, Delivery Challan Number + Date,
   Container Number, E-way Bill Number, RST Number, LR Number + Date, Transporter Name
5. **AC01 Relation** — Landed Cost Total, Rate Confirmed, Settlement Status (Pending /
   Settled, derived from whether a Settlement Invoice already references this GRN)
- **Filters, above the grid:** one single all-column free-text search bar (same pattern as
  the GRN Invoice Mapping page — one box, not per-field filters, for speed); a **Date Range +
  Date-Column dropdown** (choices: GRN Date, Invoice Date, Delivery Challan Date, LR Date) —
  same established `date_field`+`date_from`+`date_to` pattern already used by AC01/IN02, not
  a new mechanism. **Per-column Excel-style AutoFilter also applies here** — see
  `ErpDenseGrid`'s new `columnFilter`/`filterType: "date"` capability, locked just below.
- **"Export Excel" — exact same mechanism as AC01, Final Design: ✅ LOCKED 2026-10-04.**
  Reuses the shared `downloadColoredExcelFile()` helper
  (`frontend/src/shared/downloadColoredExcelFile.js`) verbatim — not a new export
  mechanism, not a plain-CSV fallback. Same pattern AC01's own `handleExportExcel()`
  already uses: `exceljs` loaded via dynamic `import()` only at the moment "Export Excel"
  is actually clicked (never part of this page's own bundle), workbook built from the
  grid's own column definitions (`getCellValue` defaulting to `copyValue`/raw
  `row[column.key]`, with `getCellColor`/`getCellRichText` available for any column that
  needs a colored/status cell — e.g. Settlement Status Pending/Settled — same as AC01's
  rate-status coloring), identical header styling (slate-800 fill, bold white font).
  **One "Export Excel" button** in `ErpMasterListTemplate`'s own `actions` (label toggles
  "Exporting..." while in flight, disabled when exporting or when the grid has zero rows)
  — present on **both** Tab 1's own Discrepancy Grid and the Settlement page's own grid
  (Pending + Settled tabs), since both are the same grid reused. Exports exactly the
  grid's own current filtered/sorted row-set (respecting the all-column search bar, Date
  Range filter, and any active per-column AutoFilter selection) — same "what you see is
  what you export" behavior AC01 already has, not a separate unfiltered full-table dump.

**ErpDenseGrid — Excel-style per-column AutoFilter — Final Design: ✅ LOCKED + BUILT
2026-10-03/04.** Came up directly from this grid's own filter needs, built as a shared
`ErpDenseGrid` capability (not page-local) so any table built on it can opt in.
- **Opt-in, `columnFilter={true}` prop — default off, zero behavior change for any of this
  component's 119 existing callers.** A funnel button in each filterable column's header
  opens a checkbox dropdown of that column's own distinct values, dependent/cascading on
  every OTHER column's currently-active filter (same as real Excel — filtering column A
  narrows what column B's own dropdown can even offer, in either order, since the math is
  symmetric). The dropdown's own search box narrows the checkbox list live on every
  keystroke (same autosuggest feel as Excel/Google Sheets' own filter box). A column opts
  OUT with `filterable: false` (e.g. an Action-button column, nothing meaningful to filter);
  a column with a custom `render` should supply `filterValue(row)` (falls back to
  `copyValue`, then the raw `row[column.key]`).
- **Date columns get `filterType: "date"`** — the dropdown becomes a collapsible
  Year → Month → Day tree with tri-state checkboxes (checking a Year/Month toggles every
  date it rolls up) and expand/collapse, matching Excel's own date-column AutoFilter
  exactly. Parses either of this codebase's two existing date-string conventions (ISO, or
  this app's own DD-MM-YYYY display format) from `filterValue`/`copyValue`; anything
  unparseable falls into an "Other" bucket rather than being silently dropped.
- **Selection is a draft, committed only on "OK"** (not on each checkbox click) — toggling
  individual checkboxes doesn't re-filter/re-render the whole grid mid-selection. The panel
  is portaled to `document.body`, positioned off the filter button's own bounding rect (same
  technique as `ErpComboboxField`'s own dropdown), escaping the grid's own scroll-viewport
  clipping.
- **Header label never gets crowded by the new button** — the label sits in its own
  `flex-1 truncate` slot, the funnel button is `flex-shrink-0`, so a narrow column's name
  stays readable (ellipsis, not squeezed) regardless of the icon.
- **Deliberately NOT turned on for any of the 119 existing `ErpDenseGrid` callers in this
  same pass** — business owner's own call: flipping it on everywhere at once is cosmetically
  harmless (every header just gains a small icon; no page's data/behavior changes until a
  user actually opens a dropdown and applies a filter), but doing it *correctly* means
  walking each file's own column definitions first (which need `filterable: false`, which
  date column needs `filterType: "date"`, which custom-render column needs a real
  `filterValue`) — a dedicated future sweep, not a blind one-line flip across 119 files in
  this same session. This page's own grid (and the Settlement page's grid, below) is the
  first real caller.
- Commits: `49bc253` (flat per-column filter), `17189d1` (date-column Year/Month/Day tree).

**Settlement (Leg 2 Invoice) — a separate button inside Tab 1, reached from a Pending-status
Discrepancy row — Final Design: ✅ LOCKED 2026-10-04 (business owner + design session).**
- **One page, two tabs — "Pending" (create) and "Settled" (view + reverse)** — same shape as
  the GRN Invoice Mapping page's own Pending/Mapped split, reused rather than building a
  second standalone page for reversal.
- **"Pending" tab — create flow:**
  - **Header:** Tally Invoice Number + Date; Posting Date (tied to/against the Tally Invoice
    Date, not independently entered); **Invoice Quantity** (manually entered, the commercial
    total this real external invoice states) alongside a **live, read-only Running Total**
    of the currently-checked rows' own Quantity column; Rate per UOM; Currency; **Freight
    Term** (reuses the exact same `FREIGHT_TERM_OPTIONS` already defined in
    `POCreatePage.jsx`/`SOCreatePage.jsx` — FOR / Freight Separate / Freight at Actuals / Ex
    Transporter Godown, no new options invented — this is the same field that formalizes the
    earlier-locked provisional/FOR-inclusive-invoicing behavior into an explicit choice, not
    a separate new mechanism); **Payment Terms** (reuses the existing
    `usePaymentTermOptionsQuery` hook + dropdown pattern, same as `SOCreatePage.jsx`); GST
    rate + Inclusive/Exclusive; CGST+SGST vs IGST (reuses `deriveSalesInvoiceGstType()` from
    `sales_order.handlers.ts`, already shared across SO/DO — compares the two companies'
    state names, no new GST logic); **Cost Center** — two fields, Bill-To Company's own cost
    center and Actual-Receiver Company's own cost center, same shape as
    `stock_transfer_order.sending_cost_center_id`/`receiving_cost_center_id`; **Rebate** — the
    same 4-field set `stock_transfer_order_line` already has (`has_rebate` Yes/No,
    `rebate_rate`, `rebate_rate_uom_basis`, `rebate_remarks`), copied as-is, no new shape
    invented. Both Cost Center and Rebate live at the **header** level here (unlike STO,
    which has them per-line) — Settlement has no independently-editable line items of its
    own, only already-posted GRN rows being referenced/checked, so there is nothing for a
    per-line value to attach to.
  - **No approval workflow anywhere on Settlement** — same as the already-locked Reverse
    action, ordinary PO12 write access is sufficient for Create too (business owner,
    2026-10-04).
  - **Bill-To / Actual-Receiver company are never separate header fields of their own** —
    they are always derived from the checked GRN rows themselves (Bill-To = those GRNs'
    shared PO/STO company_id, Actual-Receiver = those GRNs' shared `company_id`), reusing
    existing data rather than re-entering it.
  - **Match rule — hard gate on posting:** `Invoice Quantity` must exactly equal the Running
    Total of the checked rows; the Settlement action stays disabled on mismatch — same
    disabled-button discipline as the GRN Invoice Mapping page's own Map button.
  - **Grid:** the same Discrepancy Grid as above (identical columns), filtered to
    Settlement Status = Pending only, with a row checkbox and the same column-filter
    capability.
  - **Posting is a single atomic transaction** (one dedicated plpgsql function, not routed
    through `post_document()`/`posting_source_registry` since there is zero `stock_ledger`
    movement to post — this is purely a business-table write, not a stock posting): creates
    the Settlement Invoice header row and flips every selected GRN's Settlement Status to
    `SETTLED` with a reference back to this invoice, all in one commit.
  - **New global Document Number Series entry — `SETTLEMENT`, range start `9900000001`
    (band `99xxxxxxxx`), `pad_width=10`** — same §8 global/non-company-scoped mechanism
    every other doc_type uses (`generate_doc_number()`), **not** a reuse of the externally-
    entered Tally Invoice Number (that stays a separate tracking field, same dual-number
    shape Sales Invoice already has: its own internal number *and* a separately-tracked
    Tally reference). Confirmed free in **both** Dev (`ytapuwiqicmvpanmzelb`) and Prod
    (`bsjpvkigpllichlknmah`) via a live query of each project's own
    `erp_procurement.document_number_series` — both are in sync on the full doc_type set,
    highest band taken in either is `SRET` at `98xxxxxxxx`, so `99xxxxxxxx` is clear in
    both.
- **"Settled" tab — reversal flow, whole-invoice only, never a specific row:**
  - User types the Settlement Invoice's own Number + Date (same "type + Check" lookup
    pattern as the GRN Invoice Mapping page's "Map to existing Invoice" toggle) → every GRN
    row this invoice covers displays **read-only** → a single **"Reverse"** button.
  - **Deliberately whole-invoice, no per-row reversal** — business owner's own instinct,
    confirmed: the header's own commercial values (Invoice Quantity, Rate, GST amount) were
    fixed against the *total* of every covered row at posting time; dropping one row without
    also re-deriving those header values would both break this page's own match rule and
    require editing a real, externally-issued Tally invoice number's stated commercial
    terms after the fact — the same complexity class already deliberately kept out of scope
    elsewhere in this doc (the PR19-style Partial Reversal mechanism, a separate, much
    larger design). If the wrong rows were posted, the fix is reverse the whole invoice,
    then re-settle correctly from scratch — never patch a single row out of a posted one.
  - **Reverse flips `status = REVERSED`** on the Settlement Invoice and resets every row it
    covered back to Settlement Status `Pending` (reappearing in Tab 1's own Pending list) —
    no stock movement exists to unwind, so this is a pure status-flip, simpler than
    GRN/PO/Sales-Invoice reversal.
- **No separate approval on Reverse (business owner, 2026-10-04)** — ordinary PO12 write
  access (same ACL grant the Settlement create action itself uses) is sufficient; no
  mandatory-reason field, no extra role gate beyond that.

**AC01 "Settlement Invoice" column + View/Print — Final Design: ✅ LOCKED 2026-10-04.**
Closes the loop opened by the §5 "AC01 ITC To" lock above: that lock gets CMP003 a visible,
read-only row in its own AC01 for a CRCP GRN; this lock makes that row show which Settlement
(Leg 2) invoice, if any, has already recognized it — and lets anyone print/view that invoice
in the same format already used for Sales Invoices.
- **New AC01 column, "Settlement Invoice"** — shown only for rows where the viewing
  company = that GRN's `itc_owner_company_id` in the CRCP case (i.e. exactly the same rows
  the §5 broadened-visibility rule already surfaces). **Displays the Tally Invoice Number**
  (not the internal `SETTLEMENT` series document number) — corrected mid-design from an
  initial wrong proposal of showing the internal series number instead. This is consistent
  with, not in conflict with, the Settlement page's own already-locked header fields and its
  "Settled" tab reversal lookup above: both of those were always keyed on **Tally Invoice
  Number + Date** as the primary, user-facing identifier (the header's own first fields), not
  on the internal `SETTLEMENT` series number — that internal number is a backend system
  document reference only (same role as every other `document_number_series` entry — PO
  number, STO number, etc.), never the primary key a user types or reads to find a specific
  Settlement. So this column's choice needed no change to anything already locked above, only
  a correction to this one new proposal.
- Since one real Settlement invoice commonly covers many GRN rows (one Tally Invoice Number
  can repeat across multiple rows), each covered row independently shows that same Tally
  Invoice Number in this column — no special multi-row grouping/merging needed in the grid.
- **Clicking the Tally Invoice Number (or a separate "View/Print" action next to it) opens
  the exact same print template Sales Invoice already uses** — `SalesInvoicePrintPage.jsx`
  (3 copies: Original for Recipient / Duplicate for Transporter / Triplicate for Consignor,
  `@media print` layout) — reused as-is, not forked/duplicated.
  - **"Invoice No." needs no change at all** — the template already resolves it as
    `invoice.tally_invoice_number || invoice.invoice_number`, i.e. it already prefers the
    Tally number exactly as this column now also does.
  - **"Delivery Note" / "Delivery Note Date"** (today `delivery.dc_number`/`delivery.dc_date`
    — the template's own closest "origin reference" slot; there is no literal "STO Number"
    field in this template) — for a Settlement-origin invoice, this slot instead shows the
    **internal Settlement Document Number + Date** (the `SETTLEMENT` series number locked
    above). This is the one place the internal system number is still shown to a user — as
    the origin-reference audit trail, the same role a DC number plays for an ordinary Sales
    Invoice print, not as the invoice's own primary identity (that stays the Tally number
    throughout, both in this AC01 column and in "Invoice No." on the print itself).

**Correction to this doc's own CLAUDE.md note (2026-10-04) — Prod Supabase access.**
CLAUDE.md states "আমার MCP শুধু dev-এ যুক্ত, prod আমি কখনো দেখিনি" (MCP is dev-only, Prod has
never been seen). **This is now stale** — `mcp__Supabase__list_projects` returns both
`ytapuwiqicmvpanmzelb` ("pace-erp-dev") *and* `bsjpvkigpllichlknmah` ("pace-erp", i.e. Prod)
as accessible projects, confirmed by successfully running a live read-only query against the
latter (the `document_number_series` check above). Access appears to have been added at some
point without the note being updated. Going forward: Prod verification (read-only checks like
this one) can be done directly in-session rather than always deferring to "business owner
checks Prod separately" — still never write/apply anything to Prod without explicit
business-owner sign-off, per the existing dev→prod workflow (§7), but reads no longer need to
wait.

**Point 3.2.8 — Generalization (not CRCP-only)**
- Business: this Return-vs-Invoice choice applies to any inter-company stock movement,
  including a plain, deliberate STO with no vendor/PO involved at all.
- System: `sto.handlers.ts` has no "Return" concept anywhere today — only Cancel (pre-dispatch)
  and the Invoice/Sale path.
- Gap: STO's only settlement path today is Invoice; Return doesn't exist for STO at all.
- Final Design: ⏳ NOT YET LOCKED (design should live at the shared STO/PTO lifecycle level,
  not as a CRCP-only branch — see Point 3.2.7)

**Point 3.2.9 — CRCP timing (post-approval editability)**
- Business: the CRCP allow-list can't be fixed only at PO/STO creation — the unload
  destination is often still unknown then, even for Bulk.
- System: no CRCP mechanism exists yet to have a timing constraint on.
- Gap: whatever CRCP mechanism gets built (Point 3.2.2) must be editable post-`APPROVED`/
  `CONFIRMED`, as a lightweight action separate from PO/STO's heavier amendment-approval flow.
- Final Design: ✅ **LOCKED 2026-09-27 (code+Prod-verified, no blockers found).** Editable by
  **any user holding ordinary PO/STO-create ACL access** — verified as the real, existing
  resource codes `PROC_PO_CREATE:WRITE` (PO) and `PROC_STO_CREATE:WRITE` (STO) in
  `route-acl-registry.ts` — no separate CRCP-specific role needed. Editable at **any PO/STO
  status except `CANCELLED` and fully `CLOSED`** — including after `APPROVED`/`CONFIRMED` and
  through `PARTIALLY_RECEIVED` — as a lightweight action, independent of PO/STO's commercial-
  term amendment-approval workflow (that heavier flow stays untouched).

**Phase A — Implementation Log (2026-09-27)**

> Covers Point 3.2.2 (CRCP flag itself) + Point 3.2.9 (post-approval editability), and
> resolves Point 3.2.1 as a byproduct (with the documented CSN-drawer interim limitation).
> Built directly (no subagent delegation, per explicit business-owner instruction), verified
> statically, **not yet applied to Prod, not yet committed** — both pending explicit go-ahead.

- **Migration (Dev only, `supabase/migrations/20260927130000_crcp_cross_company_po_sto.sql`):**
  adds `purchase_order.crcp_enabled` (boolean, default false) + new junction table
  `erp_procurement.purchase_order_crcp_company` (`po_id`, `company_id`, `created_by`,
  `created_at`, unique on `(po_id, company_id)`, indexed on both FK columns); same pair for STO
  (`stock_transfer_order.crcp_enabled` + `erp_procurement.stock_transfer_order_crcp_company`).
  Both junction tables are **allow-list-only** — they store the *additional* shared companies
  only, never the document's own company — so "own company always included, can't be removed"
  needs zero enforcement code, it's structurally never a row. Applied via
  `mcp__Supabase__apply_migration`, reconciled to the local filename's timestamp in
  `supabase_migrations.schema_migrations`, `NOTIFY pgrst, 'reload schema'` run,
  `node scripts/migration-integrity-check.mjs` confirmed `in_sync: true` (609 files, md5
  `377c2f61346f90e362ed88c9534ad86b`). **Prod: not yet applied** — same MCP sequence must be
  repeated there before go-live, per the dev→prod workflow (§7).
- **Backend — PO (`supabase/functions/api/_core/procurement/po.handlers.ts`):** new
  `setPoCrcpHandler` (`PATCH`, validates status ∉ {CANCELLED, CLOSED}, replaces the company
  allow-list transactionally); `attachPoCrcpCompanyCodes()` bulk-resolves company codes onto
  `listPOsHandler`'s response rows; `getPoFilterOptionsHandler`'s company query widened to
  include `state_name` (needed for the "Code — State — Name" picker format); `getPOHandler`
  now bulk-fetches and returns `crcp_company_ids` for the edit modal to pre-select against.
- **Backend — STO (`supabase/functions/api/_core/procurement/sto.handlers.ts`):** new
  `setStoCrcpHandler` (same shape as PO's, header-level); `listSTOsHandler` bulk-resolves
  `crcp_company_codes` per row (only queries `purchase_order_crcp_company`-equivalent rows for
  STOs actually flagged `crcp_enabled`, not every row); shared `hydrateSto()` (used by
  `getSTOHandler`) now returns `crcp_company_ids`.
- **Backend — Gate Entry (`supabase/functions/api/_core/procurement/gate_entry.handlers.ts`):**
  new helper `isCrcpSharedCompany(table, idColumn, documentId, companyId, crcpEnabled)`; the PO
  and STO branches of `createGateEntryHandler`'s company-scope check both now try this helper
  **before** the existing hard `GE_COMPANY_SCOPE` rejection — this is the one gate-change that
  makes cross-company GE possible at all (Point 3.2.1's fix). STO's `stock_transfer_order`
  select widened to include `crcp_enabled`. `listOpenPOsForGEHandler`/`listOpenSTOsForGEHandler`
  both widened from a plain `.eq("company_id", companyId)` to an `.or()` that also matches any
  PO/STO id present in that caller's CRCP allow-list, so a shared company's gate staff can
  actually find the document in the GE-creation picker, not just pass the write-time check.
  **No changes needed in `grn.handlers.ts`** — verified `updatePoLineReceipt`/
  `reversePoLineReceipt` (lines 213-249) already decrement/restore `purchase_order_line.open_qty`
  with no `company_id` check anywhere, i.e. the shared-pool/first-come-first-served balance rule
  (Point 3.2.1's "Final Design") was already correct, unmodified, existing behavior.
- **Routes + ACL:** two new `PATCH` routes registered in
  `supabase/functions/api/_routes/procurement.routes.ts`
  (`/api/procurement/purchase-orders/:id/crcp`, `/api/procurement/stos/:id/crcp`), both gated in
  `supabase/functions/api/_acl/route-acl-registry.ts` on the **existing** resource codes
  `PROC_PO_CREATE`/`PROC_STO_CREATE` with `action: "EDIT"` — no new resource, no new role, per
  Point 3.2.9's lock (ordinary PO/STO-create access is sufficient).
- **Frontend — shared component:** new
  `frontend/src/pages/dashboard/procurement/CrcpEditModal.jsx` — On/Off toggle + (when On) a
  checkbox list formatted `company_code — state_name — company_name`, own company shown
  checked+locked at the top. Built with lazy `useState(() => ...)` initializers and no
  `useEffect`-driven `setState` (the parent conditionally mounts it fresh on open,
  `{crcpModalOpen ? <CrcpEditModal .../> : null}`) — avoids the
  `react-hooks/set-state-in-effect` lint rule outright rather than suppressing it.
- **Frontend — API client (`procurementApi.js`):** `setPoCrcp(id, data)` /
  `setStoCrcp(id, data)`, both `PATCH` wrappers.
- **Frontend — Detail pages:** `PODetailPage.jsx` and `STODetailPage.jsx` both gained a
  "CRCP" / "CRCP (On)" action button (hidden once status is CANCELLED/CLOSED via a
  `canEditCrcp` guard mirroring the backend check), wired to the shared modal and
  `setPoCrcp`/`setStoCrcp`, refetching the detail query on save. **Deliberately a post-creation
  Detail-page action only** — not wired into the Create flow — matching Point 3.2.9's lock that
  the destination is often unknown at creation time, and avoiding unneeded Create-page
  complexity for what usually isn't even the primary path.
- **Frontend — List pages:** `POListPage.jsx` and `STOListPage.jsx` both gained the two
  required columns — `CRCP` (Yes/—) and `Shared With` (comma-joined company codes, truncated
  with a full-list tooltip), sourced from the backend's new bulk-resolved fields.
- **Legacy PO / Legacy STO — confirmed to need zero additional work.** Verified by reading
  `POCreateOpeningPage.jsx`: it calls the exact same `createPurchaseOrder`/`confirmPurchaseOrder`
  functions and lands on the exact same `PROC_PO_LIST` page as a regular PO. Legacy/Opening
  POs and STOs (`is_opening_po`/`is_opening_sto`) live in the same `purchase_order`/
  `stock_transfer_order` tables and the same List/Detail pages — so the migration, the two new
  handlers, the two new routes, and both List/Detail page changes already cover them with no
  separate branch anywhere.
- **Never printed:** confirmed by inspection, no code change needed —
  `PrintPreviewPage.jsx` (shared by both PO and STO print views) explicitly hardcodes which
  named fields render; it never spreads/dumps the row, so CRCP fields are excluded by simple
  omission.
- **Verification performed:**
  - `npx eslint` on all new/touched frontend files — 0 errors (after fixing the
    `react-hooks/set-state-in-effect` violation above).
  - `deno check` on all touched backend files, git-stash before/after — raw `[ERROR]` counts
    differed (91→99) but a location-by-location diff of `at file://...` lines was **identical**
    between the two runs, and a targeted grep for the 4 touched files found zero matches in the
    "after" output; concluded the raw-count delta was deno's own non-deterministic output
    formatting across separate invocations, not a real new error. **Zero new errors, confirmed
    by location-diff, not by raw count.**
  - `node scripts/route-acl-registry-guard.mjs` — 0 missing registry matches (both new PATCH
    routes matched correctly).
  - `node scripts/jsx-no-undef-guard.mjs`, `node scripts/hardcoded-role-check-guard.mjs`,
    `node scripts/wrong-company-source-guard.mjs` — all clean, 0 new violations.
  - `node scripts/migration-integrity-check.mjs` — Dev confirmed `in_sync: true`.
  - **Not performed:** live/UI click-through in the deployed app (no dev login available in
    this environment) — functional correctness rests on the static verification above only,
    not on an end-to-end click-through yet.
- **Known, explicitly deferred interim gap (not a Phase A defect):** per Point 3.2.1's own
  Final Design note, `listOpenCSNsForGEHandler` still filters CSNs to the caller's own company,
  so a CRCP-shared company won't see the original CSN in the GE drawer for Standard/Tanker
  POs — cross-company GE for those still goes through the same CSN-less/direct-`po_line_id`
  path Bulk already uses, until Phase B (Point 3.2.3) ships. This was confirmed and explicitly
  accepted by the business owner before implementation began.

**Point 3.3 — Scenario 3 (Bulk)**
- Business: every Scenario-2 issue applies to Bulk too, consistently (not occasionally); Bulk
  additionally has a standing, deliberate Bill-To (e.g. CMP003) ≠ Ship-To (CMP011/CMP005)
  pattern.
- System: `createCsnsForPo` (`po.handlers.ts:934-936`) returns immediately for
  `delivery_type === "BULK"` — no CSN ever created. Bulk GE references `po_line_id` directly
  (`gate_entry.handlers.ts:374-414`), hitting the same `GE_COMPANY_SCOPE` block as Point 3.2.1.
- Gap: same blocking gap as 3.2.1 (same CRCP fix applies); no CSN layer at all means the
  3.2.3-3.2.5 mechanisms must be redesigned as pure GE/GRN + PTO logic for Bulk, not
  CSN-based; the "known upfront" Bill-To≠Ship-To pattern does **not** exempt Bulk from needing
  Point 3.2.9's post-approval editability.
- Final Design: ✅ **LOCKED 2026-09-30 (business owner + design session), pending code+Prod
  blocker-check before implementation.** Same CRCP mechanism as Phase A (flag + company
  allow-list + shared pool), applied to Bulk with **no CSN involved at all** — Bulk simply
  never creates a CSN, so Point 3.2.1's GE-creation allow-list check is the only piece that
  needed to extend to Bulk; Points 3.2.3-3.2.5 (CSN split logic) do not apply here by
  construction. Bulk-type STO (`stock_transfer_order.delivery_type = 'BULK'`) gets the
  identical treatment — same drawer/field mechanism, applied to the STO branch of
  `createGateEntryHandler` instead of the PO branch. **Explicitly parked, not part of this
  lock:** the future CRCP settlement/invoice-adjustment STO (merged Phase C) is a
  differently-shaped, later mechanism — not to be conflated with ordinary Bulk-type STO
  dispatch handled here.

**Bulk PO/STO — Effective Date + Cutoff mechanism (LOCKED 2026-09-30, business owner).**
Resolves the real gap found while designing Bulk's CRCP flow: a Bulk PO has no CSN, so
(unlike the CSN-based path, where `knockOffPOLineHandler`'s `inactivateCsnsForPo(...,
eligibleStatuses: ["ORD"])` safely leaves an already-in-transit CSN alone) knocking off a
Bulk PO line has **no way to know** whether a shipment is still legitimately in transit under
that PO — verified live in `knockOffPOLineHandler`, which has no equivalent safeguard for
Bulk. A qty-based "declare pending in-transit amount" fix was considered and **rejected**
(business owner: would require the team to keep phoning the vendor to find out, not workable).
**Locked mechanism instead — self-enforcing from the vendor's own paperwork, no
vendor-communication dependency:**
- New field **Effective Start Date** on Bulk PO/STO (distinct from PO/STO Date), set at
  creation, editable later at any time — same post-approval editability as CRCP (Point 3.2.9).
- A PO's validity window is **[its own Effective Start Date, the next chronologically-later
  Effective Start Date for the same vendor+company+material combination)** — the moment a new
  PO (say PO B, effective 1 Dec) is created for the same vendor/company/material as an
  existing PO (PO A, effective 1 Oct), PO A's window automatically closes at 1 Dec — no manual
  end-date entry needed on PO A.
- If a PO/STO has no successor yet and gets manually knocked off/closed, the window does
  **not** stay unbounded — knock-off itself must capture a cutoff date at that moment (same
  role as a successor PO's effective date would have played).
- **What actually gets validated, and when:** the check is against the **vendor's own
  document date** (Challan/Invoice date entered at GE — see the drawer design below), **not**
  the GE's own calendar date. GE can physically happen any day (a delayed truck is fine); what
  gets rejected is a vendor document dated on/after the window's upper bound being posted
  against the earlier PO. This makes knock-off/close no longer the authority that blocks GE —
  the Effective Date window is.
- **UI requirement:** entering a document date that falls outside the PO's effective window
  must show an immediate, real-time **red-colored English validation message** right at the
  point of entry (not deferred to a save-time error) and the GE drawer's Save action must stay
  **disabled** while any locked validation condition (this one, or the drawer's own
  field-completeness rules below) is unmet.

**Bulk GE-Creation Drawer — Design (LOCKED 2026-09-30, business owner + design session).**
Same trigger pattern as the STO drawer (Phase B) — sensing a Bulk PO/STO in the main GE page's
`"PO / STO *"` cell opens a center drawer — but shaped for Bulk's single-material,
no-CSN reality.
- **Header (synced two-way with the main GE page's own header fields — editing here updates
  there and vice versa):**
  - 6 fields: **Challan Number + Challan Date**, **Invoice Number + Invoice Date**,
    **Container Number**, **Ewaybill Number**. At least one of the four identifier fields
    (Challan/Invoice/Container/Ewaybill Number) is mandatory; whichever of Challan/Invoice
    Number is filled makes its paired Date mandatory too (Container/Ewaybill have no paired
    date).
  - **LR Number** — a separate, **optional** field (not mandatory); if filled, carries forward
    to GRN like the other identifier fields.
  - **Person Name** (general GE header feature, not Bulk-specific — applies to every GE):
    mandatory field for who is physically filling the GE. If the logged-in user's department
    is **not** Security, this auto-fills with that user's own name, read-only (name only, no
    ID shown). If the department **is** Security, the field stays blank but mandatory — the
    actual person's name must be typed manually, and the line table below stays inaccessible
    until it is.
  - **Vendor name** displayed read-only once the PO is selected (resolved from the PO, never
    a raw ID, per CLAUDE.md §8A).
  - **Container Number's master-list mapping/cross-tally** is explicitly **Phase 2** (matches
    the already-locked Point 3.6) — this lock only covers capturing the field, not validating
    it against a container master list.
- **Line table (Bulk has exactly one material, so this is effectively one row):** Material
  (read-only), UOM, Ordered/Expected Qty (the PO line's remaining `open_qty`, reference only),
  **GE Quantity = the vendor document's own stated quantity** (not weight-derived — Gross
  Weight already lives at the main GE header per the existing page, no need to duplicate it
  here; Tare Weight is **not** captured at GE at all — it is only known at Gate Exit, once the
  truck leaves empty, via the existing `gate_exit_inbound`/`GEX` mechanism, so Net Weight
  cannot be computed until then either), **RST Number** (important, carries forward to GRN).
- **Main GE page impact:** once confirmed, the extra Bulk-specific columns (Challan/Invoice/
  Container/Ewaybill/LR + their dates, RST Number) appear in the main line table **only for
  Bulk-type rows** — Standard/Tanker/STO rows are unaffected.
- **GRN carry-forward:** every one of these fields (Challan/Invoice/Container/Ewaybill/LR
  numbers+dates, RST Number) must carry forward into GRN without re-entry — GRN is where
  Transporter and (after Gate Exit) Tare/Net Weight get captured, not GE.
- **Save-button gating:** the drawer's Save stays disabled whenever any locked condition is
  unmet — no identifier field filled, a filled Challan/Invoice Number missing its paired date,
  Person Name empty for a Security-department user, or a document date outside the Effective
  Date window (shown immediately in red, per the UI requirement above).

**Point 3.4.1 — Mother-issuer cross-company read visibility**
- Business: CMP003 (issuing/"mother" company) needs to see CMP011's/CMP005's cross-company
  entries directly, to track and tally before invoicing — not via email.
- System: `assertCompanyScope` only ever scopes a user to their own company; no "read into a
  CRCP-linked sister company" capability exists.
- Gap: a new cross-company **read-only** grant, distinct from CRCP's write-allow-list.
- Final Design: ⏳ NOT YET LOCKED

**Point 3.4.2 — Weekly consolidated (aggregate) invoice**
- Business: one Sales Invoice settles a whole week's cross-company transactions, not 1:1.
- System: no aggregate/multi-source invoicing mechanism exists.
- Gap: confirms/extends Point 3.2.7's aggregate-settlement need to the Invoice path too.
- Final Design: ⏳ NOT YET LOCKED

**Point 3.4.3 — Non-material components on the invoice**
- Business: Freight and other charges ride on the same settlement invoice as material value.
- System: Packaging Cost (Sales Invoice) and Landed Cost/AC01's charge-component model already
  exist as patterns.
- Gap: likely reusable, not yet confirmed which pattern fits — needs a design-time check, not
  a blind rebuild.
- Final Design: ⏳ NOT YET LOCKED

**Point 3.4.4 — Period-boundary backdating (settlement side)**
- Business: the invoice for a month's last week is sometimes dated in that month but issued
  on the 1st of the next month; Tally tolerates this.
- System: `sales_invoice` date validation, GST-period logic, §106's FY-scoped Material
  Document numbering (April-start FY) — cross-boundary tolerance not yet checked.
- Gap: real risk, unverified — must not assume "works like Tally."
- Final Design: ⏳ NOT YET LOCKED

**Point 3.5.1 — No CSN for Bulk (vendor side)**
- Business: confirmed intentional, not wanted.
- System: matches (Point 3.3).
- Gap: none.
- Final Design: ✅ No design needed — intentional as-is.

**Point 3.5.2 — Multi-truck, single vendor invoice**
- Business: invoice doesn't travel with the truck; one invoice can cover multiple trucks.
- System: `goods_receipt` is strictly one GRN per Gate Entry (`UNIQUE(gate_entry_id)`), and a
  GE is tied to one truck (`vehicle_number`) — rigid 1 Truck = 1 GE = 1 GRN. `invoice_number`
  lives only on `goods_receipt_line` as free text; no vendor-invoice header table links
  multiple GRNs to one invoice.
- Gap: no structural many-GRNs-to-one-invoice mechanism.
- Final Design: ✅ **LOCKED 2026-09-27** — no new vendor-invoice header table needed. The
  existing `landed_cost_line.bill_reference`/`bill_date` fields (already in schema since
  2026-05-11, never fully leveraged) get the same invoice number written across every GRN's
  landed-cost line the invoice actually covers, via the Bulk Cost Component Mapper (see Point
  3.5.8) — that tool selects the N GRNs, and its "Distributed" mode splits the one invoice's
  total value across them (Equally, or as-per-GRN-qty), tagging all resulting lines with the
  same `bill_reference`.

**Point 3.5.3 — Loading-point-based freight variance**
- Business: same seller, different loading points → different freight per shipment.
- System: no per-shipment freight-rate mechanism at this granularity.
- Gap: freight can't be a flat PO/vendor-level rate for Bulk.
- Final Design: ✅ **LOCKED 2026-09-27** — no separate mechanism needed. The business owner
  simply selects, in the Bulk Cost Component Mapper (Point 3.5.8), only the subset of GRNs
  that shared one loading point, and applies that loading point's own rate/amount to just
  that subset — then repeats for the next loading-point group. The tool's free-form
  filter+select already accommodates any such subset.

**Point 3.5.4 — Weighment-driven aggregate billing**
- Business: trucks get weighed; billing happens later, in aggregate, based on the weighment.
- System: `gate_entry_line.gross_weight` → `goods_receipt_line.net_weight_from_weighbridge`
  (Gross − Gate Exit Tare) → `received_qty` defaults to it — already works correctly.
- Gap: only the aggregation/invoicing layer on top is missing, not the weighment itself.
- Final Design: ⏳ NOT YET LOCKED

**Point 3.5.5 — Vendor-side backdating**
- Business: same as Point 3.4.4, on the incoming vendor-invoice side.
- System: same unverified date-tolerance question, now for Invoice Verification/GRN fields.
- Gap: real risk, unverified.
- Final Design: ⏳ NOT YET LOCKED

**Point 3.5.6 — Container number instead of delivery challan**
- Business: delivery challan often absent; container number used instead; invoicing
  granularity varies (per container, or multiple containers per invoice).
- System: `gate_entry_line.challan_or_invoice_no` is a single free-text field holding either a
  DC or invoice number — no dedicated `container_number` field anywhere.
- Gap: no structural way to key GRNs to an invoice by container, at any granularity.
- Final Design: ✅ **LOCKED 2026-09-27** — add a real, structured `container_number` field to
  the GE/GRN line (today's `challan_or_invoice_no` free-text field is not it — that stays for
  DC/invoice numbers, `container_number` is new and separate). This field becomes one of the
  Bulk Cost Component Mapper's (Point 3.5.8) selection/filter criteria on its right-side GRN
  list — the same tool then handles "one invoice, multiple containers" or "one invoice, one
  container" identically, via its Equally/As-per-GRN-qty distribution modes. Exact table/
  column placement is a DB-design-stage decision, not scoped here. Must leave room for Point
  3.6's Phase-2 master-list picker (a dropdown/autocomplete sourced from an uploaded list,
  not a rearchitecture of the field itself).

**Point 3.5.7 — Freight mirrors goods-billing granularity**
- Business: freight invoicing follows the same per-truck/per-container/aggregated grouping
  the seller used for the goods bill.
- System: no shared grouping mechanism between goods and freight billing.
- Gap: needs the same flexible many-to-many linking as Point 3.5.6, not separate logic.
- Final Design: ✅ **LOCKED 2026-09-27** — no separate mechanism. Freight is just another
  `cost_type` in the same Bulk Cost Component Mapper (Point 3.5.8) — the same tool, same
  selection/filter/distribution logic, applied with `cost_type='FREIGHT'` instead of e.g.
  `UNLOADING`. Goods and freight billing share one mechanism by construction, not by
  coincidence.

**Point 3.5.8 — Volume (~200 Bulk lines/month) + the underlying AC01 structural gap**
- Business: line-by-line AC01 entry is infeasible at this volume — and, on inspection, the
  *same* linking gap exists even outside Bulk/high-volume, any time one cost component
  (freight, unloading, etc.) needs to apply across more than one GRN. Business owner walked
  through 3 concrete examples (2026-09-27) that converged on one design.
- System: `erp_procurement.landed_cost` has always had a **single, nullable `grn_id`** FK
  ("One landed cost document per GRN/CSN" — table comment, 2026-05-11, unchanged through the
  2026-08-21 AC01 redesign and every later `save_grn_cost` RPC iteration through
  2026-08-26). There is no way today to enter one cost component against more than one GRN
  at once — confirmed structural, not just a volume problem.
- Gap: closed by design below.
- Final Design: ✅ **LOCKED 2026-09-27 — "Bulk Cost Component Mapper", a new AC01 page/action:**
  - **Left side:** define one cost component using AC01's existing fields exactly as they are
    today (`cost_type`, `entry_mode`, `gst_treatment`, rate/amount, etc.) — no new fields on
    this side, this is not a redesign of what a component *is*.
  - **Right side:** a filterable/searchable list of candidate GRNs (by material, date range,
    company, container number once Point 3.5.6 lands, or any other column) with a checkbox
    per row and a "Select All" — the business owner picks exactly the GRNs this component
    applies to.
  - **Two value-application modes**, chosen per use: **"Same-to-Many"** (a rate, e.g. ₹0.1 per
    Base UOM, applied independently to each selected GRN, computed off that GRN's own
    quantity — no shared total) or **"Distributed"** (one lump-sum total, e.g. one week's
    freight invoice, split across the selected GRNs either **Equally** or **As-per-GRN-qty**
    — proportional to each GRN's own received quantity, weight-based, not by GRN count).
  - **Shared reference tagging:** when Distributed, the same value goes into the existing
    `landed_cost_line.bill_reference` field on every resulting line — reuses the existing
    column, no new one needed (see Point 3.5.2).
  - **"Component Map" action:** on confirm, batch-creates/updates the underlying
    `landed_cost`/`landed_cost_line` rows for every selected GRN in one action — same
    document shape as today's per-GRN entry, just created in bulk instead of one at a time.
  - **Duplicate-prevention requirement (business owner's own caution):** the same `cost_type`
    legitimately can recur on one GRN (e.g. two distinct unloading charges), but the exact
    same *value* recurring is very likely an accidental double-apply (re-run on an
    overlapping selection). Before committing, the UI must show which of the selected GRNs
    already carry this exact component+value, as a warning — not a hard block, since a
    genuine repeat is possible, but the user must be able to see and consciously decide.
  - This one tool, not four separate ones, is the actual Final Design for Points 3.5.2,
    3.5.3, 3.5.7, and 3.5.8 together — see each point's own entry above/below for how it
    specifically applies there.

**Point 3.6 — Phase 2 forward-compatibility (container list upload)**
- Business: future (explicitly Phase 2) — transporter Excel container list upload, GE-time
  pick-from-list, cross-tally flag for unlisted containers.
- System: n/a — future capability.
- Gap: not a gap to close now; a constraint on how Point 3.5.6 is built.
- Final Design: 🔵 DEFERRED TO PHASE 2 — Point 3.5.6's design must leave room for this without
  a rearchitecture.

**Point 3.9.1 — Why CRCP alone can't solve multi-invoice commingled transport**
- Business: JK White cement — one truck destuffed from a rake can carry material from
  multiple invoices/companies, mixed and fungible; the physical destination split has no
  necessary relation to the source invoice quantities.
- System: CRCP (Point 3.2.2) only ever addresses which company may receive against a
  document not its own — it says nothing about attributing quantity across multiple
  commingled source documents.
- Gap: a two-layer problem (source commingling + destination arbitrary split); CRCP alone
  addresses only the second layer.
- Final Design: ✅ **LOCKED (analysis) 2026-09-27** — confirmed CRCP is necessary but not
  sufficient here; Point 3.9.2's mechanism is required on top before Point 3.2.7's
  settlement can even be computed for this case. See §3.9.1 for the full reasoning.

**Point 3.9.2 — PO↔Invoice Quantity Mapping**
- Business: GRN happens off Delivery Challan/Container Number (invoice not yet known); the
  real vendor Invoice arrives later and must be mapped onto the GRN(s) it covers — confirmed
  (business owner, 2026-10-01/02) as exactly 3 scenarios: (1) Standard/Tanker's straight
  upfront invoice (CSN-carried, already works, untouched); (2) 1 GRN : 1 Invoice, mapped
  after the fact; (3) 1 Invoice : many GRNs, same invoice number stamped onto every one.
  **Confirmed: never the reverse (one GRN split across two invoices)** — this simplifies the
  original sequential/FIFO balance-fill idea away entirely; no invoice-balance tracking, no
  splitting, no anchor-field-order question (that whole concern is now moot, since nothing
  fills sequentially anymore).
- System: `goods_receipt.invoice_number`/`invoice_date` already exist (header-level, verified
  via code — AC01's own display/filter logic reads exactly these, `ac01.handlers.ts:434-435`)
  and are **already optional/nullable at GRN-creation time**, both frontend
  (`GRNPostFlow.jsx`'s `handleSave()` never requires them) and backend (`grn.handlers.ts`'s
  insert payload always falls back to `null`). AC01's own existing `save_ac01_grn_cost` RPC
  (migration `20260826100000_ac01_considered_qty.sql`) already updates these same fields
  post-creation via plain `COALESCE`, proven not to disturb the original stock posting —
  confirms post-hoc invoice capture is a safe, already-exercised pattern, not a new risk.
- Gap: no dedicated **bulk mapping UI** exists (only AC01's own one-GRN-at-a-time cost-entry
  flow touches these fields today); GRN's own Documents/Accounts tabs still force the user to
  decide Invoice/Rate at GRN-creation time, even when (Bulk, invoice not yet known) there is
  nothing to enter yet.
- Final Design: ✅ **LOCKED 2026-10-02 (business owner + design session, blocker-checked
  against live code, no blockers found).** Full mechanism below — "GRN Invoice Mapping".

**Point 3.9.3 — Mapping visibility + write-authority**
- Business: whoever performs the PO↔Invoice mapping needs to see GRNs posted under other
  CRCP-linked companies too, for the same shared vendor/PO chain.
- System: reuses Point 3.4.1's cross-company read-visibility grant concept.
- Gap: Point 3.4.1 needs to be scoped broadly enough at design time to cover this use case
  too, not just weekly-settlement-tracking; write-authority for the mapping action itself
  (one designated company vs. any CRCP-linked company, duplicate-map risk) is undecided.
- Final Design: ⏳ NOT YET LOCKED — read-visibility reuse is conceptually agreed; write-
  authority question open, needs explicit business-owner decision.

**Point 3.9.4 — GE needs a Bulk-specific multi-reference design (broadens Point 3.5.6)**
- Business: Bulk's real reference documents vary (Delivery Challan, Container, Weighment
  slip, eventual Invoice via Point 3.9.2) — not just one container number.
- System: no CSN exists for Bulk to host this linkage the way `consignment_note
  .invoice_number` does for Standard/Tanker; GE line has only the single free-text
  `challan_or_invoice_no` field.
- Gap: Point 3.5.6 as originally scoped ("add one `container_number` field") is too narrow —
  GE needs its own Bulk-specific line shape, not one extra column on the existing shape.
- Final Design: ✅ **LOCKED (scope-correction) 2026-09-27** — Point 3.5.6's own `Final Design`
  is superseded/broadened by this note; its actual field-level design (at that build-sequence
  turn) must account for the wider multi-reference scope, not just `container_number` alone.

---

### 3.8 Status of this discovery

**Business owner confirmed no more scenarios — discovery is complete, Scenario 1 through 6.**
All six have been walked through and matched precisely against the live codebase, with exact
file/line evidence for every confirmed gap. **Nothing here is a locked design yet** — §3.7's
Design Lock Tracker is the working reference: each point's `Final Design:` slot gets filled
in there, in place, as the business owner locks it — one point at a time, per the
Bug-Pattern Guard Playbook discipline (CLAUDE.md §3): detect/record first (done, §3.1-§3.7),
design and implement next, point by point. Next step: lock points from §3.7 one at a time.

**Note (added later, same day):** one more scenario surfaced *during* the §3.7 design-lock
discussion itself, after this "discovery closed" note was written — see §3.9 below. It is
kept as its own addendum section rather than renumbered into §3.1-§3.6, since it was found
mid-design, not during the original walkthrough.

---

### 3.9 Scenario 7 — Multi-Invoice Commingled Bulk Transport (found during design-lock, 2026-09-27)

**Business (real example — JK White cement, rail rake → wagon → truck destuffing):** JK
White dispatches cement to CMP011 and CMP005 by rail (one rake, multiple wagons). At the
unloading yard, wagons get destuffed into trucks — and **one truck can be loaded with
material from multiple different invoices**, e.g. one truck carrying 10MT against Invoice 1
(CMP011) + 10MT against Invoice 2 (CMP011) + 10MT against Invoice 3 (CMP005) = 30MT total,
all physically mixed (cement is fungible, not serialized). At the destination, the truck's
30MT can then split across companies in ways that don't align with the original invoice
quantities at all — e.g. 30MT all to CMP005, or all to CMP011, or 15MT+15MT — a completely
different split from the 10+10+10 the invoices actually represent. On top of this, the
transporter's own paperwork **never carries the Invoice Number** — only the E-way Bill
number; even asking them to write the PO number or Invoice Number instead doesn't by itself
reveal how much of a specific PO/Invoice's quantity is inside a specific truck.

#### 3.9.1 — Why CRCP alone cannot solve this (business owner's own correct intuition, confirmed)

This is a **two-layer problem**, and CRCP (§3.2) only ever addressed one layer:
- **Layer 1 — source-side commingling:** once fungible material from 3 different invoices is
  physically mixed in one truck, there is **no physical way** to recover which specific
  quantity came from which invoice — this information is genuinely destroyed at the mixing
  step, not merely hard to find. No reference number (PO, Invoice, E-way Bill) can undo this.
- **Layer 2 — destination-side arbitrary split:** the physical unload split (e.g. 15+15) has
  **no necessary relationship** to the true commercial ownership split (20MT CMP011 / 10MT
  CMP005, per the 3 invoices) — same "physical convenience decides the destination" pattern
  as §3.2, just now on top of an already-ambiguous source.
- CRCP (§3.2.2) only ever addressed Layer 2 (letting a different company receive against a
  document not its own) — it says nothing about *which* document(s) to attribute quantity
  against, or in what proportion, once multiple sources are mixed. **Conclusion: CRCP is
  necessary but not sufficient for this scenario** — it needs an additional mechanism on top
  (§3.9.2) to even know how much needs settling.

#### 3.9.2 — GRN Invoice Mapping — Final Design (LOCKED 2026-10-02)

**Scope: Bulk-only, for now.** Applies to a GRN whose source GE line's `bulk_invoice_number`
was blank (invoice genuinely not known at GE time) — not a blanket `delivery_type=BULK` rule.
A Bulk GRN whose GE line *did* capture an invoice (vendor's invoice travelled with the truck)
is unaffected — it keeps the normal Documents/Accounts tabs, pre-filled, exactly like today.

**Why no sequential/FIFO balance-fill (superseding the earlier 2026-09-27 proposal):**
business owner confirmed (2026-10-01/02) the real pattern is always one of exactly 3
scenarios — (1) Standard/Tanker's upfront invoice, CSN-carried, already works; (2) 1 GRN : 1
Invoice, mapped after the fact; (3) 1 Invoice : many GRNs, same invoice number stamped onto
every one — and **never** the reverse (one GRN split across two invoices). This removes the
entire balance-tracking/sequencing/anchor-field question that the original proposal needed —
there is nothing to split, so there is nothing to sequence.

**Blocker-check against live code (no blockers found):**
- `goods_receipt.invoice_number`/`invoice_date` are header-level fields, already optional at
  GRN-creation time in both `GRNPostFlow.jsx` (`handleSave()` never requires them) and
  `grn.handlers.ts` (insert always falls back to `null`).
- `rate_confirmed=false` is an **already-existing, intentional** fallback — GRNPostFlow's own
  Accounts tab already says "GRN will post at rate = 0. Accounts team confirms rate later." —
  i.e. stock posting (`post_stock_movement`) is already invoice/rate-independent by design.
- AC01's own `save_ac01_grn_cost` RPC (migration `20260826100000_ac01_considered_qty.sql`)
  already updates `invoice_number`/`invoice_date`/rate on a GRN post-creation via plain
  `COALESCE`, proven not to touch the original stock posting — post-hoc invoice/rate capture
  is already a safe, exercised pattern in this codebase, not a new risk.
- The one real consequence of posting at `rate=0`: `stock_snapshot.valuation_rate` (WAR)
  dilutes toward zero until corrected — same class of problem §109's Recalculate engine
  (`erp_inventory.recalculate_valuation_at_row`) already exists for, including its proven
  4-level RM→SFG-QI→SFG-UNRESTRICTED→FG cascade (real-data-verified, 2026-07-24). **Decision
  (business owner, 2026-10-02): the Map action below calls this automatically** — not left as
  a separate manual step that risks being skipped.

**GRN-creation-side change:** for a GE line with blank `bulk_invoice_number`, `GRNPostFlow.jsx`
removes its Documents and Accounts tabs entirely (not just makes them optional) — tab
list/indexing/cycling (Alt+[/Alt+]) and tab-referencing error messages adjust to the shrunk
list. The create payload defaults `invoice_number=null`, `invoice_date=null`,
`rate_confirmed=false`, `invoice_rate=null`, `gst_pct=null` with zero user input. Stock still
posts immediately (at rate 0, per the existing fallback) — only the commercial/invoice side is
deferred.

**The Invoice Mapping page** (a dedicated page, not a drawer — decided for column clarity: a
drawer's left/right split would cramp the many-column table into half the screen width):
reached via a new "Invoice Mapping" button on the GRN List page.
- **Header (top of page):** Invoice Number, Invoice Date, Invoice Quantity, Rate — the same
  commercial fields the standard GRN flow already has, just relocated here for the
  no-invoice-yet case. A **"Map to existing Invoice"** toggle: instead of typing fresh values,
  the user types just the Invoice Number and clicks **"Check"** — the system fetches that
  invoice's already-stored Date/Qty/Rate (pulled from any GRN already carrying that invoice
  number) into these header fields, read-only/prefilled, ready to map more GRNs against it
  (the Scenario-3 "add one more truck to an invoice already in use" case).
- **Table (full width, below the header):** `ErpDenseGrid` with Excel-style keyboard
  navigation. Columns: row checkbox, Vendor Name, Material Name, Quantity (per GRN), GRN
  Number, PO Number, Truck Number, Container Number, Delivery Challan Number. A "Select All"
  checkbox in the header row.
- **One single all-column search bar** above the table (not per-field filters) — free text,
  matches against any of the listed columns, filters rows live. Deliberately kept to one box
  for speed, per business owner's own framing ("user er time oi search bar e banchabe").
- **Live running total** of Quantity across every currently-checked row — lets the user
  visually confirm the selected GRNs' total matches the typed Invoice Quantity before mapping.
- **Two tabs:**
  - **Pending** (default) — GRNs with `invoice_number IS NULL`. Select one (Scenario 2) or
    many (Scenario 3) rows, fill/confirm the header, click **"Map"**.
  - **Mapped** — same table + same single search bar, with Invoice Number and Invoice Date
    added as extra columns. Selecting rows and clicking **"Unmap"** clears their
    invoice/rate fields and returns them to Pending.
- **"Map" action (per selected GRN, one batch action):** sets `invoice_number`, `invoice_date`,
  `invoice_rate` (the typed Rate), `rate_confirmed = true`, then calls
  `recalculate_valuation_at_row` against that GRN's own stock-ledger IN-posting to replay its
  value forward from 0 to the real rate (cascading into any downstream RM→SFG/FG consumption
  that happened in the window before the invoice arrived, per §109's existing engine).
- **"Unmap" action (LOCKED 2026-10-02 — Option 1, immediate reverse):** clears
  `invoice_number`/`invoice_date`/`invoice_rate`/`rate_confirmed` back to the pre-mapping state
  **and** calls `recalculate_valuation_at_row` again on the same stock-ledger row, this time
  with rate 0 — reversing the valuation back to the pre-mapping state too, so a GRN's displayed
  valuation always matches its current mapped/unmapped reality, with no stale-rate window.
  **Verified safe, not a new risk:** `recalculate_valuation_at_row`'s one-time-use lock was
  already deliberately removed on 2026-08-21 (migration
  `20260821090000_ac01_grn_landed_cost_hub.sql`, comment: "Repeatable valuation correction —
  remove the one-time-use lock so a GRN's rate can be [revised again]") — precisely because
  AC01's own landed-cost flow already needed to revise a GRN's rate more than once. Map→Unmap→
  Map-again on the same row is exactly the same repeat-call shape, already exercised by that
  existing path.
- **Access/ACL:** reuses the existing `PROC_GRN_LIST` resource code (no new resource code) —
  `VIEW` for opening/searching the page, `EDIT` for Map/Unmap — consistent with GRN's own
  existing single-resource/multi-action-tier pattern (`PUT /grns/:id` already uses `EDIT` for
  corrections). No new cross-company grant needed: the page is naturally scoped to the
  logged-in user's own company's GRNs (same company-scope as GRN List today) — matches the
  business rule that the receiving/unloading company's own Store performs this mapping, not
  the issuing company (resolves Point 3.9.3's "who maps" question for this specific action;
  that point's broader cross-company-visibility question, for other uses, stays open).

**Why this still feeds Layer 2's settlement (§3.2.7), simplified:** once a GRN carries its
real invoice (now always 1:1 per GRN, never split), comparing the invoice's own Bill-To against
the GRN's actual receiving company still gives the cross-company quantity that needs
CRCP-tracking (via PTO, §3.2.6) and Return-or-Invoice settlement (§3.2.7) — the mechanism is
simpler than originally proposed (no balance-fill math) but still supplies the same data Layer
2 needs.

**Structural note (still valid):** this mapping mechanism is **not** the same as the Bulk Cost
Component Mapper (§3.5.8), which is about landed-cost *components* (freight/unloading/etc.),
not the GRN's own base material-value/invoice attribution — kept as its own page, reusing only
the same UI *pattern* (filterable multi-select + batch action), not the same table or backend.

**GRN Invoice Mapping + Ship-To Leg + Bulk Carry-Forward — Implementation Log (2026-10-02)**

> Covers Point A (GE→GRN carry-forward of Bulk fields), Point B (the GRN
> Invoice Mapping mechanism above), and Point C (§3.2.7's "Ship To Location
> Mentioned In Invoice" field) — all three built together in one batch, per
> business owner's explicit sequencing decision. Built directly (no
> subagent delegation), verified statically (`deno check`/`eslint`/full
> frontend `build`/all 9 relevant `.mjs` guards/`migration-integrity-check`),
> **not yet applied to Prod, not yet click-tested live** (no dev login in
> this environment).

- **Migration (Dev only,
  `supabase/migrations/20261002100000_grn_bulk_carry_forward_and_ship_to.sql`):**
  adds `goods_receipt.bulk_challan_number`/`bulk_challan_date`/
  `bulk_container_number`/`bulk_ewaybill_number`/`rst_number` (Bulk-only
  carry-forward target — Invoice Number/Date/LR Number reuse the GRN's own
  pre-existing columns instead of duplicating them) and
  `goods_receipt.ship_to_company_id` (CRCP-general, no FK, same convention
  as `company_id`/`vendor_id` on the same table). Applied via
  `mcp__Supabase__apply_migration`, reconciled to the local filename's
  timestamp, `NOTIFY pgrst, 'reload schema'` run,
  `migration-integrity-check.mjs` confirmed local 611 files/md5
  `fb570c9e10635505394fc34a39ecd6e9` — Dev remote carries 2 **pre-existing,
  unrelated** drift rows (`20260928060000 inward_qa_test_line_skip_flag`,
  `20260930120000 pi_block_company_scope`), neither touched by this batch;
  this migration's own row verified correctly reconciled by a direct diff
  query.
- **Backend — `grn.handlers.ts` (Point A, carry-forward):**
  `createAndPostGRNFromLineHandler`'s `goods_receipt` insert now falls back
  to `geLine.bulk_invoice_number`/`bulk_invoice_date`/`bulk_lr_number` when
  the request body doesn't supply them, and unconditionally copies
  `geLine.bulk_challan_number`/`bulk_challan_date`/`bulk_container_number`/
  `bulk_ewaybill_number`/`rst_number` — no re-entry at GRN time for any of
  these, matching the GE-Creation Drawer's own capture.
- **Backend — `grn.handlers.ts` (Point B, Invoice Mapping):** four new
  handlers — `listGrnInvoiceMappingCandidatesHandler` (GET, Pending/Mapped
  tabs via `resolveBulkGrnCandidates()`, bulk-resolves vendor/material/PO/
  STO/gate-entry names, `fetchInChunks`-safe throughout per §8E),
  `checkExistingGrnInvoiceHandler` (GET, the "Map to existing Invoice"
  lookup), `mapGrnInvoiceHandler` and `unmapGrnInvoiceHandler` (POST,
  batch-action over `grn_ids[]`, DEPENDENT sequential loop per §8B since
  each GRN's own `cascadeRecalculate()` call can touch shared downstream
  SFG/FG state). Both write handlers resolve `company_id` from the fetched
  GRN rows (not the session's active company) and were caught + fixed by
  `company-scope-write-acl-guard.mjs` for missing a secondary EDIT-level
  ACL check at that specific company — now call
  `canMaintainCompanyResource(ctx, grnCompanyId, "PROC_GRN_LIST", "EDIT")`
  per-GRN before mutating (§8A pattern #2). `resolveBulkGrnCandidates()`'s
  vendor-name resolution also needed the same `vendor_master → companies`
  fallback `hydrateGrn()`'s `resolveVendorName()` already has (an
  STO-sourced GRN stores the sending company's id in `vendor_id`, not a
  real vendor row) — added, else every STO-origin row on this page would
  have shown no vendor name.
- **Backend — `opening_stock.handlers.ts`:** `cascadeRecalculate()` (+ its
  `CascadeNode`/`CascadeStepResult` types) changed from file-local to
  `export`ed, for reuse by `grn.handlers.ts` — this is the generic §109
  RM→SFG→FG valuation-cascade engine, not Opening-Stock-specific; no logic
  changes.
- **Backend — `grn.handlers.ts` (Point C, Ship-To):** new
  `resolveShipToValidation(poData, stoData, shipToCompanyIdInput)` helper —
  no-op when `crcp_enabled=false`, otherwise validates the submitted
  company against the issuing company + that PO/STO's own
  `purchase_order_crcp_company`/`stock_transfer_order_crcp_company`
  allow-list, 400s with `GRN_SHIP_TO_REQUIRED`/`GRN_SHIP_TO_INVALID`
  otherwise. Wired into `createAndPostGRNFromLineHandler` right after PO/STO
  resolution. `getGELinesForGRNHandler` extended to resolve and return each
  line's own `delivery_type`/`crcp_enabled`/`ship_to_options`
  (Company Code/Name/State, issuing company first) — this handler had
  **zero STO-side resolution at all** before this batch (PO-sourced lines
  only); added the missing `stock_transfer_order_line`/`stock_transfer_order`
  bulk-resolution alongside it, since both the tab-hiding (Point A/below)
  and Ship-To logic need it for STO-origin GRNs too, not just PO-origin.
- **Routes + ACL:** 4 new exact routes in `procurement.routes.ts`
  (`GET .../grns/invoice-mapping-candidates`,
  `GET .../grns/invoice-mapping/check-invoice`,
  `POST .../grns/invoice-mapping/map`, `POST .../grns/invoice-mapping/unmap`)
  — all reuse `PROC_GRN_LIST` (`VIEW` for the two GETs, `EDIT` for the two
  POSTs), registered as **exact** matches in `route-acl-registry.ts` ahead
  of the existing `/grns/:id` pattern route so they can never fall through
  to it. No new resource code (per §3.9.2's own Access/ACL lock).
  `route-acl-registry-guard.mjs` confirmed 0 missing matches.
- **Frontend — `GRNPostFlow.jsx` (Points A + C):** `TABS` (now `ALL_TABS`)
  computed per-instance via `isBulkNoInvoice = delivery_type === "BULK" &&
  !bulk_invoice_number`, filtering out Documents/Accounts when true; every
  tab-section condition switched from a numeric `activeTab === N` literal to
  `activeTabName === "<Name>"` (and `setActiveTab(0)`/`setActiveTab(6)` to
  `setActiveTab(TABS.indexOf(...))`) so the hidden-tab case can never
  desync an index against the wrong section — the alternative (keeping
  numeric literals and just shrinking the array) would have silently shown
  the wrong tab's content the moment Documents/Accounts were hidden.
  `handleSave()`'s payload forces `invoice_number`/`invoice_date`/
  `bl_number`/`bl_date`/`boe_number`/`boe_date`/`invoice_rate`/`gst_pct` to
  `null` and `rate_confirmed` to `false` when `isBulkNoInvoice`, regardless
  of local state defaults (`rateConfirmed` itself still defaults `true` for
  the normal case, unchanged). New Ship-To card on the Receipt tab, shown
  only when `crcp_enabled`, Save button `disabled` until a value is picked
  (`shipToMissing`). **Real gap caught during self-review before commit:**
  the Documents tab's own pre-fill (`invoiceNumber`/`invoiceDate`/
  `lrNumber` state initializers) only fell back to `geLine.csn_invoice_*`,
  never to the new `geLine.bulk_invoice_*`/`bulk_lr_number` — meaning a
  Bulk GE line that *did* capture its invoice at GE time (so the tabs stay
  visible) would show them blank instead of "pre-filled, exactly like
  today" per this section's own lock text; fixed by adding the
  `bulk_invoice_number`/`bulk_invoice_date`/`bulk_lr_number` fallback
  alongside the CSN one.
- **Frontend — new page `GRNInvoiceMappingPage.jsx`:** header (Invoice
  Number/Date/Quantity/Rate + "Map to existing Invoice" toggle+Check),
  Pending/Mapped tabs, single all-column search bar (same pattern as
  `SO01MapPage.jsx`), checkbox multi-select + "Select All", live selected-
  qty total cross-checked against the typed Invoice Quantity, Map/Unmap
  batch actions. Registered as screen `PROC_GRN_INVOICE_MAPPING`
  (`operationScreens.js`), routed at `/dashboard/procurement/grns/
  invoice-mapping` (`AppRouter.jsx`), and added as a companion route of
  `/dashboard/procurement/grns` in `routeIndex.js` (same convention as
  `/grns/post` — no new tx_code/menu row, reuses GRN List's own ACL). New
  "Invoice Mapping" button added to `GRNListPage.jsx`.
- **Verification:** `deno check` on every touched backend file compared
  message-for-message against each file's pre-session baseline via
  `git stash`/`git stash pop` (not just error *count*) — confirmed zero new
  distinct error messages anywhere, several pre-existing errors fixed as a
  side effect of properly typing new `Map`s. `eslint` clean on every
  touched/new frontend file (two pre-existing, untouched warnings elsewhere
  in the same files, confirmed via `git diff` not to be in this batch's own
  changed lines). Full `npm run build` succeeds. All 9 relevant guards
  (`hardcoded-role-check`, `jsx-no-undef`, `frontend-payload`,
  `wrong-company-source`, `company-scope`, `company-scope-write-acl`,
  `resource-code-domain`, `stock-posting`, `route-acl-registry`) green.
  **Not yet done:** live click-through (no dev login in this environment),
  Prod migration + ACL rollout.

#### 3.9.5 — GRN Split (1 GRN : many Invoices) — Final Design: ✅ LOCKED 2026-10-02

**Scope: Bulk-only** (confirmed by business owner — RM/PM/INT under Bulk are not
batch-tracked, so none of §3.9.2's "never split a GRN across invoices" risk about
batch-genealogy-aware partial reversal applies here; this is the exact INVERSE of
§3.9.2's explicitly-excluded case, reopened specifically for this narrower,
non-batch-tracked scope).

**Trigger:** a vendor splits ONE truck's material across MULTIPLE invoices — commonly
to stay under the e-way-bill value threshold — but the GRN was already created as
exactly ONE GRN (1 GE = 1 GRN, unchanged). When the invoices finally arrive, Store
needs to turn that one GRN into N GRNs, one per invoice, each carrying its own
quantity/rate slice of the original.

**Mechanism — a new "GRN Split" option inside the existing GRN Invoice Mapping page**
(§3.9.2), not a separate page:
- User picks ONE Pending GRN (unlike Map, which can multi-select across several GRNs).
- User enters each invoice's own Number/Date/Quantity/Rate, one at a time, against
  that same GRN, building up a running list of slices.
- **System validates: Σ(slice quantities) == the GRN's own `received_qty`.** Mismatch
  → the "Split" action stays disabled on the frontend AND is rejected server-side (same
  disabled-button + backend-block pattern already used for Map/Unmap's duplicate-GRN
  guard and GE's §4.1 duplicate-CSN guard). A mismatch means the vendor needs to issue a
  corrected invoice — that's a business process outside the system, not something this
  mechanism resolves.
- **On Split:** the original ("Main") GRN is **reversed** (status → `REVERSED`, same
  `reversal_grn_id`/`reversal_approved_by`/`reversal_approved_at`/`reversal_reason`
  fields `reverseGRNHandler` already uses — no new reversal vocabulary). **N new GRNs**
  are created, each a near-clone of the original but with: its own new `grn_number`,
  its own slice's `received_qty`/`ge_qty`/`considered_qty`/`net_weight_from_weighbridge`
  (proportionally split — see below), its own `invoice_number`/`invoice_date`/
  `invoice_rate`, and `rate_confirmed = true` (this operation IS the invoice-confirmation
  moment, same effect as a regular Map). **Same GE number, same Truck Number, same
  Delivery Challan Number, same RST Number** — these all carry over automatically from
  the original (physically the same truck/delivery, only the paper is being split), not
  re-entered by the user.
- **Proportional split of quantity fields:** reuses the exact same pattern already built
  in `GateEntryCreatePage.jsx` for splitting one vehicle's Gross Weight across multiple
  GE lines — `share = (this slice's qty ÷ original GRN's total qty) × field value`, with
  the **last slice absorbing any rounding remainder** so the parts always sum back
  exactly to the original.
- **AC01:** the reversed original GRN's line becomes inactive (no further AC01 action
  possible against it), with a visual marker/badge so a user looking at it immediately
  understands it was split, not just an ordinary reversal — distinguishable from a plain
  reversal by checking whether any other GRN references it via the new
  `split_source_grn_id` column (see Engineering below).
- Stock valuation (WAR) for each new split GRN's own rate uses the same §109
  `cascadeRecalculate` engine already reused for §3.9.2's Map action — no new valuation
  logic, same reuse.

**Engineering — resolved during design, before locking:**
- **Atomicity is mandatory, not optional.** Reverse-then-repost nets to zero, but if
  anything else touched the same material/location's `stock_snapshot` in the window
  between the original GRN and this split (another GRN, another issue), doing the
  reversal and the N re-posts as separate steps risks a transient negative-stock state
  mid-operation even though the net is zero. **Resolved:** built as one call to
  `erp_inventory.post_document()` (§8D's "common gate", already proven for Process PO
  Verify and §113.15's PGI+Invoice) — one P102 reversal of the original's full quantity
  + N fresh P101 receipts for the splits, all in the SAME transaction, with a new
  `erp_procurement.complete_grn_split()` completion function (registered against the
  existing `GRN` entry in `posting_source_registry`, whose `completion_function` was
  previously NULL — confirmed live before locking, no existing completion function is
  being overwritten) doing the actual header-reversal + N-row-insert as the completion
  step. Calculations (proportional split, validation) stay in TypeScript; only the
  writes move into the completion function, same division of labor as every other
  `post_document` migration in this codebase.
- **Real pre-existing gap found while designing this (unrelated to the split feature
  itself, but it blocks it):** `ux_goods_receipt_gate_entry_line` is a unique index on
  `gate_entry_line_id` with **no status filter at all** (`WHERE gate_entry_line_id IS
  NOT NULL` only) — meaning even a `REVERSED` GRN permanently occupies that GE line's
  slot, and the system could never have posted a replacement GRN for a reversed line
  even in the single-reversal case, let alone an N-way split. Never caught before
  because this has 0 real occurrences in Prod data. **Fix:** drop this unique index
  entirely — the real "one ACTIVE GRN per GE line" invariant is already enforced at the
  application layer (`createAndPostGRNFromLineHandler`'s own
  `.in("status", ["DRAFT","POSTED"])` check), so the DB-level index was a redundant,
  overly-strict duplicate of that check, not an independent safety net. A plain
  non-unique index on the same column replaces it for lookup performance.
- **New column:** `goods_receipt.split_source_grn_id` (nullable uuid, FK to
  `goods_receipt.id`) — set on each of the N new rows, pointing back to the original
  (now-reversed) GRN. Drives the AC01 "split" marker and any future "what was this GRN
  split into" lookup. NULL on every ordinary GRN.

**Not locked / explicitly out of scope for this pass:** what happens if a user wants to
*undo* a GRN Split (un-split back to one GRN) — not asked for, not designed; today's
mechanism is one-directional (Split only), matching how Map/Unmap are the only two
directions §3.9.2 itself supports.

**GRN Split — Implementation Log (2026-10-02)**

> Built directly (no subagent delegation), verified statically (`deno check`/`eslint`/
> full frontend `build`/all 9 relevant guards) and **against real Dev data via two
> isolated rolled-back transactions** (not just code-reading) before being treated as
> done — this feature posts and reverses real stock, so static checks alone weren't
> enough. **Not yet applied to Prod, not yet live-tested end-to-end through the actual
> HTTP endpoint** (no dev login in this environment — verified at the SQL-mechanism
> level only).

- **Migration (Dev only,
  `supabase/migrations/20261002110000_grn_split_feature.sql`):** adds
  `goods_receipt.split_source_grn_id` + `goods_receipt.source_gate_entry_line_id`
  (the latter is a deviation from the original lock — see its own header note: dropping
  `ux_goods_receipt_gate_entry_line` hung indefinitely on this Supabase project via both
  `apply_migration` and `execute_sql`, reproduced on a throwaway scratch index too, so
  it's an infra-level issue outside application control, not a lock/code problem — worked
  around by giving split rows a separate GE-line-reference column instead of touching
  that index at all); `erp_procurement.complete_grn_split()` (post_document's completion
  function for `GRN`, registered against the pre-existing registry row whose
  `completion_function` was confirmed NULL before writing this). Applied via `execute_sql`
  statement-by-statement (since `apply_migration`'s own wrapping transaction kept failing
  on the same DROP INDEX before the design changed), reconciled into
  `supabase_migrations.schema_migrations`, `NOTIFY pgrst, 'reload schema'` run,
  `migration-integrity-check.mjs` confirms local in sync (only the 2 already-known,
  unrelated pre-existing Dev drift rows remain, not this migration's own).
- **Backend — `grn.handlers.ts`:** new `splitGrnHandler` — validates ≥2 slices, each with
  Invoice Number/Date/Rate/positive Quantity; fetches the GRN, requires `POSTED` + Bulk
  delivery type (via its PO's or STO's own `delivery_type`) + company scope + EDIT-level
  ACL (reused `canMaintainCompanyResource`, same pattern as Map/Unmap); hard-blocks unless
  Σ(slice quantities) exactly equals the GRN's `received_qty` (0.0001 tolerance); mirrors
  `reverseGRNHandler`'s own PO-UOM→base-UOM conversion for the reversal and applies the
  same conversion per slice; splits `ge_qty`/`considered_qty`/`net_weight_from_weighbridge`
  proportionally via a new `splitProportionally()` helper (ratio-based, **last slice
  absorbs the rounding remainder** — same rule `GateEntryCreatePage.jsx`'s own Gross
  Weight split already uses); builds one P102 reversal + N fresh P101 movements and calls
  `post_document('GRN', ...)` in a single atomic call (§8D) — `stock-posting-guard.mjs`
  confirms this added **zero** new direct `post_stock_movement` calls (baseline stays 12).
  Each split row's full payload is built by cloning the original GRN row (`{...grn,
  ...overrides}`) so every NOT NULL column is already populated from the live row before
  any override is applied — `id`/`grn_number` (new), `received_qty`/`ge_qty`/
  `considered_qty`/`net_weight_from_weighbridge`/`invoice_number`/`invoice_date`/
  `invoice_rate` (slice-specific), `rate_confirmed=true`, `status="POSTED"`,
  `gate_entry_line_id=null` + `source_gate_entry_line_id=<original's line>` (the
  deviation above), `split_source_grn_id=<original>`, every reversal/AC01-override field
  nulled out fresh.
- **Backend — two existing read-paths updated** to also recognize
  `source_gate_entry_line_id` (not just `gate_entry_line_id`), since a split-created GRN
  carries its GE-line reference there: `createAndPostGRNFromLineHandler`'s "no active GRN
  for this line" guard (now checks both columns) and `getGELinesForGRNHandler`'s
  existing-GRN-per-line map (fetches both, merges split rows AFTER plain rows so a
  split's new POSTED GRN correctly wins over its now-REVERSED original for the same GE
  line in the UI's per-line status).
- **SQL — `complete_grn_split()`:** reverses the original GRN's header exactly like
  `reverseGRNHandler` already does (same `status`/`reversal_grn_id`/
  `reversal_approved_by`/`reversal_approved_at`/`reversal_reason` fields — no new
  reversal vocabulary), then for each context-supplied split payload, matches its own
  posting by `line_ref`, merges in that posting's `stock_document_id`/`stock_ledger_id`
  via `jsonb_populate_record`, and inserts the resulting full row with a plain
  `INSERT ... SELECT (v_row).*` (no column list to maintain/risk-drifting against the
  ~70-column table). **Verified against real Dev data, twice, in isolated rolled-back
  transactions** (a fresh synthetic receipt posted and immediately split within the same
  transaction, to control the exact stock balance rather than depending on whatever a
  real historical GRN's material happens to have left — most real Dev GRNs' stock has
  already moved since posting, which is itself a useful confirmation that the engine's
  negative-stock guard correctly blocks a reversal once the balance is insufficient):
  even-split (500 → 300+200) and uneven-split with non-integer quantities and different
  rates (500 → 333.33+166.67) both produced correct REVERSED original + POSTED new rows
  with the right `stock_document_id`/`stock_ledger_id`/`split_source_grn_id` wiring.
- **Routes + ACL:** one new exact route (`POST /api/procurement/grns/split`), reusing
  `PROC_GRN_LIST:EDIT` (no new resource code). `route-acl-registry-guard.mjs` confirms 0
  missing matches.
- **Frontend — `GRNInvoiceMappingPage.jsx`:** new "Split" button per Pending-tab row
  (single-GRN action, distinct from Map's multi-select); opens an inline card where the
  user builds up slices one at a time (Invoice Number/Date/Rate/Quantity + "Add"), with a
  running total checked live against the target GRN's own quantity — the "Split" button
  stays disabled until ≥2 slices are entered and they sum exactly (mirrors the same
  disabled-button + backend-block pattern as Map/Unmap's own guards and GE's §4.1
  duplicate-CSN guard). New `splitGrn()` wrapper in `procurementApi.js`.
- **Verification:** `deno check` message-diffed against each touched backend file's
  pre-session baseline (zero new errors), `eslint` clean, full frontend `build` succeeds,
  all 9 relevant guards green, migration-integrity confirmed, and the two real-data
  rolled-back-transaction tests above. **Not yet done:** live click-through through the
  actual Bulk GE→GRN→Split flow end-to-end (no Bulk GRN exists in Dev yet — Phase D's own
  Bulk flow hasn't been live-tested either, see its own implementation log), Prod
  rollout, and retrying the original `DROP INDEX` once the Supabase infra issue clears
  (tracked in the migration's own header note, not required for this feature to work).

**GRN Split — AC01 fix (2026-10-02, same day, business-owner follow-up question):**
business owner asked, right after the feature shipped: "the row whose GRN gets reversed —
what happens to ITS payment date calculation, and what about the new ones, and how does PO
Number carry forward to the new ones?" Investigating found PO Number already carries
correctly (every split row clones `{...grn, ...overrides}`, and `po_id`/`po_number` were
never in the overrides list) and the new split rows' own payment dates compute correctly
(each is a normal POSTED row with its own `invoice_date`/`invoice_rate`) — but the **design
lock's own promise** ("AC01-এ reversed GRN-এর line inactive হবে... marker থাকবে") had never
actually been built: AC01 had no `status` filter/marker at all, and
`computeActualPaymentDate` ran unconditionally regardless of `status`, so a REVERSED
original (split or plain) still showed a computed due date as if it were still payable.
Fixed, same day, approved ("ha kore dao"):
- **`ac01.handlers.ts`:** `buildListRow` (list endpoint) now returns `status`,
  `is_reversed` (`status === 'REVERSED'`), `split_source_grn_id`, and
  `split_into_grn_numbers` (a new reverse-lookup bulk query — for each page's GRN ids, which
  new GRN(s) reference it via `split_source_grn_id`, same `fetchInChunks`/map-building
  pattern as the file's other bulk lookups, §8B INDEPENDENT). `actual_payment_date` is now
  `null` whenever `is_reversed` is true, overriding both the manual
  `revised_payment_date` override and the computed due-date — a reversed receipt is never
  payment-relevant, full stop. `getAC01GRNHandler` (detail endpoint) gets the identical
  guard plus its own single-GRN `split_into_grn_numbers` lookup (`...grn` already spread
  `status`/`split_source_grn_id` through via its own `select("*")`, so only the derived
  fields needed adding).
- **`AC01Page.jsx`:** the Status column's two-dot render is replaced with a rose "REVERSED"
  (or "REVERSED (split)") badge whenever `row.is_reversed` — tooltip names which new GRN(s)
  it became when `split_into_grn_numbers` is present; copy/Excel-export paths get the same
  plain-text marker instead of the dots. The detail drawer also gets a banner at the top
  (`"This GRN has been REVERSED and is no longer payment-relevant... split into: ..."`) so
  opening a reversed row makes this unmissable, not just a column dot.
- **Verification:** `deno check` on `ac01.handlers.ts` message-diffed against its own
  pre-change baseline (0 errors before, 0 after — this file was already fully clean),
  `eslint` clean on `AC01Page.jsx`, `jsx-no-undef-guard`/`hardcoded-role-check-guard`/
  `wrong-company-source-guard`/`stock-posting-guard`/`frontend-payload-guard` all green
  (stock-posting-guard baseline unchanged at 12 — this fix touches no posting call at all).
  Confirmed against live Dev schema that `goods_receipt.status`/`split_source_grn_id`/
  `source_gate_entry_line_id` all exist with the expected types, so both handlers'
  `select("*")` already carries them through with no new column list needed. **Not yet
  done:** a real live REVERSED row to click-through against (Dev has none yet — no GRN has
  actually been reversed/split there since this is all same-day-shipped and not yet
  exercised through the real HTTP endpoint).

#### 3.9.3 — Who performs the mapping, and cross-company visibility

Confirmed: whichever company performs this PO↔Invoice mapping (e.g. CMP011, if it manages
the vendor relationship) needs to **see GRNs posted under other CRCP-linked companies too**
(e.g. CMP005's GRNs against the same shared PO/vendor chain) — otherwise the balance-fill
calculation is incomplete. **This reuses Point 3.4.1's cross-company READ-visibility grant**
— that grant should be scoped broadly enough at design time to cover both its original
weekly-settlement-tracking use case *and* this GRN-to-invoice-mapping use case, as one
mechanism, not two.

**Open question (not yet answered):** is the mapping *action* itself (a write, not just a
read) restricted to **one designated company** (e.g. whoever the PO's issuer/vendor-relation
owner is), or can **any** CRCP-linked company attempt it — with a real risk of duplicate or
conflicting maps if both act independently? Needs an explicit business-owner decision before
this point can be locked.

#### 3.9.4 — GE needs its own Bulk-specific multi-reference design (broadens Point 3.5.6)

Realization while discussing §3.9.2: since Bulk has no CSN (§3.3/§3.5.1) to host a
PO↔Invoice/DC/Container link the way `consignment_note.invoice_number` does for
Standard/Tanker, and Bulk's real reference documents vary (Delivery Challan, Container
number, Weighment slip, and only eventually Invoice via §3.9.2's mapping) — **Point 3.5.6 as
originally scoped ("add one `container_number` field") is too narrow.** Gate Entry needs its
own **Bulk-specific line shape** capable of capturing whichever combination of DC/Container/
Weighment-slip reference actually applies for a given Bulk delivery — not a single free-text
field, and not just one new column. Standard/Tanker's CSN-driven GE and Bulk's
reference-less GE are genuinely different shapes, not the same GE form with one extra field.
**Point 3.5.6's own `Final Design:` should be read as superseded/broadened by this note** —
its DB/field-level design (when that build-sequence turn comes up) must account for this
wider scope, not just add a single `container_number` column.

---

## 4. Open Items — needs a decision or a fix before "Procurement = 100% done"

### 4.1 GE — duplicate CSN/line selection across rows (small, confirmed gap) — ✅ FIXED 2026-10-02
`GateEntryCreatePage.jsx`'s `getCsnsForRef(kind, refId)` returned **all** CSNs for a
PO/STO regardless of what other rows in the same GE already picked. No de-duplication
existed at the frontend (drawer list) or at `createGateEntryHandler`'s save-time
validation. Risk: a user could pick the same CSN/STO line twice across two rows in one GE.
**Fix applied:**
- `GateEntryCreatePage.jsx` — new `getUsedCsnIds(excludeRowIndex)`/
  `getUsedStoLineIds(excludeRowIndex)` helpers (ids used by every OTHER active row);
  `openDrawer()` (PO+CSN path) filters its `csns` candidate list through
  `getUsedCsnIds`; `openStoDrawer()` (STO path) filters its `stoLines` candidate list
  through `getUsedStoLineIds` before building drawer rows. `handleSave()` also gets a
  defense-in-depth duplicate check (same CSN/STO-line id across two active lines) before
  the save request is even sent.
- `gate_entry.handlers.ts`'s `createGateEntryHandler` — new save-time guard right after
  the initial required-field check: walks the raw `body.lines[]` and rejects
  (`GE_DUPLICATE_CSN`/`GE_DUPLICATE_STO_LINE`, 400) the moment the same non-empty
  `csn_id`/`sto_line_id` appears twice, independent of and in addition to the frontend
  checks (a stale client or any other caller could otherwise still submit duplicates).
- No schema change needed, as originally scoped. Verified: `deno check` message-diffed
  against baseline (zero new errors), `eslint` clean, full frontend `build` succeeds,
  `jsx-no-undef-guard`/`frontend-payload-guard`/`wrong-company-source-guard`/
  `company-scope-guard`/`hardcoded-role-check-guard` all green.

### 4.2 Inward QA "redesign" — scope unknown, needs discovery
The 2026-09-22 note defers this without ever describing what's wrong with today's
Inward QA or what the redesign is meant to change. Before this can be implemented (or
even estimated), a business-owner discovery session is needed: what's the actual
complaint/gap with the current RELEASE/BLOCK/REJECT/FOR_REPROCESS flow? Is this about
UI, about a missing movement-type combination, about batch-level granularity (mirroring
§120/§131's MTEST/PTEST QA-exclusive-lifecycle work), or something else entirely?
**Do not guess at this — ask directly when this item comes up.**

### 4.3 Invoice Verification — re-audit before trusting the old 35% figure
Layer table's 35%/30% figures predate a huge amount of subsequent work (AC01 hub,
GRN redesign, landed cost engine). Before writing anything new here, do a live-code
audit of what `invoice_verification` (Gate-13.8) actually does today vs. what AC01 has
absorbed, to avoid re-designing something that's already covered.

### 4.4 Procurement Planning (Powder) — re-audit against PO11
Same discipline: PO11 (Procurement Planning Workspace, §PO11 sections in feasibility
doc) may have already delivered most of what this old line-item asked for. Audit before
assuming it's still 30%.

### 4.5 PO12 (Plant Transfer Order) — ✅ RESOLVED 2026-09-27: finish design, do not retire
See §2.4 — fully built, zero real usage, L6 layer flagged only 57% designed. **Resolved**
during the §3.2 CRCP discovery: PTO is the mechanism that will record cross-company GE/GRN
movement, so it must be finished, not retired. Its redesign scope now includes the CRCP
support described in §3.2.6-§3.2.8, on top of whatever original L6 scope remains open.

### 4.6 RTV / Debit Note / Exchange Reference (PO10) — never used, needs a real-data
verification pass before trusting "done"
Same discipline that caught the STO guard bug: §2.3 shows this whole branch (all 3
settlement modes) has 0 real Prod rows. Before marking it ✅ Done with confidence, it
deserves the same kind of rolled-back-transaction verification test STO just got —
create an RTV, post it, drive it through DEBIT_NOTE and EXCHANGE settlement, confirm the
lifecycle actually completes against real data, not just "the code looks right."

### 4.7 CRCP (Cross-Company Material Movement) + Bulk invoicing — Track 2 mechanism locked, Track 1 open
See §3.7 for the point-by-point Design Lock Tracker and the two-track Recommended Build
Sequence — this is the single largest item in this doc.

**Track 2 (Bulk Vendor-Invoicing, Scenario 5) — mechanism fully locked 2026-09-27.** The
"Bulk Cost Component Mapper" (Point 3.5.8) resolves Points 3.5.2, 3.5.3, 3.5.6, and 3.5.7 as
one design: a filterable GRN-selection UI + existing AC01 component fields + two
value-application modes (Same-to-Many / Distributed, the latter with Equally/As-per-GRN-qty
sub-modes) + reuse of the existing `bill_reference` field + a pre-commit duplicate warning.
Ready for Page/Backend/DB-level design, one build sequence step at a time (§3.7's Track 2
Step 1: Bulk-specific GE line redesign — scope broadened by Point 3.9.4, no longer just a
single `container_number` column — then Step 2: the Mapper tool itself).

**Track 1 (CRCP Cross-Company Movement, Scenarios 2/3/4) — Phase A (Points 3.2.1, 3.2.2, 3.2.9)
fully locked 2026-09-27, code+Prod-verified, no blockers.** Point 3.2.6 (PTO) has only its
finish-vs-retire *decision* locked — the actual mechanism is still open, and is now Phase C
(after CSN), not Phase B. Points 3.2.3-3.2.5 (Phase B, CSN — now including the drawer-
visibility filter fix), 3.2.7-3.2.8 (Phase E, settlement), 3.3 (Phase D, Bulk), and
3.4.1-3.4.4 still need their `Final Design:` locked, following §3.7's Phase
A→B→C→D→(validation)→E ordering (reordered 2026-09-27 — PTO moved after CSN).

**Track 3 (Scenario 7, Multi-Invoice Commingled Transport, §3.9) — found mid-design,
2026-09-27, partially locked.** Point 3.9.1 (why CRCP alone is insufficient here) and Point
3.9.4 (folded into Track 2 Step 1) are locked. Point 3.9.2 (PO↔Invoice sequential
balance-fill mapping — a new mechanism, not the same as the Bulk Cost Component Mapper) is
mostly locked, pending explicit sign-off on the `invoice_date`/`invoice_number` sequencing
anchor. Point 3.9.3 (mapping visibility + write-authority) is open. Build order: after Track
2 Step 1, depends on pieces of both Track 1 (Point 3.4.1) and Track 2 (Bulk GE shape).

---

## 5. Today's session (2026-09-27) — what actually got done

1. **STO sending+receiving fully verified against real Prod data** (CMP003→CMP006, RM-00022,
   both STO types) — Create → Confirm/CSN → DO → PGI → Gate Entry → GRN → Confirm Receipt →
   Close, all in one rolled-back transaction, zero residue, all assertions passed.
2. **Real bug found + fixed:** `guard_sto_line_change()` trigger's guarded-column list
   wrongly included `line_status`, blocking every real STO receipt. Root cause: the
   trigger (added 2026-09-11, meant to freeze commercial fields once a DO exists) never
   accounted for the receiving side's own legitimate OPEN→RECEIVED transition. Fixed by
   splitting the guard: commercial fields + the specific KNOCKED_OFF transition stay
   guarded; the GRN-driven receipt-completion transition does not.
   Migration: `supabase/migrations/20260927120000_fix_sto_line_guard_receipt_status.sql`
   — applied + reconciled on both Dev (`ytapuwiqicmvpanmzelb`) and Prod
   (`bsjpvkigpllichlknmah`), `migration-integrity-check.mjs` confirms `in_sync: true` on
   both. **Not yet committed/pushed to git** — awaiting explicit go-ahead.
3. **GE multi-item-per-STO mechanism confirmed working as-is** (no new code needed) —
   GE was already a multi-line document (§88.1) capable of one row per STO line item,
   each row independently resolving its own CSN/line. Found the 3.1 dedup gap while
   confirming this.
4. **Full mechanism inventory written up** (§2) for PO, STO, and PO10/Exchange
   Reference — types, lifecycle, handlers, real Prod data counts for each. Surfaced two
   more never-used-in-Prod branches while doing this: RTV/Debit Note/Exchange (§2.3,
   §4.6) and PTO/Plant Transfer Order (§2.4, §4.5).
5. **Business-owner-led real-scenario walkthrough completed** (§3) — all 6 scenarios
   captured precisely against live code: Scenario 1 (straightforward, no gap), Scenario 2
   (Cross-Company Vendor Delivery / CRCP, major gap chain), Scenario 3 (Bulk — same gaps,
   consistently, plus its own CSN-less variant), Scenario 4 (mother-issuer visibility +
   weekly aggregate settlement invoice + backdating risk), Scenario 5 (Bulk vendor-invoice
   structural gap — 8 confirmed points, one still awaiting the business owner's own
   solution for the ~200/month volume problem), Scenario 6 (Phase 2 container-list
   forward-compatibility note). Resolved §4.5's open PTO question (finish, don't retire) as
   a side effect. Business owner confirmed no further scenarios — discovery is closed.

---

## 6. Next steps

- [ ] **Scenario walkthrough closed (§3, 6 scenarios) + §3.7 Design Lock Tracker started.**
      Track 2 (Bulk Cost Component Mapper) mechanism is fully locked — ready for Page/BE/DB
      design at its own build-sequence turn. Track 1 (CRCP) still needs each point locked,
      one at a time, following §3.7's Phase A→B→C→D→(validation)→E ordering.
- [ ] Business owner decides priority order for the 7 open items in §4 (GE dedupe fix,
      Inward QA discovery session, Invoice Verification re-audit, Procurement Planning
      re-audit, PTO finish-or-retire — now resolved, see §4.5, RTV/Debit-Note/Exchange
      verification pass, CRCP + Bulk-invoicing full design).
- [ ] Commit + push the STO guard fix migration (pending explicit go-ahead).
- [ ] Once all of §4 is closed (fixed, or explicitly decided "no action needed") and the
      CRCP + Bulk-invoicing design (§3/§4.7) is designed, implemented, and verified, this
      doc's top status flips to "✅ Procurement — 100% done", and work moves to
      `docs/FG-STO-MTS-DISPATCH-DESIGN-DOC.md`.
