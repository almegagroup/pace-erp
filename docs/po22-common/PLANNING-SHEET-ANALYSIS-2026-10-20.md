# PLANNING tab — full analysis and data lineage

Workbooks: `[SURFACE] REPORTS_ALL` (CMP003), `[JAYASHREE] REPORTS_ALL` (CMP011) and `[ACPL] REPORTS_ALL` (CMP005).
Read-only analysis, written 2026-10-20. Nothing in Drive was edited, shared, copied or deleted.

The owner says all three companies use the same planning logic, and that users have planned on it for about 6 years. This document uses the
formulas from CMP011 and CMP005, because those two exported with formulas. It uses CMP003 for the current
values, and to confirm that CMP003 has the same structure.

---

## 0. Evidence and limits

| Source | Method | What it gave | Timestamp |
|---|---|---|---|
| CMP003 `1lm-FpAW…` | `download_file_content` as ODS: **timed out twice (60 s)**. XLSX: **"File too large for export"**. `read_file_content`: returned only the tab list and ranges, with no values. | **No CMP003 formulas.** | — |
| CMP003 `1lm-FpAW…` | `get_file_metadata` with `snippetVerbosity=MAX_ALLOWED`. This returned a 1,048,274-character content snippet, which is a CSV-like text rendering of every tab. | **Values** for PLANNING rows 1–194 (whole tab), ITEM_REQ, REQUIREMENT, DV, PLAN and others. Saved as `cmp003_snippet.txt`, with PLANNING in `cmp003_planning_values.csv`. | File modifiedTime 2026-10-20T15:26:43Z. Read about 15:27 UTC, so TODAY() = 2026-10-20. |
| CMP011 `1z0Ikk0z…` and CMP005 `18SQHKF0…` | ODS export from the earlier session, already parsed to `scratchpad/cmp011.json` and `cmp005.json` (cell → {formula, value}). | **All formulas** of every tab. Array-formula values show `#NAME?` or `#VALUE!` in ODS. Exported values use `IFERROR(__xludf.dummyfunction(...);cached)`, and the cached value is kept. | Files dated 2026-10-19 13:31. TODAY() at export = 2026-10-19. |

Caveats for reading the evidence:
- **The CMP003 values rendering drops empty cells inside a row.** It also prints numbers ≥ 1000 with a thousands comma, for example `71,690.65`. So the CMP003 values below were mapped to columns by structure, matched against the known CMP011/CMP005 layout. Every mapping was checked arithmetically, for example I = E + F + G − H and J = ROUNDDOWN(I/H).
- **ODS turns open-ended Sheets ranges such as `RM_DATA!$E$3:$E` into `...$E194`.** 194 is the last row of PLANNING, and the same `194` appears unchanged in every row of every formula. So `X$n:X194` in the ODS means `X$n:X` (open-ended) in Sheets. This is INFERRED but strongly supported. Ranges like `X9:AA37` have a fixed, non-194 end and are genuinely bounded.
- ODS removes the `ARRAYFORMULA(...)` wrapper. Cells written as `[.D9:.D194]` inside an `IF` are array formulas in Sheets. Their spilled neighbours have no formula of their own.
- Data validation (dropdowns) is **not** captured by the export. Dropdown sources below are INFERRED from helper ranges that exist only to feed them.
- CMP003's `IMPORTRANGE` source file ids and tab names (BOM, MVT_TRACKER, Product_Data_Base) **could not be read**. The CMP011 and CMP005 ids are quoted. CMP003 almost certainly uses the same central tracker file with its own tab name (INFERRED).

---

## 1. Layout map: PLANNING (A1:BA194)

### 1.1 Top header block (rows 1–7)

| Cell | Header / content | Formula (CMP011 = CMP005) | Meaning | CMP003 value now |
|---|---|---|---|---|
| C1 | (date) | `=EOMONTH(TODAY(),-1)+1` | First day of the current month. Used by X8 to list arrivals from this month onward. | 1/10/2026 |
| C2 / D2 | `TYPE` / **input** | typed (dropdown RM/PM, INFERRED) | Material type. It filters the item dropdown through `DV!AJ2`. | RM |
| C3 / D3 | `CATGORY` / **input — selected item** | typed (dropdown from `DV!AJ2:AJ`, INFERRED) | **The one item the whole grid is computed for.** The text must equal the item name in BOM/ITEM_REQ **and** the CATEGORY in MVT_TRACKER, **and** the ITEMS key in REQUIREMENT. | **MHEC** |
| F1 / F2 | `MIN STOCK` / value | `=IFERROR(VLOOKUP($D$3,REQUIREMENT!$A$3:$C,3,0),0)` | **Target coverage days**, taken from REQUIREMENT column C "Target Cov". The label "MIN STOCK" is misleading. | 30 |
| G1 / G2 | `QTY PER LOT` / value | `=IFERROR(VLOOKUP($D$3,REQUIREMENT!$A$3:$W,23,0),0)` | **Lot size / MOQ**, from REQUIREMENT column W "MOQ". Every proposed lot is exactly this quantity. | 25000 |
| F3 | (stray) | CMP011 only: `=AI("Fill an appropriate value for this cell based on the table context")`, which returns a text error message | Junk. Nothing references it. | empty (INFERRED) |
| I1 | `MONTH WISE REQ` | label | — | — |
| J1 | months list | `=UNIQUE(FILTER(A9:A,NOT(ISBLANK(A9:A))))` spills J1:J6 | The distinct months in the grid. | 9,10,11,12,1,2 (shown with month-only formatting) |
| K1:K6 | monthly requirement | `=IFERROR(VLOOKUP($D$3,ITEM_REQ!$A$2:$AC,MATCH($J1,ITEM_REQ!$A$1:$AC$1,0),0),0)*DAY(EOMONTH(J1,0))` | Monthly requirement = daily rate × days in month. **Broken:** see defect D1. | 0.00 for every month |
| M1 / M2 | `SUPPLIER` / **input** | typed (dropdown from `CONSOILI_MVT!Q2:Q`, INFERRED) | Supplier. It is used **only** for the ETD back-calculation in M4/N4 and R/S. It does **not** affect lots. | SHANDONG TIANSHENG CELLULOSE CORP ., LTD. |
| M3 / M4 | `ETA/ETD` / days | `=UNIQUE(FILTER(CONSOILI_MVT!$P$2:$P, CONSOILI_MVT!J2:J=$D$3, CONSOILI_MVT!$I$2:$I=$M$2))` | Days from port arrival (or local dispatch) to plant, for this item and supplier. It comes from Product_Data_Base Col17. | 9 |
| N3 / N4 | `TRANSIT TIME` / days | same, but column `$K` | Sea "Sail Time" (Product_Data_Base Col12). | 25 |
| B6 | base date | typed constant `1/1/2024` | Lower date bound for ledger movements in the book stock (column C). | 1/1/2024 |
| R1 | `Prediction` | label | — | — |
| R2 / R3:R | `IMPORT ETD` | `=ARRAYFORMULA(IF($M$4=$N$4,"",IF(S3:S="","",S3:S-$N$4)))` | The latest ship date at the origin port. It is blank when ETA/ETD = transit, meaning a local supplier. | 9/11/2026, 27/11/2026 |
| S2 / S3:S | `LCL-ETD / IMP-PORT ETA` | `=ARRAYFORMULA(IF(T3:T="","",T3:T-$M$4))` | Port ETA (import), or the local dispatch date. | 4/12/2026, 22/12/2026 |
| T2:W | `Date`, `Quantity to Dispatch`, `MAX DAYS`, `MIN DAYS` | `T2 = QUERY(D8:L,"SELECT D,G,J,L WHERE G>0",1)` | **The list of predicted lots.** Columns: plant-arrival date, lot qty, coverage after the lot, coverage before the lot. | 13/12/2026 25000 48 30; 31/12/2026 25000 48 30 |

### 1.2 Daily grid (header row 8, data rows 9–189; rows 190–194 are blank)

D9 holds one `SEQUENCE` that creates 181 dates. Columns A, B, H and M:P are single array formulas in row 9. Columns C, E, F, G, I–L and AC–AE are copied down per row.

| Col | Row-8 header | Formula, row r (Sheets notation) | Meaning / business purpose |
|---|---|---|---|
| A | FISRT DAY | `=ARRAYFORMULA(IF(D9:D="","",EOMONTH(D9:D,0)-DAY(EOMONTH(D9:D,0))+1))` | First day of the row's month. Used as the key into ITEM_REQ. |
| B | Month-Year | `=ARRAYFORMULA(IF($D9:D="","",MONTH($D9:D)&"-"&YEAR($D9:D)))` | Display only, for example `9-2026`. |
| C | BOOK OPENING | `=IF(Dr>TODAY(),"", SUMIFS(RM_DATA!$E$3:$E,RM_DATA!$B$3:$B,$D$3,RM_DATA!$G$3:$G,"NORMAL") + SUMIFS(RM_DATA!$BJ$3:$BJ,RM_DATA!$BG$3:$BG,$D$3,RM_DATA!$BL$3:$BL,"NORMAL",RM_DATA!$BF$3:$BF,">="&$B$6,RM_DATA!$BF$3:$BF,"<"&$Dr))` | **Actual book stock at the start of the day.** It is the opening snapshot (RM_DATA OPENING section, status NORMAL, with no date filter) plus every ALL-ledger movement with status NORMAL dated ≥ B6 and before this date. It is blank for future days. QA and other non-NORMAL statuses are excluded. Present in rows 9–189. |
| D | Date | `D9 = SEQUENCE(275-94,1,TODAY()-DAY(TODAY())+1-1-DAY(TODAY()-DAY(TODAY())+1-1)+1,1)` | 181 consecutive days, starting on the **first day of the previous month**. Today that is 1/9/2026 → 28/2/2027. `275-94` is a hard-coded constant. |
| E | OPENING | `E9 = C9`; `Er = IF(Dr="","",IF(Qr>0,Cr,I(r-1)))` | Projected opening. It normally equals yesterday's projected closing. **When the CC flag (Q) is >0 that day, the projection is reset to actual book stock (C).** |
| F | ETA TO PLANT | `=IF(Dr="","",SUMIFS(CONSOILI_MVT!$H$2:$H,CONSOILI_MVT!$A$2:$A,$D$3,CONSOILI_MVT!$D$2:$D,$Dr))` | Committed arrivals: tracker quantity whose "ETA TO PLANT" equals this date. **There is no status filter**, so delivered, in-transit and planned lines all count. H is the received quantity if present, otherwise the order quantity. |
| G | Quantity to Dispatch | `=IF(Dr="","",IF(AEr=1,$G$2,IF(Fr=0,"",IF(Dr<>$AC$8,"",IF(J(r-1)<$F$2+1,$G$2,"")))))` | **Proposed (not yet ordered) lot.** See §3. |
| H | PRO-RATA | `=ARRAYFORMULA(IF(D9:D="","",ROUNDUP(IFERROR(VLOOKUP($D$3,ITEM_REQ!$A$2:$AL,MATCH($A9:$A,ITEM_REQ!$A$1:$AL$1,0),0),0),2)))` | **Planned daily consumption** for the row's month, rounded up to 2 dp. It is plan-based for past days too, not actual consumption. |
| I | CLOSING | `=IF(Dr="","",Er+Fr+Gr-Hr)` | Projected closing stock. |
| J | MAX DAYS | `=IFERROR(IF(Dr="","",IF($Ir<0,0,ROUNDDOWN($Ir/$Hr,0))),"")` | Coverage days **after** today's receipts (closing ÷ daily rate). It shows "" when H = 0. |
| K | MIN STK | `=IF(Dr="","",Ir-(Gr+Fr))` | Closing **without** today's arrivals and lot, i.e. the low point just before receipt. |
| L | MIN DAYS | `=IFERROR(IF(Dr="","",IF($Kr<0,0,ROUNDDOWN($Kr/$Hr,0))),"")` | Coverage days just before receipt. |
| M,N,O,P | PO NUMBERS, QTY, Supplier, ST | `=IFERROR(VLOOKUP($D9:$D,$X$9:$AA$37,2/3/4,0),"")` (P uses `$X$9:$AB$37`, col 5), as array formulas | Shows the tracker PO, qty, supplier and status on the arrival date. **Only the first 29 arrival dates are covered** (defect D6). |
| Q | CC | **manual input** (0 / 1 / blank; it has no formula) | **Calibration flag.** Typing 1 on a date makes E on that date equal actual book stock, which discards the accumulated projection error. CMP003 has it on 16/10/2026. CMP011 has it on row 69 (31/10/2026). CMP005 has it on rows 39 and 54. The meaning of the abbreviation is not documented. |

### 1.3 Right-hand helper areas

| Range | Header (row 8) | Formula | Meaning |
|---|---|---|---|
| X8:X | Date | `=QUERY(D8:G,"SELECT D WHERE F>0 AND D>= date '"&TEXT(C1,"YYYY-MM-DD")&"'")` | Committed arrival dates **from the current month onward**. Earlier-month arrivals are not listed, so M:P are blank for them. |
| AF9:AL9 (per row) | PO | `=IFERROR(TRANSPOSE(QUERY(CONSOILI_MVT!$A$2:$H,"SELECT F WHERE D= date '"&TEXT($X9,"YYYY-MM-DD")&"' AND A='"&$D$3&"' ")),"")` | All PO numbers arriving on that X-date, spilled sideways (7 columns). |
| AM9:AT9 | QTY | same, `SELECT C` (8 columns) | Received quantity column (C = MVT_TRACKER AU "QUANTITY"). Note that F in the grid uses H, which falls back to the order qty. |
| AU9:AZ9 | SUPPLIER | same, `SELECT G` (6 columns) | Supplier names. |
| BA9:BF9 | STATUS | same, `SELECT E` (6 columns) | Tracker status code (MVT_TRACKER A). |
| Y,Z,AA,AB | PO, QTY, SUPPLIER, STATUS | `=TEXTJOIN(CHAR(10),,IFERROR(FILTER(AF9:AL9,AF9:AL9<>""),""))` (and similarly AM:AT, AU:AZ, BA:BF) | Joins the multiple values into one cell. **Y/Z/AA exist only in rows 9–51; AB runs to 194.** |
| AC9:AC | (AC8 = `=MAX(AC9:AC)`) | `=IF(Fr=0,"",Dr)` | Dates with a committed arrival. **AC8 = the last committed arrival date in the window.** |
| AD9:AD | Flag | `=IF(Dr<=$AC$8,"",IF(Jr=1+$F$2,1,""))` | After the last committed arrival, this flags the day coverage is **exactly** Target + 1. |
| AE9:AE | ETA HIT | `=IF(AD(r-1)=1,1,"")` | 1 on the day after the flag. That makes G drop a lot there. |

CMP003 row-8 values confirm the layout: `…,Date,PO,QTY,SUPPLIER,STATUS,13/11/2026,Flag,ETA HIT,PO,QTY,SUPPLIER,STATUS`. Here AC8 = 13/11/2026, and row 9 shows X9..AB9 = `13/11/2026, ASC/PO123/2026-27, 25000, SHANDONG…, 2`.

---

## 2. Inputs the user changes and their effect

| Input | Where | Effect |
|---|---|---|
| Item | D3 | Drives every lookup: target, MOQ, daily rate, book stock, arrivals and ETD data. It is one item per screen. |
| Type | D2 | Only narrows the D3 dropdown list (`DV!AJ2` filters `RM_PM_REQ!M = PLANNING!D2`). |
| Supplier | M2 | Only changes M4/N4, and so the R/S ETD back-dates. It never changes the quantities or lot dates. |
| CC flag | Q9:Q189 | Re-bases the projection on actual book stock from that date forward. It is persistent: the cell is bound to a grid **row**, not to a date, so as D shifts each month the flag silently moves to a different date (defect D9). |
| Manual overrides | G cells | Users overwrite the G formula with typed quantities. CMP011 has typed values in G114/137/153/170/180 (8000, 6000, 6000, 6000, 10000). The G formula is also missing (blank) in G69/104/126/143/160/175/176. These typed values flow into T:W as "predictions". |
| Source data | REQUIREMENT C (target) and W (MOQ), PLANPRD plan rows, DV pack sizes, tracker ETAs | See §6. |

---

## 3. Logic step by step

**Daily consumption (H).** The rate is taken from `ITEM_REQ[item, month]` and rounded up to 2 dp. ITEM_REQ is already a per-day figure: for each month it is RM_PM_REQ ÷ DAY(EOMONTH). That figure is built from the monthly production plan, not from actual consumption. So past days in the grid also use the plan rate. Months beyond ITEM_REQ's last header (Dec 2026) give H = 0.

**Opening / book stock (C, E).** C is the actual book stock from RM_DATA: the OPENING snapshot plus the ALL ledger with status NORMAL, dated ≥ B6 and before the date. E starts the projection from C on the first grid day (row 9). After that it chains I(r−1), unless a CC flag forces E = C.

**Arrivals (F).** F = Σ CONSOILI_MVT!H where CATEGORY = D3 and ETA-to-plant = date. H = received qty if present, otherwise order qty. No status filter is applied.

**Coverage.** I = E + F + G − H. J = floor(I/H) is max days, after receipts. K = I − F − G, and L = floor(K/H) is min days, before receipts.

**Lot recommendation (G).** For each row:
1. If AE = 1 (the previous row was flagged), propose a lot of **G2 (MOQ)**.
2. Otherwise, a lot can also be added **only on the date of the last committed arrival (AC8)**. This happens when that row has an arrival (F ≠ 0) and the previous day's coverage J(r−1) < Target + 1. The lot lands on the same day as the committed arrival.
3. On any day after AC8, AD flags the day **J equals exactly Target + 1**. AE fires on the next day, and step 1 adds the lot there. So a lot arrives when coverage would fall to about Target, and the lot is sized at MOQ.
4. No lot is ever proposed on or before AC8, except at AC8 itself. Lot quantity is always exactly MOQ: there is no rounding to need, and no multiple lots.
5. T:W lists every row with G > 0: date, qty, J (max days after the lot) and L (min days before the lot).

**Import date back-calculation.** S = T − M4 gives the port ETA, or the local dispatch date. R = S − N4 gives the origin ETD. R is suppressed when M4 = N4, which marks a local supplier. M4 and N4 come from CONSOILI_MVT columns P/K for (item, supplier M2). Those columns come from Product_Data_Base Col17 (ETA/ETD) and Col12 (Sail Time). CONSOILI_MVT R "Lead Time" = K + L + M + N is not used by PLANNING.

---

## 4. Current values — CMP003, item MHEC (as of 2026-10-20)

Header values: Type RM, Item MHEC, Target (F2) **30 days**, MOQ (G2) **25,000**, supplier SHANDONG TIANSHENG CELLULOSE CORP., LTD., ETA/ETD (M4) 9, Transit (N4) 25.

The REQUIREMENT row for MHEC: Target Cov 30, Critical 15, CURRENT_STOCK 99,256.09 (this equals PLANNING C on 20/10), INTRANSIT NM 25,000, MOQ 25,000.

ITEM_REQ daily rate for MHEC: Sep-26 1447.08, Oct-26 1415.387, Nov-26 1423.603, Dec-26 1385.268. H shows these rounded up. There are no ITEM_REQ columns after Dec 2026.

First 15 grid rows (Book = C, Open = E, Arr = F, Lot = G, Daily = H, Close = I, Max = J, MinStk = K, Min = L):

| Date | Book | Open | Arr | Lot | Daily | Close | Max | MinStk | Min |
|---|---|---|---|---|---|---|---|---|---|
| 01/09/26 | 73,137.73 | 73,137.73 | 0 | | 1447.08 | 71,690.65 | 49 | 71,690.65 | 49 |
| 02/09 | 71,186.17 | 71,690.65 | 0 | | 1447.08 | 70,243.57 | 48 | 70,243.57 | 48 |
| 03/09 | 69,473.29 | 70,243.57 | 0 | | 1447.08 | 68,796.49 | 47 | 68,796.49 | 47 |
| 04/09 | 67,254.97 | 68,796.49 | 0 | | 1447.08 | 67,349.41 | 46 | 67,349.41 | 46 |
| 05/09 | 65,580.97 | 67,349.41 | 0 | | 1447.08 | 65,902.33 | 45 | 65,902.33 | 45 |
| 06/09 | 63,624.01 | 65,902.33 | 0 | | 1447.08 | 64,455.25 | 44 | 64,455.25 | 44 |
| 07/09 | 63,624.01 | 64,455.25 | 0 | | 1447.08 | 63,008.17 | 43 | 63,008.17 | 43 |
| 08/09 | 62,922.01 | 63,008.17 | 0 | | 1447.08 | 61,561.09 | 42 | 61,561.09 | 42 |
| 09/09 | 62,340.97 | 61,561.09 | 0 | | 1447.08 | 60,114.01 | 41 | 60,114.01 | 41 |
| 10/09 | 61,807.45 | 60,114.01 | 0 | | 1447.08 | 58,666.93 | 40 | 58,666.93 | 40 |
| 11/09 | 61,807.45 | 58,666.93 | 0 | | 1447.08 | 57,219.85 | 39 | 57,219.85 | 39 |
| 12/09 | 61,807.45 | 57,219.85 | 0 | | 1447.08 | 55,772.77 | 38 | 55,772.77 | 38 |
| 13/09 | 61,807.45 | 55,772.77 | 0 | | 1447.08 | 54,325.69 | 37 | 54,325.69 | 37 |
| 14/09 | 61,807.45 | 54,325.69 | 0 | | 1447.08 | 52,878.61 | 36 | 52,878.61 | 36 |
| 15/09 | 61,807.45 | 52,878.61 | 0 | | 1447.08 | 51,431.53 | 35 | 51,431.53 | 35 |

Key later rows:

| Date | Event |
|---|---|
| 26/09 | Arr 48,000. Close 83,513.65 (Max 57 / Min 24). Book the next day rose only about 46k. |
| 28/09 | Arr 24,000. Close 104,619.49. |
| 29/09 | Arr 48,000. Close 151,172.41 (Max 104). **Book stock never rose for this 48,000.** C on 30/09 is 114,938.77, down from 116,781.25. |
| 16/10 | **CC = 1.** Open reset to book **100,351.21**, against a projected 128,494.48: a correction of −28,143. |
| 20/10 (today) | Book 99,256.09. Projected close 93,274.26 (Max 65). |
| 13/11 | Committed arrival 25,000. PO ASC/PO123/2026-27, SHANDONG, status 2. This is AC8. Close 84,198.04 (Max 59 / Min 41). No lot, because J on 12/11 = 42 ≥ 31. |
| 12/12 | J = 31, so AD = 1. |
| **13/12** | **Proposed lot 25,000.** Close 66,988.16, Max 48 / Min 30. Back-dates: port ETA 4/12, import ETD **9/11/2026**. |
| 30/12 | J = 31, so AD = 1. |
| **31/12** | **Proposed lot 25,000.** Close 67,053.30, Max 48 / Min 30. Back-dates: port ETA 22/12, ETD **27/11/2026**. |
| 01/01/27 – 28/02/27 | H = 0 (ITEM_REQ has no 2027 columns). Closing stays flat at 67,053.30, J and L are blank, and no further lots are proposed. |

There are exactly 2 predicted lots (T3:W4).

---

## 5. Defects and fragile points

| # | Where | Problem |
|---|---|---|
| D1 | K1:K6 | The VLOOKUP/MATCH range is `ITEM_REQ!A:AC`, which ends at Mar-2026. Every grid month (Sep-26 onward) misses, so IFERROR returns **0**. The "MONTH WISE REQ" panel is dead in all three companies. H uses `A:AL` correctly. |
| D2 | AD (lot trigger) | **Exact equality `J = Target+1`.** J drops by more than 1 in a day when H rises at a month change, or when J is already ≤ Target right after the last committed arrival. When that happens the flag never fires, so **no further lot is ever proposed** and stock can run to 0 silently. The same happens if MOQ covers fewer than Target+1 days: J after the lot never climbs back, so only one lot is proposed. |
| D3 | G / AD / AC8 | Before the last committed arrival (AC8), no lot is ever proposed, even if stock goes negative. A shortage before the last PO's ETA shows only as J = 0. |
| D4 | Horizon | H, ITEM_REQ, RM_PM_REQ and PLAN all stop at **Dec 2026**. PLANPRD already has Jan-2027 plan data. So the Jan–Feb 2027 grid rows have zero consumption, flat stock and no lots. In CMP011 users worked around this by typing lots into G. |
| D5 | Lot size | It is always exactly MOQ, with one lot per trigger. It is not sized to need, and dated split lots are not possible. |
| D6 | M:P | The lookup range is fixed at `$X$9:$AA$37`/`$AB$37`, i.e. only the first 29 arrival dates get PO/qty/supplier/status shown. Y/Z/AA formulas exist only in rows 9–51. |
| D7 | AF:BF | Blocks are 7/8/6/6 columns wide. With more than 7 POs (or more than 6 suppliers/statuses) on one date, the TRANSPOSE spill collides with the next block and gives #REF!. |
| D8 | F | There is no status filter. Stale or never-received tracker lines still inflate the projection. Live example: the 48,000 on 29/09 never reached the book, and only the manual CC reset on 16/10 fixed it. |
| D9 | Q (CC) | The flag is attached to a grid row, while D re-sequences every month (it starts on the first day of the previous month). So last month's flag silently moves to a different date. The flag is also a manual habit with no audit trail. |
| D10 | H | The rate is plan-based even for past days, so the projection between the first grid day and today ignores actual consumption. Only C/CC correct this. |
| D11 | D9 | Window length is a hard-coded `275-94` (181 days). The start is always the first day of the previous month. |
| D12 | B6 / C | The opening snapshot (RM_DATA A:G) has **no date filter**, while movements are counted from B6 = 1/1/2024. If the opening snapshot date is later than B6 (CMP011's opening rows are dated 2024-04-01), any ALL-ledger movement between B6 and the snapshot date would be double-counted. It is harmless only while the ALL ledger starts on or after the snapshot date. |
| D13 | Name keys | D3 must be the identical string in BOM/ITEM_REQ, REQUIREMENT, MVT_TRACKER CATEGORY and Product_Data_Base Col5. In CMP005 the item is "RDP - [VINNAPASS 5010N]". Any spelling drift silently gives 0 arrivals or a 0 target. |
| D14 | F2/G2 | IFERROR turns a missing REQUIREMENT row into target 0 / MOQ 0, so lots of 0 are never listed. This fails silently. |
| D15 | J/L | Division by H = 0 gives "" through IFERROR. Text "" compared `< F2+1` is FALSE in Sheets, so no lot is proposed when the rate is 0. |
| D16 | F3 (CMP011) | A stray `AI()` formula returns an error sentence. |
| D17 | M4/N4 | UNIQUE(FILTER) can return several values for the same item+supplier. Only the first is used. |
| D18 | Upstream, RM_PM_REQ J:M | RM vs PM row classification is `LEN(description column D) < 10`. A PM SKU whose description is shorter than 10 characters would be read as an RM row, and its demand would be computed wrongly. |
| D19 | Upstream, DV!AH:AI | Pack code → pack-size (kg) is a **sorted spill** (`AH1 = SORT(UNIQUE(RIGHT(PLANPRD!H,3)))`) next to **hand-typed** sizes in AI. A new pack code shifts the spill and misaligns every typed size. The lookup range `DV!AH2:AI11` holds only 10 rows. |
| D20 | Upstream, PLAN | The guard cell drifts with the drag: `C4` tests `A4`, `D4` tests `B4`, `E4` tests `C4`, …, so each month's guard looks two columns left. It works by accident (no blanks in practice). |
| D21 | Upstream, CONSOILI_MVT | `QUERY(MVT_TRACKER!A1:AU3644,…)` has a fixed end row of 3644 (genuinely bounded). Tracker rows past 3644 would be dropped. Check against current row counts: MVT_TRACKER in CMP003 spans A1:AU7293, so **verify in CMP003**; rows beyond 3644 may already be missing. |

---

## 6. Data lineage (where every value comes from)

### 6.1 Diagram

```
EXTERNAL FILES / MANUAL ENTRY                    THIS WORKBOOK                                    PLANNING
─────────────────────────────                    ─────────────                                    ────────
BOM master file (IMPORTRANGE)                    BOM!A2:K  (RM dosage %, rows with W=1)
  CMP011 1QdVP0F1Wlr5hW_ekQy9PDdrvX-I7b1WjYo4C49V8iwo   BOM!L2:V  (PM qty per pack per SKU)
  CMP005 1ME3aPmcfHrDX0MKdW7A0AdXF_Q0bJ81DzZanpiX7-PY        │
  CMP003 (not readable)                                       ▼
                                                 DV!P2:X  = UNIQUE(FILTER(BOM!A:H))   DV!Y2:AG = UNIQUE(FILTER(BOM!L:T))
                                                              └───────────┬───────────┘
Manual: PLANPRD "PLAN" rows                                   ▼
 (SKU, LOC, monthly tonnes M:AW)  ──► PLAN!A:AL  (Σ PLAN rows per prodshade, tonnes)
Manual: DV!AI pack size (kg)      ──► DV!AH:AI ──┐            │
                                                 ▼            ▼
                                     RM_PM_REQ (one row per BOM line; daily qty per month)
                                       RM: PLAN[prodshade,m]×1000×dosage%/days
                                       PM: PLANPRD[SKU,m]×1000/packsize×qty/days
                                                              │  SUMIF by item
                                                              ▼
                                                 ITEM_REQ (item × month, per-day)  ──────────► H (daily rate)
                                                              │                                K1:K6 (broken)
                                                              └──► DV!AJ (planning list) ─────► D3 dropdown

Central tracker file 1tUoPMEOglPkY7nHvMTtvR-27YCCxM0THYXnc7dbgkEA
  tab JI (CMP011) / ACPL1 (CMP005) / ? (CMP003)  ──► MVT_TRACKER!A1:AU
                                                              │ QUERY SELECT M,J,AU,AT,A,D,H
                                                              ▼
                                                 CONSOILI_MVT A:H  (item, ordQty, rcvQty, ETA plant,
                                                                    status, PO, supplier, H=qty) ─► F, X, AF:BF, M:P, AC8
  tab Product_Data_Base!A1:S (Col2='PUTTY'/'P/TA1')──► CONSOILI_MVT I:P (supplier, item, sail,
                                                                    clearance, transport, KP, OP, ETA/ETD)
                                                                    Q = suppliers of PLANNING!D3 ──► M2 dropdown
                                                                    K, P ───────────────────────────► N4, M4 → R, S

External stock feed (static values, no formulas) ──► RM_DATA  OPENING A:G, ALL BF:BL ──────────► C (book) → E (via CC)
                                                    (INWARD, RPS, LOCATION, QA, PID,
                                                     CONSUMPTION, RESERVE also present)

Manual: REQUIREMENT C "Target Cov", W "MOQ" ─────────────────────────────────────────────────► F2, G2
Manual in PLANNING: D2, D3, M2, Q (CC), B6, overrides in G
```

### 6.2 Value → formula → source table

| PLANNING value | Formula reads | Source tab / cells | Original source |
|---|---|---|---|
| F2 Target days | VLOOKUP col 3 | REQUIREMENT!C3:C (no formula in any row, in CMP011 or CMP005) | **Manual entry** in REQUIREMENT |
| G2 MOQ | VLOOKUP col 23 | REQUIREMENT!W3:W (no formula) | **Manual entry** |
| H daily rate | VLOOKUP/MATCH month | ITEM_REQ!A:AL. `A2 = UNIQUE(RM_PM_REQ!L2:M)`, `C2… = SUMIF(RM_PM_REQ!L, item, RM_PM_REQ!<month col>)`. The header is C1 = 1/1/2024 typed, then each next header = EOMONTH(prev)+1. | RM_PM_REQ → PLAN/PLANPRD (manual plan) + BOM (IMPORTRANGE) + DV!AI (manual pack sizes) |
| RM_PM_REQ A:I | `UNIQUE(QUERY({DV!P2:X;DV!Y2:AG},"SELECT * WHERE Col1 IS NOT NULL ORDER BY Col2"))` | DV!P:X (RM BOM) and DV!Y:AG (PM BOM) | BOM tab ← IMPORTRANGE of the external BOM file |
| RM_PM_REQ J:N | J,K,L,M = `IF(LEN(D)<10, B/C/E/G, C/D/F/H)`; N = `IF(I="",H,I)` | Its own A:I | Classification heuristic (D18) |
| RM_PM_REQ O:AX (per month, per day) | RM: `VLOOKUP(J, PLAN!A4:…, MATCH(month, PLAN!A2:…))*1000*N%/DAY(EOMONTH)`. PM: `VLOOKUP(J, PLANPRD!I4:…, MATCH(month, PLANPRD!I2:…))*1000/VLOOKUP(RIGHT(J,3), DV!AH2:AI11, 2)*N/DAY(EOMONTH)` | PLAN (prodshade tonnes), PLANPRD (SKU tonnes), DV!AH:AI | Manual monthly plan in PLANPRD; manual pack sizes |
| PLAN!A4 prodshades, C4:AL | `A4 = UNIQUE(FILTER(PLANPRD!J4:J412,PLANPRD!C4:C412="PLAN"))`; `C4 = SUMIFS(PLANPRD!M4:M412, PLANPRD!C,"PLAN", PLANPRD!J, A4)` | PLANPRD rows where C = "PLAN" | **Manual**: PLANPRD C ("PLAN"/"PRD"/"TOTAL…"), G LOC, H SKU, L description and M:AW monthly tonnes are all typed. I = TEXT(H,"00000000000"), J = LEFT(I,8) prodshade, K = pack label from DV!A3:B19. |
| PLANPRD "PRD" rows | `SUMIFS(TALC_DB!X, TALC_DB!S, SKU, TALC_DB!Q, month range)/1000` | TALC_DB (static values, 0 formulas) | External production/dispatch feed. **Not used by PLANNING** (PLAN takes "PLAN" rows only). |
| BOM!A2:K, L2:V | `FILTER(IMPORTRANGE(id,"BOM!A2:K"), IMPORTRANGE(id,"BOM!W2:W")=1)`; `FILTER(IMPORTRANGE(id,"BOM!L2:V"), NOT(ISBLANK(IMPORTRANGE(id,"BOM!L2:L"))))` | External BOM file (ids in §6.1). W = 1 marks the active RM BOM line. | **Other file**, presumably maintained by hand (INFERRED) |
| DV!AH:AI pack size | `AH1 = SORT(UNIQUE(RIGHT(PLANPRD!H4:H1000,3)))`; AI typed (0.2, 1, 1, 1, 5, 10, 20, 30, 40, 50) | PLANPRD SKU suffix | Manual (AI) |
| D3 dropdown list | `DV!AJ2 = SORT(UNIQUE(FILTER(RM_PM_REQ!L2:M, A<>"IWC", A<>"HPS", A<>"CTG", M=PLANNING!D2, A not blank)),2,TRUE)` | RM_PM_REQ | BOM chain. It excludes IWC/HPS/CTG locations from the *list*, but ITEM_REQ still sums all locations. |
| C book stock | SUMIFS on RM_DATA E/B/G and BJ/BG/BL/BF | RM_DATA OPENING (A:G) and ALL (BF:BL) | **RM_DATA has zero formulas** in CMP011/CMP005 (CMP003: 58,496 rows). It is fed from outside the sheet by paste or script. The exact feeder is not visible (INFERRED). Its sections are OPENING A:G, INWARD H:N, RPS O:U, LOCATION V:AB, QA AC:AI, PID AJ:AP, CONSUMPTION AQ:AW, RESERVE AX:BE (incl. PRODUCTION, RPS, AVAILABLE QTY) and ALL BF:BL. ALL looks like the union ledger: row 3 of ALL equals row 3 of INWARD. Statuses include NORMAL and QA. PLANNING uses only OPENING + ALL with NORMAL. REQUIREMENT also reads CONSUMPTION (L) and RESERVE (M). |
| F arrivals, X, AC8, M:P, Y:AB, AF:BF | SUMIFS / QUERY on CONSOILI_MVT A:H | `CONSOILI_MVT!A1 = QUERY(MVT_TRACKER!A1:AU3644,"SELECT M,J,AU,AT,A,D,H WHERE A IS NOT NULL",1)`. Result columns: A = CATEGORY (M), B = Order Qty (J), C = QUANTITY (AU), D = ETA TO PLANT (AT), E = Status (A), F = ORDER (D), G = SUPPLIERS (H). `H2 = IF(A="","",IF(C="",B,C))`. | MVT_TRACKER: `FILTER(IMPORTRANGE("1tUoPMEOglPkY7nHvMTtvR-27YCCxM0THYXnc7dbgkEA","JI!A1:AU"), NOT(ISBLANK(IMPORTRANGE(…,"JI!A1:A"))))`. CMP005 uses tab `ACPL1`. It is the **central procurement movement tracker (other file, manual entry by procurement, INFERRED)**, with 47 columns: Status, PO, order date, supplier, item, order qty, ETA/ETD schedule, LC, BL, invoice, BOE, payment, transporter, LR, inward date, MDN, ETA TO PLANT, QUANTITY. |
| M4, N4, and the M2 list | FILTER on CONSOILI_MVT P/K/Q | `CONSOILI_MVT!I1 = UNIQUE(QUERY(IMPORTRANGE("1tUoPMEO…","Product_Data_Base!A1:S"),"SELECT Col1,Col5,Col12,Col13,Col14,Col15,Col16,Col17 WHERE Col2='PUTTY'",1))`. CMP005 uses `'P/TA1'`. Columns: I supplier, J category, K sail time, L clearance, M transporter arrangement, N KP, O OP, P ETA/ETD. `Q2 = UNIQUE(FILTER(I2:I3644, J2:J3644=PLANNING!$D$3))`. `R2 = K+L+M+N` (lead time). | Product_Data_Base tab in the central tracker file (manual master, INFERRED) |
| Q CC, D2, D3, M2, B6, overridden G | — | PLANNING itself | **Manual** |

---

## 7. Differences: CMP003 vs CMP011 vs CMP005

The grid formulas are **identical** in CMP011 and CMP005, cell for cell, across columns C–L and X–BF. CMP003's value structure (header texts, column order, the row-8 headers, 181-day window, T:W layout, AC8, CC column) matches exactly, so it is the same template (formulas not directly readable).

| Item | CMP003 (values) | CMP011 | CMP005 |
|---|---|---|---|
| Selected item D3 | MHEC | RDP | RDP - [VINNAPASS 5010N] |
| Target / MOQ | 30 / 25,000 | 35 / 25,000 | 30 / 5,000 |
| Supplier M2 | SHANDONG TIANSHENG (import, M4 9 / N4 25, so R is shown) | TIANPU CHEMICALS | RISHI TECHTEX LTD. |
| F3 | empty | stray `AI()` formula | empty |
| G overrides | none visible (both lots are formula-driven) | 5 typed lot quantities and 7 blanked G cells | none |
| CC flags | 16/10/2026 | row 69 | rows 39, 54 |
| Predicted lots | 13/12 and 31/12, 25,000 each (48/30 days) | 02/10 25,000 (formula), then 15/12 8,000, 07/01, 23/01 and 09/02 6,000 each, and 19/02 10,000 (typed) | 15/10 and 30/10, 5,000 each (129/30 days) |
| MVT_TRACKER source tab | unknown | `JI` | `ACPL1` |
| Product_Data_Base filter | unknown | Col2 = 'PUTTY' | Col2 = 'P/TA1' |
| BOM source file | unknown | `1QdVP0F1…` | `1ME3aPmc…` |
| REQUIREMENT M (current stock) | — | `VLOOKUP(item, RM_DATA!AX:BE, 8)` (first match) | `SUMIF(RM_DATA!AX, item, RM_DATA!BE)` (from the earlier notes; not used by PLANNING) |
| PLANNING tab size | A1:BA194 | 4,292 cells | 4,281 cells |

---

## 8. Files

- `/tmp/claude-0/-home-user-pace-erp/3a269f15-c264-5891-93aa-2f56c1fcf06d/scratchpad/sheets/cmp003_snippet.txt`: CMP003 values, all tabs.
- `/tmp/claude-0/-home-user-pace-erp/3a269f15-c264-5891-93aa-2f56c1fcf06d/scratchpad/sheets/cmp003_planning_values.csv`: CMP003 PLANNING values.
- `/tmp/claude-0/-home-user-pace-erp/3a269f15-c264-5891-93aa-2f56c1fcf06d/scratchpad/sheets/cmp011_planning_dump.txt` and `cmp005_planning_dump.txt`: formula dumps, with per-column normalized patterns.
- `/tmp/claude-0/-home-user-pace-erp/3a269f15-c264-5891-93aa-2f56c1fcf06d/scratchpad/sheets/cmp011_lineage.txt`: formulas of ITEM_REQ, RM_PM_REQ, PLAN, PLANPRD, BOM and MVT_TRACKER.
