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
