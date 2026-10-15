# Historical Procurement Source Mapping

Source workbook: **ALMEGA - Supply Chain File**
(`1tUoPMEOglPkY7nHvMTtvR-27YCCxM0THYXnc7dbgkEA`), inspected 2026-10-15.
The workbook timezone is Asia/Calcutta.

## Approved source tabs

| Workbook tab | History target | Source values retained |
| --- | --- | --- |
| `PO_SHEET` | `erp_history.purchase_order`, `purchase_order_line` | Order/revised order number, order date, supplier, item, quantity/unit, supply type, schedule ETA/ETD, payment terms/days, rate/currency, source row. |
| `MVT_TRACKER` | `erp_history.consignment_movement` | PO line/order reference, dispatch quantity, ETD/ATD, BL/invoice/BOE/LR/inward/MDN dates and numbers, actual movement status, source row. |
| `Product_Data_Base` | extractor-side material/vendor mapping reference | Supplier, item/category, area/unit, supply type, prefix and lead-time defaults. It is not an independent transaction fact import. |

`MOVEMENT_TRACKER` is a hidden derived/query view and must **not** be imported:
it would duplicate `MVT_TRACKER` movement facts.

## Mapping and validation rules

- Extractors submit `external_sku` as text. Leading zeroes are never converted
  through a spreadsheet number.
- A material/vendor is mapped only with a unique verified ERP match. No match
  or multiple matches becomes an `erp_history.import_exception`, with original
  source values preserved.
- One PO header may have many imported PO lines; one line may have many
  consignment movements. Invoice or BL number alone is never used as a unique
  movement key.
- `Dispatch Date`, `ATD`, `ATA`, `BOE`, `LR`, and `Inward Date` are distinct
  source fields. Scheduled ETA is never promoted to actual arrival.
- Historical dates after 2026-09-30 are rejected. Historical cancelled rows
  remain traceable but are excluded from valid movement and lead-time totals.
- Browser code never reads Google Sheets. An authorised server-side extractor
  sends a reviewed JSON payload through the historical import API; the actual
  backfill remains separately authorised.
