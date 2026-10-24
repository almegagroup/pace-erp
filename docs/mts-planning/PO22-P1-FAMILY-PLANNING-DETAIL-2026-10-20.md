# PO22 P1 — Family Planning page (detail design, for owner approval)

**Parent:** `PO22-ENGINE-AI-PLANNING-DESIGN-2026-10-20.md` (§2, §4, §6 E1-E3, §10, §11).
**Status:** DRAFT 2026-10-20. Nothing built. Owner approval needed on §7 before building.

P1 delivers the *view*: pick one material → its whole family on one full page, sheet-like, with
all arrivals and status, over ~6 months. **Lot proposals, vendor choice, transfers and AI planning
are P2-P4** — in P1 the "Planned lot" column and the Future Orders "new PO" rows stay empty.

---

## 1. Page

- Full page like IN03 (no side panel), opened from PO22 → **Planning** → "Family plan".
- Header: Company (shared transaction-company pattern: single company locked, multi = only allowed
  companies), As-of date, **Material picker** (search by code / name), Run.
- Family strip: every member with its role badges — `Exclusive`, `Group: MHEC`, `Group: MHEC_PLC` —
  plus stock, Target / Critical days, vendor(s). Materials not mapped to the company never appear
  (built 2026-10-20).

## 2. Block A — day grid (sheet PLANNING tab equivalent)

One row per day, as-of → end of the 6th month (as-of month + 5):

| Column | Meaning |
|---|---|
| Date | |
| CC | calibration row marker — P1: the as-of day (opening = actual counted book stock). Moving it is a P4 user edit. |
| Opening | family stock at day start |
| Arrivals | sum of arrivals that day (ETA to Plant, or rescheduled ETA) — click → which PO / CSN |
| Planned lot | *(P2)* |
| Use | family use that day = Σ members' exclusive use + Σ group pools (each pool once) — §10 of parent |
| Closing | Opening + Arrivals + Planned − Use |
| Max days | Closing ÷ forward daily use (walks the coming days' use) |
| Min stk | Opening − Use (stock if that day's arrival came at day end — same as the sheet) |
| Min days | Min stk ÷ forward daily use |

Row expand → per member: exclusive use, drawn for each group, member closing, member days vs its
Target / Critical (colour: below Critical red, below Target amber).

Source label per month: `PLAN` (PO21 effective plan) or `FORECAST` (§4).

## 3. Block B — Arrivals / Future Orders

Existing inbound for every family member (P1), sorted by date:

| PO no. | Vendor | Member | Qty | Status | ETD | ETA Port | ETA Plant | Rescheduled ETA | Reason |
|---|---|---|---|---|---|---|---|---|---|

- Status: `AT GATE` / `IN TRANSIT` (shipped) / `ORDERED` (not shipped) / `BULK` / `STO` / `SUB-CSN`.
- ETD, ETA Port, ETA Plant come from the CSN (`etd`, `eta_at_port`, `eta_to_plant_calculated`).
- **Rescheduled ETA** editable only for `ORDERED` rows (in-transit cannot be moved) — §5.
- Block C (Location transfer) shows in P1 only each member's stock per R001 / R002; transfer
  instructions come in P2.
- Excel export of Blocks A + B.

## 4. Demand beyond the PO21 plan (owner answer §9-3) — proposal

PROD today: PO21 plans exist up to Jan-2027; history exists Jan-2024 (CMP003) / Apr-2024
(CMP005, CMP011) → Sep-2026 in `erp_history` (dispatch per SKU, production), ERP actuals from Oct.

For a month M with **no PO21 plan**, per SKU:
- **S** = same month last year's actual dispatch (avg of the years available)
- **T** = trend = last 3 complete months' actual dispatch ÷ the same 3 months a year earlier,
  capped 0.7 – 1.3
- **P3** = average of the last 3 months' effective PO21 plan
- **Forecast = ½ × (S × T) + ½ × P3**; if S is missing → average of P3 and last-3-months actual;
  if P3 is missing → S × T.
- Spread evenly over the month's days (same as PO21 plans). Shown as `FORECAST`; the user overrides
  by entering a PO21 ROLLING plan for that month.

## 5. Rescheduled ETA store (parent §4)

- New table `erp_planning.inbound_eta_reschedule` (company, source type CSN / PO line / STO / Sub-CSN,
  source id, material, original ETA, rescheduled ETA, reason, created_by / at). Append-only; latest
  row wins; "clear" = new row with no date.
- Save via one RPC with company-scope check; planning uses it everywhere (Requirement, Planning,
  Family page). CSN Tracker is not changed (owner).
- **New ACL resource** `PROC_MTS_INBOUND_RESCHEDULE` (WRITE) → `CAP_MTS_PLAN_FULL` only
  (SCM / Director / ACL-MASTER). A separate resource because it is a different action (bug
  pattern #6). Needs an ACL version bump in PROD at release (owner approval).

## 6. Build notes

- Reuses the existing engine (explosion, Method C, inbound loaders); horizon becomes a parameter
  (existing Requirement / Planning tabs keep CM + NM unchanged).
- Family = closure over material ↔ group membership within the company.
- Tests: family closure, forecast formula, rescheduled ETA override, no double count of pools.
- Migration (table + RPC + grants), route + ACL registry, `NOTIFY pgrst`, integrity check.

## 7. Please confirm

1. **Forecast formula (§4)** — the ½ / ½ weights and the 0.7 – 1.3 trend cap, or other weights?
2. **Max / Min days** — forward-walking use (more accurate when use changes month to month), or
   exactly the sheet's same-day rate?
3. **Where the page lives** — inside PO22 as a full-page view (no new menu code), OK?
4. **Rescheduled ETA rights** — SCM / Director / ACL-MASTER only, OK?

## 8. Owner answers (2026-10-20)

1. Forecast formula (§4): **OK** (½ / ½, trend cap 0.7 – 1.3).
2. Max / Min days: **forward-walking use** (yes).
3. Page: **inside PO22** (the full-page Planning view that already exists there). It is **not only a
   family page** — the user can pick **any individual item**. If the item belongs to a group, family
   rules apply (closure, prodshade prorata, Method C); if not (e.g. Pulmix 4033, RM-00075, no group)
   there is no family part, everything else is the same (day grid, arrivals, Future Orders,
   transfers, Max / Min days).
4. Reschedule: **the system never writes into CSN Tracker.** It shows the suggested / planned
   reschedule in the report; the user changes the CSN. The planning-side rescheduled ETA (§5) is
   kept as a planning value; who may enter it = PO22 full authority (SCM / Director / ACL-MASTER)
   unless the owner says otherwise.

## 9. Allocation trace (owner direction 2026-10-24)

The Item Plan must provide an **Allocation trace** panel for a selected family.  This is an
engine-result report, never a second calculation in the browser.  Every table is searchable and
copyable with headers for Excel.

1. **Material sources:** counted stock by eligible location and every inbound piece, with material,
   source/location or document, quantity, availability date and rule.  An `ORDERED` / not-shipped
   PO is visible as **risk only** and cannot be allocated; it becomes usable only after a real
   movement/ETA exists.
2. **Allocation flow:** one row for each engine draw: date, material, direct/exclusive use or
   receiving group, quantity, rule and member balance carried after that date.  The rule explains
   that own use is protected first; group draws take free stock after own-Target protection and
   narrower-group reserve; short-life FEFO can override normal saved sequence / Method C.
3. **Projection:** every engine lot shows material, group or own use covered, quantity, PO-by/ETA,
   Target + order-cycle/constraint reason and late/bridge flag.
4. **Residual:** each member's horizon-end balance explicitly states whether it carries into a
   later eligible demand or remains visible as excess/expiry-risk.  It must never silently vanish.

All labels are business labels (material code/name and group name); UUIDs are never rendered or
exported.  This trace describes the deterministic engine actually used by the displayed plan.  A
future change to the family allocation algorithm must change the engine trace at the same time and
add a regression test; changing only the UI explanation is forbidden.
