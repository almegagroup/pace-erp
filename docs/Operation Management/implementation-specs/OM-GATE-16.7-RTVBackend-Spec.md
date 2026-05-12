# OM-GATE-16.7 — RTV + Debit Note + Exchange Reference Backend
# PACE-ERP Operation Management — Procurement

**Gate:** 16.7
**Phase:** Operation Management — Layer 2 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.5 VERIFIED ✅ (QA → BLOCKED stock exists before RTV)
**Design Reference:** Section 98 (RTV full design), Section 98.5 (settlement modes)

---

## 1. What You Are Building

Return to Vendor lifecycle: RTV document, stock movement (P122), Gate Exit, and settlement tracking (Debit Note / Next Invoice Adjust / Exchange Reference).

Create: `supabase/functions/api/_core/procurement/rtv.handlers.ts`
Modify: `supabase/functions/api/_routes/procurement.routes.ts`

---

## 2. Handler List

### RTV

Schema: `erp_procurement.return_to_vendor` + `erp_procurement.return_to_vendor_line`

| Function | Route | Description |
|---|---|---|
| `createRTVHandler` | `POST:/api/procurement/rtvs` | Create RTV from BLOCKED stock. rtv_number via `generate_doc_number('RTV')`. Must reference a GRN (grn_id). settlement_mode: DEBIT_NOTE / NEXT_INVOICE_ADJUST / EXCHANGE. reason_category mandatory. |
| `listRTVsHandler` | `GET:/api/procurement/rtvs` | List RTVs. Filters: company_id, status, vendor_id, settlement_mode. |
| `getRTVHandler` | `GET:/api/procurement/rtvs/:id` | Get RTV with lines + settlement document (DN/Exchange if exists). |
| `addRTVLineHandler` | `POST:/api/procurement/rtvs/:id/lines` | Add RTV line. Must reference grn_line_id. Validates: stock available in BLOCKED type for this material + storage location. |
| `postRTVHandler` | `POST:/api/procurement/rtvs/:id/post` | Post RTV. For each line: call post_stock_movement (P122, OUT, BLOCKED stock_type). Set RTV status → DISPATCHED. Auto-create Gate Exit Outbound (exit_type='RTV'). |

### RTV — Direct from UNRESTRICTED (non-QA path)

For RTV triggered directly (vendor delivered wrong item, no QA rejection):
`postRTVHandler` checks: if source stock_type = UNRESTRICTED AND rtv_line.stock_type_override = 'DIRECT':
1. First call post_stock_movement (P344, OUT UNRESTRICTED, IN BLOCKED) — block the stock
2. Then call post_stock_movement (P122, OUT BLOCKED) — RTV movement

### Debit Note

Schema: `erp_procurement.debit_note`

| Function | Route | Description |
|---|---|---|
| `createDebitNoteHandler` | `POST:/api/procurement/debit-notes` | Create Debit Note for RTV with settlement_mode=DEBIT_NOTE. dn_number via `generate_doc_number('DN')`. Value = material_cost + proportional landed cost (if landed cost exists for this GRN). |
| `listDebitNotesHandler` | `GET:/api/procurement/debit-notes` | Filters: company_id, vendor_id, status. |
| `getDebitNoteHandler` | `GET:/api/procurement/debit-notes/:id` | Get DN with RTV reference and cost breakdown. |
| `markDebitNoteSentHandler` | `POST:/api/procurement/debit-notes/:id/mark-sent` | Status DRAFT → SENT. Records sent date. |
| `acknowledgeDebitNoteHandler` | `POST:/api/procurement/debit-notes/:id/acknowledge` | Vendor acknowledged. SENT → ACKNOWLEDGED. |
| `settleDebitNoteHandler` | `POST:/api/procurement/debit-notes/:id/settle` | ACKNOWLEDGED → SETTLED. Records settlement_date. |

### Exchange Reference

Schema: `erp_procurement.exchange_reference`

| Function | Route | Description |
|---|---|---|
| `createExchangeRefHandler` | `POST:/api/procurement/exchange-refs` | Create Exchange Reference for RTV with settlement_mode=EXCHANGE. exchange_ref_number via `generate_doc_number('EXR')`. Status PENDING. Links replacement GRN when received. |
| `listExchangeRefsHandler` | `GET:/api/procurement/exchange-refs` | Filters: company_id, rtv_id, status. |
| `linkReplacementGRNHandler` | `PUT:/api/procurement/exchange-refs/:id/link-grn` | When replacement goods arrive and GRN is posted: set replacement_grn_id on exchange_reference. Status → COMPLETED. |

---

## 3. Debit Note Value Calculation (inside `createDebitNoteHandler`)

```
material_value = sum(rtv_line.quantity × rtv_line.po_rate)

If landed cost exists for this GRN:
  proportional_lc = sum(lc_line.amount) × (return_qty / grn_total_qty)
  -- Each LC line amount proportional to returned qty vs total received

If freight_term = 'FOR':
  vendor_bears_freight = 0  (vendor delivered — freight not in DN)
If freight_term = 'FREIGHT_SEPARATE':
  include proportional freight in DN

total_dn_value = material_value + proportional_lc (per freight_term rule)
```

Store breakdown fields on debit_note:
- `material_value`, `freight_value`, `insurance_value`, `customs_duty_value`, `other_lc_value`, `total_value`

---

## 4. Business Rules

| Rule | Detail |
|---|---|
| RTV only from BLOCKED | postRTVHandler: validate stock_type = BLOCKED before posting. Exception: DIRECT path (see above). |
| GRN reference mandatory | RTV must reference a GRN. Cannot create standalone RTV. |
| P122 movement | RTV movement code = P122. Always. movement_type_code DEFAULT 'P122' CHECK = 'P122' (already in DB). |
| Gate Exit auto-created | postRTVHandler auto-creates gate_exit_outbound (exit_type='RTV', rtv_id). |
| Debit Note — DEBIT_NOTE mode only | createDebitNoteHandler validates: rtv.settlement_mode = 'DEBIT_NOTE'. |
| Exchange — EXCHANGE mode only | createExchangeRefHandler validates: rtv.settlement_mode = 'EXCHANGE'. |
| Next Invoice Adjust | settlement_mode = NEXT_INVOICE_ADJUST: no separate document. Tracked as pending credit on vendor. IV handler reduces invoice amount by pending credit (Phase-2 feature — tracked but not auto-applied in Phase-1). |

---

## 5. Verification — Claude Will Check

1. `postRTVHandler` calls post_stock_movement with P122 + OUT + BLOCKED
2. `postRTVHandler` auto-creates gate_exit_outbound (exit_type='RTV')
3. Direct-from-UNRESTRICTED path: two movements (P344 then P122)
4. `createDebitNoteHandler` validates settlement_mode = DEBIT_NOTE
5. `createDebitNoteHandler` calculates proportional landed cost if LC exists for GRN
6. `createExchangeRefHandler` validates settlement_mode = EXCHANGE
7. `linkReplacementGRNHandler` sets replacement_grn_id + status COMPLETED
8. All routes added to procurement.routes.ts

---

*Spec frozen: 2026-05-12 | Reference: Section 98, 98.5*
