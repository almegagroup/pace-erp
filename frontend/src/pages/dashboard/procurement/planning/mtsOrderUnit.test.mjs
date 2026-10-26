import test from "node:test";
import assert from "node:assert/strict";
import { makeDisplayUnits, qtyInDisplayUnit } from "./mtsOrderUnit.js";

test("PO22 display unit: a KG material with BAG 25 shows only bags; others stay in base", () => {
  const du = makeDisplayUnits({ SILRES: { uom_code: "BAG", base_per_unit: 25 } });
  assert.equal(du.qty(1400, "SILRES"), 56);
  assert.equal(du.uom("SILRES", "KG"), "BAG");
  assert.equal(du.qty(1400, "OTHER"), 1400);
  assert.equal(du.uom("OTHER", "KG"), "KG");
  assert.equal(qtyInDisplayUnit(1400, "KG", du.unitOf("SILRES")), "56 BAG");
  assert.equal(qtyInDisplayUnit(1400, "KG", null), "1,400 KG");
});

test("PO22 display unit: a lot's vendor order unit wins over the material display unit", () => {
  assert.equal(qtyInDisplayUnit(20000, "KG", { order_uom_code: "MT", base_per_order_unit: 1000 }), "20 MT");
});

test("PO22 display unit: a group shows one unit only when every member shares it", () => {
  const du = makeDisplayUnits({ A: { uom_code: "BAG", base_per_unit: 25 }, B: { uom_code: "BAG", base_per_unit: 25 }, C: { uom_code: "BAG", base_per_unit: 20 } });
  assert.deepEqual(du.groupUnit(["A", "B"]), { uom_code: "BAG", base_per_unit: 25 });
  assert.equal(du.groupUnit(["A", "C"]), null);
  assert.equal(du.groupUnit(["A", "X"]), null);
});
