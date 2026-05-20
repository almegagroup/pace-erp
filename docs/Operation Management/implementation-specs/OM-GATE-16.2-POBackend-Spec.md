# OM-GATE-16.2 — Purchase Order Backend (TypeScript Handlers)
# PACE-ERP Operation Management — Procurement

**Gate:** 16.2
**Phase:** Operation Management — Layer 2 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.1 VERIFIED ✅
**Design Reference:** Section 85.2, 87.2–87.12, Section 88.2 (CSN auto-create on PO confirm)

---

## 1. What You Are Building

TypeScript handlers for the full Purchase Order lifecycle:
- PO CRUD
- PO Amendment (with approval flag)
- PO Approval workflow
- PO Cancellation
- PO Knock-off (line or full)
- CSN auto-creation on PO confirm (trigger in confirm handler)

Add to: `supabase/functions/api/_routes/procurement.routes.ts`
Create: `supabase/functions/api/_core/procurement/po.handlers.ts`

---

## 2. Files to Create / Modify

| File | Action |
|---|---|
| `supabase/functions/api/_core/procurement/po.handlers.ts` | CREATE |
| `supabase/functions/api/_routes/procurement.routes.ts` | MODIFY — add PO routes |

---

## 3. Handler List

Schema: `erp_procurement`

### PO CRUD

| Function | Route | Description |
|---|---|---|
| `createPOHandler` | `POST:/api/procurement/purchase-orders` | Create PO in DRAFT. company_id from body. Validates: vendor exists in vendor_master, cost_center_id present on every line, delivery_type CHECK, incoterm required for IMPORT POs. Auto-sets: po_number via generate_doc_number('PO'). |
| `listPOsHandler` | `GET:/api/procurement/purchase-orders` | List POs. Filters: company_id, status, vendor_id, date range. Pagination. |
| `getPOHandler` | `GET:/api/procurement/purchase-orders/:id` | Get PO with all lines, approval log, amendment log |
| `updatePOHandler` | `PUT:/api/procurement/purchase-orders/:id` | Update DRAFT PO header/lines. Not allowed if status != DRAFT. |
| `deletePOHandler` | `DELETE:/api/procurement/purchase-orders/:id` | Delete DRAFT PO only. Not allowed if any lines have GRN qty > 0. |

### PO Confirm

| Function | Route | Description |
|---|---|---|
| `confirmPOHandler` | `POST:/api/procurement/purchase-orders/:id/confirm` | Transitions DRAFT → PENDING_APPROVAL (if approval required) OR → CONFIRMED (if not). On CONFIRMED: auto-create one CSN per PO line (see CSN auto-create logic below). |

**CSN auto-create logic (inside confirmPOHandler):**
- For each PO line: INSERT into `erp_procurement.consignment_note`
  - `csn_type` = 'IMPORT' if po.delivery_type = 'IMPORT' / 'DOMESTIC' if domestic / 'BULK' if delivery_type IN ('BULK','TANKER')
  - `po_id` = PO id, `po_line_id` = line id
  - `status` = 'ORDERED'
  - `quantity` = PO line quantity
  - `material_id` = line material_id
  - `company_id` = PO company_id
  - `csn_number` via `generate_doc_number('CSN')`
  - All other fields NULL (Procurement fills later)

### PO Approval

| Function | Route | Description |
|---|---|---|
| `approvePOHandler` | `POST:/api/procurement/purchase-orders/:id/approve` | PROC_HEAD role required. PENDING_APPROVAL → CONFIRMED. Inserts into po_approval_log (action='APPROVED'). On CONFIRMED: triggers CSN auto-create (same as confirmPOHandler). |
| `rejectPOHandler` | `POST:/api/procurement/purchase-orders/:id/reject` | PROC_HEAD role required. PENDING_APPROVAL → DRAFT. Inserts into po_approval_log (action='REJECTED'). remarks mandatory. |

### PO Amendment

| Function | Route | Description |
|---|---|---|
| `amendPOHandler` | `PUT:/api/procurement/purchase-orders/:id/amend` | Amend CONFIRMED or PENDING_AMENDMENT PO. If amended fields include rate or quantity → `requires_approval=true`, status → PENDING_AMENDMENT. Otherwise → free amendment, no status change. Always inserts into po_amendment_log. Allowed fields: rate, quantity, delivery_date, incoterm, payment_term_id, cost_center_id, remarks. NOT allowed: vendor_id, material_id (line-level). |
| `approveAmendmentHandler` | `POST:/api/procurement/purchase-orders/:id/approve-amendment` | PROC_HEAD role required. PENDING_AMENDMENT → CONFIRMED. Inserts approval log. |

### PO Cancellation

| Function | Route | Description |
|---|---|---|
| `cancelPOHandler` | `POST:/api/procurement/purchase-orders/:id/cancel` | Cancel PO. No approval required. Condition: zero GRN qty across ALL lines. If any line has grn_received_qty > 0 → 400 error. Cancellation reason mandatory. CONFIRMED → CANCELLED. Cancels all associated ORDERED CSNs (status → CANCELLED). |

### PO Knock-off

| Function | Route | Description |
|---|---|---|
| `knockOffPOLineHandler` | `POST:/api/procurement/purchase-orders/:id/lines/:line_id/knock-off` | Close individual PO line. Reason mandatory. line_status → CLOSED. If all lines CLOSED → PO status → CLOSED. |
| `knockOffPOHandler` | `POST:/api/procurement/purchase-orders/:id/knock-off` | Knock-off entire PO (all remaining OPEN lines). Reason mandatory. PO status → CLOSED. |

### PO Last-Used helpers (used internally by other handlers)

| Function | (internal) | Description |
|---|---|---|
| `getLastUsedIncoterm` | internal | SELECT incoterm FROM purchase_order WHERE vendor_id=? AND status IN ('CONFIRMED','CLOSED') ORDER BY confirmed_at DESC LIMIT 1 |
| `getLastUsedPaymentTerm` | internal | Same pattern for payment_term_id |

---

## 4. Business Rules

| Rule | Detail |
|---|---|
| PO number format | `generate_doc_number('PO')` — global pure numeric. NOT company-prefixed at this stage. |
| Approved Source List hard block | Before saving PO line: check `erp_procurement.vendor_material_info` where vendor_id + material_id → must exist AND `asl_status = 'APPROVED'`. If not found → 400 error. |
| Cost Center mandatory | Every PO line must have `cost_center_id`. 400 if missing. |
| Incoterm required | Import POs: `incoterm` mandatory on header. Domestic: not required. |
| Amendment scope | Rate OR qty change → requires_approval = true. Delivery date, remarks, cost_center, incoterm, payment_term → no approval. |
| Cancel condition | NO GRN qty posted against any line. Zero = any grn_received_qty > 0 blocks cancellation. |
| Company scope | Handlers filter all queries by company_id from request body. Users only see their company's POs. |
| Audit | Every state change → insert into po_approval_log or po_amendment_log. |

---

## 5. Verification — Claude Will Check

1. `createPOHandler` checks ASL hard block before INSERT
2. `createPOHandler` validates cost_center_id present on every line
3. `confirmPOHandler` auto-creates one CSN per PO line (not per PO)
4. CSN type correctly derived from PO delivery_type
5. `approvePOHandler` requires PROC_HEAD role check
6. `amendPOHandler` sets requires_approval=true only for rate/qty changes
7. `cancelPOHandler` blocks if any line has grn_received_qty > 0
8. `cancelPOHandler` cancels associated ORDERED CSNs
9. All handlers write to appropriate audit log tables
10. All routes added to `procurement.routes.ts`

---

*Spec frozen: 2026-05-12 | Reference: Sections 85.2, 87.2–87.12, 88.2*
