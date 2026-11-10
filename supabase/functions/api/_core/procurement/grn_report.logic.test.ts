import { filterGrnReportRows, type GrnReportRow } from "./grn_report.logic.ts";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const row = (over: Partial<GrnReportRow> = {}): GrnReportRow => ({
  id: "g1", status: "POSTED", material_id: "m1", material_type: "RM", ...over,
});

Deno.test("no filter keeps every row", () => {
  const rows = [row(), row({ id: "g2", status: "REVERSED" })];
  assertEqual(filterGrnReportRows(rows, { statuses: [], materialIds: [], materialTypes: [] }).length, 2, "all kept");
});

Deno.test("status filter keeps only the chosen statuses", () => {
  const rows = [row(), row({ id: "g2", status: "REVERSED" }), row({ id: "g3", status: "SPLIT" })];
  const kept = filterGrnReportRows(rows, { statuses: ["POSTED", "SPLIT"], materialIds: [], materialTypes: [] });
  assertEqual(kept.map((r) => r.id).join(","), "g1,g3", "posted + split");
});

Deno.test("material id filter keeps only the chosen materials", () => {
  const rows = [row(), row({ id: "g2", material_id: "m2" })];
  assertEqual(filterGrnReportRows(rows, { statuses: [], materialIds: ["m2"], materialTypes: [] }).map((r) => r.id).join(","), "g2", "m2 only");
});

Deno.test("item type filter is case-insensitive and drops rows whose material is unknown", () => {
  const rows = [row(), row({ id: "g2", material_type: "PM" }), row({ id: "g3", material_type: null })];
  const kept = filterGrnReportRows(rows, { statuses: [], materialIds: [], materialTypes: ["rm"] });
  assertEqual(kept.map((r) => r.id).join(","), "g1", "RM only; the unknown-material row is not guessed into RM");
});

Deno.test("all three filters combine with AND", () => {
  const rows = [row(), row({ id: "g2", status: "REVERSED" }), row({ id: "g3", material_id: "m2" })];
  const kept = filterGrnReportRows(rows, { statuses: ["POSTED"], materialIds: ["m1"], materialTypes: ["RM"] });
  assertEqual(kept.map((r) => r.id).join(","), "g1", "only g1 matches all three");
});
