# PO22 Business Requirements and Decisions — Master Index (Consolidation In Progress)

> **IMPORTANT — THIS FILE IS AN INDEX, NOT THE WHOLE SPECIFICATION.** For complete governing decisions, read the entire [approved Phase 2D contract](../mts-planning/PO22-PHASE-2D-FINAL-OPTIMIZER-AND-STORE-CONTRACT.md), [13-section contract traceability](APPROVED-CONTRACT-TRACEABILITY.md), [28-item requirement/acceptance matrix](REQUIREMENT-ACCEPTANCE-MATRIX.md), [formula-level historic spreadsheet reference](GOOGLE-SHEET-FORMULA-REFERENCE.md), and [implementation snapshot](PROGRESS-SNAPSHOT.md). Read these together; do not implement from the summary alone. The original Phase 2D contract's 22 acceptance tests remain normative. Later explicit owner decisions on independent company planning and user-created Sub-CSN supersede inconsistent illustrative cross-company examples.\n\n
**Status: PARTIAL RECORD; source-contract and business-owner reconciliation pending.**
This is a snapshot of established conversation decisions and repo-contract pointers, not a completed or newly approved design. Preserve `buildRequirementRows()`, existing CM/NM and NM Requirement Days calculations, and PO21 effective plan precedence.

## Objective
Turn company-specific effective PO21 production plans into auditable, material-level procurement and Store planning: ensure no production stoppage, respect inventory/coverage/quality restrictions, reduce early inventory/working capital, then minimize total relevant landed and incremental costs. AI explains and compares; deterministic logic verifies quantities, constraints and recommendations. No automatic operational PO/stock action.

## STRICT company isolation — confirmed business decision
- Plan CMP003, CMP005, CMP011 **independently**, including stock, fixed/group requirements, reservations, current/incoming stock, MOQ, purchase quantity, vendor choice and cash exposure.
- **Never pool demand or stock between companies** and never automatically combine import MOQ across companies.
- Cross-company movement is recognized **only when the user explicitly creates an item-specific Sub-CSN with quantity and destination company**. Count only verified lifecycle evidence; prevent source/destination, mother/sub-CSN and GRN-posted double counting. No optimizer-created Sub-CSN or autonomous cross-company allocation.
- Owner's explicit Sub-CSN rule supersedes any previous illustrative example of distributing one 25MT import 12/8/5MT across three companies.

## Demand provenance / production
- PO21 effective plan version/entry/line -> SKU -> ProdShade -> effective Stroke Master and immutable Stroke Line / Pack BOM INPUT Line IDs -> demand.
- Respect existing FINAL/ROLLING/ADDITIONAL/URGENT precedence, stroke effective timing and approved primary settings.
- Fixed/exclusive material demand remains material-specific.
- `Use Primary = No` group demand remains **material-null GROUP_POOL** until verified allocation; no fabricated primary.
- All active group members must match the actual formulation group, carry immutable membership-row IDs, correct UOM/conversion evidence and valid eligible time window.
- Alternative groups may overlap and share materials, including a material also used in a fixed formulation; allocate shared physical stock once, not once per group. Material-null residual shortage must remain visible.
- Production daily dates must be evidence-backed; if only monthly/fortnightly timing is known, preserve uncertainty and explicitly document planning assumptions.

## Stock & lifecycle
- Physical executable stock = company-scoped, posted eligible stock in permitted locations, net of eligible reservations, with verified UOM and as-of cutoff.
- CMP003 OT01/OT02 explicitly excluded for relevant source policy; other restricted/non-plant locations use configured company/location rules (do not infer purely from a location name).
- Invalid/missing reservation UOM or source identity must fail closed, not count reservation as zero.
- CSN/in-transit, open PO remainder, unposted gate arrival are **future projections**, NEVER immediately executable Store stock. GRN-posted receipts are posted-stock evidence, not remaining inbound.
- Preserve direct PO-line CSN vs STO/Sub-CSN as distinct lifecycle sources. The only authorized cross-company allocation is explicit user-created Sub-CSN evidence.

## Policy, coverage & forecasting
- Material-level Target and Critical coverage policy; missing either -> `UNKNOWN_POLICY`, not default 0 or `NO_BUY`.
- Existing CM/NM requirement contract: NM Req Days = min(NM calendar days, max(0, Target Days - CM Days Left)); do not change without explicit owner review.
- Daily planning includes opening, plant ETA, tentative planned receipt, prorated consumption, closing, Max Days, Min Stock, Min Days and right-side future consignment projection.
- Original Planning Sheet `REQUIREMENT`/ `PLANNING`/ right-side `R:W` is a behavioral reference, not a source of unexamined brittle assumptions. Arrival planning is coverage-driven, not simply first negative-stock day.
- Manual overrides and month-specific stock valid-till/projection exceptions are owner-controlled, traceable and never silently rewrite baseline data.

## Economic scenario solver
- Protect fixed requirements and mandatory coverage before considering reallocating shared VAE/RDP stock to interchangeable groups.
- Where allocation is not user-confirmed, produce **recommended**, not operationally confirmed, material/group scenario(s). Compare local vs imported eligible members across production dates and constraints.
- Minimum and maximum coverage are distinct: min protection vs upper planning level, not automatically locking max inventory as mandatory.
- MOQ and order multiple are independent constraints, per company and supplier/route. Compare minimum lot overstock and arrival delay versus alternatives.
- Landed price: purchase price/currency + verified FX assumption, freight, duties, clearing, port/inland and nonrecoverable charges. Distinguish recoverable tax.
- Holding/financing cost: capital cost × amount × holding duration; LC and payment terms, credit terms and cash timing; compare **incremental** decision cost, not double-charge already-owned stock.
- Rank feasibility: production continuity and hard rules, coverage, financing/early arrival, then landed incremental economics. Report uncertainty where source cost is missing.
- Plan PO-by date, supplier-specific processing and transit, import ETD/port ETA/plant ETA or domestic dispatch ETA using actual route and service reliability evidence.
- Optimizer recommendation never self-creates a PO, movement or Store posting; Store executable instructions use posted eligible stock only.

## Scenarios required for acceptance
- VAE used in exclusive and multiple RDP groups; date-wise protection of fixed VAE, 30-day minimum and 50-day upper coverage **as example policy only**, optimal surplus allocation and local/import alternatives.
- RP-4099 vs VAE DA 1100 (do not substitute illustrative stock/cost/ETA for verified PROD facts).
- Cross-company strict isolation: CMP003, CMP005, CMP011 each independently optimize; only owner-created item-specific Sub-CSN changes intended destination evidence.
- Conflicting/missing group member identity, `Use Primary = No`, UOM mismatch, reservations, OT01/OT02, mixed group demand without double counting.
- Missing Target/Critical, no ETA, partial/posting GRN, mother/sub-CSN, missing vendor quote/FX/payment/LC/lead time, MOQ/multiple, supplier delay.
- Reconcile numerical daily planning and right-side prediction with representative original spreadsheet cases.
- AI must be explainable, controlled for cost, deterministic-verifiable and unable to author operational transactions.

## Open, not silently final
Exact field-level joins and schema validity, as-of inventory reconciliation, source-line demand lineage to effective PO21 line/version, Use Primary date semantics, economic source coverage/route costs, UI approval model and fully verified spreadsheet numerical parity require audit and owner sign-off. Record each with evidence in progress register rather than implying completion.

## Verified detail inventory — not optional
The following business rules were present in the approved Phase 2D contract but abbreviated or absent in the initial consolidation, and are now explicitly linked to their binding source:
- **§2:** CM remainder + complete NM, user-triggered typically fortnightly Store sharing, no mandatory approval/acknowledgement/deviation enforcement/revision chain; changes reflected on a new run only.
- **§3:** Six-month per-company/per-material monthly manual selection affects *tentative new purchases only*. Deselected material may still consume eligible on-hand and precommitted inbound; RM Use Primary Yes vs No, PM alternative group eligibility distinct; source-line demand never duplicated.
- **§4:** unrestricted posted R+S stock pooled across permitted company SLocs; include eligible R003 and distinguish it from CMP003 OT01/OT02 hard exclusions; prevent subtracting already-consumed reservation twice.
- **§5:** optional physically-backed **R→R advice only**, with destination evidence and possible UNKNOWN; no R→S, S→R or S→S recommendations and no movement posting.
- **§6:** product-first, dense, printable/exportable Store instructions plus group/material summaries, exact source-line identity, physical executable vs future vs uncovered; all summaries reconcile.
- **§7:** group/lot/GRN partial-receipt dedupe, distinct supplier MOQ and order multiple, dated split lots, residual actual stock available next run, requested vs actual dispatch vs ETA vs PO-by, no invented total lead time.
- **§8:** AC01 DRAFT provisional/POSTED final evidence, existing PO payment term authority, vendor default for future, cost component/tax/FX uncertainty, AI budget cap and numeric authority isolation.
- **§10:** all 22 owner-approved tests; **§11:** all 11 source-verification obligations; **§12:** phase/release approval gates.
- **Owner clarification:** planning company isolation is strict. The optimizer never initiates or proposes autonomous cross-company allocation; only explicit user-created item-specific Sub-CSN can change destination evidence.

## Status: no unsupported 100% claim
This document now points to substantially fuller traceable material, but the whole prior conversation/repo/document corpus has not been exhaustively enumerated and verified. Source-level gaps and conflicting evidence are OPEN in the matrix. Never equate 'documented' with 'implemented', 'tested', 'UAT accepted' or 'deployed'.
