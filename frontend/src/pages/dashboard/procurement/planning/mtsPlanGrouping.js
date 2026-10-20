/*
 * MTS Customer Plan — Product Group ordering and total rows (owner, 2026-10-15).
 *
 * Row order is always ascending: Mother group → Child group → Prodshade → SKU.
 * Prodshades that are not in any group come last.
 * After every Prodshade a Prodshade total row, after every Child group a Child
 * total row, after every Mother group a Mother total row, and a Grand total.
 *
 * Quantities are only added inside one unit — a KG SKU and a litre SKU are
 * never summed together; a total that mixes units shows each unit separately.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const compareText = (a, b) => collator.compare(String(a ?? ""), String(b ?? ""));

export const NOT_GROUPED_LABEL = "Not grouped";

const TOTAL_ROW_CLASS = {
  PRODSHADE: "bg-slate-100 font-semibold",
  CHILD: "bg-sky-100 font-semibold",
  MOTHER: "bg-amber-100 font-semibold",
  GRAND: "bg-emerald-100 font-bold",
};

export function compareByGroup(a, b) {
  const aGrouped = a.mother_group_name ? 0 : 1;
  const bGrouped = b.mother_group_name ? 0 : 1;
  return (aGrouped - bGrouped)
    || compareText(a.mother_group_name, b.mother_group_name)
    || compareText(a.child_group_name, b.child_group_name)
    || compareText(a.prodshade_label, b.prodshade_label)
    || compareText(a.sku_label, b.sku_label);
}

function fmtNumber(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function addTo(sums, key, value) {
  if (!value || value.qty === null || value.qty === undefined || value.qty === "") return;
  const qty = Number(value.qty);
  if (!Number.isFinite(qty)) return;
  const unit = value.unit || "";
  const bucket = (sums[key] ??= {});
  bucket[unit] = (bucket[unit] ?? 0) + qty;
}

/** Display text for a total cell: "1,200" (one unit) or "1,200 KG · 50 L". */
export function formatUnitSums(bucket) {
  const entries = Object.entries(bucket ?? {});
  if (entries.length === 0) return "";
  if (entries.length === 1) return fmtNumber(entries[0][1]);
  return entries.map(([unit, qty]) => `${fmtNumber(qty)} ${unit}`.trim()).join(" · ");
}

/** Number for Excel when the total has one unit, else the display text. */
export function exportUnitSums(bucket) {
  const entries = Object.entries(bucket ?? {});
  if (entries.length === 0) return "";
  return entries.length === 1 ? Number(entries[0][1]) : formatUnitSums(bucket);
}

function makeTotal(kind, key, label, sample, sums, units, split = null) {
  return {
    __total: kind,
    row_key: `__total|${kind}|${key}${split === null ? "" : `|${split}`}`,
    row_type: split ?? undefined,
    total_label: label,
    mother_group_name: kind === "GRAND" ? "" : (sample.mother_group_name ?? (kind === "MOTHER" ? NOT_GROUPED_LABEL : "")),
    child_group_name: kind === "CHILD" || kind === "PRODSHADE" ? (sample.child_group_name ?? "") : "",
    prodshade_label: kind === "PRODSHADE" ? sample.prodshade_label : "",
    unit_label: units.size === 1 ? [...units][0] : units.size > 1 ? "Mixed" : "",
    sums,
  };
}

/**
 * @param rows      SKU rows (each with mother/child group names, prodshade_label, sku_label)
 * @param fields    [{ key, total: (row) => ({ qty, unit }) | null }]
 * @param unitOf    (row) => unit shown in the UoM column of a total row
 * @param options   { splitBy?: (row) => string } — separate total rows per value (e.g. PLAN /
 *                  PRODUCTION / DISPATCH), never summed together; in first-seen order.
 */
export function buildGroupedRows(rows, fields, unitOf, options = {}) {
  const sorted = [...rows].sort(compareByGroup);
  const out = [];
  const splitOf = options.splitBy ?? (() => null);
  const level = () => ({ sums: {}, units: new Set(), sample: null, key: null, bySplit: new Map() });
  let ps = level();
  let child = level();
  let mother = level();
  const grand = level();

  const push = (acc, row) => {
    acc.sample ??= row;
    const split = splitOf(row);
    const bucket = acc.bySplit.get(split) ?? { sums: {}, units: new Set() };
    for (const field of fields) addTo(bucket.sums, field.key, field.total(row));
    const unit = unitOf?.(row);
    if (unit) bucket.units.add(unit);
    acc.bySplit.set(split, bucket);
  };
  const emit = (kind, acc, label) => {
    for (const [split, bucket] of acc.bySplit) out.push(makeTotal(kind, `${acc.key}`, label, acc.sample, bucket.sums, bucket.units, split));
  };
  const flushProdshade = () => {
    if (!ps.sample) return;
    emit("PRODSHADE", ps, "Prodshade Total");
    ps = level();
  };
  const flushChild = () => {
    if (!child.sample) return;
    if (child.sample.child_group_name) {
      emit("CHILD", child, "Child Group Total");
    }
    child = level();
  };
  const flushMother = () => {
    if (!mother.sample) return;
    emit("MOTHER", mother, mother.sample.mother_group_name ? "Mother Group Total" : `${NOT_GROUPED_LABEL} Total`);
    mother = level();
  };

  for (const row of sorted) {
    const motherKey = row.mother_group_name ?? "";
    const childKey = `${motherKey}|${row.child_group_name ?? ""}`;
    const psKey = `${childKey}|${row.prodshade_material_id ?? row.prodshade_label ?? ""}`;
    if (ps.sample && ps.key !== psKey) flushProdshade();
    if (child.sample && child.key !== childKey) { flushProdshade(); flushChild(); }
    if (mother.sample && mother.key !== motherKey) { flushProdshade(); flushChild(); flushMother(); }
    ps.key = psKey; child.key = childKey; mother.key = motherKey;
    out.push(row);
    push(ps, row); push(child, row); push(mother, row); push(grand, row);
  }
  flushProdshade(); flushChild(); flushMother();
  if (grand.sample) { grand.key = "all"; emit("GRAND", grand, "Grand Total"); }
  return out;
}

export function totalRowProps(row) {
  return row?.__total ? { className: TOTAL_ROW_CLASS[row.__total] ?? "font-semibold" } : {};
}

/**
 * Wraps grid columns so total rows render their label / sums instead of the
 * SKU-row renderers. A column opts into a total with `total: (row) => ({ qty, unit })`.
 */
export function withTotalCells(columns) {
  return columns.map((column) => {
    const renderTotal = (row) => {
      if (column.total) return formatUnitSums(row.sums?.[column.key]);
      if (column.key === "sku_label") return row.total_label;
      if (["mother_group_name", "child_group_name", "prodshade_label"].includes(column.key)) return row[column.key] ?? "";
      if (column.totalUnit) return row.unit_label;
      if (column.key === "row_type") return row.row_type ?? "";
      return "";
    };
    return {
      ...column,
      render: (row, index) => (row.__total
        ? renderTotal(row)
        : (typeof column.render === "function" ? column.render(row, index) : (row?.[column.key] ?? ""))),
      copyValue: (row) => (row.__total
        ? (column.total ? exportUnitSums(row.sums?.[column.key]) : renderTotal(row))
        : (typeof column.copyValue === "function" ? column.copyValue(row) : row?.[column.key])),
    };
  });
}

export const GROUP_COLUMNS = [
  { key: "mother_group_name", label: "Mother Group", width: "160px", render: (r) => r.mother_group_name || NOT_GROUPED_LABEL, filterValue: (r) => r.mother_group_name || NOT_GROUPED_LABEL },
  { key: "child_group_name", label: "Child Group", width: "160px", render: (r) => r.child_group_name || NOT_GROUPED_LABEL, filterValue: (r) => r.child_group_name || NOT_GROUPED_LABEL },
];
