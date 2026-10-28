# PO22 — Owner's Waterfall Method + Inbound Reschedule Rule (understanding record)

Date: 2026-10-28 · Source: business-owner walk-through on the CMP003 MHEC family (live PROD data, read-only).
Status: **UNDERSTANDING AGREED with the owner. ENGINE NOT YET VERIFIED against it. No code was changed for this record.**

> Purpose: one place where the owner's method is written down step by step, so the engine can be checked
> against it afterwards. Every number below is a hand calculation (flat daily rates, see §9) unless it is
> marked "from data". If the engine disagrees with this document, the engine is what gets reviewed first —
> but only after the owner confirms the method itself is still what he wants.

---

## 1. The picture (owner's tank analogy)

- Three tanks in the CMP003 MHEC family: **Gabrosa M700**, **Combizell MHEC 40000**, **TS U2121**.
- Gabrosa also feeds one specific flat **by itself** (exclusive demand). The other demand is **shared**
  between materials of a group.
- Levels, narrow to broad:

| Level | Members | Notes |
|---|---|---|
| Exclusive | Gabrosa only (its own flat) | nobody else may use this reserve |
| **Group A** | Gabrosa + Combizell | = `MHEC_PLC`. **MC 60 is not a member for this purpose**: its line is Use Primary = **No** |
| **Group B** | Gabrosa + Combizell + TS U2121 | = `MHEC` (broadest) |

- Every narrow level is a subset of the broader one (Exclusive ⊂ A ⊂ B). Material that belongs to a group is
  eligible for that group and every group above it.
- MC 60 (`RM-00101`) is deliberately outside the waterfall because its stroke line has Use Primary = No
  (`erp_planning.stroke_group_primary_decision`; all 23 CMP003 decisions are No).

## 2. Days (Min / Max / Critical)

- **Min = 30 days**, **Max = 60 days**, **Critical = 20 days** (CMP003 MHEC).
- Max is read as Target + order cycle (cycle default 30). This was the working assumption in the session;
  it must be checked per item against its real Target and cycle before it is relied on.
- A level holds **days of its own plan demand**, counted forward from the day it is measured.

## 3. Step 1 — reserve from today

1. Today (28 Oct 2026) every level **reserves up to Max (60 days)** of its own plan demand, in the order
   **Exclusive → Group A → Group B**.
2. Whatever stock is left after all three reserves is the **Excess Pool**. It belongs to nobody yet and can
   go to any level that is eligible for the material.

From data (27 Oct 2026, RM planning export): Gabrosa 17,366.3 KG · Combizell 75,509.9 KG · TS 26,027.7 KG
(total 118,903.9). The hand calculation rounds these to 17,300 / 75,000 / 26,000 = 118,300.

| Hand-calculated (rounded stock) | KG |
|---|---|
| Exclusive Max reserve | ≈ 6,670 |
| Group A Max reserve | ≈ 2,720 |
| Group B Max reserve | ≈ 84,390 |
| **Reserved total** | **≈ 93,780** |
| **Excess pool** (118,300 − 93,780) | **≈ 24,520** |

## 4. Step 2 — run down to Min, then top up (the rotation)

1. Each level consumes its own reserve down to **Min (30 days)**.
2. Reserve is a flat 60 days from 28 Oct, so each level reaches Min after 30 days: **27 Nov 2026**.
   All three levels reach Min on the same day in this example.
3. **At Min, a level tops itself up to Max from the Excess Pool**, again in the order
   **Exclusive → A → B** (narrow first, broad last).
4. This repeats every 30 days (27 Dec, 26 Jan, 25 Feb, 27 Mar, 26 Apr …).
5. The pool changes **only** by receipts coming in and by top-ups going out. Consumption comes out of the
   reserves, not the pool.
6. If the pool is too small, the **broad level (B) gets less**, because it is served last. B then has less
   than Max cover, and a **receipt is needed**.
7. Whatever is left in the pool and not needed yet is simply shown as **excess** (it is not "lost" and not
   assigned to anyone).

## 5. Step 3 — receipts (consignments) join the pool

- A consignment adds to the **Excess Pool** from its receipt date (ETA to plant).
- **FEFO / shelf life:** every lot's shelf life runs from its **own receipt date**. An earlier lot is
  older and is used first (expiring first); a later lot has a later expiry.
- **TS U2121 belongs to Group B only.** If it arrives first, Group B uses it first (FEFO), and Gabrosa — which
  can serve every level — stays in the pool for whoever needs it. Owner: *"TS U2121 jehetu sudhu Group B tei jay,
  ar age jehetu asche tahole se FEFO serve korbe… gabrosa sob group e jay, tai Excess Pool e rakhlam."*
- Receipts are counted **only for the company being planned** (CMP003 here). CMP005 and CMP011 purchase orders
  for the same materials belong to those companies and are not counted.

### CMP003 consignments not yet received (PROD, 28 Oct 2026, from data)

| ETA to plant | Material | KG | PO | CSN / state |
|---|---|---|---|---|
| 12 Nov 2026 | TS U2121 | 25,000 | ASC/PO123/2026-27 | 3000000229, **in transit** (port arrival 6 Nov) |
| 17 Nov 2026 | Gabrosa M700 | 24,000 | ASC/PO125/2026-27 | 3000000330/331/332, dispatch 0 + 9,000 + 15,000 |
| 8 Dec 2026 | Gabrosa M700 | 24,000 | ASC/PO124/2026-27 | 3000000329, ordered, not dispatched |
| 24 Dec 2026 | TS U2121 | 25,000 | ASCP2627-0133 | 3000000239, ordered |
| 11 Jan 2027 | TS U2121 | 25,000 | ASCP2627-0190 | 3000000364, ordered |
| 16 Jan 2027 | Combizell | 24,000 | ASCP2627-0188 | 3000000362/365/366, dispatch 15,000 + 9,000 |
| 29 Jan 2027 | Combizell | 24,000 | ASCP2627-0189 | 3000000363, ordered |

Gabrosa POs ASC/PO124 and ASC/PO125 had an expected delivery date of 17 Oct that has already passed.

## 6. Plan horizon rule

- Planning runs **from today for six months** (Excel / rolling plan = current month + next month + 4).
- Demand is counted **only where a PO21 plan exists**. A month without a plan has **zero demand**.
- Top-up and allocation go **only as far as the plan exists**. Stock beyond that is not given to anyone; it
  stays in the pool and is shown as **excess**.
- On PROD at this date: CMP003 Oct = FINAL; Nov, Dec = ROLLING (30 SKUs); Jan 2027 = ROLLING (6 SKUs);
  Feb 2027 onward = no plan.

## 7. Worked timeline (hand calculation, flat rates)

Assumptions: Exclusive ≈ 111, A ≈ 45, B ≈ 1,406 KG/day (= the 60-day reserves ÷ 60; total ≈ 1,563/day, so
30 days ≈ 46,890 KG). Min reserve per level = 30 days: Exclusive ≈ 3,335, A ≈ 1,360, B ≈ 42,195.

| Min date | Pool before top-up | Receipts since previous Min (CMP003) | Top-up taken | Pool after |
|---|---|---|---|---|
| 27 Nov 2026 | 24,520 + 25,000 (TS) + 24,000 (Gab) = **73,520** | TS 12 Nov, Gab 17 Nov | 46,890 | **26,630** |
| 27 Dec 2026 | 26,630 + 24,000 (Gab 8 Dec) + 25,000 (TS 24 Dec) = **75,630** | Gab 8 Dec, TS 24 Dec | 46,890 | **28,740** |
| 26 Jan 2027 | 28,740 + 25,000 (TS 11 Jan) + 24,000 (Comb 16 Jan) = **77,740** | TS 11 Jan, Comb 16 Jan | 46,890 | **30,850** |
| 25 Feb 2027 | 30,850 + 24,000 (Comb 29 Jan) = **54,850** | Comb 29 Jan | 46,890 | **7,960** |
| 27 Mar 2027 | **7,960** | none | Exclusive 3,335 + A 1,360 = 4,695 served; B gets 3,265 of 42,195 | pool 0 |

- At 27 Dec the three reserves are at Min (Exclusive ≈ 3,335, A ≈ 1,360, B ≈ 42,195 = 46,890) and the pool
  is ≈ 75,630. Nothing other than the Gabrosa 8 Dec and TS 24 Dec lots enters the pool in that month.
- At 26 Jan total stock ≈ 124,630 = reserves 46,890 + pool 77,740.
- **27 Mar 2027: Group B is short ≈ 38,930 KG** (Exclusive and A are still fully served). B then has about
  32 days of cover and would run out near the end of April unless new stock arrives. A receipt of about
  **39,000 KG** (TS or Combizell) is needed by ~27 Mar; with import lead times the order has to be placed
  around mid-January at the latest.
- This 27 Mar shortfall exists only if the plan really continues at the same rate through Apr 2027. Without a
  PO21 plan for Feb–Apr, demand is zero there, no shortfall appears, and the stock shows as excess (§6).
- Per-material split of the pool (how much Gabrosa vs Combizell vs TS) was **not** calculated: it depends on
  the member-split rule inside a group (§8).

## 8. How a group's reserve is split between its members

(Engine rules already in `mts_family_planner.logic.ts`, confirmed as the owner's intent in this session.)

1. Saved usage order (`material_group_usage_order`), if one exists.
2. Otherwise: expiring first (FEFO), then run-down, then free-stock ratio with a small cost × credit tilt
   (clamped 0.5–2).
3. Receipts do not change the expiry of older lots.

## 9. Limits of the numbers in this document

- Flat daily rates from the 60-day reserve were used; real daily plan demand varies by month and by SKU.
- Stock figures are rounded; the Excel (27 Oct) values are shown in §3.
- Jan 2027 has a plan for only 6 SKUs; the flat-rate assumption therefore overstates demand there.
- A level's real Min date can differ from 27 Nov / 27 Dec when its own demand is uneven.

## 10. Inbound reschedule rule for consignments not yet dispatched (CSN)

Agreed with the owner on 2026-10-28 (answers: threshold on both current and proposed ETD = yes; import vs
domestic read from PO or CSN; sail time = route days, booking time excluded = yes).

**Applies to:** CSNs that exist but have **not been dispatched** (ORD, no dispatch). Dispatched / in-transit
(TRN) CSNs are not moved by this rule.

1. The waterfall tells the system the date the lot should land at the plant. The gap to the current ETA is how
   many days to **prepone / postpone**.
2. The lot's **sail time** (route days from the vendor-material terms, booking time not included) gives the
   ETD that would be needed: `needed ETD = needed ETA − sail time`.
3. Feasibility is judged on **ETD − today**, for **both** the current ETD and the proposed ETD:

| Shipment type | ETD − today | System says |
|---|---|---|
| Import | **> 15 days** | "Reschedule: prepone / postpone by N days" |
| Import | **≤ 15 days** | "Cannot be scheduled. Talk to the vendor to see whether it is possible." |
| Domestic | **> 7 days** | "Reschedule: prepone / postpone by N days" |
| Domestic | **≤ 7 days** | "Cannot be scheduled. Talk to the vendor to see whether it is possible." |

4. Import vs domestic is read from the **PO** or the **CSN** (owner: "PO te ba CSN ei pabe"). On PROD the PO
   carries `import_trade_type` (e.g. `DIRECT_IMPORT`, `HIGH_SEA_SALE`), `shipment_mode`, `customs_movement_type`
   and `incoterm`; a domestic PO has these empty (checked on PO ACP2627-0098). Note a local vendor can still be an
   import (PO ASC/PO124 is `HIGH_SEA_SALE` with a port leg although the vendor is Nouryon India). The exact
   rule (non-empty `import_trade_type` ⇒ import) must be confirmed in the code when this is built.
5. A passed ETD with no dispatch counts as ≤ threshold (cannot be scheduled, ask the vendor).

Examples with today = 28 Oct 2026 (from data):

| CSN | PO import fields (PROD) | ETD | ETD − today | Result |
|---|---|---|---|---|
| 3000000329 (Gabrosa, ETA 8 Dec) | `HIGH_SEA_SALE`, FCL, CIF → import | 1 Nov | 4 days | import, ≤ 15 → talk to vendor |
| 3000000239 (TS, ETA 24 Dec) | `DIRECT_IMPORT`, FCL, CIF → import | 18 Nov | 21 days | import, > 15 → reschedule advice allowed |
| 3000000364 (TS, ETA 11 Jan) | `DIRECT_IMPORT`, FCL, CIF → import | 6 Dec | 39 days | import, > 15 → reschedule advice allowed |
| 3000000234 (Gabrosa, CMP005) | no import fields → domestic | 24 Oct | −4 days | domestic, ETD already passed → talk to vendor |

This replaces the earlier advice that could say "postpone 59 days" or "prepone 41 days" with no
feasibility check (`optimizeFamilyArrival` ignored lead time).

## 11. NOT yet verified (work to do after the owner says "go")

1. Does the engine re-top-up the **Exclusive** level at its own Min (not only the groups)?
2. Does a receipt enter the Excess Pool directly, or is it kept as a separate "arrival" until a level needs it?
3. How the engine assigns expiry to an in-transit lot (receipt date + shelf life vs real batch expiry) and
   whether every one of the three materials has a shelf life in the material master.
4. Run the real family planner on PROD data and compare against §3, §7 (the 24,520 / 73,520 / 75,630 / 77,740
   numbers) — the daily demand split by level is not stored anywhere and has to be rebuilt from the PO21 plan.
5. Whether "Max = Target + 30" is right for each item in the family.
6. Implement §10 (feasibility window on reschedule advice) and re-check against §5 and the Excel "Engine best
   date" column.
7. Excel readability redesign (plain "what to do" first) — separate item, owner has not decided on it yet.
