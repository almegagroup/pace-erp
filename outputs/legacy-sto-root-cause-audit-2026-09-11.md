# Legacy STO / CSN / SO03 / SO02 audit — 2026-09-11

Scope: investigate the reported STO_CREATE_FAILED response and the connected dispatch/invoice/stock flow. No production business data, grants, functions or application code was changed. No migration was created. Repository inspected at 67ec031c5cb53d07cbf8ab1008a23549c4c8d17b; deployed Node API revision and its request logs were not available through the connected tools.

## STO types and the CSN contract

| Flow | CSN before creation | CSN action | Receiving side |
|---|---|---|---|
| Independent / INTER_PLANT | Not required | Confirm/approve creates a new CSN per STO line | CSN belongs to receiving company; sending company is its vendor identity |
| CONSIGNMENT_DISTRIBUTION | Existing Mother/Sub-CSN allocation | Existing Sub-CSN updated in place and linked to STO; no duplicate CSN | company_id switches to receiving company, vendor_id becomes sending company; origin remains traceable |
| Opening / Legacy STO | Form forces INTER_PLANT | Same new-CSN path after frontend auto-confirm | Same as Independent |

References: feasibility sections 88.4, 88.12 (including the 2026-07-25 correction), 92 and 133.6. New STO exposes both types; legacy STO is intentionally not a Distribution selector. Independent here is an STO type, not SO01's Independent Party dispatch/customer classification.

Implementation: StoCreateFormPage.jsx:209,267,488,518; sto.handlers.ts:790 and buildConsignmentStoFromSubCsns. The latter currently creates its header directly at CREATED, whereas direct INTER_PLANT creation starts at DRAFT. Do not assume their pre-creation/confirmation sequence is identical merely because downstream document handling is shared.

## Primary failure: production privileges and partial create

Production contains exactly one STO: ACP/PO87/2026-27, opening=true, INTER_PLANT, CMP003 to CMP005, DRAFT. Header created at 2026-09-11 10:30:30.446142 UTC; its one line followed at 10:30:30.570938 UTC: RM-00028, 3,000 KG, INR 72.20, balance 3,000, dispatched/received zero. CSNs=0, STO DO lines=0, STO invoices=0. No stock document references this STO.

Live has_table_privilege checks:

| Object | Prod service_role SELECT / INSERT / UPDATE | Dev SELECT / INSERT |
|---|---|---|
| erp_procurement.sto_approval_log | false / false / false | true / true |
| erp_procurement.sto_amendment_log | false / false / false | true / true |

Executing SELECT as service_role reproduced SQLSTATE 42501, permission denied for table sto_approval_log. The STO tables themselves and the checked CSN/DO/invoice tables have backend permissions in prod. This is database-object privilege drift, not the user's menu ACL and not a missing source CSN.

createSTOHandler saves the header, saves lines, then calls hydrateSto. hydrateSto reads both audit tables, so missing SELECT permission makes the response fail after those writes have committed. The frontend awaits createSTO before calling confirmSTO; failed hydration therefore leaves the saved document DRAFT with no CSN. A subsequent attempt using the same number hits stock_transfer_order_sto_number_key; the header error branch converts database errors into the generic STO_CREATE_FAILED 500 without logging the original database error.

The live partial document and reproduced permission failure establish the underlying defect. The supplied request ID 415a0e6f-8a84-41c1-b369-c0f550b6c64c was not correlated with a retained application log, so the exact retry chronology is an inference, not a recovered request trace.

The original 20260625130000_sto_approval_amendment_logs.sql creates these tables without service_role grants. The later RLS migration enables restrictive policies but does not grant table privileges. RLS bypass does not supply missing table permissions.

## Downstream findings

1. **SO03 v2 loses STO commercial values.** In prepareAndValidateDoLines, the STO branch sets material/UOM/source identifiers but leaves salesSourceLine null. The common rate/GST block reads salesSourceLine.rate and salesSourceLine.gst_rate with zero fallbacks. It never reads STO transfer_price/gst_rate. Thus a 3,000 KG x 72.20 STO would produce a zero-value DO line instead of 216,600 before tax. SO02 group construction copies the DO's unit_value and GST; it does not recover the STO rate. Sources: do_unified.handlers.ts:951,1053,1077,1824. This affects both STO types in the new common DO path. Section 133.6's older rate verification names createDeliveryOrderHandler, not this newer unified handler.

2. **SO03 v2 omits CSN dispatch synchronization.** The old delivery_order.handlers.ts upsertCsnDispatch updates ORD to TRN and dispatch totals for the CSN linked by STO/material. The current frontend calls delivery-orders-v2. Its save_delivery_order_unified_atomic function writes DO sources, lines and reservations but has no consignment_note update. The inspected live PGI completion function also has no CSN update, and inspected DO/invoice/reservation triggers supply no equivalent. Existing Distribution CSNs and newly confirmed Independent CSNs both need this synchronization. This is separate from the immediate create failure; it cannot explain that header error.

3. **STO delivery type is discarded.** createSTOHandler validates delivery_type but does not save it. The header schema has no delivery_type column; later createCsnForSto falls back to STANDARD. BULK/TANKER cannot reliably carry through confirmation. The screenshot uses STANDARD, so this is not its failure cause.

4. **Creation and confirmation have partial-state risk.** Header and lines are separate committed requests; confirmation changes status before generating CSNs. Missing permissions, failed hydration or a CSN failure can therefore leave saved documents with an error response. Duplicate detection/recovery and reliable transaction boundaries require attention; do not solve retries by deleting an existing business document or silently creating another number.

5. **Distribution transform needs a separate contract check.** The transform preserves the CSN's mother/PO references and changes STO/company/vendor links, but does not explicitly switch csn_type or clear import fields as the old section 88.4 wording describes. Tracker treats a mother-linked CSN with sto_id as a normal CSN label, but still uses csn_type for import/domestic lead-time logic and prefers PO line rates when PO links remain. No live production Distribution STO exists to demonstrate the resulting display. Treat this as a code/design mismatch to resolve, not a confirmed production data incident.

## Stock / invoice checks and limits

- Production stock_health_check returned 17 rows, all bad_count=0: snapshot/ledger consistency, negative stock, orphan entries, missing ledger rows and registered partial-posting checks including SALES_INVOICE are clean.
- RM-00028 unrestricted stock in CMP003/R003 was 15,279.87 at valuation rate 60.21. This is on-hand stock, not a verified reservation-net availability figure.
- Both companies have state/GST details; no missing-state issue was found for this pair.
- service_role can execute save_delivery_order_unified_atomic, post_sales_invoice_groups_atomic, post_document and complete_pgi_invoice_action.
- Current PGI constructs P601 OUT movements and uses post_sales_invoice_groups_atomic -> post_document -> completion. Live function inspection confirms all invoice groups run within one database transaction, including stock/invoice/reservation writes. No actual PGI or receiving GRN was performed by this audit.
- Because prod has no completed STO dispatch/invoice yet, healthy current stock does not prove this entire STO end-to-end flow. The rate and CSN defects above remain blockers to calling it fully correct.
- A final read-only reservation-net query was rejected by automatic approval review because of the account usage limit. It was not retried through another route. No live changes were blocked or partially applied because this was an investigation only.

## Repair order

## Follow-up: sending and receiving company direction

Source inspection confirms the intended company direction for both New and Legacy STOs that reach the common downstream flow:

| Stage | Company source in code | Result |
|---|---|---|
| SO03 STO picker | delivery_order.handlers.ts:197 filters sending_company_id | Sending company |
| Unified DO save | do_unified.handlers.ts:1131 validates STO sender against companyId; :1207 saves selling_company_id | Sending company |
| SO02 invoice and P601 OUT | do_unified.handlers.ts:2525 onward derives companyId from DO selling_company_id; :2727 and :2799 use it | Sending company |
| Independent CSN / Distribution transform | sto.handlers.ts sets company_id to receiving_company_id, vendor_id to sending_company_id | Receiving company |
| GE STO and CSN pickers | gate_entry.handlers.ts:880 filters receiving_company_id; :778 filters CSN company_id | Receiving company |
| GRN P101 IN | grn.handlers.ts:679 validates location for GE company; :839 uses gateEntry.company_id | GE company, normally receiver |

Therefore CMP003 -> CMP005 means CMP003 DO/invoice/stock OUT and CMP005 incoming CSN/GE/stock IN. The direction itself is correct; this does not certify the complete workflow.

Additional receiving-side gaps found in source:

- createGateEntryHandler checks PO ownership but its STO branch only assigns INBOUND_STO. It does not fetch and validate the STO receiving company, STO-line ownership/material or CSN relationship. The normal picker filters correctly, but the handler lacks equivalent enforcement. No malformed production request was executed.
- GateEntryCreatePage.jsx:349 deliberately sends no po_line_id for an STO. grn.handlers.ts:637-650 resolves vendor only through a PO; it has no STO fallback to the sending company. Its insert therefore supplies null vendor for this path, and its rate fallback (:686) does not read STO transfer_price. A supplied rate can be used; automatic STO commercial inheritance is missing.
- The per-line GRN insert does not populate STO identifiers, and its receipt update (:905 onward) updates PO quantities only. There is no STO receipt update in this handler. A database-side compensating trigger was not verified live during this follow-up, so the complete STO balance outcome remains unverified.
- CSN GRN sync does exist (:947 onward) when GE contains csn_id. It cannot substitute for the missing DO dispatch sync or prove STO receipt balances are updated.

These are source findings, not an executed receiving transaction. No production DO, invoice, GE or GRN was created during the audit.

### Prioritized repairs

1. Restore the intended minimum backend privileges for the two audit tables and verify with service_role; keep public/authenticated access unchanged. Check all actual audit-log operations (read, insert and amendment approval update).
2. Recover the existing saved DRAFT through its normal confirm flow after verifying it matches the intended transaction; do not create a duplicate.
3. Fix STO transfer_price/GST propagation in unified DO and invoice preview; test both STO types with nonzero rate and GST.
4. Restore CSN synchronization in the atomic DO create/edit/cancel path, including partial dispatch and repeated material lines; preserve Distribution's existing CSN and Independent's new CSN semantics.
5. Test create-response failure/retry, confirm failure, DO edit/cancel, PGI/reversal and receiving GE/GRN in dev. Record schema/function changes separately from operational data repairs under R-04.
