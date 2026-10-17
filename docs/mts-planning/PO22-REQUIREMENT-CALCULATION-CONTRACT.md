# PO22 Requirement — ERP Calculation Contract

Date: 2026-10-16 · Branch: `agent/claude` · Status: **IMPLEMENTED on branch (not merged, not deployed, no DB applied)**
Engine: `supabase/functions/api/_core/procurement/mts_requirement.logic.ts` (pure, tested in `mts_requirement.logic.test.ts`)
Loader / API: `supabase/functions/api/_core/procurement/mts_requirement.handlers.ts`
Companion docs: `PO22-REQUIREMENT-SOURCE-FIELD-MAPPING.md`, `PO22-LEGACY-RECONCILIATION-REPORT.md`

Every number on the Requirement Report is computed by one pure function (`buildRequirementRows`) from source rows the handler has already loaded. Same sources → same output (tested with a canonical-JSON fingerprint). Nothing is calculated in React.

## 1. Calendar

| Term | Rule |
|---|---|
| As-of date `D` | Chosen by the user (default: today in India). Must lie inside the selected plan month and may not be in the future. **No wall-clock `TODAY()` inside any formula.** |
| CM | The selected plan month (`cmStart`..`cmEnd`). |
| NM | The next calendar month (year rollover handled). |
| CM DAYS LEFT | Inclusive days `D`..`cmEnd` (e.g. 16 Oct → 16). |
| Stock cut-off | **Start of day `D`** = posted ledger balance through `D − 1`. |
| Consumption window | `cmStart`..`D − 1`. |

## 2. Demand (PO21, read-only)

1. **Effective monthly SKU demand** (same rule as `erp_planning.customer_plan_effective`): latest FINAL if present for that SKU-month, else latest ROLLING; plus every ADDITIONAL; plus every URGENT EXTRA. URGENT FROM_PLAN never adds. Cancelled entries excluded. Blank (no plan) stays blank, entered 0 stays 0.
2. **Demand version**: `demand_at` (optional) rebuilds the plan as it stood at that timestamp from the append-only versions (latest version per entry with `created_at ≤ demand_at`). Stroke periods / Use Primary are always the current setting (their retirement time is not recorded, so a time-travel view of them would be invented).
3. **Day-wise SKU demand** (base unit): Base + Additional spread by calendar-day pro-rata over the month, except the quantity Urgent FROM_PLAN moves into its own window (month total unchanged). Urgent EXTRA is spread inside its own window. A window wholly outside the month falls back to the whole month with a warning.
4. **KG conversion of the SKU**: KG base ×1; any other base unit needs a fixed master conversion to KG, else exception `SKU_KG_CONVERSION_MISSING` (never guessed). PROD today: one litre-base SKU in CMP003.

## 3. Explosion

### RM (Prodshade → effective Stroke)
- Prodshade day demand = Σ its SKUs' KG day demand.
- PO21 Tab 2 period `planned_base_qty` replaces calendar pro-rata for its own days; the rest of the month keeps the remainder in its own proportion (month total preserved; warning if the periods exceed the plan).
- Stroke per day = the Tab 2 period covering that day, else the company's current MTS stroke (`mts_current_stroke`). No stroke → exception `MISSING_STROKE`.
- RM qty = `dosage_pct / 100 × Prodshade KG` (same formula as production `buildMtsMaterialPlanGroupsForOrder`).
- Group line: candidates = (Use Primary = Yes → primary `stroke_line.material_id` + active members; No → active members only). Use Primary = latest decision on/before the month for that **Stroke × group** (none = Yes). Inactive members / INACTIVE materials excluded.
- Missing line location → exception `STROKE_LINE_LOCATION_MISSING` (stock is then not matched to a location).

### PM (SKU → company Pack BOM)
- Only ACTIVE company Pack BOM. Outer units = SKU KG ÷ (SFG qty per OUTPUT qty). PM qty = `INPUT.qty / OUTPUT.qty × outer units`, converted to the PM base unit only by fixed master conversion (else `PM_UOM_CONVERSION_MISSING`).
- **No Pack BOM is an exception only when that SKU has planned demand in this company** (`MISSING_PACK_BOM`). A SKU without a plan is silent.
- PM group: candidates = BOM line material + active group members (no Use Primary toggle — owner B09).

### Cross-company production
PO21 stores no producing-company allocation yet. All demand is exploded with the plan company's own Stroke and Pack BOM; the report states this in its notes. The engine raises `SKU_NOT_CURRENT_MTS_SKU` for any planned SKU that does not resolve in the company rather than exploding it silently.

## 4. Stock and allocation (count once)

| Bucket | Source / rule |
|---|---|
| Unrestricted @ required SLoc | `get_stock_history(...).closing` (ledger-strict), stock type UNRESTRICTED, at a location named by an effective Stroke line / Pack BOM line for that material |
| Reserved @ required SLoc | `reservation_document` OPEN + PARTIAL balance — **applied only when as-of = today** (reservations are present-day state) |
| **CURRENT_STOCK (usable)** | max(0, Unrestricted − Reserved) per required SLoc, summed |
| Other SLoc (transfer) | Unrestricted at any other location — visible, never counted as usable |
| QA / Blocked / other types | shown separately, never usable |

Allocation (`allocateDemand`, mirrors production `computeMtsAutoDeriveRowsForGroup`): days are processed chronologically from `D`; within a day pools are processed in a fixed order. Each pool draws first from its procurement target's usable stock (`candidates[0]` = primary / BOM line material), then from the other candidates smallest-available-first, and **subtracts what it drew from the shared pool before the next pool**. Whatever stock cannot cover is attributed once to the procurement target. Days before `D` are already consumed and attributed to the target. Result: a material shared by several Prodshades, lines or groups uses its stock once; group demand is never copied onto every member.

## 5. Inbound (owner Q-T06 contract)

Per open PO line (PO CONFIRMED, line OPEN / PARTIALLY_RECEIVED), remaining = `open_qty × ordered_qty_base_uom / ordered_qty`, partitioned in this order, each capped by what is still unallocated:
1. Gate entries awaiting GRN (`grn_posted = false`, gate not PRUNED / CANCELLED / GRN_POSTED) — dated `D`, kind AT_GATE.
2. Dispatched CSNs (ORD / TRN with `dispatch_qty > 0`): `dispatch_qty − total_received_qty` at `eta_to_plant_calculated`. Mother CSNs that have sub-CSNs are skipped. CSNs consigned to another company are excluded (warned).
3. PO lot balances (`po_lot_balances`) at their delivery date.
4. Remainder at the earliest ETA of a not-yet-dispatched CSN, else PO `expected_delivery_date`, else **UNKNOWN** (never immediate, never zero).

Plus STO CSNs consigned to this company (ORD / TRN). `po_qty` on a CSN is never summed. Buckets: ETA passed (before `D`), CM, NM, later, unknown. Only dated CM/NM supply enters coverage; ETA-passed and unknown supply is shown but **not** counted as on-time.

## 6. Lead time

| Field | Rule |
|---|---|
| Configured | Per ACTIVE vendor of the material (vendor_material_info ∩ vendor_company_map): domestic `transit_days` (company, effective on `D`); import `sail + clearance + port→plant transit`. Transit only — masters hold no vendor processing time. |
| Observed | ERP received CSNs (PO date → GRN date) + imported history (`history_lead_time_samples`: domestic PO→inward, import PO→plant). |
| Legacy equivalent | observed **maximum** + 4 (sheet `MAXIFS(CONSOILI_MVT!R)+4` — a max, not an average). |
| **Effective (used)** | legacy equivalent if any observation exists → else largest configured route → else UNKNOWN. Source label always shown. |

## 7. Business fields (per material, base unit)

| Field | Formula |
|---|---|
| Current Req / CURRENT MONTH REQ | Σ daily demand over the whole CM |
| Current Prorata / CURRENT MONTH PRORATA | Σ daily demand `D`..`cmEnd` (time-based remaining; consumption is **not** subtracted again) |
| CURRENT CONS. | net P261 − P262 posted `cmStart`..`D−1` |
| CM Req − Cons | max(0, Current Req − CURRENT CONS.) — alternative view, not used in projection |
| Req NM / Prorata NM | Σ daily demand over NM (NM has no elapsed days, so equal) |
| Current Balance | CURRENT_STOCK − Current Prorata |
| NM Opening / Closing (projected) | Current Balance + INTRANSIT CM ; NM Opening + INTRANSIT NM − Req NM |
| Status of NM | NO_DEMAND / COVERED (closing ≥ 0) / SHORT_IN_NM (opening ≥ 0, closing < 0) / SHORT_BEFORE_NM (opening < 0) |
| CURRENT STK DAYS | date-wise cover of CURRENT_STOCK alone (fractional last day); past NM end extrapolated at NM daily rate (flagged) |
| Current Cov | date-wise cover of stock + dated inbound arriving in CM |
| Cov till NM | date-wise cover of stock + all dated inbound through NM end |
| Next Month Cov | max(0, NM Opening) ÷ NM daily rate |
| Below Target / Critical | CURRENT STK DAYS < Target / Critical (blank when no policy or no demand) |
| Below Target / Critical w. In | Cov till NM < Target / Critical |
| NM REQ DAYS | clamp(Target − CM DAYS LEFT, 0, days in NM) |
| NEXT MONTH REQ | NM demand of the first NM REQ DAYS days (date-wise, fractional) |
| TOTAL REQ / TOTAL PRORATA | Current Req + NEXT MONTH REQ / Current Prorata + NEXT MONTH REQ |
| Net Req | max(0, TOTAL PRORATA − CURRENT_STOCK − dated inbound up to CM end + NM REQ DAYS) |
| Net Req (MOQ) | when MOQ Active: max(Net Req, MOQ in base unit) if Net Req > 0 |
| Avg Daily Req | (Current Prorata + Req NM) ÷ (CM DAYS LEFT + days in NM) |
| Safety Day Stock / Lead time Stock / Total Stock | Critical × Avg Daily / Effective lead time × Avg Daily / sum |
| Identifier / ID2 | NO_DEMAND, NO_POLICY, CRITICAL, BELOW_TARGET, OK — from CURRENT STK DAYS / from Cov till NM |
| Inbound Risk | NONE / ON_TIME / ETA_UNKNOWN / OVERDUE |

Zero demand → coverage blank and Identifier NO_DEMAND (never "infinite" or 0). Zero stock with demand → cover 0, stock-out date `D`.

## 8. Material Settings policy

`erp_planning.material_requirement_policy` (migration `20261016100000`): company × individual material × `effective_from`, append-only versions. Policy on `D` = row with latest `effective_from ≤ D` (no overlaps possible). Critical stored explicitly; blank Critical → ROUNDUP(Target / 2) at save. MOQ source VENDOR / COMPANY / NONE; NONE carries no quantity and cannot be active; MOQ unit must be the base unit, MT for KG base, or a fixed master conversion. Only materials of the company's MTS Strokes / Pack BOMs (or already holding a policy) may be saved. Both tabs read the same table.

## 9. Provenance

Each report response carries: as-of date, CM/NM, demand version, `calculated_at`, a SHA-256 fingerprint of the canonical input, counts of plan versions / settings / POs / CSNs, whether reservations were applied, and the stock / consumption basis text. Exceptions (demand that could not be exploded) and notes (data limitations) are returned separately and shown above the grid.

## 10. Never

Planning writes only `material_requirement_policy`. It never writes stock, reservation, PO, CSN, GE, GRN, production, dispatch, Stroke Master, Pack BOM, Material Master or GL.

## 11. AI integration point (deferred)

`buildRequirementRows` output (per-material metrics + pool / inbound traces + policy) is the intended, already-deterministic input for a later explanation / suggestion layer. Suggested Target / Critical days would be shown on the same Material Settings row with Accept / Ignore (owner B11) — not built.
