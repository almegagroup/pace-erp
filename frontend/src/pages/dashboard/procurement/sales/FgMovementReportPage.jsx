/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/FgMovementReportPage.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: SO06 -- FG Movement Report. Page 1 selection (company, date range, one unit, PO21 Mother/Child group, type),
 *          Page 2 consolidated grid per FG SKU (Opening, Production, PID, Other, Dispatch, Closing, In QA, Blocked, then the
 *          dispatch breakup by dispatch type) with Child / Mother / Grand totals, Page 3 "where dispatched" by State / Town /
 *          month. Only posted stock movements are counted. The server sends BASE UoM plus each SKU's pack factors; the unit
 *          switch is done here, so changing it never refetches.
 * Authority: Frontend
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { layoutDrawerProps, useColumnLayouts } from "../../../../shared/columnLayouts/useColumnLayouts.js";
import { pushToast } from "../../../../store/uiToast.js";
import MultiValueFilterField from "../../../../components/inputs/MultiValueFilterField.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useScreenBackInterceptor } from "../../../../hooks/useScreenBackInterceptor.js";
import { getFgMovementOptions, getFgMovementPlaces, getFgMovementReport } from "../procurementApi.js";
import { totalRowProps } from "../planning/mtsPlanGrouping.js";

const TYPES = ["MTS", "MTO", "HPS", "MTEST"];
const typePillLabel = (t) => t;
const UNITS = [
  { key: "outer", label: "Outer pack UoM" },
  { key: "inner", label: "Inner pack UoM" },
  { key: "base", label: "Base UoM" },
  { key: "mt", label: "Base UoM in MT" },
];
const SUM_FIELDS = ["opening", "production", "pid", "dispatch", "closing", "in_qa", "blocked"];
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => `${todayIso().slice(0, 8)}01`;
const pill = (on) => `rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`;
const typeLabel = (value) => String(value).replace(/_/g, " ");

// One number in the chosen unit; null = the SKU has no fixed pack factor, so that unit does not apply to it.
function convert(row, value, unit) {
  const base = Number(value ?? 0);
  if (unit === "base") return base;
  if (unit === "mt") return base / 1000;
  const outer = row.base_per_outer > 0 ? base / row.base_per_outer : null;
  if (unit === "outer") return outer;
  return outer !== null && row.inner_per_outer > 0 ? outer * row.inner_per_outer : null;
}
function fmt(value, unit) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", unit === "mt" ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : { maximumFractionDigits: 2 });
}
const unitSuffix = (row, unit) => (unit === "outer" ? (row.outer_uom || "") : unit === "inner" ? "inner" : unit === "mt" ? "MT" : (row.base_uom || ""));

export default function FgMovementReportPage() {
  const { runtimeContext } = useMenu();
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [runtimeContext]);
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [companyIds, setCompanyIds] = useState([]);
  useEffect(() => {
    if (companyIds.length === 0 && defaultCompanyId) setCompanyIds([defaultCompanyId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCompanyId]);
  const effectiveCompanyIds = companyIds.length > 0 ? companyIds : (defaultCompanyId ? [defaultCompanyId] : []);

  const [dateFrom, setDateFrom] = useState(monthStartIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [unit, setUnit] = useState("outer");
  const [types, setTypes] = useState([]);
  const [mothers, setMothers] = useState([]);
  const [children, setChildren] = useState([]);
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const optionsQ = useQuery({
    queryKey: ["fg-movement-options", effectiveCompanyIds.join(",")],
    queryFn: () => getFgMovementOptions({ company_ids: effectiveCompanyIds.join(",") }),
    enabled: effectiveCompanyIds.length > 0,
    select: (data) => data?.data ?? data ?? {},
  });
  const groupPairs = useMemo(() => optionsQ.data?.groups ?? [], [optionsQ.data]);
  const motherOptions = useMemo(
    () => [...new Set(groupPairs.map((g) => g.mother))].map((value) => ({ value, label: value })),
    [groupPairs],
  );
  const childOptions = useMemo(() => {
    const chosen = new Set(mothers.map((m) => m.value));
    return [...new Set(groupPairs.filter((g) => g.child && (chosen.size === 0 || chosen.has(g.mother))).map((g) => g.child))]
      .map((value) => ({ value, label: value }));
  }, [groupPairs, mothers]);

  const reportQ = useQuery({
    queryKey: ["fg-movement-report", submitted],
    queryFn: () => getFgMovementReport(submitted),
    enabled: Boolean(submitted),
    select: (data) => data?.data ?? data ?? {},
  });
  const placesQ = useQuery({
    queryKey: ["fg-movement-places", submitted],
    queryFn: () => getFgMovementPlaces(submitted),
    enabled: Boolean(submitted) && page === 3,
    select: (data) => data?.data ?? data ?? {},
  });
  const rows = useMemo(() => reportQ.data?.rows ?? [], [reportQ.data]);
  const dispatchTypes = useMemo(() => reportQ.data?.dispatch_types ?? [], [reportQ.data]);
  // "Other" is shown as one column per kind of movement (Opening Stock, GRN Receipt, Blocked → Unrestricted ...), named by what happened.
  const otherCategories = useMemo(() => reportQ.data?.other_categories ?? [], [reportQ.data]);
  const placeRows = useMemo(() => placesQ.data?.rows ?? [], [placesQ.data]);

  function toggleCompany(id) {
    setCompanyIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    setMothers([]); setChildren([]);
  }
  function execute() {
    setError("");
    if (effectiveCompanyIds.length === 0) return setError("Select a company first.");
    if (!dateFrom || !dateTo) return setError("A date range is required.");
    if (dateTo < dateFrom) return setError("Date To cannot be before Date From.");
    setSubmitted({
      company_ids: effectiveCompanyIds.join(","),
      date_from: dateFrom,
      date_to: dateTo,
      mother_groups: mothers.length > 0 ? mothers.map((m) => m.value).join(",") : undefined,
      child_groups: children.length > 0 ? children.map((c) => c.value).join(",") : undefined,
      types: types.length > 0 ? types.join(",") : undefined,
    });
    setPage(2);
  }
  function reset() {
    setTypes([]); setMothers([]); setChildren([]); setSubmitted(null); setError(""); setPage(1);
    setDateFrom(monthStartIso()); setDateTo(todayIso());
  }
  useScreenBackInterceptor(() => {
    if (page === 1) return false;
    setPage(page === 3 ? 2 : 1);
    return true;
  });

  // ---------- Page 2 grid ----------
  const cell = (row, key) => (row.__total ? row.__sums?.[key] ?? null : convert(row, row[key], unit));
  const otherCell = (row, key) => (row.__total ? row.__sums?.[`o_${key}`] ?? null : convert(row, row.other_by?.[key] ?? 0, unit));
  const typeCell = (row, t) => (row.__total ? row.__sums?.[`t_${t}`] ?? null : convert(row, row.dispatch_by_type?.[t] ?? 0, unit));
  const numCol = (key, label, getter) => ({
    key, label, align: "right", width: "118px",
    render: (row) => fmt(getter(row), unit),
    copyValue: (row) => { const v = getter(row); return v === null ? "" : String(v); },
    excelValue: (row) => { const v = getter(row); return v === null ? "" : Number(v); },
    filterValue: (row) => fmt(getter(row), unit),
    numFmt: unit === "mt" ? "#,##0.000" : "#,##0.##",
  });
  const columns = useMemo(() => [
    { key: "company_code", label: "Company", width: "90px", render: (r) => r.company_code ?? "", filterValue: (r) => r.company_code ?? "" },
    { key: "mother_group", label: "Mother Group", width: "130px", render: (r) => r.mother_group ?? "" , filterValue: (r) => r.mother_group ?? ""},
    { key: "child_group", label: "Child Group", width: "150px", render: (r) => r.child_group ?? "", filterValue: (r) => r.child_group ?? "" },
    { key: "type", label: "Type", width: "70px", render: (r) => r.type ?? "", filterValue: (r) => r.type ?? "" },
    { key: "sku", label: "SKU", width: "120px", render: (r) => r.sku ?? "", filterValue: (r) => r.sku ?? "" },
    { key: "description", label: "Description", width: "260px", render: (r) => r.description ?? "", filterValue: (r) => r.description ?? "" },
    { key: "unit", label: "Unit", width: "70px", render: (r) => (r.__total ? "" : unitSuffix(r, unit)), filterValue: (r) => (r.__total ? "" : unitSuffix(r, unit)) },
    numCol("opening", "Opening", (r) => cell(r, "opening")),
    numCol("production", "Production", (r) => cell(r, "production")),
    numCol("pid", "PID", (r) => cell(r, "pid")),
    ...otherCategories.map((c) => numCol(`o_${c.key}`, c.label, (r) => otherCell(r, c.key))),
    numCol("dispatch", "Total Dispatch", (r) => cell(r, "dispatch")),
    numCol("closing", "Closing", (r) => cell(r, "closing")),
    numCol("in_qa", "In QA", (r) => cell(r, "in_qa")),
    numCol("blocked", "Blocked", (r) => cell(r, "blocked")),
    ...dispatchTypes.map((t) => numCol(`t_${t}`, typeLabel(t), (r) => typeCell(r, t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [unit, dispatchTypes.join(","), otherCategories.map((c) => c.key).join(",")]);
  // Common column picker (visibility + order, up to 3 saved layouts per user), same as Plan Feed.
  const [columnsOpen, setColumnsOpen] = useState(false);
  const layoutMessage = useCallback((message, tone) => pushToast({ message, tone }), []);
  const layout = useColumnLayouts("SO06_FG_MOVEMENT", columns, layoutMessage);
  const gridColumns = layout.columns;

  // Child / Mother / Grand totals, in the chosen unit, over exactly the rows the grid is showing (after search / filters).
  const decorate = useMemo(() => (visible) => {
    const sorted = [...visible];
    const zero = () => ({ sums: {}, seen: false, sample: null });
    const keys = [...SUM_FIELDS, ...otherCategories.map((c) => `o_${c.key}`), ...dispatchTypes.map((t) => `t_${t}`)];
    const rawValue = (row, key) => (key.startsWith("t_") ? row.dispatch_by_type?.[key.slice(2)] ?? 0
      : key.startsWith("o_") ? row.other_by?.[key.slice(2)] ?? 0 : row[key]);
    const add = (acc, row) => {
      acc.sample ??= row;
      for (const key of keys) {
        const v = convert(row, rawValue(row, key), unit);
        if (v !== null) acc.sums[key] = (acc.sums[key] ?? 0) + v;
      }
    };
    const out = [];
    let child = zero(); let mother = zero(); const grand = zero();
    let lastCompany = null; let lastMother = null; let lastChild = null;
    const total = (kind, acc, label) => ({
      row_key: `total|${kind}|${acc.sample.company_id}|${acc.sample.mother_group}|${kind === "CHILD" ? acc.sample.child_group : ""}|${label}`,
      __total: kind, __sums: acc.sums, company_code: acc.sample.company_code, mother_group: kind === "GRAND" ? "" : acc.sample.mother_group,
      child_group: kind === "CHILD" ? acc.sample.child_group : "", type: "", sku: "", description: label,
    });
    const flushChild = () => { if (child.sample) { out.push(total("CHILD", child, "Child Group Total")); child = zero(); } };
    const flushMother = () => { if (mother.sample) { out.push(total("MOTHER", mother, "Mother Group Total")); mother = zero(); } };
    for (const row of sorted) {
      if (lastChild !== null && (row.company_id !== lastCompany || row.mother_group !== lastMother || row.child_group !== lastChild)) flushChild();
      if (lastMother !== null && (row.company_id !== lastCompany || row.mother_group !== lastMother)) flushMother();
      out.push(row);
      add(child, row); add(mother, row); add(grand, row);
      lastCompany = row.company_id; lastMother = row.mother_group; lastChild = row.child_group;
    }
    flushChild(); flushMother();
    if (grand.sample) out.push(total("GRAND", grand, "Grand Total"));
    return out;
  }, [unit, dispatchTypes, otherCategories]);

  const noFactorCount = useMemo(() => (unit === "outer" || unit === "inner" ? rows.filter((r) => convert(r, 1, unit) === null).length : 0), [rows, unit]);

  async function exportExcel(kind) {
    setExporting(true);
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      if (kind === "places") {
        await downloadColoredExcelFile({
          fileName: `fg_dispatch_places_${dateFrom}_${dateTo}.xlsx`, sheetName: "Where dispatched",
          columns: placeColumns, rows: placeRows,
          getCellValue: (row, column) => (typeof column.excelValue === "function" ? column.excelValue(row) : (row?.[column.key] ?? "")),
        });
      } else {
        await downloadColoredExcelFile({
          fileName: `fg_movement_${dateFrom}_${dateTo}.xlsx`, sheetName: "FG Movement",
          columns: gridColumns, rows: decorate(rows),
          getCellValue: (row, column) => (typeof column.excelValue === "function" ? column.excelValue(row) : (row?.[column.key] ?? "")),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "FG_MOVEMENT_EXPORT_FAILED");
    } finally {
      setExporting(false);
    }
  }

  // ---------- Page 3 grids ----------
  const placeValue = (row) => convert(row, row.dispatch, unit);
  const placeColumns = useMemo(() => [
    { key: "company_code", label: "Company", width: "90px" },
    { key: "state", label: "State", width: "140px" },
    { key: "town", label: "Town", width: "150px" },
    { key: "month_year", label: "Month", width: "90px" },
    { key: "mother_group", label: "Mother Group", width: "130px" },
    { key: "child_group", label: "Child Group", width: "150px" },
    { key: "type", label: "Type", width: "70px" },
    { key: "sku", label: "SKU", width: "120px" },
    { key: "description", label: "Description", width: "250px" },
    { key: "unit", label: "Unit", width: "70px", render: (r) => unitSuffix(r, unit), filterValue: (r) => unitSuffix(r, unit) },
    {
      key: "dispatch", label: "Dispatched", align: "right", width: "120px",
      render: (r) => fmt(placeValue(r), unit), filterValue: (r) => fmt(placeValue(r), unit),
      excelValue: (r) => { const v = placeValue(r); return v === null ? "" : Number(v); },
      numFmt: unit === "mt" ? "#,##0.000" : "#,##0.##",
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [unit]);
  const stateRows = useMemo(() => {
    const map = new Map();
    for (const r of placeRows) {
      const key = [r.company_code, r.state, r.month_year, r.mother_group, r.child_group, r.type, r.sku].join("|");
      const e = map.get(key);
      if (e) e.dispatch += Number(r.dispatch); else map.set(key, { ...r, town: "", dispatch: Number(r.dispatch) });
    }
    return [...map.values()].map((r, i) => ({ ...r, row_key: `s${i}` }));
  }, [placeRows]);
  const townRows = useMemo(() => placeRows.map((r, i) => ({ ...r, row_key: `t${i}` })), [placeRows]);
  const stateColumns = useMemo(() => placeColumns.filter((c) => c.key !== "town"), [placeColumns]);

  const activeError = error
    || (reportQ.error instanceof Error ? reportQ.error.message : "")
    || (placesQ.error instanceof Error ? placesQ.error.message : "");
  const selectedCodes = companies.filter((c) => effectiveCompanyIds.includes(String(c.id))).map((c) => c.company_code).join(", ");

  const actions = page === 1
    ? [{ key: "reset", label: "Reset", onClick: reset }, { key: "execute", label: "Execute", tone: "primary", onClick: execute }]
    : page === 2
      ? [
        { key: "back", label: "Back to Filters", onClick: () => setPage(1) },
        { key: "places", label: "Where dispatched", onClick: () => setPage(3) },
        { key: "columns", label: `Columns${layout.activeLayoutName ? ` · ${layout.activeLayoutName}` : ""}`, onClick: () => setColumnsOpen(true) },
        { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void exportExcel("report"), disabled: exporting || rows.length === 0 },
        { key: "again", label: reportQ.isFetching ? "Executing..." : "Execute Again", tone: "primary", onClick: execute, disabled: reportQ.isFetching },
      ]
      : [
        { key: "back", label: "Back to Report", onClick: () => setPage(2) },
        { key: "export", label: exporting ? "Exporting..." : "Export Excel", onClick: () => void exportExcel("places"), disabled: exporting || placeRows.length === 0 },
      ];

  return (
    <ErpScreenScaffold
      eyebrow="Sales Reports"
      title="FG Movement Report"
      notices={activeError ? [{ key: "fg-movement-error", tone: "error", message: activeError }] : []}
      actions={actions}
    >
      {page === 1 ? (
        <ErpSectionCard eyebrow="Page 1" title="Selection Screen">
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-xs text-slate-500">Company</p>
              <div className="flex flex-wrap gap-1.5">
                {companies.length <= 1 ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {companies[0] ? `${companies[0].company_code} — ${companies[0].company_name ?? ""}` : "—"}
                  </span>
                ) : companies.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggleCompany(String(c.id))} className={pill(effectiveCompanyIds.includes(String(c.id)))} title={c.company_name}>
                    {c.company_code}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Date range <span className="text-rose-500">*</span></label>
                <div className="flex items-center gap-1.5">
                  <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <span className="text-slate-400">-</span>
                  <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              <MultiValueFilterField
                label="Mother Group (PO21)" placeholder="All mother groups" value={mothers}
                onChange={(value) => { setMothers(value); setChildren([]); }} options={motherOptions}
                loadError={optionsQ.error instanceof Error ? optionsQ.error.message : ""}
              />
              <MultiValueFilterField
                label="Child Group (PO21)" placeholder="All child groups" value={children}
                onChange={setChildren} options={childOptions}
                loadError={optionsQ.error instanceof Error ? optionsQ.error.message : ""}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-slate-500">Type:</p>
              <div className="flex flex-wrap gap-1.5">
                {TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))} className={pill(types.includes(t))}>{typePillLabel(t)}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-slate-500">Unit (choose one)</p>
              <div className="flex flex-wrap gap-1.5">
                {UNITS.map((u) => <button key={u.key} type="button" onClick={() => setUnit(u.key)} className={pill(unit === u.key)}>{u.label}</button>)}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
              <span className="text-xs text-slate-400">FG only. Posted stock movements only.</span>
              <button type="button" onClick={execute} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">Execute</button>
            </div>
          </div>
        </ErpSectionCard>
      ) : page === 2 ? (
        <ErpSectionCard eyebrow="Page 2" title={`FG Movement (${submitted?.date_from} to ${submitted?.date_to}) · ${selectedCodes}`}>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {UNITS.map((u) => <button key={u.key} type="button" onClick={() => setUnit(u.key)} className={pill(unit === u.key)}>{u.label}</button>)}
            <span className="ml-auto text-xs text-slate-500">{reportQ.isLoading ? "Loading..." : `${rows.length} SKU row${rows.length === 1 ? "" : "s"}`}</span>
          </div>
          {noFactorCount > 0 ? <p className="mb-2 text-xs text-amber-800">{noFactorCount} SKU(s) have no fixed pack size, so they show — in this unit and are left out of its totals. Use Base UoM for those.</p> : null}
          <ErpDenseGrid
            cellNavigate columnFilter searchBar rangeSelect virtualize
            columns={gridColumns} rows={rows} decorateRows={decorate} getRowProps={totalRowProps}
            rowKey={(r) => r.row_key ?? `${r.company_id}|${r.material_id}`}
            maxHeight="calc(100vh - 300px)"
            emptyMessage={reportQ.isLoading ? "Loading..." : "No FG movement for this selection."}
          />
        </ErpSectionCard>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Page 3" title={`Where dispatched (${submitted?.date_from} to ${submitted?.date_to}) · ${UNITS.find((u) => u.key === unit)?.label}`}>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {UNITS.map((u) => <button key={u.key} type="button" onClick={() => setUnit(u.key)} className={pill(unit === u.key)}>{u.label}</button>)}
            </div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Table 1 · State wise</p>
            <ErpDenseGrid cellNavigate columnFilter searchBar rangeSelect columns={stateColumns} rows={stateRows} rowKey={(r) => r.row_key} maxHeight="38vh"
              emptyMessage={placesQ.isLoading ? "Loading..." : "No dispatch in this selection."} />
            <p className="mb-1 mt-4 text-xs font-semibold text-slate-600">Table 2 · Town wise</p>
            <ErpDenseGrid cellNavigate columnFilter searchBar rangeSelect columns={placeColumns} rows={townRows} rowKey={(r) => r.row_key} maxHeight="38vh"
              emptyMessage={placesQ.isLoading ? "Loading..." : "No dispatch in this selection."} />
          </ErpSectionCard>
        </div>
      )}
      <ErpColumnVisibilityDrawer
        visible={columnsOpen}
        title="FG Movement Columns"
        {...layoutDrawerProps(layout)}
        onClose={() => setColumnsOpen(false)}
      />
    </ErpScreenScaffold>
  );
}
