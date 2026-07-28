# PROD ACL — Final Access Decisions (page-by-page, business owner dictated)

> Process (locked 2026-07-27): go group by group, page by page. For each page:
> tx_code + what it does is shown; business owner says who gets View / Create /
> Edit / Approve / Delete. Nothing gets implemented in prod until a group is
> fully decided here — this file is the single source of truth for prod ACL
> from this point on (supersedes ad-hoc conversational changes made earlier
> the same day, which were found to be inconsistent/leaky and are being
> redone properly through this doc).

Departments in play: **SCM (Supply Chain), Accounts, Production, Quality (QA),
Stores, Security, Management, Director, Auditor.**

Legend: V=View, C=Create, E=Edit, A=Approve, D=Delete. Blank = no access.

---

## Group 1 — Operation Masters

Status: ⬜ In progress

| tx_code | Page | What it does | SCM | Accounts | Production | QA | Stores | Security | Management | Director | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MM01 | Materials | Material master (RM/PM/FG/SFG/INT) — create/edit/view materials | | | | | | | | | |
| MM02 | Vendors | Vendor master — create/edit/view suppliers | | | | | | | | | |
| MM03 | Vendor-Material Links | Which vendor supplies which material, at what rate/UOM (ASL) | | | | | | | | | |
| MM04 | RM/PM Sales Customer | Customer master (for RM/PM sales side only) | | | | | | | | | |
| PM04 | Material Categories | Category groups — backs Stroke Master's Alternate Material picker | | | | | | | | | |

**Notes:**

---

## Group 2 — Procurement Masters (⬜ not started)
PM01 Payment Terms, PM02 Ports, PM03 Port Transit Times, PM05 Lead Times, PM06 Transporters, PM07 Customs House Agents

## Group 3 — Procurement (⬜ not started)
PO01 Purchase Orders, PO02 CSN Tracker, PO03 CSN Alerts, PO07 Stock Transfer Orders, PO11 Procurement Planning, PO12 Plant Transfers, PO13 Pending Order Approvals, PO14 Old Purchase Order, PO16 Legacy STO

## Group 4 — Receiving (⬜ not started)
PO04 Gate Entries, PO05 Goods Receipts, PO17 Gate Exit, PO18 Gate Entry Report

## Group 5 — Quality Assurance (⬜ not started)
PO06 QA Inspection Queue, PR01 Stroke Master, PR02 Stroke Approval, PR03 Change BOM Item, PR04 Change BOM Approval, PR12 PO Verify, PR15 Reversal, PR16 QA Approval Queue, PR17 Batch Number Release, PR18 SFG Result Recording, PR19 Partial Batch Reversal

## Group 6 — Returns & Claims (⬜ not started)
PO08 Return to Vendor, PO09 Debit Notes, PO10 Exchange References

## Group 7 — Accounts (⬜ not started)
AC01 Invoice Verifications, AC02 Blocked Invoices, AC03 Landed Costs, AC04 Conversion Cost Config

## Group 8 — Sales (⬜ not started)
SO01 Sales Orders, SO02 Sales Invoices

## Group 9 — Inventory (⬜ not started)
IN01 Physical Inventory, IN02 Stock Ledger, IN03 Current Stock, IN04 Stock Valuation, IN05 Opening Stock, IN06 Opening Stock Approval, PR21 FG Stock Breakdown

## Group 10 — Production (⬜ not started)
PR00 Plan Feed, PR05 Pack BOM Create, PR06 Pack BOM Approval, PR07 Change Pack BOM, PR08 Change Pack BOM Approval, PR09 Production PO Create, PR10 Production PO Edit, PR11 Production PO Final, PR13 Order List, PR14 Batch Variance Report, PR20 Partial Reversal Report, PR22 Old Process PO, PR23 Old Packing PO
