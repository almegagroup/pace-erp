/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/bulkDoUploadIdentity.js
 * Purpose: Canonical client-side identities for Bulk DO spreadsheet review.
 *          A single FO/SO can legitimately be dispatched more than once, so
 *          FO/SO + SKU + quantity is not a shipment or duplicate identity.
 */

export function normalizedBulkDoKeyPart(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizedBulkDoQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity.toFixed(6) : normalizedBulkDoKeyPart(value);
}

function rawValue(row, raw, field) {
  return raw?.[field] ?? row?.[field] ?? "";
}

/**
 * One Delivery Order has one common header.  Keep rows with the same source
 * reference but a different LR, invoice/IBN, truck or date in separate DOs.
 */
export function bulkDoShipmentKey(row, raw = {}) {
  return [
    rawValue(row, raw, "fo_or_so_number"),
    rawValue(row, raw, "do_date"),
    rawValue(row, raw, "transporter_name"),
    rawValue(row, raw, "lr_number"),
    rawValue(row, raw, "lr_date"),
    rawValue(row, raw, "tally_invoice_number"),
    rawValue(row, raw, "tally_invoice_date"),
    rawValue(row, raw, "inbound_number"),
    rawValue(row, raw, "truck_number"),
    rawValue(row, raw, "dispatch_date"),
  ].map(normalizedBulkDoKeyPart).join("::");
}

/**
 * A removable Excel duplicate must repeat the whole shipment header and the
 * line itself.  A same-SKU/quantity shipment on a later LR/invoice is valid.
 */
export function bulkDoSpreadsheetLineKey(row, raw = {}) {
  return [
    bulkDoShipmentKey(row, raw),
    rawValue(row, raw, "sku"),
    normalizedBulkDoQuantity(rawValue(row, raw, "pack_qty")),
    rawValue(row, raw, "storage_location_code"),
  ].map(normalizedBulkDoKeyPart).join("::");
}
