// §144 (feasibility doc) — MTO/HPS/MTEST/INT Process PO Standard, Page 3 Material Table.
//
// Pure derivation of the table rows from (stroke lines, batch size, what the user picked,
// live availability). Quantities are NEVER stored in React state: the user only picks an
// item and a storage location per row, and every row's qty is recomputed from balances in
// order — so there is no stale-qty / effect-ordering bug to have.
//
// Rule recap (business owner, 2026-10-07):
//  - Every stroke line starts with ONE row: formulation item at the stroke's default location.
//  - A line that has a registered alternate / material group may be split: while the rows so
//    far do not cover the line's Standard Qty, a blank row appears directly under it. The user
//    picks an item from THAT line's own group + a location; the system fills
//    min(balance of that item at that location, still-uncovered Standard).
//  - A line without alternates keeps a single row (location still choosable); if it is short
//    it stays red and blocks Create exactly as before.
//  - The same (item, location) balance is shared across all rows/lines: what an earlier row
//    already takes is not available to a later one.

export const SPLIT_COVERAGE_TOLERANCE = 0.0005;

const round6 = (value) => Number(Number(value || 0).toFixed(6));

export function splitRowKey(materialId, locationId) {
  return `${materialId}::${locationId}`;
}

/** Alternate options for one stroke line: registered alternate + material-group members, never the formulation item itself. */
export function buildAlternateOptions(line, materialLabel) {
  const options = [];
  const seen = new Set();
  if (line.alternate_material_id) {
    const alternateId = String(line.alternate_material_id);
    seen.add(alternateId);
    options.push({ value: alternateId, label: materialLabel(line.alternate_material) || "Registered alternate" });
  }
  for (const member of line.material_group?.members ?? []) {
    const memberId = String(member.material_id ?? "");
    if (!memberId || memberId === String(line.material_id) || seen.has(memberId)) continue;
    seen.add(memberId);
    options.push({ value: memberId, label: materialLabel(member.material) || memberId });
  }
  return options;
}

/** Every (item, location) pair the availability preview must be asked about. */
export function collectAvailabilityNeeds(strokeLines, choices) {
  const needs = new Map();
  for (const line of strokeLines) {
    const rows = choices[line.id]?.length
      ? choices[line.id]
      : [{ item: String(line.material_id), location: line.default_storage_location_id || "" }];
    for (const row of rows) {
      if (!row.item || !row.location) continue;
      needs.set(splitRowKey(row.item, row.location), {
        material_id: row.item,
        storage_location_id: row.location,
        qty: 1,
      });
    }
  }
  return [...needs.values()].sort((a, b) => splitRowKey(a.material_id, a.storage_location_id)
    .localeCompare(splitRowKey(b.material_id, b.storage_location_id)));
}

/**
 * @param {object} params
 * @param {Array} params.strokeLines    stroke lines (id, material_id, dosage_pct, default_storage_location_id, alternates...)
 * @param {number} params.plannedQty    batch size in KG
 * @param {Object<string, Array<{item: string|null, location: string}>>} params.choices  user picks, keyed by stroke line id
 * @param {Map<string, number>} params.availabilityByKey  `${materialId}::${locationId}` -> available qty
 * @param {(material: object) => string} params.materialLabel
 */
export function deriveMaterialTableRows({ strokeLines, plannedQty, choices, availabilityByKey, materialLabel }) {
  const used = new Map(); // key -> qty already taken by earlier rows
  const rows = [];
  const lineSummaries = [];
  let availabilityPending = false;
  let lineNo = 0;

  for (const line of strokeLines) {
    const formulationId = String(line.material_id);
    const alternateOptions = buildAlternateOptions(line, materialLabel);
    const canSplit = alternateOptions.length > 0;
    const standardQty = round6((Number(line.dosage_pct ?? 0) / 100) * Number(plannedQty || 0));
    const defaultLocation = line.default_storage_location_id || "";
    const stored = choices[line.id]?.length ? choices[line.id] : null;
    const baseRows = stored ?? [{ item: formulationId, location: defaultLocation }];
    const materialType = String(line.line_material_type || line.material?.material_type || "RM").toUpperCase() === "INT" ? "INT" : "RM";
    const formulationLabel = materialLabel(line.material) || "--";

    let remaining = standardQty;
    let allComplete = true;
    let lineShort = false;
    const lineRows = [];

    baseRows.forEach((choice, rowIndex) => {
      const complete = Boolean(choice.item && choice.location);
      const key = complete ? splitRowKey(choice.item, choice.location) : "";
      const availableRaw = complete ? availabilityByKey.get(key) : undefined;
      const availabilityKnown = complete && availableRaw !== undefined;
      if (complete && !availabilityKnown) availabilityPending = true;
      if (!complete) allComplete = false;
      const free = availabilityKnown ? Math.max(0, availableRaw - (used.get(key) ?? 0)) : 0;

      let qty = 0;
      let isShort = false;
      if (canSplit) {
        qty = availabilityKnown ? round6(Math.min(free, Math.max(remaining, 0))) : 0;
      } else {
        // Single-row line: it takes the whole Standard; short is judged against the balance.
        qty = standardQty;
        isShort = availabilityKnown ? free < standardQty - SPLIT_COVERAGE_TOLERANCE : false;
        if (isShort) lineShort = true;
      }
      if (complete) used.set(key, (used.get(key) ?? 0) + qty);
      remaining = round6(remaining - qty);

      lineRows.push({
        key: `${line.id}::${rowIndex}`,
        stroke_line_id: line.id,
        row_index: rowIndex,
        is_first: rowIndex === 0,
        is_pending: false,
        material_type: materialType,
        material_id: formulationId,
        material_label: formulationLabel,
        dosage_pct: rowIndex === 0 ? Number(line.dosage_pct ?? 0) : null,
        item: choice.item || "",
        location: choice.location || "",
        item_options: canSplit ? [{ value: formulationId, label: `${formulationLabel} (formulation)` }, ...alternateOptions] : [],
        can_split: canSplit,
        standard_qty: rowIndex === 0 ? standardQty : null,
        qty,
        available_qty: availabilityKnown ? free : null, // balance as this row saw it (after earlier rows took theirs)
        is_short: isShort,
        can_remove: canSplit && rowIndex > 0,
      });
    });

    const covered = canSplit ? remaining <= SPLIT_COVERAGE_TOLERANCE : !lineShort;
    // A blank row appears only while the line is genuinely under-covered, every row so far is
    // fully chosen with a known balance (so "under-covered" is a fact, not a loading state).
    const needsPending = canSplit && standardQty > 0 && remaining > SPLIT_COVERAGE_TOLERANCE && allComplete && !availabilityPending;
    if (needsPending) {
      lineRows.push({
        key: `${line.id}::${baseRows.length}`,
        stroke_line_id: line.id,
        row_index: baseRows.length,
        is_first: false,
        is_pending: true,
        material_type: materialType,
        material_id: formulationId,
        material_label: formulationLabel,
        dosage_pct: null,
        item: "",
        location: "",
        item_options: [{ value: formulationId, label: `${formulationLabel} (formulation)` }, ...alternateOptions],
        can_split: true,
        standard_qty: null,
        qty: 0,
        available_qty: null,
        is_short: false,
        can_remove: false,
        remaining_qty: remaining,
      });
    }

    for (const row of lineRows) {
      lineNo += 1;
      rows.push({ ...row, line_no: lineNo });
    }
    lineSummaries.push({
      stroke_line_id: line.id,
      material_label: formulationLabel,
      standard_qty: standardQty,
      remaining_qty: Math.max(remaining, 0),
      covered,
      can_split: canSplit,
    });
  }

  const uncovered = lineSummaries.filter((summary) => !summary.covered && summary.standard_qty > 0);
  return {
    rows,
    lineSummaries,
    uncovered,
    availabilityPending,
    // Create is possible only when every line is covered AND balances are known.
    canCreate: uncovered.length === 0 && !availabilityPending && rows.length > 0,
  };
}

/** Request payload pieces for createProcessOrder, built from the derived rows. */
export function buildSplitPayload(derived) {
  const byLine = new Map();
  for (const row of derived.rows) {
    if (row.is_pending) continue;
    if (!byLine.has(row.stroke_line_id)) byLine.set(row.stroke_line_id, []);
    byLine.get(row.stroke_line_id).push(row);
  }
  const lineSplits = [];
  const lineLocationOverrides = [];
  for (const [strokeLineId, lineRows] of byLine.entries()) {
    // Rows that took nothing (balance 0) are dropped for split lines; a single-row line
    // always keeps its row (its qty is the full Standard).
    const usable = lineRows.length > 1 ? lineRows.filter((row) => row.qty > 0) : lineRows;
    if (usable.length === 0) continue;
    lineSplits.push({
      stroke_line_id: strokeLineId,
      rows: usable.map((row) => ({
        actual_material_id: row.item && row.item !== row.material_id ? row.item : undefined,
        storage_location_id: row.location,
        qty: row.qty,
      })),
    });
    const first = usable[0];
    lineLocationOverrides.push({
      material_id: first.material_id,
      actual_material_id: first.item && first.item !== first.material_id ? first.item : undefined,
      storage_location_id: first.location,
    });
  }
  return { lineSplits, lineLocationOverrides };
}
