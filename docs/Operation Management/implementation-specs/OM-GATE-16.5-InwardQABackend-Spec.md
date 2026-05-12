# OM-GATE-16.5 — Inward QA Backend (TypeScript Handlers)
# PACE-ERP Operation Management — Procurement

**Gate:** 16.5
**Phase:** Operation Management — Layer 2 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.4 VERIFIED ✅
**Design Reference:** Section 101 (Inward QA full design)

---

## 1. What You Are Building

Inward QA lifecycle handlers: document management, test result entry, usage decision engine with stock movements.

Create: `supabase/functions/api/_core/procurement/inward_qa.handlers.ts`
Modify: `supabase/functions/api/_routes/procurement.routes.ts`

---

## 2. Handler List

Schema: `erp_procurement.inward_qa_document` + `erp_procurement.inward_qa_test_line` + `erp_procurement.inward_qa_decision_line`

### QA Document Management

| Function | Route | Description |
|---|---|---|
| `listQADocumentsHandler` | `GET:/api/procurement/qa-documents` | List QA documents. Filters: company_id, status, grn_id. Status 'PENDING' and 'IN_PROGRESS' shown in QA queue. |
| `getQADocumentHandler` | `GET:/api/procurement/qa-documents/:id` | Get full QA document with test lines and decision lines. |
| `assignQAOfficerHandler` | `POST:/api/procurement/qa-documents/:id/assign` | Assign QA officer (assigned_to field). Status PENDING → IN_PROGRESS. |

### Test Results

| Function | Route | Description |
|---|---|---|
| `addTestLineHandler` | `POST:/api/procurement/qa-documents/:id/test-lines` | Add test line. Fields: test_type (VISUAL/MCT/LAB/OTHER), test_parameter, result_value, pass_fail, remarks. Only allowed if QA doc status = PENDING or IN_PROGRESS. |
| `updateTestLineHandler` | `PUT:/api/procurement/qa-documents/:id/test-lines/:line_id` | Update test line result. |
| `deleteTestLineHandler` | `DELETE:/api/procurement/qa-documents/:id/test-lines/:line_id` | Delete test line. Only if decision not yet made. |

### Usage Decision Engine

| Function | Route | Description |
|---|---|---|
| `submitUsageDecisionHandler` | `POST:/api/procurement/qa-documents/:id/decision` | Core handler. Takes usage_decision_lines[] — one per qty split. Validates, posts stock movements, updates QA doc status. See logic below. |

---

## 3. Usage Decision Logic (inside `submitUsageDecisionHandler`)

Each decision line in the request has:
```
{
  quantity: numeric,
  usage_decision: 'RELEASE' | 'BLOCK' | 'REJECT' | 'SCRAP' | 'FOR_REPROCESS',
  storage_location_id: uuid,
  remarks?: string
}
```

**Validations:**
- Sum of all decision line quantities = QA document's total_qty. If not → 400 error.
- FOR_REPROCESS decision → requires `assertQAManagerRole()`. Regular QA users cannot use this.
- Decision allowed only if QA doc status IN ('PENDING', 'IN_PROGRESS').

**For each decision line:**

| Decision | Movement | From Stock Type | To Stock Type | Direction |
|---|---|---|---|---|
| RELEASE | P321 | QA_STOCK | UNRESTRICTED | OUT(QA) + IN(UNRESTRICTED) |
| BLOCK | P344 | QA_STOCK | BLOCKED | OUT(QA) + IN(BLOCKED) |
| REJECT | P344 | QA_STOCK | BLOCKED | OUT(QA) + IN(BLOCKED) — then flagged for RTV |
| SCRAP | P553 | QA_STOCK | SCRAPPED | OUT(QA) — inventory destroyed |
| FOR_REPROCESS | FOR_REPROCESS movement | QA_STOCK | special | OUT(QA) + IN(REPROCESS) |

**For RELEASE, BLOCK, REJECT, FOR_REPROCESS:** two post_stock_movement calls:
1. OUT from QA_STOCK (direction=OUT, movement_type=P321/P344/etc, stock_type=QA_STOCK)
2. IN to target stock type (direction=IN, stock_type=target)
Both with same document_number = qa_number.

**For SCRAP:** one post_stock_movement call (OUT only — stock destroyed).

**After all decision lines processed:**
- INSERT all decision lines into `erp_procurement.inward_qa_decision_line` with returned stock_document_id, stock_ledger_id
- QA document status → DECISION_MADE
- If any REJECT decision → flag GRN line / QA doc for RTV (set a `rtv_pending = true` flag or similar for RTV queue)

---

## 4. Business Rules

| Rule | Detail |
|---|---|
| QA auto-create | Done in Gate-16.4 (postGRNHandler). Here we manage existing QA docs. |
| Qty validation | Sum of decision qtys must equal qa_document.total_qty exactly. |
| FOR_REPROCESS guard | assertQAManagerRole() required. Regular QA user → 403. |
| Partial decision | Multiple decision lines with different usages allowed. E.g., 100 KG RELEASE + 50 KG REJECT. |
| REJECT → RTV queue | REJECT stock goes to BLOCKED. System flags it for RTV. Actual RTV document created in Gate-16.7. |
| No re-decision | Once DECISION_MADE, QA document is read-only. No re-decision allowed without reversal (Phase-2 feature). |
| Company scope | Only QA docs for user's company shown. |

---

## 5. Verification — Claude Will Check

1. `submitUsageDecisionHandler` validates sum of qty = total_qty
2. FOR_REPROCESS requires assertQAManagerRole
3. RELEASE calls post_stock_movement twice (OUT from QA + IN to UNRESTRICTED)
4. SCRAP calls post_stock_movement once (OUT only)
5. stock_document_id + stock_ledger_id stored on each decision line
6. QA doc status → DECISION_MADE after successful submission
7. All routes added to procurement.routes.ts

---

*Spec frozen: 2026-05-12 | Reference: Section 101*
