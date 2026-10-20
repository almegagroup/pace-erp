# PO22 — Claude findings, 2026-10-19 (Google Sheets formulas + live implementation state)

**Author:** Claude (assigned by the business owner for this task: "document all findings in `common`").
**Status:** EVIDENCE RECORD. No code, migration, DB, ACL, deployment or branch-promotion change was made.
**Read with:** `START-HERE-ALL-AGENTS.md`, `GOOGLE-SHEET-FORMULA-REFERENCE.md` (earlier sampled notes, now superseded where this file is more precise), Phase 2D contract.

---

## 0. Evidence and limits

| Item | Evidence |
|---|---|
| Live Git refs (fetched 2026-10-19) | `main` = `dev` = `4cf13ff`; `agent/codex` = `910ec92` (17 ahead, 0 behind `main`); `agent/chatgpt` = `02e2243` (diverged 1/5); `agent/claude` = `cbe1e95` (diverged 31/3, contains a merge commit); `common` = `516a3c5` before this commit. |
| Codex test re-run | Detached worktree of `agent/codex` `910ec92`: `deno test --no-check` over all `mts_optimizer*test.ts` + `mts_requirement.logic.test.ts` → **78 passed, 0 failed** (Deno 2.9.6). |
| Google Sheets access | Google Drive connector (owner account). Files: `[JAYASHREE] REPORTS_ALL` (CMP011, `1z0Ikk0z…`), `[ACPL] REPORTS_ALL` (CMP005, `18SQHKF0…`), `[SURFACE] REPORTS_ALL` (CMP003, `1lm-FpAW…`), owner `supplychainmodule@gmail.com`, modified 2026-10-19. |
| What was read | **CMP011 and CMP005: whole workbook exported as ODS, every tab parsed (formulas). CMP003: NOT read** — ODS export timed out twice (4.7 MB). xlsx export is refused by Drive ("too large"). |
| Values | Array formulas (`FILTER`, `UNIQUE`, `QUERY`, `SORT`, `IMPORTRANGE`) do not survive ODS export, so most computed **values** came out as `#VALUE!`/`#NAME?`. **Formula text is complete and reliable; numeric parity was NOT checked.** |
| Formula notation below | ODS form converted to Sheets form; `A3:A1001` array ranges written as row-3 logic. |

---

## 1. How the sheet planning works (CMP011 and CMP005, identical except where noted)

```
PLANPRD   SKU-wise monthly PLAN (and PRD) rows, MT; col C = "PLAN"/"PRD"; I = SKU (11 digits), J = Prodshade (LEFT 8)
  │
PLAN      Prodshade × month MT = SUMIFS(PLANPRD month col, C="PLAN", J=Prodshade)
  │
RM_PM_REQ one row per (location, Prodshade/SKU, stroke, ITEM) from DV (← BOM via IMPORTRANGE)
          per-day requirement per month:
            RM : PLAN_MT × 1000 × DOSAGE% ÷ days_in_month
            PM : (PLANPRD_SKU_MT × 1000 ÷ pack_KG[DV!AH:AI by RIGHT(SKU,3)]) × QTY_per_pack ÷ days_in_month
  │       ITEM can be a GROUP NAME (e.g. "RDP", "WHITE CEMENT") — groups are planned as one item
ITEM_REQ  UNIQUE(ITEM, TYPE); per-day requirement = SUMIF over RM_PM_REQ by ITEM, per month
  │
REQUIREMENT  (main report, one row per ITEM incl. group names; excludes locations IWC, HPS, CTG)
PLANNING     (daily grid for ONE selected ITEM in D3)

RM_DATA       ledger-style sections: OPENING, INWARD, RPS, LOCATION, QA, PID, CONSUMPTION (AQ:AW, QTY negative),
              RESERVE (AX:BE: CATEGORY, TYPE, CODE, LOCATION, STATUS, PRODUCTION, RPS, AVAILABLE QTY), ALL (BF:BL)
CONSOILI_MVT  = QUERY(MVT_TRACKER, "SELECT M,J,AU,AT,A,D,H ..."):
              A CATEGORY (group/item), B Order Qty, C Qty, D ETA TO PLANT, E Status, F ORDER, G SUPPLIER,
              H qty = C if present else B, J CATEGORY (from supplier DB), K Sail, L Clearance, M Transport, N KP, O OP,
              P ETA/ETD, Q suppliers, R Lead Time = K + L + M + N
```

PM pack-KG table (`DV!AI2:AI11`): 0.2, 1, 1, 1, 5, 10, 20, 30, 40, 50 keyed by SKU last 3 digits (keys not recoverable from export).

### 1.1 REQUIREMENT — exact column formulas (row 3)
Header dates: `H1 = first day of month(TODAY)`, `I1 = EOMONTH(H1)`, `J1 = I1+1`, `K1 = EOMONTH(J1)`.

| Col | Header | Formula (meaning) |
|---|---|---|
| A/B | ITEMS / TYPE | `SORT(UNIQUE(FILTER(RM_PM_REQ!L:M, A<>"IWC", A<>"HPS", A<>"CTG", A not blank)))` |
| C | Target Cov | manual days |
| D | Critical Cov | `ROUNDUP(C/2,0)` |
| E | CURRENT STK DAYS | `ROUNDDOWN(M / AD, 0)`, error → 0 |
| F | Next Month cov | `ROUNDDOWN((M + P) / AD, 0)` = stock **+ CM in-transit** ÷ AD |
| G | Current Cov | `ROUNDDOWN(M / ((H + L) / (EOMONTH(H1) − TODAY())), 0)`, negative → "-" |
| H | Current Req | `x = ROUNDUP(ITEM_REQ_daily[CM] × days_in_CM, 2)`; `IF(x + L <= 0, J, x + L)`. L is **negative**, so H = **remaining CM requirement** (falls back to Req NM if ≤ 0) |
| I | Current Prorata | `IF(AE=1, ROUNDUP(H / (days_in_CM − DAY(TODAY()) + 1), 2), ROUNDUP(H / days_in_NM, 2))` = **daily rate** |
| J | Req NM | `ROUNDUP(ITEM_REQ_daily[NM] × days_in_NM, 2)` |
| K | Prorata NM | `ROUNDUP(J / days_in_NM, 2)` = **NM daily rate** |
| L | CURRENT CONS. | `SUMIFS(RM_DATA!AU, RM_DATA!AR = item, RM_DATA!AQ between H1 and I1)` (**negative** quantities) |
| M | CURRENT_STOCK | CMP011: `VLOOKUP(item, RM_DATA!AX:BE, 8)` (first match only); CMP005: `SUMIF(RM_DATA!AX, item, RM_DATA!BE)` — "AVAILABLE QTY" = stock net of production reserve and RPS |
| N | Current Balance | CMP011: `(H + L) − M`; CMP005: `IF(H<=0, 0, H − M)` (positive = shortage) |
| O | Status of NM | `IF(N<0, J+N, N+J)` — both branches identical → **quantity J + N**, not a status |
| P | INTRANSIT CM | `SUMIFS(CONSOILI_MVT!H, A = item, E = 2, D between H1 and I1)` |
| Q | INTRANSIT NM | same with D between J1 and K1 |
| R | Cov till NM | `ROUNDDOWN((M + P + Q) / (K + I), 0)` (divides by the **sum** of two daily rates) |
| S | Below Target | `IF(H<=0, "", IF(E <= C, 1, ""))` |
| T | Below Critical | `IF(H<=0, "", IF(E <= D, 1, ""))` |
| U | Below Target w. In | `IF(H<=0, "", IF(F <= C, 1, ""))` (uses F = CM in-transit only) |
| V | Below crtcl w. In | `IF(H<=0, "", IF(F <= D, 1, ""))` |
| W | MOQ | manual |
| X | Identifier | `IF(AJ="", "", IF(AC<=0, 0, IF(S+T+AJ=3, 3, IF(S+T+AJ=2, 2, 1))))` = **priority score 0–3** |
| Y | CURRENT MONTH PRORATA | ITEM_REQ lookup on range `A:W` (too narrow) → `#N/A` in both files (dead column) |
| Z | CM DAYS LEFT | `DAY(EOMONTH(H1)) − DAY(TODAY()) + 1` |
| AA | NM REQ DAYS | `IF(C > Z, C − Z, 0)` (CMP011 and CMP005; **no cap** at NM days). **CMP003 not read** — earlier ChatGPT note says it uses a day-of-month (15th) condition |
| AB | NEXT MONTH REQ | `AA × K` |
| AC | TOTAL REQ | `H + AB` |
| AD | TOTAL PRORATA | `IF(AE=1, ROUNDUP(AC / (Z + AA), 2), I)` = **daily rate over the cover window** |
| AE | (helper) | `1` if CM requirement + L > 0 else `0` |
| AF | AVG. LEAD TIME | `MAXIFS(CONSOILI_MVT!R, CONSOILI_MVT!J, item) + 4` |
| AG | Safety Day Stock | `AD × C` (**Target** days × daily rate) |
| AH | Lead time Stock | `AF × AD` |
| AI | Total Stock | `AG + AH` (reorder level) |
| AJ | ID2 | `IF(H<=0, "", IF(AI >= M, 1, ""))` = stock at/below reorder level |

Differences CMP011 vs CMP005 (all other row-3 formulas identical): **M** (VLOOKUP vs SUMIF), **N** (`H+L−M` vs `H−M`), **Y** rounding.

### 1.2 PLANNING — daily grid (one ITEM in D3)
| Cell / col | Formula |
|---|---|
| C1 | first day of current month |
| F2 | Target Cov of D3 from REQUIREMENT col C (labelled "MIN STOCK" but it is **days**) |
| G2 | MOQ of D3 from REQUIREMENT col W |
| D9.. | date sequence from first day of the previous month |
| C | book stock: opening (RM_DATA E, status NORMAL) + ledger movements (RM_DATA BJ, NORMAL) before the date; blank for future dates |
| E | Opening: `IF(Q>0, C, I_previous)` — **Q ("CC") is the user calibration flag** |
| F | ETA to Plant: `SUMIFS(CONSOILI_MVT!H, A = item, D = date)` (any status) |
| G | proposed lot: `IF(AE=1, G2, IF(F=0, "", IF(D<>AC8, "", IF(J_prev < F2+1, G2, ""))))` |
| H | daily pro-rata = ITEM_REQ daily rate of that month |
| I | Closing = `E + F + G − H` |
| J | Max days = `IF(I<0, 0, ROUNDDOWN(I/H, 0))` |
| K/L | Min stock = `I − (G+F)`; Min days = `IF(K<0, 0, ROUNDDOWN(K/H, 0))` |
| M:P | PO / qty / supplier / status via X:AB |
| AC8 | latest ETA date; AC = date where F > 0 |
| AD | `IF(D <= AC8, "", IF(J = 1 + F2, 1, ""))` — **exact equality trigger** |
| AE | `IF(AD_previous = 1, 1, "")` |
| T:W | `QUERY(D8:L, "SELECT D,G,J,L WHERE G>0")` = predicted lots (date, qty, max, min days) |
| R/S | import ETD / port reference = T − transit (M4/N4 from CONSOILI_MVT for the supplier in M2) |

Observed (dated, not a baseline): CMP011 PLANNING D3 = "RDP": predicted lots 2026-10-02 25,000 (max 73 / min 30), 2026-12-15 8,000, 2027-01-07 6,000, 2027-01-23 6,000, 2027-02-09 6,000, 2027-02-19 10,000; MOQ 25,000; Target 35.

---

## 2. Sheet behaviour vs ERP

**ERP-A** = Claude's original Requirement engine, now in `main` (`mts_requirement.logic.ts`, commit `12762593`). It was built when the sheets were unreachable (see `docs/mts-planning/PO22-REQUIREMENT-SOURCE-FIELD-MAPPING.md`, rows marked "ERP DEFINITION").

| Field | Sheet | ERP-A | Verdict |
|---|---|---|---|
| Critical default | ROUNDUP(Target/2) | same | MATCH |
| Current Req | remaining CM = month req − consumed | whole CM (`cm_req`); remaining exists as `cm_balance_req` | MISMATCH (label/meaning) |
| Current Prorata | **daily rate** H ÷ days left | remaining quantity | MISMATCH (unit) |
| Req NM | NM quantity | same | MATCH |
| Prorata NM | **NM daily rate** | = Req NM | MISMATCH |
| CURRENT CONS. | negative quantity | positive | sign only |
| CURRENT_STOCK | available after production reserve + RPS | unrestricted − open reservations at required SLoc | concept close; location rule differs |
| Current Balance | requirement − stock (+ = shortage) | stock − prorata (+ = surplus) | MISMATCH (sign) |
| Status of NM | quantity J + N | status code | MISMATCH |
| INTRANSIT CM/NM | CONSOILI status 2 by ETA month | PO/GE/CSN/lot partition | ERP broader (by design, Q-T06) |
| CURRENT STK DAYS | stock ÷ AD | date-wise walk | method differs |
| Next Month Cov | (stock + CM in-transit) ÷ AD | NM opening ÷ NM rate | MISMATCH |
| Current Cov | stock ÷ CM daily rate | stock + CM inbound date-wise | MISMATCH |
| Cov till NM | (stock+P+Q) ÷ (K+I) | date-wise | method differs (sheet formula suspect) |
| Below flags | `<=`, blank if H ≤ 0 | `<` | MISMATCH (boundary) |
| "w. In" flags | use F (CM in-transit only) | use Cov till NM | MISMATCH |
| Identifier | priority score 0–3 | text class | MISMATCH |
| ID2 | reorder level ≥ stock | class with incoming | MISMATCH |
| CM DAYS LEFT | inclusive | same | MATCH |
| NM REQ DAYS | max(0, Target − Z) | same + cap at NM days | MATCH (cap is ERP-only) |
| NEXT MONTH REQ | AA × K | date-wise first-AA-days | MATCH (uniform demand) |
| TOTAL REQ | remaining CM + AB | whole CM + AB | MISMATCH (via Current Req) |
| TOTAL PRORATA | **daily rate** AC ÷ (Z+AA) | quantity | MISMATCH |
| AVG. LEAD TIME | max + 4 | same value labelled "legacy equivalent" | MATCH |
| Safety Day Stock | AD × **Target** | Critical × avg daily | MISMATCH |
| Lead time Stock / Total Stock | AF × AD; AG + AH | same shape, different rate | follows AD |
| Group planning | group name is one ITEM (requirement, Target, MOQ per group) | per individual material with group-pool allocation | DESIGN CONFLICT (owner B11 says per individual material) |

**Consequence:** ERP-A's REQUIREMENT field names match the sheet but several meanings do not. The Phase 2D rule "PO22 CM/NM unchanged" protects ERP-A's numbers; aligning them to the sheet needs an explicit owner decision.

## 3. Probable defects inside the sheets (do not copy into ERP)
1. CMP011 `N = (H+L) − M` subtracts consumption twice (CMP005 uses `H − M`).
2. `O` Status of NM: both IF branches identical.
3. `R` Cov till NM divides by the sum of two daily rates.
4. `Y` CURRENT MONTH PRORATA lookup range too narrow → `#N/A` in both files.
5. CMP011 `M` VLOOKUP takes only the first RESERVE row (CMP005 sums all rows).
6. PLANNING lot trigger `J = Target+1` (exact equality) can skip a date.
7. PLANNING `F3` contains an `AI(...)` formula returning a text error message.

---

## 4. Verified implementation state (live Git, 2026-10-19)

| Area | State | Evidence |
|---|---|---|
| Requirement engine, CM/NM, NM Req Days, Material Settings | in `main` | `12762593`; 20 tests |
| Phase 3A normalization | in `main` | `c7dfe79`, `dc4a24e` |
| Phase 3B readers, company scope, selection API, snapshot write, migration `20261019070346` | `agent/codex` only; migration/ACL not applied | `74c406d`, `40cc0b6`, `a256fe8` |
| Phase 3C shared-stock allocator; demand reader + endpoint | `agent/codex` only | `2ba5627`, `2ac5bcb`, `31029d4`, `4b1925c` |
| Phase 3D coverage / MOQ+multiple / PO-by | `agent/codex` only, partial | `3c0ce20`, `f2ff8d5`, `2ac5bcb` |
| Changes to `mts_requirement.*` on codex | additive identity fields only; `buildRequirementRows()` unchanged | `git diff main agent/codex` |
| Phase 3E Store UI/report/export, R→R, Phase 3F commercial + AI | not implemented | — |
| Deployment / UAT | none | — |

### Confirmed defects on `agent/codex` `910ec92`
1. Effective plan-line attribution: `effectivePlanAt` (`mts_requirement.logic.ts:158`) drops `source_id`; `mts_optimizer_phase3c_source.reader.ts:87` returns all loaded plan-line ids incl. superseded/cancelled.
2. Overdue / null-ETA arrivals silently dropped: `mts_optimizer_phase3d.logic.ts:58`.
3. Company-wide unresolved group-pool total copied onto every material risk row: `phase3d.logic.ts:65`, `:86`.
4. Recommended PO-by can be before the as-of date with no flag: `phase3d.logic.ts:97–98`.
5. One lot per material; no dated split lots (25+25) or carry-forward.

### Not yet integrated
No run assembly (readers → allocator → projection → `persistOptimizerInputSnapshot`); R→R advisory; Store report/UI/export; commercial; AI; backtesting; manual overrides; per-company import-MOQ negative test; the 22 Phase 2D §10 cases as a named suite; sheet numeric parity; UAT.

---

## 5. Owner decisions needed (open)
1. Which sheet meanings must ERP reproduce exactly (Prorata = daily rate, Current Req = remaining, Safety = Target × rate, Identifier score, ID2 reorder flag), given the Phase 2D "CM/NM unchanged" rule?
2. Group-level (sheet) vs individual-material (owner B11) requirement / Target / MOQ.
3. CMP003 REQUIREMENT `AA` (NM REQ DAYS) formula — please paste the `AA3` formula or share a smaller copy containing only the REQUIREMENT tab.
4. Whether the sheet defects in §3 should be fixed in the ERP equivalent (recommended) or reproduced for parity comparison only.

## 6. Handoff
- Branch/head at write time: `common` `516a3c5` + this commit. No code branch changed.
- Next starting point: owner's answers to §5, then (per earlier recommendation) the plan-line attribution fix in a branch authorised by the owner (`agent/claude` is diverged and cannot be fast-forwarded).
- Re-extract: export ODS via Drive `download_file_content` (`application/x-vnd.oasis.opendocument.spreadsheet`), parse `content.xml` `table:formula` attributes.
