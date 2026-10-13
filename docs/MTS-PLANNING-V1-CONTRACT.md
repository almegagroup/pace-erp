# PACE ERP — MTS Production Planning v1 implementation contract

Status: design contract for implementation; **not yet a released planner**.

## Placement and source of truth

- Native PACE screen: Production > MTS Production Plan. Dynamic menu, page resource/ACL, company picker and plant scope must use existing PACE patterns; never create a parallel login or AI application.
- Each planning run has company_id, plant_id, month (YYYY-MM), scenario_id, revision, state (DRAFT, REVIEW, APPROVED), assumptions snapshot, created_by, created_at. No overwrite of approved scenarios; revisions are append-only.
- Plan lines: prodshade_id, sku_id (where applicable), production_date, planned_fg_mt, default_stroke_id, optional planning_override_stroke_id, source forecast and manual adjustment. Never replace master Stroke during planning.
- Verified actual process orders are read-only facts, not proxy customer demand.
- Forecast is explicitly separated into customer forecast, historical dispatch, market adjustment, confirmed orders, target FG and manual management change.

## Daily deterministic planning flow

1. Resolve company+plant+day production requirements and approved/date-effective planning stroke overrides; reject overlapping override windows.
2. Explode material requirements from the selected effective stroke/BOM at line granularity. Resolve actual material mapping and material-group substitutes explicitly; do not double count formulation and actual material.
3. Time-phase QA-released stock by company, plant, storage location, batch and stock type. Demand consumption from its eligible location, not pooled company stock.
4. Before purchasing, evaluate approved feeder transfers (e.g. R003 -> R001 for Sodium Gluconate), stock/reservation and transfer lead time. Propose source/destination, material, quantity, transfer-by and arrival-needed date. Never post transfer.
5. Net projected shortage after eligible transfers and firm incoming PO lots/CSN/in-transit records. Incoming promises carry separate statuses: planned, confirmed, dispatched and received.
6. Bulk RM has no CSN requirement. Generate arrival-day quantities from production demand, lead time, inbound capacity, stock and open orders.
7. Produce a dated procurement recommendation and exception list; recommendations never create POs, CSNs, GRNs or change stock.
8. Export management Excel with Plan-vs-Actual, Stroke Schedule, RM Requirement, PM Requirement, Projected Stock, Feeder Transfers, Bulk Arrival, PO/CSN, Exceptions, Assumptions and Revision Audit.

## Existing ERP contracts to reuse

- `erp_production.mts_current_stroke` for default active Stroke.
- `erp_production.stroke_master`, `stroke_line`, `process_order_line` for formulation and verified material usage.
- `erp_inventory.stock_snapshot` for inventory by storage location, batch and stock type.
- `erp_inventory.location_transfer_rule` + existing IN10/IN11 workflow for transfer eligibility/posting, but extend mapping at planning layer to material+effective date, do not change posting policy silently.
- `erp_procurement.purchase_order`, `purchase_order_line`, `purchase_order_lot`, CSN for firm inbound.
- Existing `PlanFeedPage` as a UX reference; existing ADMIX PO11 procurement planning remains separate.
- `frontend/src/shared/downloadColoredExcelFile.js` is a style baseline only, not a complete multi-sheet planning exporter.

## AI boundary

Deterministic server calculations own quantities, dates, stock netting and financial arithmetic. Haiku may explain exceptions, analyze scenarios and recommend management actions using pre-authorized, redacted context; its output is advisory and cannot post transactions.

## Pre-implementation gates

- Capture actual enum/status semantics for stock, process order verification, PO lots and CSN.
- Map company/plant/material identifiers and FG unit conversions from live schemas.
- Build DEV fixtures because DEV contains limited representative production and transfer history.
- Reconcile at least three sample planning periods against historical Google Sheets without importing ambiguous formulas verbatim.
- Add stable company-bound ACL resource and new page registration using migration/approval discipline.
