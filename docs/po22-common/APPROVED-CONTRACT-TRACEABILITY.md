# PO22 Contract-by-contract Traceability Matrix
Status: REVIEWED against `main:docs/mts-planning/PO22-PHASE-2D-FINAL-OPTIMIZER-AND-STORE-CONTRACT.md` (217 lines, 13 sections). This matrix is not a replacement for the original complete approved contract.

## Requirement completeness rule
**The entire approved Phase 2D contract sections 1–13 remain normative.** A short summary that does not repeat a detail does not supersede it. Any conflict must carry the earlier and later source, business owner approval and resolution before it can be marked final.

| Source | Approved obligation preserved | Additional precise reference |
|---|---|---|
| §1, lines 9–19 | Existing CM/NM, Target/Critical, NM Req Days and `buildRequirementRows()` unchanged; physical vs future vs R→R advisory distinctly separated; no PO/stock writes | Source contract is authoritative |
| §2, lines 21–30 | User-triggered company run; Store report remaining CM + NM, generally shared fortnightly; no mandatory report approval, acknowledgement, revision chain, deviation enforcement, or automatic rerun | Future planning non-executable |
| §3, lines 32–45 | Exact source-line grain; each line/day either fixed or group, not both; Use Primary No/Yes semantics, PM separate; six-month user selection gates only **new buy**; dated conservation; exclusive protection; Critical vs Target distinct | Member consumption eligibility not determined by new-buy selection |
| §4, lines 47–55 | Eligible unrestricted posted R+S pooled stock; specific stock-location rules; CMP003 OT01/OT02 always excluded; eligible R003 included; no QA/blocked or unposted; reservation double-deduction prohibited | R→S ledger postings don't change company total |
| §5, lines 57–65 | **Only optional R→R advisory**, R003→R001 example, no R→S/S→S/S→R recommendation, no fabricated destination/time, zero stock created | No transfer posting |
| §6, lines 67–98 | Dense product-first Store instruction; exact header, source-line/period/material/executable/future/uncovered/evidence fields; product×group×material, material and group reconciliation; R→R separately; no cards/side panels | Historic snapshots, exports, no second reservation system |
| §7, lines 99–109 | CM+NM forecast; longer scenario only to assess lot residual; PO/CSN/GE/lot/GRN partition and partial receipts; order-month new-buy selection; MOQ versus order multiple; 50MT/25+25 dated deliveries; carry-forward unused stock; PO-by and requested/actual dispatch distinct; total vendor lead time not double-added | Unknown/overdue ETA not date-certain |
| §8, lines 111–131 | AC01 landed cost is components, DRAFT provisional/POSTED final; existing PO payment term authoritative, vendor default for new; LC/FX/taxes/funding assumptions unknown unless verified; AI advisory only and numeric rerun controlled by planner; server budget cap | Historical PROD samples are dated spot evidence, not universal |
| §9, lines 133–145 | Proposed Store projection, R→R advisory, snapshot/report/export API additions are design proposals not deployed; no unauthorized posting linkage | Branch code does not imply release |
| §10, lines 147–170 | **All 22 numbered numeric/integrity acceptance tests remain mandatory**, not only a handful of examples | See original section for exact 22 test cases |
| §11, lines 172–186 | All 11 concrete technical evidence checks remain OPEN until supported by joins, tests and source proof | Missing evidence -> NOT_SOURCE_READY |
| §12, lines 188–204 | Chronological gates 0, 3A–3F, gate 1 and authorization boundaries | Agent branch implementation != operational acceptance |
| §13, lines 206–217 | Phase 2B→2D decisions and their interpretations remain active | No regression by summary |

## Latest owner-specific clarification — supersedes illustrative cross-company pooling
- Independent plans per company CMP003, CMP005, CMP011. No automatic stock/demand, cost, MOQ, import-lot, allocation or new-buy mixing across companies.
- **Only a user-initiated item-specific Sub-CSN with stated quantity/receiving company** can be used as cross-company movement evidence. Never autonomously generate a transfer or cross-company redistribution.
- Direct PO-line CSN and STO/Sub-CSN are separate source families; posted receipt not incoming; company destination is based on verified lifecycle, never guessed.
- If original general cross-company scenarios appear to grant broader automatic movement rights, this explicit later owner clarification takes precedence.

## Decision conflict queue — do not collapse
| Topic | Conflicting/underspecified evidence | Resolution needed |
|---|---|---|
| R003 / other R/S locations | Older planning exclusion shorthand R003/L003/S003/P003/T003 vs owner-approved Phase 2D §4 R003 counted and R003→R001 advisory | Preserve Phase 2D operative R003 rule for Store/stock optimizer unless owner validates use-case-specific exclusion; inspect effective per-company SLoc policy |
| Daily dates | Monthly PO21 plan and 13/15-day production variation vs exact calendar daily planner | Forecast phasing must be labeled forecast, not a confirmed production schedule; prove approved phasing source |
| Google Sheet scheduling | Literal equality `MAX DAYS = Target+1` after latest ETA may skip dates; modern optimizer needs robust trigger | Preserve literal baseline for comparison but label improvements as proposal requiring business acceptance |
| 'Min Stock' label | Sheet top F2 retrieves Requirement Target Coverage DAYS, not KG or blanket 15-day safety | Do not mislabel/infer physical safety stock |
| Max Days fixed protection | 30 minimum / 50 maximum was a hypothetical VAE scenario | Company/material effective policies authoritative, max not automatically mandatory reserve |
| Cross-company physical movements | Other ERP PO/CRCMP receiving patterns exist independently of user-sub-CSN optimizer permission | Do not treat another company's PO owner as permission for optimizer-created cross-company allocation |

## Remaining specification verification scope
Confirm the entire repository documentation inventory (not just known paths), latest commits and owner decisions, exact PO21/Stroke/Pack BOM joins, UI/report fields, supplier route contracts, and sheet numeric parity. Missing source evidence is not invented.
