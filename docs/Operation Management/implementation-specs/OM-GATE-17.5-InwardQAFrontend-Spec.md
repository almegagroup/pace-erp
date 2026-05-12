# OM-GATE-17.5 — Inward QA Frontend (JSX Screens)
# PACE-ERP Operation Management — Procurement

**Gate:** 17.5
**Phase:** Operation Management — Layer 2 Frontend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.5 VERIFIED ✅ + Gate-17.4 VERIFIED ✅
**Design Reference:** Section 101 (Inward QA)

---

## 1. Screen Directory

`frontend/src/pages/dashboard/procurement/qa/`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx` | CREATE — QA officer's work queue |
| `frontend/src/pages/dashboard/procurement/qa/QADocumentPage.jsx` | CREATE — full QA document with test entry + usage decision |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | MODIFY — add QA functions |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | MODIFY |
| `frontend/src/router/AppRouter.jsx` | MODIFY |

---

## 3. `procurementApi.js` — Functions to Add

```javascript
export const listQADocuments        = (params) => fetchProcurement('GET',  '/api/procurement/qa-documents', null, params)
export const getQADocument          = (id)      => fetchProcurement('GET',  `/api/procurement/qa-documents/${id}`)
export const assignQAOfficer        = (id, data)=> fetchProcurement('POST', `/api/procurement/qa-documents/${id}/assign`, data)
export const addQATestLine          = (id, data)=> fetchProcurement('POST', `/api/procurement/qa-documents/${id}/test-lines`, data)
export const updateQATestLine       = (id, lineId, data) => fetchProcurement('PUT', `/api/procurement/qa-documents/${id}/test-lines/${lineId}`, data)
export const deleteQATestLine       = (id, lineId) => fetchProcurement('DELETE', `/api/procurement/qa-documents/${id}/test-lines/${lineId}`)
export const submitUsageDecision    = (id, data)=> fetchProcurement('POST', `/api/procurement/qa-documents/${id}/decision`, data)
```

---

## 4. Screen Specs

### `QAQueuePage.jsx`
- Route: `/dashboard/procurement/qa-queue`
- **Purpose:** QA officer's to-do list. Shows all PENDING + IN_PROGRESS QA documents.
- **Table columns:** qa_number, grn_number, material_name, total_qty, uom, assigned_to (or "Unassigned"), status badge, created_at
- **Filter:** company_id, status (PENDING/IN_PROGRESS), assigned_to (filter own work)
- **"Assign to Me" button** on unassigned rows
- Row click → QADocumentPage

### `QADocumentPage.jsx`
- Route: `/dashboard/procurement/qa-documents/:id`
- Load via `getQADocument`
- **GRN Summary** (top, read-only): grn_number, vendor_name, material_name, received_qty, storage_location, stock_type
- **Assign Section** (if PENDING): "Assign to Me" / "Assign to User" form → assignQAOfficer
- **Test Lines Section:**
  - Table of existing test lines (test_type, test_parameter, result_value, pass_fail badge)
  - "Add Test" form: test_type dropdown (VISUAL/MCT/LAB/OTHER), test_parameter text, result_value text, pass_fail radio (PASS/FAIL/PENDING)
  - Edit/Delete buttons per test line
  - Available only if status = PENDING or IN_PROGRESS
- **Usage Decision Section** (bottom, prominent):
  - Only shown if status IN ('PENDING', 'IN_PROGRESS')
  - Title: "Usage Decision — Total Qty: [total_qty] [uom]"
  - **Decision rows:** Multiple rows, each with: qty input, decision dropdown (RELEASE/BLOCK/REJECT/SCRAP/FOR_REPROCESS), storage_location_id input, remarks
  - "Add Split" button (for partial decisions)
  - Running total: "Allocated: X / Total: Y" — shows remaining qty. Submit disabled if total != total_qty.
  - FOR_REPROCESS option: shown only if user has QA_MANAGER or SA role. Hidden for QA_USER.
  - "Submit Decision" button → confirm dialog → submitUsageDecision
- **Decision Result** (shown after DECISION_MADE): Summary of all movements posted.

---

## 5. Critical UI Rules

| Rule | Detail |
|---|---|
| FOR_REPROCESS visibility | Hidden in decision dropdown for regular QA users. Show only for QA_MGR and SA. |
| Qty validation | Running total shown. Submit button disabled if allocated qty != total_qty. |
| Post confirmation | Confirm dialog: "This will post stock movements. Cannot be undone." |
| Read-only after decision | All inputs locked after DECISION_MADE. Show results only. |
| REJECT visual cue | REJECT decision row shows amber highlight: "Stock will be blocked. Available for RTV." |

---

## 6. Navigation Updates

### `operationScreens.js` — Add:
```javascript
PROC_QA_QUEUE: { name: 'PROC_QA_QUEUE', label: 'QA Queue', path: '/dashboard/procurement/qa-queue' },
```

### `AppRouter.jsx` — Add 2 routes (queue + document)

---

## 7. Verification — Claude Will Check

1. QAQueuePage filters by status PENDING/IN_PROGRESS
2. FOR_REPROCESS hidden for non-QA_MANAGER roles
3. Running total shown with submit disabled if mismatch
4. Usage decision rows support multiple splits
5. Confirm dialog before submission
6. Page locked (read-only) after DECISION_MADE
7. All 7 API functions added to procurementApi.js

---

*Spec frozen: 2026-05-12 | Reference: Section 101*
