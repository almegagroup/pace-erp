# CODEX TASK BRIEF — Gate-13.8
# RTV + Debit Note + Exchange + Landed Cost + Invoice Verification

---

## Step 1 — Read These Files First

Read both files completely before writing any code:
1. `docs/Operation Management/implementation-specs/OM-GATE-13.8-RTV-InvoiceVerification-DB-Spec.md`
2. `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` (Gate-13.8 section)

---

## Step 2 — What You Are Building

5 migration files in `supabase/migrations/` for the `erp_procurement` schema:

| File-ID | File | Tables |
|---|---|---|
| 13.8.1 | 20260511080000_gate13_8_13_8_1_create_return_to_vendor.sql | return_to_vendor, return_to_vendor_line |
| 13.8.2 | 20260511081000_gate13_8_13_8_2_create_debit_note_exchange.sql | debit_note, exchange_reference |
| 13.8.3 | 20260511082000_gate13_8_13_8_3_create_landed_cost.sql | landed_cost, landed_cost_line |
| 13.8.4 | 20260511083000_gate13_8_13_8_4_create_invoice_verification.sql | invoice_verification, invoice_verification_line |
| 13.8.5 | 20260511084000_gate13_8_13_8_5_create_indexes.sql | All indexes + grants |

---

## Step 3 — Files to Create

Copy the SQL exactly as written in the spec. Do NOT modify field names, CHECK values, or constraint structure.

Each file must begin with the exact file header from the spec:
```sql
/*
 * File-ID: 13.8.X
 * File-Path: supabase/migrations/20260511HHMMSS_gate13_8_13_8_X_description.sql
 * Gate: 13.8
 * Phase: 13
 * Domain: PROCUREMENT
 * Purpose: <from spec>
 * Authority: Backend
 */
```

---

## Step 4 — Critical Rules (Do Not Violate)

1. **Cross-schema = plain uuid, NO REFERENCES:**
   - company_id, vendor_id, material_id, storage_location_id, cha_id — all plain uuid
   - stock_document_id, stock_ledger_id — plain uuid NULL (cross-schema to erp_inventory)

2. **Intra-schema FKs are correct** — all tables in erp_procurement:
   - return_to_vendor: grn_id → goods_receipt(id), po_id → purchase_order(id)
   - return_to_vendor_line: rtv_id → return_to_vendor(id), grn_line_id → goods_receipt_line(id)
   - debit_note: rtv_id → return_to_vendor(id)
   - exchange_reference: rtv_id → return_to_vendor(id), replacement_grn_id → goods_receipt(id)
   - landed_cost: grn_id → goods_receipt(id), csn_id → consignment_note(id), po_id → purchase_order(id)
   - landed_cost_line: lc_id → landed_cost(id)
   - invoice_verification: po_id → purchase_order(id)
   - invoice_verification_line: iv_id → invoice_verification(id), grn_id → goods_receipt(id), grn_line_id → goods_receipt_line(id)

3. **CHECK constraints — exact values:**
   - reason_category: IN ('QA_FAILURE', 'EXCESS_DELIVERY', 'WRONG_MATERIAL', 'DAMAGED', 'QUALITY_DEVIATION', 'OTHER')
   - settlement_mode: IN ('DEBIT_NOTE', 'NEXT_INVOICE_ADJUST', 'EXCHANGE')
   - return_to_vendor status: IN ('CREATED', 'DISPATCHED', 'SETTLED', 'CANCELLED')
   - movement_type_code on rtv_line: DEFAULT 'P122' CHECK (movement_type_code = 'P122')
   - debit_note status: IN ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'SETTLED')
   - exchange_reference status: IN ('RETURN_DISPATCHED', 'REPLACEMENT_RECEIVED', 'SETTLED')
   - landed_cost status: IN ('DRAFT', 'POSTED')
   - cost_type: IN ('FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'CHA_CHARGES', 'LOADING', 'UNLOADING', 'PORT_CHARGES', 'OTHER')
   - invoice_verification status: IN ('DRAFT', 'MATCHED', 'POSTED', 'BLOCKED')
   - match_status: IN ('MATCHED', 'BLOCKED', 'PENDING')
   - gst_type: IN ('CGST_SGST', 'IGST', 'NONE')

4. **No tables in public schema** — all tables in erp_procurement

5. **Do not create handlers or frontend** — DB only

---

## Step 5 — Self-Check Before Finishing

Verify each point before marking DONE:

- [ ] 5 files created with correct timestamps (20260511080000 through 20260511084000)
- [ ] All File-ID headers present (13.8.1 through 13.8.5)
- [ ] return_to_vendor_line: movement_type_code DEFAULT 'P122' with CHECK (movement_type_code = 'P122')
- [ ] debit_note.rtv_id intra-schema FK (not plain uuid)
- [ ] exchange_reference.replacement_grn_id intra-schema FK (nullable — NULL until replacement arrives)
- [ ] landed_cost: grn_id AND csn_id both nullable intra-schema FKs
- [ ] invoice_verification_line: UNIQUE(iv_id, line_number)
- [ ] idx_iv_blocked partial index WHERE status = 'BLOCKED'
- [ ] GRANT SELECT authenticated on all 8 tables
- [ ] GRANT ALL service_role on all 8 tables

---

## Step 6 — Log Update

After creating all 5 files, update `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md`.

Find the Gate-13.8 section and update each row from PENDING to DONE:

```
| 13.8.1 | return_to_vendor + return_to_vendor_line | DONE | supabase/migrations/20260511080000_gate13_8_13_8_1_create_return_to_vendor.sql | Codex | 2026-05-11 |
| 13.8.2 | debit_note + exchange_reference | DONE | supabase/migrations/20260511081000_gate13_8_13_8_2_create_debit_note_exchange.sql | Codex | 2026-05-11 |
| 13.8.3 | landed_cost + landed_cost_line | DONE | supabase/migrations/20260511082000_gate13_8_13_8_3_create_landed_cost.sql | Codex | 2026-05-11 |
| 13.8.4 | invoice_verification + invoice_verification_line | DONE | supabase/migrations/20260511083000_gate13_8_13_8_4_create_invoice_verification.sql | Codex | 2026-05-11 |
| 13.8.5 | Indexes + grants (all 8 tables) | DONE | supabase/migrations/20260511084000_gate13_8_13_8_5_create_indexes.sql | Codex | 2026-05-11 |
```

Then add below the table:
```
Gate-13.8 implementation complete. All 5 migrations created. Awaiting Claude verification.
```

---

## Step 7 — Hard Stop

After completing the log update:
- **STOP. Do not start Gate-13.9.**
- Report: "Gate-13.8 implementation complete. 5 migration files created. Log updated. Ready for Claude verification."

---

*Task Brief created: 2026-05-11*
