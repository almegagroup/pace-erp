# PO22 Requirement — Legacy vs ERP Reconciliation Report

Date: 2026-10-16 · Branch: `agent/claude` · Read-only PROD inspection only (no DEV use, no PROD write).

## 1. What could and could not be reconciled

| Item | Result |
|---|---|
| Legacy sheet values (REQUIREMENT etc.) | **Not reconciled** — the Google Sheets are blocked from this environment (HTTP 403). No legacy number was compared. |
| ERP engine vs independent calculation on real PROD data | **Reconciled** for CMP011, as-of 2026-10-16 (below). |
| Policy table / save rules | Verified on a throwaway local PostgreSQL 16 with stub masters: 8 / 8 scenario checks pass (`supabase/tests/erp_planning_material_requirement_policy.test.sql`). |
| Engine rules | 20 / 20 Deno unit tests pass (`mts_requirement.logic.test.ts`). |

## 2. Real-data check — CMP011, CM = Oct-2026, as-of 16-Oct-2026

Inputs exported read-only from PROD: PO21 plan (Oct FINAL, Nov ROLLING), current stroke 0063 for both Prodshades, Pack BOM of the 40 KG SKUs, ledger stock at start of 16-Oct and October P261/P262. Plan: Prodshade 00790908 = 20,000 + 10,000 + 2,605,000 KG; Prodshade 54400908 = 410,000 KG; total 3,045,000 KG (Nov: 2,849,000 KG).

| Material | Check | Independent | Engine |
|---|---|---|---|
| DOLOMITE 240# (two stroke lines 40% + 43.35%) | Current Req | 0.8335 × 3,045,000 = 2,538,007.5 | 2,538,007.5 ✔ |
| | Req NM | 0.8335 × 2,849,000 = 2,374,641.5 | 2,374,641.5 ✔ |
| | Current Prorata | 2,538,007.5 × 16/31 = 1,309,939.35 | 1,309,939.35 ✔ |
| | CURRENT CONS. | −CONS bucket = 929,144.125 | 929,144.125 ✔ |
| | CURRENT_STOCK / QA / Blocked | 1,782,255.875 / 97,500 / 65,892 | same, QA and Blocked kept out of usable ✔ |
| WHITE CEMENT JK (group with ULTRATECH, Use Primary = Yes) | Current Req | 15% × 3,045,000 = 456,750, one pool | JK 456,750, ULTRATECH 0 ✔ (no duplication) |
| VAE DA 1100 group (DA1100 primary; RP-4099, ELOTEX, VINNAPAS members) | group pool 1.2% × 3,045,000 = 36,540 | RP-4099 2,003 (its stock at the required SLoc, drawn once) + DA1100 34,537 = 36,540 ✔ |
| RP-4099 | stock at another SLoc (55,995 at R-location, required S-location) | shown as Other SLoc (transfer), not usable ✔ |
| 40 KG woven sack (PM) | Oct outer units | 2,605,000 / 40 = 65,125 | 65,125 ✔ |

Engine status for these rows was NO_POLICY (no Tab 2 policy saved yet in PROD — the table does not exist there yet).

## 3. Known, explained ERP-vs-legacy differences (by design)

| Topic | Legacy (per brief) | ERP | Why |
|---|---|---|---|
| Today | `TODAY()` / `EOMONTH` live | user-selected as-of date | reproducible, auditable runs |
| Lead time | `MAXIFS(...) + 4` called "AVG" | same value kept as "legacy equivalent", labelled a maximum; configured and observed avg/max/P90 shown beside it | the sheet name was misleading |
| NM REQ DAYS | CMP003 15th-day condition; CMP005/011 target vs days-left | one date-aware rule clamp(Target − CM days left, 0, NM days) for all three companies | brief asks for an agreed date-aware rule; legacy formulas not readable here, so **variance cannot be quantified yet** — unit test T17 documents the ERP behaviour around the 15th (no step change) |
| Stock / consumption | RM_DATA sheet | posted ledger | ERP truth |
| Stock elsewhere | blended (legacy unknown) | only required-SLoc stock is usable; other SLoc shown as transfer candidate | owner T01 / B09 rule |
| Group materials | historic group percentages (B09 says not to reuse) | one demand pool per stroke / BOM line, stock drawn once, shortfall to procurement target | owner B09 |
| In-transit | PO qty | PO / GE / CSN / lot partition, ETA-dated; unknown ETA never counted as available | owner Q-T06 |
| MOQ | single MOQ column | MOQ + unit + source (VENDOR / COMPANY / NONE) + active flag | owner B09 |

## 4. Open items for the owner

1. **Legacy formula export** for Prorata NM, Identifier, ID2, NM REQ DAYS (both variants), Safety Day Stock, Lead time Stock, Total Stock — needed to quantify variances (see mapping doc).
2. **Initial policy import** — use Tab 2 "Import from REQUIREMENT sheet" (paste per company). The sheet does not say whether an MOQ is a vendor or company MOQ, so the importer requires the user to choose; nothing is assumed.
3. **Cross-company production allocation** has no storage in PO21 yet — PO22 explodes all demand with the plan company's own masters and says so.
4. **ACL decision** — the provisioning SQL proposes: page VIEW for everyone who has PO21; Material Settings edit for PO21 full-access users (SCM / Director / ACL-MASTER). Owner to confirm before it is run.
5. **Litre-base SKU in CMP003** needs a fixed L→KG master conversion, otherwise its RM/PM demand is reported as an exception.
