import assert from "node:assert/strict";
import test from "node:test";
import { bulkDoShipmentKey, bulkDoSpreadsheetLineKey } from "./bulkDoUploadIdentity.js";

const row7 = {
  fo_or_so_number: "0011421010", do_date: "2026-10-06", transporter_name: "Jain Cargo Movers",
  lr_number: "277123", lr_date: "2026-10-06", sku: "00790908340", pack_qty: 275,
  storage_location_code: "F001", tally_invoice_number: "JI/26-27/1408/EX", tally_invoice_date: "2026-10-06",
  inbound_number: "5005544044", truck_number: "AS01L9844", dispatch_date: "2026-10-06",
};

test("keeps a later shipment of the same FO, SKU and quantity separate", () => {
  const row12 = {
    ...row7,
    do_date: "2026-10-07", lr_number: "277125", lr_date: "2026-10-07",
    tally_invoice_number: "JI/26-27/1412/EX", tally_invoice_date: "2026-10-07",
    inbound_number: "5005540356", truck_number: "AS01DD2421", dispatch_date: "2026-10-07",
  };
  assert.notEqual(bulkDoShipmentKey(row7), bulkDoShipmentKey(row12));
  assert.notEqual(bulkDoSpreadsheetLineKey(row7), bulkDoSpreadsheetLineKey(row12));
});

test("marks only an exact repeated shipment line as a spreadsheet duplicate", () => {
  assert.equal(bulkDoSpreadsheetLineKey(row7), bulkDoSpreadsheetLineKey({ ...row7 }));
  assert.notEqual(bulkDoSpreadsheetLineKey(row7), bulkDoSpreadsheetLineKey({ ...row7, storage_location_code: "F002" }));
});

test("groups different SKUs with one common shipment header into one DO", () => {
  assert.equal(bulkDoShipmentKey(row7), bulkDoShipmentKey({ ...row7, sku: "54400908340", pack_qty: 500 }));
});
