# PO22 Requirement — Source / Field / Formula Mapping

Date: 2026-10-16 · Author: Claude Code · Updated by Codex after direct legacy-sheet inspection · Status: **legacy formulas inspected; ERP variances explicit**.

## Legacy-source inspection (read first)

On 2026-10-16 the live `REQUIREMENT` formulas were read directly for CMP003 SURFACE,
CMP005 ACPL and CMP011 JAYASHREE. The ERP source remains the verified schema/code; the
legacy tab is a functional reference, not a formula-copy target. Each intentional ERP variance is
identified below so no legacy substitution is silent.

## Legacy field → ERP field

| # | Legacy field | ERP column (Tab 1) | Status | ERP source / rule |
|---|---|---|---|---|
| 1 | ITEMS | Material (ITEMS) + Material Code | ERP DEFINITION | individual RM/PM `material_master` (name + pace_code); one row per material, never per group |
| 2 | TYPE | TYPE | ERP DEFINITION | `material_master.material_type` (RM / PM) |
| 3 | Target Cov | Target Cov | VERIFIED (brief) — per material | Tab 2 policy, effective on as-of date |
| 4 | Critical Cov | Critical Cov | VERIFIED (brief) — default ROUNDUP(Target/2), independently editable | Tab 2 policy |
| 5 | CURRENT STK DAYS | CURRENT STK DAYS | ERP DEFINITION | date-wise cover of usable stock vs daily demand |
| 6 | Next Month Cov | Next Month Cov | ERP DEFINITION | NM opening ÷ NM daily rate |
| 7 | Current Cov | Current Cov | ERP DEFINITION — distinction from #5 not visible in legacy | stock + dated CM inbound, date-wise |
| 8 | Current Req | Current Req (CURRENT MONTH REQ) | ERP DEFINITION | whole-CM demand from PO21 × Stroke / Pack BOM |
| 9 | Current Prorata | Current Prorata (CM PRORATA) | VERIFIED intent (EOMONTH/TODAY) → as-of based | demand `D`..CM end |
| 10 | Req NM | Req NM | ERP DEFINITION | whole-NM demand |
| 11 | Prorata NM | Prorata NM | VERIFIED: `ROUNDUP(Req NM / days in NM,2)` | ERP deliberately exposes full NM demand in `Req NM`; daily rate is `Avg Daily Req` / date-wise demand |
| 12 | CURRENT CONS. | CURRENT CONS. | ERP DEFINITION (replaces RM_DATA) | net posted P261 − P262, CM start .. day before as-of |
| 13 | CURRENT_STOCK | CURRENT_STOCK (usable) | ERP DEFINITION (replaces RM_DATA) | ledger stock at start of as-of day, UNRESTRICTED at required SLoc − open reservations |
| 14 | Current Balance | Current Balance | ERP DEFINITION | stock − CM prorata |
| 15 | Status of NM | Status of NM | ERP DEFINITION | COVERED / SHORT_IN_NM / SHORT_BEFORE_NM / NO_DEMAND |
| 16 | INTRANSIT CM | INTRANSIT CM | ERP DEFINITION (Q-T06) | PO/GE/CSN/lot partition, ETA in `D`..CM end |
| 17 | INTRANSIT NM | INTRANSIT NM | ERP DEFINITION | ETA in NM |
| 18 | Cov till NM | Cov till NM | ERP DEFINITION | stock + all dated inbound through NM end |
| 19 | Below Target | Below Target | ERP DEFINITION | STK DAYS < Target |
| 20 | Below Critical | Below Critical | ERP DEFINITION | STK DAYS < Critical |
| 21 | Below Target w. In | Below Target w. In | ERP DEFINITION | Cov till NM < Target |
| 22 | Below Critical w. In | Below Critical w. In | ERP DEFINITION | Cov till NM < Critical |
| 23 | MOQ | MOQ + MOQ UoM + MOQ Source | VERIFIED intent (B09) | Tab 2 policy, source VENDOR / COMPANY / NONE |
| 24 | MOQ Active | MOQ Active | ERP DEFINITION | Tab 2 policy flag; applied to Net Req (MOQ) |
| 25 | Identifier | Identifier | VERIFIED: compact 0–3 sum of below-target, below-critical and ID2 flags | ERP: named NO_DEMAND / NO_POLICY / CRITICAL / BELOW_TARGET / OK states; safer than an opaque code |
| 26 | ID2 | ID2 (with incoming) | VERIFIED: set where calculated Total Stock is at least Current Stock | ERP: named cover-with-inbound state, using the same required-SLoc stock definition |
| 27 | CURRENT MONTH REQ | = Current Req (#8) | ERP DEFINITION — the sheet lists it twice | same value |
| 28 | PRORATA (current month) | = Current Prorata (#9) | same | same value |
| 29 | CM DAYS LEFT | CM DAYS LEFT | VERIFIED intent (EOMONTH − TODAY) | inclusive as-of .. CM end |
| 30 | NM REQ DAYS | NM REQ DAYS | VERIFIED: CMP003 = full NM days only from the 15th; CMP005/CMP011 = `MAX(Target − CM Days Left,0)` | ERP: clamp(Target − CM DAYS LEFT, 0, NM days), same for all companies; intentional smoothing correction, not a legacy copy |
| 31 | NEXT MONTH REQ | NEXT MONTH REQ | ERP DEFINITION | NM demand for the first NM REQ DAYS days |
| 32 | TOTAL REQ | TOTAL REQ | ERP DEFINITION | Current Req + NEXT MONTH REQ |
| 33 | TOTAL PRORATA | TOTAL PRORATA | ERP DEFINITION | Current Prorata + NEXT MONTH REQ |
| 34 | AVG. LEAD TIME | AVG. LEAD TIME (effective) + Source + configured / observed columns | VERIFIED (brief): legacy = MAXIFS(...)+4, a **max** | see contract §6 |
| 35 | Safety Day Stock | Safety Day Stock | VERIFIED: `TOTAL PRORATA × Target Cov` | ERP correction: Critical × avg daily; legacy quantity×days mixes a horizon quantity with a coverage-day target |
| 36 | Lead time Stock | Lead time Stock | VERIFIED: `AVG. LEAD TIME × TOTAL PRORATA` | ERP correction: effective lead time × avg daily |
| 37 | Total Stock | Total Stock | VERIFIED: Safety + Lead time Stock | Same composition, with dimensionally consistent ERP inputs |

ERP-only additions (no legacy column): CM Req − Cons, Unrestricted / Reserved @ Req SLoc, Other SLoc (transfer), QA, Blocked, Required SLoc / Other SLocs, In-transit ETA passed / unknown / later, Inbound Risk, NM Opening / Closing, stock-out dates, Net Req, Net Req (MOQ), Avg Daily Req, lead-time configured / observed / P90 / samples, policy effective date / version / source / updated by.

## Legacy tab → ERP source

| Legacy tab | Replaced by (read-only) |
|---|---|
| PLAN, PLAN/PRD | PO21 `erp_planning.customer_plan_line` (effective rule) — PRD is not plan and is not used |
| BOM, DV | `stroke_master` / `stroke_line` (+ PO21 Tab 2 periods, Use Primary), `pack_bom` / `pack_bom_line`, `material_category_group_member` |
| RM_PM_REQ, ITEM_REQ | engine explosion + group-pool allocation (no stored copy) |
| RM_DATA | `erp_inventory.get_stock_history` (stock + CONS bucket), `reservation_document` |
| CONSOILI_MVT | received CSNs (PO date → GRN date) + `erp_history` lead-time samples |

## Remaining formula-review boundary

The verified formulas establish the legacy behavior. A row-level numeric parity run still needs a
frozen selected date, matching historical source snapshot and mapped ERP material identities; it
must compare intentional ERP corrections separately from regressions.
