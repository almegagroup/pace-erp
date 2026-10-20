# PO21 / PO22 Owner Training — Lesson Progress (resume point for any agent)

**Started:** 2026-10-20 · **Trainer:** Claude (owner-assigned) · **Language:** Bengali, ERP labels in English.
**PROD revision at start:** `main` = `892bfeb` (PR almegagroup/pace-erp#680), ACL CMP003 v134 / CMP005 v30 / CMP011 v30.

## Rules (owner, 2026-10-20)
- One lesson at a time, in the business sequence below. Exact page / tab / button / field each time.
- Read-only by default. Any save or operational change: explain consequences and get owner approval first.
- A lesson is COMPLETED **only** when the owner writes "বুঝেছি, পরেরটা শেখাও।" — a screenshot is not completion.
- If Claude resets or another agent takes over: resume from the **first lesson not marked COMPLETED**.

## Sequence
PO21: 1 Company & Plan Month · 2 Plan Entry · 3 FINAL / ROLLING / ADDITIONAL / URGENT · 4 SKU & ProdShade ·
5 Stroke Master & effective dates · 6 Use Primary & material groups · 7 Pack BOM & quantities ·
8 Cross-company production · 9 Save, edit, versioning & reports · 10 Production & Dispatch reporting ·
11 How the effective plan reaches PO22.
PO22: 12 Company, month & as-of · 13 Requirement Report · 14 Material Settings · 15 Stock & Cost Settings ·
16 Planning · 17 Daily planning, allocation, vendor & lot · 18 PO By, ETA & future CSN · 19 Explain with AI ·
20 Store Report · 21 End-to-end scenario & reconciliation.

## Lesson log
| # | Topic | Page / control | Owner questions → answers | Confirmed? | Issues found | Next |
|---|---|---|---|---|---|---|
| 1 | PO21 Company & Plan Month | Procurement → PO21 MTS Customer Plan: Company selector, Plan Month, tab buttons, Product Group button, Access line | — | IN PROGRESS (taught 2026-10-20, awaiting confirmation) | — | Lesson 2 Plan Entry (only after confirmation) |

## Issues raised during training
| Date | Issue | Status |
|---|---|---|
| 2026-10-20 | PO22 Explain with AI → 503 `AI_BUDGET_UNAVAILABLE`. Root cause (PROD postgres log 03:57:57Z): `permission denied for table mts_ai_usage` — migration `20261019150000` granted service_role only SELECT; `reserve_mts_ai_budget` (not SECURITY DEFINER) needs INSERT + UPDATE. Header "Last sync failed \| Saving planning / AI explain" is the same request (label built from URL), not a separate planning-save failure. Fix (owner-authorized): migration `20261020150000` GRANT INSERT, UPDATE + handler logs real DB error + regression test; PR almegagroup/pace-erp#682 merged, PROD verified INSERT/UPDATE = true. | FIXED IN PROD — awaiting owner's live Explain-with-AI click to confirm |
