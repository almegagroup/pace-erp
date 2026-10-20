import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupedRows } from "./mtsPlanGrouping.js";

const row = (sku, type, qty) => ({ row_key: `${sku}|${type}`, sku_label: sku, prodshade_material_id: "PS1", prodshade_label: "PS1", mother_group_name: "M", child_group_name: "C", row_type: type, qty, base_uom_code: "KG" });
const fields = [{ key: "m_1", total: (r) => ({ qty: r.qty, unit: r.base_uom_code }) }];

test("totals are split per row type and never summed together (owner 2026-10-20)", () => {
  const rows = [row("A", "PLAN", 100), row("A", "PRODUCTION", 80), row("B", "PLAN", 50), row("B", "DISPATCH", 30)];
  const out = buildGroupedRows(rows, fields, (r) => r.base_uom_code, { splitBy: (r) => r.row_type });
  const totals = out.filter((r) => r.__total).map((r) => [r.__total, r.row_type, r.sums.m_1.KG]);
  assert.deepEqual(totals.filter(([kind]) => kind === "PRODSHADE"), [["PRODSHADE", "PLAN", 150], ["PRODSHADE", "PRODUCTION", 80], ["PRODSHADE", "DISPATCH", 30]]);
  assert.deepEqual(totals.filter(([kind]) => kind === "MOTHER").map(([, t, q]) => [t, q]), [["PLAN", 150], ["PRODUCTION", 80], ["DISPATCH", 30]]);
  assert.equal(new Set(out.map((r) => r.row_key)).size, out.length, "unique row keys");
});

test("without splitBy the old single total is unchanged", () => {
  const out = buildGroupedRows([row("A", "PLAN", 100), row("B", "PLAN", 50)], fields, (r) => r.base_uom_code);
  const ps = out.find((r) => r.__total === "PRODSHADE");
  assert.equal(ps.row_key, "__total|PRODSHADE|M|C|PS1");
  assert.equal(ps.sums.m_1.KG, 150);
  assert.equal(ps.row_type, undefined);
});
