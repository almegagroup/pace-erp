Production data correction, 2026-09-12

User authorized changing CMP006 Customer PO 11411779 FG sales rate to INR 7275.80 and updating dependent SO/DO commercial amounts before invoicing.

Project: bsjpvkigpllichlknmah (pace-erp)
SO: 9000000271 / bd8260d6-a6c1-4035-9a4f-d524aa744af7
SO line: ebc9572c-fdce-4a58-96ed-5611601e5596
DO: 9100000262 / cfb9421b-f8c6-4a7f-9a5c-5b8fed32c70c
DO line: d5d230af-2c0f-4dcb-956b-31558c0fa470
FG: FG-00379 / 6765SS06599
Quantity: 22 BBL, 230 KG per BBL, 5060 KG total.

Committed one transaction with row locks, identity/state/value guards, invoice absence checks and post-update assertions.

Old SO rate/net_rate 5231.60; GST 20717.136; CGST/SGST 10358.568 each; total 135812.336.
Old DO display_rate 5231.60; unit_value 22.7461; GST 20717.136; line_total 135812.336; header total_value NULL.

New SO rate/net_rate and DO display_rate 7275.80 per BBL.
New assessable value 160067.60; GST 28812.168; CGST/SGST 14406.084 each; IGST 0; SO/DO total 188879.768.
DO unit_value is 31.6339 per KG (numeric scale 4).
Updated sales_order and sales_order_line timestamps. Existing quantities, reservations, stock and document statuses retained.
Checked related tables: no existing invoices/invoice lines, manual costing entry, gate exit or dispatch reconciliation. Reservation contains quantities only.

Outstanding invoice calculation issue identified in current repository code:
do_unified.handlers.ts computes invoice assessable value as quantity * rounded DO unit_value, yielding 160067.534 instead of 160067.60 (difference 0.066).
Correct amount remains available as DO line_total - gst_amount and pack_qty * display_rate.
No application code or schema change made during this production data correction. Do not describe invoice calculation as fully verified/ready until this rounding issue is resolved.
