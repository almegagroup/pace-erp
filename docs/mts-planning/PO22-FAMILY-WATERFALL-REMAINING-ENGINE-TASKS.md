# PO22 Family Waterfall — remaining engine tasks

**Owner decisions reconfirmed 2026-10-24.**  This list corrects the earlier
phase status: prior work established the family input, group policy and an
explainability baseline, but it did not yet implement the following engine
contracts completely.

## Locked inputs

1. A material's Desired Max is `Target + calculated order cycle` unless the
   user saves an effective-dated **Desired Max Days** override in Requirement.
   The override carries forward, must not be below Target, and is used by both
   individual protection and derived group Desired Max.
2. Selection controls newly suggested buys only.  Existing eligible stock and
   confirmed ERP receipts remain consumable even when their material is not
   selected in a future month.
3. A valid ETA within the horizon joins the waterfall exactly on that date. A
   valid ETA after the horizon is visible as *After horizon* evidence but adds
   no current-horizon cover. Missing/stale ETA is risk-only.
4. Allocation must be a conserved source-to-destination ledger: direct reserve,
   smallest-member-count groups first, skip covered groups, then a second
   rotation of genuine usable excess.  Every residual quantity has a reason.
5. Critical is an action threshold, not a reason to suppress a feasible plan:
   bridge lot, transfer, expedite/faster vendor, alternative, emergency, then
   exact stock-out warning when no option remains.

## Implementation order

| ID | Work | Acceptance evidence |
|---|---|---|
| W1 | Effective-dated material Desired Max override: migration, save/history/list API, Requirement grid, planner handoff. | Blank derives from Target+cycle; override carries by date and changes family protection; Target guard rejects a lower override. |
| W2 | Horizon classification for confirmed ERP receipts. | In-horizon receipt joins only on ETA; after-horizon receipt is visible but cannot cover/bypass buy; no ETA is risk-only. |
| W3 | Canonical reservation ledger and two-pass waterfall. | Source=allocation+residual; direct reserve, small-group-first, covered-skip and second rotation tests. |
| W4 | Projection and Store advice consume W3 results, with bridge reallocation on future receipt. | RP20/group30, unselected run-down and future inbound bridge regressions. |
| W5 | Group-scoped Critical action chain and labelled report/export API. | A group deficit exposes ordered actions and no UUID leaks to UI/Excel. |
| W6 | Regression matrix and implementation-log evidence. | Standalone PO22 behavior remains unchanged; full suite green. |

## Deferred by owner

- The final CC-calibrated **family-only** Prediction table visual layout.
- The final visual grouping/layout of the allocation report.
- Physical Store issue/ledger confirmation.

