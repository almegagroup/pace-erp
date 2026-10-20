# PO22 — Engine + AI Full Planning (Design, for owner approval)

**Status:** DRAFT — written 2026-10-20 from the owner's own explanation (chat, Bengali).
**Nothing here is built yet.** Building starts only after the owner approves this document,
phase by phase.

**Supersedes:** the earlier idea that AI only *explains* the engine's result ("Explain with AI").
Owner, 2026-10-20: *"PO22-এর পুরো planning ... Engine আর AI করুক, করে দেখাক। কিছু বদল দরকার হলে
user করবে, করে আবার দেখলে ভালো-মন্দ AI বলে দেবে, কী করলে best optimization হয় suggest করে দেখাবে।"*

---

## 0. Core principle

| Who | Does what |
|---|---|
| **Engine** | All arithmetic: demand, prorata, stock, arrivals, day-by-day projection, MOQ / lead time / Target checks, cost. Every number on screen comes from the engine. |
| **AI** | Judgement: proposes the plan (vendor, date, qty, reschedule, transfer), proposes the best Settings values, rates the user's changes, explains trade-offs. **AI never produces a number by itself** — every AI proposal is re-simulated by the engine and only the engine's result is shown. |
| **User** | Final authority. Can change anything in the plan or settings; can accept or reject any suggestion. Planning always runs on the **user's** values. |

If AI is switched off or its budget is used up, the engine's own best plan is still shown
(the page never depends on AI to work).

---

## 1. Settings advice (Target / Critical / MOQ / Max days)

Today the user types Target (Safety) days, Critical days and MOQ (where the vendor has none).

**New:** next to every such value the system shows its **recommended value + reason**.

| Field | Who sets it | System does |
|---|---|---|
| Target (Safety) days | User | Recommends the best value. Shows "Best 30, you kept 40". User may record a reason (e.g. *"Iran war — import shipment delay"*). |
| Critical days | User | Same as above. |
| MOQ — where vendor MOQ is **not** set | User | Recommends the best lot size. |
| MOQ — where vendor MOQ **is** set (fixed by vendor) | Vendor master | **Never changed by the system.** Planning and optimisation work inside it. *(Owner wrote "Mixed MOQ" — read here as the vendor's fixed MOQ; please confirm, §9-Q1.)* |
| **Max days (new)** | **Engine + AI only** (owner 2026-10-20: user does not set it) | Computed per material: the most cover worth holding before the extra stock only ties up working capital. Shown, and used as the upper limit of every lot. |

Basis for the recommendations (owner: "start with these"):
- **Target / Critical:** vendor lead time history, actual delays (p50 / p90), demand variation.
  (A first version already exists: "Suggested T / C (no booking)".)
- **MOQ (non-vendor) and Max days:** money tied up (item rate × company interest %) versus
  ordering more often; never below the vendor's fixed MOQ / multiple.

The user's decision is stored (accepted / kept own value + reason, who, when), so the
history shows "system said 30, user kept 40 because …".

---

## 2. Planning tab — one material opens its whole family

User picks one material, e.g. **VAE 1100**.

1. **Family:** the system finds every group this material belongs to, every member of those
   groups, and every other group of those members (closure). Owner 2026-10-20 answers:
   all members' stock counted; their exclusive demand included; their other groups included.
   Materials **not mapped to the company** are never part of it (built 2026-10-20).
2. **Demand:** for every member, exclusive demand + group demand, **prorata, day by day**,
   from the effective PO21 plan (same explosion as today).
3. **Stock:** every member's counted stock (location policy D12).
4. **Allocation:** Method C (D13) — no member's Safety (Target) days are touched for another
   member's sake, and production never stops.
5. **Arrivals with status** (like the sheet's PLANNING tab):
   - **In transit** (shipped): fixed — shown, never moved.
   - **Ordered, not shipped** (PO / CSN with an ETA to Plant): the system suggests how many
     days to **advance or postpone** each one for the best plan; the user can store the
     **rescheduled ETA** (§4).
   - **Future buys:** which vendor (domestic or import), on which date, how much — domestic
     where it is better (e.g. a 20-day domestic item covers the gap), import where that is
     better.
6. **Summary (one screen, no switching between groups / items):**
   - per vendor: PO number or "new PO", PO date, ETD, ETA to Port, ETA to Plant, qty per item
   - Min / Max days on arrival
   - **R001 ↔ R002 transfers** (both directions — owner): which date, which item, how much
   - per day grid like the sheet: Opening, Arrivals, Planned lot, Use, Closing, Max / Min days

---

## 3. User changes → recompute → AI verdict

- The user may change any proposed lot (date, qty, vendor, member), delete it, add one, or
  change a rescheduled ETA.
- On every change the engine recomputes the whole family immediately.
- AI then says what the change does (good / bad, which day goes below Safety or above Max,
  money tied up) and shows the best alternative. The user accepts it or not.
- A user-changed lot stays as the user set it (it is not overwritten by the next
  suggestion) until the user releases it.
- The plan is saved as a version (who changed what, when; system value vs user value).

---

## 4. Rescheduled ETA (owner: "a place to keep it is needed")

New planning-owned record per inbound line (PO line / CSN / lot):
original ETA (from CSN Tracker), **rescheduled ETA**, reason, who, when. Append-only history.

- Planning uses the rescheduled ETA when present, else the CSN ETA.
- It does **not** overwrite the CSN Tracker's own dates (CSN stays the logistics truth).
  *(Please confirm, §9-Q2.)*

---

## 5. Store deviation

Procurement gives Store the usage schedule (which period, for which product, which item,
how much — today's Store report). If Store deviates, **the next planning run starts from the
current actual situation** (posted stock, actual consumption, current arrivals) and re-aligns
everything — no separate deviation alert (owner 2026-10-20).

User-held decisions (rescheduled ETAs, user-changed lots still in the future) are carried into
the new run; lots already received or in the past drop out.

---

## 6. Engine changes needed (today vs needed)

| # | Item | Today | Needed |
|---|---|---|---|
| E1 | Family view | Engine allocates groups correctly but shows one row per material | Family closure + family day grid (§2) |
| E2 | Horizon | CM + NM only | ~6 months like the sheet (§9-Q3 for demand beyond PO21's plan) |
| E3 | Import legs | One ETA to Plant | ETD → ETA Port → ETA Plant, back-calculated for future buys from lead-time legs |
| E4 | Lot sizing | Lot when cover ≤ Target, qty = just back to Target (tiny daily lots without MOQ) | Lot sized between Target and **Max days**, vendor MOQ / multiple respected, lowest total cost |
| E5 | Vendor choice per lot | Cost-to-cost comparison exists; vendor not chosen per date | Domestic vs import per lot by time + cost |
| E6 | Reschedule advice | None | Advance / postpone suggestion for ordered-not-shipped lines |
| E7 | R001 ↔ R002 transfer | One-way R→R advice from R003 only | Bidirectional R001 ↔ R002 by location need (stroke / Pack BOM line locations) |
| E8 | Max days | None | Computed per material (§1) |
| E9 | Settings recommendation | Suggested T / C only | T / C / MOQ / Max days with reason + user decision record |

---

## 7. AI loop (how AI and engine work together)

1. Engine builds the family position and its own best plan (deterministic).
2. AI receives that position + the engine's candidate options (vendors, dates, qty ranges,
   costs, risks) and proposes a plan / changes.
3. Engine simulates every AI proposal; only feasible ones are kept (no Safety breach, no
   production stop, within Max days, vendor MOQ respected).
4. Screen shows the engine-verified result + AI's reasons. If AI's proposal is worse than or
   equal to the engine's, the engine's plan is shown and AI says why.
5. Budget cap (B13) applies; AI off → engine plan only.

---

## 8. Phases (each released separately, owner approval per phase)

| Phase | Scope | Result for the user |
|---|---|---|
| **P1** | Family report (E1), horizon (E2), ETD / Port / Plant legs (E3), rescheduled ETA store (§4) | Pick one item → whole family on one screen, sheet-like, with arrivals and status |
| **P2** | Optimiser: lot sizing with Max days (E4, E8), vendor choice (E5), reschedule advice (E6), R001 ↔ R002 (E7), Summary | System proposes the full plan |
| **P3** | Settings advice (E9, §1) | Best T / C / MOQ / Max days next to the user's values |
| **P4** | AI loop (§7) + user edits with recompute and AI verdict (§3), plan versions | Engine + AI plan together; user changes get rated |

---

## 9. Owner answers (2026-10-20)

1. **MOQ:** "Mixed MOQ" = **Fixed MOQ** (the vendor's). The system never changes it; it plans and
   optimises inside it. The system advises only where no vendor MOQ exists.
2. **Rescheduled ETA:** kept **in Planning**. CSN Tracker is not changed by the system; the user
   updates the CSN themselves when needed.
3. **Demand beyond the PO21 plan** (~6-month horizon): when PO21 has no plan for a month, use
   (a) historical data for the same months, plus (b) the last 3 months' plans, plus (c) the
   production and dispatch trend. *(Weighting of a/b/c to be proposed in the P1 detail and shown
   to the owner before building.)*
4. **Ordering cost:** taken from **AC01 (Landed Cost)** where available; otherwise Max days / MOQ
   advice uses cost-to-cost comparison + working capital (money tied up) only.

## 10. How the prorata works (owner question 2026-10-20)

Demand comes from the stroke line (RM) or Pack BOM line (PM): **qty = dosage % × that day's
planned production** of the prodshade (PM: per outer pack × packs).

| Material is … | Its demand |
|---|---|
| **Only exclusive** (directly on a stroke / BOM line, no group) | That line's whole qty is its own. |
| **Only in a group** | No fixed share. The group line's qty is one **pool**; each day Method C decides which member supplies it: narrow group first, the primary first when "Use Primary = Yes", otherwise the member with the most free stock above its own Safety days; the rest is bought (engine / AI choose the member + vendor). |
| **Both exclusive and in a group** | Its own exclusive qty first (protected), **plus** whatever share Method C draws from it for the group pool(s) — only from stock above its own Safety days. |

**Family total per day** = Σ exclusive qty of every member + Σ every group pool qty (each counted
once — never per member, so no double count). The family grid shows the total and, under it,
each member's split (exclusive + drawn for groups) as decided by Method C.

## 11. Owner additions (2026-10-20, later)

1. **Full-page display like IN03.**
2. **Layout like the sheet's PLANNING tab:** family day grid; **Future Orders** block (vendor, PO
   date, ETD, ETA Port, ETA Plant, qty, Max / Min days); **Location Transfer instructions and
   suggestions** (R001 ↔ R002) below it.
3. **Engine + AI make the plan, not only suggest.** The plan is pre-filled; the user can edit it:
   increase / decrease a lot qty, set or change *Quantity to Dispatch*, move the **calibration
   row** (the date the system calibrated) to another date. Every edit → full recompute → AI verdict.
4. **Import PO date already past (back-calculated PO date ≤ today)** — proposal, pending owner
   confirmation:
   - First use what exists: other members' surplus, advancing ordered-not-shipped lots
     (rescheduled ETA), R001 ↔ R002 transfer.
   - **Bridge order (domestic)** only for the gap up to the earliest feasible import arrival,
     labelled "Bridge — import too late"; vendor fixed MOQ respected (any excess reduces the
     import qty).
   - **Import order still placed** at the earliest feasible date for the remaining group +
     exclusive need (import was needed for group optimisation and exclusive coverage).
   - Show the extra cost (on-time import vs bridge) and AI's lesson (which day the order was
     due, why it was missed, suggested Safety-day / lead-time change).
   - No domestic vendor: Critical alert with the stop date + possible actions (other member,
     user-created Sub-CSN from another company, fastest import).

Open: Q-A meaning of "calibration row" (sheet CC reset of opening to book stock?); Q-B bridge
qty = gap only vs domestic vendor MOQ; Q-C bridge placed into the plan automatically or flagged
first (extra cost).

### 11.1 Owner answers (2026-10-20) + fixed-MOQ rule for bridge / import

- **Calibration row = the sheet's CC row** (the day the opening is reset to the actual book stock).
  The user can move it to another date.
- **Bridge order:** placed into the plan automatically **and** highlighted as an alert.
- **Fixed MOQ is never broken, neither domestic nor import.** Quantities are rounded up to the
  MOQ / multiple; the engine adjusts **timing**, not quantity below MOQ:
  - *Domestic bridge, need 10 MT, MOQ 25 MT* → buy 25 MT. The extra 15 MT covers further days
    (15 MT ÷ daily use), so the next import's need date moves later by that many days.
  - *Import MOQ also fixed* → the import is not cut below its MOQ; its **date moves later** until
    the arrival lands when cover falls to Target. Only quantity above the MOQ (in multiples) can be
    reduced.
  - If an MOQ forces cover above Max days, it is shown as an alert ("MOQ forces X days above Max,
    ₹Y extra working capital"). The engine compares the options (another vendor with a smaller
    MOQ, another member's surplus, shifting / skipping one import cycle) and picks the lowest
    total cost; AI explains; the user decides.

### 11.2 Correction (owner challenge 2026-10-20): a bridge only covers where it is allowed

The earlier line "the next import's need date moves later" is only true for the part of demand
the bridge material may legally serve.

- Every demand line has its own allowed materials (stroke / Pack BOM line + its group). A domestic
  bridge material covers **only** the demand lines where it is an allowed candidate (normally a
  group pool it belongs to).
- The import material's **exclusive** demand, and every group the domestic material is not a
  member of, is **not** covered by the bridge. That part still sets the import's need date — it
  does not move.
- The engine splits the import need into: (a) substitutable part (bridge may cover → only this
  part's date can move) and (b) non-substitutable part (exclusive / other groups → date fixed).
- If (b) cannot be met before the earliest possible import arrival: Critical alert per prodshade
  with the stop date, the shortfall qty, and the options found in 11.3.

### 11.3 Alternative routes for the same material (owner: yes, system + AI search them)

When the normal route is too late, the engine lists every **known** route for the **same
material**, ranked by arrival date then total cost:
- other vendors of the same material (ASL / vendor-material info, purchase history), incl. a
  domestic trader / stockist of an import material;
- the same vendor by a faster mode where a lead time for it is on record (e.g. air vs sea);
- advancing an already ordered, not shipped lot (rescheduled ETA);
- another company's stock or in-transit lot — **suggestion only**; the user creates the Sub-CSN
  (cross-company movement stays user-created).
AI explains the trade-off. Routes not on record cannot be invented: AI says "no faster route on
record — consider sourcing a local trader" instead.

### 11.4 More options when the situation is out of control (owner 2026-10-20)

Added to the 11.3 list; the engine computes each option's effect (days gained, cost, risk), AI
explains, all ranked together, the user decides:

1. **Safety compromise** — use the item's own protected stock: first from Target down to Critical
   (alert), below Critical only with the user's explicit acceptance (shows the stop date it moves).
   Method C already marks this case today ("used protected stock").
2. **Tweak an existing consignment** — increase / split / advance the qty of an ordered-not-shipped
   PO / CSN (vendor permitting). Stored as a planning overlay like the rescheduled ETA (§4);
   the PO / CSN itself is changed by the user.
3. **STO from another company's excess** — same material, or another group member allowed on the
   demand line and mapped to this company. **Excess = that company's stock above its own Target
   and its own future need** (its plan), so the sender is never put at risk. Shows qty and
   expected arrival (STO lead time from history). Suggestion only — the user raises the STO.
