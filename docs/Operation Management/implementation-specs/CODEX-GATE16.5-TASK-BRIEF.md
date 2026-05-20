# CODEX TASK BRIEF — Gate-16.5 Inward QA Backend

**Gate:** 16.5
**Spec File:** OM-GATE-16.5-InwardQABackend-Spec.md
**Dependency:** Gate-16.4 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.5-InwardQABackend-Spec.md` in full.

## Files to Create / Modify

1. CREATE `supabase/functions/api/_core/procurement/inward_qa.handlers.ts`
2. MODIFY `supabase/functions/api/_routes/procurement.routes.ts` — add QA routes

## What to Build

Handlers: `listQADocumentsHandler`, `getQADocumentHandler`, `assignQAOfficerHandler`, `addTestLineHandler`, `updateTestLineHandler`, `deleteTestLineHandler`, `submitUsageDecisionHandler`

## Critical Business Logic

**submitUsageDecisionHandler (core):**

Input: `{ decision_lines: [{ quantity, usage_decision, storage_location_id, remarks }] }`

Validations:
- Sum of all decision_lines.quantity MUST equal qa_document.total_qty → else 400
- FOR_REPROCESS decision: `assertQAManagerRole(ctx)` → else 403
- QA doc status must be PENDING or IN_PROGRESS → else 400

For each decision line, call `post_stock_movement()`:

| Decision | Calls | Movement | Direction | Stock Type |
|---|---|---|---|---|
| RELEASE | 2 calls | P321 | OUT(QA_STOCK) then IN(UNRESTRICTED) | - |
| BLOCK | 2 calls | P344 | OUT(QA_STOCK) then IN(BLOCKED) | - |
| REJECT | 2 calls | P344 | OUT(QA_STOCK) then IN(BLOCKED) | - |
| SCRAP | 1 call | P553 | OUT(QA_STOCK) | - |
| FOR_REPROCESS | 2 calls | FOR_REPROCESS | OUT(QA_STOCK) then IN(REPROCESS) | - |

Both calls for 2-call decisions use qa_document.qa_number as document_number.

After all lines:
- INSERT all decision lines into `inward_qa_decision_line` with stock_document_id + stock_ledger_id
- Set qa_document.status → DECISION_MADE

## After Implementation — Update Log
Set Gate-16.5 items to DONE.

---
*Brief frozen: 2026-05-12*
