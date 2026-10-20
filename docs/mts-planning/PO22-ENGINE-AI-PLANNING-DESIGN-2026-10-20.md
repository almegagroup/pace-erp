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

## 9. Open questions for the owner

1. **"Mixed MOQ"** — does this mean the vendor's fixed MOQ (system must not change it)? Or a
   case where one item has several vendors with different MOQs?
2. **Rescheduled ETA** — kept only in planning (CSN Tracker unchanged), or should it also be
   visible / editable in CSN Tracker?
3. **Demand beyond the PO21 plan** for the ~6-month horizon: use PO21 plans when entered,
   otherwise the average of the last N months' actual consumption? Which N?
4. **Ordering cost** — is there a known cost per order (import: CHA, documentation, freight
   minimum; domestic: freight), or should Max days / MOQ advice use only money tied up for now?
</content>
</invoke>
<invoke name="Bash">
<parameter name="command">cd /tmp/wt-dev && cp docs/mts-planning/PO22-ENGINE-AI-PLANNING-DESIGN-2026-10-20.md /tmp/claude-0/-home-user-pace-erp/3a269f15-c264-5891-93aa-2f56c1fcf06d/scratchpad/ && git add docs/mts-planning/PO22-ENGINE-AI-PLANNING-DESIGN-2026-10-20.md && git commit -q -m "docs(po22): Engine + AI full planning design draft (owner explanation 2026-10-20)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013jKozMvAYeqq79pYQGbFXz" && git push -q origin HEAD:dev && git log --oneline -1