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

---

## 12. Later in the same session: Gabrosa at its own Min, lot size, delays, source order (owner 2026-10-28)

### 12.1 A member that is bought at its own Min (Gabrosa 20 days vs Group B 30 days)

- Group B Min = 30 days. Gabrosa can be bought locally and lands in about 6 days, so the owner set Gabrosa's own
  Min to **20 days**.
- If the procurement plan finds that buying Gabrosa is the best way to cover the gap, **Gabrosa is connected at
  its own Min days (20), with its lot size**. Group B's 30 days does not force the order earlier.
- The order date is derived from **lead time** (booking + route days): the date the shortage appears minus lead
  time. It is not "when the group reaches 30".
- Between day 30 and day 20 the group's cover falls from 30 to 20 days. **The other members (Combizell, TS) cover
  that gap** — the group reserve is one quantity, not tied to one material. This is planned, so it is **not shown
  red**. It becomes red only when the group's cover is **below Critical** and no confirmed lot arrives in time.
- When the lot lands, the group must refill from where it stands to Max. That gap is now bigger (20 → 60 = 40
  days, instead of 30 → 60 = 30 days). Group B at ≈ 1,406 KG/day: 40 days ≈ 56,260 KG instead of 30 days ≈ 42,195
  KG, i.e. ≈ 14,065 KG more taken from the Excess Pool. The pool is therefore smaller, and **the next rotation is
  calculated automatically from this new state**; nothing is adjusted by hand.
- If the pool plus the new lot is smaller than that gap, the group stays below Max and the **next receipt** closes
  the rest. Example: lot 24,000 + earlier excess 20,000 = 44,000 against 56,260 → short ≈ 12,260 KG; the group
  reaches about 20 + 44,000 ÷ 1,406 ≈ 51 days, not 60. The system must report how much excess remains in the pool
  after each Min.

### 12.2 A lot that serves more than one level

- Gabrosa serves **Exclusive, Group A and Group B**; the lot enters the **Excess Pool**.
- Only a level that has reached its own Min claims; a level that is nearly full does not. Example: Exclusive at 55
  days on the day the lot lands claims nothing, so the lot goes to the level that is waiting (B). Exclusive claims
  only when it falls to its own Min (about 25 days later).
- A level that already reached Min and could not be filled (pool was short) is **waiting**; when new stock lands,
  waiting levels take it first, in the order Exclusive → A → B.
- Gabrosa is the only material the **Exclusive** level can use. If Gabrosa runs out, the Exclusive flat stops and
  no other material can replace it. The order timing and size for Gabrosa must therefore be decided for **all
  three levels together**, not for Group B alone.

### 12.3 Owner's hard requirement: no level may fall short

- **Exclusive or any Group must never be short, in any situation** (owner: "ami chai kono abosthatei exclusive or
  Group, kothao jeno ghatti na pore").
- This is achieved by: narrow levels are served first at their Min; inside a group the **FEFO order** means the
  newest lot (the newly arrived Gabrosa) is used last, so it stays in the pool; and the planner runs ahead day by
  day and raises a purchase / reschedule advice when a shortfall appears. Any shortfall is shown on the broad
  level (B), never taken from the narrow levels.
- **No hold-back.** An earlier proposal in the same session to earmark Gabrosa for Exclusive's next claim was
  **withdrawn by the owner**: a level takes what it needs on its own Min date, and FEFO already keeps the newest
  lot for last. Caveat recorded: Gabrosa is last only when it is the newest / latest-expiring lot; an older
  Gabrosa lot would be consumed earlier under FEFO.
- **No extra ETA margin** is added: stock is always kept above Target, and Target is the margin. If a lot slips,
  the system recomputes and advises.

### 12.4 Lot size

- The **quantity needed** is decided from the shortfall. What **arrives** is decided by lot size (MOQ and multiple):
  need rounded up to the lot size, never below MOQ. A need larger than one lot gives several lots.
- Whatever is more than the need becomes **excess** in the pool and is picked up by the next rotation
  automatically. Example: need 14,000 KG, lot 24,000 KG → 10,000 KG excess.
- A lot lands whole, on one date. Lot size also drives cost (interest, space) and is part of the vendor / lot
  comparison already done by the procurement plan.

### 12.5 A delayed shipment

- Example: a lot expected when the group is at 30 days lands at 15 days instead. The group's cover drops below
  Critical (20) in between, so it is shown **red**.
- On landing the **same rule** applies. The lot enters the pool; waiting levels take it in the order
  Exclusive → A → B; the group refills **up to Max** (15 → 60 = 45 days ≈ 63,290 KG for B). If the lot is
  smaller, the group stays below Max and the next receipt closes it. If it is bigger, **the rest stays as excess**.
- The rest of the lot does **not** push other levels to fill early: each other level claims from the pool only on
  its own Min date (unless it is already waiting).

### 12.6 Source order for filling a level

1. The level's own reserve.
2. The **Excess Pool** (today's spare stock), Exclusive → A → B, up to Max.
3. **Confirmed incoming** stock (CSN / PO already raised), entering the pool on its ETA.
4. **New procurement**, only for what 1–3 cannot cover: quantity rounded by lot size, order date = shortage date
   minus lead time, vendor / material chosen by the procurement plan.

In the worked example the first need for a new order is the Group B shortfall of ≈ 38,930 KG on 27 Mar 2027
(after the pool and every confirmed receipt are used), not before.

### 12.7 Reporting rules the owner asked for

- After each Min the system states **how much excess is left** in the pool (by material).
- When the PO21 plan ends, the system says "plan ends here, protection beyond is unknown" rather than assuming
  zero silently.
- The owner decided that **the engine must be aligned to this method** (not the other way round). How readable
  the Excel / output is will be discussed separately, after this record.

### 12.8 Additions to the unverified list (§11)

8. Engine behaviour for: member buy at its own Min (12.1), claim only on own Min / waiting-level priority (12.2),
   FEFO keeping the newest lot last inside a group (12.3), lot-size rounding with surplus into the pool (12.4),
   delay handling (12.5), source order (12.6).
9. Confirm in the settings that "Max = Target + order cycle" holds for each item of the family (§2).
10. Whether the planner's day-by-day run is enough to raise the shortage advice early (12.3) or needs an
    iterative "add order, run again" pass.

---

## 13. How the family must be shown (PO22 4A family table and the Excel) — owner 2026-10-28

Goal (owner): anyone who looks at the family table must understand the whole flow — each level's Min / Max days,
when and how much goes from the pool to which level, how each material is shared (pro-rata) between levels and
inside a level, and the procurement projections with the ETA to the plant. No raw mock-ups were built; this is the
agreed structure. The Excel carries the **same blocks, same words, same numbers** as 4A.

**One plain sentence on top**, for example: "Group B will be short ≈ 38,930 KG on 27 Mar. Order TS or Combizell
by mid-Jan. Exclusive and Group A have no problem." Whoever reads only the first line knows what to do.

**Block 1 — each level's state now.** One **row per level** (never one column per level, so a family with many
groups stays narrow): level, members, Min / Max / Critical days, cover now (days), reserve (KG), date of the next
Min.

**Block 2 — the flow: when, how much, from the pool to where.** One row per **event day**, not per calendar day
(receipt lands, a level reaches Min and is topped up to Max, a shortfall, an order is due): date, what happened,
level, KG, pool before → after. Example rows: 28 Oct initial reserves 93,780 (pool 118,300 → 24,520); 12 Nov TS
+25,000; 17 Nov Gabrosa +24,000; 27 Nov Exclusive +3,335, A +1,360, B +42,195 (pool 73,520 → 26,630); …; 27 Mar
B gets 3,265 of the 42,195 it needs (short ≈ 38,930, pool 7,960 → 0).

**Block 2B — Material × Level matrix (pro-rata).** One grid, rows = materials, columns = Exclusive, Group A,
Group B, Pool (excess), total stock.
- Each cell = KG of that material held for that level; "—" where the material is not a member of the level (TS
  shows "—" under Exclusive and Group A, so the user sees TS is Group-B only).
- Row total = the material's whole stock; column total = the level's reserve. The system shows a **checksum**
  that rows and columns agree, red if they do not.
- Beside each cell: its share (% of the level's reserve) and the **reason for the split** — saved order, FEFO
  (expiring first), run-down, or free-stock ratio.
- It is shown once after Block 1 (today) and, expandable, on each event row of Block 2 (the matrix after that
  event, e.g. after B is topped up on 27 Nov).
- This covers **both** pro-rata directions the owner asked for: how a material is divided between the levels,
  and how a level is made up of its materials. The separate "pool by material" block is not needed; the Pool column
  of this matrix is that block.

**Block 4 — procurement and ETA to plant.** Only for shortfalls the pool and the confirmed receipts cannot cover:
shortage date, level, KG, order-by date (shortage date minus lead time), material and vendor, lot size, ETD → ETA to
plant. Together with it, every **open CSN** with ETA, ETD, dispatched or not, and the §10 verdict (reschedule by N
days / cannot be scheduled, talk to the vendor).

**Still to decide with the owner**
1. Whether the 4A family table is replaced by these blocks, or kept and these blocks go in a new tab.
2. Block 2 shows event days only (recommended; per-day would be ≈ 180 rows for six months).
3. The numbers in the matrix come from the engine's pro-rata (saved order → FEFO → run-down → free-stock ratio with
   the small cost × credit tilt); none were pre-filled in this note.
4. Readability of the Excel beyond this structure (language, reader) is discussed separately.

---

## 14. Audit: engine vs this method (2026-10-28, read-only, no code changed)

How: read `mts_family_planner.logic.ts`, `mts_family_purpose_ledger.logic.ts`, `mts_group_policy.logic.ts`; ran the
real `planFamily` on the §3/§7 example (3 materials, stock 17,300 / 75,000 / 26,000, flat daily demand
111 / 45 / 1,406 KG for Exclusive / A / B, the seven CMP003 consignments of §5, no new buys) and read the PROD
policy rows for CMP003 (members Target 30 / Critical 20, no saved group policy).

### Matches the method
1. Levels are served narrow → broad (pools sorted by member count; Exclusive handled first as protection).
2. Day-0 reserve of Max for every level from today; the rest stays unreserved (the "pool").
3. A level is refilled from free stock when it falls below Target; excess claims are released and re-waterfalled.
4. Receipts count only on a valid ETA inside the horizon; a passed / missing ETA is risk only.
5. Demand only where a PO21 plan exists (zero otherwise).
6. Lot size: MOQ / multiple applied, surplus stays in stock; order date = need date − lead time.
7. No stock went negative in the run (Gabrosa closing ≥ 3,597 KG up to 28 Mar).

### Differences (engine ≠ method)
| # | Method (owner) | Engine today | Evidence |
|---|---|---|---|
| D1 | A level claims from the pool only at its **own Min** (a waiting level first on a receipt) | **Every group is refilled to Max on every receipt day**, and on any breach | Group B reserve = 85,796 on 12 Nov, 17 Nov and 8 Dec (always full); so the 27 Nov / 27 Dec Min dates of §7 never occur |
| D2 | Inside a group, **FEFO**: the earlier lot (TS) first, the newest (Gabrosa) last | FEFO only for **opening** receipts that carry an expiry; future CSN lots have no expiry; otherwise saved order, run-down, then free-stock ratio with cost / credit tilt | Day 0 Group B reserve = Combizell 57,255 / TS 20,512 / Gabrosa 8,030 (stock ratio); the 24,000 Gabrosa lot of 17 Nov is partly claimed by B at once (B:Gabrosa 6,999 → 9,839) |
| D3 | **Exclusive** is a level with its own reserve, Min, top-up and "waiting" state | Exclusive is a rolling protection of the next Max days of its own demand, taken off the top every day; no Min / top-up / waiting | Exclusive never short in the run, but it has no Min date or top-up row to show |
| D4 | Max = 60 days | Reserve = today's use + 60 days ahead (61 days) | B 85,797 vs 84,390; A 2,765 vs 2,720; Exclusive ≈ 6,781 vs 6,670 |
| D5 | Group Target 30 stays. **The 20 days belongs to one member (Gabrosa), not to the group** (owner correction 2026-10-28): if Gabrosa has to be bought it is connected at its own 20 days, not at the group's 30 | PROD: no saved group policy for CMP003 (group default Target 30, Critical ceil(Target ÷ 2) = 15, which the owner has not asked to change); all four members are 30 / 20, i.e. Gabrosa's own Min is **not** 20 in the data yet. Nothing to change in data until the owner decides the member values |
| D6 | Group B short ≈ 38,930 KG on 27 Mar | Group B first below Target on **5 Apr**, below Critical **20 Apr**, no stock-out by 30 Apr | `group_actions` of the run; cause is D1–D4, not yet isolated |
| D7 | Event log, pool by material, Material × Level matrix (§13) | No per-event pool or matrix output. Daily group reservations + closing stock + protection exist, so the pool is derivable | `group_bucket_reservations`, `rows`, `waterfall_reservations` (only after the horizon) |
| D8 | "Excess left after each Min" reported | Not produced | — |
| D9 | Reschedule only if ETD − today > 15 d (import) / 7 d (domestic), sail time = route days | `optimizeFamilyArrival` tries every 7 days across the horizon, scoring stock-out / below-Critical / below-Target days; **no ETD, no sail time, no import/domestic check** (`import_trade_type` is not used in planning code) | source of the misleading "postpone 59 d / prepone 41 d" |
| D10 | Own-Min buy (Gabrosa 20 d inside a 30 d group) | Per-member Target is supported; a group buy is sized to the group Desired Max. Not exercised | unverified |
| D11 | "Plan ends here" warning | `useAhead` beyond the horizon uses the average over the whole horizon including zero-demand months (the `coverDays` fix of 27 Oct was not applied here) | affects reserve windows near the end of the horizon only |

### Suggested order of work (owner to approve)
1. D5: no data change now. Owner will set member values (e.g. Gabrosa 20) himself; the engine must honour a member's own Min when that member is bought (D10).
2. D1 (claim only at own Min / waiting level first), D3 (Exclusive as a visible level), D2 (FEFO across arrival
   lots, newest last), D4 (60 vs 61 days) — one engine change, then re-run this example and compare with §7.
3. D9 reschedule feasibility window.
4. D7 / D8 outputs (event log, Material × Level matrix, excess left) and then the 4A table / Excel of §13.
5. D10, D11 checks.

### 14.1 Owner's clarifications after the audit (2026-10-28)

- D2, D3, D4 approved. D5 corrected as above (the 20 days is Gabrosa's own, not a group value).
- **Nothing is hard-coded.** Days, ETAs, windows, Target / Min / Max are always read from settings and data.
  The 15-day (import) and 7-day (domestic) reschedule windows of §10 are therefore to be settings with these
  values as defaults, not constants in code.
- **Where the "refill to Max on every receipt day" of D1 applies today:** only to **groups**. Exclusive / own use is
  a continuous protection of its next Max days, so it never gets a Min / top-up event. The owner's point:
  **Target (Min) days must apply to every level — Exclusive, Group A, Group B and members — not to groups only.**
  After the change, Exclusive and every group follow the same rule: run down to own Min, then claim from the pool
  up to own Max; nothing is refilled on a receipt day unless the level is at / below its Min (or is waiting).
  A member's own Target (Gabrosa 20) still governs when that member is bought.

---

## 15. Engine change D1–D3 (+ D2/D4 decisions) — implemented 2026-10-28 on `agent/claude`

File: `supabase/functions/api/_core/procurement/mts_family_planner.logic.ts` (+ tests in the same folder).

| # | Change |
|---|---|
| D1 | A group claims from the pool **only on day 0 or when its own reserve is below its own Min (Target)**. A receipt day no longer refills a group above Min. A group that reached Min while the pool was short stays below Min (**waiting**) and is served first, narrow → broad, when stock appears. The release and second-rotation of excess still run on a receipt day. |
| D3 | **Exclusive / own use is a level**: persistent `ownReserve` per material with own demand, run down by its own use to its own Min, then claimed from that material's unreserved stock up to its own Max. The old rolling "next Max days" protection is gone (`protection` is only kept for `freeAfter`). |
| D2 | **FEFO across lots** in the no-saved-order path (refill, second rotation, consumption): members are ordered by the age of their **oldest remaining receipt** (counted opening stock = −1, a confirmed ETA / lot = its landing day); members with equal age keep the stock-weighted ratio with the cost / credit tilt. Saved group order and short-life expiry priority are unchanged and still come first. |
| D4 | **Not changed — by design.** The reserve is "today's use + Desired-Max days ahead", i.e. **exactly Max days remain after today's use**. The owner's 60 days is that post-use figure; 61 appears only because the reported number is the pre-use balance. |
| D5 | Owner correction: the 20 days belongs to Gabrosa as a member, not to a group. No data change. |

### Verification
- New tests: D1 (receipt does not refill a group above Min; refill to Max below Min), D2 (older stock first, newer lot last), D3 (exclusive use never short, no group shortage). **D1 and D2 fail on the old engine and pass on the new one.** The existing W4 test now uses a 20 KG opening member so that the receipt is needed from its ETA (older stock is served first).
- 249 pure procurement tests pass (21 files); all CI guards pass; `deno check` error count unchanged (25, pre-existing).
- Planner benchmark (108 materials, 187 days): ≈ +20% time (2.3–2.5 s → 2.9 s); synthetic buys 830 → 701.
- Re-ran the §7 example (same inputs as the audit):
  - total stock on 26 Dec = **122,520 KG**, identical to the hand figure (75,630 pool + 46,890 reserves);
  - Group B refills at Min on 27 Nov, 28 Dec, 28 Jan, 1 Mar, then only a **partial** refill on 1 Apr (+1,022 of ≈ 41,400 needed) — the hand figures were 27 Nov, 27 Dec, 26 Jan, 25 Feb, 27 Mar (short ≈ 38,930). The engine is later by one day per cycle because it claims when the reserve is **strictly below** Min (the "equal still serves today" rule; making it ≤ would rebuild a group daily when Desired Max = Target) and by the discrete 31 / 28-day months; Group A refills a day after B;
  - Group B first below Target on **1 Apr** (was 5 Apr), below Critical on 16 Apr; no stock-out by 30 Apr;
  - the newest lots are used last: Gabrosa is largely left in the pool for Exclusive / Group A.

### Not done yet
D9 (reschedule feasibility window), D7 / D8 (event log, Material × Level matrix, excess left), D10 (a member's own Min when it is bought — not exercised), D11, the 4A table / Excel of §13, and the live PROD run (needs the real handler path).

---

## 16. D7–D11 and the 4A table / Excel — implemented 2026-10-28 on `agent/claude`

| # | Done |
|---|---|
| D9 | Reschedule advice only when the vendor can still move the shipment. Pure rule `mts_reschedule_window.logic.ts` (8 tests); DB side `mts_reschedule_window.handlers.ts` (CSN ETD / vendor, PO `import_trade_type`); every `reschedulable_arrivals` row carries `window` (`RESCHEDULE` / `TALK_TO_VENDOR` / `UNKNOWN` / `NO_CHANGE`). `TALK_TO_VENDOR` removes the advised date and shows the message in Item Plan, the Planning tab and the Excel ("Vendor can move it?"). The two windows are a **company setting** (table `erp_planning.company_reschedule_window`, migration `20261028100000`, applied to **dev only**; GET / POST `/api/procurement/mts-requirement/reschedule-window`; edited on the Requirement → Settings tab). Defaults 15 / 7 apply only when a company has no row. |
| D7 | The planner now returns `level_events` (opening reserve, receipt, top-up, waiting — a level that keeps waiting is logged once), `level_matrix` (Material × Level snapshot on every event day, checksummed against stock) and `level_policies` (Min / Max / Critical, reserve and cover now). `trace:false` keeps the arrival optimizer fast. |
| D8 | "Excess left" = the pool columns of the matrix and the `pool_after` of each event. |
| 4A | New panel "Waterfall" in the Item Plan (Block 1 levels, Block 2 flow, Block 2B Material × Level with a day picker and an Adds-up tick) and the one plain sentence above the day grid (`MtsWaterfallPanel.jsx`, `mtsWaterfall.js`, 4 tests). Server shape: `mts_waterfall_view.ts`, shared with the Excel. |
| Excel | Four tabs: WATERFALL_SUMMARY (one sentence per family), WATERFALL_LEVELS, WATERFALL_FLOW, WATERFALL_WHO_HOLDS (long format: day × material × level). |
| D10 | A member that has to be **bought** is connected at its **own** Min (`targets[m]`), not the group's: Gabrosa Target 20 inside a 30-day group → need date 25 Oct instead of 15 Oct, order date = need date − lead time. The group itself still refills from the pool at the group's Min. |
| D11 | `useAhead` beyond the horizon averages over the days that use stock (cached per series), as `coverDays` already did. |
| Engine | Members are ordered, when no saved order applies, by **levels served** (fewest first: TS → Combizell → Gabrosa), then FEFO age, then the stock ratio. Reason: with FEFO alone the opening stock of every member ties and Group B drained Gabrosa, leaving Exclusive short in March. A group never draws more than the physical balance (rounding residue). |

### Verification
- 260 pure procurement tests, 6 frontend test files, all CI guards, `deno check` (0 new errors), eslint: pass.
- The §7 example (day 0): Exclusive 6,670 · A 2,720 · B 84,390 KG, **60 days each** — identical to the hand figures. Total stock on 26 Dec = 122,520 (identical).
- With purchases on (Gabrosa lead 6 d, TS / Combizell 45 d): no stock-out and no group shortage in the horizon; the engine buys Combizell (order by 11 Feb) for Group B.

### Still open
- Live run on PROD data through the real handlers (needs deployment; the settings table must be created on PROD first).
- The "narrow level first" guarantee is by order of use and by advice; an Exclusive level can still show a **WAITING** event when the shared material was drawn by a group earlier (see the 15 Dec top-up in the example run).

---

## 17. Store instructions — what Store sees (owner 2026-10-28)

Store needs two things only:

1. **Items by period** — columns **Period · Item · Material group · Quantity · PO21 parent group · Child group(s)**. The child groups of ONE parent
   group that use the same item are shown **together on one row** (not one row per child group). Quantity is the amount to issue from
   physical stock; "Not yet backed" sits beside it (never issue against it). Rows follow the waterfall: the item/lot order inside a group is the
   engine's (least-shared material first, FEFO), so Store does not need to know about levels or the pool.
2. **Transfers** — **Transfer by · For period · Item · From · To · Quantity**: `R003` (the transfer-source store) → `R001` / `R002`, and
   `R001` ↔ `R002`, how much and by when.

Implementation: `mts_store_instruction.logic.ts` (`scheduleStoreTransfers`, 4 tests; a shop floor `S00n` is fed from `R00n`; P stores and others are
not part of the R advice), payload `store_transfers` (planning + rolling plan), `mtsStoreInstruction.js` (`aggregateStoreItems`, 3 tests),
Store Report tab views *Items by period* (default) · *Transfers* · Product-wise (detail) · Material summary · Group summary, Excel tabs
`STORE_INSTRUCTIONS` (items), `STORE_TRANSFERS`, `STORE_DETAIL` (the old product-wise rows).

Transfer rule, per material, period by period (current month's rest, then next month): a store whose stock does not cover its need receives first
from the TRANSFER-SOURCE stores (role in the company location policy), then from a peer R store's **spare** (its stock minus what it still needs
itself in this and later periods); each store's stock falls by its need after each period; "by" = the first day of the period. Need of a store =
the demand of the lines located there (backed + not yet backed). Advisory only: nothing is posted.

Not done yet: a live run on PROD data through the handlers (stock by location, location roles); finer dates than the period start (the first day the
store would run out inside a period) — to be added if Store wants it.

---

## 18. Owner's review of the downloaded Excel `mts_plan_20261027_2.xlsx` → Store and RM/PM_PLANNING (2026-10-28)

Findings in that file (generated before the waterfall changes were deployed, so it has no WATERFALL / STORE_TRANSFERS tabs):
- **RM_PLANNING / PM_PLANNING already report a family as ONE block** — every group and the exclusive use of its members together
  (e.g. CMP003 "MC 60 OTHERS / MHEC / MHEC PLC": Opening 119,109.966 KG = Combizell 75,509.92 + TS 26,027.65 + Gabrosa 17,366.30 + FMC 206.1 + MC 60 0;
  Pro-rata 1,646.275 KG/day = the whole family's daily use; Closing = Opening + ETA − use). The arithmetic of the rows adds up.
- What was missing for a correct reading: the block gave **one blended Max/Min days** and no view of the levels inside it.
- Data gaps visible in the file: "ENGINE CANNOT PLAN — MECELLOSE FMC 25002: no Target/Critical" (owner to enter Target / Critical); engine advice such as
  "postpone 23 d / prepone 34 d" predates the ETD window of §10.

Done (this change):
1. **RM_PLANNING / PM_PLANNING** keep the combined family block (group + exclusive together) and now add, under the block title, a line stating that the
   figures are the whole family and **one line per level, narrow first** (Exclusive — item, then each group): its own Min / Max / Critical days, reserve now,
   days it covers, next Min date.
2. **Store instructions only for group items.** A row is kept when it names a material group, or when its material is a member of any group (so a group
   member's **exclusive** use is included). Straight items are left out of *Items by period* and of the transfers; the old product-wise detail
   (`STORE_DETAIL`) still lists everything.
3. **Items by period** now also shows **Use from → to** (the period's dates) and **Keep at end of period (up to Max days)** with the level's **Max days**:
   the reserve the waterfall holds for that item at the last day of the period (current month = end of this month, next month = its last day), read from the
   Material × Level snapshot (`checkpoints` in the planner). The keep belongs to Period × Item × Group; when the same item is listed for several parent
   groups it is shared in proportion to the quantity each uses, so it is never counted twice.

Still open: a live PROD run (the downloaded file is the only PROD output seen); "Keep" for an item that has no reserve in a level is shown as 0.

---

## 19. Store plan for the whole horizon, on ACTUAL stock only (owner 2026-10-28)

Owner: with a six-month plan the Store must get the coming months, not only this month, with the excess that stays. And a CSN / PO piece that is not yet
connected (not received) must not be counted: Store gets instructions on actual stock. A piece whose ETA passed or is missing is taken as arriving today by
the planner (so it is not bought again — owner rule D5), but it has not come into stock.

Built (`mts_store_plan.logic.ts`, payload `store_plan`, Store Report views *Items by period · Excess left · Transfers*, Excel `STORE_INSTRUCTIONS`,
`STORE_EXCESS`, `STORE_TRANSFERS`):
- **Periods:** the current month from today, then every month of the planning horizon (Planning tab: CM + NM; the Excel / rolling plan: six months).
- **Use is split by where the stock comes from** (the planner's draws, per source): **Issue from stock now** = actual counted stock (the only part Store may
  issue) · **After receipt (CSN/PO, ETA valid)** · **ETA passed / none (not received)** · **Planned lot (not ordered)**. A note says "Do not issue against: …".
- **Keep at end of period (up to Max days)** and the level's **Max days** from the Material × Level snapshot at each month end (`checkpoints`); the
  **Excess left** in the pool at each period end per item, with today's stock beside it. Keep and excess are planning figures: they include receipts that
  are expected by that date.
- **Transfers (R003 → R001 / R002, R001 ↔ R002) use the actual-stock part only**, month by month, "by" = the first day of the period.
- Group items only; the child groups of one parent that use the same item share one row. Not-yet-backed quantity of a group is its own row.
- A saved run from before this change keeps the older CM + NM figures and says so on screen.

Open: live run on PROD data through the handlers.

## 20. Column picker + named layouts (Requirement tab) — owner 2026-10-28

- A "Columns" button on the PO22 Requirement report opens the shared column drawer. Unticking a column hides it at once.
- Identity columns (material etc.) are always shown and not offered. A column added later is shown even in an old saved layout.
- "Save Current As…" stores the visible columns under a name (per user). A saved layout can be chosen, set as default or deleted.
- The Excel uses exactly the same visible columns as the screen (plus the "Column groups" quick switches), and the sheet header notes the layout name.
- Storage: existing `erp_inventory.report_column_layout` / `report_layout_default` (report code `PO22_REQUIREMENT`); thin PO22 routes `/api/procurement/mts-requirement/layouts…` under ACL `PROC_MTS_REQUIREMENT` VIEW. No new migration.
