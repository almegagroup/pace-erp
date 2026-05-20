# OM-GATE-16.4 — Gate Entry + Inbound Gate Exit + GRN Backend
# PACE-ERP Operation Management — Procurement

**Gate:** 16.4
**Phase:** Operation Management — Layer 2 Backend
**Status:** FROZEN — Ready for implementation
**Dependency:** Gate-16.3 VERIFIED ✅
**Design Reference:** Section 88.1 (GE redesign), Section 87.7 (weighbridge), Section 87.8 (backdating), Section 93 (GRN), Section 102 (Gate Exit)

---

## 1. What You Are Building

Gate Entry (GE) + Inbound Gate Exit + GRN handlers.
Key: GRN posting calls `erp_inventory.post_stock_movement()` RPC.

Create: `supabase/functions/api/_core/procurement/gate_entry.handlers.ts`
Create: `supabase/functions/api/_core/procurement/grn.handlers.ts`
Modify: `supabase/functions/api/_routes/procurement.routes.ts`

---

## 2. Handler List

### Gate Entry

Schema: `erp_procurement.gate_entry` + `erp_procurement.gate_entry_line`

| Function | Route | Description |
|---|---|---|
| `createGateEntryHandler` | `POST:/api/procurement/gate-entries` | Create GE header + lines. ge_number via `generate_doc_number('GE')`. Backdating allowed — `entry_date` from body, system_created_at = now(). Each line must reference a valid PO line (intra-schema FK through gate_entry_line). Company-scoped: only open CSNs for this company shown. |
| `listGateEntriesHandler` | `GET:/api/procurement/gate-entries` | List GEs. Filters: company_id, status, date range. |
| `getGateEntryHandler` | `GET:/api/procurement/gate-entries/:id` | Get GE with lines + linked CSN info. |
| `updateGateEntryHandler` | `PUT:/api/procurement/gate-entries/:id` | Update OPEN GE only. Status OPEN only. |
| `listOpenCSNsForGEHandler` | `GET:/api/procurement/gate-entries/open-csns` | Company-scoped list of CSNs with status IN ('ORDERED','IN_TRANSIT','ARRIVED') for GE line selection dropdown. Filter: company_id. |

**GE Create validation:**
- Each line: validate that referenced `po_line_id` exists and is OPEN
- If PO delivery_type IN ('BULK','TANKER'): `gross_weight` mandatory on header
- ge_type = 'INBOUND_PO' (default) or 'INBOUND_STO' (if sto_id provided on line)
- Set linked CSN status → ARRIVED (if CSN was IN_TRANSIT)

### Inbound Gate Exit

Schema: `erp_procurement.gate_exit_inbound`

| Function | Route | Description |
|---|---|---|
| `createGateExitInboundHandler` | `POST:/api/procurement/gate-exits/inbound` | Create Gate Exit for a GE. ONE per GE (UNIQUE constraint on gate_entry_id). `tare_weight` mandatory for BULK/TANKER. `net_weight_calculated` = ge.gross_weight - tare_weight (auto). User can set `net_weight_override` if weighbridge differs. gex_number via `generate_doc_number('GEX')`. |
| `getGateExitInboundHandler` | `GET:/api/procurement/gate-exits/inbound/:id` | Get gate exit with calculated net weight. |

### GRN

Schema: `erp_procurement.goods_receipt` + `erp_procurement.goods_receipt_line`

| Function | Route | Description |
|---|---|---|
| `createGRNDraftHandler` | `POST:/api/procurement/grns` | Create GRN in DRAFT. ONE per GE. grn_number via `generate_doc_number('GRN')`. Lines auto-loaded from GE lines. For BULK/TANKER: default received_qty = net_weight from Gate Exit. |
| `listGRNsHandler` | `GET:/api/procurement/grns` | List GRNs. Filters: company_id, status, vendor_id, date range. |
| `getGRNHandler` | `GET:/api/procurement/grns/:id` | Get GRN with lines, linked GE, PO info. |
| `updateGRNDraftHandler` | `PUT:/api/procurement/grns/:id` | Update DRAFT GRN lines (received_qty, storage_location_id, batch_number, expiry_date, target_stock_type). Not allowed if POSTED. |
| `postGRNHandler` | `POST:/api/procurement/grns/:id/post` | Post GRN. Triggers all stock + cascade updates (see Post GRN logic). |
| `reverseGRNHandler` | `POST:/api/procurement/grns/:id/reverse` | Reverse a POSTED GRN. Creates reversal stock movement (P102). Requires reversal_reason. Cascades: resets PO line balance, CSN status. |

---

## 3. Post GRN Logic (inside `postGRNHandler`)

This is the most critical handler. Must execute atomically via DB transaction or sequential calls.

**For each GRN line:**
1. Call `erp_inventory.post_stock_movement()` with:
   - `p_document_number` = grn_number (same number for all lines — or grn_number + line suffix)
   - `p_movement_type_code` = 'P101' (standard GRN) or 'STO_RECEIPT' (if sto_id present)
   - `p_direction` = 'IN'
   - `p_stock_type_code` = line.target_stock_type ('QA_STOCK' if material has qa_required=true, else 'UNRESTRICTED')
   - `p_unit_value` = PO rate (po_line.rate)
   - Returns: { stock_document_id, stock_ledger_id }
2. Store returned IDs on goods_receipt_line: `stock_document_id`, `stock_ledger_id`

**After all lines posted:**
3. GRN status → POSTED
4. Update PO line: `grn_received_qty` += received_qty. If grn_received_qty >= ordered_qty → po_line.status = FULLY_DELIVERED
5. Update CSN: status → GRN_DONE. Set `grn_id` on CSN.
6. Update gate_entry_line: `grn_posted = true`
7. Update vendor_material_info: `last_purchase_price` = PO rate (last price update)

**QA auto-create:** If material has qa_required = true → auto-INSERT into `erp_procurement.inward_qa_document`:
- `grn_id` = this GRN id
- `status` = 'PENDING'
- qa_number via `generate_doc_number('QA')`

---

## 4. GRN Reversal Logic (inside `reverseGRNHandler`)

For each POSTED GRN line:
1. Call `post_stock_movement()` with:
   - `p_movement_type_code` = 'P102'
   - `p_direction` = 'OUT' (reverse the IN)
   - `p_reversal_of_id` = original stock_document_id
2. GRN status → REVERSED. Store `reversal_grn_id` on original GRN.
3. Reset PO line: `grn_received_qty` -= reversed qty
4. Reset CSN: status → ARRIVED (back from GRN_DONE)
5. Void QA document if auto-created (status → CANCELLED)

---

## 5. Business Rules

| Rule | Detail |
|---|---|
| One GRN per GE | UNIQUE constraint enforced in DB. Handler also checks before INSERT. |
| Gate Exit required | Before GRN can be created: gate_exit_inbound must exist for this GE. |
| BULK/TANKER default qty | GRN received_qty defaults to net_weight_calculated (or override) from Gate Exit. |
| Storage Location mandatory | Every GRN line must have storage_location_id before posting. 400 if missing. |
| Discrepancy field | `qty_discrepancy = ge_line.received_qty - grn_line.received_qty`. Store on GRN line. Auto-calc on GRN post. |
| Backdating | GRN `grn_date` from body (backdating allowed). `system_created_at` = now(). |
| Reversal requires approval | Not in Phase-1 — handler allows reversal without approval. Add `reversal_approved_by` field. |

---

## 6. Verification — Claude Will Check

1. `createGRNDraftHandler` blocks creation if gate_exit_inbound missing for the GE
2. `postGRNHandler` calls `post_stock_movement()` RPC for each line
3. `postGRNHandler` auto-creates inward_qa_document if material qa_required = true
4. `postGRNHandler` updates vendor_material_info.last_purchase_price
5. `postGRNHandler` sets gate_entry_line.grn_posted = true
6. `postGRNHandler` updates PO line grn_received_qty
7. `postGRNHandler` sets CSN status → GRN_DONE
8. `reverseGRNHandler` calls post_stock_movement with P102 + direction=OUT
9. `reverseGRNHandler` voids QA document
10. BULK/TANKER default qty logic present

---

*Spec frozen: 2026-05-12 | Reference: Sections 88.1, 87.7, 87.8, 93, 102*
