import { buildFormulationRows, countBatchesInRange, type MaterialInfo } from "./mts_formulation_report.logic.ts";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const mat = (id: string, name: string, ext: string, type: string, doc: string | null = null): [string, MaterialInfo] =>
  [id, { id, material_name: name, external_code: ext, material_type: type, document_name: doc }];

const materials = new Map<string, MaterialInfo>([
  mat("sfg", "TWP SUPR", "54400908", "SFG"),
  mat("sku40", "TWP SUPR 40 KG", "544009083", "FG"),
  mat("sku20", "TWP SUPR 20 KG", "544009082", "FG"),
  mat("dol", "Dolomite 240#", "S200014", "RM"),
  mat("wcjk", "White Cement JK", "R20393G", "RM"),
  mat("wcb", "White Cement Birla", "R20512G", "RM"),
  mat("rdp", "RDP", "R31689G", "RM"),
  mat("int1", "Caustic Liquid", "INT-1", "INT"),
  mat("bag40", "Bag 40 KG", "PM0041", "PM"),
  mat("bag20", "Bag 20 KG", "PM0044", "PM"),
  mat("bag20alt", "Bag 20 KG (alt print)", "PM0046", "PM"),
]);
const strokes = new Map([["st1", "4"]]);

const processOrders = [{
  id: "po1", po_number: "9300000414", material_id: "sfg", stroke_master_id: "st1", production_date: "2026-11-12",
  planned_qty: 13000, number_of_batches: 4, batch_number_from: "ER4696", batch_number_to: "ER4699", status: "VERIFIED",
}, {
  id: "po0", po_number: "9300000413", material_id: "sfg", stroke_master_id: "st1", production_date: "2026-11-10",
  planned_qty: 100, number_of_batches: 1, batch_number_from: "ER1", batch_number_to: "ER1", status: "VERIFIED",
}];
const processLines = [
  { id: "l1", process_order_id: "po1", material_id: "dol", actual_material_id: "dol", planned_qty: 10893.7, actual_qty: 10869.7, uom_code: "KG", dosage_pct: 83.79, display_order: 1, stroke_line_id: "s1" },
  // substituted: formulation White Cement JK, actual White Cement Birla
  { id: "l2", process_order_id: "po1", material_id: "wcjk", actual_material_id: "wcb", planned_qty: 1950, actual_qty: 1950, uom_code: "KG", dosage_pct: 15, display_order: 2, stroke_line_id: "s2" },
  // split formulation line: RDP issued from two rows (same stroke_line_id), second row has planned 0
  { id: "l3", process_order_id: "po1", material_id: "rdp", actual_material_id: null, planned_qty: 156, actual_qty: 100, uom_code: "KG", dosage_pct: 1.2, display_order: 3, stroke_line_id: "s3" },
  { id: "l4", process_order_id: "po1", material_id: "rdp", actual_material_id: null, planned_qty: 0, actual_qty: 56, uom_code: "KG", dosage_pct: 1.2, display_order: 4, stroke_line_id: "s3" },
  { id: "l5", process_order_id: "po1", material_id: "int1", actual_material_id: null, planned_qty: 10, actual_qty: 10, uom_code: "KG", dosage_pct: 0.08, display_order: 5, stroke_line_id: "s4" },
];
const packingOrders = [
  { id: "k2", process_order_id: "po1", po_number: "9400000234", material_id: "sku20", batch_number_from: "ER4698", batch_number_to: "ER4699", planned_qty_kg: 5000, actual_qty_kg: 4980, status: "FINAL" },
  { id: "k1", process_order_id: "po1", po_number: "9400000233", material_id: "sku40", batch_number_from: "ER4696", batch_number_to: "ER4697", planned_qty_kg: 8000, actual_qty_kg: 7980, status: "FINAL" },
  { id: "k9", process_order_id: "po1", po_number: "9400000299", material_id: "sku40", batch_number_from: "ER4696", batch_number_to: "ER4697", planned_qty_kg: 1, actual_qty_kg: 1, status: "REVERSED" },
];
const packingLines = [
  { id: "m1", packing_order_id: "k1", line_type: "PM", material_id: "bag40", actual_material_id: null, total_qty: 200, actual_qty: 200, uom_code: "NOS", display_order: 1 },
  { id: "m2", packing_order_id: "k2", line_type: "PM", material_id: "bag20", actual_material_id: "bag20alt", total_qty: 248, actual_qty: 252, uom_code: "NOS", display_order: 1 },
  // an SFG / FG line on a Packing PO is never a report row
  { id: "m3", packing_order_id: "k1", line_type: "SFG", material_id: "sfg", actual_material_id: null, total_qty: 8000, actual_qty: 7980, uom_code: "KG", display_order: 0 },
  { id: "m4", packing_order_id: "k1", line_type: "FG", material_id: "sku40", actual_material_id: null, total_qty: 200, actual_qty: 200, uom_code: "NOS", display_order: 9 },
];

const rows = buildFormulationRows({ processOrders, processLines, packingOrders, packingLines, materials, strokes });
const byKey = new Map(rows.map((r) => [r.key, r]));

// order: newest production first; inside a PO the Process block comes before the Packing blocks, sorted by batch
assertEqual(rows[0].po_number, "9300000414", "newest PO first");
assertEqual(rows[rows.length - 1].po_number, "9300000413", "older PO last");
assertEqual(rows.filter((r) => r.po_number !== "9300000413").map((r) => r.po_kind + ":" + r.line_type).join(","),
  "Process:SFG,Process:RM,Process:RM,Process:RM,Process:RM,Process:INT,Packing:FG,Packing:PM,Packing:FG,Packing:PM", "block layout");

// SFG row: standard = PO planned qty, actual = sum of the non-reversed Packing POs' actual kg
const sfg = byKey.get("P:po1:out")!;
assertEqual(sfg.used_for_kind + " " + sfg.used_for_code, "SFG 54400908", "SFG code");
assertEqual(sfg.formulation_qty, 13000, "SFG standard");
assertEqual(sfg.actual_qty, 12960, "SFG actual excludes the REVERSED pack");
assertEqual(sfg.variance, -40, "SFG variance");
assertEqual(sfg.from_batch + ">" + sfg.to_batch + " x" + sfg.batch_count, "ER4696>ER4699 x4", "process batches");
assertEqual(sfg.stroke_number, "4", "stroke");

// RM: used for the SFG, never the SKU; plain line variance
const dol = byKey.get("P:po1:l1")!;
assertEqual(dol.used_for_kind + " " + dol.used_for_code, "SFG 54400908", "RM -> SFG code");
assertEqual(dol.variance, -24, "RM variance");
assertEqual(dol.dosage_pct, 83.79, "dosage");
assertEqual(dol.substituted, false, "not substituted");

// substitution is flagged and the actual material / code are the issued ones
const wc = byKey.get("P:po1:l2")!;
assertEqual(wc.substituted, true, "substituted");
assertEqual(wc.formulation_material + " -> " + wc.actual_material, "White Cement JK -> White Cement Birla", "substitution names");
assertEqual(wc.actual_external_code, "R20512G", "actual code");

// split line: only the first row has a formulation qty, no variance on any split row
assertEqual(byKey.get("P:po1:l3")!.formulation_qty, 156, "split first row std");
assertEqual(byKey.get("P:po1:l4")!.formulation_qty, null, "split later row std");
assertEqual(byKey.get("P:po1:l3")!.variance, null, "split first row variance");
assertEqual(byKey.get("P:po1:l4")!.variance, null, "split later row variance");
assertEqual(byKey.get("P:po1:l5")!.line_type, "INT", "INT keeps its type");

// Packing: SKU row + only its own PM, all used for the SKU code; own PO number and batch range
const fg40 = byKey.get("K:k1:out")!;
assertEqual(fg40.used_for_kind + " " + fg40.used_for_code, "SKU 544009083", "SKU code");
assertEqual(fg40.po_number, "9400000233", "packing PO number");
assertEqual(fg40.batch_count, 2, "packing batch count");
assertEqual(fg40.variance, -20, "FG variance");
const bag20 = byKey.get("K:k2:m2")!;
assertEqual(bag20.used_for_kind + " " + bag20.used_for_code, "SKU 544009082", "PM -> its own SKU code");
assertEqual(bag20.substituted, true, "PM substituted");
assertEqual(bag20.variance, 4, "PM variance");
assertEqual(byKey.has("K:k1:m3"), false, "no SFG row in the Packing block");
assertEqual(byKey.has("K:k1:m4"), false, "no FG line row either");
assertEqual(byKey.has("K:k9:out"), false, "reversed Packing PO is skipped");

// a Process PO with no Packing PO has no actual SFG output yet
const noPack = byKey.get("P:po0:out")!;
assertEqual(noPack.actual_qty, null, "no pack -> no actual");
assertEqual(noPack.variance, null, "no pack -> no variance");

assertEqual(countBatchesInRange("ER3309", "ER3335"), 27, "range length");
assertEqual(countBatchesInRange("ER10", "ER9"), null, "reversed range");
assertEqual(countBatchesInRange("A1", "B2"), null, "different prefix");

console.log("mts_formulation_report.logic tests passed");
