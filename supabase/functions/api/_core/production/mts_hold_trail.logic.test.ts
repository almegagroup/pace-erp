import {
  buildTrailEvents,
  computeHeldSummary,
  filterEventsByStatus,
  type HoldRow,
  type SscRow,
} from "./mts_hold_trail.logic.ts";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const hold = (over: Partial<HoldRow> = {}): HoldRow => ({
  id: "h1", company_id: "c1", process_order_id: "po1", process_order_number: "930001", process_order_status: "VERIFIED",
  packing_order_number: "940001", material_id: "sku1", batch_number: "B1", batch_number_from: "B1", batch_number_to: "B3",
  target_stock_type: "QUALITY_INSPECTION", declared_pack_qty: 100, held_pack_qty: 50, qty_kg: 1250,
  reason: "visual defect", created_by: "u1", created_at: "2026-11-01T10:00:00Z", ...over,
});

const ssc = (over: Partial<SscRow> = {}): SscRow => ({
  id: "s1", document_number: "SSC1", company_id: "c1", material_id: "sku1", storage_location_id: "l1",
  batch_number: null, packing_po_number: null, from_stock_type: "QUALITY_INSPECTION", to_stock_type: "UNRESTRICTED",
  quantity: 400, uom_code: "KG", reason: "re-tested OK", status: "POSTED", requires_approval: false,
  reversal_of_posting_id: null, created_by: "u2", created_at: "2026-11-05T09:00:00Z", approved_by: null, approved_at: null, ...over,
});

Deno.test("legacy hold without a reason shows an em dash, not blank", () => {
  const [event] = buildTrailEvents([hold({ reason: null })], []);
  assertEqual(event.reason, null, "raw reason stays null");
  assertEqual(event.reason_display, "—", "display");
});

Deno.test("hold of a reversed Process PO is marked reversed", () => {
  const [event] = buildTrailEvents([hold({ process_order_status: "REVERSED" })], []);
  assertEqual(event.state, "Reversed with Process PO", "state");
});

Deno.test("hold event carries bags, kg, from/to and the Process/Packing PO", () => {
  const [event] = buildTrailEvents([hold()], []);
  assertEqual(event.event_type, "HOLD", "type");
  assertEqual(event.from_stock_type, "UNRESTRICTED", "from");
  assertEqual(event.to_stock_type, "QUALITY_INSPECTION", "to");
  assertEqual(event.bags, 50, "bags");
  assertEqual(event.qty_kg, 1250, "kg");
  assertEqual(event.process_order_number, "930001", "process po");
  assertEqual(event.packing_order_number, "940001", "packing po");
  assertEqual(event.state, "Active", "state");
});

Deno.test("a status row written by Verify (it carries a batch) is not a second STATUS CHANGE event", () => {
  const events = buildTrailEvents([], [ssc({ batch_number: "B1", from_stock_type: "UNRESTRICTED", to_stock_type: "QUALITY_INSPECTION" })]);
  assertEqual(events.length, 0, "no duplicate of the hold");
});

Deno.test("an IN13 aggregate row into/out of QI or Blocked is a STATUS CHANGE event", () => {
  const events = buildTrailEvents([], [ssc()]);
  assertEqual(events.length, 1, "one event");
  assertEqual(events[0].event_type, "STATUS_CHANGE", "type");
  assertEqual(events[0].qty_kg, 400, "kg");
  assertEqual(events[0].state, "Posted", "state");
  assertEqual(events[0].document_number, "SSC1", "document");
});

Deno.test("an IN13 row that touches neither QI nor Blocked is not part of the trail", () => {
  const events = buildTrailEvents([], [ssc({ from_stock_type: "UNRESTRICTED", to_stock_type: "UNRESTRICTED" })]);
  assertEqual(events.length, 0, "ignored");
});

Deno.test("events are newest first", () => {
  const events = buildTrailEvents([hold()], [ssc()]);
  assertEqual(events[0].event_type, "STATUS_CHANGE", "later event first");
  assertEqual(events[1].event_type, "HOLD", "earlier event last");
});

Deno.test("status filter keeps events that involve the chosen status", () => {
  const events = buildTrailEvents([hold({ target_stock_type: "BLOCKED" })], [ssc()]);
  assertEqual(filterEventsByStatus(events, ["BLOCKED"]).length, 1, "only the hold involves BLOCKED");
  assertEqual(filterEventsByStatus(events, ["QUALITY_INSPECTION"]).length, 1, "only the release involves QI");
  assertEqual(filterEventsByStatus(events, []).length, 2, "none chosen = all");
});

Deno.test("summary: QI -> Unrestricted subtracts from QI", () => {
  const rows = [
    ssc({ id: "a", batch_number: "B1", from_stock_type: "UNRESTRICTED", to_stock_type: "QUALITY_INSPECTION", quantity: 1000 }),
    ssc({ id: "b", from_stock_type: "QUALITY_INSPECTION", to_stock_type: "UNRESTRICTED", quantity: 400 }),
  ];
  const [row] = computeHeldSummary(rows);
  assertEqual(row.qi_kg, 600, "qi");
  assertEqual(row.blocked_kg, 0, "blocked");
});

Deno.test("summary: a reversed posting and its reversal row are both left out (never counted twice)", () => {
  const rows = [
    ssc({ id: "a", from_stock_type: "UNRESTRICTED", to_stock_type: "BLOCKED", quantity: 500, status: "REVERSED" }),
    ssc({ id: "r", from_stock_type: "BLOCKED", to_stock_type: "UNRESTRICTED", quantity: 500, status: "POSTED", reversal_of_posting_id: "a" }),
  ];
  assertEqual(computeHeldSummary(rows).length, 0, "SKU with nothing held has no summary row");
});

Deno.test("summary ignores pending-approval and draft rows", () => {
  const rows = [ssc({ from_stock_type: "BLOCKED", to_stock_type: "UNRESTRICTED", quantity: 300, status: "PENDING_APPROVAL" })];
  assertEqual(computeHeldSummary(rows).length, 0, "nothing posted yet");
});

Deno.test("summary keeps the same SKU in two companies apart", () => {
  const rows = [
    ssc({ id: "a", company_id: "c1", from_stock_type: "UNRESTRICTED", to_stock_type: "BLOCKED", quantity: 100 }),
    ssc({ id: "b", company_id: "c2", from_stock_type: "UNRESTRICTED", to_stock_type: "BLOCKED", quantity: 40 }),
  ];
  const summary = computeHeldSummary(rows).sort((left, right) => left.company_id.localeCompare(right.company_id));
  assertEqual(summary.length, 2, "one row per company");
  assertEqual(summary[0].company_id, "c1", "first company");
  assertEqual(summary[0].blocked_kg, 100, "c1 blocked");
  assertEqual(summary[1].blocked_kg, 40, "c2 blocked");
});

Deno.test("summary row carries the date of the latest posted status change that built the balance", () => {
  const rows = [
    ssc({ id: "a", from_stock_type: "UNRESTRICTED", to_stock_type: "BLOCKED", quantity: 100, created_at: "2026-10-10T08:00:00Z" }),
    ssc({ id: "b", from_stock_type: "UNRESTRICTED", to_stock_type: "BLOCKED", quantity: 50, created_at: "2026-11-02T08:00:00Z" }),
    // a reversed posting is ignored, so its (later) date must not become the "last event"
    ssc({ id: "c", from_stock_type: "UNRESTRICTED", to_stock_type: "BLOCKED", quantity: 10, status: "REVERSED", created_at: "2026-11-09T08:00:00Z" }),
  ];
  const [row] = computeHeldSummary(rows);
  assertEqual(row.blocked_kg, 150, "balance");
  assertEqual(row.last_event_at, "2026-11-02T08:00:00Z", "latest counted event");
});
