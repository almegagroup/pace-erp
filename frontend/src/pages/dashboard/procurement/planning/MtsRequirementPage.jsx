/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsRequirementPage.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 Requirement — one Procurement page, two tabs (owner brief 2026-10-16):
 *            1. Requirement Report — every business field of the legacy
 *               REPORTS_ALL "REQUIREMENT" sheet, calculated by the backend
 *               engine from PO21 plan, Stroke / Pack BOM, ledger stock,
 *               posted consumption, PO / CSN and policy. Read-only.
 *            2. Material Settings — company-wise Target / Critical coverage
 *               days and planning MOQ per individual RM / PM material.
 *          Dense keyboard-first ErpDenseGrid only: no cards, no side panels.
 *          Source drill-down and policy history open inline under the row.
 *          Edit rights come from the backend ACL decision (/mts-requirement/access),
 *          never from role codes on this page.
 *          Contract: docs/mts-planning/PO22-REQUIREMENT-CALCULATION-CONTRACT.md
 * Authority: Frontend
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { pushToast } from "../../../../store/uiToast.js";
import {
  getMtsRequirementAccess,
  getMtsRequirementPolicies,
  getMtsRequirementPolicyHistory,
  getMtsRequirementReport,
  saveMtsRequirementPolicies,
} from "../procurementApi.js";

const INPUT_CLASS = "h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500";
const CELL_INPUT = "h-7 border border-sky-300 bg-sky-50 px-1.5 text-xs text-sky-900 outline-none focus:border-sky-600 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400";
const GRID_PROPS = { cellNavigate: true, columnFilter: true, searchBar: true, stickyFirstColumn: true, fitColumnWidths: true };
const MOQ_SOURCES = [
  { value: "NONE", label: "No fixed MOQ" },
  { value: "VENDOR", label: "Vendor (supplier minimum)" },
  { value: "COMPANY", label: "Company policy" },
];
const RISK_FILTERS = [
  { value: "ALL", label: "All materials" },
  { value: "WITH_DEMAND", label: "With demand" },
  { value: "CRITICAL", label: "Below critical (stock)" },
  { value: "BELOW_TARGET", label: "Below target (stock)" },
  { value: "CRITICAL_WITH_IN", label: "Below critical even with incoming" },
  { value: "BELOW_TARGET_WITH_IN", label: "Below target even with incoming" },
  { value: "NM_SHORT", label: "Short in next month" },
  { value: "INBOUND_RISK", label: "Inbound ETA overdue / unknown" },
  { value: "NO_POLICY", label: "No policy set" },
];
const COLUMN_GROUPS = [
  { id: "policy", label: "Policy" },
  { id: "demand", label: "Demand" },
  { id: "stock", label: "Stock" },
  { id: "inbound", label: "In-transit" },
  { id: "coverage", label: "Coverage & alerts" },
  { id: "requirement", label: "Requirement" },
  { id: "leadtime", label: "Lead time & stock levels" },
];

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function monthEndOf(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}
/** As-of default for a month: today if inside it, else its last day (past) or first day (future). */
function defaultAsOf(month, today) {
  const start = `${month}-01`;
  const end = monthEndOf(month);
  if (today >= start && today <= end) return today;
  return today > end ? end : start;
}
function fmtQty(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "";
}
function fmtDays(value) {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "";
}
function yesNo(value) {
  if (value === null || value === undefined) return "";
  return value ? "Yes" : "No";
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "Request failed");
}
function dash(value) {
  return value === null || value === undefined || value === "" ? <span className="text-slate-300">—</span> : value;
}
const BADGE_TONE = {
  CRITICAL: "bg-rose-100 text-rose-800",
  BELOW_TARGET: "bg-amber-100 text-amber-800",
  OK: "bg-emerald-100 text-emerald-800",
  NO_POLICY: "bg-slate-100 text-slate-600",
  NO_DEMAND: "bg-slate-50 text-slate-400",
  SHORT_BEFORE_NM: "bg-rose-100 text-rose-800",
  SHORT_IN_NM: "bg-amber-100 text-amber-800",
  COVERED: "bg-emerald-100 text-emerald-800",
  OVERDUE: "bg-rose-100 text-rose-800",
  ETA_UNKNOWN: "bg-amber-100 text-amber-800",
  ON_TIME: "bg-emerald-100 text-emerald-800",
  NONE: "bg-slate-50 text-slate-400",
};
function badge(value) {
  if (!value) return "";
  return <span className={`px-1.5 py-0.5 text-[11px] font-semibold ${BADGE_TONE[value] ?? "bg-slate-100 text-slate-700"}`}>{String(value).replaceAll("_", " ")}</span>;
}
function flag(value) {
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>;
  return value ? <span className="font-semibold text-rose-700">Yes</span> : <span className="text-emerald-700">No</span>;
}

// Numeric column helper: right-aligned, copy/filter/export as a plain number.
function qtyColumn(key, label, group, options = {}) {
  const read = options.read ?? ((row) => row[key]);
  const format = options.days ? fmtDays : fmtQty;
  return {
    key, label, group, width: options.width ?? "110px", align: "right",
    render: (row) => format(read(row)),
    copyValue: (row) => read(row) ?? "",
    filterValue: (row) => format(read(row)),
    exportValue: (row) => (read(row) === null || read(row) === undefined ? "" : Number(read(row))),
    numFmt: options.days ? "0.0" : "#,##0.###",
  };
}
function textColumn(key, label, group, options = {}) {
  const read = options.read ?? ((row) => row[key]);
  return {
    key, label, group, width: options.width ?? "120px", align: options.align,
    render: options.render ?? ((row) => dash(read(row))),
    copyValue: (row) => read(row) ?? "",
    filterValue: (row) => String(read(row) ?? ""),
    exportValue: (row) => read(row) ?? "",
  };
}

export default function MtsRequirementPage() {
  const { runtimeContext } = useMenu();
  const today = todayLocal();
  const [companyIdInput, setCompanyId] = useState("");
  const companyId = companyIdInput || resolveDefaultTransactionCompanyId(runtimeContext);
  const [activeTab, setActiveTab] = useState("report");
  const [planMonth, setPlanMonthState] = useState(today.slice(0, 7));
  const [asOf, setAsOf] = useState(today);
  const [demandMode, setDemandMode] = useState("CURRENT");
  const [demandAt, setDemandAt] = useState("");

  function setPlanMonth(month) {
    setPlanMonthState(month);
    if (month) setAsOf(defaultAsOf(month, today));
  }

  const accessQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "access", companyId],
    queryFn: () => getMtsRequirementAccess({ company_id: companyId }),
    enabled: Boolean(companyId),
  });
  const access = accessQ.data ?? null;
  const monthStart = `${planMonth}-01`;
  const monthEnd = planMonth ? monthEndOf(planMonth) : "";
  const asOfMax = monthEnd && monthEnd < today ? monthEnd : today;

  return (
    <ErpScreenScaffold
      eyebrow="Procurement · MTS Planning · PO22"
      title="Requirement"
      error={accessQ.error ? errorText(accessQ.error) : ""}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
          </div>
          <label className="grid gap-1 text-sm text-slate-700">
            <span className="font-medium text-slate-800">Plan Month (CM)</span>
            <input type="month" value={planMonth} onChange={(event) => setPlanMonth(event.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            <span className="font-medium text-slate-800">As-of / Calibration Date</span>
            <input
              type="date"
              value={asOf}
              min={monthStart}
              max={asOfMax}
              onChange={(event) => setAsOf(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="grid gap-1 text-sm text-slate-700">
            <span className="font-medium text-slate-800">Demand Version</span>
            <select value={demandMode} onChange={(event) => setDemandMode(event.target.value)} className={INPUT_CLASS}>
              <option value="CURRENT">Current effective plan</option>
              <option value="AS_AT">Plan as it stood at…</option>
            </select>
          </label>
          {demandMode === "AS_AT" ? (
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Plan as at</span>
              <input type="datetime-local" value={demandAt} onChange={(event) => setDemandAt(event.target.value)} className={INPUT_CLASS} />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {[{ id: "report", label: "1. Requirement Report" }, { id: "settings", label: "2. Material Settings" }].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`h-8 border px-3 text-sm font-semibold ${activeTab === tab.id ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {access ? (
            <span className="text-xs text-slate-500">Access: {access.can_edit_policy ? "View + edit Material Settings" : "View only"}</span>
          ) : null}
        </div>

        {!companyId ? (
          <p className="text-sm text-slate-500">Select a company.</p>
        ) : activeTab === "report" ? (
          <ReportTab
            companyId={companyId}
            planMonth={planMonth}
            asOf={asOf}
            demandAt={demandMode === "AS_AT" && demandAt ? new Date(demandAt).toISOString() : ""}
          />
        ) : (
          <SettingsTab companyId={companyId} asOf={asOf} access={access} today={today} />
        )}
      </div>
    </ErpScreenScaffold>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1 — Requirement Report
// ─────────────────────────────────────────────────────────────────────────────
function riskMatch(row, filter) {
  switch (filter) {
    case "WITH_DEMAND": return row.identifier !== "NO_DEMAND";
    case "CRITICAL": return row.below_critical === true;
    case "BELOW_TARGET": return row.below_target === true;
    case "CRITICAL_WITH_IN": return row.below_critical_with_in === true;
    case "BELOW_TARGET_WITH_IN": return row.below_target_with_in === true;
    case "NM_SHORT": return row.status_nm === "SHORT_IN_NM" || row.status_nm === "SHORT_BEFORE_NM";
    case "INBOUND_RISK": return row.inbound_risk === "OVERDUE" || row.inbound_risk === "ETA_UNKNOWN";
    case "NO_POLICY": return row.identifier === "NO_POLICY";
    default: return true;
  }
}

function buildReportColumns(expanded, toggleExpanded) {
  return [
    textColumn("material_name", "Material (ITEMS)", "identity", { width: "260px" }),
    textColumn("material_code", "Material Code", "identity", { width: "110px" }),
    textColumn("material_type", "TYPE", "identity", { width: "60px" }),
    textColumn("base_uom_code", "UoM", "identity", { width: "60px" }),
    textColumn("identifier", "Identifier", "identity", { width: "120px", render: (r) => badge(r.identifier) }),
    textColumn("id2", "ID2 (with incoming)", "identity", { width: "140px", render: (r) => badge(r.id2) }),
    {
      key: "sources", label: "Sources", group: "identity", width: "90px", filterable: false,
      render: (r) => (
        <button type="button" onClick={() => toggleExpanded(r.material_id)} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">
          {expanded === r.material_id ? "Hide" : "Show"}
        </button>
      ),
      exportValue: () => "",
    },

    qtyColumn("target_cov_days", "Target Cov", "policy", { days: true, width: "90px" }),
    qtyColumn("critical_cov_days", "Critical Cov", "policy", { days: true, width: "90px" }),
    qtyColumn("moq_qty", "MOQ", "policy", { width: "90px" }),
    textColumn("moq_uom_code", "MOQ UoM", "policy", { width: "80px" }),
    textColumn("moq_source", "MOQ Source", "policy", { width: "100px" }),
    textColumn("moq_active", "MOQ Active", "policy", { width: "90px", read: (r) => yesNo(r.moq_active) }),
    textColumn("policy_effective_from", "Policy From", "policy", { width: "100px" }),

    qtyColumn("cm_req", "Current Req (CURRENT MONTH REQ)", "demand", { width: "150px" }),
    qtyColumn("cm_prorata", "Current Prorata (CM PRORATA)", "demand", { width: "150px" }),
    qtyColumn("cm_cons", "CURRENT CONS.", "demand"),
    qtyColumn("cm_balance_req", "CM Req − Cons", "demand"),
    qtyColumn("nm_req", "Req NM", "demand"),
    qtyColumn("nm_prorata", "Prorata NM", "demand"),

    qtyColumn("current_stock", "CURRENT_STOCK (usable)", "stock", { width: "130px" }),
    qtyColumn("stock_unrestricted_at_required", "Unrestricted @ Req SLoc", "stock", { width: "130px" }),
    qtyColumn("stock_reserved_at_required", "Reserved @ Req SLoc", "stock", { width: "120px" }),
    qtyColumn("stock_other_sloc", "Other SLoc (transfer)", "stock", { width: "120px" }),
    qtyColumn("stock_qa", "QA Stock", "stock", { width: "90px" }),
    qtyColumn("stock_blocked", "Blocked", "stock", { width: "90px" }),
    textColumn("required_locations", "Required SLoc", "stock", { width: "110px", read: (r) => (r.required_locations ?? []).join(", ") }),
    textColumn("other_locations", "Other SLocs", "stock", { width: "110px", read: (r) => (r.other_locations ?? []).join(", ") }),

    qtyColumn("intransit_cm", "INTRANSIT CM", "inbound"),
    qtyColumn("intransit_nm", "INTRANSIT NM", "inbound"),
    qtyColumn("intransit_overdue", "In-transit ETA Passed", "inbound", { width: "120px" }),
    qtyColumn("intransit_unknown", "In-transit ETA Unknown", "inbound", { width: "130px" }),
    qtyColumn("intransit_later", "In-transit Later", "inbound"),
    textColumn("inbound_risk", "Inbound Risk", "inbound", { width: "110px", render: (r) => badge(r.inbound_risk) }),

    qtyColumn("current_stk_days", "CURRENT STK DAYS", "coverage", { days: true }),
    qtyColumn("current_cov", "Current Cov", "coverage", { days: true }),
    qtyColumn("next_month_cov", "Next Month Cov", "coverage", { days: true }),
    qtyColumn("cov_till_nm", "Cov till NM", "coverage", { days: true }),
    qtyColumn("current_balance", "Current Balance", "coverage"),
    qtyColumn("nm_opening", "NM Opening (proj.)", "coverage"),
    qtyColumn("nm_closing", "NM Closing (proj.)", "coverage"),
    textColumn("status_nm", "Status of NM", "coverage", { width: "130px", render: (r) => badge(r.status_nm) }),
    textColumn("stockout_date", "Stock-out Date", "coverage", { width: "100px" }),
    textColumn("stockout_date_with_inbound", "Stock-out w. In", "coverage", { width: "100px" }),
    textColumn("below_target", "Below Target", "coverage", { width: "90px", read: (r) => yesNo(r.below_target), render: (r) => flag(r.below_target) }),
    textColumn("below_critical", "Below Critical", "coverage", { width: "90px", read: (r) => yesNo(r.below_critical), render: (r) => flag(r.below_critical) }),
    textColumn("below_target_with_in", "Below Target w. In", "coverage", { width: "110px", read: (r) => yesNo(r.below_target_with_in), render: (r) => flag(r.below_target_with_in) }),
    textColumn("below_critical_with_in", "Below Critical w. In", "coverage", { width: "110px", read: (r) => yesNo(r.below_critical_with_in), render: (r) => flag(r.below_critical_with_in) }),

    qtyColumn("cm_days_left", "CM DAYS LEFT", "requirement", { days: true, width: "90px" }),
    qtyColumn("nm_req_days", "NM REQ DAYS", "requirement", { days: true, width: "90px" }),
    qtyColumn("next_month_req", "NEXT MONTH REQ", "requirement"),
    qtyColumn("total_req", "TOTAL REQ", "requirement"),
    qtyColumn("total_prorata", "TOTAL PRORATA", "requirement"),
    qtyColumn("net_req", "Net Req (after stock + in-transit)", "requirement", { width: "150px" }),
    qtyColumn("net_req_moq", "Net Req (MOQ applied)", "requirement", { width: "130px" }),

    qtyColumn("lead_time_effective", "AVG. LEAD TIME (effective)", "leadtime", { days: true, width: "130px" }),
    textColumn("lead_time_source", "Lead Time Source", "leadtime", { width: "160px" }),
    qtyColumn("lead_time_configured_max", "Configured Max", "leadtime", { days: true, width: "100px" }),
    qtyColumn("lead_time_observed_avg", "Observed Avg", "leadtime", { days: true, width: "100px" }),
    qtyColumn("lead_time_observed_max", "Observed Max", "leadtime", { days: true, width: "100px" }),
    qtyColumn("lead_time_observed_p90", "Observed P90", "leadtime", { days: true, width: "100px" }),
    qtyColumn("lead_time_observed_count", "Samples", "leadtime", { width: "70px" }),
    qtyColumn("avg_daily_req", "Avg Daily Req", "leadtime"),
    qtyColumn("safety_day_stock", "Safety Day Stock", "leadtime"),
    qtyColumn("lead_time_stock", "Lead time Stock", "leadtime"),
    qtyColumn("total_stock_level", "Total Stock", "leadtime"),
  ];
}

function SourceDetail({ row }) {
  const poolColumns = [
    { key: "kind", label: "Kind", width: "50px" },
    { key: "group_label", label: "Material Group", width: "200px", render: (p) => dash(p.group_label), copyValue: (p) => p.group_label ?? "" },
    { key: "use_primary", label: "Use Primary", width: "90px", render: (p) => (p.use_primary === null ? "—" : yesNo(p.use_primary)) },
    { key: "candidates", label: "Eligible Members (target first)", width: "280px", render: (p) => p.candidates.join(", "), copyValue: (p) => p.candidates.join(", ") },
    { key: "required_location", label: "Req SLoc", width: "80px" },
    { key: "pool_total", label: "Pool Demand", width: "110px", align: "right", render: (p) => fmtQty(p.pool_total) },
    { key: "this_material_qty", label: "This Material", width: "110px", align: "right", render: (p) => fmtQty(p.this_material_qty) },
    { key: "strokes", label: "Effective Stroke(s)", width: "260px", render: (p) => (p.strokes.length ? p.strokes.join("; ") : "—"), copyValue: (p) => p.strokes.join("; ") },
    { key: "skus", label: "SKU (Pack BOM)", width: "260px", render: (p) => (p.skus.length ? p.skus.join("; ") : "—"), copyValue: (p) => p.skus.join("; ") },
    { key: "prodshades", label: "Prodshade(s) (PO21 plan)", width: "260px", render: (p) => p.prodshades.join("; "), copyValue: (p) => p.prodshades.join("; ") },
  ];
  const inboundColumns = [
    { key: "kind", label: "Kind", width: "120px" },
    { key: "reference", label: "Document (PO / CSN / GE / Lot)", width: "360px" },
    { key: "date", label: "ETA to Plant", width: "100px", render: (e) => e.date ?? "UNKNOWN", copyValue: (e) => e.date ?? "UNKNOWN" },
    { key: "date_source", label: "Date Source", width: "180px" },
    { key: "qty", label: "Qty (base)", width: "110px", align: "right", render: (e) => fmtQty(e.qty) },
  ];
  const routeColumns = [
    { key: "vendor_label", label: "Vendor", width: "260px" },
    { key: "route", label: "Route", width: "90px" },
    { key: "days", label: "Days", width: "60px", align: "right" },
    { key: "detail", label: "Master detail (transit only — no vendor processing time stored)", width: "360px" },
  ];
  return (
    <div className="grid gap-2 bg-slate-50 p-2">
      <div className="text-xs text-slate-600">
        Consumption = posted P261 − P262 this month to the day before the as-of date · Stock = posted ledger at the start of the as-of day ·
        Policy: {row.policy_effective_from ? `effective ${row.policy_effective_from}, version ${row.policy_version_no}, ${row.policy_source_system ?? ""}, by ${row.policy_updated_by ?? "—"}` : "none"} ·
        Lead time: {row.lead_time_source}
      </div>
      <div className="text-xs font-semibold text-slate-700">Demand pools (PO21 plan → Stroke / Pack BOM → this material)</div>
      <ErpDenseGrid columns={poolColumns} rows={row.pools ?? []} rowKey={(p) => `${p.kind}-${p.group_label}-${p.strokes.join()}-${p.skus.join()}-${p.candidates.join()}`} emptyMessage="No planned demand reaches this material." maxHeight="220px" />
      <div className="text-xs font-semibold text-slate-700">Incoming supply (each unit counted once: GE awaiting GRN → dispatched CSN → PO lot → PO remainder)</div>
      <ErpDenseGrid columns={inboundColumns} rows={row.inbound_events ?? []} rowKey={(e) => `${e.reference}-${e.date}-${e.kind}`} emptyMessage="No open PO / CSN / STO supply." maxHeight="200px" />
      <div className="text-xs font-semibold text-slate-700">Configured lead-time routes</div>
      <ErpDenseGrid columns={routeColumns} rows={row.lead_time_routes ?? []} rowKey={(r) => `${r.vendor_label}-${r.route}-${r.detail}`} emptyMessage="No active vendor lead-time master for this material and company." maxHeight="160px" />
    </div>
  );
}

function ReportTab({ companyId, planMonth, asOf, demandAt }) {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [hiddenGroups, setHiddenGroups] = useState(() => new Set());
  const [expanded, setExpanded] = useState("");
  // Rows the grid currently shows after its own column filters (null until it reports).
  const filteredRef = useRef(null);
  const reportKey = ["procurement", "mts-requirement", "report", companyId, planMonth, asOf, demandAt];
  const reportQ = useQuery({
    queryKey: reportKey,
    queryFn: () => getMtsRequirementReport({ company_id: companyId, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined }),
    enabled: Boolean(companyId && planMonth && asOf),
  });
  const report = reportQ.data ?? null;
  const toggleExpanded = useCallback((id) => setExpanded((current) => (current === id ? "" : id)), []);
  const allColumns = useMemo(() => buildReportColumns(expanded, toggleExpanded), [expanded, toggleExpanded]);
  const columns = useMemo(() => allColumns.filter((c) => c.group === "identity" || !hiddenGroups.has(c.group)), [allColumns, hiddenGroups]);
  const rows = useMemo(() => (report?.rows ?? [])
    .filter((row) => typeFilter === "ALL" || row.material_type === typeFilter)
    .filter((row) => riskMatch(row, riskFilter)), [report, typeFilter, riskFilter]);
  const onFilteredRowsChange = useCallback((visible) => { filteredRef.current = visible; }, []);
  const renderExpandedRow = useCallback((row) => (expanded === row.material_id ? <SourceDetail row={row} /> : null), [expanded]);

  function toggleGroup(id) {
    setHiddenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function exportExcel() {
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      const exportColumns = columns.filter((c) => c.key !== "sources");
      // Exactly what the grid shows: same visible column groups, same filtered rows, same order.
      const exportRows = filteredRef.current ?? rows;
      await downloadColoredExcelFile({
        fileName: `po22_requirement_${planMonth}_${asOf}.xlsx`,
        sheetName: "Requirement",
        columns: exportColumns.map((c) => ({ key: c.key, label: c.label, width: c.width, align: c.align, numFmt: c.numFmt })),
        rows: exportRows,
        getCellValue: (row, column) => exportColumns.find((c) => c.key === column.key)?.exportValue?.(row) ?? "",
        preambleRows: [
          ["Company", companyId],
          ["Plan month (CM)", planMonth],
          ["As-of date", asOf],
          ["Demand version", report?.demand_version?.label ?? ""],
          ["Calculated at", report?.provenance?.calculated_at ?? ""],
          ["Source fingerprint", report?.provenance?.source_fingerprint ?? ""],
        ],
      });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    }
  }

  const exceptions = report?.exceptions ?? [];
  const warnings = report?.warnings ?? [];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">RM / PM</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={INPUT_CLASS}>
            <option value="ALL">RM + PM</option>
            <option value="RM">RM</option>
            <option value="PM">PM</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Coverage / Risk</span>
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className={INPUT_CLASS}>
            {RISK_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
          <span className="font-medium">Column groups:</span>
          {COLUMN_GROUPS.map((group) => (
            <label key={group.id} className="flex items-center gap-1">
              <input type="checkbox" checked={!hiddenGroups.has(group.id)} onChange={() => toggleGroup(group.id)} />
              {group.label}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "report", companyId] })}
          className="h-8 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {reportQ.isFetching ? "Calculating…" : "Recalculate"}
        </button>
        <button
          type="button"
          onClick={() => void exportExcel()}
          disabled={!report}
          className="h-8 border border-emerald-600 bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Excel
        </button>
      </div>
      {report ? (
        <p className="text-xs text-slate-500">
          CM {report.calendar.cm_start} → {report.calendar.cm_end} ({report.calendar.cm_days_left} of {report.calendar.cm_days_in_month} days left) ·
          NM {report.calendar.nm_start} → {report.calendar.nm_end} · {report.demand_version.label} ·
          Reservations {report.provenance.reservations_applied ? "applied" : "not applied (past as-of date)"} ·
          Calculated {new Date(report.provenance.calculated_at).toLocaleString()} · Source {String(report.provenance.source_fingerprint).slice(0, 12)}
        </p>
      ) : null}
      {exceptions.length > 0 ? (
        <details className="border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800" open>
          <summary className="cursor-pointer font-semibold">{exceptions.length} exception(s) — demand that could not be exploded</summary>
          <ul className="mt-1 list-disc pl-5">
            {exceptions.map((item, index) => (
              <li key={`${item.code}-${index}`}>{item.code}: {item.message} {[item.prodshade, item.sku, item.material].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {warnings.length > 0 ? (
        <details className="border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          <summary className="cursor-pointer font-semibold">{warnings.length} note(s) / data limitation(s)</summary>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((item, index) => (
              <li key={`${item.code}-${index}`}>{item.code}: {item.message} {[item.prodshade, item.sku, item.material].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <ErpDenseGrid
        {...GRID_PROPS}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.material_id}
        onFilteredRowsChange={onFilteredRowsChange}
        renderExpandedRow={renderExpandedRow}
        emptyMessage={reportQ.isLoading ? "Calculating…" : reportQ.error ? errorText(reportQ.error) : "No RM / PM materials for this company."}
        maxHeight="calc(100vh - 380px)"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2 — Material Settings
// ─────────────────────────────────────────────────────────────────────────────
function policyDraftBase(row, today) {
  const policy = row.policy;
  return {
    target_cov_days: policy?.target_cov_days ?? "",
    critical_cov_days: policy?.critical_cov_days ?? "",
    moq_qty: policy?.moq_qty ?? "",
    moq_uom_code: policy?.moq_uom_code ?? row.base_uom_code ?? "",
    moq_source: policy?.moq_source ?? "NONE",
    moq_active: policy?.moq_active ?? false,
    effective_from: today,
    remarks: policy?.remarks ?? "",
  };
}
function normalizeKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}
function parseNumberOrBlank(value) {
  const textValue = String(value ?? "").trim().replace(/,/g, "");
  if (textValue === "") return "";
  const n = Number(textValue);
  return Number.isFinite(n) ? n : NaN;
}

/** Client checks mirror the save RPC so mistakes show before the round trip. */
function validateDraft(draft, row) {
  const target = parseNumberOrBlank(draft.target_cov_days);
  const critical = parseNumberOrBlank(draft.critical_cov_days);
  const moq = parseNumberOrBlank(draft.moq_qty);
  if (Number.isNaN(target) || Number.isNaN(critical) || Number.isNaN(moq)) return "numbers only";
  if ((target !== "" && target < 0) || (critical !== "" && critical < 0) || (moq !== "" && moq < 0)) return "values may not be negative";
  if (target === "" && critical !== "") return "Critical needs Target";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.effective_from ?? ""))) return "Effective From is required";
  if (draft.moq_source === "NONE" && (moq !== "" || draft.moq_active)) return "MOQ source 'No fixed MOQ' cannot carry a quantity";
  if (moq !== "" && !draft.moq_uom_code) return "MOQ needs a unit";
  if (moq !== "" && !(row.moq_uom_options ?? []).includes(draft.moq_uom_code)) return "MOQ unit has no verified conversion";
  if (draft.moq_active && moq === "") return "active MOQ needs a quantity";
  return "";
}

function PolicyHistory({ companyId, materialId }) {
  const historyQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "policy-history", companyId, materialId],
    queryFn: () => getMtsRequirementPolicyHistory({ company_id: companyId, material_id: materialId }),
  });
  const columns = [
    { key: "updated_at", label: "Saved At", width: "160px", render: (r) => new Date(r.updated_at).toLocaleString(), copyValue: (r) => r.updated_at },
    { key: "updated_by", label: "Saved By", width: "180px" },
    { key: "effective_from", label: "Effective From", width: "110px" },
    { key: "version_no", label: "Ver", width: "50px", align: "right" },
    { key: "status", label: "Status", width: "100px" },
    { key: "target_cov_days", label: "Target", width: "70px", align: "right", render: (r) => fmtDays(r.target_cov_days) },
    { key: "critical_cov_days", label: "Critical", width: "70px", align: "right", render: (r) => fmtDays(r.critical_cov_days) },
    { key: "moq", label: "MOQ", width: "120px", align: "right", render: (r) => (r.moq_qty === null ? "—" : `${fmtQty(r.moq_qty)} ${r.moq_uom_code ?? ""}`), copyValue: (r) => r.moq_qty ?? "" },
    { key: "moq_source", label: "MOQ Source", width: "100px" },
    { key: "moq_active", label: "Active", width: "60px", render: (r) => yesNo(r.moq_active) },
    { key: "source_system", label: "Source", width: "170px" },
    { key: "remarks", label: "Remarks", width: "220px", render: (r) => dash(r.remarks) },
  ];
  return (
    <div className="bg-slate-50 p-2">
      <ErpDenseGrid
        columns={columns}
        rows={historyQ.data?.rows ?? []}
        rowKey={(r) => `${r.effective_from}-${r.version_no}`}
        emptyMessage={historyQ.isLoading ? "Loading…" : historyQ.error ? errorText(historyQ.error) : "No policy saved yet."}
        maxHeight="240px"
      />
    </div>
  );
}

function parseSheetImport(rawText, rows) {
  const byCode = new Map();
  const byName = new Map();
  for (const row of rows) {
    if (row.material_code) byCode.set(normalizeKey(row.material_code), row);
    const key = normalizeKey(row.material_name);
    byName.set(key, byName.has(key) ? null : row); // null = ambiguous name
  }
  const matched = [];
  const unmatched = [];
  const lines = String(rawText ?? "").replace(/\r/g, "").split("\n").filter((line) => line.trim() !== "");
  lines.forEach((line, index) => {
    const cells = line.split("\t").map((cell) => cell.trim());
    const key = normalizeKey(cells[0]);
    if (index === 0 && /ITEM/.test(key) && !byCode.has(key) && !byName.has(key)) return; // header row
    const row = byCode.get(key) ?? byName.get(key);
    if (!row) {
      unmatched.push({ line: index + 1, item: cells[0], reason: byName.get(key) === null ? "name matches more than one material" : "no company material with this code / name" });
      return;
    }
    matched.push({
      material_id: row.material_id,
      item: cells[0],
      target: parseNumberOrBlank(cells[1]),
      critical: parseNumberOrBlank(cells[2]),
      moq: parseNumberOrBlank(cells[3]),
      moq_uom: String(cells[4] ?? "").trim().toUpperCase(),
      moq_active: /^(Y|YES|TRUE|1|ACTIVE)$/i.test(String(cells[5] ?? "").trim()),
      raw: cells,
    });
  });
  return { matched, unmatched };
}

function SettingsTab({ companyId, asOf, access, today }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMoqSource, setImportMoqSource] = useState("");
  const [importResult, setImportResult] = useState(null);
  const orderRef = useRef([]);
  const canEdit = Boolean(access?.can_edit_policy);
  const policiesQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "policies", companyId, asOf],
    queryFn: () => getMtsRequirementPolicies({ company_id: companyId, as_of: asOf }),
    enabled: Boolean(companyId),
  });
  const rows = useMemo(() => policiesQ.data?.rows ?? [], [policiesQ.data]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.material_id, row])), [rows]);

  const valueOf = useCallback((row, field) => {
    const draft = drafts[row.material_id];
    if (draft && field in draft) return draft[field];
    return policyDraftBase(row, today)[field];
  }, [drafts, today]);

  function setField(materialId, field, value) {
    setDrafts((current) => {
      const row = rowById.get(materialId);
      if (!row) return current;
      const base = current[materialId] ?? policyDraftBase(row, today);
      return { ...current, [materialId]: { ...base, [field]: value } };
    });
  }

  // Excel-style paste: a multi-line clipboard fills this column for the rows shown below.
  function handlePaste(event, materialId, field) {
    const clip = event.clipboardData?.getData("text") ?? "";
    if (!clip.includes("\n")) return;
    event.preventDefault();
    const values = clip.replace(/\r/g, "").split("\n").filter((line, index, all) => index < all.length - 1 || line !== "");
    const order = orderRef.current.length ? orderRef.current : rows.map((r) => r.material_id);
    const start = order.indexOf(materialId);
    setDrafts((current) => {
      const next = { ...current };
      values.forEach((value, offset) => {
        const targetId = start < 0 ? null : order[start + offset];
        const row = targetId ? rowById.get(targetId) : null;
        if (!row) return;
        next[targetId] = { ...(next[targetId] ?? policyDraftBase(row, today)), [field]: value.split("\t")[0].trim().replace(/,/g, "") };
      });
      return next;
    });
  }
  // Enter / ↓ moves down the same column, ↑ moves up (Excel feel).
  function handleKeyDown(event) {
    let step = 0;
    if (event.key === "Enter" || event.key === "ArrowDown") step = 1;
    else if (event.key === "ArrowUp") step = -1;
    if (!step || event.currentTarget.tagName === "SELECT") return;
    event.preventDefault();
    const field = event.currentTarget.dataset.field;
    const inputs = [...(event.currentTarget.closest("table")?.querySelectorAll(`[data-field="${field}"]`) ?? [])];
    const target = inputs[inputs.indexOf(event.currentTarget) + step];
    if (target) { target.focus(); target.select?.(); }
  }

  const numberInput = (row, field, width = "w-20", placeholder) => (
    <input
      type="text"
      inputMode="decimal"
      data-field={field}
      disabled={!canEdit}
      placeholder={placeholder}
      className={`${CELL_INPUT} ${width} text-right font-mono`}
      value={valueOf(row, field) ?? ""}
      onKeyDown={handleKeyDown}
      onPaste={(event) => handlePaste(event, row.material_id, field)}
      onChange={(event) => setField(row.material_id, field, event.target.value)}
    />
  );

  const dirtyIds = Object.keys(drafts);
  const errors = useMemo(() => {
    const result = {};
    for (const id of Object.keys(drafts)) {
      const row = rowById.get(id);
      if (row) {
        const message = validateDraft(drafts[id], row);
        if (message) result[id] = message;
      }
    }
    return result;
  }, [drafts, rowById]);

  const columns = [
    { key: "material_name", label: "Material Name", width: "260px", filterValue: (r) => r.material_name },
    { key: "material_code", label: "Material Code", width: "110px", render: (r) => dash(r.material_code), copyValue: (r) => r.material_code ?? "" },
    { key: "material_type", label: "RM / PM", width: "70px" },
    { key: "base_uom_code", label: "Base UoM", width: "70px" },
    {
      key: "current", label: "Current Policy", width: "220px",
      render: (r) => (r.policy
        ? `T ${fmtDays(r.policy.target_cov_days) || "—"} / C ${fmtDays(r.policy.critical_cov_days) || "—"} · MOQ ${r.policy.moq_qty === null ? "—" : `${fmtQty(r.policy.moq_qty)} ${r.policy.moq_uom_code ?? ""}`} (${r.policy.moq_source})`
        : <span className="text-slate-400">No policy</span>),
      filterValue: (r) => (r.policy ? "Has policy" : "No policy"),
      copyValue: (r) => (r.policy ? `${r.policy.target_cov_days ?? ""}/${r.policy.critical_cov_days ?? ""}` : ""),
    },
    { key: "target_cov_days", label: "Target Cov Days", width: "110px", filterable: false, render: (r) => numberInput(r, "target_cov_days"), copyValue: (r) => valueOf(r, "target_cov_days") },
    {
      key: "critical_cov_days", label: "Critical Cov Days", width: "120px", filterable: false,
      render: (r) => {
        const target = parseNumberOrBlank(valueOf(r, "target_cov_days"));
        return numberInput(r, "critical_cov_days", "w-20", typeof target === "number" && Number.isFinite(target) ? `⌈${target}/2⌉=${Math.ceil(target / 2)}` : "");
      },
      copyValue: (r) => valueOf(r, "critical_cov_days"),
    },
    { key: "moq_qty", label: "MOQ Qty", width: "110px", filterable: false, render: (r) => numberInput(r, "moq_qty", "w-24"), copyValue: (r) => valueOf(r, "moq_qty") },
    {
      key: "moq_uom_code", label: "MOQ UoM", width: "90px", filterable: false,
      render: (r) => (
        <select data-field="moq_uom_code" disabled={!canEdit} className={`${CELL_INPUT} w-20`} value={valueOf(r, "moq_uom_code") ?? ""} onChange={(event) => setField(r.material_id, "moq_uom_code", event.target.value)}>
          {(r.moq_uom_options ?? []).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      ),
      copyValue: (r) => valueOf(r, "moq_uom_code"),
    },
    {
      key: "moq_source", label: "MOQ Source", width: "170px", filterable: false,
      render: (r) => (
        <select data-field="moq_source" disabled={!canEdit} className={`${CELL_INPUT} w-40`} value={valueOf(r, "moq_source")} onChange={(event) => setField(r.material_id, "moq_source", event.target.value)}>
          {MOQ_SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ),
      copyValue: (r) => valueOf(r, "moq_source"),
    },
    {
      key: "moq_active", label: "MOQ Active", width: "80px", filterable: false, align: "center",
      render: (r) => <input type="checkbox" disabled={!canEdit} checked={Boolean(valueOf(r, "moq_active"))} onChange={(event) => setField(r.material_id, "moq_active", event.target.checked)} />,
      copyValue: (r) => yesNo(valueOf(r, "moq_active")),
    },
    {
      key: "effective_from", label: "Effective From", width: "140px", filterable: false,
      render: (r) => <input type="date" data-field="effective_from" disabled={!canEdit} className={`${CELL_INPUT} w-32`} value={valueOf(r, "effective_from") ?? ""} onChange={(event) => setField(r.material_id, "effective_from", event.target.value)} />,
      copyValue: (r) => valueOf(r, "effective_from"),
    },
    {
      key: "remarks", label: "Remarks", width: "200px", filterable: false,
      render: (r) => <input type="text" data-field="remarks" maxLength={500} disabled={!canEdit} className={`${CELL_INPUT} w-48`} value={valueOf(r, "remarks") ?? ""} onKeyDown={handleKeyDown} onChange={(event) => setField(r.material_id, "remarks", event.target.value)} />,
      copyValue: (r) => valueOf(r, "remarks"),
    },
    {
      key: "row_state", label: "Change", width: "180px",
      render: (r) => (errors[r.material_id]
        ? <span className="text-xs font-semibold text-rose-700">{errors[r.material_id]}</span>
        : drafts[r.material_id] ? <span className="text-xs font-semibold text-sky-700">{drafts[r.material_id].__imported ? "Imported — unsaved" : "Edited — unsaved"}</span> : ""),
      filterValue: (r) => (errors[r.material_id] ? "Error" : drafts[r.material_id] ? "Unsaved" : ""),
    },
    {
      key: "lead_time", label: "Lead Time (verified)", width: "200px",
      render: (r) => (r.lead_time_effective === null ? <span className="text-slate-400">Unknown</span> : `${fmtDays(r.lead_time_effective)} d · ${r.lead_time_source}`),
      copyValue: (r) => r.lead_time_effective ?? "",
      filterValue: (r) => r.lead_time_source,
    },
    { key: "updated_by", label: "Last Updated By", width: "170px", render: (r) => dash(r.policy?.updated_by), copyValue: (r) => r.policy?.updated_by ?? "" },
    { key: "updated_at", label: "Last Updated At", width: "150px", render: (r) => (r.policy?.updated_at ? new Date(r.policy.updated_at).toLocaleString() : dash(null)), copyValue: (r) => r.policy?.updated_at ?? "" },
    { key: "policy_source", label: "Policy Source", width: "170px", render: (r) => dash(r.policy?.source_system), copyValue: (r) => r.policy?.source_system ?? "" },
    {
      key: "future", label: "Later Policies", width: "120px",
      render: (r) => ((r.future_policies ?? []).length ? (r.future_policies ?? []).map((f) => f.effective_from).join(", ") : ""),
      copyValue: (r) => (r.future_policies ?? []).map((f) => f.effective_from).join(", "),
    },
    {
      key: "history", label: "History", width: "80px", filterable: false,
      render: (r) => (
        <button type="button" onClick={() => setExpanded((current) => (current === r.material_id ? "" : r.material_id))} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">
          {expanded === r.material_id ? "Hide" : "Show"}
        </button>
      ),
    },
  ];

  const renderExpandedRow = useCallback(
    (row) => (expanded === row.material_id ? <PolicyHistory companyId={companyId} materialId={row.material_id} /> : null),
    [expanded, companyId],
  );
  const onFilteredRowsChange = useCallback((visible) => { orderRef.current = visible.map((row) => row.material_id); }, []);

  function stageImport() {
    const result = parseSheetImport(importText, rows);
    const needsSource = result.matched.some((m) => m.moq !== "" && !Number.isNaN(m.moq));
    if (needsSource && !importMoqSource) {
      pushToast({ message: "The pasted rows carry MOQ values: choose whether they are Vendor or Company MOQs first (the sheet does not say).", tone: "error" });
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      for (const item of result.matched) {
        const row = rowById.get(item.material_id);
        const hasMoq = item.moq !== "" && !Number.isNaN(item.moq);
        next[item.material_id] = {
          ...(next[item.material_id] ?? policyDraftBase(row, today)),
          target_cov_days: item.target,
          // Blank critical = legacy default ROUNDUP(Target / 2), applied on save.
          critical_cov_days: item.critical,
          moq_qty: hasMoq ? item.moq : "",
          moq_uom_code: hasMoq ? (item.moq_uom || row.base_uom_code) : (row.base_uom_code ?? ""),
          moq_source: hasMoq ? importMoqSource : "NONE",
          moq_active: hasMoq ? item.moq_active : false,
          __imported: true,
          __source_ref: { sheet: "REQUIREMENT", line: item.raw },
        };
      }
      return next;
    });
    setImportResult(result);
  }

  async function handleSave() {
    if (Object.keys(errors).length > 0) {
      pushToast({ message: `Fix ${Object.keys(errors).length} row(s) marked in the Change column first.`, tone: "error" });
      return;
    }
    const toPayload = (id) => {
      const draft = drafts[id];
      return {
        material_id: id,
        effective_from: draft.effective_from,
        target_cov_days: draft.target_cov_days === "" ? null : Number(draft.target_cov_days),
        critical_cov_days: draft.critical_cov_days === "" ? null : Number(draft.critical_cov_days),
        moq_qty: draft.moq_qty === "" ? null : Number(draft.moq_qty),
        moq_uom_code: draft.moq_qty === "" ? null : draft.moq_uom_code,
        moq_source: draft.moq_source,
        moq_active: Boolean(draft.moq_active),
        remarks: draft.remarks || null,
        source_ref: draft.__source_ref ?? null,
      };
    };
    const imported = dirtyIds.filter((id) => drafts[id].__imported);
    const edited = dirtyIds.filter((id) => !drafts[id].__imported);
    setSaving(true);
    try {
      let saved = 0;
      let unchanged = 0;
      for (const [ids, source] of [[edited, "ERP_ENTRY"], [imported, "LEGACY_GOOGLE_SHEETS"]]) {
        if (ids.length === 0) continue;
        const result = await saveMtsRequirementPolicies({ company_id: companyId, source_system: source, rows: ids.map(toPayload) });
        saved += result?.result?.saved ?? 0;
        unchanged += result?.result?.unchanged ?? 0;
      }
      pushToast({ message: `Saved ${saved} policy row(s)${unchanged ? `, ${unchanged} unchanged` : ""}.`, tone: "success" });
      setDrafts({});
      setImportResult(null);
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement"] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canEdit || saving || dirtyIds.length === 0}
          className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : `Save ${dirtyIds.length || ""}`.trim()}
        </button>
        <button
          type="button"
          onClick={() => setDrafts({})}
          disabled={dirtyIds.length === 0 || saving}
          className="h-8 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Discard changes
        </button>
        <button
          type="button"
          onClick={() => setShowImport((value) => !value)}
          disabled={!canEdit}
          className="h-8 border border-amber-400 bg-amber-50 px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          {showImport ? "Close import" : "Import from REQUIREMENT sheet"}
        </button>
        <span className="text-xs text-slate-500">
          One policy per individual material. Blank Critical = ROUNDUP(Target / 2) on save. Each save is versioned; nothing is overwritten.
          {!canEdit ? " You can view these settings but not change them." : ""}
        </span>
      </div>
      {showImport ? (
        <div className="grid gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <span>
            Paste rows copied from this company's REQUIREMENT sheet in this column order: ITEMS (material code or exact name) · Target Cov · Critical Cov · MOQ · MOQ UoM · MOQ Active (Yes/No).
            Rows are only matched to this company's existing materials — nothing is created. Matched rows are staged below as unsaved edits for review.
          </span>
          <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={5} className="border border-amber-300 bg-white p-1 font-mono text-xs" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              MOQ values in the paste are:
              <select value={importMoqSource} onChange={(event) => setImportMoqSource(event.target.value)} className={INPUT_CLASS}>
                <option value="">— choose —</option>
                <option value="VENDOR">Vendor minimum</option>
                <option value="COMPANY">Company policy</option>
              </select>
            </label>
            <button type="button" onClick={stageImport} className="h-8 border border-amber-500 bg-amber-500 px-3 text-sm font-semibold text-white hover:bg-amber-600">Match and stage</button>
            {importResult ? <span>{importResult.matched.length} matched · {importResult.unmatched.length} not matched</span> : null}
          </div>
          {importResult?.unmatched?.length ? (
            <ul className="list-disc pl-5">
              {importResult.unmatched.map((item) => <li key={`${item.line}-${item.item}`}>Line {item.line} “{item.item}”: {item.reason}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      <ErpDenseGrid
        {...GRID_PROPS}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.material_id}
        onFilteredRowsChange={onFilteredRowsChange}
        renderExpandedRow={renderExpandedRow}
        getRowProps={(row) => (errors[row.material_id] ? { className: "bg-rose-50" } : drafts[row.material_id] ? { className: "bg-sky-50" } : {})}
        emptyMessage={policiesQ.isLoading ? "Loading…" : policiesQ.error ? errorText(policiesQ.error) : "No RM / PM materials on this company's MTS Strokes / Pack BOMs."}
        maxHeight="calc(100vh - 340px)"
      />
    </div>
  );
}

