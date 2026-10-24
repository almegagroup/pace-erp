# PO22 Family Waterfall — implementation contract

**Owner direction:** 2026-10-24.  This is the implementation order for the
approved family-planning design.  It replaces neither the single-material PO22
planner nor its CC-calibrated daily Prediction grid.  That family-only display
redesign is deliberately last, after calculation evidence is proven.

## Non-negotiable rules

1. No company, material, vendor, group, location, quantity, or date may be
   hard-coded.  CMP003/RDP is a regression fixture, never a code path.
2. Only explicitly eligible MTS storage locations are supply.  OT is excluded.
3. A quantity is conserved: every unit is allocated once, remains unallocated
   with an explicit reason, or is unavailable/expired.  It may never be counted
   twice by two groups.
4. Direct/exclusive obligations are protected before shared allocation.  They
   are protected to their effective Desired Max, not merely their Target.
5. Target is the safety trigger; Critical is a risk/action threshold, never a
   reason to hide a feasible plan.  A missing valid inbound must show risk, not
   fictional cover.
6. An inbound becomes usable only on its actual valid ETA.  Posted GR on the
   CC date is a same-day `Actual GR` event.  Ordered/not-shipped supply with a
   valid ETA participates on that date; no ETA is risk evidence only.
7. Selection controls new purchase only.  It never removes existing stock or a
   confirmed valid inbound from possible consumption.
8. Receipt choice is: hard exclusive protection, FEFO, saved sequence,
   no-replenishment run-down priority, then commercial tie-break.  Planning
   creates Store advice; it does not claim physical issue confirmation.
9. User-facing output and Excel must contain business labels only—never UUIDs.
10. Every task adds deterministic regression tests before it changes a visible
    calculation.  Existing non-family PO22 behavior remains covered.

## Final policy model

- Individual Target/Critical remains the individual safety rule.  Individual
  Desired Max is `Target + calculated order cycle`, unless a dated user override
  applies.
- Group Target/Critical is separately effective-dated.  Absent group Target is
  30 days.  Group Desired Max defaults to the arithmetic average of member
  Desired Max values, rounded upward to the smallest existing member Desired
  Max that is at least that average; it too can have a dated override.
- A member's individual Target still triggers its own buy (for example RP-4099
  at 20 days).  The group can remain at 30 through other eligible members; the
  group rule never delays the member's own safe projection.

## Dependency-ordered tasks

| ID | Deliverable | Depends on | Acceptance evidence |
|---|---|---|---|
| F0 | Freeze the input/output contracts and replace the experimental trace contract with the final terminology.  Add fixtures and invariants for every rule below. | — | Contract test matrix covers each rule; no UI behavior changes. |
| F1 | Add effective-dated group Target, Critical, Desired-Max override and group policy API.  Add PO22 Group Policy UI for RM and PM groups, with month carry-forward and a derived-Max preview. | F0 | History is append-only; month effective values and 30-day default test green; ACL/company scope tested. |
| F2 | Build one canonical family input assembler: family closure; approved MTS SLOC stock only; dated opening/GRN receipts; PO21 Mother/Child demand; monthly selection; valid arrivals and no-ETA risks. | F0 | CMP003 fixture proves OT exclusion, CC-date GR, ordered ETA inclusion, no-ETA exclusion from cover and source reconciliation. |
| F3 | Replace current Method-C family allocation with the event-time waterfall simulator: exclusive/direct reserve, small-group-first waterfall, no duplicate allocation, skip already-covered group, and second rotation for true physical excess. | F1, F2 | Quantity conservation and group-path tests; actual/future stock enters on the exact date only. |
| F4 | Add the allocation-aware consumption planner: FEFO/120-day virtual life, saved sequence, no-replenishment run-down, bridge-until-known-inbound, and period-level Store advice with Mother/Child labels. | F3 | Expiring stock wins locally; Vinnapass-like unselected stock is consumed when eligible; bridge stops/recalculates on RP-like ETA. |
| F5 | Make projections consume the simulator's residual risk: individual/group Target guards, Critical action messages, MOQ/multiple/order cycle/vendor/INR cost, with one valid future lot considered in the same waterfall after ETA. | F3, F4 | RP20/group30 conflict, Target re-trigger, MOQ and late/no-ETA tests; no false purchase for unchecked item. |
| F6 | Publish final explainability APIs/reports: allocation rows, unallocated/risk reasons, projection reasons, Store period plan, and Excel-safe business labels.  Retire/replace the experimental Allocation Trace if it no longer represents this contract. | F4, F5 | Every qty has source → destination → rule; totals reconcile; no UUID in API-facing labels/Excel. |
| F7 | Integrate the final engine behind PO22 family mode while leaving ordinary Item Plan/Requirement/CC-calibrated Prediction behavior unchanged. | F6 | Family and standalone regression suites both pass; current non-family tables unchanged. |
| F8 | Redesign only the **family** CC-calibrated Prediction table into the approved waterfall presentation after F7 UAT. | F7 | View is presentation-only over F7 data; no calculation is duplicated in React. |

## Completeness check

This plan explicitly includes all agreed decisions: group policy/default/override;
individual-vs-group conflict; OT exclusion; direct protection; first and second
waterfall; valid dated inbound; no-ETA risk; selection semantics; future-lot
bridge; FEFO and virtual shelf-life; saved sequence and unselected-item run-down;
MOQ/cycle/projection/cost; Critical action; PO21 Mother/Child Store advice;
human-readable audit trail; and the deferred CC-calibrated family table.

Items deliberately outside this phase: a physical Store issue ledger, changing
the existing single-item Prediction table, and unapproved alterations to PO21
demand rules.

## Implementation evidence

### F0 — complete on `agent/codex` (`43d3daf9`)

The dependency order, non-negotiable rules, deferred UI boundary and acceptance
matrix were committed before code changes.

### F1 — code complete on `agent/codex`, pending migration application / release

- Added append-only, effective-dated group coverage policy migration:
  `20261024100000_po22_family_group_coverage_policy.sql`.
- Added company-scoped GET/POST API routes using the existing distinct
  Requirement view and policy-write ACL resources.
- Extended PO22 Group Settings with Target/Critical, effective date, derived
  Desired Max preview and explicit Desired Max override.  The preview consumes
  Planning's individual calculated Max values; it does not invent a UI cycle.
  Each group now also displays the policy in force and every separately
  scheduled future effective-date policy, so a user can verify carry-forward
  before the month begins.
- Deterministic policy tests pass (3/3), existing family planner tests pass
  (12/12), backend checks pass, focused frontend lint and production build pass.

### F2 — code complete on `agent/codex`, pending release

- Family input now admits every physical/order receipt only on a valid plant ETA
  on or after the CC date.  This includes an ordered PO remainder when the PO
  delivery date or CSN ETA is available; a missing/stale ETA is carried as a
  visible risk, never fictional same-day stock.
- Posted GR on the CC date remains a same-day arrival.  Existing Requirement
  assembly remains the single source of eligible MTS-location opening stock,
  dated GRN/opening receipt advice, PO21 Mother/Child-derived demand and
  monthly new-buy selection.
- Regression tests cover CC-date GR, dated ordered PO, stale/missing ETA and
  the guarantee that a missing ETA cannot inflate the CC-date balance.

### F3 — code complete on `agent/codex`, pending release

- The live planner now reads the effective-dated Group Coverage Policy into the
  family engine for every planning day.  Missing group policy evaluates to the
  approved 30-day Target default.
- Direct/exclusive use is reserved through the member's Desired Max before any
  shared group draw.  A shared group cannot borrow that reserve and therefore
  cannot double-count an exclusive member's safety stock.
- Pools stay deterministic smallest-member-set first.  Group projection is
  triggered at the group Target, sized to the derived/overridden Group Desired
  Max.  An individual guard remains independent: an RP-4099-like member still
  triggers at its own 20-day target even when its group Target is 30.
- Regression tests prove exclusive reserve conservation and the 20-day item /
  30-day group coexistence.  The later F6 trace will expose each resulting
  allocation path and residual quantity to the UI.

### F4 — code complete on `agent/codex`, pending release

- Existing planning-only shelf-life advice remains FEFO using recorded expiry
  or the approved 120-day opening/GRN convention; it remains advisory, not an
  issue ledger.
- After hard direct protection, FEFO and a saved group sequence, a selected-out
  member's still-eligible stock is explicitly run down before a member that can
  still receive an authorised future buy.  Selection never hides stock.
- The existing period-level Store output continues to derive its split from the
  simulated family mix and carries `Period, material/group, planned quantity,
  Mother Group, Child Group` labels.  Its physical receipt source remains
  attached only where current stock can back the advice.

### F5 — code complete on `agent/codex`, pending release

- Existing engine constraints remain one shared calculation: individual Target
  triggers a projected buy, sizing follows Desired Max / cycle and MOQ,
  multiple, vendor lead time and INR landed-cost evidence remain applied.
- Group Target triggers are now policy-driven, while individual material
  triggers remain independent.  Therefore a 20-day RP-4099 guard is never
  delayed by a 30-day group guard.
- Critical/stockout dates continue to flow to the Action list for an order,
  ETA correction, lead-time/data repair, or an explicit risk.  The UI wording
  now correctly states that an invalid ETA is risk-only, rather than claiming
  it was assumed into today's stock.

### F6 — code complete on `agent/codex`, pending release

- The prior experimental “Allocation trace” has been renamed **Family
  allocation report** and its wording now matches the approved waterfall:
  direct Desired-Max reserve, small-group protection, FEFO, saved sequence and
  run-down priority.
- The simulator now publishes each direct and group draw as a server-owned
  allocation row.  The Item Plan only sorts/displays those resolved rows; it
  no longer reconstructs an allocation in React from closing balances.  The
  Store period plan now includes the explicit **Planned consumption reason**
  required by the agreed report fields.
- Its source report distinguishes dated inbound (including ordered PO with a
  valid ETA) from a no-ETA risk.  Group destinations and future-order covers
  are server-resolved business labels; the browser never receives an internal
  group UUID as a display label.
- All grids retain the shared copy-with-headers behavior, so the same labelled
  report can be pasted into Excel.  The daily Prediction-table visual redesign
  remains F8, deliberately separate from calculation.

### F7 — code complete on `agent/codex`, pending release

- The final Family input is scoped again when a user opens a member Item Plan:
  the closure includes only that member, connected family groups, their members
  and their matching valid arrivals/risks.  An unrelated family's ETA risk can
  no longer leak into this view.
- Standalone materials continue through the same deterministic planner with no
  group pool; grouped policy logic has no effect on their existing CC-calibrated
  Prediction behavior.  The Tot White standalone regressions remain green.

### F8 — intentionally deferred after UAT

The owner explicitly confirmed that the family CC-calibrated daily Prediction
table is presentation work after the engine is proven.  It is not included in
this implementation release and must read the F7 server output rather than
recalculate in React.

