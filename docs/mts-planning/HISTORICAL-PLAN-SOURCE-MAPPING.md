# Historical MTS Plan Source Mapping — Drive discovery (2026-10-14)
Status: SOURCE IDENTIFIED, schema/row QA pending. Documentation only. No import or database write performed.

## Source root
Google Drive folder: NEW G-SHEET FOR PLANT OPS (id `1tlUpViVN6b1ZEyTa1HHkbDXU2FmhBn4N`).

| Company | Folder | REPORTS_ALL native Google Sheet ID |
|---|---|---|
| CMP003 Surface | SURFACE-OPERATIONS (`10pXTQOvJtil_aoUJVF9fWP2MVkWxBiDe`) | `1lm-FpAWzgECOb4PM7AIX8-1q9gUI10flqQmB17qAKgg` |
| CMP011 Jayashree | JAYASHREE-OPERATIONS (`1tnOIGNzYxis7VVmRbpSWSKJNaidXteXU`) | `1z0Ikk0zSiPISJaAQKWFZuRSftA7-rOX4hLZ5LLozhLQ` |
| CMP005 Almega Coatings Assam | ALMEGA COATING ASSAM (`19UKBxaZ2immpwa2TvPy3mKoW-0zrpsyi`) | `18SQHKF014io2Oj0FgZaFOfmpWfQCVQPfQEXQp8vuT_M` |

## Source tabs verified
All three sheets contain `PLAN` and `PLAN/PRD`.
- `PLAN/PRD`: SKU-wise rows; 3rd header row columns A:L: CLUB1, TYPE, TYPE, CLUB, UNIT, AREA, LOCATION, SKU, SKU, PROD SHADE, PACK, DESCRIPTION. Column C distinguishes `PLAN`, `PRD`, `TOTAL PLAN`, `TOTAL PRD`. Monthly numeric data begins at M (Jan 2024) across subsequent months. Same SKU generally has adjacent PLAN and PRD rows; totals must be excluded. Jan 2027 is also present, outside historical cutoff.
- `PLAN`: Prodshade-only month summary with A=PROD_SHADE, B=DESCRIPTION and months from C (Jan 2024). This is NOT SKU-level source; use only as tie-out against sum of appropriately scoped SKU PLAN rows, not as another import stream.
- `REQUIREMENT`/`PLANNING`: distinct planning calculations, NOT authoritative historical customer SKU plan source without further proof.

## Proposed extraction & reconciliation contract (not yet implemented)
1. Read `PLAN/PRD` rows with column C exactly `PLAN`; resolve SKU from H/I against existing company-appropriate SKU masters, preserving exact strings including leading zeros; J = Prodshade reference; K = pack, L = description. Flag H/I mismatch and duplicate SKU keys rather than guessing. Preserve original cell provenance (Drive ID, tab, row, month column, extraction timestamp, raw quantity).
2. Historical window at most 2024-01 through **2026-09 inclusive**, and only months with real source entries. Per B01 import as historical `FINAL` with `source=LEGACY_GOOGLE_SHEETS`; do not synthesise historical Rolling or overwrite Oct 2026 onward ERP plans. Distinguish true `0` from source `blank`.
3. `PRD` rows are **historical production actuals**, not customer-plan quantities; stage separately for plan-vs-production calibration/history. Do NOT insert PRD values in customer-plan table, do NOT replace posted ERP actuals and do NOT double count in overlap periods.
4. Verify quantities' UoM in source (values appear possibly MT; **not confirmed**), SKU identity (H vs I sometimes differ in leading zeros), Prodshade linkage and multi-row SUMs before any import.
5. Validate against `PLAN` totals by company/month/Prodshade, recording discrepancies and unmapped rows; avoid accidental aggregation across Segment/Area and zero/blank ambiguity.
6. Use idempotent fingerprints for company + source-file/tab + source row + month + plan type, and versioned revisions/audit. All writes require separately approved `erp_planning` schema, importer, ACL, staging and release plan.

## No-write gate
This document is source discovery only. No Supabase insert/update, migration, Google Sheet edit, deployment or PR merge is authorised.
