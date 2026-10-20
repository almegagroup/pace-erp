# Google Sheet Reference — formula-level PO22 verification
**Source:** Native Google Sheets workbook `[SURFACE] REPORTS_ALL`, ID `1lm-FpAWzgECOb4PM7AIX8-1q9gUI10flqQmB17qAKgg`, inspected in FORMULA mode on 2026-10-19. Literal formulas are evidence of historic behavior, not necessarily the approved final implementation if brittle. This is a bounded sampling (header and example rows), **not exhaustive all tabs/all rows**.

> **2026-10-19 update:** complete row-level formulas for CMP011 and CMP005 (all tabs) are in [CLAUDE-FINDINGS-2026-10-19-SHEETS-AND-STATE.md](CLAUDE-FINDINGS-2026-10-19-SHEETS-AND-STATE.md); that file supersedes this sampled note where they differ. CMP003 is still unread.

## Requirement tab
- `C` Target Coverage Days. `D = ROUNDUP(C/2)` Critical Days in the reference.
- `E` Current Stock Days from current stock `M` / prorata `AD`.
- `F` projected stock+incoming coverage days.
- `H/I` current-month requirement / prorata; `J/K` next-month; `L` current consumption; `M` current stock.
- `P/Q` current-month / next-month in-transit from `CONSOILI_MVT`.
- `W` MOQ; `AF = MAXIFS(CONSOILI_MVT!R, material)+4` reference average lead-time expression, not automatically vendor-route total lead time.
- `AG = AD*C` safety-day stock; `AH = AF*AD` lead-time stock; `AI=AG+AH`.
- Example sheet row `AA` shows a conditional day rule based on current day-of-month; **do not conflate historic sheet rules with separately approved ERP NM Req Days**. Preserve existing PO22 `NM Req Days = min(NM days, max(0, Target Days − CM Days Left))`.

## Planning daily grid
- `PLANNING!D3` selected RM material.
- `F2 = IFERROR(VLOOKUP(D3,REQUIREMENT!A3:C,3,FALSE),0)` -> target **coverage days**, despite F1 display `MIN STOCK`.
- `G2 = IFERROR(VLOOKUP(D3,REQUIREMENT!A3:W,23,FALSE),0)` -> lot quantity/MOQ.
- Grid headers `D:Q`: Date, Opening `E`, ETA to Plant `F`, proposed Quantity to Dispatch `G`, Pro-rata consumption `H`, Closing `I`, Max Days `J`, Min Stock `K`, Min Days `L`, PO Number `M`, Qty `N`, Supplier `O`, Status `P`, CC `Q`.
- `I9 = E9+F9+G9-H9`.
- `J9 = IF(I9<0,0,ROUNDDOWN(I9/H9,0))` (wrapped with IFERROR/blank guards).
- `K9 = I9-(G9+F9)` and `L9 = IF(K9<0,0,ROUNDDOWN(K9/H9,0))`.
- `E10 = IF(Q10>0,C10,I9)` when row date present; actual-book stock can supersede previous projected closing.
- `F9` is `SUMIFS(CONSOILI_MVT!H, material=D3, plantETA=D9)`.
- `H9` prorata daily material use from `ITEM_REQ`.
- `G10 = IF(AE10=1,G2,IF(F10=0,"",IF(D10<>AC8,"",IF(J9<F2+1,G2,""))))` (outer blank date guard). G9 similar.
- `AC8 = MAX(AC9:AC)` latest ETA; `ACn=IF(Fn=0,"",Dn)`; `ADn=IF(Dn<=AC8,"",IF(Jn=1+F2,1,""))`; `AEn=IF(AD_previous=1,1,"")`. **Note exact equality `J = Target+1`**, not a generic `min days <= target` trigger. Tests must compare baseline and deliberate robust policy upgrades.
- No universal safety=15 assumption. Target is material-specific from Requirement.

## Right-hand prediction
- `PLANNING!T2 = QUERY(D8:L,"SELECT D,G,J,L WHERE G>0",1)`: predicted plant arrival/quantity/Max/Min coverage rows.
- `S3=ARRAYFORMULA(IF(T3:T="","",T3:T-$M$4))`: local transit / port ETA reference.
- `R3=ARRAYFORMULA(IF($M$4=$N$4,"",IF(S3:S="","",S3:S-$N$4)))`: import ETD reference.
- `M4/N4`: vendor/material-linked transit/route data from `CONSOILI_MVT`; sheet does not reliably distinguish multiple vendors by contract.
- `X:AB` actual consignment details/PO/qty/supplier/status; `AC:AE` latest ETA & triggering; `AF:BF` multi-PO details.
- `X8 = QUERY(D8:G, "SELECT D WHERE F>0 AND D>= date ...")` for actual ETA date list.

## Illustrative currently viewed selection
`PLANNING!D3 = MHEC`; target and MOQ dynamically looked up. Prior observed projected arrivals: 13-Dec-2026 and 31-Dec-2026, each 25,000 KG, minimum coverage 30 days. Treat as a dated worksheet observation only; values may change and are not an accepted engine baseline without captured snapshot.

## Required proof before declaring parity
1. Capture cell formulas/values at one as-of timestamp and material with typed UOM, target, MOQ, vendor and in-transit.
2. Build a reproducible fixture and compare daily `E:L` plus predicted `R:W` row by row.
3. Check zero consumption/division, negative balance, late/unknown ETA, no consignment, multiple vendors, mid-month state refresh, and equality trigger edge cases.
4. Distinguish committed inbound `F` from hypothetical planned arrival `G`, and `J` max vs `L` min coverage.
5. Do not silently change or overwrite approved PO22 CM/NM numeric formulas.
