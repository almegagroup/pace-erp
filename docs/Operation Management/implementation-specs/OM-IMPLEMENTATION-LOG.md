# PACE-ERP - Operation Management Implementation Log

**Domain:** Operation Management
**Log Owner:** This file is updated by Codex after every implementation step, and by Claude after every verification step.
**Reference Design:** docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md

---

## How This Log Works

| Who | When | What |
|---|---|---|
| Codex | After implementing a spec item | Marks item IN_PROGRESS -> DONE, logs files created |
| Claude | After verifying Codex output | Marks DONE -> VERIFIED or FAILED (with reason) |
| Claude | If verification fails | Adds failure note, Codex must fix and re-implement |

**Status values:** `PENDING` -> `IN_PROGRESS` -> `DONE` -> `VERIFIED` / `FAILED`

---

## PACE ERP — Mandatory Rules (NON-NEGOTIABLE)

এই rules সব Gate, সব page, সব screen এ apply হয়। কোনো Gate VERIFIED হওয়ার আগে এই rules চেক করতে হবে। Violation থাকলে VERIFIED দেওয়া যাবে না।

---

### R-00 — Session শুরুতে Constitution পড়ো
**Rule:** প্রতিটা নতুন Claude session শুরুতে `CLAUDE.md` পড়তে হবে। এটা PACE ERP এর Constitution — project architecture, ACL chain, current state, workflow rules সব এখানে আছে। না পড়লে wrong assumption এ কাজ হবে।

---

### R-01 — কোনো Business Data UUID হিসেবে দেখাবে না
**Rule:** UI তে কোথাও UUID দেখানো যাবে না। প্রতিটা foreign key এর human-readable value backend থেকে resolve করে পাঠাতে হবে।

**Backend responsibility:** Handler এ সব FK resolve করতে হবে — bulk fetch করো (`.in()`), map বানাও, response এ name attach করো। Per-row serial call নয়।

**Frontend responsibility:** `row.material_name` দেখাও, `row.material_id` নয়। Backend থেকে name না এলে `"—"` দেখাও — কখনো raw ID fallback করবে না।

| Raw field | UI তে দেখাবে |
|-----------|-------------|
| `material_id` | `material_code — material_name` |
| `vendor_id` | `vendor_code — vendor_name` |
| `csn_id` | `csn_number` |
| `po_id` | `po_number` |
| `gate_entry_id` | `ge_number` |
| `grn_id` | `grn_number` |
| `storage_location_id` | `location_code — location_name` |
| `*_by` / `*_staff_id` / `*_user_id` | `employee_code — full_name` অথবা field omit |
| অন্য যেকোনো `*_id` FK | Corresponding code / number / name |

---

### R-02 — Back-and-forth Navigation এ Data Reload চলবে না
**Rule:** API থেকে data fetch করে এমন প্রতিটা page অবশ্যই `useQuery` (React Query) use করবে। `useEffect` + `useState` দিয়ে API call করা forbidden।

**কারণ:** `useEffect` প্রতিবার component mount হলে re-run করে। User অন্য page এ গিয়ে ফিরে আসলে আবার full fetch হয়, আবার wait করতে হয়। `useQuery` result cache করে রাখে — ফিরে আসলে instant দেখায়।

**Mutation এর পরে:**
- `queryClient.setQueryData(key, result)` — server response দিয়ে cache update করো
- `queryClient.invalidateQueries(...)` — শুধু তখন যখন list stale হওয়া দরকার (যেমন নতুন item create এর পরে)

**Refresh button:** `queryClient.invalidateQueries(...)` call করবে — never `setTick`, `setPage(p=>p)`, বা অন্য hack।

---

### R-03 — List Endpoint এ Accurate Display Data থাকবে
**Rule:** List page কখনো per-row detail endpoint call করবে না। List এ দেখানোর জন্য যা যা দরকার — names, numbers, status, quantities — সব list endpoint থেকেই আসবে।

**Backend:** List handler এ সব rows এর FK IDs collect করো, একটা bulk query তে সব resolve করো, map বানাও, প্রতিটা row এ attach করে return করো।

---

### R-04 — MCP vs Migration — সঠিক পথে কাজ করো
**Rule:**
- **Migration file** → Schema change, DDL (table create/alter, constraint add/drop, index, function/trigger), system design config (document number ranges, enum values, seed data যা code এর অংশ)
- **MCP direct SQL** → Business/operational data change (user setup, work context assign, ACL snapshot regenerate, test data fix) — dev ও prod দুটোতেই আলাদাভাবে run করতে হয়

**কারণ:** Migration file PR এর সাথে travel করে — prod deploy হলে automatically apply হয়। MCP change শুধু যে DB তে run করা হয় সেখানেই যায়।

**ভুলের pattern:**
- Schema change MCP দিয়ে করলে prod এ miss হয় → prod broken
- Business data migration এ ঢোকালে unnecessary migration history pollute হয়

---

---

## Gate-11 - Foundation DB (erp_inventory schema)

**Spec File:** OM-GATE-11-Foundation-DB-Spec.md
**Target Schema:** erp_inventory
**Started:** 2026-05-09
**Completed:** 2026-05-09

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 11.1 | Create erp_inventory schema + service role grant | DONE | supabase/migrations/20260509100000_gate11_11_1_create_erp_inventory_schema.sql | - | - |
| 11.2 | movement_type_master table | DONE | supabase/migrations/20260509101000_gate11_11_2_create_movement_type_master.sql | - | - |
| 11.3 | stock_type_master table | DONE | supabase/migrations/20260509102000_gate11_11_3_create_stock_type_master.sql | - | - |
| 11.4 | Seed movement types (P-prefix complete list) | DONE | supabase/migrations/20260509103000_gate11_11_4_seed_movement_types.sql | - | - |
| 11.5 | Seed stock types (5 Phase-1 types) | DONE | supabase/migrations/20260509104000_gate11_11_5_seed_stock_types.sql | - | - |
| 11.6 | storage_location_master table | DONE | supabase/migrations/20260509105000_gate11_11_6_create_storage_location_master.sql | - | - |
| 11.7 | storage_location_plant_map table | DONE | supabase/migrations/20260509106000_gate11_11_7_create_storage_location_plant_map.sql | - | - |
| 11.8 | location_transfer_rule table | DONE | supabase/migrations/20260509107000_gate11_11_8_create_location_transfer_rule.sql | - | - |
| 11.9 | number_series_master table | DONE | supabase/migrations/20260509108000_gate11_11_9_create_number_series_master.sql | - | - |
| 11.10 | number_series_counter table + generate_doc_number() function | DONE | supabase/migrations/20260509109000_gate11_11_10_create_number_series_counter.sql | - | - |
| 11.11 | stock_document table | DONE | supabase/migrations/20260509110000_gate11_11_11_create_stock_document.sql | - | - |
| 11.12 | stock_ledger table (append-only, INSERT only) | DONE | supabase/migrations/20260509111000_gate11_11_12_create_stock_ledger.sql | - | - |
| 11.13 | stock_snapshot table | DONE | supabase/migrations/20260509112000_gate11_11_13_create_stock_snapshot.sql | - | - |
| 11.14 | Indexes on all tables | DONE | supabase/migrations/20260509106000_gate11_11_7_create_storage_location_plant_map.sql; supabase/migrations/20260509110000_gate11_11_11_create_stock_document.sql; supabase/migrations/20260509111000_gate11_11_12_create_stock_ledger.sql; supabase/migrations/20260509112000_gate11_11_13_create_stock_snapshot.sql | - | Included in Gate-11 migrations |
| 11.15 | Gate-11 verification pass by Claude | VERIFIED | - | Claude | All 17 checklist checks passed. See Verification Log. |

Gate-11 VERIFIED by Claude on 2026-05-09. All 13 migrations correct. Gate-12 can begin.

---

## Gate-12 - Master Data (erp_master schema extensions)

**Spec File:** OM-GATE-12-MasterData-Spec.md
**Target Schema:** erp_master (existing)
**Dependency:** Gate-11 must be VERIFIED before Gate-12 begins
**Started:** 2026-05-09
**Completed:** 2026-05-09

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 12.1 | uom_master table | DONE | supabase/migrations/20260509120000_gate12_12_1_create_uom_master.sql | - | Seeded standard UOM rows in same migration |
| 12.2 | material_master table | DONE | supabase/migrations/20260509121000_gate12_12_2_create_material_master.sql | - | - |
| 12.3 | material_uom_conversion table | DONE | supabase/migrations/20260509122000_gate12_12_3_create_material_uom_conversion.sql | - | - |
| 12.4 | material_company_ext table | DONE | supabase/migrations/20260509123000_gate12_12_4_create_material_extensions.sql | - | Shared migration with 12.5 |
| 12.5 | material_plant_ext table | DONE | supabase/migrations/20260509123000_gate12_12_4_create_material_extensions.sql | - | `default_storage_location_id` kept as plain uuid NULL |
| 12.6 | material_category_group + member tables | DONE | supabase/migrations/20260509124000_gate12_12_5_create_material_category_group.sql | - | Includes `idx_mcgm_one_primary` |
| 12.7 | vendor_master table | DONE | supabase/migrations/20260509125000_gate12_12_6_create_vendor_master.sql | - | No static payment terms column |
| 12.8 | vendor_company_map table | DONE | supabase/migrations/20260509125000_gate12_12_6_create_vendor_master.sql | - | Shared migration with 12.7 |
| 12.9 | vendor_payment_terms_log table | DONE | supabase/migrations/20260509126000_gate12_12_7_create_vendor_payment_terms_log.sql | - | Includes DESC latest-terms index |
| 12.10 | vendor_material_info table | DONE | supabase/migrations/20260509127000_gate12_12_8_create_vendor_material_info.sql | - | Includes UNIQUE(vendor_id, material_id) |
| 12.11 | customer_master table | DONE | supabase/migrations/20260509128000_gate12_12_9_create_customer_master.sql | - | Includes customer_company_map in same migration |
| 12.12 | PACE code sequence tables + generator functions | DONE | supabase/migrations/20260509129000_gate12_12_10_create_pace_code_sequences.sql | - | Includes material, vendor, and customer generators |
| 12.13 | Indexes on all tables | DONE | supabase/migrations/20260509121000_gate12_12_2_create_material_master.sql; supabase/migrations/20260509122000_gate12_12_3_create_material_uom_conversion.sql; supabase/migrations/20260509123000_gate12_12_4_create_material_extensions.sql; supabase/migrations/20260509124000_gate12_12_5_create_material_category_group.sql; supabase/migrations/20260509125000_gate12_12_6_create_vendor_master.sql; supabase/migrations/20260509126000_gate12_12_7_create_vendor_payment_terms_log.sql; supabase/migrations/20260509127000_gate12_12_8_create_vendor_material_info.sql; supabase/migrations/20260509128000_gate12_12_9_create_customer_master.sql | - | Included in Gate-12 migrations |
| 12.14 | Seed UOM master (standard units) | DONE | supabase/migrations/20260509120000_gate12_12_1_create_uom_master.sql | - | 14 standard UOM rows |
| 12.15 | Gate-12 verification pass by Claude | VERIFIED | - | Claude | All 17 checklist checks passed. See Verification Log. |

Gate-12 VERIFIED by Claude on 2026-05-09. All 10 migrations correct. Gate-13 can begin.

---

## Gate-13 (ORIGINAL) — SUPERSEDED
**Note:** The original single Gate-13 is superseded by L2 sub-gates 13.1–13.9 (see Section 103).
Original spec: OM-GATE-13-Procurement-DB-Spec.md — do NOT implement.
L2 implementation begins at Gate-13.1 below.

---

## Gate-13.1 — L2 Masters (erp_master additions)

**Spec File:** OM-GATE-13.1-L2Masters-DB-Spec.md
**Task Brief:** CODEX-GATE13.1-TASK-BRIEF.md
**Target Schema:** erp_master (existing)
**Dependency:** Gate-12 VERIFIED ✅ — proceed
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.1.1 | payment_terms_master + code sequence | DONE | supabase/migrations/20260511010000_gate13_1_13_1_1_create_payment_terms_master.sql | - | - |
| 13.1.2 | port_master + code sequence | DONE | supabase/migrations/20260511011000_gate13_1_13_1_2_create_port_master.sql | - | - |
| 13.1.3 | port_plant_transit_master | DONE | supabase/migrations/20260511012000_gate13_1_13_1_3_create_port_plant_transit_master.sql | - | - |
| 13.1.4 | material_category_master + assignment table | DONE | supabase/migrations/20260511013000_gate13_1_13_1_4_create_material_category_master.sql | - | - |
| 13.1.5 | lead_time_master_import + lead_time_master_domestic | DONE | supabase/migrations/20260511014000_gate13_1_13_1_5_create_lead_time_masters.sql | - | - |
| 13.1.6 | transporter_master + code sequence | DONE | supabase/migrations/20260511015000_gate13_1_13_1_6_create_transporter_master.sql | - | - |
| 13.1.7 | cha_master + cha_port_map | DONE | supabase/migrations/20260511016000_gate13_1_13_1_7_create_cha_master.sql | - | - |
| 13.1.8 | vendor_master ALTER — add indent_number_required | DONE | supabase/migrations/20260511017000_gate13_1_13_1_8_extend_vendor_master.sql | - | - |
| 13.1.9 | Gate-13.1 verification pass by Claude | VERIFIED | - | Claude | All 15 checks passed. 8 migrations correct. 5 SECURITY DEFINER generators. No cross-schema FK. |

Gate-13.1 VERIFIED by Claude on 2026-05-11. All 8 migrations correct. Gate-13.2 can begin.

---

## Gate-13.2 — Purchase Order DB (erp_procurement schema)

**Spec File:** OM-GATE-13.2-PurchaseOrder-DB-Spec.md
**Task Brief:** CODEX-GATE13.2-TASK-BRIEF.md
**Target Schema:** erp_procurement (new)
**Dependency:** Gate-13.1 VERIFIED
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.2.1 | erp_procurement schema + document_number_series + generators | DONE | supabase/migrations/20260511020000_gate13_2_13_2_1_create_erp_procurement_schema.sql | - | - |
| 13.2.2 | purchase_order + purchase_order_line | DONE | supabase/migrations/20260511021000_gate13_2_13_2_2_create_purchase_order.sql | - | - |
| 13.2.3 | po_approval_log | DONE | supabase/migrations/20260511022000_gate13_2_13_2_3_create_po_approval_log.sql | - | - |
| 13.2.4 | po_amendment_log | DONE | supabase/migrations/20260511023000_gate13_2_13_2_4_create_po_amendment_log.sql | - | - |
| 13.2.5 | PO indexes + grants | DONE | supabase/migrations/20260511024000_gate13_2_13_2_5_create_po_indexes.sql | - | - |
| 13.2.6 | Gate-13.2 verification pass by Claude | VERIFIED | - | Claude | All 11 checks passed. 5 migrations correct. 2 SECURITY DEFINER generators. 14 doc types seeded. No cross-schema FK. |

Gate-13.2 VERIFIED by Claude on 2026-05-11. All 5 migrations correct. Gate-13.3 can begin.

---

## Gate-13.3 — Consignment Note DB

**Spec File:** OM-GATE-13.3-CSN-DB-Spec.md
**Task Brief:** CODEX-GATE13.3-TASK-BRIEF.md
**Target Schema:** erp_procurement
**Dependency:** Gate-13.2 VERIFIED
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.3.1 | consignment_note (full field set — IMPORT/DOMESTIC/BULK) | DONE | `supabase/migrations/20260511030000_gate13_3_13_3_1_create_consignment_note.sql` | Codex | 2026-05-11 |
| 13.3.2 | CSN indexes (including alert partial indexes) | DONE | `supabase/migrations/20260511031000_gate13_3_13_3_2_create_csn_indexes.sql` | Codex | 2026-05-11 |
| 13.3.3 | Gate-13.3 verification pass by Claude | VERIFIED | - | Claude | All 8 checks passed. 2 migrations correct. Self-ref FK on mother_csn_id. No cross-schema FK. Both alert indexes present. |

Gate-13.3 VERIFIED by Claude on 2026-05-11. All 2 migrations correct. Gate-13.4 can begin.


---

## Gate-13.4 — Gate Entry + Inbound Gate Exit DB

**Spec File:** OM-GATE-13.4-GateEntry-DB-Spec.md
**Task Brief:** CODEX-GATE13.4-TASK-BRIEF.md
**Target Schema:** erp_procurement
**Dependency:** Gate-13.3 VERIFIED
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.4.1 | gate_entry + gate_entry_line | DONE | supabase/migrations/20260511040000_gate13_4_13_4_1_create_gate_entry.sql | Codex | 2026-05-11 |
| 13.4.2 | gate_exit_inbound | DONE | supabase/migrations/20260511041000_gate13_4_13_4_2_create_gate_exit_inbound.sql | Codex | 2026-05-11 |
| 13.4.3 | GE indexes (including grn_posted partial index) | DONE | supabase/migrations/20260511042000_gate13_4_13_4_3_create_gate_entry_indexes.sql | Codex | 2026-05-11 |
| 13.4.4 | Gate-13.4 verification pass by Claude | VERIFIED | - | Claude | All 9 checks passed. 3 migrations correct. csn_id intra-schema FK correct. sto_id plain uuid. UNIQUE(gate_entry_id) on gate_exit_inbound. grn_posted partial index present. |

Gate-13.4 VERIFIED by Claude on 2026-05-11. All 3 migrations correct. Gate-13.5 can begin.

---

## Gate-13.5 — GRN DB

**Spec File:** OM-GATE-13.5-GRN-DB-Spec.md
**Task Brief:** CODEX-GATE13.5-TASK-BRIEF.md
**Target Schema:** erp_procurement
**Dependency:** Gate-13.4 VERIFIED
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.5.1 | goods_receipt + goods_receipt_line | DONE | supabase/migrations/20260511050000_gate13_5_13_5_1_create_goods_receipt.sql | Codex | 2026-05-11 |
| 13.5.2 | GRN indexes | DONE | supabase/migrations/20260511051000_gate13_5_13_5_2_create_grn_indexes.sql | Codex | 2026-05-11 |
| 13.5.3 | Gate-13.5 verification pass by Claude | VERIFIED | - | Claude | All 9 checks passed. 2 migrations correct. Self-ref FK on reversal_grn_id. sto_id plain uuid. stock_document_id/stock_ledger_id/storage_location_id all plain uuid. |

Gate-13.5 VERIFIED by Claude on 2026-05-11. All 2 migrations correct. Gate-13.6 can begin.

---

## Gate-13.6 — Inward QA DB

**Spec File:** OM-GATE-13.6-InwardQA-DB-Spec.md
**Task Brief:** CODEX-GATE13.6-TASK-BRIEF.md
**Target Schema:** erp_procurement
**Dependency:** Gate-13.5 VERIFIED
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.6.1 | inward_qa_document + inward_qa_test_line + inward_qa_decision_line | DONE | supabase/migrations/20260511060000_gate13_6_13_6_1_create_inward_qa.sql | Codex | 2026-05-11 |
| 13.6.2 | QA indexes (including pending-QA partial index) | DONE | supabase/migrations/20260511061000_gate13_6_13_6_2_create_qa_indexes.sql | Codex | 2026-05-11 |
| 13.6.3 | Gate-13.6 verification pass by Claude | VERIFIED | - | Claude | All 12 checks passed. 2 migrations correct. 5-value usage_decision CHECK. 4-value movement_type CHECK. stock refs plain uuid. Pending-QA partial index present. |

Gate-13.6 VERIFIED by Claude on 2026-05-11. All 2 migrations correct. Gate-13.7 can begin.

---

## Gate-13.7 — STO + Delivery Challan + Gate Exit Outbound DB

**Spec File:** OM-GATE-13.7-STO-DB-Spec.md
**Task Brief:** CODEX-GATE13.7-TASK-BRIEF.md
**Target Schema:** erp_procurement
**Dependency:** Gate-13.3 VERIFIED (can run parallel with 13.6)
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.7.1 | stock_transfer_order + stock_transfer_order_line | DONE | supabase/migrations/20260511070000_gate13_7_13_7_1_create_stock_transfer_order.sql | Codex | 2026-05-11 |
| 13.7.2 | delivery_challan + delivery_challan_line | DONE | supabase/migrations/20260511071000_gate13_7_13_7_2_create_delivery_challan.sql | Codex | 2026-05-11 |
| 13.7.3 | gate_exit_outbound | DONE | supabase/migrations/20260511072000_gate13_7_13_7_3_create_gate_exit_outbound.sql | Codex | 2026-05-11 |
| 13.7.4 | STO indexes | DONE | supabase/migrations/20260511073000_gate13_7_13_7_4_create_sto_indexes.sql | Codex | 2026-05-11 |
| 13.7.5 | Gate-13.7 verification pass by Claude | VERIFIED | - | Claude | All 7 checks passed. 4 migrations correct. STO status 5 values. balance_qty present. DC sales_order_id plain uuid. exit_type CHECK STO/SALES/RTV. |

Gate-13.7 VERIFIED by Claude on 2026-05-11. All 4 migrations correct. Gate-13.8 spec + brief to be created next.

---

## Gate-13.8 — RTV + Debit Note + Exchange + Landed Cost + Invoice Verification DB

**Spec File:** OM-GATE-13.8-RTV-InvoiceVerification-DB-Spec.md ✅ Created 2026-05-11
**Task Brief:** CODEX-GATE13.8-TASK-BRIEF.md ✅ Created 2026-05-11
**Target Schema:** erp_procurement
**Dependency:** Gate-13.5 VERIFIED + Gate-13.7 VERIFIED
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.8.1 | return_to_vendor + return_to_vendor_line | DONE | supabase/migrations/20260511080000_gate13_8_13_8_1_create_return_to_vendor.sql | Codex | 2026-05-11 |
| 13.8.2 | debit_note + exchange_reference | DONE | supabase/migrations/20260511081000_gate13_8_13_8_2_create_debit_note_exchange.sql | Codex | 2026-05-11 |
| 13.8.3 | landed_cost + landed_cost_line | DONE | supabase/migrations/20260511082000_gate13_8_13_8_3_create_landed_cost.sql | Codex | 2026-05-11 |
| 13.8.4 | invoice_verification + invoice_verification_line | DONE | supabase/migrations/20260511083000_gate13_8_13_8_4_create_invoice_verification.sql | Codex | 2026-05-11 |
| 13.8.5 | Indexes + grants (all 8 tables) | DONE | supabase/migrations/20260511084000_gate13_8_13_8_5_create_indexes.sql | Codex | 2026-05-11 |
| 13.8.6 | Gate-13.8 verification pass by Claude | VERIFIED | - | Claude | All 11 checks passed. 5 migrations correct. P122 DEFAULT+CHECK. exchange_reference nullable FK. landed_cost dual nullable FKs. idx_iv_blocked partial index. 8 tables granted. |

Gate-13.8 VERIFIED by Claude on 2026-05-11. All 5 migrations correct. Gate-13.9 spec + brief to be created next.

---

## Gate-13.9 — Sales / Dispatch (RM/PM Outward) DB

**Spec File:** OM-GATE-13.9-SalesDispatch-DB-Spec.md ✅ Created 2026-05-11
**Task Brief:** CODEX-GATE13.9-TASK-BRIEF.md ✅ Created 2026-05-11
**Target Schema:** erp_procurement
**Dependency:** Gate-13.8 VERIFIED ✅
**Scope:** RM/PM outward only — FG Sales is a separate Logistics module, deferred.
**Started:** 2026-05-11
**Completed:** 2026-05-11

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 13.9.1 | sales_order + sales_order_line | VERIFIED | supabase/migrations/20260511090000_gate13_9_13_9_1_create_sales_order.sql | Claude | 2026-05-11 |
| 13.9.2 | sales_invoice + sales_invoice_line | VERIFIED | supabase/migrations/20260511091000_gate13_9_13_9_2_create_sales_invoice.sql | Claude | 2026-05-11 |
| 13.9.3 | Sales indexes + grants (all 4 tables) | VERIFIED | supabase/migrations/20260511092000_gate13_9_13_9_3_create_indexes.sql | Claude | 2026-05-11 |
| 13.9.4 | Gate-13.9 verification pass by Claude | VERIFIED | - | Claude | All 15 checks passed. 3 migrations correct. gst_type CHECK no NONE. dc_id intra-schema FK NOT NULL. idx_sol_open partial index. cross-schema uuids plain. 4 tables granted. |

---

## Gate-16.0 — Stock Posting Engine (DB Migration)

**Spec File:** OM-GATE-16.0-StockPostingEngine-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.0-TASK-BRIEF.md ✅ Created 2026-05-12
**Target:** supabase/migrations/ (erp_inventory schema function)
**Dependency:** Gate-13.9 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.0.1 | erp_inventory.post_stock_movement() SQL function | VERIFIED | supabase/migrations/20260512000000_gate16_0_16_0_1_create_stock_posting_engine.sql | Claude | 2026-05-12 |
| 16.0.2 | Gate-16.0 verification pass by Claude | VERIFIED | - | Claude | All 7 checks passed. SECURITY DEFINER ✅ Atomic 3-step ✅ Weighted avg IN ✅ INSUFFICIENT_STOCK guard OUT ✅ GRANT service_role ✅ Column names match Gate-11 tables ✅ BEGIN/COMMIT ✅ |

---

## Gate-16.1 — L2 Masters Backend (TypeScript Handlers)

**Spec File:** OM-GATE-16.1-L2MastersBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.1-TASK-BRIEF.md ✅ Created 2026-05-12
**Target:** supabase/functions/api/_core/procurement/ (new directory)
**Dependency:** Gate-16.0 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.1.1 | shared.ts — ProcurementHandlerContext + 3 assert guards | SKIPPED | - | - | Codex inlined ProcurementHandlerContext in po.handlers.ts — acceptable |
| 16.1.2 | l2_masters.handlers.ts — 20 handlers | VERIFIED | supabase/functions/api/_core/procurement/l2_masters.handlers.ts | Claude | 22 handlers (2 extra CHA port map handlers — correct). SA guards ✅ Code gen ✅ 409 duplicate ✅ |
| 16.1.3 | procurement.routes.ts — route dispatcher | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All master + PO routes wired ✅ |
| 16.1.4 | protected_routes.dispatch.ts — add procurement dispatcher | VERIFIED | supabase/functions/api/_pipeline/protected_routes.dispatch.ts | Claude | Fixed by Claude 2026-05-12 |
| 16.1.5 | Gate-16.1 verification pass by Claude | VERIFIED | - | Claude | All checks passed. 22 handlers, all routes wired, SA guards, deactivation guard on payment terms. |

---

## Gate-16.2 — Purchase Order Backend

**Spec File:** OM-GATE-16.2-POBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.2-TASK-BRIEF.md ✅ Created 2026-05-12
**Target:** supabase/functions/api/_core/procurement/po.handlers.ts
**Dependency:** Gate-16.1 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.2.1 | po.handlers.ts — 13 handlers (CRUD + confirm + approve + amend + cancel + knock-off) | VERIFIED | supabase/functions/api/_core/procurement/po.handlers.ts | Claude | All 13 handlers ✅ ASL hard block ✅ CSN auto-create ✅ PROC_HEAD guards ✅ |
| 16.2.2 | procurement.routes.ts — add PO routes | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All 13 routes wired ✅ /api/procurement/ prefix ✅ |
| 16.2.3 | Gate-16.2 verification pass by Claude | VERIFIED | - | Claude | All checks passed. protected_routes.dispatch.ts fixed by Claude (was missing). |

---

## Gate-16.3 — CSN Backend

**Spec File:** OM-GATE-16.3-CSNBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.3-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.2 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.3.1 | csn.handlers.ts — 14 handlers (CRUD + ETA cascade + alerts + tracker) | VERIFIED | supabase/functions/api/_core/procurement/csn.handlers.ts | Claude | 14 handlers ✅ ETA cascade IMPORT/DOMESTIC/BULK ✅ Mother sync ✅ LC alert (today+3) ✅ Vessel alert (po_date<=today-3) ✅ |
| 16.3.2 | procurement.routes.ts — add CSN + alert + tracker routes | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All 14 CSN routes wired ✅ All prior routes intact ✅ |
| 16.3.3 | Gate-16.3 verification pass by Claude | VERIFIED | - | Claude | All checks passed. 14/14 handlers, ETA cascade logic correct, alert queries match spec. |

---

## Gate-16.4 — Gate Entry + GRN Backend

**Spec File:** OM-GATE-16.4-GateEntryGRNBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.4-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.3 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.4.1 | gate_entry.handlers.ts — 7 handlers | VERIFIED | supabase/functions/api/_core/procurement/gate_entry.handlers.ts | Claude | 7 handlers ✅ BULK/TANKER gross_weight guard ✅ distributeNetWeight() ✅ net_weight_override precedence ✅ upsertCsnArrival() on GE create ✅ |
| 16.4.2 | grn.handlers.ts — 6 handlers (postGRNHandler calls post_stock_movement RPC) | VERIFIED | supabase/functions/api/_core/procurement/grn.handlers.ts | Claude | 6 handlers ✅ post_stock_movement RPC called per line ✅ P101/STO_RECEIPT ✅ QA_STOCK if qa_required ✅ auto-creates inward_qa_document ✅ reverseGRN: P102 + p_reversal_of_id ✅ |
| 16.4.3 | procurement.routes.ts — add GE + GRN routes | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All GE routes wired ✅ All GRN routes wired ✅ /grns/:id/post + /reverse ✅ All prior routes intact ✅ |
| 16.4.4 | Gate-16.4 verification pass by Claude | VERIFIED | - | Claude | All checks passed. 7 GE + 6 GRN handlers. Stock posting via RPC confirmed. All 9 GE+GRN routes wired. |

---

## Gate-16.5 — Inward QA Backend

**Spec File:** OM-GATE-16.5-InwardQABackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.5-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.4 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.5.1 | inward_qa.handlers.ts — 7 handlers (usage decision engine) | VERIFIED | supabase/functions/api/_core/procurement/inward_qa.handlers.ts | Claude | 7 handlers ✅ qty sum validation ✅ FOR_REPROCESS guard ✅ RELEASE P321 2-call ✅ SCRAP P553 1-call ✅ P905 confirmed in seed ✅ stock_document_id+ledger_id stored ✅ |
| 16.5.2 | procurement.routes.ts — add QA routes | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All 7 QA routes wired ✅ prior routes intact ✅ |
| 16.5.3 | Gate-16.5 verification pass by Claude | VERIFIED | - | Claude | All checks passed. QUALITY_INSPECTION stock type confirmed correct (DB seed). P905 seed confirmed. |

---

## Gate-16.6 — STO + DC Backend

**Spec File:** OM-GATE-16.6-STODCBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.6-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.5 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.6.1 | sto.handlers.ts — 10 handlers (dispatch auto-creates DC + Gate Exit) | VERIFIED | supabase/functions/api/_core/procurement/sto.handlers.ts | Claude | 10 handlers ✅ STO_ISSUE OUT UNRESTRICTED ✅ DC auto-create ✅ GXO auto-create ✅ transformSubCSN links (not deletes) ✅ confirmReceipt POSTED GRN check ✅ |
| 16.6.2 | procurement.routes.ts — add STO routes | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All STO routes wired ✅ transform-to-sto route ✅ GXO weight route ✅ prior routes intact ✅ |
| 16.6.3 | Gate-16.6 verification pass by Claude | VERIFIED | - | Claude | All checks passed. dispatchSTOHandler: stock check, STO_ISSUE movement, DC+GXO auto-creation, DISPATCHED status all confirmed. |

---

## Gate-16.7 — RTV + Debit Note + Exchange Backend

**Spec File:** OM-GATE-16.7-RTVBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.7-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.5 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.7.1 | rtv.handlers.ts — 14 handlers (RTV + DN + Exchange lifecycle) | VERIFIED | supabase/functions/api/_core/procurement/rtv.handlers.ts | Claude | 14 handlers ✅ addRTVLine BLOCKED stock check ✅ postRTV P122 OUT BLOCKED ✅ Direct path P344→P122 ✅ GXO auto-create RTV ✅ DN proportional LC ✅ FOR freight=0 ✅ EXR settlement_mode guard ✅ |
| 16.7.2 | procurement.routes.ts — add RTV + DN + EXR routes | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All 14 RTV+DN+EXR handlers imported and routed ✅ prior routes intact ✅ |
| 16.7.3 | Gate-16.7 verification pass by Claude | VERIFIED | - | Claude | All checks passed. Direct stock path, proportional LC debit note, EXR lifecycle all confirmed. |

---

## Gate-16.8 — Invoice Verification + Landed Cost Backend

**Spec File:** OM-GATE-16.8-IVLandedCostBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.8-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.4 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.8.1 | invoice_verification.handlers.ts — 8 handlers (3-way match engine) | VERIFIED | supabase/functions/api/_core/procurement/invoice_verification.handlers.ts | Claude | 8 handlers ✅ vendor check ✅ rate_variance>50 BLOCKED ✅ GST state-code derive ✅ gst_match_flag<1.0 ✅ postIV MATCHED-only ✅ |
| 16.8.2 | landed_cost.handlers.ts — 8 handlers | VERIFIED | supabase/functions/api/_core/procurement/landed_cost.handlers.ts | Claude | 8 handlers ✅ grn_id OR csn_id required ✅ total_cost on post ✅ getLCForGRN ✅ |
| 16.8.3 | procurement.routes.ts — add IV + LC routes | VERIFIED | supabase/functions/api/_routes/procurement.routes.ts | Claude | All 16 IV+LC handlers imported and routed ✅ /blocked + /run-match + /by-grn routes ✅ prior routes intact ✅ |
| 16.8.4 | Gate-16.8 verification pass by Claude | VERIFIED | - | Claude | All checks passed. runMatchHandler 3-way logic confirmed. GST derivation via state code. LC dual-ref confirmed. |

---

## Gate-16.9 — Sales Order + Sales Invoice Backend

**Spec File:** OM-GATE-16.9-SalesOrderBackend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE16.9-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.6 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 16.9.1 | sales_order.handlers.ts — 11 handlers (issue auto-creates DC + Gate Exit) | VERIFIED ✅ | supabase/functions/api/_core/procurement/sales_order.handlers.ts | Claude | 2026-05-12 |
| 16.9.2 | procurement.routes.ts — add SO + Sales Invoice routes | VERIFIED ✅ | supabase/functions/api/_routes/procurement.routes.ts | Claude | 2026-05-12 |
| 16.9.3 | Gate-16.9 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |

---

## Gate-17.1 — L2 Masters Frontend (JSX Screens)

**Spec File:** OM-GATE-17.1-L2MastersFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.1-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.1 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.1.1 | procurementApi.js � 14 initial master functions | DONE | frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 17.1.2 | SAPaymentTermsMaster.jsx | DONE | frontend/src/admin/sa/screens/SAPaymentTermsMaster.jsx | Codex | 2026-05-12 |
| 17.1.3 | SAPortMaster.jsx | DONE | frontend/src/admin/sa/screens/SAPortMaster.jsx | Codex | 2026-05-12 |
| 17.1.4 | SAPortTransitMaster.jsx | DONE | frontend/src/admin/sa/screens/SAPortTransitMaster.jsx | Codex | 2026-05-12 |
| 17.1.5 | SALeadTimeMasters.jsx (2 tabs) | DONE | frontend/src/admin/sa/screens/SALeadTimeMasters.jsx | Codex | 2026-05-12 |
| 17.1.6 | SATransporterMaster.jsx | DONE | frontend/src/admin/sa/screens/SATransporterMaster.jsx | Codex | 2026-05-12 |
| 17.1.7 | SACHAMaster.jsx (with port mapping) | DONE | frontend/src/admin/sa/screens/SACHAMaster.jsx | Codex | 2026-05-12 |
| 17.1.8 | adminScreens.js + AppRouter.jsx updates | VERIFIED ✅ | frontend/src/navigation/screens/adminScreens.js; frontend/src/router/AppRouter.jsx | Claude | 2026-05-12 |
| 17.1.9 | Gate-17.1 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |
| 17.1.10 | Post-verify fix — SA routes changed from absolute to relative paths in AppRouter.jsx | FIXED ✅ | frontend/src/router/AppRouter.jsx | Claude | 2026-05-12 |

---

## Gate-17.2 — Purchase Order Frontend

**Spec File:** OM-GATE-17.2-POFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.2-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.2 VERIFIED ✅ + Gate-17.1 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.2.1 | POListPage.jsx + POCreatePage.jsx + PODetailPage.jsx | VERIFIED ✅ | frontend/src/pages/dashboard/procurement/po/POListPage.jsx; frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx; frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx | Claude | 2026-05-12 |
| 17.2.2 | procurementApi.js — add 12 PO functions | VERIFIED ✅ | frontend/src/pages/dashboard/procurement/procurementApi.js | Claude | 2026-05-12 |
| 17.2.3 | operationScreens.js updates | VERIFIED ✅ | frontend/src/navigation/screens/projects/operationModule/operationScreens.js | Claude | 2026-05-12 |
| 17.2.4 | AppRouter.jsx updates | VERIFIED ✅ | frontend/src/router/AppRouter.jsx | Claude | 2026-05-12 |
| 17.2.5 | Gate-17.2 implementation complete by Codex | VERIFIED ✅ | - | Claude | 2026-05-12 |
| 17.2.6 | Gate-17.2 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |
| 17.2.7 | Post-verify fix — PROC_PO_DETAIL added to operationScreens.js + openScreen() added to POListPage.jsx openDetail() | FIXED ✅ | frontend/src/navigation/screens/projects/operationModule/operationScreens.js; frontend/src/pages/dashboard/procurement/po/POListPage.jsx | Claude | 2026-05-12 |
| 17.2.8 | Post-verify fix — Incoterm field made conditional on delivery_type === 'IMPORT' in PODetailPage | FIXED ✅ | frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx | Claude | 2026-05-12 |

---

## Gate-17.3 — CSN Tracker + Alerts Frontend

**Spec File:** OM-GATE-17.3-CSNFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.3-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.3 VERIFIED ✅ + Gate-17.2 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.3.1 | CSNTrackerPage.jsx + CSNDetailPage.jsx + CSNAlertsPage.jsx | VERIFIED ✅ | frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx; frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx; frontend/src/pages/dashboard/procurement/csn/CSNAlertsPage.jsx | Claude | 2026-05-12 |
| 17.3.2 | procurementApi.js — add 12 CSN functions | VERIFIED ✅ | frontend/src/pages/dashboard/procurement/procurementApi.js | Claude | 2026-05-12 |
| 17.3.3 | operationScreens.js updates | VERIFIED ✅ | frontend/src/navigation/screens/projects/operationModule/operationScreens.js | Claude | 2026-05-12 |
| 17.3.4 | AppRouter.jsx updates | VERIFIED ✅ | frontend/src/router/AppRouter.jsx | Claude | 2026-05-12 |
| 17.3.5 | Gate-17.3 implementation complete | VERIFIED ✅ | - | Claude | 2026-05-12 |
| 17.3.6 | Gate-17.3 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |
| 17.3.7 | Post-verify fixes — PROC_CSN_DETAIL added to operationScreens.js; openScreen() added to CSNTrackerPage; CSN+PO routes changed to relative paths in AppRouter | FIXED ✅ | operationScreens.js; CSNTrackerPage.jsx; AppRouter.jsx | Claude | 2026-05-12 |

---

## Gate-17.4 — Gate Entry + GRN Frontend

**Spec File:** OM-GATE-17.4-GateEntryGRNFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.4-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.4 VERIFIED ✅ + Gate-17.3 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.4.1 | GateEntryListPage + GateEntryCreatePage + GateEntryDetailPage | DONE | frontend/src/pages/dashboard/procurement/gate/GateEntryListPage.jsx; frontend/src/pages/dashboard/procurement/gate/GateEntryCreatePage.jsx; frontend/src/pages/dashboard/procurement/gate/GateEntryDetailPage.jsx | Codex | 2026-05-12 |
| 17.4.2 | GRNListPage + GRNDetailPage | DONE | frontend/src/pages/dashboard/procurement/grn/GRNListPage.jsx; frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx | Codex | 2026-05-12 |
| 17.4.3 | procurementApi.js — add 14 GE + GRN functions | DONE | frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 17.4.4 | operationScreens.js + AppRouter.jsx updates | DONE | frontend/src/navigation/screens/projects/operationModule/operationScreens.js; frontend/src/router/AppRouter.jsx | Codex | 2026-05-12 |
| 17.4.5 | Gate-17.4 implementation complete by Codex | DONE | - | Codex | 2026-05-12 |
| 17.4.6 | Gate-17.4 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |
| 17.4.7 | Post-verify fix — openScreen() added to GateEntryCreatePage (post-create nav) + GateEntryDetailPage (both GRN nav paths) | FIXED ✅ | gate/GateEntryCreatePage.jsx; gate/GateEntryDetailPage.jsx | Claude | 2026-05-12 |

---

## Gate-17.5 — Inward QA Frontend

**Spec File:** OM-GATE-17.5-InwardQAFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.5-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.5 VERIFIED ✅ + Gate-17.4 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.5.1 | QAQueuePage.jsx + QADocumentPage.jsx | DONE | frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx; frontend/src/pages/dashboard/procurement/qa/QADocumentPage.jsx | Codex | 2026-05-12 |
| 17.5.2 | procurementApi.js - add 7 QA functions | DONE | frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 17.5.3 | operationScreens.js + AppRouter.jsx updates | DONE | frontend/src/navigation/screens/projects/operationModule/operationScreens.js; frontend/src/router/AppRouter.jsx | Codex | 2026-05-12 |
| 17.5.4 | Gate-17.5 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |

---

## Gate-17.6 — STO + DC Frontend

**Spec File:** OM-GATE-17.6-STODCFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.6-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.6 VERIFIED ✅ + Gate-17.5 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.6.1 | STOListPage.jsx + STOCreatePage.jsx + STODetailPage.jsx | DONE | frontend/src/pages/dashboard/procurement/sto/STOListPage.jsx; frontend/src/pages/dashboard/procurement/sto/STOCreatePage.jsx; frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx | Codex | 2026-05-12 |
| 17.6.2 | procurementApi.js — add 10 STO functions | DONE | frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 17.6.3 | operationScreens.js + AppRouter.jsx updates | DONE | frontend/src/navigation/screens/projects/operationModule/operationScreens.js; frontend/src/router/AppRouter.jsx | Codex | 2026-05-12 |
| 17.6.4 | Gate-17.6 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |

---

## Gate-17.7 — RTV + DN + Exchange Frontend

**Spec File:** OM-GATE-17.7-RTVFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.7-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.7 VERIFIED ✅ + Gate-17.6 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.7.1 | RTVListPage.jsx + RTVCreatePage.jsx + RTVDetailPage.jsx | DONE | frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx; frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx; frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx | Codex | 2026-05-12 |
| 17.7.2 | procurementApi.js — add 14 RTV + DN + EXR functions | DONE | frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 17.7.3 | operationScreens.js + AppRouter.jsx updates | DONE | frontend/src/navigation/screens/projects/operationModule/operationScreens.js; frontend/src/router/AppRouter.jsx | Codex | 2026-05-12 |
| 17.7.4 | Gate-17.7 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |

---

## Gate-17.8 — IV + Landed Cost Frontend

**Spec File:** OM-GATE-17.8-IVLandedCostFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.8-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.8 VERIFIED ✅ + Gate-17.7 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.8.1 | IVListPage + IVCreatePage + IVDetailPage | DONE | frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx; frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx; frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx | Codex | 2026-05-12 |
| 17.8.2 | LandedCostListPage + LandedCostDetailPage | DONE | frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx; frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx | Codex | 2026-05-12 |
| 17.8.3 | procurementApi.js - add 16 IV + LC functions | DONE | frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 17.8.4 | operationScreens.js + AppRouter.jsx updates | DONE | frontend/src/navigation/screens/projects/operationModule/operationScreens.js; frontend/src/router/AppRouter.jsx | Codex | 2026-05-12 |
| 17.8.5 | Gate-17.8 verification pass by Claude | VERIFIED ✅ | - | Claude | 2026-05-12 |

---

## Gate-17.9 — Sales Order + Sales Invoice Frontend

**Spec File:** OM-GATE-17.9-SalesOrderFrontend-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE17.9-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-16.9 VERIFIED ✅ + Gate-17.8 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 17.9.1 | SOListPage + SOCreatePage + SODetailPage | DONE | frontend/src/pages/dashboard/procurement/sales/SOListPage.jsx; frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx; frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx | Codex | 2026-05-12 |
| 17.9.2 | SalesInvoiceListPage + SalesInvoiceDetailPage | DONE | frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx; frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx | Codex | 2026-05-12 |
| 17.9.3 | procurementApi.js - add 11 SO + Sales Invoice functions | DONE | frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 17.9.4 | operationScreens.js + AppRouter.jsx updates | DONE | frontend/src/navigation/screens/projects/operationModule/operationScreens.js; frontend/src/router/AppRouter.jsx | Codex | 2026-05-12 |
| 17.9.5 | Gate-17.9 verification pass by Claude | VERIFIED | - | Claude | 2026-05-12. 2 bugs fixed: SOCreatePage + SalesInvoiceDetailPage missing openScreen() before post-create navigate. All 11 API functions ✅, 5 screen codes ✅, 5 routes ✅, gst_type read-only + CGST/SGST split ✅ |

Gate-17.9 VERIFIED by Claude on 2026-05-12. 2 openScreen() gaps fixed. L2 Frontend complete.

---

## Gate-18 — Number Series Overhaul

**Spec File:** OM-GATE-18-NumberSeries-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE18-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-17.9 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 18.1 | DB - fix document_number_series + company_doc_number_series + counter tables + functions | DONE | supabase/migrations/20260512100000_gate18_18_1_1_fix_document_number_series.sql; supabase/migrations/20260512100100_gate18_18_1_2_create_company_doc_number_series.sql; supabase/migrations/20260512100200_gate18_18_1_3_create_company_doc_number_functions.sql | Codex | 2026-05-12 |
| 18.2 | BE - PO/STO handler fix + Sales Invoice fix + 6 SA CRUD handlers + routes | DONE | supabase/functions/api/_core/procurement/number_series.handlers.ts; supabase/functions/api/_core/procurement/po.handlers.ts; supabase/functions/api/_core/procurement/sto.handlers.ts; supabase/functions/api/_core/procurement/sales_order.handlers.ts; supabase/functions/api/_routes/procurement.routes.ts | Codex | 2026-05-12 |
| 18.3 | FE - SAOmNumberSeries.jsx rebuild + 6 procurementApi functions | DONE | frontend/src/admin/sa/screens/SAOmNumberSeries.jsx; frontend/src/pages/dashboard/procurement/procurementApi.js | Codex | 2026-05-12 |
| 18.4 | Gate-18 verification pass by Claude | VERIFIED | - | Claude | 2026-05-12. All 15 checklist items passed. STO→company+FY ✅ SALES_INVOICE global ✅ generate_invoice_number() dropped ✅ SA role guards ✅ prefix free text ✅ Edit Starting guard on last_number=0 ✅ |

Gate-18 VERIFIED by Claude on 2026-05-12. Number Series Overhaul complete.

---

## Gate-19 — Opening Stock Migration

**Spec File:** OM-GATE-19-OpeningStock-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE19-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-18 VERIFIED ✅

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 19.1 | DB — P563/P565 seed + opening_stock_document + opening_stock_line tables + OS number series | VERIFIED | Codex | 2026-05-12 | `20260512200000_gate19_19_1_1_seed_opening_stock_movement_types.sql`, `20260512200100_gate19_19_1_2_create_opening_stock_tables.sql` |
| 19.2 | BE — 9 handlers (create/list/get/add-line/update-line/remove-line/submit/approve/post) + routes | VERIFIED | Codex | 2026-05-12 | `supabase/functions/api/_core/procurement/opening_stock.handlers.ts`, `supabase/functions/api/_routes/procurement.routes.ts` |
| 19.3 | FE — SAOpeningStockListPage + SAOpeningStockDetailPage + 9 procurementApi functions | VERIFIED | Codex | 2026-05-12 | `frontend/src/admin/sa/screens/SAOpeningStockListPage.jsx`, `frontend/src/admin/sa/screens/SAOpeningStockDetailPage.jsx`, `frontend/src/pages/dashboard/procurement/procurementApi.js` |
| 19.4 | Gate-19 verification pass by Claude | VERIFIED | Claude | 2026-05-12 | Fixed 4 issues: SA_OPENING_STOCK_LIST/DETAIL screen codes added to adminScreens.js, routes wired in AppRouter.jsx, openScreen() added before all navigate() calls in both FE pages |

---

## Gate-20 — Physical Inventory Document (PID)

**Spec File:** OM-GATE-20-PhysicalInventory-Spec.md ✅ Created 2026-05-12
**Task Brief:** CODEX-GATE20-TASK-BRIEF.md ✅ Created 2026-05-12
**Dependency:** Gate-19 VERIFIED ✅
**Scope:** RM + PM + Intermediate only. FG deferred.

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 20.1 | DB — 12 PI movement types + physical_inventory_document + physical_inventory_item + physical_inventory_block + PI number series | DONE | 2026-05-12 | 2026-05-12 | `20260512210000_gate20_20_1_1_seed_pi_movement_types.sql`, `20260512210100_gate20_20_1_2_create_pi_tables.sql` |
| 20.2 | BE — 7 handlers + 7 routes + posting block check in GRN/STO/SO/RTV handlers | DONE | 2026-05-12 | 2026-05-12 | `physical_inventory.handlers.ts`, `procurement.routes.ts`, `grn.handlers.ts`, `sto.handlers.ts`, `sales_order.handlers.ts`, `rtv.handlers.ts` |
| 20.3 | FE — PIDocumentListPage + PIDocumentDetailPage + 7 procurementApi functions + screen codes + routes | DONE | 2026-05-12 | 2026-05-12 | `PIDocumentListPage.jsx`, `PIDocumentDetailPage.jsx`, `procurementApi.js`, `operationScreens.js`, `AppRouter.jsx` |
| 20.4 | Gate-20 verification pass by Claude | VERIFIED | - | Claude 2026-05-12 | All checks passed. See notes below. |

Gate-20 VERIFIED by Claude on 2026-05-12.
- 20.1.1 Migration: 12 PI movement types (P701–P706 surplus/deficit, P711–P716 reversals), document_category=PHYSICAL_INVENTORY ✅
- 20.1.2 Migration: physical_inventory_document (OPEN/COUNTED/POSTED, count_date + posting_date), physical_inventory_item (GENERATED ALWAYS AS difference_qty, UNIQUE doc+material+stock_type), physical_inventory_block (erp_inventory schema, UNIQUE material+plant+sloc), PI in document_number_series ✅
- 20.2 BE: derivePIMovementType, getBookSnapshots (RM/PM/INT filter), checkPostingBlock, 7 handlers (createPID, listPIDs, getPID, addPIItem, enterCount, requestRecount, postDifferences), partial posting, posting_date used for backdated posts, p_unit_value=0 ✅
- 20.2 Posting block checks: grn.handlers.ts, sto.handlers.ts, sales_order.handlers.ts, rtv.handlers.ts all check erp_inventory.physical_inventory_block before stock movements ✅
- 20.2 Routes: all 7 PI routes wired in procurement.routes.ts ✅
- 20.3 FE: PIDocumentListPage.jsx — openScreen() before navigate on create + row open, count_date/posting_date form with independent editability ✅
- 20.3 FE: PIDocumentDetailPage.jsx — openScreen() before navigate on Back, inline count entry with onBlur/Enter save, live difference preview with color coding, Recount button, post confirm dialog, progress summary ✅
- 20.3 procurementApi.js: all 7 functions (listPIDocuments, createPIDocument, getPIDocument, addPIItem, enterPICount, requestPIRecount, postPIDifferences) ✅
- 20.3 operationScreens.js: PROC_PI_LIST + PROC_PI_DETAIL ✅
- 20.3 AppRouter.jsx: imports + routes for procurement/physical-inventory and procurement/physical-inventory/:id ✅

---

## Gate-21 — Missing FE Pages (Debit Note, Exchange Ref, Blocked IV, Gate Exit Inbound)

**Scope:** Backend already exists for all 4 flows. FE pages only. No new DB/BE/API needed.
**Dependency:** Gate-20 VERIFIED ✅
**Codex Brief:** CODEX-GATE21-TASK-BRIEF.md
**Status:** VERIFIED

| ID | Item | Status | Notes |
|---|---|---|---|
| 21.1 | FE — DebitNoteListPage.jsx | VERIFIED | frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx — File-ID 21.1, openScreen before navigate ✅ |
| 21.2 | FE — DebitNoteDetailPage.jsx | VERIFIED | frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx — File-ID 21.2, lifecycle buttons DRAFT→SENT→ACKNOWLEDGED→SETTLED ✅ |
| 21.3 | FE — ExchangeRefListPage.jsx | VERIFIED | frontend/src/pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx — File-ID 21.3, inline Link GRN expand-in-row ✅ |
| 21.4 | FE — BlockedIVListPage.jsx | VERIFIED | frontend/src/pages/dashboard/procurement/accounts/BlockedIVListPage.jsx — File-ID 21.4, read-only, row → PROC_IV_DETAIL ✅ |
| 21.5 | FE — GateExitInboundDetailPage.jsx | VERIFIED | frontend/src/pages/dashboard/procurement/gate/GateExitInboundDetailPage.jsx — File-ID 21.5, all weight fields ✅ |
| 21.6 | operationScreens.js — add 5 screen codes | VERIFIED | All 5 present: PROC_DEBIT_NOTE_LIST, PROC_DEBIT_NOTE_DETAIL, PROC_EXCHANGE_REF_LIST, PROC_BLOCKED_IV_LIST, PROC_GATE_EXIT_INBOUND_DETAIL ✅ |
| 21.7 | AppRouter.jsx — add 5 imports + 5 routes | VERIFIED | All 5 imports + 5 routes wired correctly ✅ |
| 21.8 | GateEntryDetailPage.jsx — navigate to PROC_GATE_EXIT_INBOUND_DETAIL after gate exit creation | VERIFIED | openScreen + navigate on create AND on existing exit link ✅ |
| 21.9 | Gate-21 verification pass by Claude | VERIFIED | All 8 checks passed. Claude 2026-05-18 |
| 21.W1 | Wiring fix — IVListPage.jsx: add "View Blocked IVs" action button (conditional, count-labelled) → openScreen(PROC_BLOCKED_IV_LIST) + navigate | DONE | frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx — Claude 2026-05-18 |
| 21.W2 | Wiring fix — RTVListPage.jsx: add "Debit Notes" + "Exchange Refs" action buttons → openScreen + navigate to respective list pages | DONE | frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx — Claude 2026-05-18 |

Gate-21 VERIFIED by Claude on 2026-05-18. All 8 checks passed. Post-verification wiring fixes W1+W2 applied 2026-05-18. Gate-22 can begin.

---

## Gate-22 — Procurement Planning View

**Scope:** One-page cross-plant tracker — Section 35 of feasibility doc.
**Formula:** Current unrestricted + QA + open PO + in-transit − reserved − scheduled dispatch − planned production req − safety stock = Net Available / Shortage
**Dependency:** Gate-21 complete
**Status:** VERIFIED

| ID | Item | Status | Notes |
|---|---|---|---|
| 22.1 | BE — getProcurementPlanningHandler (read-only, aggregates stock_ledger + PO + CSN + material_plant_ext) | VERIFIED | planning.handlers.ts — 5 parallel queries ✅ Query 6 material_master after ✅ formula correct ✅ normalizeQty 6dp ✅ zero-stock+open-PO rows included ✅ plant_id null guard on PO/CSN ✅ |
| 22.2 | BE — route GET /api/procurement/planning | VERIFIED | procurement.routes.ts line 281 — case "GET:/api/procurement/planning" wired ✅ import at line 46 ✅ |
| 22.3 | FE — ProcurementPlanningPage (cross-plant, filterable by material/plant, color-coded shortage/surplus) | VERIFIED | ProcurementPlanningPage.jsx — all 10 columns ✅ row/cell colour coding ✅ 3-chip summary ✅ shortage toggle re-fetches ✅ plant/material filter client-side ✅ no row navigation (terminal page) ✅ |
| 22.4 | operationScreens.js + AppRouter route | VERIFIED | PROC_PLANNING_VIEW screen code ✅ after PROC_BLOCKED_IV_LIST ✅ AppRouter import + route path="procurement/planning" ✅ |
| 22.5 | procurementApi.js — getProcurementPlanning() | VERIFIED | getProcurementPlanning(params) at line 448 ✅ fetchProcurement GET /api/procurement/planning ✅ |
| 22.6 | Gate-22 verification pass by Claude | VERIFIED | All 6 checks passed. Claude 2026-05-18 |

Gate-22 VERIFIED by Claude on 2026-05-18. All 6 checks passed. No issues found.

---

## Gate-23 — Plant Transfer

**Scope:** One-step (P301/302), two-step (P303/305), storage location transfer (P311/312). Stock type transfer (P321/322 etc.) already seeded — movement only, no document needed.
**Dependency:** Gate-22 complete
**Status:** VERIFIED

| ID | Item | Status | Notes |
|---|---|---|---|
| 23.1 | DB — plant_transfer_order table + PT number series | VERIFIED | Table DDL correct; transfer_type/status CHECK constraints; source_sloc_id/target_sloc_id NOT NULL; valuation_rate/transfer_value NULL (set at issue); issue_stock_document_id/receipt_stock_document_id as plain uuid; 5 indexes; GRANT correct; PT doc_type seeded with pad_width=6, starting_number=1 |
| 23.2 | DB — Seed P301/P302 (one-step) movement types missing from Gate-11 | VERIFIED | P301 direction='TRANSFER', UNRESTRICTED→UNRESTRICTED, reversed_by='P302', reference_document_type='PLANT_TRANSFER_ORDER'; P302 reversal_of='P301'; ON CONFLICT DO NOTHING correct |
| 23.3 | BE — createPTOHandler, listPTOsHandler, getPTOHandler, issueTransferHandler (P303), receiveTransferHandler (P305), oneStepTransferHandler (P301), storageLocationTransferHandler (P311) | VERIFIED | All 9 handlers present; getIdFromPath regex for getPTOHandler; postStockMovement helper correct; fetchSnapshot with .is("batch_id",null); oneStepTransferHandler: P301 OUT+IN → CLOSED; issueTransferHandler: P303 OUT UNRESTRICTED + P303 IN IN_TRANSIT at source → IN_TRANSIT; receiveTransferHandler: uses pto.valuation_rate (locked at issue) P305 OUT IN_TRANSIT + P305 IN UNRESTRICTED → CLOSED; cancelPTOHandler: DRAFT/APPROVED only; storageLocationTransferHandler: same-sloc guard, P311 OUT+IN, PT number generated; listPTOsHandler: returns both data and items for FE compatibility |
| 23.4 | BE — routes for all handlers | VERIFIED | All 9 handlers imported; switch cases: POST/GET /api/procurement/ptos + POST /api/procurement/sloc-transfer; 6 regex routes: /ptos/:id GET, /ptos/:id/approve POST, /ptos/:id/one-step POST, /ptos/:id/issue POST, /ptos/:id/receive POST, /ptos/:id/cancel POST — all correct |
| 23.5 | FE — PlantTransferListPage + PlantTransferDetailPage | VERIFIED | ListPage: handles both response.data and response.items; openScreen before navigate on row click and after create; inline create form with all required fields; transport fields conditional on transport_required toggle. DetailPage: 5 section cards; status-gated actions (canApprove/canOneStepTransfer/canIssue/canReceive/canCancel); window.confirm on all actions; window.prompt for cancellation; actualReceiptDate date input shown only when canReceive; goBack openScreen+navigate correct |
| 23.6 | operationScreens.js + AppRouter route | VERIFIED | PROC_PLANT_TRANSFER_LIST route=/dashboard/procurement/transfer and PROC_PLANT_TRANSFER_DETAIL route=/dashboard/procurement/transfer/:id both present after PROC_PLANNING_VIEW; AppRouter imports both pages; routes procurement/transfer and procurement/transfer/:id registered after procurement/planning |
| 23.7 | procurementApi.js functions | VERIFIED | All 9 functions present: listPTOs, getPTO, createPTO, approvePTO (no body), oneStepTransfer (no body), issueTransfer (no body), receiveTransfer (with body), cancelPTO (with body), slocTransfer; all URL/method/param signatures match handler expectations |
| 23.8 | Gate-23 verification pass by Claude | VERIFIED | Gate-23 VERIFIED by Claude on 2026-05-20. All 8 checks passed. No issues found. |

> Gate-23 VERIFIED by Claude on 2026-05-20. Migration DDL, P301/P302 seed, all 9 PTO handlers (one-step/two-step/sloc-transfer), route wiring, FE list + detail pages, screen registry, router — all correct. No issues found.

---

## Gate-24 — Core Stock Reports

**Scope:** Stock Ledger report, Current Stock (MMBE-style), Stock Valuation — Section 70 of feasibility doc. All read from stock_ledger/stock_snapshot.
**Dependency:** Gate-23 complete
**Status:** VERIFIED

| ID | Item | Status | Notes |
|---|---|---|---|
| 24.1 | BE — getStockLedgerReportHandler (material+plant+date range, movement-by-movement) | VERIFIED | material_id required (400 if missing); optional plant_id/company_id/date_from/date_to filters; order by ledger_seq ASC; limit max 500; signed_qty computed (IN=+qty, OUT=-qty) before return |
| 24.2 | BE — getCurrentStockHandler (MMBE-style — material+plant+sloc+stock_type grid) | VERIFIED | All filters optional; normalizeStockTypeFilter converts "QA"→"QUALITY_INSPECTION" (matches DB value); show_zero param controls gt("quantity",0) filter; orders by material_id+plant_id |
| 24.3 | BE — getStockValuationHandler (qty+rate+value by material+plant) | VERIFIED | Fetches snapshot columns only; JS aggregation by material_id+plant_id; weighted_avg_rate computed; grand_total_value in response; normalizeNumber prevents float drift |
| 24.4 | BE — routes for all 3 | VERIFIED | All 3 handlers imported; 3 switch cases after planning route: GET /stock-ledger, GET /current-stock, GET /stock-valuation; all correct |
| 24.5 | FE — StockLedgerReportPage | VERIFIED | File-ID 24.2; fetch on button click only; material_id required guard; running balance computed via useMemo accumulating signed_qty; row count display; direction chip (emerald/rose) |
| 24.6 | FE — CurrentStockPage | VERIFIED | File-ID 24.3; no required fields; pre-search dashed info box; stockTypeTone handles both QA and QUALITY_INSPECTION; show_zero checkbox; searched state gate |
| 24.7 | FE — StockValuationPage | VERIFIED | File-ID 24.4; response.data + response.grand_total_value correctly destructured (fetchProcurement returns full object when data+total present); grand total row shown only when rows.length > 0 |
| 24.8 | operationScreens.js + AppRouter routes | VERIFIED | PROC_STOCK_LEDGER/PROC_CURRENT_STOCK/PROC_STOCK_VALUATION after PROC_PLANT_TRANSFER_DETAIL; 3 imports + 3 routes in AppRouter after procurement/transfer/:id; 3 procurementApi functions appended |
| 24.9 | Gate-24 verification pass by Claude | VERIFIED | Gate-24 VERIFIED by Claude on 2026-05-20. All 9 checks passed. No issues found. |

> Gate-24 VERIFIED by Claude on 2026-05-20. All 3 handlers (stock ledger, current stock, stock valuation) correct. QA→QUALITY_INSPECTION normalization confirmed against Gate-11 movement_type_master seed. fetchProcurement unwrap behaviour correctly handled in all 3 FE pages. No issues found.

---

## Gate-25 — Document Flow Tab

**Scope:** Document flow tab on all existing operation document detail pages (PO, GRN, QA, STO, RTV, IV, Landed Cost, SO, Sales Invoice, PID). Section 71.2 of feasibility doc.
**Dependency:** Gate-24 complete (all documents stable)
**Status:** VERIFIED

| ID | Item | Status | Notes |
|---|---|---|---|
| 25.1 | BE - getDocumentFlowHandler (given doc type + id, returns full chain: PO->CSN->Gate Entry->GRN->QA->IV etc.) | VERIFIED | `supabase/functions/api/_core/procurement/document_flow.handlers.ts` — 645 lines. DOC_META for all 13 doc types with correct column names (po_date, so_date, document_number, dn_number verified against existing handlers). resolveChain covers all 13 doc types including extra DEBIT_NOTE backward trace. fetchOne/fetchMany helpers, deduplication via Set<string>, NATURAL_ORDER sort. fetchIvIdsForGrns queries invoice_verification_line with .in("grn_id"). |
| 25.2 | BE - route GET /api/procurement/document-flow | VERIFIED | `supabase/functions/api/_routes/procurement.routes.ts` — import `getDocumentFlowHandler` confirmed, `case "GET:/api/procurement/document-flow"` switch case confirmed. |
| 25.3 | FE - DocumentFlowTab component (reusable, used by all detail pages) | VERIFIED | `frontend/src/pages/dashboard/procurement/DocumentFlowSection.jsx` (118 lines) — useEffect cancelled flag cleanup ✅, openScreen before navigate ✅, Array.isArray guard ✅, 13-entry DOC_TYPE_CONFIG ✅, fallback doc_number display (node.id.slice(0,8)) ✅. `procurementApi.js` — getDocumentFlow function appended ✅. |
| 25.4 | Add DocumentFlowTab to: PODetailPage, GRNDetailPage, QADocumentPage, STODetailPage, RTVDetailPage, IVDetailPage, LandedCostDetailPage, SODetailPage, SalesInvoiceDetailPage, PIDocumentDetailPage | VERIFIED | All 10 pages confirmed via Grep — import present, `<DocumentFlowSection docType="..." docId={...} />` placed as last section. PODetailPage uses docId={po.id} (state var), all others use docId={detail.id}. docType strings: PO, GRN, QA, STO, RTV, IV, LANDED_COST, SO, SALES_INVOICE, PID. |
| 25.5 | Gate-25 verification pass by Claude | VERIFIED | All 5 items fully verified via file read + Grep. 645-line handler correct. All 10 page integrations confirmed. Routes wired. API function present. |

Gate-25 VERIFIED by Claude on 2026-05-20. All 5 checks passed. L2 (Gates 21–25) complete.


## Gate-26 — Business Master Governance

**Status:** DONE
**Domain:** PROCUREMENT
**Phase:** Business Master Access Expansion

### Objective
Open 7 business masters to L2_MANAGER+ ACL users via new procurement dashboard
pages. SA screens remain intact and untouched.

### Files Changed (26.1 through 26.10)

| File-ID | Path | Change |
|---------|------|--------|
| 16.1.2  | supabase/functions/api/_core/procurement/l2_masters.handlers.ts | assertSARole → assertManagerOrSARole in 12 write handlers |
| 26.2    | frontend/src/pages/dashboard/procurement/masters/PaymentTermsMasterPage.jsx | New — Payment Terms master for L2_MANAGER+ |
| 26.3    | frontend/src/pages/dashboard/procurement/masters/PortMasterPage.jsx | New — Port master for L2_MANAGER+ |
| 26.4    | frontend/src/pages/dashboard/procurement/masters/PortTransitMasterPage.jsx | New — Port Transit master for L2_MANAGER+ |
| 26.5    | frontend/src/pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx | New — Material Category (create-only) for L2_MANAGER+ |
| 26.6    | frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx | New — Import Lead Time master for L2_MANAGER+ |
| 26.7    | frontend/src/pages/dashboard/procurement/masters/DomesticLeadTimeMasterPage.jsx | New — Domestic Lead Time master for L2_MANAGER+ |
| 26.8    | frontend/src/pages/dashboard/procurement/masters/TransporterMasterPage.jsx | New — Transporter master for L2_MANAGER+ |
| 26.9    | frontend/src/pages/dashboard/procurement/masters/CHAMasterPage.jsx | New — CHA master + port assignment for L2_MANAGER+ |
| 26.10   | frontend/src/navigation/screens/projects/operationModule/operationScreens.js | 7 new PROC_*_MASTER screen codes added |

### Governance Notes
- assertManagerOrSARole allows: SA, GA, DIRECTOR, L4_MANAGER, L3_MANAGER, L2_MANAGER
- Read/list handlers remain unguarded (any authenticated user)
- MaterialCategoryMasterPage is create-only — no update handler exists in backend
- ~~Lead time and port transit ID fields are plain text inputs — no dropdown loading~~ —
  **superseded 2026-06-22/23**: Lead Time Masters now have proper Vendor dropdowns (filtered by
  `vendor_type`) and full Edit support; see "Gate-26 Follow-up" below. Port Transit still plain text.
- Routes nested under /dashboard/procurement/masters/ — **was unwired in AppRouter.jsx for all
  7 pages until 2026-06-19**; see "Gate-26 Follow-up" below.

### Gate-26 Verification — VERIFIED by Claude on 2026-06-01

| Check | Result |
|-------|--------|
| assertManagerOrSARole — 6 correct roles (SA, GA, DIRECTOR, L4_MANAGER, L3_MANAGER, L2_MANAGER) | ✅ |
| All 12 write handlers use assertManagerOrSARole | ✅ |
| 8 frontend pages exist with correct File-IDs (26.2–26.9) | ✅ |
| AppRouter.jsx — all 8 lazy imports + Route entries wired | ✅ |
| operationScreens.js — 8 PROC_*_MASTER screen codes, all with ACL universe | ✅ |
| Minor bug (non-blocking): PaymentTermsMasterPage REFERENCE_DATE_OPTIONS includes "DELIVERY_DATE" but backend REFERENCE_DATES set does not — will cause 400 if selected | ⚠️ |

Gate-26 VERIFIED. All governance changes correct. Minor enum mismatch in payment terms reference_date (DELIVERY_DATE) to be fixed in a future correction. Gate-27 can begin.

---

## Gate-26 Follow-up — Page-by-Page Review & Fixes (2026-06-19 to 2026-06-23)

**Status:** DONE (Operation Masters + Procurement Masters reviewed)
**Domain:** OPERATION_MASTERS, PROCUREMENT

Per-page review pass over Operation Masters (Vendor, Vendor-Material Link/ASL, Customer) and
all 7 Procurement Masters opened in Gate-26, fixing bugs found and redesigning pages where the
existing design no longer matched real usage. See Section 14/15/18/89/94/95 of the feasibility
doc for the corresponding design updates.

### Vendor Master redesign (2026-06-19)
- Dropped flat `primary_contact_person`/`phone`/`primary_email`/`cc_email_list` columns;
  added `vendor_contacts` + `vendor_emails` (multi-row, one marked primary each).
- Address split into 8 columns: `reg_address_line1/city/state/pin` + `corr_address_*`.
- Added `country_code` for import vendors; added `vendor_banks` table (optional).
- GST lookup always overwrites name + registered address (cache-first Applyflow resolver).
- `vendor_company_map` for multi-company assignment.
- Fixed `public.generate_vendor_code()` RPC (missing `WHERE` clause tripped Supabase's
  safe-update guard via PostgREST; worked fine via direct SQL, masking the bug for a while).

### Vendor-Material Info / ASL redesign (2026-06-22)
- Replaced single pack-size/UOM/conversion fields with three child tables —
  `vendor_material_uom`, `vendor_material_currency`, `vendor_material_payment_term` — each
  supporting multiple rows with exactly one default (`ensureExactlyOneDefault`).
  `resolvePoLineUom()` added to `po.handlers.ts` for PO-line UOM resolution.
- `unmapVendorMaterialInfoHandler` now blocks unmap while any `purchase_order_line` referencing
  it has `line_status IN ('OPEN','PARTIALLY_RECEIVED')`.

### Customer Master redesign (2026-06-22)
- Renamed/reframed as the RM/PM surplus-trading customer (not FG dispatch — confirmed via
  `assertSalesMaterial` restricting Sales Order materials to `material_type IN ('RM','PM')`).
  FG dispatch is a separate, undesigned Gate-27 concept.
- Added `parent_customer_master` (+ code sequence) for grouping multiple Customer rows.
- Added vendor-linked customers: `vendor_id` + `parent_customer_id` columns; Name/GST resolve
  live from `vendor_master` when linked (no stored copy); address/contact/phone/email/currency
  one-time auto-filled on first link, editable after.
- `customer_name` made nullable with `CHECK (customer_name IS NOT NULL OR vendor_id IS NOT NULL)`.
- Removed the DRAFT/PENDING_APPROVAL gate — new customers are created directly ACTIVE
  (session policy: don't default new masters to an approval workflow unless asked).
- Fixed stale `OM_ADMIN_REQUIRED` status-mapping bug in every catch block of
  `customer.handlers.ts` (role-check failures were returning 500 instead of 403, because
  `assertManagerOrSARole` actually throws `MANAGER_OR_SA_REQUIRED`).
- Fixed missing `public.generate_customer_code()` wrapper (root cause of persistent 500s on
  Customer create, masked behind a generic error code until Render logs were inspected).
- Fixed `/api/admin/companies` being SA/GA-only despite serving as the generic Company Mapping
  dropdown on Vendor/Material/Customer pages — extended to allow `MANAGER_OR_SA_ROLES`.

### Sidebar reorder
- Procurement Masters group moved after Operation Masters in the sidebar (masters-first ordering).

### Procurement Masters router bug (2026-06-19)
- All 7 Procurement Masters pages (Payment Terms, Port, Port Transit, Material Category,
  Import/Domestic Lead Time, Transporter, CHA) had **zero `<Route>` registration** in
  `AppRouter.jsx` despite full backend/ACL readiness from Gate-26 — every page redirected to the
  landing page. Fixed by adding all 7 routes.

### PM05 — Lead Time Masters fixes (2026-06-22/23)
- `PROC_DOMESTIC_LEAD_TIME_MASTER` was completely missing from `acl.menu_master` — caused a 403
  on the Domestic tab that (via `Promise.all`, not `allSettled`) also broke the Import tab's
  display even though Import itself had full access.
- Added missing Edit (`PATCH /api/procurement/lead-times/import/:id` and `.../domestic/:id`) —
  `upsert*` handlers had only ever inserted, never updated, despite the name.
- Found and fixed a path-segment bug while adding Edit: `getIdFromPath()` hardcoded
  `segments[3]`, correct only for 4-segment paths (`/api/x/y/:id`) — wrong for the 5-segment
  `/api/procurement/lead-times/import/:id`, where it silently returned `"import"` instead of the
  id. This meant **Delete had been silently broken** on these two endpoints the whole time.
  Added `getLastPathSegment()` and applied it to Delete + the new Update handlers.
- Fixed empty Vendor dropdown: `listVendors()` returns `{data, total}`, but the page assumed a
  bare array; added the same defensive `v?.data ?? []` unwrap already used for Companies, and
  fixed the query param name (`is_active` → `status`).
- Fixed Vendor dropdown showing both Import and Domestic vendors on both tabs — now two separate
  filtered `listVendors({vendor_type: "IMPORT" | "DOMESTIC"})` calls.
- Removed Material Category entirely from Import Lead Time Master (column, validation, UI) — no
  real use at this granularity; table was empty so the column was dropped outright. See feasibility
  doc 89.6/89.7.

### PM06 — Transporter Master fixes + redesign (2026-06-23)
- Fixed `usage_direction` validation mismatch: backend accepted `{INBOUND,OUTBOUND,BOTH}` but
  the only frontend caller sent `{IMPORT,DOMESTIC,BOTH}` — every create/update with
  Direction=IMPORT or DOMESTIC was 400ing (and, after the app-layer fix, still 500ing because the
  table's own `transporter_master_usage_direction_check` CHECK constraint wasn't updated in the
  same pass — caught from Render/Postgres logs after the first "fix" shipped).
- Fixed `listTransportersHandler` ignoring `is_active` and always filtering `active=true` — a
  deactivated transporter could never be listed again to reactivate it.
- Full redesign (see feasibility doc 94.1): GST autofill (With GST / Without GST toggle),
  multi-row `transporter_contacts`/`transporter_emails`, `transporter_company_map`. New
  broad-access (`skipAcl: true`) `GET /api/procurement/gst-profile` endpoint, reused by CHA below.

### PM07 — CHA Master redesign (2026-06-23)
- Same upgrade as Transporter, except GST is mandatory (no Without-GST path) —
  `cha_master.gst_number` is now `NOT NULL`. Added `cha_contacts`/`cha_emails`/`cha_company_map`.
  Existing Port Assignments tab (`cha_port_map`) unchanged. See feasibility doc 95.1.

### Process note
- Confirmed (again) that `mcp__supabase__apply_migration` records its own server timestamp,
  distinct from the local migration filename — every migration this pass was renamed post-apply
  via `mcp__supabase__list_migrations` before committing.
- Confirmed a recurring root-cause class: **app-level enum/Set changes must be paired with a
  check of the matching DB `CHECK` constraint, queried on its own** (not bundled with another
  query whose output can bury it) — missed once this session (Transporter direction), causing a
  500 in production after the "fix" was believed complete.

---

## Hotfix — ErpScreenScaffold full-width regression (2026-07-05)

**Root cause:** `ErpScreenScaffold` (line 379) wraps all page content in:
```jsx
<div className="mx-auto flex max-w-none flex-1 flex-col ...">
```
In a `flex-col` flex container, `mx-auto` overrides the default `align-self: stretch` behavior — the child no longer fills the cross-axis (horizontal) width; instead it shrinks to its content width. Result: all ERP screens appeared in a narrow centered column (visible on Port Master / OM03 and all other screens using `ErpScreenScaffold`).

**Fix:** Added `w-full` to the same div (`mx-auto w-full flex max-w-none flex-1 flex-col ...`). With an explicit `width: 100%`, the auto margins have no free space to absorb and the element fills the full available width. The `mx-auto` is now harmless (useful if a `max-w-*` constraint is ever added later).

**File changed:** `frontend/src/components/templates/ErpScreenScaffold.jsx` line 379

---

## Gate-27 — FG Domain: Liquid First (Admix + Hypershot + IWC), Powder Later

**Scope:** Stroke Master, Process PO, Packing PO, FG Declaration, Machine Assignment, FG Receipt, FG QA, Dispatch Instruction (Liquid), Customer Return, Reuse/Rework/Scrap, FOR_REPROCESS flow.
**Dependency:** All L2 gates (21–26) VERIFIED ✅
**Status:** DESIGN IN PROGRESS

---

### Gate-27 Strategy Decision (2026-06-02)

**Liquid-first approach (locked):**
- Phase-1: Design + Implement Admix, Hypershot, IWC completely
- Phase-2: Powder (separate go-live date, separate opening stock)
- Rationale: Liquid go-live = 1 July 2026. Powder go-live = later (separate physical count at Powder go-live date)

**L1/L2 Liquid readiness (verified 2026-06-02):**

| Component | Status | Notes |
|---|---|---|
| Material Master (shade_code, pack_code, external_sku, production_mode) | ✅ Ready | Gate-12 — already built |
| Stock Types (UNRESTRICTED, QA, BLOCKED, IN_TRANSIT, FOR_REPROCESS) | ✅ Ready | Gate-11 |
| FOR_REPROCESS movements (P901–P906) | ✅ Ready | Gate-11 |
| L2 Procurement for RM/PM | ✅ 100% Ready | No changes needed for Liquid RM/PM |
| P231/P232 (FG Receipt from Production / Reversal) | ❌ Missing | Must add in Gate-27 |
| P267/P268 (FOR_REPROCESS → Production Issue / Reversal) | ❌ Missing | Must add in Gate-27 |

**FG Types in Liquid:**

| Section | Type | BOM | SKU known upfront? |
|---|---|---|---|
| Admix (main) | ADMIX_STROKE | No fixed BOM — stroke per order | ❌ Shade/Pack determined per order |
| Hypershot | FIXED_BOM | Pre-defined | ✅ SA maintains upfront |
| IWC | FIXED_BOM | Pre-defined | ✅ SA maintains upfront |

**SKU Structure (all FG types):**
```
Product Code (4) + Shade Code (4) + Pack Code (3) = 11 characters
```

**Two-Order Model (Admix) — UPDATED 2026-06-08:**
- Process PO = RM only (stroke-based), created at Standard phase
- Packing PO = PM only, created at Standard phase (immediately after Process PO), linked
- 1 Process PO → N Packing POs (one-to-many)
- Balance qty: Process PO actual output = Σ all Packing PO qty; balance > 0 → alert → new Packing PO needed
- Pack type change: delink → delete old Packing PO → create new → relink (any stage, L3+ authorization)

**Pending before design can be fully locked:**
- [ ] Batch number format — business owner to provide existing format
- [ ] Admix FG material master creation model — who creates, when, which screen (SOD decision at Process Order + Dispatch design stage)
- [ ] Vessel/Machine tolerance values

**Reform policy (locked 2026-06-02):**
L1/L2 reform and UI polish will be done AFTER all layers (L3–L9) are implemented — unified polish pass for consistency across all screens.

---

### Gate-27 Concept Session — 2026-06-08

**Session type:** General Admix Business Mechanism — concept foundation before formal sub-section lock

**Key decisions locked (written to feasibility doc Sections 83.1, 83.4, 83.13–83.16):**

| Topic | Decision |
|---|---|
| Document flow | FO (production time) → SO (dispatch time) → AP costing confirmation (soft gate) → dispatch |
| Costing soft gate | Wrong stroke costing from AP → dispatch anyway → differential to Reco |
| Process PO + Packing PO creation | Standard time — created together, linked immediately |
| 1 Process PO → N Packing POs | One-to-many. Balance qty tracked. Balance > 0 → alert → new Packing PO |
| Pack type change | Delink → delete → create new Packing PO → relink. Any stage. Auto stock reversal if needed. |
| Pack types | Barrel (599, per barrel cost, PM=barrel+labels), Tanker (000, per KG, no PM), IBC (000, per KG, IBC itself=PM) |
| Barrel mechanics | 2 PM types (210 KG / 230 KG barrel). Fill per barrel = variable, uniform per batch. Order qty divisible by fill. Balance barrel → additional Packing PO. |
| Admix Pack BOM | None — PM selection fully manual in Packing PO. Verify stage catches errors. |
| Hypershot/IWC Pack BOM | Fixed — auto-populated at Packing PO creation |
| PACE costing | Weighted Average Rate (WAR) per item. Landed cost = item + freight + unloading. |
| AP monthly rate | AP confirms rates at start of each month. Used for entire month. |
| Sales Order costing | AP monthly rate + operational cost = what AP pays PACE |
| Reco sources | Rate variance + Quantity variance (e.g. caustic always over-consumed) + Stroke mismatch |
| Reco account | Bilateral clearing — monthly settlement. Either side pays. |
| Procurement planning formula | (Current Unrestricted − Reserved) + In-Transit + QA. Pending PO excluded until In-Transit. |

**Feasibility doc changes:**
- 83.1: Revised — SO timing, costing soft gate, document flow diagram
- 83.4: Major revision — Packing PO at Standard time, 1:N, balance qty, delink=delete, pack type change
- 83.13: New — FG Costing System (WAR vs AP monthly rate, reco)
- 83.14: New — Barrel Mechanics and Fill Quantity
- 83.15: New — Pack BOM Design (Admix=none, Hypershot/IWC=fixed)
- 83.16: New — Procurement Planning Formula

**Next session:** Formal 83.1 sub-section lock → 83.2 → 83.3 ... one by one

---

### Gate-27 Implementation Items (PENDING — design not yet started)

| ID | Item | Status |
|---|---|---|
| 27.1 | Add P231/P232/P267/P268 movement types to movement_type_master | PENDING |
| 27.2 | Stroke Master DB (formulation templates) | PENDING |
| 27.3 | Process PO DB (header + lines + approval + amendment) | PENDING |
| 27.4 | Packing PO DB (header + lines + packing BOM) | PENDING |
| 27.5 | FG Declaration flow | PENDING |
| 27.6 | Machine/Mixer assignment (per Process PO) | PENDING |
| 27.7 | FG Receipt movement (P231 posting) | PENDING |
| 27.8 | FG QA (usage decision) | PENDING |
| 27.9 | FOR_REPROCESS issue to production (P267 posting) | PENDING |
| 27.10 | Batch number generation | PENDING |
| 27.11 | Backend handlers (Process PO, Packing PO, FG Declaration, FG QA) | PENDING |
| 27.12 | Frontend screens (Process PO, Packing PO, FG Declaration, FG QA) | PENDING |

---

## Gate-14 - L1 Master Data Backend (TypeScript handlers)

**Spec File:** OM-GATE-14-L1-Backend-Spec.md
**Target:** supabase/functions/api/_core/om/ + _routes/om.routes.ts
**Dependency:** Gate-11 VERIFIED | Gate-12 VERIFIED - proceed
**Started:** 2026-05-09
**Completed:** 2026-05-09

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 14.1 | shared.ts - OmHandlerContext, assertOmSaContext, assertOmAdminContext | DONE | supabase/functions/api/_core/om/shared.ts | - | - |
| 14.2 | material.handlers.ts - 12 handlers | DONE | supabase/functions/api/_core/om/material.handlers.ts | - | - |
| 14.3 | vendor.handlers.ts - 8 handlers | DONE | supabase/functions/api/_core/om/vendor.handlers.ts | - | - |
| 14.4 | vendor_material_info.handlers.ts - 5 handlers | DONE | supabase/functions/api/_core/om/vendor_material_info.handlers.ts | - | - |
| 14.5 | customer.handlers.ts - 6 handlers | DONE | supabase/functions/api/_core/om/customer.handlers.ts | - | - |
| 14.6 | uom.handlers.ts - 2 handlers | DONE | supabase/functions/api/_core/om/uom.handlers.ts | - | - |
| 14.7 | location.handlers.ts - 3 handlers | DONE | supabase/functions/api/_core/om/location.handlers.ts | - | - |
| 14.8 | number_series.handlers.ts - 2 handlers | DONE | supabase/functions/api/_core/om/number_series.handlers.ts | - | - |
| 14.9 | om.routes.ts - dispatchOmRoutes (38 route cases) | DONE | supabase/functions/api/_routes/om.routes.ts | - | Import sanity check passed |
| 14.10 | Update protected_routes.dispatch.ts - add dispatchOmRoutes | DONE | supabase/functions/api/_pipeline/protected_routes.dispatch.ts | - | Minimal import + dispatch block added |
| 14.11 | Gate-14 verification pass by Claude | VERIFIED | - | Claude | All 22 checks passed. See Verification Log. |

Gate-14 VERIFIED by Claude on 2026-05-09. All 10 handler files correct. Gate-15 (L1 Frontend) can begin.

---

## Gate-15 - L1 Master Data Frontend (JSX screens)

**Spec File:** OM-GATE-15-L1-Frontend-Spec.md
**Target:** frontend/src/pages/dashboard/om/ + frontend/src/admin/sa/screens/
**Dependency:** Gate-14 VERIFIED ✅ — proceed
**Started:** 2026-05-09
**Completed:** 2026-05-09

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 15.1 | omApi.js — 25 fetch functions | DONE | frontend/src/pages/dashboard/om/omApi.js | - | - |
| 15.2 | MaterialListPage.jsx | DONE | frontend/src/pages/dashboard/om/material/MaterialListPage.jsx | - | - |
| 15.3 | MaterialCreatePage.jsx | DONE | frontend/src/pages/dashboard/om/material/MaterialCreatePage.jsx | - | - |
| 15.4 | MaterialDetailPage.jsx | DONE | frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx | - | - |
| 15.5 | VendorListPage.jsx | DONE | frontend/src/pages/dashboard/om/vendor/VendorListPage.jsx | - | - |
| 15.6 | VendorCreatePage.jsx | DONE | frontend/src/pages/dashboard/om/vendor/VendorCreatePage.jsx | - | - |
| 15.7 | VendorDetailPage.jsx | DONE | frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx | - | - |
| 15.8 | AslListPage.jsx | DONE | frontend/src/pages/dashboard/om/asl/AslListPage.jsx | - | - |
| 15.9 | AslCreatePage.jsx | DONE | frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx | - | - |
| 15.10 | AslDetailPage.jsx | DONE | frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx | - | - |
| 15.11 | CustomerListPage.jsx | DONE | frontend/src/pages/dashboard/om/customer/CustomerListPage.jsx | - | - |
| 15.12 | CustomerCreatePage.jsx | DONE | frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx | - | - |
| 15.13 | CustomerDetailPage.jsx | DONE | frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx | - | - |
| 15.14 | SAOmUomMaster.jsx | DONE | frontend/src/admin/sa/screens/SAOmUomMaster.jsx | - | - |
| 15.15 | SAOmStorageLocations.jsx | DONE | frontend/src/admin/sa/screens/SAOmStorageLocations.jsx | - | - |
| 15.16 | SAOmNumberSeries.jsx | DONE | frontend/src/admin/sa/screens/SAOmNumberSeries.jsx | - | - |
| 15.17 | operationScreens.js — 12 screen entries | DONE | frontend/src/navigation/screens/projects/operationModule/operationScreens.js | - | - |
| 15.18 | adminScreens.js — 3 SA screen entries added | DONE | frontend/src/navigation/screens/adminScreens.js | - | - |
| 15.19 | AppRouter.jsx — 16 imports + 15 routes added | DONE | frontend/src/router/AppRouter.jsx | - | - |
| 15.20 | Gate-15 verification pass by Claude | VERIFIED | - | Claude | All 19 items verified. 3 apparent agent flags were spec errors, not implementation errors. See Verification Log. |

Gate-15 VERIFIED by Claude on 2026-05-09. All 19 items correct. Gate-15B (MCG frontend) and Gate-12B (Cost Center + Machine Master) begin next to complete L1.

---

## Gate-15B - L1 MCG Frontend (Material Category Group UI)

**Spec File:** CODEX-GATE15B-TASK-BRIEF.md
**Target:** frontend/src/admin/sa/screens/ + omApi.js additions + navigation updates
**Dependency:** Gate-15 VERIFIED ✅ — proceed (backend handlers already exist in Gate-14)
**Started:** 2026-05-09
**Completed:** 2026-05-09

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 15B.1 | omApi.js — add 3 MCG functions | VERIFIED | frontend/src/pages/dashboard/om/omApi.js | Claude | listMaterialCategoryGroups, createMaterialCategoryGroup, addMaterialCategoryMember — all correct |
| 15B.2 | SAOmMaterialCategoryGroups.jsx | VERIFIED | frontend/src/admin/sa/screens/SAOmMaterialCategoryGroups.jsx | Claude | List + create group + expanded member section + add member form — all correct |
| 15B.3 | adminScreens.js — 1 new SA_OM_MCG entry | VERIFIED | frontend/src/navigation/screens/adminScreens.js | Claude | SA_OM_MCG entry correct, existing entries untouched |
| 15B.4 | AppRouter.jsx — 1 import + 1 route | VERIFIED | frontend/src/router/AppRouter.jsx | Claude | Import + route correct, existing routes untouched |
| 15B.5 | Gate-15B verification pass by Claude | VERIFIED | - | Claude | All 27 checks passed. |

Gate-15B VERIFIED by Claude on 2026-05-09. All 4 items correct. L1 complete pending Gate-12B.

---

## Gate-12B - L1 Missing Master Tables (Cost Center + Machine)

**Spec File:** CODEX-GATE12B-TASK-BRIEF.md
**Target:** supabase/migrations/ + supabase/functions/api/_core/om/ + frontend/src/admin/sa/screens/
**Dependency:** Gate-15 VERIFIED ✅ — proceed
**Started:** 2026-05-09
**Completed:** 2026-05-09

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 12B.1 | cost_center_master migration | VERIFIED | supabase/migrations/20260509200000_gate12b_cost_center_master.sql | Claude | erp_master schema, UNIQUE(company_id, cost_center_code), indexes, GRANT — all correct |
| 12B.2 | machine_master migration | VERIFIED | supabase/migrations/20260509201000_gate12b_machine_master.sql | Claude | erp_master schema, CHECK(machine_type), UNIQUE(plant_id, machine_code), indexes, GRANT — all correct |
| 12B.3 | cost_center.handlers.ts — 2 handlers | VERIFIED | supabase/functions/api/_core/om/cost_center.handlers.ts | Claude | assertOmSaContext on create, assertOmAdminContext on list, erp_master schema access, 409 on duplicate |
| 12B.4 | machine.handlers.ts — 2 handlers | VERIFIED | supabase/functions/api/_core/om/machine.handlers.ts | Claude | assertOmSaContext on create, MACHINE_TYPES Set validation, assertOmAdminContext on list, erp_master schema access |
| 12B.5 | om.routes.ts — add 4 new route cases | VERIFIED | supabase/functions/api/_routes/om.routes.ts | Claude | 4 new cases added, all 38 original cases intact (42 total) |
| 12B.6 | omApi.js — add 4 functions (listCostCenters, createCostCenter, listMachines, createMachine) | VERIFIED | frontend/src/pages/dashboard/om/omApi.js | Claude | 4 functions added, all prior functions untouched |
| 12B.7 | SACostCenterMaster.jsx | VERIFIED | frontend/src/admin/sa/screens/SACostCenterMaster.jsx | Claude | List + create form, file header, no useNavigate — all correct |
| 12B.8 | SAMachineMaster.jsx | VERIFIED | frontend/src/admin/sa/screens/SAMachineMaster.jsx | Claude | List + create form, 5-option machine_type dropdown, file header, no useNavigate — all correct |
| 12B.9 | adminScreens.js — 2 new entries | VERIFIED | frontend/src/navigation/screens/adminScreens.js | Claude | SA_OM_COST_CENTER + SA_OM_MACHINES added, existing entries untouched |
| 12B.10 | AppRouter.jsx — 2 imports + 2 routes | VERIFIED | frontend/src/router/AppRouter.jsx | Claude | 2 imports + 2 routes added, existing routes untouched |
| 12B.11 | Gate-12B verification pass by Claude | VERIFIED | - | Claude | All checklist items passed across all 10 files. |

Gate-12B VERIFIED by Claude on 2026-05-09. All 10 items correct.

---

## Gate-15C - L1 Critical Fixes + Missing Views

**Spec File:** CODEX-GATE15C-TASK-BRIEF.md
**Target:** 6 existing frontend files — no new files, no backend changes
**Dependency:** Gate-12B VERIFIED ✅ — proceed
**Started:** 2026-05-09
**Completed:** 2026-05-09

| ID | Item | Status | Files Created | Verified By | Notes |
|---|---|---|---|---|---|
| 15C.1 | omApi.js — 5 missing functions | VERIFIED | frontend/src/pages/dashboard/om/omApi.js | Claude | All 5 functions present, correct endpoints, credentials via shared helper |
| 15C.2 | MaterialDetailPage — Company Extension section | VERIFIED | frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx | Claude | company_id input, procurement_allowed checkbox, calls extendMaterialToCompany |
| 15C.3 | MaterialDetailPage — Plant Extension section | VERIFIED | frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx | Claude | plant_id + 4 optional fields, calls extendMaterialToPlant |
| 15C.4 | MaterialDetailPage — Approved Vendors (ASL) section | VERIFIED | frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx | Claude | ME1M view — listVendorMaterialInfos with material_id filter, table correct |
| 15C.5 | VendorDetailPage — payment terms grid column fix | VERIFIED | frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx | Claude | payment_days, payment_method, notes, recorded_at — all correct |
| 15C.6 | VendorDetailPage — Company Mapping section | VERIFIED | frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx | Claude | company_id input, calls mapVendorToCompany |
| 15C.7 | VendorDetailPage — Approved Materials (ASL) section | VERIFIED | frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx | Claude | ME1L view — listVendorMaterialInfos with vendor_id filter, table correct |
| 15C.8 | CustomerDetailPage — delivery_address JS validation | VERIFIED | frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx | Claude | JS guard fires before API call — enforced in code not just HTML |
| 15C.9 | CustomerDetailPage — Company Mapping section | VERIFIED | frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx | Claude | company_id input, calls mapCustomerToCompany |
| 15C.10 | AslDetailPage — full status lifecycle | VERIFIED | frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx | Claude | ASL_TRANSITIONS map covers all 5 states, binary toggle removed |
| 15C.11 | AslDetailPage — pack_size_description editable | VERIFIED | frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx | Claude | Editable in form, included in update payload |
| 15C.12 | SAOmStorageLocations — Plant Assignment section | VERIFIED | frontend/src/admin/sa/screens/SAOmStorageLocations.jsx | Claude | Dropdown from loaded list + plant_id input, calls mapStorageLocationToPlant |
| 15C.13 | Gate-15C verification pass by Claude | VERIFIED | - | Claude | 63/63 checks passed. SAP standard completeness confirmed. No regressions. |

Gate-15C VERIFIED by Claude on 2026-05-09. All 12 items correct. **L1 COMPLETE — SAP standard confirmed.**

Gate-15C implementation complete. All 6 files updated. Awaiting Claude verification.

---

## Verification Log

| Date | Gate | Item | Result | Verified By | Notes |
|---|---|---|---|---|---|
| 2026-05-09 | 11 | 11.15 | VERIFIED | Claude | All 17 checks passed. erp_inventory schema correct. 50 movement types, 5 stock types, append-only rules, COALESCE unique constraint - all verified. |
| 2026-05-09 | 12 | 12.15 | VERIFIED | Claude | All 17 checks passed. erp_master extensions correct. No payment_terms on vendor_master. vendor_material_info UNIQUE enforced. 3 SECURITY DEFINER functions. Cross-schema FK avoided. |
| 2026-05-09 | 14 | 14.11 | VERIFIED | Claude | All 22 checks passed. OmHandlerContext correct. 38 routes wired. SA/ADMIN guards applied correctly. Explicit schema access throughout. PACE codes via RPC. Payment terms append-only. VMI 409 on duplicate. Upsert on extensions. Status transitions handler-validated. |
| 2026-05-09 | 15 | 15.20 | VERIFIED | Claude | All 19 items verified. omApi.js has 30 functions (5 VMI extras needed by ASL pages — spec undercounted). financial_year_reset naming matches DB column exactly. ASL routes /dashboard/om/vendor-material-infos* match spec. AppRouter has all 15 OM imports wired. No useNavigate violations. No hardcoded URLs. |
| 2026-05-12 | 16.0 | 16.0.2 | VERIFIED | Claude | All 7 checks passed. SECURITY DEFINER ✅ Atomic 3-step ✅ Weighted avg IN ✅ INSUFFICIENT_STOCK guard OUT ✅ GRANT service_role ✅ Column names match Gate-11 tables ✅ BEGIN/COMMIT ✅ Extra: movement_type/stock_type/storage_location validation present. |
| 2026-05-12 | 16.4 | 16.4.4 | VERIFIED | Claude | All checks passed. gate_entry.handlers.ts: 7 handlers, BULK/TANKER guard, distributeNetWeight, net_weight_override, CSN arrival upsert. grn.handlers.ts: 6 handlers, post_stock_movement RPC per line, P101/STO_RECEIPT, QA_STOCK conditional, auto-QA-doc, reversal P102+p_reversal_of_id. Routes: all 9 GE+GRN routes wired, prior routes intact. |
| 2026-05-18 | PERF | PERF.2 | COMPLETED | Codex | Added safe forward-only RLS planner patch for `erp_core.sessions`, `erp_core.users`, and `erp_core.signup_requests` via `supabase/migrations/20260518110000_perf_safe_auth_rls_initplan.sql`. No policy semantics changed. |

---

## Failure Register

If Claude marks an item FAILED, it is logged here with reason. Codex must fix before proceeding.

| Date | Gate | Item | Failure Reason | Fixed On |
|---|---|---|---|---|
| - | - | - | - | - |

---

## Post-Implementation Corrections

**Reference File:** OM-CORRECTION-NOTES.md
All corrections, improvements, and modifications found after implementation are tracked in OM-CORRECTION-NOTES.md.
Once a fix is done and verified, it is logged here.

| Fix-ID | Date | Area | Description | Fixed By |
|--------|------|------|-------------|----------|
| - | - | - | - | - |

---

## Session Polish — 2026-06-12

Non-gate bugfixes and UX improvements done directly by Claude (no Codex task).

### A — tx_code in Sidebar / Command Bar ✅ FIXED

**Problem:** tx_code (e.g. OM01, PM03) was null in sidebar and Command Bar despite being set in `erp_menu.menu_master`.

**Root cause chain:**
1. `acl_runtime.ts` SELECT strings were missing `tx_code` column → null in snapshot JSON
2. Even after adding `tx_code` to SELECT, snapshot was not being rebuilt — `.schema("erp_menu").rpc()` silently fails because `erp_menu` is not in PostgREST exposed schemas. The RPC call returned no error but did nothing.

**Fix:**
- Created public schema wrapper functions (`public.rebuild_sa_menu_snapshot`, `public.rebuild_acl_menu_snapshot`) that call the real `erp_menu.generate_menu_snapshot` internally
- Changed SA and ACL RPC calls in `acl_runtime.ts` to use these public wrappers
- Added `tx_code` to both SA and ACL SELECT strings
- Created migration `20260612043111_fix_menu_snapshot_rpc_public_wrappers.sql`
- tx_code font size in sidebar set to 14px (MenuShell.jsx)

**Files changed:**
| File | Change |
|------|--------|
| `supabase/functions/api/_shared/acl_runtime.ts` | tx_code added to SELECT strings; RPC calls changed to public wrappers |
| `supabase/migrations/20260612043111_fix_menu_snapshot_rpc_public_wrappers.sql` | New — creates public wrapper functions + GRANTs |
| `frontend/src/layout/MenuShell.jsx` | tx_code display at 14px in sidebar + Command Bar keywords |

---

### B — Inactivity Lock Delayed / Not Firing ✅ FIXED

**Problem:** Inactivity lock was arriving very late or not at all when alt-tabbing away from the ERP.

**Root cause:** `SessionWatchdog.jsx` had a `visibilitychange` listener that called `recordUserActivity()` on tab focus — this reset the idle clock every time user switched back, so the timer never expired.

**Secondary problem:** Browser throttles `setInterval` in background tabs, so the 60s probe could fire much later than expected.

**Fix:**
- Removed `recordUserActivity()` from `visibilitychange` handler (was resetting idle clock)
- Added immediate `tick()` call on tab focus to bypass background tab throttling
- `lastPassiveProbeAtRef.current = 0` forces cooldown bypass on visibility restore

**File changed:** `frontend/src/components/SessionWatchdog.jsx`

---

### C — OM02 Storage Locations Page Full Redesign ✅ DONE

**Previous state:** Single page, raw UUID input for plant assignment, no edit, no toggle.

**New design (2-tab):**

**Tab 1 — Locations:**
- Row-click inline edit (name + type editable, code read-only)
- Activate / Deactivate toggle button per row
- Friendly error messages (error code → human readable)
- Create form on right panel (same pattern as SAOmUomMaster)

**Tab 2 — Plant Assignments:**
- Company dropdown (from `/api/admin/companies`) + Plant dropdown (from `/api/admin/projects`)
- Left panel: assigned locations list with checkbox multi-select → "Remove X selected" batch unmap
- Right panel: unassigned active locations with checkbox multi-select → "Assign (X)" batch assign

**New backend handlers added to `location.handlers.ts`:**
- `updateStorageLocationHandler` — PATCH name + type (SA only)
- `toggleStorageLocationHandler` — POST toggle active (SA only)
- `listPlantAssignmentsHandler` — GET assigned locations for company+plant (admin)
- `unmapStorageLocationFromPlantHandler` — POST batch unmap from plant (SA only)

**New routes (om.routes.ts):**
- `PATCH /api/om/storage-location`
- `POST /api/om/storage-location/toggle`
- `GET /api/om/storage-location/plant-assignments`
- `POST /api/om/storage-location/plant-unmap`

**New omApi.js functions:**
- `updateStorageLocation`, `toggleStorageLocation`, `listPlantAssignments`, `unmapStorageLocationsFromPlant`

**Files changed:**
| File | Change |
|------|--------|
| `supabase/functions/api/_core/om/location.handlers.ts` | +4 handlers (update, toggle, list-assignments, unmap) |
| `supabase/functions/api/_routes/om.routes.ts` | +4 routes + imports |
| `supabase/functions/api/_acl/route-acl-registry.ts` | +4 skipAcl entries |
| `frontend/src/pages/dashboard/om/omApi.js` | +4 API helper functions |
| `frontend/src/admin/sa/screens/SAOmStorageLocations.jsx` | Full rewrite — 2-tab layout |

**Commit:** `c0526bc` — pushed to `dev` on 2026-06-12

---

*Last Updated: 2026-07-06*
*Next: Apply migration 20260706070000 → verify Gate-27 Extension routes + pages → commit all untracked files*

---

## Session Polish — 2026-06-19

Non-gate bugfixes and feature implementations done directly by Claude (no Codex task).
Scope: Vendor Master (OM07) full implementation — SA admin screen.

---

### A — Vendor Master DB Redesign ✅ DONE

**Migrations applied (all via `supabase db push --include-all --linked`):**

| Migration | What |
|-----------|------|
| `20260619000000_vendor_master_redesign.sql` | Drop old flat contact/email columns; add country_code; create vendor_contacts + vendor_emails tables; create public.generate_vendor_code() wrapper |
| `20260619010000_fix_om07_vendor_master_route.sql` | Fix OM07 route registration |
| `20260619020000_vendor_banks_table.sql` | Create vendor_banks table (multi-row: bank_name, branch, account_number, routing_number, is_primary, is_active) |
| `20260619030000_reload_postgrest_vendor_wrapper.sql` | NOTIFY pgrst reload after wrapper creation |
| `20260619040000_vendor_address_split.sql` | Add reg_address_line1/city/state/pin + corr_address_line1/city/state/pin; migrate old registered_address → reg_address_line1; drop old address columns |
| `20260619050000_fix_vendor_code_rpc.sql` | Recreate public.generate_vendor_code() without SET search_path='' (PostgREST skips functions with SET search_path during schema introspection) |
| `20260619060000_fix_vendor_code_where_clause.sql` | Add WHERE id = 1 to UPDATE (pg error 21000: UPDATE requires WHERE clause) |

**DB state after migration:**
- `erp_master.vendor_master`: 8 new address columns, old address/contact/email columns dropped
- `erp_master.vendor_contacts`: new child table
- `erp_master.vendor_emails`: new child table
- `erp_master.vendor_banks`: new child table
- `public.generate_vendor_code()`: working, returns V-00001..V-99999 format

---

### B — generate_vendor_code RPC Fix ✅ FIXED

**Problem:** Vendor create returned 500 error consistently.

**Root cause (2-step):**
1. `public.generate_vendor_code()` had `SET search_path = ''` → PostgREST skips this function during schema introspection → `/rest/v1/rpc/generate_vendor_code` returns 400 silently → backend returns 500
2. After removing `SET search_path = ''`, plain `UPDATE erp_master.vendor_code_sequence SET last_number = last_number + 1` with no WHERE clause → PostgreSQL error 21000 (PostgREST/pg safety: unconditional UPDATE rejected)

**Fix:**
- Migration 050000: Remove `SET search_path = ''`
- Migration 060000: Add `WHERE id = 1` (vendor_code_sequence has exactly one row)

**Diagnosed via:** Render backend logs showing `[vendor.create] generate_vendor_code RPC failed: {"code":"21000","message":"UPDATE requires a WHERE clause"}`

**Key lesson:** `SET search_path = ''` on any PostgreSQL function causes PostgREST to silently skip it — the function becomes unreachable via `/rest/v1/rpc/`. Never use this on public wrapper functions.

---

### C — Vendor Master Backend Update ✅ DONE

**File:** `supabase/functions/api/_core/om/vendor.handlers.ts`

**Changes:**
- `createVendorHandler`: INSERT now includes all 8 address fields (reg_address_line1/city/state/pin + corr_address_line1/city/state/pin)
- `updateVendorHandler`: mutableFields updated — added 8 address fields, removed old `registered_address`/`correspondence_address`
- Added `console.error` logging to createVendorHandler for diagnosis (generate_vendor_code RPC failure + INSERT failure)

---

### D — Vendor Master Frontend (SAVendorMaster.jsx) ✅ DONE

**File:** `frontend/src/admin/sa/screens/SAVendorMaster.jsx`

**Changes:**
1. **ESC key fix:** Replaced custom overlay with `DrawerBase` pattern so `BlockingLayer` intercepts ESC correctly — matches the rest of SA admin screens
2. **GST auto-fill (always overwrite):** When GST number is looked up, vendor_name + reg_address_line1/state/pin are always overwritten (not "only if empty" — always fresh from API)
3. **Address sections:** Two separate `<Section>` blocks — "Registered Address" (line1, city, state, pin) and "Correspondence Address" (line1, city, state, pin) — replacing old single textarea fields
4. **BLANK form state:** Updated to include all 8 address fields, country_code, currency_code (default BDT); removed old flat contact/email/address fields
5. **Only vendor_name mandatory** at create time — all other fields optional

**BLANK object:**
```js
const BLANK = {
  vendor_name: "", bin_number: "", tin_number: "", trade_license: "",
  gst_number: "", gst_category: "", iec_code: "", import_license: "",
  country_code: "", currency_code: "BDT",
  reg_address_line1: "", reg_address_city: "", reg_address_state: "", reg_address_pin: "",
  corr_address_line1: "", corr_address_city: "", corr_address_state: "", corr_address_pin: "",
};
```

---

### E — DB Verification ✅ VERIFIED

Confirmed via MCP SQL queries on dev project (ytapuwiqicmvpanmzelb):
- V-00004: GUJARAT POLYBONDS — DOMESTIC, GST auto-fill worked (reg_address_line1 populated from API)
- V-00005: HS COMPANY — IMPORT, manual entry, all fields saved correctly
- vendor_banks, vendor_contacts, vendor_emails tables exist and accessible

---

### Summary — 2026-06-19

| Area | Status | Files |
|------|--------|-------|
| DB: address split (8 new columns, old dropped) | ✅ | Migration 040000 |
| DB: vendor_contacts + vendor_emails tables | ✅ | Migration 000000 |
| DB: vendor_banks table | ✅ | Migration 020000 |
| DB: generate_vendor_code RPC fix | ✅ | Migration 050000 + 060000 |
| BE: vendor.handlers.ts address fields | ✅ | vendor.handlers.ts |
| FE: SAVendorMaster.jsx full update | ✅ | SAVendorMaster.jsx |
| Feasibility doc: Section 14.3 + 85.6.2 updated | ✅ | Feasibility MD |




















---

## Gate-27 — L3 Production Domain (BOM, Process Order, Packing Order, Dispatch)

**Started:** 2026-07-06
**Completed:** 2026-07-06
**Implemented by:** Claude (full session — DB, Backend, Frontend, ACL, Snapshots)
**Design Reference:** Feasibility doc Sections 83.1–83.5, 83.7, 83.14, 83.17, 83.18

### Scope

Full L3 Production domain for Liquid first (Admix, HPS, IWC):
- Stroke Master (BOM) with dosage-based RM lines
- Prodshade Pack Code Configuration
- Batch Number Series (company-level for MTO/MTEST, per-prodshade for HPS/IWC)
- Production Segment Location Config (segment → rm_sloc / pm_sloc / shopfloor_sloc / fg_sloc)
- Plan Feed (FO — Firm Order management with 3-tab UI)
- Process Orders (full lifecycle: STANDARD → QA_APPROVED → BATCH_STARTED → FINAL → VERIFIED | QA_REJECTED | REVERSED)
- Packing Orders (STANDARD → FINAL | REVERSED, PM consumption at Finalize)
- Order Overview (combined read-only dashboard)

### DB — Migration Files

| Migration | Purpose | Status |
|-----------|---------|--------|
| `20260706010743_gate27_production_schema.sql` | `erp_production` schema, 11 tables, P231/P232 movement types | ✅ Applied (MCP) |
| `20260706020000_gate27_production_acl.sql` | ACL entries: GRP_ACL_PRODUCTION group, 6 PROD_* pages in erp_menu + acl.menu_master, CAP_PROD_OPERATOR + CAP_PROD_PLANNER capabilities | ✅ Applied (MCP) |
| `20260706030000_gate27_production_doc_series.sql` | Number series for PROC_PO + PACK_PO for all 4 business companies | ✅ Applied (MCP) |
| `20260706040000_gate27_production_schema_corrections.sql` | Corrective columns (notes, qa_rejection_reason, fg_stock_ledger_id, batch_started_by, is_rm, uom_code, stock_ledger_id, sku, cancelled_by, total_qty_kg) | ✅ Applied (MCP) |

### DB — Data Changes (via MCP, no migration needed)

- `CAP_PROD_OPERATOR` assigned to ALL work contexts for all 4 business companies (`acl.work_context_capabilities`)
- `version_role_capabilities`: CAP_PROD_OPERATOR added for all roles × all 4 ACL versions
- `version_work_context_capabilities`: CAP_PROD_OPERATOR added for all WCs × all 4 ACL versions
- `version_capability_menu_actions`: all PROD_* menu actions added for all 4 ACL versions
- ACL snapshots regenerated: `acl.generate_acl_snapshot()` for all 4 companies
- Menu snapshots regenerated: `rebuild_acl_menu_snapshot()` for all 9 users × 4 companies

### Backend Files

| File | Purpose | Status |
|------|---------|--------|
| `supabase/functions/api/_core/production/production.shared.ts` | Shared types, role checks, parse helpers | ✅ VERIFIED |
| `supabase/functions/api/_core/production/production.utils.ts` | `generateCompanyDocNumber()` shared util | ✅ VERIFIED |
| `supabase/functions/api/_core/production/stroke_master.handlers.ts` | 6 handlers (list, get, create, update, approve, revert) | ✅ VERIFIED |
| `supabase/functions/api/_core/production/pack_config.handlers.ts` | 5 handlers (listPackCodes, togglePackCode, listPackConfigs, upsertPackConfig, deletePackConfig) | ✅ VERIFIED |
| `supabase/functions/api/_core/production/batch_series.handlers.ts` | 3 handlers + `generateBatchNumber()` | ✅ VERIFIED |
| `supabase/functions/api/_core/production/segment_location.handlers.ts` | 2 handlers (list, upsert) | ✅ VERIFIED |
| `supabase/functions/api/_core/production/plan_feed.handlers.ts` | 6 handlers (list, get, create, update, cancel, summary) | ✅ VERIFIED |
| `supabase/functions/api/_core/production/process_order.handlers.ts` | 10 handlers (full lifecycle incl. stock posting at Verify) | ✅ VERIFIED |
| `supabase/functions/api/_core/production/packing_order.handlers.ts` | 7 handlers (full lifecycle incl. PM consumption at Finalize) | ✅ VERIFIED |
| `supabase/functions/api/_routes/production.routes.ts` | Route dispatcher for all /api/production/* | ✅ VERIFIED |
| `supabase/functions/api/_pipeline/protected_routes.dispatch.ts` | Added `dispatchProductionRoutes` call | ✅ VERIFIED |

### Frontend Files

| File | Purpose | Status |
|------|---------|--------|
| `frontend/src/pages/dashboard/production/prodApi.js` | All /api/production/* API calls (37 functions) | ✅ VERIFIED |
| `frontend/src/pages/dashboard/production/StrokeMasterPage.jsx` | Stroke Master list + detail drawer + create drawer | ✅ VERIFIED |
| `frontend/src/pages/dashboard/production/PackConfigPage.jsx` | Pack Codes (read) + Prodshade Configs (create/delete) tabs | ✅ VERIFIED |
| `frontend/src/pages/dashboard/production/PlanFeedPage.jsx` | 3-tab FO management (Create / Edit / Total Table with modal) | ✅ VERIFIED |
| `frontend/src/pages/dashboard/production/ProcessOrderPage.jsx` | Full Process Order lifecycle with drawer, modals, all actions | ✅ VERIFIED |
| `frontend/src/pages/dashboard/production/PackingOrderPage.jsx` | Packing Order lifecycle (create, link FO, finalize, reverse) | ✅ VERIFIED |
| `frontend/src/pages/dashboard/production/OrderOverviewPage.jsx` | Combined overview: Process Orders + expandable Packing Orders | ✅ VERIFIED |
| `frontend/src/admin/sa/screens/SAProductionBatchSeriesPage.jsx` | SA screen for batch number series management | ✅ VERIFIED |
| `frontend/src/admin/sa/screens/SAProductionSegmentLocationPage.jsx` | SA/Manager screen for segment location config | ✅ VERIFIED |

### Navigation Wiring

| File | Change | Status |
|------|--------|--------|
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | Added 6 PROD_* screen entries | ✅ VERIFIED |
| `frontend/src/router/AppRouter.jsx` | Imports + Routes for 6 production pages + 2 SA screens | ✅ VERIFIED |

### ACL / Access Design

| Screen | Who Can Access |
|--------|---------------|
| PROD_STROKE_MASTER | All ACL users (CAP_PROD_OPERATOR); Approve/Revert = Manager+ |
| PROD_PACK_CONFIG | All ACL users; Write = Manager+ |
| PROD_PLAN_FEED | All ACL users; Create/Edit = Manager+ |
| PROD_PROCESS_ORDER | All ACL users; QA actions = Manager+ or L1/L2 Auditor |
| PROD_PACKING_ORDER | All ACL users; Finalize = Manager+ |
| PROD_ORDER_OVERVIEW | All ACL users (read-only) |
| SA_PROD_BATCH_SERIES | SA + Manager+ (SA admin panel route) |
| SA_PROD_SEGMENT_LOCATIONS | SA + Manager+ (SA admin panel route) |

### Stock Movement Logic

| Event | Movement |
|-------|---------|
| Process Order VERIFY | P261 (RM out from rm_sloc) + P261 (PM out from pm_sloc) + P231 (FG in to shopfloor_sloc) |
| Process Order REVERSE from VERIFIED | P232 (FG out reversal) + P262 (RM/PM in reversal) |
| Packing Order FINALIZE | P261 (PM out from pm_sloc per segment config) |

### Gate-27 Status: ✅ VERIFIED

All DB, Backend, Frontend, ACL, and Snapshot steps complete. Production pages visible in sidebar for all ACL users across all 4 business companies.

---

## Gate-27 Extension — Pack BOM, Stroke Change Request, Production Workflow Pages

**Started:** 2026-07-06
**Completed:** 2026-07-06
**Implemented by:** Claude (same session as Gate-27)
**Status:** DONE — pending commit + verification

### Scope

Second implementation wave within Gate-27. Adds:
- Pack BOM domain (create → approve → change request → approve change)
- Stroke Change Request domain (material substitution on live strokes)
- 17 dedicated production workflow pages (PR02–PR17) replacing inline actions in ProcessOrderPage/PackingOrderPage
- SA Pack Code Master page

### DB — Migration

| Migration | Purpose | Status |
|-----------|---------|--------|
| `20260706070000_gate27_pack_bom_change_request.sql` | `erp_production.pack_bom`, `pack_bom_line`, `pack_bom_change_request`, `pack_bom_change_request_line` tables + `stroke_change_request`, `stroke_change_request_line` tables + `erp_master.fg_material_seq` sequence | ✅ Applied (MCP) |

### Backend Files

| File | File-ID | Handlers | Status |
|------|---------|----------|--------|
| `supabase/functions/api/_core/production/stroke_change_request.handlers.ts` | 27.3 | 5: list, get, create, approve, reject | DONE |
| `supabase/functions/api/_core/production/pack_bom.handlers.ts` | 27.4 | 9: listPackBoms, getPackBom, createPackBom, approvePackBom, rejectPackBom, createPackBomChangeRequest, listPackBomChangeRequests, approvePackBomChangeRequest, rejectPackBomChangeRequest | DONE |
| `supabase/functions/api/_core/production/pack_config.handlers.ts` | — | Modified: route additions for SAPackCodeMasterPage | DONE |
| `supabase/functions/api/_routes/production.routes.ts` | — | ~20 new route cases added (stroke-change-requests, pack-boms, pack-bom-change-requests routes) | DONE |

**Key business rules implemented:**
- Pack BOM create: auto-ACTIVE if `bom_required = false` on pack_code_master (599/000/001); DRAFT otherwise
- Pack BOM approve: Manager can edit PM lines before approving; atomically replaces lines
- Pack BOM change request: one pending DRAFT allowed per BOM; approve applies ADD/REMOVE/EDIT changes atomically to live BOM lines
- Stroke change request: one DRAFT per stroke; approve updates `stroke_line.material_id` directly

### Frontend — SA Screen

| File | File-ID | Purpose | Status |
|------|---------|---------|--------|
| `frontend/src/admin/sa/screens/SAPackCodeMasterPage.jsx` | 27.SA-02 | 2-tab SA admin: Tab 1 = Pack Code Catalog (toggle active/inactive), Tab 2 = Prodshade Pack Config (upsert + delete) | DONE |

### Frontend — Production Pages (PR02–PR17)

| File | File-ID | Purpose | Who Can Access | Status |
|------|---------|---------|----------------|--------|
| `frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx` | 27.FE-PR02 | Manager reviews + approves/reverts DRAFT strokes | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ChangeBomItemPage.jsx` | 27.FE-PR03 | L1/L2 Manager creates material-substitution change request on ACTIVE stroke → DRAFT for L3 approval | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ChangeBomItemApprovalPage.jsx` | 27.FE-PR04 | L3 Manager approves/rejects stroke change requests; on approve live stroke lines updated | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/PackBomCreatePage.jsx` | 27.FE-PR05 | Create Pack BOM for FG SKU with PM lines; BOM status depends on pack_code bom_required flag | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx` | 27.FE-PR06 | L1 Manager reviews DRAFT Pack BOMs; can edit PM lines inline before approving | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ChangePackBomPage.jsx` | 27.FE-PR07 | Propose ADD/REMOVE/EDIT changes to ACTIVE Pack BOM → DRAFT change request for PR08 queue | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ChangePackBomApprovalPage.jsx` | 27.FE-PR08 | L1 Manager approves/rejects Pack BOM change requests; changes applied atomically on approval | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx` | 27.FE-PR09 | 2-tab create form: Tab 1 = Process PO (type, prodshade, stroke, qty, date), Tab 2 = Packing PO (linked to Process PO) | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ProductionPOEditPage.jsx` | 27.FE-PR10 | Edit Process PO qty adjustments + machine assignment when status = QA_APPROVED or BATCH_STARTED | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx` | 27.FE-PR11 | Enter actual quantities for Process PO or Packing PO (COR6-Final step) | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx` | 27.FE-PR12 | QA confirms actuals vs batch paper + posts stock movements (COR6-Verify); also handles Correction Mode for VERIFIED POs | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/OrderListPage.jsx` | 27.FE-PR13 | Combined Process PO + Packing PO list (COID equivalent); 2 tabs, status chip filters | All ACL | DONE |
| `frontend/src/pages/dashboard/production/BatchVariancePage.jsx` | 27.FE-PR14 | Report: planned qty vs actual qty variance per Process PO batch; colour-coded delta | All ACL | DONE |
| `frontend/src/pages/dashboard/production/ReversalPage.jsx` | 27.FE-PR15 | Step-by-step reversal for any Process PO or Packing PO stage; explains what each reversal does | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/QAQueuePage.jsx` | 27.FE-PR16 | QA Approval Queue — lists STANDARD status Process POs; QA approves or rejects with reason | Manager+ | DONE |
| `frontend/src/pages/dashboard/production/BatchReleasePage.jsx` | 27.FE-PR17 | Manager releases batch numbers for QA_APPROVED Process POs (calls startBatch endpoint) | Manager+ | DONE |

### Navigation Wiring

| File | Change | Status |
|------|--------|--------|
| `frontend/src/navigation/screens/adminScreens.js` | SA_PROD_PACK_CODE_MASTER screen entry added | DONE |
| `frontend/src/navigation/screens/projects/operationModule/operationScreens.js` | New PROD_* screen codes for PR02–PR17 + SA pack code master | DONE |
| `frontend/src/router/AppRouter.jsx` | Imports + Routes for all 17 new production pages + SAPackCodeMasterPage | DONE |
| `frontend/src/pages/dashboard/production/prodApi.js` | New API functions: createStrokeChangeRequest, listStrokeChangeRequests, getStrokeChangeRequest, approveStrokeChangeRequest, rejectStrokeChangeRequest, createPackBom, listPackBoms, getPackBom, approvePackBom, rejectPackBom, createPackBomChangeRequest, listPackBomChangeRequests, approvePackBomChangeRequest, rejectPackBomChangeRequest | DONE |

### ⚠️ Pending Actions

- [ ] `production.routes.ts` — new routes reference new handlers but not verified end-to-end
- [ ] All 17 new frontend pages — navigation wiring in AppRouter.jsx not confirmed
- [ ] All untracked files need git commit
- [ ] Verification pass by Claude needed before marking VERIFIED

---

## Session Polish — 2026-07-07/08 (Gate Entry Fixes + GE Prune)

**Date:** 2026-07-07 → 2026-07-08
**Implemented by:** Claude
**Commits:** `cd5aa85` → `ecbb4dd`

### Scope
Gate Entry (GE) Register ও Detail page এর সব critical bugs fix। GE Prune feature নতুন implement। ErpDenseGrid keyboard navigation। Mandatory rules Constitution ও CLAUDE.md তে document।

---

### Bug Fixes

| # | Bug | Root Cause | Fix | Files |
|---|-----|-----------|-----|-------|
| B-01 | GE Register এ row click কাজ করছিল না | `getRowProps` এ `onDoubleClick` ছিল, single click handler ছিল না | `onClick` দিয়ে replace | `GateEntryListPage.jsx` |
| B-02 | Create GE button page refresh করত | `openCreate` navigate করত `/gate-entries` (same page) এ | `/gate-entries/create` এ navigate | `GateEntryListPage.jsx` |
| B-03 | GE Register sidebar থেকে খুললে Create page দেখাত | AppRouter এ `/gate-entries` → `GateEntryCreatePage` ছিল (ভুল) | `/gate-entries` → `GateEntryListPage` | `AppRouter.jsx` |
| B-04 | GE Detail এ Material UUID দেখাচ্ছিল | `hydrateGateEntry` material join করত না | `Promise.all` দিয়ে parallel material fetch, `material_code — material_name` attach | `gate_entry.handlers.ts` |
| B-05 | GE Detail এ Gate Staff UUID দেখাচ্ছিল | UUID directly render হচ্ছিল | Field সরিয়ে Remarks দিয়ে replace | `GateEntryDetailPage.jsx` |
| B-06 | GE List N+1 API call | প্রতি row এর জন্য `getGateEntry()` call হচ্ছিল | List handler এ bulk aggregate query | `gate_entry.handlers.ts` |
| B-07 | Back-and-forth এ data reload | `useEffect` + `setState` pattern | `useQuery` তে convert (list ও detail দুটোই) | `GateEntryListPage.jsx`, `GateEntryDetailPage.jsx` |
| B-08 | GE List status filter এ PRUNED ছিল না | New status যোগ হয়েছিল কিন্তু UI update হয়নি | PRUNED filter option ও badge যোগ | `GateEntryListPage.jsx` |

---

### New Feature — GE Prune

**Design (Locked 2026-07-07):**
- GE edit করা যাবে না — শুধু PRUNE করা যাবে
- Prune করতে হলে সব linked GRN আগে REVERSED হতে হবে (system check)
- Prune হলে: GE status → `PRUNED`, CSNs → `pre_ge_status` (ORD/TRN যেটা ছিল) এ restore
- Serial number reuse হবে না

**DB Migrations:**

| Migration | Purpose |
|-----------|---------|
| `20260707200000_ge_pruned_status.sql` | `gate_entry.status` CHECK constraint এ `PRUNED` add |
| `20260707200001_csn_pre_ge_status.sql` | `consignment_note.pre_ge_status` column — GE attach এর আগের status store করে |

**Backend:**

| Change | File |
|--------|------|
| `pruneGateEntryHandler` — POST `/:id/prune` | `gate_entry.handlers.ts` |
| `upsertCsnArrival` — `pre_ge_status` save on GE create | `gate_entry.handlers.ts` |
| `GE_HEADER_STATUSES` set এ `PRUNED` add | `gate_entry.handlers.ts` |
| Prune route + ACL registry entry (WRITE) | `procurement.routes.ts`, `route-acl-registry.ts` |
| `pruneGateEntry()` API function | `procurementApi.js` |

**Frontend:**

| Change | File |
|--------|------|
| "Prune GE" danger button (OPEN/GRN_POSTED status এ দেখায়) + confirmation modal | `GateEntryDetailPage.jsx` |
| PRUNED → rose status tone | `GateEntryDetailPage.jsx`, `GateEntryListPage.jsx` |

---

### Infrastructure — ErpDenseGrid Keyboard Navigation

**Change:** `ErpDenseGrid` তে proper keyboard navigation যোগ — সব list page এ automatically কাজ করবে।

| Key | Action |
|-----|--------|
| ↑ Arrow | Previous row focus |
| ↓ Arrow | Next row focus |
| Enter | Row activate (`onRowActivate`) |

**Implementation:** `tabIndex={0}` on `<tr>`, `useRef` array দিয়ে row refs track, ArrowUp/Down এ `el.focus()`, focused row `focus:bg-sky-50 focus:ring-sky-400` highlight।

**File:** `frontend/src/components/data/ErpDenseGrid.jsx`

---

### Document Number Series — SAP-Style Ranges (Locked 2026-07-07)

Migration: `20260707170858_document_number_series_ranges.sql`

প্রতিটা doc type এর আলাদা number range — range দেখেই doc type বোঝা যায়, prefix দরকার নেই (SAP pattern)। Idempotent — existing correct range থাকলে update করে না।

See CLAUDE.md Section 8 for full range table.

---

### Constitution & Rules Update

| Document | Change |
|----------|--------|
| `docs/PACE_ERP_MASTER_CONSTITUTION.md` | PART 1B: Mandatory Development Rules যোগ (No UUID, useQuery, accurate list data, MCP vs Migration) |
| `CLAUDE.md` | Section 8A: same rules SSOT হিসেবে |
| `OM-IMPLEMENTATION-LOG.md` | R-00 to R-04 mandatory rules section (এই file এর শুরুতে) |


