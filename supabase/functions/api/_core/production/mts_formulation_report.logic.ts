/*
 * File-ID: PR27-LOGIC
 * File-Path: supabase/functions/api/_core/production/mts_formulation_report.logic.ts
 * Domain: PRODUCTION
 * Purpose: PR27 "MTS Formulation Report" -- pure row builder (no I/O). For every VERIFIED MTS Process PO it lists
 *          the SFG made and every RM / INT it used (Process block), then, per Packing PO, the SKU made and every PM
 *          it used (Packing block). Each line carries the Formulation material (what the Stroke / Pack BOM says) next
 *          to the Actual material (what was really issued), dosage, formulation qty, actual qty and variance.
 *          "Used For" is a single code: RM / INT -> the SFG code, PM -> the SKU code (an SFG drawn by packing is not a
 *          row: it is the SFG output of the Process block).
 * Authority: Backend
 */

export type JsonRow = Record<string, unknown>;

export type MaterialInfo = {
  id: string;
  external_code: string | null;
  material_name: string | null;
  document_name: string | null;
  material_type: string | null;
};

export type FormulationInput = {
  processOrders: JsonRow[];
  processLines: JsonRow[];
  packingOrders: JsonRow[];
  packingLines: JsonRow[];
  materials: Map<string, MaterialInfo>;
  strokes: Map<string, string>; // stroke_master.id -> stroke_number
};

export type FormulationRow = {
  key: string;
  production_date: string | null;
  po_kind: "Process" | "Packing";
  po_number: string;
  stroke_number: string | null;
  from_batch: string | null;
  to_batch: string | null;
  batch_count: number | null;
  line_type: "SFG" | "RM" | "INT" | "FG" | "PM";
  used_for_kind: "SFG" | "SKU";
  used_for_code: string | null;
  formulation_material: string | null;
  actual_material: string | null;
  actual_external_code: string | null;
  substituted: boolean;
  dosage_pct: number | null;
  formulation_qty: number | null;
  actual_qty: number | null;
  variance: number | null;
  uom: string;
};

const str = (value: unknown): string => (value == null ? "" : String(value).trim());

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const round = (value: number, places = 6): number => Number(value.toFixed(places));

function parseBatch(value: string): { prefix: string; serial: number } | null {
  const match = /^(.*?)(\d+)$/.exec(value);
  return match ? { prefix: match[1], serial: Number(match[2]) } : null;
}

// Batches in a [from..to] range by numeric suffix (ER3309..ER3335 = 27), never by string order.
export function countBatchesInRange(from: string, to: string): number | null {
  const a = parseBatch(from);
  const b = parseBatch(to);
  if (!a || !b || a.prefix !== b.prefix || b.serial < a.serial) return null;
  return b.serial - a.serial + 1;
}

function labelOf(info: MaterialInfo | undefined, preferDocumentName: boolean): string | null {
  if (!info) return null;
  const name = preferDocumentName
    ? str(info.document_name) || str(info.material_name)
    : str(info.material_name) || str(info.document_name);
  return name || str(info.external_code) || null;
}

const compareText = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

export function buildFormulationRows(input: FormulationInput): FormulationRow[] {
  const { materials, strokes } = input;
  const linesByProcess = new Map<string, JsonRow[]>();
  for (const line of input.processLines) {
    const key = str(line.process_order_id);
    (linesByProcess.get(key) ?? linesByProcess.set(key, []).get(key)!).push(line);
  }
  const packsByProcess = new Map<string, JsonRow[]>();
  for (const pack of input.packingOrders) {
    const key = str(pack.process_order_id);
    (packsByProcess.get(key) ?? packsByProcess.set(key, []).get(key)!).push(pack);
  }
  const pmByPacking = new Map<string, JsonRow[]>();
  for (const line of input.packingLines) {
    if (str(line.line_type).toUpperCase() !== "PM") continue;
    const key = str(line.packing_order_id);
    (pmByPacking.get(key) ?? pmByPacking.set(key, []).get(key)!).push(line);
  }

  const orders = input.processOrders.slice().sort((a, b) =>
    compareText(str(b.production_date), str(a.production_date)) || compareText(str(b.po_number), str(a.po_number)));

  const rows: FormulationRow[] = [];

  for (const po of orders) {
    const poId = str(po.id);
    const poNumber = str(po.po_number);
    const sfg = materials.get(str(po.material_id));
    const sfgCode = str(sfg?.external_code) || null;
    const strokeNumber = strokes.get(str(po.stroke_master_id)) ?? null;
    const productionDate = str(po.production_date) || null;
    const processBatchFrom = str(po.batch_number_from) || null;
    const processBatchTo = str(po.batch_number_to) || null;
    const processBatchCount = num(po.number_of_batches);
    const packs = (packsByProcess.get(poId) ?? [])
      .filter((pack) => str(pack.status).toUpperCase() !== "REVERSED")
      .sort((a, b) => compareText(str(a.batch_number_from), str(b.batch_number_from)) || compareText(str(a.po_number), str(b.po_number)));

    // ---- Process PO block: the SFG made, then every RM / INT it used ----
    const sfgStd = num(po.planned_qty);
    const packedKg = packs.reduce((sum, pack) => sum + (num(pack.actual_qty_kg) ?? 0), 0);
    const sfgActual = packs.length > 0 ? round(packedKg) : null;
    const sfgLabel = labelOf(sfg, true);
    const processBase = {
      production_date: productionDate,
      po_kind: "Process" as const,
      po_number: poNumber,
      stroke_number: strokeNumber,
      from_batch: processBatchFrom,
      to_batch: processBatchTo,
      batch_count: processBatchCount,
      used_for_kind: "SFG" as const,
      used_for_code: sfgCode,
    };
    rows.push({
      ...processBase, key: `P:${poId}:out`, line_type: "SFG",
      formulation_material: sfgLabel, actual_material: sfgLabel, actual_external_code: sfgCode, substituted: false,
      dosage_pct: null, formulation_qty: sfgStd, actual_qty: sfgActual,
      variance: sfgStd != null && sfgActual != null ? round(sfgActual - sfgStd) : null, uom: "KG",
    });

    const lines = (linesByProcess.get(poId) ?? []).slice().sort((a, b) => (num(a.display_order) ?? 0) - (num(b.display_order) ?? 0));
    // A formulation line the user split across several issued materials shares one stroke_line_id. Only the first row
    // carries the formulation qty, so a per-row variance would be meaningless there: no variance on any split row.
    const groupSize = new Map<string, number>();
    for (const line of lines) {
      const sl = str(line.stroke_line_id);
      if (sl) groupSize.set(sl, (groupSize.get(sl) ?? 0) + 1);
    }
    const seenGroup = new Set<string>();
    for (const line of lines) {
      const formulation = materials.get(str(line.material_id));
      const actualId = str(line.actual_material_id) || str(line.material_id);
      const actual = materials.get(actualId);
      const sl = str(line.stroke_line_id);
      const isSplit = sl !== "" && (groupSize.get(sl) ?? 0) > 1;
      const isFirstOfGroup = sl !== "" && !seenGroup.has(sl);
      if (sl) seenGroup.add(sl);
      const std = isSplit && !isFirstOfGroup ? null : num(line.planned_qty);
      const qty = num(line.actual_qty);
      const type = str(formulation?.material_type).toUpperCase() === "INT" ? "INT" : "RM";
      rows.push({
        ...processBase, key: `P:${poId}:${str(line.id)}`, line_type: type,
        formulation_material: labelOf(formulation, false), actual_material: labelOf(actual, false),
        actual_external_code: str(actual?.external_code) || null,
        substituted: actualId !== str(line.material_id),
        dosage_pct: num(line.dosage_pct), formulation_qty: std, actual_qty: qty,
        variance: !isSplit && std != null && qty != null ? round(qty - std) : null,
        uom: str(line.uom_code) || "KG",
      });
    }

    // ---- Packing PO block(s): the SKU made, then every PM it used ----
    for (const pack of packs) {
      const packId = str(pack.id);
      const sku = materials.get(str(pack.material_id));
      const skuCode = str(sku?.external_code) || null;
      const skuLabel = labelOf(sku, true);
      const from = str(pack.batch_number_from) || processBatchFrom;
      const to = str(pack.batch_number_to) || processBatchTo;
      const count = from && to ? countBatchesInRange(from, to) : null;
      const packBase = {
        production_date: productionDate,
        po_kind: "Packing" as const,
        po_number: str(pack.po_number),
        stroke_number: strokeNumber,
        from_batch: from,
        to_batch: to,
        batch_count: count ?? (packs.length <= 1 ? processBatchCount : null),
        used_for_kind: "SKU" as const,
        used_for_code: skuCode,
      };
      const fgStd = num(pack.planned_qty_kg);
      const fgActual = num(pack.actual_qty_kg);
      rows.push({
        ...packBase, key: `K:${packId}:out`, line_type: "FG",
        formulation_material: skuLabel, actual_material: skuLabel, actual_external_code: skuCode, substituted: false,
        dosage_pct: null, formulation_qty: fgStd, actual_qty: fgActual,
        variance: fgStd != null && fgActual != null ? round(fgActual - fgStd) : null, uom: "KG",
      });
      const pmLines = (pmByPacking.get(packId) ?? []).slice().sort((a, b) => (num(a.display_order) ?? 0) - (num(b.display_order) ?? 0));
      for (const line of pmLines) {
        const formulation = materials.get(str(line.material_id));
        const actualId = str(line.actual_material_id) || str(line.material_id);
        const actual = materials.get(actualId);
        const std = num(line.total_qty);
        const qty = num(line.actual_qty);
        rows.push({
          ...packBase, key: `K:${packId}:${str(line.id)}`, line_type: "PM",
          formulation_material: labelOf(formulation, false), actual_material: labelOf(actual, false),
          actual_external_code: str(actual?.external_code) || null,
          substituted: actualId !== str(line.material_id),
          dosage_pct: null, formulation_qty: std, actual_qty: qty,
          variance: std != null && qty != null ? round(qty - std) : null,
          uom: str(line.uom_code) || "NOS",
        });
      }
    }
  }
  return rows;
}
