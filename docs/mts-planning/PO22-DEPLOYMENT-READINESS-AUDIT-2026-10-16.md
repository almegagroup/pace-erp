# PO22 Requirement — Deployment Readiness Audit

**Date:** 2026-10-16
**Status:** SUPERSEDED AS A RECOVERY FINDING — the initial repository search used a stale
`origin/agent/claude` ref. After an explicit fetch, Claude's PO22 commit
`ec8758bfefe6adbab0bb1c8eacd6c3d2de2373c0` was recovered and integrated on `agent/codex`.
**Scope:** preserve the initial search evidence and direct legacy-formula reconciliation. No
production data, schema, ACL, or application change was made by this audit itself.

## Repository evidence

The following finding was accurate only for the stale local remote-tracking refs available before
the explicit fetch; it is not a current implementation-status claim:

- a `20261016100000*` migration;
- `docs/mts-planning/acl/MTS-REQUIREMENT-ACL-PROVISIONING.sql`;
- `PO22-REQUIREMENT-CALCULATION-CONTRACT.md`,
  `PO22-REQUIREMENT-SOURCE-FIELD-MAPPING.md`, and
  `PO22-LEGACY-RECONCILIATION-REPORT.md`;
- a PO22 route, handler, frontend page, test, or menu registration.

All registered Claude worktrees were inspected read-only. Their uncommitted work is unrelated
(migration guard scripts, HR documentation, and an operation-management source document), and
was left untouched. Reachable refs and dangling commit objects were also searched without finding
a PO22 implementation. The subsequent explicit fetch recovered the published implementation; this
document must be read together with the current PO22 calculation contract and reconciliation report.

## Legacy workbook reconciliation matrix

The formulas below were read directly from row 3 of the `REQUIREMENT` tabs on 2026-10-16. `ERP
Formula` deliberately remains **not implemented / not verified**; no formula has been substituted
without the missing PO22 source and test suite.

| Legacy field | Legacy formula | ERP formula | Source | Company differences | Expected variance | Test result |
|---|---|---|---|---|---|---|
| Critical Cov | `ROUNDUP(Target Cov / 2, 0)` | Not implemented | `REQUIREMENT!D3` | None observed | Must remain independently editable in ERP policy | Verified in all 3 workbooks |
| CM Days Left | `DAY(EOMONTH(current month,0))-DAY(TODAY())+1` | Not implemented | `REQUIREMENT!Z3` | None observed | ERP needs an explicit as-of date, not only browser/server today | Verified in all 3 |
| Current Month Prorata | Current requirement divided by days left when `MOQ Active=1`; otherwise divided by next-month calendar days | Not implemented | `REQUIREMENT!I3` | None observed | Legacy active flag alters demand-rate semantics; requires explicit policy contract | Verified in all 3 |
| Next Month Prorata | `ROUNDUP(next-month requirement / days in next month, 2)` | Not implemented | `REQUIREMENT!K3` | None observed | Preserve precision and base-UOM conversion rules | Verified in all 3 |
| NM Req Days | Full next-month days only after day 15 | Not implemented | `REQUIREMENT!AA3` | **CMP003 SURFACE** | Different from target-coverage logic in CMP005/CMP011; owner/business decision required | Verified in CMP003 |
| NM Req Days | `MAX(Target Cov - CM Days Left, 0)` | Not implemented | `REQUIREMENT!AA3` | **CMP005 ACPL, CMP011 JAYASHREE** | Cannot be silently harmonised with CMP003 | Verified in CMP005/CMP011 |
| Current Balance | `(Current Req + Current Cons.) - Current Stock` | Not implemented | `REQUIREMENT!N3` | CMP003/CMP011 | Negative balance feeds next-month status | Verified in CMP003/CMP011 |
| Current Balance | `IF(Current Req<=0,0,Current Req-Current Stock)` | Not implemented | `REQUIREMENT!N3` | CMP005 | Consumption is not added in this variant | Verified in CMP005 |
| In-transit CM/NM | Sum movement quantity for status `2`, grouped by ETA date into current/next month | Not implemented | `REQUIREMENT!P3:Q3` | None observed | ERP must use explicit, verified open-supply status and cap receipt quantity to PO-side open balance | Verified in all 3 |
| Current/Next cover | Current stock plus selected incoming divided by demand-rate; rounded down | Not implemented | `REQUIREMENT!E3:F3:R3` | CMP003 includes both CM/NM inbound in next cover; CMP005/CMP011 only CM inbound in `F` | Location/status/reservations must be explicit, not sheet-wide total stock | Verified |
| Below Target / Critical | Compare coverage to Target / Critical; incoming variants use next cover | Not implemented | `REQUIREMENT!S3:V3` | None observed | Exact boundary is `<=`; no alert where current req is non-positive | Verified in all 3 |
| Identifier | Encodes below-target, below-critical and ID2 combinations as 0–3 | Not implemented | `REQUIREMENT!X3` | CMP003 also gates on `MOQ Active` | ERP should expose named states alongside any compact code | Verified |
| AVG. LEAD TIME | `MAXIFS(CONSOILI_MVT!R:R, material)+4` | Not implemented | `REQUIREMENT!AF3` | None observed | This is an observed maximum plus four days, not an average; retain as a labelled legacy comparator only | Verified in all 3 |
| Safety Day Stock | `Total Prorata * Target Cov` | Not implemented | `REQUIREMENT!AG3` | None observed | Use configured effective planning lead-time/policy only after source contract | Verified in all 3 |
| Lead Time Stock | `AVG. LEAD TIME * Total Prorata` | Not implemented | `REQUIREMENT!AH3` | None observed | Do not convert unknown lead time to zero | Verified in all 3 |
| Total Stock | `Safety Day Stock + Lead Time Stock` | Not implemented | `REQUIREMENT!AI3` | None observed | Label as target planning stock, not physical inventory | Verified in all 3 |
| ID2 | Set when Total Stock is at least Current Stock | Not implemented | `REQUIREMENT!AJ3` | None observed | Requires the same eligible-stock definition as coverage | Verified in all 3 |

## Required ERP corrections once source is recovered

1. Make selected `as_of_date`, company, material, material base UOM, required consumption
   location, inventory status, reservations and in-transit status first-class inputs.
2. Keep stock at non-required locations visible separately; do not include it in usable stock until
   a posted or explicitly proposed feasible transfer is represented.
3. Use source-derived RM Stroke-line and PM Pack-BOM-line storage locations. Do not impose
   R001/P001/S001 or treat R003/L003/S003/P003/T003 as automatically usable.
4. Persist policy version/audit data for Target Coverage, independently editable Critical Coverage,
   MOQ value/UOM/source/no-fixed-MOQ, active flag, effective date and remarks. Ambiguous legacy
   MOQ source must remain unresolved rather than guessed.
5. Show configured, historical-average, historical-maximum and effective planning lead time as
   distinct fields. The legacy `MAXIFS + 4` result must not be labelled as an average.
6. Reject or surface an explicit exception for unresolved litre-to-KG conversions and missing Pack
   BOM only when the selected company has applicable production demand.
7. If PO21 lacks producing-company allocation, show a data-gap warning and do not attribute
   requirement to a company by inference.

## Deployment decision

The recovery conclusion above is superseded. PO22 has been recovered into `agent/codex`; its
separate migration and ACL provisioning remain deliberately unapplied and require owner approval.
