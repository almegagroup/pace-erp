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
import { ACTION_LEVELS, buildActionRows } from "./mtsActionRows.js";
import MtsGroupSettings from "./MtsGroupSettings.jsx";
import { qtyWithOrderUnit } from "./mtsOrderUnit.js";
import MtsItemPlanTab from "./MtsItemPlanTab.jsx";
import MtsPlanningReschedule from "./MtsPlanningReschedule.jsx";
import MtsRollingPlanDownload from "./MtsRollingPlanDownload.jsx";
import {
  getMtsRequirementAccess,
  getMtsRequirementPolicies,
  getMtsRequirementPolicyHistory,
  getMtsRequirementReport,
  getMtsFinanceSettings,
  getMtsFxRates,
  getMtsLocationPolicy,
  getMtsOptimizerSelections,
  explainMtsPlanning,
  getMtsPlanning,
  getMtsPlanningRun,
  listMtsPlanningRuns,
  saveMtsLocationPolicy,
  saveMtsOptimizerSelections,
  saveMtsPlanningRun,
  saveMtsFinanceSetting,
  saveMtsFxRate,
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
/** Days are whole, rounded down like the sheet (owner 2026-10-21). */
function fmtDays(value) {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.floor(n + 1e-9)) : "";
}
/**
 * A material row can contain PM demand from several Pack BOMs, so this is a
 * provenance summary rather than a false single conversion of the material
 * total. Each value is the source SKU's physical outer-pack count over CM+NM.
 */
function packSourceLabel(pool) {
  if (pool?.kind !== "PM" || pool.outer_qty === null || pool.outer_qty === undefined || !pool.outer_uom_code) return "";
  const fill = pool.fill_qty_per_outer === null || pool.fill_qty_per_outer === undefined
    ? ""
    : ` × ${fmtQty(pool.fill_qty_per_outer)} KG`;
  return `${fmtQty(pool.outer_qty)} ${pool.outer_uom_code}${fill}`;
}
function packSourceSummary(pools) {
  return [...new Set((pools ?? []).map(packSourceLabel).filter(Boolean))].join("; ");
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
    exportValue: (row) => (read(row) === null || read(row) === undefined ? "" : options.days ? Math.floor(Number(read(row)) + 1e-9) : Number(read(row))),
    numFmt: options.days ? "0" : "#,##0.###",
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

const INBOUND_KIND_LABELS = {
  AT_GATE: "At gate (GRN pending)",
  IN_TRANSIT: "In transit (CSN)",
  SCHEDULED_LOT: "PO lot",
  PO_REMAINDER: "Open PO",
  STO_IN_TRANSIT: "STO in transit",
  SUB_CSN_PLANNED: "Sub-CSN transfer (planned)",
};

export default function MtsRequirementPage() {
  const { runtimeContext } = useMenu();
  const today = todayLocal();
  const [companyIdInput, setCompanyId] = useState("");
  const companyId = companyIdInput || resolveDefaultTransactionCompanyId(runtimeContext);
  const [activeTab, setActiveTab] = useState("action");
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
          <MtsRollingPlanDownload runtimeContext={runtimeContext} planMonth={planMonth} asOf={asOf} demandAt={demandMode === "AS_AT" && demandAt ? new Date(demandAt).toISOString() : ""} />
          <div className="flex flex-wrap gap-1">
            {[{ id: "action", label: "Action" }, { id: "report", label: "1. Requirement Report" }, { id: "settings", label: "2. Material Settings" }, { id: "cost", label: "3. Stock & Cost Settings" }, { id: "planning", label: "4. Planning" }, { id: "item", label: "4A. Item Plan" }, { id: "store", label: "5. Store Report" }].map((tab) => (
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
        ) : activeTab === "action" ? (
          <ActionTab companyId={companyId} planMonth={planMonth} asOf={asOf} demandAt={demandMode === "AS_AT" && demandAt ? new Date(demandAt).toISOString() : ""} onOpen={setActiveTab} />
        ) : activeTab === "report" ? (
          <ReportTab
            companyId={companyId}
            planMonth={planMonth}
            asOf={asOf}
            demandAt={demandMode === "AS_AT" && demandAt ? new Date(demandAt).toISOString() : ""}
          />
        ) : activeTab === "settings" ? (
          <SettingsTab companyId={companyId} planMonth={planMonth} asOf={asOf} access={access} today={today} />
        ) : activeTab === "cost" ? (
          <CostSettingsTab companyId={companyId} access={access} today={today} />
        ) : activeTab === "planning" ? (
          <PlanningTab companyId={companyId} planMonth={planMonth} asOf={asOf} demandAt={demandMode === "AS_AT" && demandAt ? new Date(demandAt).toISOString() : ""} access={access} />
        ) : activeTab === "item" ? (
          <MtsItemPlanTab companyId={companyId} planMonth={planMonth} asOf={asOf} demandAt={demandMode === "AS_AT" && demandAt ? new Date(demandAt).toISOString() : ""} />
        ) : (
          <StoreReportTab companyId={companyId} planMonth={planMonth} asOf={asOf} demandAt={demandMode === "AS_AT" && demandAt ? new Date(demandAt).toISOString() : ""} />
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

function buildReportColumns(expanded, toggleExpanded, showPackQty, togglePackQty) {
  return [
    textColumn("material_name", "Material (ITEMS)", "identity", { width: "260px" }),
    textColumn("material_code", "Material Code", "identity", { width: "110px" }),
    textColumn("material_type", "TYPE", "identity", { width: "60px" }),
    textColumn("base_uom_code", "UoM", "identity", { width: "60px" }),
    qtyColumn("priority_score", "Identifier (0–3)", "identity", { width: "100px" }),
    textColumn("reorder_flag", "ID2 (at reorder level)", "identity", { width: "130px", read: (r) => (r.reorder_flag === null ? "" : yesNo(r.reorder_flag)), render: (r) => flag(r.reorder_flag) }),
    textColumn("identifier", "Status", "identity", { width: "120px", render: (r) => badge(r.identifier) }),
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

    qtyColumn("sheet_current_req", "Current Req (remaining CM)", "demand", { width: "150px" }),
    textColumn("sheet_current_req_basis", "Current Req Basis", "demand", { width: "120px", read: (r) => (r.sheet_current_req_basis === "NM" ? "CM consumed → Req NM" : "CM remaining") }),
    qtyColumn("current_prorata_daily", "Current Prorata / day", "demand", { width: "130px" }),
    qtyColumn("cm_req", "CM Req (whole month)", "demand", { width: "130px" }),
    qtyColumn("cm_cons", "CURRENT CONS.", "demand"),
    qtyColumn("nm_req", "Req NM", "demand"),
    qtyColumn("nm_prorata_daily", "Prorata NM / day", "demand", { width: "120px" }),

    qtyColumn("current_stock", "CURRENT_STOCK (counted)", "stock", { width: "130px" }),
    qtyColumn("stock_unrestricted_at_required", "Unrestricted (counted locations)", "stock", { width: "150px" }),
    qtyColumn("stock_reserved_at_required", "Reserved", "stock", { width: "100px" }),
    qtyColumn("stock_other_sloc", "Not counted — transfer (R003 / F…)", "stock", { width: "170px" }),
    textColumn("transfer_suggestion", "Transfer Suggestion", "stock", { width: "200px", render: (r) => (r.transfer_suggestion ? <span className="font-semibold text-amber-800">{r.transfer_suggestion}</span> : dash(null)) }),
    qtyColumn("stock_excluded", "Excluded (OT…)", "stock", { width: "110px" }),
    qtyColumn("stock_committed_transfer_out", "Promised to other company (Sub-CSN)", "stock", { width: "170px" }),
    qtyColumn("stock_exclusive_protected", "Kept for own exclusive use", "stock", { width: "150px" }),
    qtyColumn("stock_protection_used", "Protected stock used by groups", "stock", { width: "160px" }),
    qtyColumn("fixed_demand_qty", "Own fixed demand (CM+NM)", "stock", { width: "150px" }),
    qtyColumn("group_share_qty", "Used by groups (CM+NM)", "stock", { width: "140px" }),
    qtyColumn("stock_qa", "QA Stock", "stock", { width: "90px" }),
    qtyColumn("stock_blocked", "Blocked", "stock", { width: "90px" }),
    textColumn("required_locations", "Counted SLocs", "stock", { width: "110px", read: (r) => (r.required_locations ?? []).join(", ") }),
    textColumn("other_locations", "Transfer SLocs", "stock", { width: "110px", read: (r) => (r.other_locations ?? []).join(", ") }),

    qtyColumn("intransit_cm", "INTRANSIT CM", "inbound"),
    qtyColumn("intransit_dispatched", "Dispatched / At Gate", "inbound", { width: "130px" }),
    qtyColumn("intransit_open_po", "Open PO (not dispatched)", "inbound", { width: "140px" }),
    qtyColumn("intransit_nm", "INTRANSIT NM", "inbound"),
    qtyColumn("intransit_overdue", "In-transit ETA Passed", "inbound", { width: "120px" }),
    qtyColumn("intransit_unknown", "In-transit ETA Unknown", "inbound", { width: "130px" }),
    qtyColumn("intransit_later", "In-transit Later", "inbound"),
    textColumn("inbound_risk", "Inbound Risk", "inbound", { width: "110px", render: (r) => badge(r.inbound_risk) }),

    qtyColumn("current_stk_days", "CURRENT STK DAYS", "coverage", { days: true }),
    qtyColumn("current_cov", "Current Cov", "coverage", { days: true }),
    qtyColumn("next_month_cov", "Next Month Cov", "coverage", { days: true }),
    qtyColumn("cov_till_nm", "Cov till NM", "coverage", { days: true }),
    qtyColumn("current_balance_shortage", "Current Balance (+ = short)", "coverage", { width: "140px" }),
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
    qtyColumn("sheet_next_month_req", "NEXT MONTH REQ", "requirement"),
    qtyColumn("sheet_total_req", "TOTAL REQ", "requirement"),
    qtyColumn("total_prorata_daily", "TOTAL PRORATA / day", "requirement", { width: "130px" }),
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
    qtyColumn("safety_day_stock", "Safety Day Stock (Target × prorata)", "leadtime", { width: "160px" }),
    qtyColumn("lead_time_stock", "Lead time Stock", "leadtime"),
    qtyColumn("total_stock_level", "Total Stock", "leadtime"),
    // Owner 2026-10-20: information only — last column, collapsed by default (header Show / Hide),
    // always exported in full to Excel.
    {
      key: "user_pack_qty",
      label: (
        <span className="flex items-center gap-2">
          Pack Qty (CM + NM)
          <button type="button" onClick={togglePackQty} className="h-5 border border-slate-400 bg-white px-1.5 text-[10px] normal-case tracking-normal text-slate-800 hover:bg-slate-100">
            {showPackQty ? "Hide" : "Show"}
          </button>
        </span>
      ),
      exportLabel: "Pack Qty (CM + NM)",
      group: "identity",
      width: showPackQty ? "420px" : "170px",
      filterable: false,
      render: (r) => (showPackQty ? dash(packSourceSummary(r.pools)) : <span className="text-slate-300">…</span>),
      copyValue: (r) => packSourceSummary(r.pools) ?? "",
      exportValue: (r) => packSourceSummary(r.pools) ?? "",
    },
  ];
}

/** D3: material-null group pools — the group's shortage is never assigned to a member. */
function GroupsView({ groups, expanded, setExpanded, loading }) {
  const columns = [
    { key: "group_label", label: "Group", width: "240px" },
    { key: "kind", label: "RM / PM", width: "70px" },
    { key: "cm_demand", label: "Group demand CM (rest)", width: "150px", align: "right", render: (g) => fmtQty(g.cm_demand), copyValue: (g) => g.cm_demand },
    { key: "nm_demand", label: "Group demand NM", width: "130px", align: "right", render: (g) => fmtQty(g.nm_demand), copyValue: (g) => g.nm_demand },
    { key: "covered_from_stock", label: "Met from members' stock", width: "160px", align: "right", render: (g) => fmtQty(g.covered_from_stock), copyValue: (g) => g.covered_from_stock },
    { key: "uncovered_cm", label: "Group shortage CM", width: "130px", align: "right", render: (g) => <span className={g.uncovered_cm > 0 ? "font-semibold text-rose-700" : ""}>{fmtQty(g.uncovered_cm)}</span>, copyValue: (g) => g.uncovered_cm },
    { key: "uncovered_nm", label: "Group shortage NM", width: "130px", align: "right", render: (g) => <span className={g.uncovered_nm > 0 ? "font-semibold text-rose-700" : ""}>{fmtQty(g.uncovered_nm)}</span>, copyValue: (g) => g.uncovered_nm },
    { key: "first_uncovered_day", label: "First short day", width: "110px", render: (g) => dash(g.first_uncovered_day) },
    { key: "cover_days", label: "Cover days", width: "90px", align: "right", render: (g) => (g.cover_days === null ? "Through NM" : g.cover_days) },
    { key: "members_inbound_total", label: "Members' incoming", width: "130px", align: "right", render: (g) => fmtQty(g.members_inbound_total), copyValue: (g) => g.members_inbound_total },
    { key: "member_flag", label: "Member below Target / Critical", width: "190px", render: (g) => (g.any_member_below_critical ? badge("CRITICAL") : g.any_member_below_target ? badge("BELOW_TARGET") : "") },
    {
      key: "members_btn", label: "Members", width: "90px", filterable: false,
      render: (g) => (
        <button type="button" onClick={() => setExpanded((current) => (current === g.group_id ? "" : g.group_id))} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">
          {expanded === g.group_id ? "Hide" : `Show ${g.members.length}`}
        </button>
      ),
    },
  ];
  const memberColumns = [
    { key: "material_name", label: "Member", width: "260px" },
    { key: "material_code", label: "Code", width: "110px", render: (m) => dash(m.material_code) },
    { key: "fixed_demand_qty", label: "Own fixed demand (met first)", width: "180px", align: "right", render: (m) => fmtQty(m.fixed_demand_qty) },
    { key: "drawn_qty", label: "Given to this group", width: "140px", align: "right", render: (m) => fmtQty(m.drawn_qty) },
    { key: "usable_stock", label: "Counted stock", width: "120px", align: "right", render: (m) => fmtQty(m.usable_stock) },
    { key: "target_cov_days", label: "Target / Critical", width: "120px", render: (m) => `${fmtDays(m.target_cov_days) || "—"} / ${fmtDays(m.critical_cov_days) || "—"}` },
    { key: "flag", label: "Member cover", width: "130px", render: (m) => (m.below_critical ? badge("CRITICAL") : m.below_target ? badge("BELOW_TARGET") : m.below_target === false ? "OK" : "—") },
  ];
  return (
    <div className="grid gap-1">
      <p className="text-xs text-slate-500">
        Each member&apos;s own fixed (exclusive) demand is met first from its stock. What is left serves the group. A group shortage is the group&apos;s,
        bought through the member you select for new buy — it is never charged to one member automatically.
      </p>
      <ErpDenseGrid
        {...GRID_PROPS}
        columns={columns}
        rows={groups}
        rowKey={(g) => g.group_id}
        renderExpandedRow={(g) => (expanded === g.group_id ? (
          <div className="bg-slate-50 p-2"><ErpDenseGrid columns={memberColumns} rows={g.members} rowKey={(m) => m.material_id} fitColumnWidths /></div>
        ) : null)}
        emptyMessage={loading ? "Calculating…" : "No group pools (Use Primary = No / PM groups) in this plan."}
        maxHeight="calc(100vh - 380px)"
      />
    </div>
  );
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
    { key: "outer_qty", label: "User Pack Qty (CM + NM)", width: "150px", align: "right", render: (p) => (p.outer_qty === null ? "—" : `${fmtQty(p.outer_qty)} ${p.outer_uom_code ?? ""}`), copyValue: (p) => p.outer_qty ?? "" },
    { key: "fill_qty_per_outer", label: "Fill / Pack", width: "110px", align: "right", render: (p) => (p.fill_qty_per_outer === null ? "—" : `${fmtQty(p.fill_qty_per_outer)} KG`), copyValue: (p) => p.fill_qty_per_outer ?? "" },
    { key: "strokes", label: "Effective Stroke(s)", width: "260px", render: (p) => (p.strokes.length ? p.strokes.join("; ") : "—"), copyValue: (p) => p.strokes.join("; ") },
    { key: "skus", label: "SKU (Pack BOM)", width: "260px", render: (p) => (p.skus.length ? p.skus.join("; ") : "—"), copyValue: (p) => p.skus.join("; ") },
    { key: "prodshades", label: "Prodshade(s) (PO21 plan)", width: "260px", render: (p) => p.prodshades.join("; "), copyValue: (p) => p.prodshades.join("; ") },
  ];
  const inboundColumns = [
    { key: "kind", label: "Kind", width: "150px", render: (e) => INBOUND_KIND_LABELS[e.kind] ?? e.kind, copyValue: (e) => INBOUND_KIND_LABELS[e.kind] ?? e.kind },
    { key: "reference", label: "Document (PO / CSN / GE / Lot)", width: "360px" },
    { key: "date", label: "ETA to Plant", width: "100px", render: (e) => e.date ?? "UNKNOWN", copyValue: (e) => e.date ?? "UNKNOWN" },
    { key: "date_source", label: "Date Source", width: "180px" },
    { key: "qty", label: "Qty (base)", width: "110px", align: "right", render: (e) => fmtQty(e.qty) },
  ];
  const routeColumns = [
    { key: "vendor_label", label: "Vendor", width: "260px" },
    { key: "route", label: "Route", width: "90px" },
    { key: "days", label: "Days", width: "60px", align: "right" },
    { key: "detail", label: "Lead time detail (Booking Time + route)", width: "360px" },
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
  const [view, setView] = useState("MATERIALS");
  const [expandedGroup, setExpandedGroup] = useState("");
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
  const [showPackQty, setShowPackQty] = useState(false);
  const togglePackQty = useCallback(() => setShowPackQty((current) => !current), []);
  const allColumns = useMemo(() => buildReportColumns(expanded, toggleExpanded, showPackQty, togglePackQty), [expanded, toggleExpanded, showPackQty, togglePackQty]);
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
        columns: exportColumns.map((c) => ({ key: c.key, label: c.exportLabel ?? c.label, width: c.width, align: c.align, numFmt: c.numFmt })),
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
      <div className="flex gap-2">
        {[{ id: "MATERIALS", label: "Materials" }, { id: "GROUPS", label: `Groups (${report?.groups?.length ?? 0})` }].map((option) => (
          <button key={option.id} type="button" onClick={() => setView(option.id)} className={`h-7 border px-3 text-xs font-semibold ${view === option.id ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}>
            {option.label}
          </button>
        ))}
      </div>
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
      {view === "GROUPS" ? (
        <GroupsView groups={(report?.groups ?? []).filter((g) => typeFilter === "ALL" || g.kind === typeFilter)} expanded={expandedGroup} setExpanded={setExpandedGroup} loading={reportQ.isLoading} />
      ) : (
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
      )}
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
    carrying_rate_per_uom: policy?.carrying_rate_per_uom ?? "",
    order_uom_code: policy?.order_uom_code ?? row.base_uom_code ?? "",
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
  const rate = parseNumberOrBlank(draft.carrying_rate_per_uom);
  if (Number.isNaN(target) || Number.isNaN(critical) || Number.isNaN(moq) || Number.isNaN(rate)) return "numbers only";
  if (rate !== "" && rate < 0) return "Rate may not be negative";
  if ((target !== "" && target < 0) || (critical !== "" && critical < 0) || (moq !== "" && moq < 0)) return "values may not be negative";
  if (target === "" && critical !== "") return "Critical needs Target";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.effective_from ?? ""))) return "Effective From is required";
  if (draft.moq_source === "NONE" && (moq !== "" || draft.moq_active)) return "MOQ source 'No fixed MOQ' cannot carry a quantity";
  if (moq !== "" && !draft.moq_uom_code) return "MOQ needs a unit";
  if (moq !== "" && !(row.moq_uom_options ?? []).includes(draft.moq_uom_code)) return "MOQ unit has no verified conversion";
  if (draft.moq_active && moq === "") return "active MOQ needs a quantity";
  if (draft.order_uom_code && !(row.moq_uom_options ?? []).includes(draft.order_uom_code)) return "Order UoM has no verified conversion";
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
  const parsed = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  // A normal copy from legacy REQUIREMENT includes TYPE in column B and MOQ
  // later in the row. Detect its named header so we never misread TYPE as the
  // Target Coverage value. The compact six-column import remains supported.
  const headerIndex = parsed.findIndex((cells) => {
    const labels = cells.map(normalizeKey);
    return labels.includes("ITEMS") && labels.includes("TARGET COV") && labels.includes("CRITICAL COV");
  });
  const header = headerIndex >= 0 ? parsed[headerIndex].map(normalizeKey) : null;
  const indexOf = (...labels) => header ? header.findIndex((value) => labels.includes(value)) : -1;
  const fields = header ? {
    item: indexOf("ITEMS"),
    target: indexOf("TARGET COV"),
    critical: indexOf("CRITICAL COV"),
    moq: indexOf("MOQ"),
    moqUom: indexOf("MOQ UOM", "MOQ UOM CODE"),
    moqActive: indexOf("MOQ ACTIVE"),
  } : { item: 0, target: 1, critical: 2, moq: 3, moqUom: 4, moqActive: 5 };
  parsed.forEach((cells, index) => {
    if (headerIndex >= 0 && index <= headerIndex) return;
    const cell = (field) => field >= 0 ? cells[field] ?? "" : "";
    const item = cell(fields.item);
    const key = normalizeKey(item);
    if (!key) return;
    const row = byCode.get(key) ?? byName.get(key);
    if (!row) {
      unmatched.push({ line: index + 1, item, reason: byName.get(key) === null ? "name matches more than one material" : "no company material with this code / name" });
      return;
    }
    matched.push({
      material_id: row.material_id,
      item,
      target: parseNumberOrBlank(cell(fields.target)),
      critical: parseNumberOrBlank(cell(fields.critical)),
      moq: parseNumberOrBlank(cell(fields.moq)),
      moq_uom: String(cell(fields.moqUom)).trim().toUpperCase(),
      moq_active: /^(Y|YES|TRUE|1|ACTIVE)$/i.test(String(cell(fields.moqActive)).trim()),
      raw: cells,
    });
  });
  return { matched, unmatched };
}

function SettingsTab({ companyId, planMonth, asOf, access, today }) {
  const queryClient = useQueryClient();
  // P3: engine advice (best cycle, Max days, best lot) from the cached planning run.
  const [showAdvice, setShowAdvice] = useState(false);
  const adviceQ = usePlanningQuery(showAdvice ? companyId : "", planMonth, asOf, "");
  const adviceByMaterial = useMemo(() => new Map((adviceQ.data?.material_advice ?? []).map((a) => [a.material_id, a])), [adviceQ.data]);
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

  // D10: change the carrying Rate for every row shown (filters apply) from one month onward.
  const [bulkRate, setBulkRate] = useState("");
  const [bulkRateFrom, setBulkRateFrom] = useState(today);
  function applyBulkRate() {
    const order = orderRef.current.length ? orderRef.current : rows.map((r) => r.material_id);
    setDrafts((current) => {
      const next = { ...current };
      for (const id of order) {
        const row = rowById.get(id);
        if (!row) continue;
        next[id] = { ...(next[id] ?? policyDraftBase(row, today)), carrying_rate_per_uom: bulkRate, effective_from: bulkRateFrom };
      }
      return next;
    });
  }

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
    {
      key: "carrying_rate_per_uom", label: "Rate (₹ / base UoM)", width: "120px", filterable: false,
      render: (r) => numberInput(r, "carrying_rate_per_uom", "w-24", "landed only"),
      copyValue: (r) => valueOf(r, "carrying_rate_per_uom"),
    },
    { key: "moq_qty", label: "MOQ Qty", width: "110px", filterable: false, render: (r) => numberInput(r, "moq_qty", "w-24"), copyValue: (r) => valueOf(r, "moq_qty") },
    {
      // Owner 2026-10-22: unit buy quantities are shown in (Planning, Item Plan, Excel). A vendor's
      // MM03 Supply UoM, when set, is used for that vendor's lines instead.
      key: "order_uom_code", label: "Order UoM", width: "90px", filterable: false,
      render: (r) => (
        <select
          data-field="order_uom_code"
          disabled={!canEdit}
          title="Unit you order in. Planning shows every buy quantity in base unit and in this unit."
          className={`${CELL_INPUT} w-20`}
          value={valueOf(r, "order_uom_code") ?? ""}
          onChange={(event) => setField(r.material_id, "order_uom_code", event.target.value)}
        >
          {(r.moq_uom_options ?? []).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      ),
      copyValue: (r) => valueOf(r, "order_uom_code"),
    },
    {
      key: "moq_uom_code", label: "MOQ UoM", width: "90px", filterable: false,
      render: (r) => (
        // The unit belongs to the MOQ quantity only (blank MOQ = no unit is saved), so it is
        // chosen after the quantity. The ordering unit itself is MM03 "Supply UoM".
        <select
          data-field="moq_uom_code"
          disabled={!canEdit || String(valueOf(r, "moq_qty") ?? "") === ""}
          title={String(valueOf(r, "moq_qty") ?? "") === "" ? "Enter MOQ Qty first — this unit is only the unit of the MOQ quantity." : undefined}
          className={`${CELL_INPUT} w-20 disabled:opacity-50`}
          value={valueOf(r, "moq_uom_code") ?? ""}
          onChange={(event) => setField(r.material_id, "moq_uom_code", event.target.value)}
        >
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
      key: "suggested", label: "Suggested T / C (no booking)", width: "210px", filterable: false,
      render: (r) => (r.suggested_target_days === null && r.suggested_critical_days === null ? <span className="text-slate-400">No route / history</span> : (
        <span className="flex items-center gap-2">
          <span title={r.suggestion_reason ?? `Critical = p90 of how late ${r.delay_sample_count} received shipment(s) arrived vs route time; Target = route time + Critical. Booking Time not included.`}>
            T {fmtDays(r.suggested_target_days) || "—"} / C {fmtDays(r.suggested_critical_days) || "—"}
            <span className="text-xs text-slate-500"> ({r.delay_sample_count} shipments)</span>
          </span>
          {canEdit && r.suggested_target_days !== null ? (
            <button type="button" onClick={() => {
              setField(r.material_id, "target_cov_days", String(r.suggested_target_days));
              if (r.suggested_critical_days !== null) setField(r.material_id, "critical_cov_days", String(r.suggested_critical_days));
            }} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Use</button>
          ) : null}
        </span>
      )),
      copyValue: (r) => `${r.suggested_target_days ?? ""}/${r.suggested_critical_days ?? ""}`,
    },
    {
      key: "best_vs_yours", label: "Best vs yours", width: "220px", filterable: false,
      render: (r) => {
        const yours = valueOf(r, "target_cov_days");
        if (r.suggested_target_days === null || yours === "" || yours === null || yours === undefined) return <span className="text-slate-400">—</span>;
        const diff = Number(yours) - Number(r.suggested_target_days);
        if (Math.abs(diff) < 0.5) return <span className="text-xs text-emerald-700">Same as best</span>;
        return <span className="text-xs text-amber-700" title={r.suggestion_reason ?? ""}>Best {fmtDays(r.suggested_target_days)}, you keep {fmtDays(yours)} ({diff > 0 ? "+" : ""}{fmtDays(diff)} d){valueOf(r, "remarks") ? "" : " — add the reason in Remarks"}</span>;
      },
      copyValue: (r) => r.suggestion_reason ?? "",
    },
    {
      key: "engine_advice", label: "Engine: Max days / best lot", width: "260px", filterable: false,
      render: (r) => {
        if (!showAdvice) return <span className="text-slate-400 text-xs">Load advice ↑</span>;
        const a = adviceByMaterial.get(r.material_id);
        if (!a) return <span className="text-slate-400 text-xs">{adviceQ.isFetching ? "Calculating…" : "Not planned"}</span>;
        return (
          <span className="flex items-center gap-2 text-xs" title={a.reason}>
            <span>Max {fmtDays(a.max_days) || "—"} d · cycle {fmtDays(a.cycle_days)} d{a.cycle_basis === "DEFAULT" ? " (default)" : ""}</span>
            {a.vendor_moq_fixed ? <span className="text-slate-500">vendor MOQ fixed</span> : a.best_lot_qty !== null ? (
              <>
                <span>lot {fmtQty(a.best_lot_qty)} {r.base_uom_code ?? ""}</span>
                {canEdit ? (
                  <button type="button" onClick={() => {
                    setField(r.material_id, "moq_qty", String(a.best_lot_qty));
                    if (r.base_uom_code) setField(r.material_id, "moq_uom_code", r.base_uom_code);
                  }} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Use</button>
                ) : null}
              </>
            ) : null}
          </span>
        );
      },
      copyValue: (r) => { const a = adviceByMaterial.get(r.material_id); return a ? `${a.max_days ?? ""}|${a.best_lot_qty ?? ""}` : ""; },
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
        carrying_rate_per_uom: draft.carrying_rate_per_uom === "" ? null : Number(draft.carrying_rate_per_uom),
        // Base unit = no separate order unit (stored as blank).
        order_uom_code: draft.order_uom_code && draft.order_uom_code !== rowById.get(id)?.base_uom_code ? draft.order_uom_code : null,
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
      <MtsGroupSettings companyId={companyId} asOf={asOf} today={today} canEdit={canEdit} />
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
        <button
          type="button"
          onClick={() => setShowAdvice((value) => !value)}
          className="h-8 border border-sky-300 bg-sky-50 px-3 text-sm font-semibold text-sky-900 hover:bg-sky-100"
          title="Engine advice: best order cycle, Max days, best lot where the vendor has no fixed MOQ"
        >
          {showAdvice ? (adviceQ.isFetching ? "Calculating advice…" : "Hide engine advice") : "Load engine advice"}
        </button>
        <span className="flex items-center gap-1 text-xs text-slate-600">
          Rate for all shown rows
          <input type="text" inputMode="decimal" disabled={!canEdit} value={bulkRate} onChange={(event) => setBulkRate(event.target.value)} placeholder="blank = landed only" className={`${INPUT_CLASS} w-28`} />
          from
          <input type="date" disabled={!canEdit} value={bulkRateFrom} onChange={(event) => setBulkRateFrom(event.target.value)} className={INPUT_CLASS} />
          <button type="button" onClick={applyBulkRate} disabled={!canEdit} className="h-8 border border-slate-300 bg-white px-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Apply</button>
        </span>
        <span className="text-xs text-slate-500">
          One policy per individual material. Blank Critical = ROUNDUP(Target / 2) on save. Each save is versioned; nothing is overwritten.
          {!canEdit ? " You can view these settings but not change them." : ""}
        </span>
      </div>
      {showImport ? (
        <div className="grid gap-2 border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <span>
            Paste either full rows with the legacy REQUIREMENT header (the named ITEMS, Target Cov, Critical Cov, MOQ and optional MOQ Active columns are detected), or a compact selection in this order: ITEMS (material code or exact name) · Target Cov · Critical Cov · MOQ · MOQ UoM · MOQ Active (Yes/No).
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


// ─────────────────────────────────────────────────────────────────────────────
// Tab 3 — Cost Settings (owner decisions D10/D11): exchange rates and company interest %
// ─────────────────────────────────────────────────────────────────────────────
function CostSettingsTab({ companyId, access, today }) {
  const queryClient = useQueryClient();
  const canEdit = Boolean(access?.can_edit_policy);
  const [currency, setCurrency] = useState("USD");
  const [fxDraft, setFxDraft] = useState({ rate_date: today, inr_per_unit: "", remarks: "" });
  const [interestDraft, setInterestDraft] = useState({ effective_from: today, interest_pct_per_year: "", remarks: "" });
  const [saving, setSaving] = useState("");

  const fxQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "fx-rates", companyId, currency],
    queryFn: () => getMtsFxRates({ company_id: companyId, currency }),
    enabled: Boolean(companyId) && /^[A-Z]{3}$/.test(currency),
  });
  const financeQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "finance-settings", companyId],
    queryFn: () => getMtsFinanceSettings({ company_id: companyId }),
    enabled: Boolean(companyId),
  });
  const locationQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "location-policy", companyId],
    queryFn: () => getMtsLocationPolicy({ company_id: companyId }),
    enabled: Boolean(companyId),
  });
  const [roleDrafts, setRoleDrafts] = useState({});
  const locationRows = locationQ.data?.rows ?? [];
  async function saveRoles() {
    setSaving("roles");
    try {
      const rowsToSave = Object.entries(roleDrafts).map(([storage_location_id, role]) => ({ storage_location_id, role }));
      await saveMtsLocationPolicy({ company_id: companyId, rows: rowsToSave });
      pushToast({ message: `Saved ${rowsToSave.length} location role(s). Recalculate the Requirement to apply.`, tone: "success" });
      setRoleDrafts({});
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement"] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving("");
    }
  }
  const fxRows = fxQ.data?.rows ?? [];
  const effective = fxQ.data?.effective_today ?? null;
  const financeRows = financeQ.data?.rows ?? [];

  async function saveFx() {
    setSaving("fx");
    try {
      await saveMtsFxRate({ company_id: companyId, currency_code: currency, ...fxDraft, inr_per_unit: Number(fxDraft.inr_per_unit) });
      pushToast({ message: `Manual ${currency} rate saved for ${fxDraft.rate_date}.`, tone: "success" });
      setFxDraft((current) => ({ ...current, inr_per_unit: "", remarks: "" }));
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "fx-rates", companyId] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving("");
    }
  }
  async function saveInterest() {
    setSaving("interest");
    try {
      await saveMtsFinanceSetting({ company_id: companyId, ...interestDraft, interest_pct_per_year: Number(interestDraft.interest_pct_per_year) });
      pushToast({ message: `Interest % saved from ${interestDraft.effective_from}.`, tone: "success" });
      setInterestDraft((current) => ({ ...current, interest_pct_per_year: "", remarks: "" }));
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "finance-settings", companyId] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving("");
    }
  }

  const fxColumns = [
    { key: "rate_date", label: "Date", width: "110px" },
    { key: "source", label: "Source", width: "90px", render: (r) => (r.source === "MANUAL" ? "Manual" : "Auto") },
    { key: "inr_per_unit", label: `₹ per 1 ${currency}`, width: "120px", align: "right", render: (r) => Number(r.inr_per_unit).toFixed(4), copyValue: (r) => r.inr_per_unit },
    { key: "provider_rate_date", label: "Provider Date", width: "110px", render: (r) => dash(r.provider_rate_date) },
    { key: "provider", label: "Provider", width: "150px", render: (r) => dash(r.provider) },
    { key: "remarks", label: "Remarks", width: "220px", render: (r) => dash(r.remarks) },
  ];
  const financeColumns = [
    { key: "effective_from", label: "Effective From", width: "120px" },
    { key: "interest_pct_per_year", label: "Interest % / year", width: "130px", align: "right", render: (r) => Number(r.interest_pct_per_year).toFixed(2) },
    { key: "remarks", label: "Remarks", width: "260px", render: (r) => dash(r.remarks) },
  ];

  const roleLabel = { COUNTED: "Counted", TRANSFER_SOURCE: "Shown + transfer referral", EXCLUDED: "Excluded" };
  const locationColumns = [
    { key: "location_code", label: "Location", width: "90px" },
    { key: "location_name", label: "Name", width: "260px" },
    {
      key: "role", label: "Planning role", width: "220px", filterable: false,
      render: (r) => (
        <select disabled={!canEdit} value={roleDrafts[r.storage_location_id] ?? r.role} onChange={(event) => setRoleDrafts((c) => ({ ...c, [r.storage_location_id]: event.target.value }))} className={`${INPUT_CLASS} w-52`}>
          {Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      ),
      copyValue: (r) => roleLabel[r.role] ?? r.role,
    },
    { key: "configured", label: "Set", width: "70px", render: (r) => (r.configured ? "Yes" : <span className="text-amber-700">Default</span>) },
  ];

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Stock locations</h3>
        <p className="text-xs text-slate-500">
          Counted = usable stock (pooled across all counted locations). Shown + transfer referral = visible, never counted, the Requirement suggests an R→R move only between R stores (e.g. R003 → R001); stock elsewhere is only shown as "held at".
          Excluded = ignored (OT01 / OT02). A location not set yet behaves as &quot;Shown + transfer referral&quot;.
        </p>
        {canEdit ? (
          <div>
            <button type="button" onClick={() => void saveRoles()} disabled={saving === "roles" || Object.keys(roleDrafts).length === 0} className="h-8 border border-sky-600 bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {saving === "roles" ? "Saving…" : `Save roles ${Object.keys(roleDrafts).length || ""}`.trim()}
            </button>
          </div>
        ) : null}
        <ErpDenseGrid {...GRID_PROPS} columns={locationColumns} rows={locationRows} rowKey={(r) => r.storage_location_id} />
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Exchange rates</h3>
        <p className="text-xs text-slate-500">
          Fetched automatically every day (first view of the day) from a public reference rate; a manual rate on the same date wins.
          Planning uses: BOE rate on the CSN → rate on the BOE date → today&apos;s rate. Holidays use the last available rate.
        </p>
        <div className="flex flex-wrap items-end gap-2 text-xs text-slate-600">
          <label className="grid gap-1">Currency
            <input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} className={`${INPUT_CLASS} w-20`} />
          </label>
          <span className="pb-2 text-sm">
            Today: {effective ? <strong>₹ {Number(effective.inr_per_unit).toFixed(4)}</strong> : <span className="text-rose-700">no rate</span>}
            {effective ? ` · ${effective.source === "MANUAL" ? "manual" : "auto"} · ${effective.rate_date}${effective.stale ? " (last available)" : ""}` : ""}
            {fxQ.data && !fxQ.data.fetched_today ? <span className="ml-2 text-amber-700">Today&apos;s automatic fetch did not succeed.</span> : null}
          </span>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 text-xs text-slate-600">
            <label className="grid gap-1">Date<input type="date" value={fxDraft.rate_date} onChange={(event) => setFxDraft((c) => ({ ...c, rate_date: event.target.value }))} className={INPUT_CLASS} /></label>
            <label className="grid gap-1">₹ per 1 {currency}<input type="text" inputMode="decimal" value={fxDraft.inr_per_unit} onChange={(event) => setFxDraft((c) => ({ ...c, inr_per_unit: event.target.value }))} className={`${INPUT_CLASS} w-28`} /></label>
            <label className="grid gap-1">Remarks<input value={fxDraft.remarks} maxLength={300} onChange={(event) => setFxDraft((c) => ({ ...c, remarks: event.target.value }))} className={`${INPUT_CLASS} w-56`} /></label>
            <button type="button" onClick={() => void saveFx()} disabled={saving === "fx" || !(Number(fxDraft.inr_per_unit) > 0)} className="h-8 border border-sky-600 bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {saving === "fx" ? "Saving…" : "Save manual rate"}
            </button>
          </div>
        ) : null}
        <ErpDenseGrid {...GRID_PROPS} columns={fxColumns} rows={fxRows} rowKey={(r) => `${r.rate_date}|${r.source}`} />
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Company interest %</h3>
        <p className="text-xs text-slate-500">
          Cost of money tied up: value × % × days from paying the vendor to receiving the customer payment. Applies from its date until a later one.
        </p>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 text-xs text-slate-600">
            <label className="grid gap-1">Effective From<input type="date" value={interestDraft.effective_from} onChange={(event) => setInterestDraft((c) => ({ ...c, effective_from: event.target.value }))} className={INPUT_CLASS} /></label>
            <label className="grid gap-1">Interest % / year<input type="text" inputMode="decimal" value={interestDraft.interest_pct_per_year} onChange={(event) => setInterestDraft((c) => ({ ...c, interest_pct_per_year: event.target.value }))} className={`${INPUT_CLASS} w-24`} /></label>
            <label className="grid gap-1">Remarks<input value={interestDraft.remarks} maxLength={300} onChange={(event) => setInterestDraft((c) => ({ ...c, remarks: event.target.value }))} className={`${INPUT_CLASS} w-56`} /></label>
            <button type="button" onClick={() => void saveInterest()} disabled={saving === "interest" || interestDraft.interest_pct_per_year === ""} className="h-8 border border-sky-600 bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {saving === "interest" ? "Saving…" : "Save interest %"}
            </button>
          </div>
        ) : null}
        <ErpDenseGrid {...GRID_PROPS} columns={financeColumns} rows={financeRows} rowKey={(r) => r.effective_from} />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4 — Planning (sheet PLANNING equivalent): advisory buys, ETA flags, group shortage, daily grid
// ─────────────────────────────────────────────────────────────────────────────
const BUY_STATUS_TONE = { ADVISORY: "BELOW_TARGET", ADVISORY_LATE: "CRITICAL", UNKNOWN_POLICY: "NO_POLICY", UNKNOWN_LEAD_TIME: "NO_POLICY", NO_BUY: "OK" };
const BUY_STATUS_LABEL = { ADVISORY: "Buy", ADVISORY_LATE: "Buy — late", UNKNOWN_POLICY: "No Target set", UNKNOWN_LEAD_TIME: "No lead time", NO_BUY: "No buy" };
function buyBadge(status) {
  const tone = BADGE_TONE[BUY_STATUS_TONE[status]] ?? "bg-slate-100 text-slate-700";
  return <span className={`px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{BUY_STATUS_LABEL[status] ?? status}</span>;
}

function usePlanningQuery(companyId, planMonth, asOf, demandAt) {
  return useQuery({
    queryKey: ["procurement", "mts-requirement", "planning", companyId, planMonth, asOf, demandAt],
    queryFn: () => getMtsPlanning({ company_id: companyId, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined }),
    enabled: Boolean(companyId && planMonth && asOf),
  });
}

/** Owner: Critical + Replenishment in one simple list — what to do, by when, why. */
function ActionTab({ companyId, planMonth, asOf, demandAt, onOpen }) {
  const planningQ = usePlanningQuery(companyId, planMonth, asOf, demandAt);
  const rows = useMemo(() => buildActionRows(planningQ.data ?? null), [planningQ.data]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(ACTION_LEVELS).map((level) => [level, rows.filter((r) => r.level === level).length])), [rows]);
  const levelTone = { URGENT: "bg-rose-100 text-rose-800", SOON: "bg-amber-100 text-amber-800", PLAN: "bg-sky-100 text-sky-800", FIX_DATA: "bg-slate-100 text-slate-700" };
  const columns = [
    { key: "level", label: "Priority", width: "100px", render: (r) => <span className={`px-2 py-0.5 text-xs font-semibold ${levelTone[r.level]}`}>{ACTION_LEVELS[r.level].label}</span>, copyValue: (r) => ACTION_LEVELS[r.level].label },
    { key: "action", label: "What to do", width: "240px", render: (r) => <span className="font-semibold text-slate-800">{r.action}</span> },
    { key: "material", label: "Material / Group", width: "260px" },
    { key: "code", label: "Code", width: "100px", render: (r) => dash(r.code) },
    { key: "by_when", label: "By when", width: "100px", render: (r) => dash(r.by_when) },
    { key: "qty", label: "Qty", width: "180px", align: "right", render: (r) => qtyWithOrderUnit(r.qty, r.uom, r.order_unit), copyValue: (r) => r.qty ?? "" },
    { key: "vendor", label: "Vendor", width: "220px", render: (r) => dash(r.vendor) },
    { key: "shortage_day", label: "Runs out", width: "100px", render: (r) => (r.shortage_day ? <span className="font-semibold text-rose-700">{r.shortage_day}</span> : "—"), copyValue: (r) => r.shortage_day ?? "" },
    { key: "why", label: "Why", width: "420px" },
  ];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {Object.entries(ACTION_LEVELS).map(([level, meta]) => (
          <span key={level} className={`px-2 py-1 font-semibold ${levelTone[level]}`}>{meta.label}: {counts[level] ?? 0}</span>
        ))}
        <span className="text-xs text-slate-500">Advisory only — never creates a PO. Details and vendor cost comparison are in 4. Planning.</span>
        <button type="button" onClick={() => onOpen("planning")} className="h-8 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Open Planning</button>
      </div>
      {planningQ.error ? <p className="text-sm text-rose-700">{errorText(planningQ.error)}</p> : null}
      <ErpDenseGrid
        {...GRID_PROPS}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage={planningQ.isLoading ? "Calculating…" : "Nothing to do — every material is covered through next month."}
        maxHeight="65vh"
      />
    </div>
  );
}

function PlanningTab({ companyId, planMonth, asOf, demandAt, access }) {
  const queryClient = useQueryClient();
  const canEdit = Boolean(access?.can_edit_policy);
  const planningQ = usePlanningQuery(companyId, planMonth, asOf, demandAt);
  const plan = planningQ.data ?? null;
  const [showNoBuy, setShowNoBuy] = useState(false);
  const [dailyMaterial, setDailyMaterial] = useState("");
  const [costOpen, setCostOpen] = useState("");
  const [saving, setSaving] = useState(false);
  const buys = useMemo(() => (plan?.buys ?? []).filter((b) => showNoBuy || b.status !== "NO_BUY"), [plan, showNoBuy]);
  const materialsWithDaily = useMemo(() => {
    const seen = new Map();
    for (const row of plan?.daily ?? []) if (!seen.has(row.material_id)) seen.set(row.material_id, `${row.material_code ?? ""} ${row.material_name}`.trim());
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [plan]);
  const dailyRows = useMemo(() => (plan?.daily ?? []).filter((r) => r.material_id === dailyMaterial), [plan, dailyMaterial]);

  async function saveRun() {
    setSaving(true);
    try {
      const result = await saveMtsPlanningRun({ company_id: companyId, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined });
      pushToast({ message: `Planning run saved (${String(result?.source_fingerprint ?? "").slice(0, 12)}).`, tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "planning-runs", companyId] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const buyColumns = [
    { key: "material_name", label: "Material", width: "240px" },
    { key: "material_code", label: "Code", width: "100px", render: (b) => dash(b.material_code) },
    { key: "status", label: "Status", width: "130px", render: (b) => buyBadge(b.status), copyValue: (b) => BUY_STATUS_LABEL[b.status] ?? b.status },
    { key: "sequence", label: "#", width: "40px", align: "right", render: (b) => (b.sequence || "") },
    { key: "required_qty_base", label: "Required", width: "110px", align: "right", render: (b) => fmtQty(b.required_qty_base), copyValue: (b) => b.required_qty_base },
    { key: "recommended_po_qty_base", label: "PO Qty (MOQ / multiple)", width: "200px", align: "right", render: (b) => qtyWithOrderUnit(b.recommended_po_qty_base, b.uom, b.order_unit), copyValue: (b) => b.recommended_po_qty_base ?? "" },
    { key: "recommended_po_by", label: "PO By", width: "100px", render: (b) => dash(b.recommended_po_by) },
    { key: "estimated_plant_eta", label: "Plant ETA", width: "100px", render: (b) => dash(b.estimated_plant_eta) },
    { key: "lots", label: "Delivery Lots", width: "220px", render: (b) => ((b.lots ?? []).length ? b.lots.map((l) => `${l.plant_eta}: ${fmtQty(l.qty_base)}`).join(" · ") : "—"), copyValue: (b) => (b.lots ?? []).map((l) => `${l.plant_eta}:${l.qty_base}`).join(" ") },
    { key: "vendor_label", label: "Vendor", width: "220px", render: (b) => dash(b.vendor_label) },
    { key: "vendor_basis", label: "Vendor basis", width: "140px", render: (b) => ({ LOWEST_TOTAL_COST: "Lowest total cost", FASTEST_FEASIBLE: "Fastest (cost unknown)" }[b.vendor_basis] ?? "—") },
    {
      key: "cost_btn", label: "Cost compare", width: "110px", filterable: false,
      render: (b) => ((b.cost_options ?? []).length ? (
        <button type="button" onClick={() => setCostOpen((c) => (c === `${b.material_id}|${b.sequence}` ? "" : `${b.material_id}|${b.sequence}`))} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">
          {costOpen === `${b.material_id}|${b.sequence}` ? "Hide" : `${b.cost_options.length} vendor(s)`}
        </button>
      ) : "—"),
    },
    { key: "total_lead_time_days", label: "Lead (booking + route)", width: "140px", render: (b) => (b.total_lead_time_days === null ? "—" : `${b.total_lead_time_days} d${b.booking_time_days ? ` (incl. ${b.booking_time_days} booking)` : ""}`), copyValue: (b) => b.total_lead_time_days ?? "" },
    { key: "reason", label: "Why", width: "360px" },
  ];
  const flagColumns = [
    { key: "material_name", label: "Material", width: "240px" },
    { key: "document", label: "Document", width: "280px" },
    { key: "eta_to_plant", label: "CSN ETA", width: "100px", render: (f) => dash(f.eta_to_plant) },
    { key: "reason", label: "Issue", width: "110px", render: (f) => (f.reason === "ETA_PASSED" ? badge("OVERDUE") : badge("ETA_UNKNOWN")), copyValue: (f) => f.reason },
    { key: "message", label: "Action", width: "420px" },
  ];
  const groupColumns = [
    { key: "group_label", label: "Group", width: "240px" },
    { key: "month", label: "Month", width: "90px", render: (a) => String(a.month).slice(0, 7) },
    { key: "uncovered_qty", label: "Group shortage", width: "120px", align: "right", render: (a) => fmtQty(a.uncovered_qty), copyValue: (a) => a.uncovered_qty },
    { key: "assigned_material_name", label: "Planned through member", width: "240px", render: (a) => (a.assigned_material_name ?? <span className="font-semibold text-rose-700">Select a member for new buy</span>), copyValue: (a) => a.assigned_material_name ?? "" },
    { key: "reason", label: "Basis", width: "160px", render: (a) => ({ SINGLE_SELECTED: "Your selection", CHEAPEST_SELECTED: "Cheapest of selected", AUTO_SELECTED: "Engine chose (nothing selected) — lowest total cost", NONE_SELECTED: "No member has a vendor — set up a vendor" }[a.reason] ?? a.reason) },
  ];
  const dailyColumns = [
    { key: "day", label: "Date", width: "100px" },
    { key: "opening_qty_base", label: "Opening", width: "110px", align: "right", render: (r) => fmtQty(r.opening_qty_base), copyValue: (r) => r.opening_qty_base },
    { key: "confirmed_arrival_qty_base", label: "ETA to Plant", width: "110px", align: "right", render: (r) => (r.confirmed_arrival_qty_base ? fmtQty(r.confirmed_arrival_qty_base) : ""), copyValue: (r) => r.confirmed_arrival_qty_base },
    { key: "planned_lot_qty_base", label: "Proposed Lot", width: "110px", align: "right", render: (r) => (r.planned_lot_qty_base ? <span className="font-semibold text-sky-800">{fmtQty(r.planned_lot_qty_base)}</span> : ""), copyValue: (r) => r.planned_lot_qty_base },
    { key: "demand_qty_base", label: "Pro-rata Use", width: "110px", align: "right", render: (r) => fmtQty(r.demand_qty_base), copyValue: (r) => r.demand_qty_base },
    { key: "closing_qty_base", label: "Closing", width: "110px", align: "right", render: (r) => <span className={r.closing_qty_base < 0 ? "font-semibold text-rose-700" : ""}>{fmtQty(r.closing_qty_base)}</span>, copyValue: (r) => r.closing_qty_base },
    { key: "max_cover_days", label: "Max Days", width: "80px", align: "right", render: (r) => fmtDays(r.max_cover_days) || "—", copyValue: (r) => r.max_cover_days ?? "" },
    { key: "min_stock_qty_base", label: "Min Stock", width: "110px", align: "right", render: (r) => fmtQty(r.min_stock_qty_base), copyValue: (r) => r.min_stock_qty_base },
    { key: "min_cover_days", label: "Min Days", width: "80px", align: "right", render: (r) => fmtDays(r.min_cover_days) || "—", copyValue: (r) => r.min_cover_days ?? "" },
    { key: "target_days", label: "Target / Critical", width: "110px", render: (r) => `${fmtDays(r.target_days) || "—"} / ${fmtDays(r.critical_days) || "—"}` },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "planning", companyId] })} className="h-8 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          {planningQ.isFetching ? "Calculating…" : "Recalculate"}
        </button>
        <button type="button" onClick={() => void saveRun()} disabled={!canEdit || saving || !plan} className="h-8 border border-sky-600 bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save this run"}
        </button>
        <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={showNoBuy} onChange={(event) => setShowNoBuy(event.target.checked)} /> Show materials with no buy</label>
        {plan ? <span className="text-xs text-slate-500">Advisory only — never creates a PO. CM + NM horizon {plan.calendar.as_of} → {plan.calendar.nm_end} · Source {String(plan.source_fingerprint).slice(0, 12)}</span> : null}
      </div>
      {planningQ.error ? <p className="text-sm text-rose-700">{errorText(planningQ.error)}</p> : null}

      <section className="grid gap-1">
        <h3 className="text-sm font-semibold text-slate-800">Buy recommendations</h3>
        <ErpDenseGrid
          {...GRID_PROPS}
          columns={buyColumns}
          rows={buys}
          rowKey={(b) => `${b.material_id}|${b.sequence}|${b.status}`}
          renderExpandedRow={(b) => (costOpen === `${b.material_id}|${b.sequence}` ? <CostCompare options={b.cost_options} basis={plan?.cost_basis} uom={b.uom} /> : null)}
          emptyMessage={planningQ.isLoading ? "Calculating…" : "No buy needed in CM + NM."}
          maxHeight="40vh"
        />
      </section>

      <MtsPlanningReschedule companyId={companyId} planMonth={planMonth} asOf={asOf} demandAt={demandAt} arrivals={plan?.reschedulable_arrivals ?? []} />

      {(plan?.arrival_flags ?? []).length > 0 ? (
        <section className="grid gap-1">
          <h3 className="text-sm font-semibold text-rose-800">CSN ETA needs update (assumed arriving today until changed in CSN Tracker)</h3>
          <ErpDenseGrid {...GRID_PROPS} columns={flagColumns} rows={plan.arrival_flags} rowKey={(f) => f.source_key} maxHeight="30vh" />
        </section>
      ) : null}

      <section className="grid gap-1">
        <h3 className="text-sm font-semibold text-slate-800">Group shortages</h3>
        <ErpDenseGrid {...GRID_PROPS} columns={groupColumns} rows={plan?.group_assignments ?? []} rowKey={(a) => `${a.group_id}|${a.month}`} emptyMessage="No group shortage in CM + NM." maxHeight="30vh" />
        <MemberSelection companyId={companyId} planMonth={planMonth} plan={plan} canEdit={canEdit} />
      </section>

      <AiExplain companyId={companyId} planMonth={planMonth} asOf={asOf} demandAt={demandAt} buys={plan?.buys ?? []} />

      <section className="grid gap-1">
        <h3 className="text-sm font-semibold text-slate-800">Daily planning (sheet PLANNING)</h3>
        <select value={dailyMaterial} onChange={(event) => setDailyMaterial(event.target.value)} className={`${INPUT_CLASS} w-96`}>
          <option value="">Select a material…</option>
          {materialsWithDaily.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {dailyMaterial ? <ErpDenseGrid {...GRID_PROPS} columns={dailyColumns} rows={dailyRows} rowKey={(r) => r.day} maxHeight="50vh" /> : null}
      </section>
    </div>
  );
}

/** Phase 2D §8: AI explains the deterministic plan; it never changes a number. */
function AiExplain({ companyId, planMonth, asOf, demandAt, buys }) {
  const [material, setMaterial] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => [...new Set(buys.filter((b) => b.status !== "NO_BUY").map((b) => b.material_name))].sort(), [buys]);
  async function ask() {
    setBusy(true);
    try {
      const result = await explainMtsPlanning({ company_id: companyId, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined, material_name: material || undefined, question: question || undefined });
      setAnswer(result);
    } catch (error) {
      setAnswer({ error: errorText(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-1 border border-violet-200 bg-violet-50 p-2">
      <h3 className="text-sm font-semibold text-violet-900">Explain with AI (advisory)</h3>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <select value={material} onChange={(event) => setMaterial(event.target.value)} className={`${INPUT_CLASS} w-72`}>
          <option value="">Whole plan</option>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <input value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="Optional question (e.g. which import is most urgent?)" className={`${INPUT_CLASS} w-96`} />
        <button type="button" onClick={() => void ask()} disabled={busy} className="h-8 border border-violet-600 bg-violet-600 px-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy ? "Thinking…" : "Explain"}</button>
      </div>
      {answer?.error ? <p className="text-xs text-rose-700">{answer.error}</p> : null}
      {answer?.explanation ? (
        <div className="grid gap-1">
          <pre className="whitespace-pre-wrap text-sm text-slate-800">{answer.explanation}</pre>
          <span className="text-[11px] text-slate-500">{answer.note} · {answer.usage ? `${answer.usage.input_tokens + answer.usage.output_tokens} tokens` : ""}</span>
        </div>
      ) : null}
    </section>
  );
}

/** D8/D10/D11: per-vendor total cost for one buy (advisory). */
function CostCompare({ options, basis, uom }) {
  const columns = [
    { key: "rank", label: "Rank", width: "50px", render: (o) => (o.rank ?? "—") },
    { key: "vendor_label", label: "Vendor", width: "220px" },
    { key: "feasible", label: "On time", width: "70px", render: (o) => (o.feasible ? "Yes" : <span className="text-rose-700">No</span>) },
    { key: "lead_time_days", label: "Lead (d)", width: "70px", align: "right", render: (o) => (o.lead_time_days ?? "—") },
    { key: "unit_price_inr", label: `Price ₹/${uom ?? "unit"}`, width: "110px", align: "right", render: (o) => (o.unit_price_inr === null ? "—" : `${fmtQty(o.unit_price_inr)}${o.currency && o.currency !== "INR" ? ` (${o.currency} @ ${o.fx_inr ?? "?"})` : ""}`) },
    { key: "landed_adder", label: "Landed ₹/unit", width: "120px", align: "right", render: (o) => (o.landed_adder === null ? "—" : `${fmtQty(o.landed_adder)}${o.landed_basis === "PROVISIONAL" ? " (draft)" : ""}`) },
    { key: "days_money_tied", label: "Days money tied", width: "120px", align: "right", render: (o) => (o.days_money_tied ?? "—") },
    { key: "financing_per_unit", label: "Interest ₹/unit", width: "110px", align: "right", render: (o) => (o.financing_per_unit === null ? "—" : fmtQty(o.financing_per_unit)) },
    { key: "total_per_unit", label: "Total ₹/unit", width: "110px", align: "right", render: (o) => (o.total_per_unit === null ? "—" : <strong>{fmtQty(o.total_per_unit)}</strong>) },
    { key: "order_qty", label: "Order qty", width: "110px", align: "right", render: (o) => (o.order_qty === null ? "—" : fmtQty(o.order_qty)) },
    { key: "excess_cost", label: "MOQ excess cost ₹", width: "130px", align: "right", render: (o) => (o.excess_cost === null ? "—" : fmtQty(o.excess_cost)) },
    { key: "total_cost", label: "Total cost ₹", width: "130px", align: "right", render: (o) => (o.total_cost === null ? "—" : <strong>{fmtQty(o.total_cost)}</strong>) },
    { key: "missing", label: "Not known", width: "220px", render: (o) => ((o.missing ?? []).length ? <span className="text-amber-700">{o.missing.join(", ")}</span> : "") },
  ];
  return (
    <div className="grid gap-1 bg-slate-50 p-2">
      <span className="text-xs text-slate-600">
        Interest {basis?.interest_pct ?? "not set"}% · customer pays in {basis?.customer_credit_days ?? "?"} days · advisory: you decide the vendor.
      </span>
      <ErpDenseGrid columns={columns} rows={options ?? []} rowKey={(o) => o.vendor_label} fitColumnWidths />
    </div>
  );
}

/** D3: monthly "use for new buy" choice for group members (Phase 3B selection). */
function MemberSelection({ companyId, planMonth, plan, canEdit }) {
  const queryClient = useQueryClient();
  const months = useMemo(() => {
    const cm = `${planMonth}-01`;
    const d = new Date(`${cm}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return [cm, d.toISOString().slice(0, 10)];
  }, [planMonth]);
  const selQ = useQuery({
    queryKey: ["procurement", "mts-optimizer", "selections", companyId],
    queryFn: () => getMtsOptimizerSelections({ company_id: companyId }),
    enabled: Boolean(companyId),
    retry: false,
  });
  const [drafts, setDrafts] = useState({});
  const current = useMemo(() => {
    const map = new Map();
    for (const row of selQ.data?.rows ?? []) if (row.is_current) map.set(`${row.material_id}|${String(row.selection_month).slice(0, 10)}`, row.is_selected_for_new_purchase);
    return map;
  }, [selQ.data]);
  const members = useMemo(() => {
    const seen = new Map();
    for (const a of plan?.group_assignments ?? []) seen.set(a.group_id, a.group_label);
    return seen;
  }, [plan]);
  if (selQ.error) return <p className="text-xs text-slate-500">Member selection is not available for your access yet.</p>;
  if (members.size === 0) return null;
  const groupMembers = (groupId) => new Map(((plan?.groups ?? []).find((g) => g.group_id === groupId)?.members ?? []).map((m) => [m.material_id, `${m.material_code ?? ""} ${m.material_name}`.trim()]));
  const value = (materialId, month) => drafts[`${materialId}|${month}`] ?? current.get(`${materialId}|${month}`) ?? false;
  async function save() {
    try {
      const rows = Object.entries(drafts).map(([key, selected]) => {
        const [material_id, selection_month] = key.split("|");
        return { material_id, selection_month, is_selected_for_new_purchase: Boolean(selected) };
      });
      await saveMtsOptimizerSelections({ company_id: companyId, rows });
      pushToast({ message: `Saved ${rows.length} selection(s). Recalculate to apply.`, tone: "success" });
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-optimizer", "selections", companyId] });
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "planning", companyId] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    }
  }
  return (
    <details className="border border-slate-200 bg-slate-50 p-2 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-700">Choose members for new buy (per month)</summary>
      <div className="mt-2 grid gap-2">
        {[...members.entries()].map(([groupId, label]) => (
          <div key={groupId} className="grid gap-1">
            <span className="font-semibold">{label}</span>
            {[...groupMembers(groupId).entries()].map(([materialId, name]) => (
              <div key={materialId} className="flex items-center gap-3">
                <span className="w-72 truncate">{name}</span>
                {months.map((month) => (
                  <label key={month} className="flex items-center gap-1">
                    <input type="checkbox" disabled={!canEdit} checked={Boolean(value(materialId, month))} onChange={(event) => setDrafts((c) => ({ ...c, [`${materialId}|${month}`]: event.target.checked }))} />
                    {month.slice(0, 7)}
                  </label>
                ))}
              </div>
            ))}
          </div>
        ))}
        {canEdit ? <button type="button" onClick={() => void save()} disabled={Object.keys(drafts).length === 0} className="h-7 w-40 border border-sky-600 bg-sky-600 px-2 font-semibold text-white disabled:opacity-50">Save selection</button> : null}
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 5 — Store Material Usage Instruction (Phase 2D §6), live or a saved run
// ─────────────────────────────────────────────────────────────────────────────
function StoreReportTab({ companyId, planMonth, asOf, demandAt }) {
  const [runId, setRunId] = useState("");
  const [view, setView] = useState("PRODUCT");
  const liveQ = usePlanningQuery(companyId, planMonth, asOf, demandAt);
  const runsQ = useQuery({ queryKey: ["procurement", "mts-requirement", "planning-runs", companyId], queryFn: () => listMtsPlanningRuns({ company_id: companyId }), enabled: Boolean(companyId), retry: false });
  const runQ = useQuery({ queryKey: ["procurement", "mts-requirement", "planning-run", companyId, runId], queryFn: () => getMtsPlanningRun({ company_id: companyId, id: runId }), enabled: Boolean(companyId && runId) });
  const source = runId ? runQ.data?.run?.result ?? null : liveQ.data ?? null;
  // Owner: product rows grouped by parent → child product group, then product.
  const rows = useMemo(() => [...(source?.store_rows ?? [])].sort((a, b) =>
    String(a.mother_group ?? "~").localeCompare(String(b.mother_group ?? "~")) || String(a.child_group ?? "~").localeCompare(String(b.child_group ?? "~"))
    || String(a.product).localeCompare(String(b.product)) || String(a.period).localeCompare(String(b.period))), [source]);
  const materialSummary = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.material_id ?? `group:${r.group_id}`;
      const seen = map.get(key) ?? { key, material_name: r.material_name, document_name: r.material_document_name, group_label: r.material_id ? "" : r.group_label, uom: r.uom, executable_qty: 0, not_backed_qty: 0, transfer_hint: r.transfer_hint ?? null };
      seen.executable_qty += r.executable_qty;
      seen.not_backed_qty += r.not_backed_qty;
      map.set(key, seen);
    }
    return [...map.values()].sort((a, b) => a.material_name.localeCompare(b.material_name));
  }, [rows]);
  const groupSummary = useMemo(() => {
    const map = new Map();
    for (const r of rows.filter((x) => x.line_type === "GROUP")) {
      const seen = map.get(r.group_id) ?? { group_id: r.group_id, group_label: r.group_label, executable_qty: 0, not_backed_qty: 0, members: new Set() };
      seen.executable_qty += r.executable_qty;
      seen.not_backed_qty += r.not_backed_qty;
      if (r.material_id) seen.members.add(r.material_name);
      map.set(r.group_id, seen);
    }
    return [...map.values()].map((g) => ({ ...g, members: [...g.members].sort().join(", ") })).sort((a, b) => String(a.group_label).localeCompare(String(b.group_label)));
  }, [rows]);

  const productColumns = [
    { key: "mother_group", label: "Parent group", width: "160px", render: (r) => dash(r.mother_group) },
    { key: "child_group", label: "Child group", width: "160px", render: (r) => dash(r.child_group) },
    { key: "product", label: "Product (prodshade / SKU)", width: "240px" },
    { key: "source", label: "Stroke / Pack BOM", width: "240px" },
    { key: "period_label", label: "Period", width: "150px", render: (r) => r.period_label ?? (r.period === "CM" ? "CM (rest)" : "NM"), copyValue: (r) => r.period_label ?? r.period },
    { key: "line_type", label: "Line", width: "70px" },
    { key: "group_label", label: "Material group", width: "180px", render: (r) => dash(r.group_label) },
    { key: "material_document_name", label: "Document name", width: "220px", render: (r) => dash(r.material_document_name) },
    { key: "material_name", label: "Material to use", width: "240px", render: (r) => (r.material_id ? r.material_name : <span className="text-rose-700">{r.material_name}</span>) },
    { key: "demand_qty", label: "Line demand", width: "110px", align: "right", render: (r) => fmtQty(r.demand_qty), copyValue: (r) => r.demand_qty },
    { key: "executable_qty", label: "From physical stock", width: "130px", align: "right", render: (r) => (r.executable_qty ? <span className="font-semibold text-emerald-800">{fmtQty(r.executable_qty)}</span> : ""), copyValue: (r) => r.executable_qty },
    { key: "not_backed_qty", label: "Not yet backed (future / short)", width: "180px", align: "right", render: (r) => (r.not_backed_qty ? <span className="text-rose-700">{fmtQty(r.not_backed_qty)}</span> : ""), copyValue: (r) => r.not_backed_qty },
    { key: "uom", label: "UoM", width: "60px", render: (r) => dash(r.uom) },
    { key: "transfer_hint", label: "Transfer first", width: "320px", render: (r) => (r.transfer_hint ? <span className="font-semibold text-amber-800">{r.transfer_hint}</span> : "—"), copyValue: (r) => r.transfer_hint ?? "" },
  ];
  const materialColumns = [
    { key: "material_name", label: "Material", width: "260px", render: (m) => (m.group_label ? `${m.group_label} (not assigned)` : m.material_name) },
    { key: "document_name", label: "Document name", width: "220px", render: (m) => dash(m.document_name) },
    { key: "executable_qty", label: "From physical stock", width: "140px", align: "right", render: (m) => fmtQty(m.executable_qty), copyValue: (m) => m.executable_qty },
    { key: "not_backed_qty", label: "Not yet backed", width: "140px", align: "right", render: (m) => fmtQty(m.not_backed_qty), copyValue: (m) => m.not_backed_qty },
    { key: "uom", label: "UoM", width: "60px", render: (m) => dash(m.uom) },
    { key: "transfer_hint", label: "Transfer first", width: "320px", render: (m) => (m.transfer_hint ? <span className="font-semibold text-amber-800">{m.transfer_hint}</span> : "—"), copyValue: (m) => m.transfer_hint ?? "" },
  ];
  const groupColumnsSummary = [
    { key: "group_label", label: "Group", width: "240px" },
    { key: "members", label: "Members used", width: "320px" },
    { key: "executable_qty", label: "From physical stock", width: "140px", align: "right", render: (g) => fmtQty(g.executable_qty), copyValue: (g) => g.executable_qty },
    { key: "not_backed_qty", label: "Not yet backed", width: "140px", align: "right", render: (g) => fmtQty(g.not_backed_qty), copyValue: (g) => g.not_backed_qty },
  ];
  const columns = view === "PRODUCT" ? productColumns : view === "MATERIAL" ? materialColumns : groupColumnsSummary;
  const gridRows = view === "PRODUCT" ? rows : view === "MATERIAL" ? materialSummary : groupSummary;

  async function exportExcel() {
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `po22_store_report_${source?.calendar?.as_of ?? asOf}.xlsx`,
        sheetName: "Store Report",
        columns: columns.map((c) => ({ key: c.key, label: c.label, width: c.width, align: c.align })),
        rows: gridRows,
        getCellValue: (row, column) => {
          const col = columns.find((c) => c.key === column.key);
          return col?.copyValue ? col.copyValue(row) : row[column.key] ?? "";
        },
        preambleRows: [
          ["Store Material Usage Instruction — advisory, from current physical stock only"],
          ["As-of", source?.calendar?.as_of ?? ""],
          ["CM + NM", `${source?.calendar?.as_of ?? ""} → ${source?.calendar?.nm_end ?? ""}`],
          ["Run", runId ? `Saved run ${runId}` : "Live calculation"],
          ["Source fingerprint", source?.source_fingerprint ?? ""],
        ],
      });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium">Run</span>
          <select value={runId} onChange={(event) => setRunId(event.target.value)} className={`${INPUT_CLASS} w-96`}>
            <option value="">Live calculation (not saved)</option>
            {(runsQ.data?.rows ?? []).map((r) => <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} · as-of {r.as_of} · {r.created_by_name}</option>)}
          </select>
        </label>
        {["PRODUCT", "MATERIAL", "GROUP"].map((option) => (
          <button key={option} type="button" onClick={() => setView(option)} className={`h-8 border px-3 text-xs font-semibold ${view === option ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}>
            {option === "PRODUCT" ? "Product-wise" : option === "MATERIAL" ? "Material summary" : "Group summary"}
          </button>
        ))}
        <button type="button" onClick={() => void exportExcel()} disabled={!source} className="h-8 border border-emerald-600 bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Excel</button>
      </div>
      <p className="text-xs text-slate-500">
        &quot;From physical stock&quot; is backed by posted counted stock at the run time — Store may use it. &quot;Not yet backed&quot; depends on future arrivals or is short:
        never issue against it. If the production mix changes, follow the row of the product actually produced; shared stock cannot serve every product in full.
      </p>
      <ErpDenseGrid {...GRID_PROPS} columns={columns} rows={gridRows} rowKey={(r) => (view === "PRODUCT" ? `${r.pool_key}|${r.period}|${r.material_id ?? "rest"}` : view === "MATERIAL" ? r.key : r.group_id)} emptyMessage={(runId ? runQ.isLoading : liveQ.isLoading) ? "Loading…" : "No demand in CM + NM."} maxHeight="calc(100vh - 340px)" />
    </div>
  );
}
