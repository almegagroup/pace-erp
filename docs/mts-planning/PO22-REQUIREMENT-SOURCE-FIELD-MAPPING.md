# PO22 Requirement — Source / Field / Formula Mapping

Date: 2026-10-16 · Author: Claude Code · Status: **Partially verified** — see the source-validation gap below.

## Source-validation gap (read first)

The three company REPORTS_ALL spreadsheets named in the brief (CMP003 `1lm-FpAW…`, CMP005 `18SQHKF0…`, CMP011 `1z0Ikk0z…`) **could not be opened from this environment** (Google Docs blocked by the network proxy, HTTP 403). No copy of any of the tabs (REQUIREMENT, RM_PM_REQ, ITEM_REQ, BOM, DV, PLAN, PLAN/PRD, RM_DATA, CONSOILI_MVT) exists in the repository.

So this mapping uses only:
- formulas quoted in the owner brief (2026-10-16): `AVG. LEAD TIME = MAXIFS(CONSOILI_MVT!R, material) + 4`, `Critical Cov default = ROUNDUP(Target Cov / 2)`, EOMONTH / TODAY date arithmetic, NM REQ DAYS differs (CMP003 15th-day condition; CMP005 / CMP011 target vs days-left);
- the field list in the brief and `BUSINESS-REQUIREMENTS.md` B11 / B12;
- the verified ERP schema and code.

Nothing below claims a legacy formula that was not supplied. Each row says **VERIFIED (brief)**, **ERP DEFINITION** (ERP semantics defined here, legacy formula not seen) or **UNRESOLVED**. No field was dropped.

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
| 11 | Prorata NM | Prorata NM | **UNRESOLVED** legacy meaning | ERP: equals Req NM (NM has no elapsed days). If the sheet scaled NM by a day count, that is captured by NEXT MONTH REQ (#24) |
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
| 25 | Identifier | Identifier | **UNRESOLVED** legacy values | ERP: NO_DEMAND / NO_POLICY / CRITICAL / BELOW_TARGET / OK from stock cover |
| 26 | ID2 | ID2 (with incoming) | **UNRESOLVED** legacy values | ERP: same classes from cover with incoming |
| 27 | CURRENT MONTH REQ | = Current Req (#8) | ERP DEFINITION — the sheet lists it twice | same value |
| 28 | PRORATA (current month) | = Current Prorata (#9) | same | same value |
| 29 | CM DAYS LEFT | CM DAYS LEFT | VERIFIED intent (EOMONTH − TODAY) | inclusive as-of .. CM end |
| 30 | NM REQ DAYS | NM REQ DAYS | **legacy formula UNRESOLVED** (differs CMP003 vs CMP005/011) | ERP: clamp(Target − CM DAYS LEFT, 0, NM days), same for all companies |
| 31 | NEXT MONTH REQ | NEXT MONTH REQ | ERP DEFINITION | NM demand for the first NM REQ DAYS days |
| 32 | TOTAL REQ | TOTAL REQ | ERP DEFINITION | Current Req + NEXT MONTH REQ |
| 33 | TOTAL PRORATA | TOTAL PRORATA | ERP DEFINITION | Current Prorata + NEXT MONTH REQ |
| 34 | AVG. LEAD TIME | AVG. LEAD TIME (effective) + Source + configured / observed columns | VERIFIED (brief): legacy = MAXIFS(...)+4, a **max** | see contract §6 |
| 35 | Safety Day Stock | Safety Day Stock | ERP DEFINITION (legacy formula not seen) | Critical × avg daily |
| 36 | Lead time Stock | Lead time Stock | ERP DEFINITION | effective lead time × avg daily |
| 37 | Total Stock | Total Stock | ERP DEFINITION | Safety + Lead time Stock |

ERP-only additions (no legacy column): CM Req − Cons, Unrestricted / Reserved @ Req SLoc, Other SLoc (transfer), QA, Blocked, Required SLoc / Other SLocs, In-transit ETA passed / unknown / later, Inbound Risk, NM Opening / Closing, stock-out dates, Net Req, Net Req (MOQ), Avg Daily Req, lead-time configured / observed / P90 / samples, policy effective date / version / source / updated by.

## Legacy tab → ERP source

| Legacy tab | Replaced by (read-only) |
|---|---|
| PLAN, PLAN/PRD | PO21 `erp_planning.customer_plan_line` (effective rule) — PRD is not plan and is not used |
| BOM, DV | `stroke_master` / `stroke_line` (+ PO21 Tab 2 periods, Use Primary), `pack_bom` / `pack_bom_line`, `material_category_group_member` |
| RM_PM_REQ, ITEM_REQ | engine explosion + group-pool allocation (no stored copy) |
| RM_DATA | `erp_inventory.get_stock_history` (stock + CONS bucket), `reservation_document` |
| CONSOILI_MVT | received CSNs (PO date → GRN date) + `erp_history` lead-time samples |

## What is needed to close the UNRESOLVED rows

A copy (xlsx / csv export) of each company's REQUIREMENT tab with formulas visible (or a screenshot of the formula bar for columns Prorata NM, Identifier, ID2, NM REQ DAYS, Safety Day Stock, Lead time Stock, Total Stock). The engine keeps each of those fields isolated in one function, so a confirmed legacy rule can be adopted without touching the rest.
