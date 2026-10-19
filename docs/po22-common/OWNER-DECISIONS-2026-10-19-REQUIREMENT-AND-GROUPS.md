# PO22 — Owner decisions, 2026-10-19 (Requirement tab, R003, groups)

**Recorded by:** Claude, from the business owner's own answers in chat on 2026-10-19.
**Authority:** These are explicit owner decisions. Where they conflict with an older
document (Phase 2D contract, matrix, findings), **this file wins** for the points below.
**Read with:** `CLAUDE-FINDINGS-2026-10-19-SHEETS-AND-STATE.md` (sheet formulas and gaps).

## D1 — R003 is shown, never counted as stock (supersedes Phase 2D §4 / §10 test 5)
- Stock in R003 is **displayed**, but is **not** counted in available stock, coverage or allocation.
- If an item has stock in R003, it is **referred for transfer**, e.g. an advisory `R003 → R001` suggestion.
- Phase 2D §4 said "do not exclude R003" and §10 test 5 said "posted unrestricted R003 stock counts". **Both are replaced by D1.**
- CMP003 OT01/OT02 stay hard-excluded as before.

## D2 — Requirement tab: keep the sheet's purpose, never its bugs
The ERP Requirement tab must do everything the sheet's REQUIREMENT tab does. The known sheet bugs are **not** carried into the ERP.

Column-by-column choice (proposed by Claude in chat and not objected to by the owner. The owner then answered the group questions below):

| Topic | Use | Rule |
|---|---|---|
| Current Req | Sheet | Remaining CM = month requirement − consumption so far (whole-month value also shown) |
| Prorata (CM, NM, Total) | Sheet | **Daily rate**, not a quantity |
| Current Stock | ERP | Live ledger, R+S unrestricted posted − reservations; **R003 excluded (D1)**; OT01/OT02 excluded |
| In-transit | ERP | PO/GE/CSN/lot partition, shown split: dispatched vs open PO |
| Coverage days | ERP | Date-wise walk with dated arrivals |
| Below Target / Critical | Sheet | Inclusive (`<=`) |
| Safety Day Stock | Sheet | Target days × daily rate |
| Current Balance | Sheet | `+` = shortage |
| Identifier 0–3 / ID2 | Sheet | Priority score / reorder-level flag |
| Lead time | ERP | Configured vendor lead time; fallback = sheet (max tracker lead time + 4) |
| NM Req Days | ERP | `min(NM days, max(0, Target − CM days left))` |
| Lot trigger | New | First day coverage falls to/below Target (not the sheet's exact `= Target+1`) |

Sheet bugs **not** to copy: CMP011 double consumption in Current Balance; "Status of NM" identical branches; "Cov till NM" dividing by a sum of rates; CMP011 first-row-only stock VLOOKUP; dead `#N/A` CURRENT MONTH PRORATA column.

Note: this intentionally relaxes the Phase 2D "PO22 CM/NM numbers unchanged" rule for the column meanings above. NM Req Days stays as is.

## D3 — Group items
- Every stroke line is either **fixed** (one material only) or **group** (any member; Use Primary = Yes → primary first).
- Fixed demand is covered first from its own material's stock, by date. Members' remaining stock forms the group's available stock. A material in several groups gives its leftover to the group that needs it earliest. Stock is never counted twice.
- The Requirement tab shows a **group row** (like the sheet) with member rows underneath (stock split: fixed vs group).
- **Target and Critical days are per member material, not per group**, and **can change over time.** They must be dated, effective-from versions. The existing PO22 Material Settings policy (`material_requirement_policy`: company × material × `effective_from`, append-only versions) already supports this.
  - Implication: each member's coverage is checked against its own dated Target/Critical. Each member's demand is its fixed demand plus its allocated share of group demand. The group row shows totals and flags any member below its own Target/Critical.
- **MOQ / order multiple is per material + vendor** (purchase is always of a material).
  - Source decided in D4 below: vendor-material master.
- Buy suggestion is per material: a group shortage is bought through the member chosen by the user's six-month selection (or the cheapest eligible member when commercial data exists). The excess of an MOQ lot is used first in later months.

## Worked example (illustrative, not company data)
RDP group = ELOTEX-60W + VAE DA1100. Product A needs ELOTEX (fixed) 2t; Products B and C need RDP (group) 10t. Stock: ELOTEX 5t, VAE 4t.

| Row | Need | Available | Short |
|---|---:|---:|---:|
| ELOTEX-60W (fixed, A) | 2t | 2t | 0 |
| RDP group (B, C) | 10t | 7t (ELOTEX 3t + VAE 4t) | 3t |

Buy: the selected member (e.g. VAE) 3t. If VAE's MOQ is 25t, the PO is 25t and the 22t remainder is used first next month.

## D4 — MOQ / order multiple live in the vendor-material master
- New fields on `erp_master.vendor_material_info` (vendor × material): MOQ and order multiple (with UOM).
- `material_requirement_policy` keeps Target / Critical only for planning purposes; its existing MOQ field is no longer the planning source once the vendor fields exist.
- `vendor_material_info` has no company column: the vendor's MOQ/multiple is the same for every company, but every company still plans and buys independently (no pooling).

## D5 — Overdue ETA (CSN Tracker is the source)
- Arrival date comes from the CSN Tracker (`eta_to_plant_calculated` and its actual-date cascade).
- If the ETA is already past and the material has not arrived, the user is told: "ETA passed — update this CSN in CSN Tracker".
- If the user updates the CSN, the new date is used. Until then the arrival is assumed **today** (never dropped, so no double buy).

## D6 — Booking Time + lead time
- PROD finding (2026-10-19, read-only): the masters hold **route time only**. Import = `sail_time_days` (8 rows, 7–31 d) + `clearance_days` (5 d) + `port_plant_transit_master` (5 ports, 1–4 d); the PO delivery date is the ETA-at-port. Domestic = `transit_days` per company × vendor (CMP003 67 rows, CMP005 22, CMP011 13); the PO delivery date is the dispatch date. `material_plant_ext.lead_time_days` is empty. **PO-to-dispatch (vendor processing) time is not stored anywhere.**
- Decision: new optional field **Booking Time** (days) on the vendor-material master. Blank = 0 (processing already included in route time). The user fills it where needed.
- Total lead time = Booking Time + route lead time. PO-by date = need date − total lead time.

## D7 — Daily phasing
Monthly PO21 plan is spread evenly over that month's own calendar days (30, 31, 28/29). This is the current ERP behaviour. Urgent windows and Tab 2 stroke periods still apply. The report labels it as a forecast, not confirmed production dates.

## D8 — Scope: everything in the first go-live (supersedes Phase 2D §12 staging of 3F)
The first go-live includes Requirement tab, Planning tab, buy recommendations, joint fixed/group allocation, Store report, **commercial cost comparison and AI** (an AI API is already purchased), plus R→R suggestions.
Cost-to-cost comparison must cover the full cash cycle, not only landed cost:
1. landed cost (price, freight, duty, clearance …),
2. when cash goes out (vendor payment term / LC),
3. when cash comes back: payment timing of the **FG customers** whose products consume that material,
4. financing cost for the gap between cash out and cash in,
5. holding cost of the safety stock kept.
AI explains and proposes scenarios; numbers come only from a deterministic rerun (Phase 2D §8 boundary unchanged).
Owner states all data exists; Claude to verify location/fill-rate in PROD (read-only) before build.

## D9 — All companies together
CMP003, CMP005 and CMP011 go live together under the same rules. Company-specific differences are handled through manual/configurable data fields, not code differences. (This makes the CMP003 sheet `AA3` NM-Req-Days formula non-blocking: the ERP rule `min(NM days, max(0, Target − CM days left))` applies to all companies.)
