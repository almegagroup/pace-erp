/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsItemPlanTab.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 P1 Item Plan (owner 2026-10-20) — pick any RM / PM; a grouped item opens its
 *          whole family (all members, their exclusive demand, their other groups), a non-group
 *          item stands alone. Sheet PLANNING-style day grid over ~6 months, arrivals with status
 *          and ETD / Port / Plant dates, planning-side rescheduled ETA (CSN Tracker is never
 *          changed), stock per location.
 *          Owner 2026-10-21: Preview (moved arrivals / own lots / other Target days) shows the
 *          engine's day-by-day effect before anything is saved; vendor × date compare; what-if
 *          Safety days with engine pick and AI verdict.
 *          Design: docs/mts-planning/PO22-P1-FAMILY-PLANNING-DETAIL-2026-10-20.md
 * Authority: Frontend (numbers come from the backend engine only)
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { copyTableRowsWithHeaders } from "../../../../components/data/tableClipboard.js";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import { pushToast } from "../../../../store/uiToast.js";
import { getMtsItemPlan, getMtsItemPlanOtherCompanies, getMtsPlanning, listMtsItemPlanScenarios, reviewMtsItemPlanWithAi, saveMtsInboundReschedule, saveMtsItemPlanScenario, simulateMtsItemPlan } from "../procurementApi.js";
import { TargetWhatIf, VendorDateCompare } from "./MtsItemPlanWhatIf.jsx";
import { lotVendorFlags } from "./mtsItemPlanLots.js";
import { makeDisplayUnits, orderQtyText, qtyInDisplayUnit } from "./mtsOrderUnit.js";
import { PO22_LIVE_QUERY } from "./mtsLiveQuery.js";
import MtsWaterfallPanel, { WaterfallVerdict } from "./MtsWaterfallPanel.jsx";

// Owner 2026-10-21: FOR = freight inside the price; otherwise we pay it (AC01 landed cost).
const FREIGHT_LABEL = { FOR: "FOR (in price)", FREIGHT_SEPARATE: "Separate (we pay)", EX_TRANSPORTER_GODOWN: "Ex godown (we pay)" };

const INPUT_CLASS = "h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500";
const CELL_INPUT = "h-7 border border-sky-300 bg-sky-50 px-1.5 text-xs text-sky-900 outline-none focus:border-sky-600";
const GRID_PROPS = { cellNavigate: true, columnFilter: true, searchBar: true, stickyFirstColumn: true, fitColumnWidths: true, copyTableWithHeaders: true };
const STATUS_LABEL = { ACTUAL_GR: "Actual GR", AT_GATE: "At gate", IN_TRANSIT: "In transit", ORDERED: "Ordered (not shipped)", BULK: "Bulk call-off", STO: "STO", SUB_CSN: "Sub-CSN" };
const STATUS_TONE = { ACTUAL_GR: "bg-emerald-200 text-emerald-900", AT_GATE: "bg-emerald-100 text-emerald-800", IN_TRANSIT: "bg-sky-100 text-sky-800", ORDERED: "bg-amber-100 text-amber-800", BULK: "bg-slate-100 text-slate-700", STO: "bg-violet-100 text-violet-800", SUB_CSN: "bg-violet-100 text-violet-800" };

/** The lot editor keeps the typed text (order unit) beside qty_base; it is never sent to the API. */
function withoutShownQty(lot) {
  const rest = { ...lot };
  delete rest.qty_display;
  return rest;
}
function fmtQty(value) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
/** Days are whole, rounded down like the sheet (49.7 days of stock = 49 full days). */
function fmtDays(value) {
  return value === null || value === undefined ? "—" : String(Math.floor(Number(value) + 1e-9));
}
function demandSourceLabel(source) {
  if (source === "NO_PO21_PLAN") return "No PO21 plan";
  if (source === "FORECAST") return "Forecast";
  return source === "PLAN" ? "Plan" : "";
}
function carryForwardLabel(row) {
  const days = Number(row?.carry_forward_days ?? 0);
  if (!(days > 0)) return "";
  return row?.next_demand_day
    ? `No demand ${days} d → ${row.next_demand_day}`
    : `No demand ${days} d → horizon end`;
}
const GAP_LABEL = {
  NO_TARGET_CRITICAL: "no Target / Critical days (set in 2. Material Settings)",
  NO_VENDOR: "no vendor linked (MM03 vendor–material link)",
  NO_LEAD_TIME: "no lead time (vendor route / Booking Time)",
};

/** Owner 2026-10-22: the day grid gets the full width; everything else opens from a button. */
const ITEM_PLAN_PANELS = [
  { id: "waterfall", label: "Waterfall (levels, flow, who holds what)" },
  { id: "prediction", label: "Prediction" },
  { id: "allocation", label: "Family allocation report" },
  { id: "arrivals", label: "Arrivals / Future Orders" },
  { id: "lots", label: "Your lots" },
  { id: "vendors", label: "Compare vendors" },
  { id: "whatif", label: "What-if Safety days" },
  { id: "ai", label: "AI planner" },
  { id: "transfers", label: "Transfers / Below Target" },
  { id: "others", label: "Other companies' stock" },
];
function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function copyTable(columns, rows) {
  void copyTableRowsWithHeaders(columns, rows).then(() => {
    pushToast({ message: "Table copied with headers — paste directly into Excel.", tone: "success" });
  });
}

export default function MtsItemPlanTab({ companyId, planMonth, asOf, demandAt }) {
  const queryClient = useQueryClient();
  const [materialId, setMaterialId] = useState("");
  const [search, setSearch] = useState("");
  const [openDay, setOpenDay] = useState("");
  const [panel, setPanel] = useState("");
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  // P4: calibration (CC) date the user may move; empty = the page's As-of date.
  const [ccDate, setCcDate] = useState("");
  const effAsOf = ccDate || asOf;
  const effMonth = effAsOf ? effAsOf.slice(0, 7) : planMonth;
  // P4: the user's own lots (draft while editing; null = not editing), AI review result.
  const [lotDraft, setLotDraft] = useState(null);
  const [question, setQuestion] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  // Owner 2026-10-21: engine preview of unsaved changes (null = showing the saved plan).
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Material list: same cached CM + NM planning payload as the Planning tab.
  const planningQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "planning", companyId, planMonth, asOf, demandAt],
    queryFn: () => getMtsPlanning({ company_id: companyId, plan_month: planMonth, as_of: asOf, demand_at: demandAt || undefined }),
    enabled: Boolean(companyId && planMonth && asOf),
    ...PO22_LIVE_QUERY,
  });
  const materials = useMemo(() => {
    const seen = new Map();
    for (const row of planningQ.data?.daily ?? []) if (!seen.has(row.material_id)) seen.set(row.material_id, `${row.material_code ?? ""} ${row.material_name}`.trim());
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [planningQ.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? materials.filter(([, label]) => label.toLowerCase().includes(term)) : materials;
  }, [materials, search]);

  const itemKey = ["procurement", "mts-requirement", "item-plan", companyId, effMonth, effAsOf, demandAt, materialId];
  const itemQ = useQuery({
    queryKey: itemKey,
    queryFn: () => getMtsItemPlan({ company_id: companyId, plan_month: effMonth, as_of: effAsOf, demand_at: demandAt || undefined, material_id: materialId }),
    enabled: Boolean(companyId && planMonth && asOf && materialId),
    ...PO22_LIVE_QUERY,
  });
  const plan = itemQ.data ?? null;
  // What the grids show: the preview while one is open, else the saved plan.
  const view = preview?.plan ?? plan;
  // Count shown on each panel button so the planner sees where something is waiting.
  const panelCount = (id) => {
    if (!view) return 0;
    if (id === "prediction") return (view.prediction ?? []).length;
    if (id === "arrivals") return (view.arrivals ?? []).length + (view.future_orders ?? []).length;
    if (id === "lots") return (plan?.user_lots ?? []).length;
    if (id === "transfers") return (view.transfers ?? []).length + (view.alternatives ?? []).length;
    return 0;
  };
  const uom = plan?.members?.find((m) => m.is_selected)?.uom ?? "";
  // Owner 2026-10-26: every quantity in the material's display (Order) UoM; calculations stay in base.
  const du = useMemo(
    () => makeDisplayUnits(view?.display_units ?? plan?.display_units ?? planningQ.data?.display_units),
    [view, plan, planningQ.data],
  );
  const familyIds = (view?.members ?? plan?.members ?? []).map((m) => m.material_id);
  // The family grid sums members: one unit only when every member shows the same one, else base.
  const familyUnit = familyIds.length > 1 ? du.groupUnit(familyIds) : du.unitOf(materialId);
  const familyUom = familyUnit?.uom_code ?? uom;
  const fq = (value) => fmtQty(du.qtyIn(value, familyUnit));
  const selFactor = Number(du.unitOf(materialId)?.base_per_unit) > 0 ? Number(du.unitOf(materialId).base_per_unit) : 1;
  const selUom = du.uom(materialId, uom);
  const mq = (value, id, baseUom) => qtyInDisplayUnit(value, baseUom, du.unitOf(id));
  const mqn = (value, id) => fmtQty(du.qty(value, id));
  const lotText = (qty, baseUom, orderQty, orderUom, id) => (orderUom && orderQty !== null && orderQty !== undefined ? orderQtyText(orderQty, orderUom) : mq(qty, id, baseUom));
  // A fixed lot is typed and shown in its vendor's order unit, else the material's display unit.
  const lotUnit = (l) => {
    const choice = (plan?.vendor_choices ?? []).find((c) => c.material_id === l.material_id);
    const unit = (l.vendor_id ? choice?.options?.find((o) => o.vendor_id === l.vendor_id)?.order_unit : null) ?? choice?.order_unit ?? null;
    if (unit && Number(unit.base_per_order_unit) > 0) return { factor: Number(unit.base_per_order_unit), uom: unit.order_uom_code };
    const display = du.unitOf(l.material_id);
    return display ? { factor: Number(display.base_per_unit), uom: display.uom_code } : { factor: 1, uom: (plan?.members ?? []).find((m) => m.material_id === l.material_id)?.uom ?? "" };
  };
  const lotQtyText = (l, qtyBase) => { const u = lotUnit(l); return `${fmtQty(Number(qtyBase) / u.factor)} ${u.uom}`.trim(); };
  // Cost per the unit the lot is shown in (backend value is per base unit).
  const unitCostText = (o) => {
    const perUnit = o.order_uom && Number(o.order_qty) > 0 ? Number(o.qty) / Number(o.order_qty) : Number(du.unitOf(o.material_id)?.base_per_unit) || 1;
    const unitLabel = o.order_uom && Number(o.order_qty) > 0 ? o.order_uom : du.uom(o.material_id, o.uom);
    return `${(Number(o.unit_total_cost) * perUnit).toLocaleString("en-IN", { maximumFractionDigits: 2 })} / ${unitLabel}`;
  };
  const memberName = useMemo(() => new Map((plan?.members ?? []).map((m) => [m.material_id, `${m.material_code ?? ""} ${m.material_name}`.trim()])), [plan]);
  const memberDaily = useMemo(() => {
    const byDay = new Map();
    for (const row of view?.member_daily ?? []) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
    return byDay;
  }, [view]);
  const monthSource = useMemo(() => new Map((plan?.month_sources ?? []).map((m) => [m.month.slice(0, 7), m.source])), [plan]);

  // Owner 2026-10-24: this report comes already allocated and labelled by the
  // server engine.  React must not infer a route from closing balances.
  const allocationTraceRows = useMemo(() => {
    return [...(view?.allocation_rows ?? [])]
      .map((row, index) => ({ ...row, key: row.key ?? `${row.day}|${row.material_code ?? ""}|${row.flow}|${row.destination}|${index}`, member: `${row.material_code ?? ""} ${row.material_name ?? ""}`.trim() || "—" }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.destination.localeCompare(b.destination) || a.member.localeCompare(b.member));
  }, [view]);

  const groupReserveRows = useMemo(() => (
    [...(view?.group_bucket_reservations ?? [])]
      .map((row, index) => ({
        ...row,
        key: `${row.day}|${row.group_label}|${row.material_code ?? ""}|${index}`,
        member: `${row.material_code ?? ""} ${row.material_name ?? ""}`.trim() || "—",
      }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.group_label.localeCompare(b.group_label) || a.member.localeCompare(b.member))
  ), [view]);

  const sourceTraceRows = useMemo(() => {
    const rows = [];
    for (const member of plan?.members ?? []) {
      for (const [index, location] of (member.locations ?? []).entries()) {
        if (!(Number(location.qty) > 0.000001)) continue;
        rows.push({
          key: `STOCK|${member.material_id}|${location.location}|${index}`, material_id: member.material_id, uom: member.uom,
          source: "Counted stock", member: `${member.material_code ?? ""} ${member.material_name ?? ""}`.trim(),
          date: plan?.calendar?.as_of ?? asOf, qty: Number(location.qty),
          availability: "Available from the CC date", detail: location.location,
          rule: member.exclusive
            ? "This material has direct/exclusive use; its own Target protection is retained before group use."
            : "This member is available only through its eligible family group(s), subject to protection and location policy.",
        });
      }
    }
    for (const [index, arrival] of (view?.arrivals ?? []).entries()) {
      rows.push({
        key: `INBOUND|${arrival.material_id}|${arrival.reference}|${index}`, material_id: arrival.material_id, uom: arrival.uom,
        source: arrival.status ?? "Inbound", member: `${arrival.material_code ?? ""} ${arrival.material_name ?? ""}`.trim(),
        date: arrival.rescheduled_eta ?? arrival.eta_plant ?? "—", qty: Number(arrival.qty ?? 0),
        availability: arrival.planning_coverage_detail ?? ((arrival.rescheduled_eta ?? arrival.eta_plant) ? "Joins the family on this valid ETA to Plant" : "Risk only — no valid ETA to Plant"),
        detail: [arrival.reference, arrival.vendor].filter(Boolean).join(" · ") || "—",
        rule: (arrival.rescheduled_eta ?? arrival.eta_plant)
          ? "Every dated receipt—including an ordered PO with delivery date—enters the waterfall on its ETA-to-Plant date, never before."
          : "Without a valid ETA this receipt is a risk/action item, not usable Family stock.",
      });
    }
    return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.member.localeCompare(b.member));
  }, [plan, view, asOf]);

  const excessTraceRows = useMemo(() => {
    const finalByMember = new Map();
    for (const row of view?.member_daily ?? []) {
      const seen = finalByMember.get(row.material_id);
      if (!seen || row.day > seen.day) finalByMember.set(row.material_id, row);
    }
    return [...finalByMember.values()].map((row) => ({
      material_id: row.material_id, uom: row.uom, member: memberName.get(row.material_id) ?? "—", day: row.day,
      qty: Math.max(0, Number(row.closing ?? 0)), max_days: row.max_days,
      result: Number(row.closing ?? 0) > 0.000001
        ? "Residual: carries into the next eligible demand date; if no eligible demand remains, it is visible as excess / expiry-risk stock."
        : "No residual stock at the end of this planning horizon.",
    })).sort((a, b) => a.member.localeCompare(b.member));
  }, [view, memberName]);

  // Your own Quantity to Dispatch per day for the selected item (draft first, else saved).
  const ownDispatch = useMemo(() => {
    const map = new Map();
    for (const l of lotDraft ?? plan?.scenario?.manual_lots ?? []) {
      if (l.material_id === materialId && Number(l.qty_base) > 0) map.set(l.plant_eta, (map.get(l.plant_eta) ?? 0) + Number(l.qty_base));
    }
    return map;
  }, [lotDraft, plan, materialId]);
  function setDispatchQty(day, value) {
    const qty = Number(value);
    const base = lotDraft ?? plan?.scenario?.manual_lots ?? [];
    const same = (l) => l.plant_eta === day && l.material_id === materialId;
    const vendorId = base.find(same)?.vendor_id ?? null;
    const next = [...base.filter((l) => !same(l)), ...(qty > 0 ? [{ material_id: materialId, plant_eta: day, qty_base: qty, vendor_id: vendorId }] : [])];
    setLotDraft(next);
    void runPreview({ lots: next, label: "Quantity to Dispatch changed" });
  }

  const predictionColumns = [
    { key: "source", label: "", width: "60px", render: (p) => (p.source === "YOU" ? <span className="bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">You</span> : <span className="bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">Engine</span>), copyValue: (p) => (p.source === "YOU" ? "You" : "Engine") },
    { key: "import_etd", label: "Import ETD", width: "100px", render: (p) => p.import_etd ?? "—" },
    { key: "port_eta", label: "LCL-ETD / Port ETA", width: "120px", render: (p) => p.port_eta ?? "—" },
    { key: "date", label: "Date", width: "100px", render: (p) => <span className="font-semibold">{p.date ?? "—"}</span>, copyValue: (p) => p.date ?? "" },
    { key: "qty", label: "Quantity to Dispatch", width: "140px", align: "right", render: (p) => lotText(p.qty, p.uom, p.order_qty, p.order_uom, p.material_id), copyValue: (p) => lotText(p.qty, p.uom, p.order_qty, p.order_uom, p.material_id) },
    { key: "max_days", label: "Max Days", width: "80px", align: "right", render: (p) => fmtDays(p.max_days), copyValue: (p) => p.max_days ?? "" },
    { key: "min_days", label: "Min Days", width: "80px", align: "right", render: (p) => fmtDays(p.min_days), copyValue: (p) => p.min_days ?? "" },
    { key: "material_name", label: "Member", width: "200px", render: (p) => `${p.material_code ?? ""} ${p.material_name}`.trim() },
    { key: "vendor", label: "Supplier", width: "200px", render: (p) => p.vendor ?? "—" },
    { key: "covers", label: "For", width: "160px", render: (p) => p.covers ?? "—" },
    { key: "why", label: "Why this item, this date", width: "380px", render: (p) => <span className="whitespace-normal text-xs">{p.why ?? "—"}</span>, copyValue: (p) => p.why ?? "" },
  ];

  const gridColumns = [
    { key: "day", label: "Date", width: "100px", render: (r) => (
      <button type="button" onClick={() => setOpenDay((d) => (d === r.day ? "" : r.day))} className="text-left text-sky-800 hover:underline">{r.day}</button>
    ), copyValue: (r) => r.day },
    { key: "cc", label: "CC", width: "40px", render: (r) => (r.day === plan?.calendar?.as_of ? <span className="font-semibold text-emerald-700">CC</span> : ""), copyValue: (r) => (r.day === plan?.calendar?.as_of ? "CC" : "") },
    { key: "source", label: "Demand", width: "100px", render: (r) => demandSourceLabel(monthSource.get(r.day.slice(0, 7))), copyValue: (r) => demandSourceLabel(monthSource.get(r.day.slice(0, 7))) },
    {
      key: "carry_forward", label: "Stock carry-forward", width: "190px",
      render: (r) => {
        const label = carryForwardLabel(r);
        return label ? <span className="text-xs text-violet-800" title="No approved demand: stock stays physically available, but these days are not counted as active-demand coverage.">{label}</span> : "";
      },
      copyValue: (r) => carryForwardLabel(r),
    },
    { key: "opening", label: `Opening (${familyUom})`, width: "120px", align: "right", render: (r) => fq(r.opening), copyValue: (r) => fq(r.opening) },
    { key: "arrivals", label: `ETA to Plant (${familyUom})`, width: "130px", align: "right", render: (r) => (r.arrivals ? fq(r.arrivals) : ""), copyValue: (r) => (r.arrivals ? fq(r.arrivals) : "") },
    {
      // Sheet PLANNING "Quantity to Dispatch": the engine's lots, overwritten by typing your own.
      key: "planned_lot", label: `Quantity to Dispatch (${selUom})`, width: "180px", align: "right", filterable: false,
      render: (r) => {
        const own = ownDispatch.get(r.day);
        const baseShown = own ?? (r.planned_lot || "");
        // Typed and shown in the selected item's display unit; stored in base UoM.
        const shown = baseShown === "" ? "" : Math.round((Number(baseShown) / selFactor) * 1000) / 1000;
        const input = (
          <input
            key={`${r.day}|${shown}`}
            type="number"
            min="0"
            defaultValue={shown}
            title={own !== undefined ? "Your quantity (not saved until you Save)" : r.planned_lot ? "Engine lot — type to change" : "Type a quantity to dispatch on this day"}
            onBlur={(event) => { if (String(event.target.value) !== String(shown)) setDispatchQty(r.day, event.target.value === "" ? 0 : Number(event.target.value) * selFactor); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            className={`h-6 w-24 border px-1 text-right text-xs outline-none ${own !== undefined ? "border-sky-500 bg-sky-100 font-semibold text-sky-900" : r.planned_lot ? "border-slate-300 bg-white font-semibold text-sky-800" : "border-transparent bg-transparent hover:border-slate-300"}`}
          />
        );
        // Same day as an engine lot (or another member's lot): show the extra so the row adds up.
        const extra = own !== undefined ? Math.round(((r.planned_lot ?? 0) - own) * 1000) / 1000 : 0;
        return extra > 0.001 ? (
          <span className="flex items-center justify-end gap-1">
            {input}
            <span className="text-[10px] text-slate-600" title="Engine lot on the same day">{`+${mqn(extra, materialId)} engine`}</span>
          </span>
        ) : input;
      },
      copyValue: (r) => (r.planned_lot ? mqn(r.planned_lot, materialId) : ""),
    },
    { key: "use", label: `Pro-rata Use (${familyUom})`, width: "130px", align: "right", render: (r) => fq(r.use), copyValue: (r) => fq(r.use) },
    // Group demand that no member's stock could carry that day (shortage of the whole group).
    { key: "unmet_group", label: "Group shortfall", width: "110px", align: "right", render: (r) => (r.unmet_group >= 0.001 ? <span className="font-semibold text-rose-700" title="Group demand no member had stock for">{fq(r.unmet_group)}</span> : ""), copyValue: (r) => (r.unmet_group >= 0.001 ? fq(r.unmet_group) : "") },
    { key: "closing", label: `Closing (${familyUom})`, width: "120px", align: "right", render: (r) => <span className={r.closing < 0 ? "font-semibold text-rose-700" : ""}>{fq(r.closing)}</span>, copyValue: (r) => fq(r.closing) },
    { key: "max_days", label: "Max Days", width: "80px", align: "right", render: (r) => fmtDays(r.max_days), copyValue: (r) => r.max_days ?? "" },
    {
      key: "prorata_max_days", label: "Prorata Max Days", width: "130px", align: "right",
      render: (r) => <span title="Closing stock ÷ this row's Pro-rata Use. This is an audit value; engine Max Days still follows future approved demand.">{fmtDays(r.prorata_max_days)}</span>,
      copyValue: (r) => r.prorata_max_days ?? "",
    },
    { key: "min_stock", label: `Min Stock (${familyUom})`, width: "120px", align: "right", render: (r) => fq(r.min_stock), copyValue: (r) => fq(r.min_stock) },
    { key: "min_days", label: "Min Days", width: "80px", align: "right", render: (r) => fmtDays(r.min_days), copyValue: (r) => r.min_days ?? "" },
    {
      // Owner 2026-10-22: what arrives this day, from where, in what state, for what and why.
      key: "events", label: "What arrives — member · consignment · vendor · status · for · why", width: "560px", filterable: false,
      render: (r) => ((r.events ?? []).length === 0 ? "" : (
        <div className="grid gap-0.5 py-0.5 text-xs">
          {r.events.map((e, i) => (
            <div key={i} className="whitespace-normal">
              <span className={`mr-1 px-1 font-semibold ${e.kind === "ARRIVAL" ? "bg-sky-100 text-sky-800" : e.kind === "ENGINE" ? "bg-amber-100 text-amber-800" : "bg-violet-100 text-violet-800"}`}>
                {e.kind === "ARRIVAL" ? (STATUS_LABEL[e.status] ?? e.status) : e.kind === "ENGINE" ? (e.late ? "Engine (late)" : "Engine") : "You"}
              </span>
              <span className="font-semibold">{e.member}</span> {mq(e.qty, e.material_id, e.uom)}
              {e.reference ? <span> · {e.reference}</span> : null}
              {e.vendor ? <span> · {e.vendor}</span> : null}
              {e.po_by ? <span> · PO by {e.po_by}</span> : null}
              {e.covers ? <span className="text-emerald-800"> · for {e.covers}</span> : null}
              {e.why ? <span className="text-slate-500"> — {e.why}</span> : null}
              {e.movable ? <button type="button" onClick={() => setPanel("arrivals")} className="ml-1 text-sky-700 underline">move date</button> : null}
            </div>
          ))}
        </div>
      )),
      copyValue: (r) => (r.events ?? []).map((e) => [e.kind, e.member, e.qty, e.reference, e.vendor, e.status, e.covers, e.why].filter(Boolean).join(" | ")).join("\n"),
    },
  ];

  const memberColumns = [
    { key: "material", label: "Member", width: "260px", render: (m) => <span className={m.is_selected ? "font-semibold text-sky-900" : ""}>{`${m.material_code ?? ""} ${m.material_name}`.trim()}</span>, copyValue: (m) => `${m.material_code ?? ""} ${m.material_name}`.trim() },
    { key: "role", label: "Used as", width: "260px", render: (m) => [m.exclusive ? "Exclusive" : "", ...m.groups.map((g) => `Group: ${g}`)].filter(Boolean).join(" · ") || "—" },
    { key: "usable_stock", label: "Counted stock", width: "120px", align: "right", render: (m) => mq(m.usable_stock, m.material_id, m.uom), copyValue: (m) => mq(m.usable_stock, m.material_id, m.uom) },
    { key: "target", label: "Target / Critical", width: "110px", render: (m) => `${fmtDays(m.target_days)} / ${fmtDays(m.critical_days)}` },
    { key: "locations", label: "Stock by location (now)", width: "320px", render: (m) => (m.locations.length ? m.locations.map((l) => `${l.location}: ${mq(l.qty, m.material_id, m.uom)}`).join(" · ") : "—"), copyValue: (m) => m.locations.map((l) => `${l.location}: ${mq(l.qty, m.material_id, m.uom)}`).join(" · ") },
  ];

  // Owner 2026-10-26 (4A): one simple line per member — stock, inbound, own use, group use,
  // closing, cover and the reason. Built from the server's reconciliation, never re-derived here.
  const glanceRows = (view?.allocation_reconciliation ?? []).map((r) => {
    const member = (plan?.members ?? []).find((m) => m.material_id === r.material_id);
    const first = (memberDaily.get(view?.grid?.[0]?.day ?? "") ?? []).find((m) => m.material_id === r.material_id);
    const reasons = [
      r.own_allocated_qty > 0 ? "Own (exclusive) use is protected first" : "",
      r.group_allocated_qty > 0 ? `Serves ${(member?.groups ?? []).join(" / ") || "its group"} from free stock` : "",
      r.confirmed_arrival_qty > 0 ? "Inbound counted on its ETA" : "",
      r.planned_lot_qty > 0 ? "Engine / your lot added" : "",
      r.closing_qty < 0 ? "SHORT — stock runs out in the horizon" : r.closing_qty > 0 ? "Balance carries forward" : "",
    ].filter(Boolean).join(" · ");
    return { ...r, key: r.material_id, member: `${r.material_code ?? ""} ${r.material_name ?? ""}`.trim(), cover_days: first?.max_days ?? null, reason: reasons || "—" };
  });
  const glanceColumns = [
    { key: "member", label: "Material", width: "260px" },
    { key: "opening_qty", label: "Stock now", width: "120px", align: "right", render: (r) => mq(r.opening_qty, r.material_id, r.uom), copyValue: (r) => mq(r.opening_qty, r.material_id, r.uom) },
    { key: "confirmed_arrival_qty", label: "Inbound (ETA)", width: "120px", align: "right", render: (r) => (r.confirmed_arrival_qty ? mq(r.confirmed_arrival_qty, r.material_id, r.uom) : "—"), copyValue: (r) => mq(r.confirmed_arrival_qty, r.material_id, r.uom) },
    { key: "own_allocated_qty", label: "Exclusive use", width: "120px", align: "right", render: (r) => mq(r.own_allocated_qty, r.material_id, r.uom), copyValue: (r) => mq(r.own_allocated_qty, r.material_id, r.uom) },
    { key: "group_allocated_qty", label: "Group use", width: "120px", align: "right", render: (r) => mq(r.group_allocated_qty, r.material_id, r.uom), copyValue: (r) => mq(r.group_allocated_qty, r.material_id, r.uom) },
    { key: "cover_days", label: "Cover now (days)", width: "110px", align: "right", render: (r) => fmtDays(r.cover_days) || "—", copyValue: (r) => r.cover_days ?? "" },
    { key: "closing_qty", label: "Closing at horizon", width: "130px", align: "right", render: (r) => <span className={r.closing_qty < 0 ? "font-semibold text-rose-700" : ""}>{mq(r.closing_qty, r.material_id, r.uom)}</span>, copyValue: (r) => mq(r.closing_qty, r.material_id, r.uom) },
    { key: "reason", label: "Reason", width: "420px", render: (r) => <span className="whitespace-normal text-xs">{r.reason}</span>, copyValue: (r) => r.reason },
  ];

  const traceSourceColumns = [
    { key: "source", label: "Source", width: "150px" },
    { key: "member", label: "Material", width: "240px" },
    { key: "date", label: "Available / ETA date", width: "130px" },
    { key: "qty", label: "Qty", width: "130px", align: "right", render: (r) => mq(r.qty, r.material_id, r.uom), copyValue: (r) => mq(r.qty, r.material_id, r.uom) },
    { key: "availability", label: "When it may be used", width: "280px", render: (r) => <span className={String(r.availability).startsWith("Risk") ? "font-semibold text-amber-800" : ""}>{r.availability}</span> },
    { key: "detail", label: "Location / document", width: "330px" },
    { key: "rule", label: "Rule followed", width: "460px", render: (r) => <span className="whitespace-normal text-xs">{r.rule}</span> },
  ];

  const traceFlowColumns = [
    { key: "day", label: "Date", width: "110px" },
    { key: "member", label: "Material used", width: "240px" },
    { key: "flow", label: "Step", width: "150px" },
    { key: "destination", label: "Covered for", width: "260px" },
    { key: "source_kind", label: "Source type", width: "160px" },
    { key: "source_reference", label: "Source reference", width: "220px" },
    { key: "qty", label: "Allocated qty", width: "130px", align: "right", render: (r) => mq(r.qty, r.material_id, r.uom), copyValue: (r) => mq(r.qty, r.material_id, r.uom) },
    { key: "closing", label: "Carry after date", width: "140px", align: "right", render: (r) => mq(r.closing, r.material_id, r.uom), copyValue: (r) => mq(r.closing, r.material_id, r.uom) },
    { key: "rule", label: "Rule followed", width: "510px", render: (r) => <span className="whitespace-normal text-xs">{r.rule}</span> },
  ];

  const traceReserveColumns = [
    { key: "day", label: "Date", width: "110px" },
    { key: "group_label", label: "Group", width: "220px" },
    { key: "member", label: "Material carrying reserve", width: "260px" },
    { key: "reserved_qty", label: "Reserve after group use", width: "170px", align: "right", render: (r) => mq(r.reserved_qty, r.material_id, r.uom), copyValue: (r) => mq(r.reserved_qty, r.material_id, r.uom) },
    { key: "rule", label: "Meaning", width: "450px", render: () => <span className="whitespace-normal text-xs">This is the group&apos;s carried planning reserve after that date&apos;s use. It is not a new PO or a Store issue; it can be refilled only from real free stock when the group reaches Target.</span> },
  ];

  const traceExcessColumns = [
    { key: "member", label: "Material", width: "260px" },
    { key: "day", label: "Horizon date", width: "130px" },
    { key: "qty", label: "Residual qty", width: "140px", align: "right", render: (r) => mq(r.qty, r.material_id, r.uom), copyValue: (r) => mq(r.qty, r.material_id, r.uom) },
    { key: "max_days", label: "Max days", width: "100px", align: "right", render: (r) => fmtDays(r.max_days), copyValue: (r) => r.max_days ?? "" },
    { key: "result", label: "Where the balance goes", width: "620px", render: (r) => <span className="whitespace-normal text-xs">{r.result}</span> },
  ];

  const arrivalColumns = [
    { key: "status", label: "Status", width: "150px", render: (a) => <span className={`px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[a.status] ?? ""}`}>{STATUS_LABEL[a.status] ?? a.status}</span>, copyValue: (a) => STATUS_LABEL[a.status] ?? a.status },
    { key: "material_name", label: "Member", width: "220px", render: (a) => `${a.material_code ?? ""} ${a.material_name}`.trim() },
    { key: "reference", label: "PO / CSN", width: "300px" },
    { key: "vendor", label: "Vendor", width: "200px", render: (a) => a.vendor ?? "—" },
    { key: "qty", label: "Qty", width: "130px", align: "right", render: (a) => mq(a.qty, a.material_id, a.uom), copyValue: (a) => mq(a.qty, a.material_id, a.uom) },
    { key: "etd", label: "ETD", width: "100px", render: (a) => a.etd ?? "—" },
    { key: "eta_port", label: "ETA Port", width: "100px", render: (a) => a.eta_port ?? "—" },
    { key: "eta_plant", label: "ETA Plant", width: "100px", render: (a) => a.eta_plant ?? "—" },
    {
      key: "planning_coverage", label: "Planning coverage", width: "290px",
      render: (a) => <span className={`text-xs ${a.planning_coverage === "RISK_ONLY" ? "text-rose-700" : "text-emerald-700"}`}>{a.planning_coverage_detail ?? "—"}</span>,
      copyValue: (a) => a.planning_coverage_detail ?? "",
    },
    {
      key: "rescheduled_eta", label: "Rescheduled ETA (planning)", width: "260px", filterable: false,
      render: (a) => (!a.reschedule_key ? <span className="text-xs text-slate-400">cannot move</span> : drafts[a.reschedule_key]?.clear ? (
        <span className="flex items-center gap-1 text-xs font-semibold text-sky-800">
          {`Back to CSN date ${a.eta_plant ?? "—"}`}
          <button type="button" onClick={() => undoDraft(a.reschedule_key)} className="h-6 border border-slate-300 bg-white px-1.5 text-xs font-normal text-slate-700 hover:bg-slate-50">Undo</button>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <input
            type="date"
            value={drafts[a.reschedule_key]?.date ?? a.rescheduled_eta ?? ""}
            onChange={(event) => setDrafts((d) => ({ ...d, [a.reschedule_key]: { ...(d[a.reschedule_key] ?? {}), date: event.target.value, row: a } }))}
            className={CELL_INPUT}
          />
          {drafts[a.reschedule_key] ? (
            <button type="button" onClick={() => undoDraft(a.reschedule_key)} title="Drop this unsaved change" className="h-6 border border-slate-300 bg-white px-1.5 text-xs text-slate-700 hover:bg-slate-50">Undo</button>
          ) : a.rescheduled_eta ? (
            <button type="button" onClick={() => setDrafts((d) => ({ ...d, [a.reschedule_key]: { clear: true, reason: "Back to CSN / PO date", row: a } }))} title="Remove the saved planning date — the CSN / PO date is used again" className="h-6 border border-sky-300 bg-white px-1.5 text-xs text-sky-800 hover:bg-sky-50">Back to CSN date</button>
          ) : null}
        </span>
      )),
      copyValue: (a) => a.rescheduled_eta ?? "",
    },
    {
      key: "now_days", label: "Min / Max on arrival", width: "130px", align: "right",
      render: (a) => (a.optimum ? `${fmtDays(a.optimum.current.min_days)} / ${fmtDays(a.optimum.current.max_days)}` : "—"),
      copyValue: (a) => (a.optimum ? `${a.optimum.current.min_days ?? ""}/${a.optimum.current.max_days ?? ""}` : ""),
    },
    {
      key: "advice", label: "Engine best date", width: "170px",
      render: (a) => (a.window?.state === "TALK_TO_VENDOR" && a.optimum?.shift_days ? (
        <span className="text-xs font-semibold text-rose-700" title={a.window.message}>
          {`Cannot schedule: talk to the vendor (${a.optimum.best.eta}, ${a.optimum.shift_days < 0 ? `prepone ${-a.optimum.shift_days} d` : `postpone ${a.optimum.shift_days} d`})`}
        </span>
      ) : a.advice ? (
        <button type="button" onClick={() => setDrafts((d) => ({ ...d, [a.reschedule_key]: { ...(d[a.reschedule_key] ?? {}), date: a.advice.suggested_eta, reason: a.advice.reason, row: a } }))} className={`text-left text-xs font-semibold ${a.advice.shift_days < 0 ? "text-rose-700" : "text-amber-700"} hover:underline`} title={a.advice.reason}>
          {`${a.advice.suggested_eta} (${a.advice.shift_days < 0 ? `prepone ${-a.advice.shift_days} d` : `postpone ${a.advice.shift_days} d`})`}
        </button>
      ) : a.optimum ? <span className="text-xs text-emerald-700">Date is fine</span> : ""),
      copyValue: (a) => (a.window?.state === "TALK_TO_VENDOR" ? "Talk to the vendor" : a.advice ? a.advice.suggested_eta : ""),
    },
    {
      key: "best_days", label: "At best date: Min / Max", width: "150px", align: "right",
      render: (a) => (a.advice ? `${fmtDays(a.optimum.best.min_days)} / ${fmtDays(a.optimum.best.max_days)}` : ""),
      copyValue: (a) => (a.advice ? `${a.optimum.best.min_days ?? ""}/${a.optimum.best.max_days ?? ""}` : ""),
    },
    {
      key: "why", label: "Why", width: "320px",
      render: (a) => (a.optimum ? <span className="text-xs">{a.window?.state === "TALK_TO_VENDOR" ? `${a.window.message} ` : ""}{a.optimum.reason}</span> : ""),
      copyValue: (a) => `${a.window?.state === "TALK_TO_VENDOR" ? `${a.window.message} ` : ""}${a.optimum?.reason ?? ""}`,
    },
    {
      key: "reason", label: "Reason", width: "200px", filterable: false,
      render: (a) => (a.reschedule_key ? (
        <input
          type="text"
          value={drafts[a.reschedule_key]?.reason ?? ""}
          placeholder="Why"
          onChange={(event) => setDrafts((d) => ({ ...d, [a.reschedule_key]: { ...(d[a.reschedule_key] ?? {}), reason: event.target.value, row: a } }))}
          className={`${CELL_INPUT} w-full`}
        />
      ) : ""),
    },
  ];

  const orderColumns = [
    { key: "flag", label: "", width: "90px", render: (o) => (o.bridge ? <span className="bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-800">Bridge</span> : o.late ? <span className="bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Late</span> : ""), copyValue: (o) => (o.bridge ? "Bridge" : o.late ? "Late" : "") },
    { key: "material_name", label: "Member", width: "200px", render: (o) => `${o.material_code ?? ""} ${o.material_name}`.trim() },
    { key: "vendor", label: "Vendor", width: "200px", render: (o) => o.vendor ?? "—" },
    { key: "covers", label: "For", width: "160px", render: (o) => o.covers ?? "—" },
    { key: "qty", label: "Qty", width: "130px", align: "right", render: (o) => lotText(o.qty, o.uom, o.order_qty, o.order_uom, o.material_id), copyValue: (o) => lotText(o.qty, o.uom, o.order_qty, o.order_uom, o.material_id) },
    { key: "po_by", label: "PO by", width: "100px", render: (o) => o.po_by ?? "—" },
    { key: "etd", label: "ETD", width: "100px", render: (o) => o.etd ?? "—" },
    { key: "eta_port", label: "ETA Port", width: "100px", render: (o) => o.eta_port ?? "—" },
    { key: "eta_plant", label: "ETA Plant", width: "100px", render: (o) => o.eta_plant ?? "—" },
    { key: "days", label: "After / before lot days", width: "160px", render: (o) => `${fmtDays(o.max_days_on_arrival)} / ${fmtDays(o.min_days_on_arrival)}`, copyValue: (o) => `${o.max_days_on_arrival ?? ""}/${o.min_days_on_arrival ?? ""}` },
    { key: "max_days_planned", label: "Planned Max days", width: "130px", render: (o) => (o.max_days_planned === null ? "—" : `${fmtDays(o.max_days_planned)}${o.max_days_basis === "DEFAULT" ? " (default — no cost data)" : ""}`), copyValue: (o) => o.max_days_planned ?? "" },
    { key: "unit_total_cost", label: "Full cost (₹)", width: "150px", render: (o) => (o.unit_total_cost === null || o.unit_total_cost === undefined ? "—" : unitCostText(o)), copyValue: (o) => (o.unit_total_cost === null || o.unit_total_cost === undefined ? "" : unitCostText(o)) },
    { key: "freight_term", label: "Freight", width: "130px", render: (o) => FREIGHT_LABEL[o.freight_term] ?? o.freight_term ?? "—" },
    { key: "cost_missing", label: "Cost gaps", width: "220px", render: (o) => (o.cost_missing?.length ? `Missing: ${o.cost_missing.join(", ")}` : "Complete"), copyValue: (o) => (o.cost_missing ?? []).join("; ") },
    { key: "reason", label: "Why", width: "360px", render: (o) => (o.bridge && o.cheapest_vendor ? `${o.reason} Cheapest: ${o.cheapest_vendor}.` : o.reason) },
    {
      key: "fix", label: "Change", width: "90px", filterable: false,
      render: (o) => (
        <button type="button" title="Take this lot into Your lots to change its date / qty" onClick={() => setLotDraft((d) => [...(d ?? plan?.scenario?.manual_lots ?? []), { material_id: o.material_id, plant_eta: o.eta_plant, qty_base: o.qty, vendor_id: null }])} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Fix / edit</button>
      ),
    },
  ];
  const transferColumns = [
    { key: "material_name", label: "Member", width: "220px", render: (t) => `${t.material_code ?? ""} ${t.material_name}`.trim() },
    { key: "from", label: "From", width: "80px" },
    { key: "to", label: "To", width: "80px" },
    { key: "qty", label: "Qty", width: "130px", align: "right", render: (t) => mq(t.qty, t.material_id, t.uom), copyValue: (t) => mq(t.qty, t.material_id, t.uom) },
    { key: "by", label: "By", width: "100px" },
  ];
  const ALT_LABEL = { GROUP_MEMBER: "Group member spare", TRANSFER: "R ↔ R / P ↔ P transfer", RESCHEDULE: "Advance an ordered lot", OTHER_COMPANY: "Other company (STO / Sub-CSN)", OTHER_VENDOR: "Other vendor", SAFETY_COMPROMISE: "Safety compromise", TRADER: "Domestic trader (last)" };
  const [otherOpen, setOtherOpen] = useState(false);
  const otherQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "item-plan-other", companyId, effMonth, effAsOf, demandAt, materialId],
    queryFn: () => getMtsItemPlanOtherCompanies({ company_id: companyId, plan_month: effMonth, as_of: effAsOf, demand_at: demandAt || undefined, material_ids: (plan?.members ?? []).map((m) => m.material_id).join(",") }),
    enabled: Boolean(otherOpen && plan),
  });

  const pending = Object.entries(drafts).filter(([, d]) => d?.row);
  const undoDraft = (key) => setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
  async function saveReschedules() {
    setSaving(true);
    try {
      await saveMtsInboundReschedule({
        company_id: companyId,
        rows: pending.map(([key, d]) => ({
          reschedule_key: key,
          material_id: d.row.material_id,
          original_eta: d.row.eta_plant ?? null,
          rescheduled_eta: d.clear ? null : d.date || d.row.rescheduled_eta || null,
          reason: d.reason ?? null,
        })),
      });
      pushToast({ message: "Rescheduled dates saved for planning. CSN Tracker is unchanged — update it there when the vendor confirms.", tone: "success" });
      setDrafts({});
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement"] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const versionsQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "item-plan-versions", companyId, materialId],
    queryFn: () => listMtsItemPlanScenarios({ company_id: companyId, material_id: materialId }),
    enabled: Boolean(showVersions && companyId && materialId),
  });

  async function saveLots(lots, source, note) {
    setSaving(true);
    try {
      const result = await saveMtsItemPlanScenario({ company_id: companyId, material_id: materialId, manual_lots: lots.map(withoutShownQty), source, note });
      pushToast({ message: `Plan saved as version ${result?.result?.version_no ?? ""}. Recalculating…`, tone: "success" });
      setLotDraft(null);
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "item-plan"] });
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "item-plan-versions", companyId, materialId] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function askAi() {
    setAiBusy(true);
    setAiResult(null);
    try {
      const result = await reviewMtsItemPlanWithAi({
        company_id: companyId, plan_month: effMonth, as_of: effAsOf, demand_at: demandAt || undefined, material_id: materialId,
        ...(lotDraft ? { manual_lots: lotDraft.map(withoutShownQty) } : {}), question: question || undefined,
      });
      setAiResult(result);
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setAiBusy(false);
    }
  }

  /** Engine preview of unsaved changes: moved arrivals, the lots draft, other Target days. */
  async function runPreview({ label, lots, targetOverrides } = {}) {
    setPreviewBusy(true);
    try {
      const reschedules = pending.map(([key, d]) => ({ reschedule_key: key, date: d.clear ? null : d.date || d.row.rescheduled_eta || null }));
      const manualLots = (lots ?? lotDraft ?? plan?.scenario?.manual_lots ?? []).filter((l) => Number(l.qty_base) > 0).map((l) => ({ ...withoutShownQty(l), qty_base: Number(l.qty_base) }));
      const result = await simulateMtsItemPlan({
        company_id: companyId, plan_month: effMonth, as_of: effAsOf, demand_at: demandAt || undefined, material_id: materialId,
        manual_lots: manualLots, reschedules, ...(targetOverrides ? { target_overrides: targetOverrides } : {}),
      });
      const parts = [
        reschedules.length ? `${reschedules.length} moved arrival(s)` : "",
        lotDraft || lots ? `${manualLots.length} own lot(s)` : "",
        label ?? "",
      ].filter(Boolean);
      setPreview({ plan: result, label: parts.join(" · ") || "current inputs" });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setPreviewBusy(false);
    }
  }

  async function exportExcel() {
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `po22_item_plan_${materialId}_${asOf}.xlsx`,
        sheetName: "Item Plan",
        columns: gridColumns.map((c) => ({ key: c.key, label: c.label, width: c.width, align: c.align })),
        rows: plan?.grid ?? [],
        getCellValue: (row, column) => gridColumns.find((c) => c.key === column.key)?.copyValue?.(row) ?? row[column.key] ?? "",
        preambleRows: [
          ["Item", memberName.get(materialId) ?? ""],
          ["Family members", (plan?.members ?? []).map((m) => `${m.material_code ?? ""} ${m.material_name}`.trim()).join("; ")],
          ["As-of", plan?.calendar?.as_of ?? asOf],
          ["Horizon end", plan?.calendar?.horizon_end ?? ""],
          ["Coverage rule", plan?.family?.is_family ? "Family allocator coverage" : "Max/Min Days = active approved-demand coverage; zero-demand dates carry physical stock forward separately."],
        ],
      });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Find item</span>
          <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code or name" className={`${INPUT_CLASS} w-56`} />
        </label>
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Item</span>
          <select value={materialId} onChange={(event) => { setMaterialId(event.target.value); setOpenDay(""); setDrafts({}); setOtherOpen(false); setLotDraft(null); setAiResult(null); setPreview(null); }} className={`${INPUT_CLASS} w-96`}>
            <option value="">{planningQ.isLoading ? "Loading items…" : "Select an RM / PM…"}</option>
            {filtered.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-slate-700" title="Calibration (CC): the day the opening is the actual book stock">
          <span className="font-medium text-slate-800">CC date</span>
          <input type="date" value={effAsOf} max={asOf} onChange={(event) => setCcDate(event.target.value === asOf ? "" : event.target.value)} className={INPUT_CLASS} />
        </label>
        <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement", "item-plan", companyId] })} disabled={!materialId} className="h-8 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {itemQ.isFetching ? "Calculating…" : "Recalculate"}
        </button>
        <button type="button" onClick={() => void exportExcel()} disabled={!plan} className="h-8 border border-emerald-600 bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Excel</button>
      </div>
      {itemQ.error ? <p className="text-sm text-rose-700">{errorText(itemQ.error)}</p> : null}
      {!materialId ? <p className="text-sm text-slate-500">Pick an item. A grouped item shows its whole family; a non-group item shows itself.</p> : null}
      {materialId && itemQ.isLoading ? <p className="text-sm text-slate-500">Calculating ~6 months…</p> : null}

      {plan ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{plan.family.is_family ? `Family: ${plan.family.groups.map((g) => g.label).join(" · ")}` : "Not in any group — single item"}</span>
            <span>Horizon {plan.calendar.as_of} → {plan.calendar.horizon_end}</span>
            <span>Demand: {plan.month_sources.map((m) => `${m.month.slice(0, 7)} ${demandSourceLabel(m.source).toLowerCase()}`).join(" · ")}</span>
            <span>Unit: {uom || "—"}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void runPreview()} disabled={previewBusy || (pending.length === 0 && lotDraft === null)} title="Moved arrival dates and your lots draft — see the effect before saving" className="h-7 border border-indigo-600 bg-indigo-600 px-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {previewBusy ? "Engine is calculating…" : "Preview changes"}
            </button>
            <span className="text-xs text-slate-500">Move an arrival date, change your lots or try other Safety days, then Preview: Closing, Min days and Max days are recalculated. Nothing is saved.</span>
          </div>
          {preview ? (
            <div className="grid gap-1 border-2 border-indigo-400 bg-indigo-50 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-indigo-900">PREVIEW — not saved ({preview.label}). Grids below show the preview.</span>
                <button type="button" onClick={() => { setPreview(null); setLotDraft(null); }} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Back to saved plan</button>
                {lotDraft ? <button type="button" disabled={saving} onClick={() => void saveLots(lotDraft.filter((l) => Number(l.qty_base) > 0).map((l) => ({ ...l, qty_base: Number(l.qty_base) })), "USER", null)} className="h-6 border border-sky-600 bg-sky-600 px-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? "Saving…" : "Save my quantities"}</button> : null}
              </div>
              <table>
                <thead><tr className="text-left text-slate-600"><th className="pr-3" /><th className="pr-3">Shortage days</th><th className="pr-3">First shortage</th><th className="pr-3">Days ≤ Target</th><th className="pr-3">Days ≤ Critical</th><th className="pr-3">Lowest Max days</th><th className="pr-3">Avg stock</th><th className="pr-3">Avg money in stock</th><th>New orders</th></tr></thead>
                <tbody>
                  {[["Saved plan", plan.metrics, plan.future_orders], ["Preview", preview.plan.metrics, preview.plan.future_orders]].map(([label, m, orders]) => (
                    <tr key={label} className={label === "Preview" ? "font-semibold text-indigo-900" : ""}>
                      <td className="pr-3">{label}</td><td className="pr-3">{m.shortage_days}</td><td className="pr-3">{m.first_shortage_day ?? "—"}</td>
                      <td className="pr-3">{m.days_below_target}</td><td className="pr-3">{m.days_below_critical ?? "—"}</td><td className="pr-3">{fmtDays(m.lowest_max_days)}</td>
                      <td className="pr-3">{fq(m.average_closing)} {familyUom}</td><td className="pr-3">{m.average_stock_value === null ? "—" : `₹${fmtQty(m.average_stock_value)}`}</td>
                      <td>{(orders ?? []).length} ({fq((orders ?? []).reduce((sum, o) => sum + o.qty, 0))} {familyUom})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {(plan.plan_gaps ?? []).length > 0 ? (
            <div className="grid gap-1 border-2 border-rose-400 bg-rose-50 p-2 text-xs text-rose-900">
              <span className="font-semibold">Engine cannot place lots for these members — stock can run out with no order shown:</span>
              <ul className="ml-4 list-disc">
                {plan.plan_gaps.map((g) => (
                  <li key={g.material_id}>
                    <span className="font-semibold">{`${g.material_code ?? ""} ${g.material_name}`.trim()}</span>: {g.issues.map((i) => GAP_LABEL[i] ?? i).join("; ")}
                    {g.first_shortage_day ? <span className="font-semibold"> — runs out {g.first_shortage_day}</span> : null}
                  </li>
                ))}
              </ul>
              <span>Until these are set you can still type your own Quantity to Dispatch in the grid.</span>
            </div>
          ) : null}

          <section className="grid gap-1">
            <h3 className="text-sm font-semibold text-slate-800">Members</h3>
            <ErpDenseGrid {...GRID_PROPS} columns={memberColumns} rows={plan.members} rowKey={(m) => m.material_id} maxHeight="25vh" />
          </section>

          <div className="flex flex-wrap items-center gap-1">
            {ITEM_PLAN_PANELS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPanel((cur) => (cur === p.id ? "" : p.id))}
                className={`h-7 border px-2 text-xs font-semibold ${panel === p.id ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {p.label}{panelCount(p.id) ? ` (${panelCount(p.id)})` : ""}
              </button>
            ))}
          </div>
          <WaterfallVerdict waterfall={view.waterfall} futureOrders={view.future_orders} />
          <div className="grid gap-2">
            <section className="grid content-start gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Day by day {plan.family.is_family ? "(whole family)" : ""} — click a date for each member{preview ? <span className="ml-2 text-indigo-700">(PREVIEW)</span> : null}</h3>
              <ErpDenseGrid
                {...GRID_PROPS}
                columns={gridColumns}
                rows={view.grid}
                rowKey={(r) => r.day}
                renderExpandedRow={(r) => (openDay === r.day ? (
                  <div className="grid gap-1 bg-slate-50 p-2 text-xs">
                    {(memberDaily.get(r.day) ?? []).map((m) => (
                      <div key={m.material_id} className="flex flex-wrap gap-3">
                        <span className="w-56 font-semibold text-slate-800">{memberName.get(m.material_id) ?? "—"}</span>
                        <span>Opening {mq(m.opening, m.material_id, m.uom)}</span>
                        <span>Arrival {mq(m.arrivals, m.material_id, m.uom)}</span>
                        <span>Use {mq(m.use, m.material_id, m.uom)}</span>
                        {m.group_draws?.length ? <span>For group: {m.group_draws.map((g) => `${g.group}: ${mq(g.qty, m.material_id, m.uom)}`).join(" · ")}</span> : null}
                        <span>Closing {mq(m.closing, m.material_id, m.uom)}</span>
                        <span>Max {fmtDays(m.max_days)} d · Min {fmtDays(m.min_days)} d</span>
                        <span className={m.critical_days !== null && m.max_days !== null && m.max_days < m.critical_days ? "font-semibold text-rose-700" : m.target_days !== null && m.max_days !== null && m.max_days < m.target_days ? "font-semibold text-amber-700" : ""}>
                          Target {fmtDays(m.target_days)} / Critical {fmtDays(m.critical_days)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null)}
                maxHeight="calc(100vh - 360px)"
              />
            </section>

            <DrawerBase
              visible={panel !== ""}
              title={ITEM_PLAN_PANELS.find((p) => p.id === panel)?.label ?? ""}
              onClose={() => setPanel("")}
              width="min(1100px, calc(100vw - 24px))"
            >
            <div className="grid content-start gap-3">
              {panel === "waterfall" ? <MtsWaterfallPanel waterfall={view.waterfall} futureOrders={view.future_orders} /> : null}
              {panel === "prediction" ? (
              <>
              <section className="grid gap-1 border border-amber-300 bg-amber-50 p-2">
                <h3 className="text-sm font-semibold text-slate-800">Prediction — every Quantity to Dispatch{preview ? <span className="ml-2 text-indigo-700">(PREVIEW)</span> : null}</h3>
                <p className="text-xs text-slate-500">Engine lots and your own (type in the grid's Quantity to Dispatch). Max / Min days on that date; Port ETA and Import ETD worked back from the plant date (port → plant days from received CSNs, vendor transit time).</p>
                <ErpDenseGrid {...GRID_PROPS} columns={predictionColumns} rows={view.prediction ?? []} rowKey={(p, i) => `${p.source}|${p.material_id}|${p.date}|${i}`} emptyMessage="No dispatch needed in the horizon." maxHeight="30vh" />
              </section>
              </>
              ) : null}
              {panel === "allocation" ? (
              <>
              <section className="grid gap-1 border border-sky-200 bg-sky-50 p-2">
                <h3 className="text-sm font-semibold text-slate-800">Family allocation report</h3>
                <p className="text-xs text-slate-600">This is the engine&apos;s auditable waterfall: counted source, usable date, direct/exclusive reserve, member-to-group use, carry and future-lot reason. It is a report of the server engine, not a browser calculation.</p>
              </section>
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold text-slate-800">At a glance — stock, inbound, who uses it, cover and why</h3>
                <ErpDenseGrid {...GRID_PROPS} columns={glanceColumns} rows={glanceRows} rowKey={(r) => r.key} emptyMessage="No member in this family." maxHeight="24vh" />
              </section>
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold text-slate-800">1. Material sources — what can enter the family</h3>
                <ErpDenseGrid {...GRID_PROPS} columns={traceSourceColumns} rows={sourceTraceRows} rowKey={(r) => r.key} emptyMessage="No counted stock or future source in this family." maxHeight="26vh" />
              </section>
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold text-slate-800">2. Carried group reserve — what remains protected for each group</h3>
                <p className="text-xs text-slate-500">The reserve starts from opening/receipt stock, falls only when that group consumes it, and is not rebuilt every day. It is a planning balance, not a physical Store issue instruction.</p>
                <ErpDenseGrid {...GRID_PROPS} columns={traceReserveColumns} rows={groupReserveRows} rowKey={(r) => r.key} emptyMessage="No group reserve applies to this material family." maxHeight="26vh" />
              </section>
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold text-slate-800">3. Allocation flow — material → own use / group → carry</h3>
                <p className="text-xs text-slate-500">Each row is one actual engine draw. “Carry after date” is the member balance after all draws on that date; it is the balance available to later eligible dates, not a new purchase recommendation.</p>
                <ErpDenseGrid {...GRID_PROPS} columns={traceFlowColumns} rows={allocationTraceRows} rowKey={(r) => r.key} emptyMessage="No direct or group consumption in this horizon." maxHeight="36vh" />
              </section>
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold text-slate-800">4. Projection — why a new lot is proposed</h3>
                <ErpDenseGrid {...GRID_PROPS} columns={orderColumns} rows={view.future_orders ?? []} rowKey={(o) => `${o.material_id}|${o.sequence}|${o.lot_no}|trace`} emptyMessage="No engine lot is needed in this horizon." maxHeight="24vh" />
              </section>
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold text-slate-800">5. End-of-horizon excess / carry</h3>
                <ErpDenseGrid {...GRID_PROPS} columns={traceExcessColumns} rows={excessTraceRows} rowKey={(r) => r.material_id} emptyMessage="No family member in this horizon." maxHeight="22vh" />
              </section>
              </>
              ) : null}
              {panel === "arrivals" ? (
              <>
              <section className="grid gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">Arrivals / Future Orders</h3>
                  <button type="button" onClick={() => void saveReschedules()} disabled={saving || pending.length === 0} className="h-7 border border-sky-600 bg-sky-600 px-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                    {saving ? "Saving…" : `Save rescheduled dates${pending.length ? ` (${pending.length})` : ""}`}
                  </button>
                  <button type="button" onClick={() => setDrafts((d) => ({ ...d, ...Object.fromEntries(plan.arrivals.filter((x) => x.advice).map((x) => [x.reschedule_key, { ...(d[x.reschedule_key] ?? {}), date: x.advice.suggested_eta, reason: x.advice.reason, row: x }])) }))} disabled={!plan.arrivals.some((x) => x.advice)} className="h-7 border border-amber-600 bg-white px-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50">Use all engine dates</button>
                  {pending.length ? <button type="button" onClick={() => { setDrafts({}); setPreview(null); }} className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Undo all</button> : null}
                  <button type="button" onClick={() => void runPreview()} disabled={previewBusy || pending.length === 0} className="h-7 border border-indigo-600 bg-white px-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50">Preview</button>
                </div>
                <p className="text-xs text-slate-500">Engine best date: every day of the horizon is tried for each not-yet-shipped piece — fewest stock-out / below-Critical / below-Target days, then the latest date (least money held). Preview checks all moves together. Planning only — CSN Tracker is never changed. Shipped lots cannot be moved.</p>
                <ErpDenseGrid {...GRID_PROPS} columns={arrivalColumns} rows={view.arrivals} rowKey={(a, i) => `${a.reference}|${a.material_id}|${i}`} emptyMessage="No open PO / CSN / STO for these members." maxHeight="35vh" />
              </section>
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold text-slate-800">Future Orders — Engine plan</h3>
                <p className="text-xs text-slate-500">Each lot: cheapest authorised vendor that can arrive in time, sized to Max days (Target + best order cycle); a fixed MOQ is never broken. “After / before lot days” is family cover after the lot lands / without that day&apos;s lot, so a before value of 0 means the lot is needed immediately. Advisory — no PO is created.</p>
                <ErpDenseGrid {...GRID_PROPS} columns={orderColumns} rows={view.future_orders ?? []} rowKey={(o) => `${o.material_id}|${o.sequence}|${o.lot_no}`} emptyMessage="No new order needed in the horizon." maxHeight="30vh" />
              </section>
              </>
              ) : null}
              {panel === "lots" ? (
              <>
              <section className="grid gap-1 border border-sky-200 bg-sky-50 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">Your lots {plan.scenario?.version_no ? `(version ${plan.scenario.version_no}${plan.scenario.source === "AI_APPLIED" ? ", AI applied" : ""})` : ""}</h3>
                  {lotDraft === null ? (
                    <button type="button" onClick={() => setLotDraft([...(plan.scenario?.manual_lots ?? [])])} className="h-7 border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit my lots</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setLotDraft((d) => [...d, { material_id: materialId, plant_eta: effAsOf, qty_base: 0, vendor_id: null }])} className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Add lot</button>
                      <button type="button" disabled={saving} onClick={() => void saveLots(lotDraft.filter((l) => Number(l.qty_base) > 0), "USER", null)} className="h-7 border border-sky-600 bg-sky-600 px-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? "Saving…" : "Save & recalculate"}</button>
                      <button type="button" onClick={() => void runPreview()} disabled={previewBusy} className="h-7 border border-indigo-600 bg-white px-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50">Preview</button>
                      <button type="button" onClick={() => setLotDraft(null)} className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">Cancel</button>
                    </>
                  )}
                  <button type="button" onClick={() => setShowVersions((v) => !v)} className="h-7 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">{showVersions ? "Hide versions" : "Versions"}</button>
                  <button
                    type="button"
                    disabled={(lotDraft ?? plan.user_lots ?? []).length === 0}
                    onClick={() => copyTable([
                      { label: "Member", key: "member", copyValue: (l) => memberName.get(l.material_id) ?? "—" },
                      { label: "Plant date", key: "plant_eta" },
                      { label: "Qty", key: "qty_base", copyValue: (l) => lotQtyText(l, l.qty_base) },
                      { label: "Vendor", key: "vendor", copyValue: (l) => lotVendorFlags(l, plan.vendor_choices).option?.vendor_label ?? "Any (engine)" },
                      { label: "Value / check", key: "check", copyValue: (l) => {
                        const flag = lotVendorFlags(l, plan.vendor_choices);
                        if (!flag.option) return "—";
                        return [
                          flag.value === null ? "no cost" : `₹${Math.round(flag.value).toLocaleString("en-IN")}`,
                          flag.tooEarly ? `too early (earliest ${flag.option.earliest_plant_eta})` : "",
                          flag.belowMoq ? `below MOQ ${lotQtyText(l, flag.option.moq_qty)}` : "",
                        ].filter(Boolean).join("; ");
                      } },
                    ], lotDraft ?? plan.user_lots ?? [])}
                    className="h-7 border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >Copy table + headers</button>
                </div>
                <p className="text-xs text-slate-500">Lots you fix stay as you set them; the engine plans the rest around them. Planning only — no PO is created.</p>
                {(lotDraft ?? plan.user_lots ?? []).length === 0 ? <p className="text-xs text-slate-500">None — the plan is fully Engine + AI.</p> : (
                  <table className="text-xs">
                    <thead><tr className="text-left text-slate-600"><th className="pr-2">Member</th><th className="pr-2">Plant date</th><th className="pr-2">Qty</th><th className="pr-2">Vendor</th><th className="pr-2">Value / check</th><th /></tr></thead>
                    <tbody>
                      {(lotDraft ?? plan.user_lots).map((l, i) => (
                        <tr key={`${l.material_id}|${i}`}>
                          <td className="pr-2">
                            {lotDraft ? (
                              <select value={l.material_id} onChange={(event) => setLotDraft((d) => d.map((x, j) => (j === i ? { ...x, material_id: event.target.value, qty_display: undefined } : x)))} className={CELL_INPUT}>
                                {(plan.members ?? []).map((m) => <option key={m.material_id} value={m.material_id}>{`${m.material_code ?? ""} ${m.material_name}`.trim()}</option>)}
                              </select>
                            ) : memberName.get(l.material_id) ?? "—"}
                          </td>
                          <td className="pr-2">{lotDraft ? <input type="date" value={l.plant_eta} onChange={(event) => setLotDraft((d) => d.map((x, j) => (j === i ? { ...x, plant_eta: event.target.value } : x)))} className={CELL_INPUT} /> : l.plant_eta}</td>
                          <td className="pr-2">
                            {lotDraft ? (
                              <span className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={l.qty_display ?? (l.qty_base === "" || l.qty_base === null || l.qty_base === undefined ? "" : Math.round((Number(l.qty_base) / lotUnit(l).factor) * 1000) / 1000)}
                                  onChange={(event) => setLotDraft((d) => d.map((x, j) => (j === i ? { ...x, qty_display: event.target.value, qty_base: event.target.value === "" ? "" : Number(event.target.value) * lotUnit(x).factor } : x)))}
                                  className={`${CELL_INPUT} w-28`}
                                />
                                <span className="text-slate-500">{lotUnit(l).uom}</span>
                              </span>
                            ) : lotQtyText(l, l.qty_base)}
                          </td>
                          <td className="pr-2">
                            {lotDraft ? (
                              <select value={l.vendor_id ?? ""} onChange={(event) => setLotDraft((d) => d.map((x, j) => (j === i ? { ...x, vendor_id: event.target.value || null, qty_display: undefined } : x)))} className={CELL_INPUT}>
                                <option value="">Any (engine)</option>
                                {((plan.vendor_choices ?? []).find((c) => c.material_id === l.material_id)?.options ?? []).map((o) => (
                                  <option key={o.vendor_id} value={o.vendor_id}>{`${o.vendor_label} · ${o.lead_time_days ?? "?"} d${o.unit_total_cost === null ? "" : ` · ₹${o.unit_total_cost.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}`}</option>
                                ))}
                              </select>
                            ) : lotVendorFlags(l, plan.vendor_choices).option?.vendor_label ?? "Any (engine)"}
                          </td>
                          <td className="pr-2">
                            {(() => {
                              const f = lotVendorFlags(l, plan.vendor_choices);
                              if (!f.option) return "—";
                              return (
                                <span>
                                  {f.value === null ? "no cost" : `₹${Math.round(f.value).toLocaleString("en-IN")}`}
                                  {f.tooEarly ? <span className="ml-1 font-semibold text-rose-700">{`too early (earliest ${f.option.earliest_plant_eta})`}</span> : null}
                                  {f.belowMoq ? <span className="ml-1 font-semibold text-amber-700">{`below MOQ ${lotQtyText(l, f.option.moq_qty)}`}</span> : null}
                                </span>
                              );
                            })()}
                          </td>
                          <td>{lotDraft ? <button type="button" onClick={() => setLotDraft((d) => d.filter((_, j) => j !== i))} className="text-rose-700 hover:underline">Remove</button> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {showVersions ? (
                  <ul className="ml-4 list-disc text-xs text-slate-700">
                    {(versionsQ.data?.rows ?? []).map((v) => <li key={v.id}>v{v.version_no}{v.is_current ? " (current)" : ""} · {v.source === "AI_APPLIED" ? "AI applied" : "user"} · {v.lot_count} lot(s) · {v.created_by_name} · {String(v.created_at).slice(0, 16).replace("T", " ")}{v.note ? ` — ${v.note}` : ""}</li>)}
                    {versionsQ.isLoading ? <li>Loading…</li> : null}
                  </ul>
                ) : null}
              </section>
              </>
              ) : null}
              {panel === "vendors" ? (
              <>
              <VendorDateCompare
                key={`vendor|${materialId}`}
                plan={plan}
                materialId={materialId}
                unitOf={du.unitOf}
                defaultDate={plan.future_orders?.[0]?.eta_plant ?? effAsOf}
                onAddLot={(lot, andPreview) => {
                  const next = [...(lotDraft ?? plan.scenario?.manual_lots ?? []), lot];
                  setLotDraft(next);
                  if (andPreview) void runPreview({ lots: next });
                }}
              />
              </>
              ) : null}
              {panel === "whatif" ? (
              <>
              <TargetWhatIf
                key={`target|${materialId}|${effAsOf}`}
                plan={plan}
                companyId={companyId}
                planMonth={effMonth}
                asOf={effAsOf}
                demandAt={demandAt}
                materialId={materialId}
                onPreviewTarget={(r) => void runPreview({ label: `Target ${r.target_days} / Critical ${r.critical_days ?? "—"} days`, targetOverrides: [{ material_id: materialId, target_days: r.target_days, critical_days: r.critical_days }] })}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement"] })}
              />
              </>
              ) : null}
              {panel === "ai" ? (
              <>
              <section className="grid gap-1 border border-violet-200 bg-violet-50 p-2">
                <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder="Optional: tell the AI what you changed or want (e.g. 'import is delayed 3 weeks — what now?')" className="border border-slate-300 bg-white p-1 text-xs" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void askAi()} disabled={aiBusy} className="h-7 border border-violet-600 bg-violet-600 px-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{aiBusy ? "AI is planning…" : lotDraft ? "Ask AI about my draft" : "Ask AI to plan"}</button>
                  <span className="text-xs text-slate-500">The engine re-simulates every AI lot; numbers below are the engine's.</span>
                </div>
                {aiResult ? (
                  <div className="grid gap-2 text-xs">
                    <p className="whitespace-pre-wrap text-slate-800">{aiResult.verdict}</p>
                    <button
                      type="button"
                      onClick={() => copyTable([
                        { label: "Plan", key: "label" },
                        { label: "Shortage days", key: "shortage_days" },
                        { label: "Days ≤ Target", key: "days_below_target" },
                        { label: "Lowest Max days", key: "lowest_max_days", copyValue: (r) => fmtDays(r.lowest_max_days) },
                        { label: `Avg stock (${familyUom})`, key: "average_closing", copyValue: (r) => fq(r.average_closing) },
                        { label: "Avg stock value", key: "average_stock_value", copyValue: (r) => r.average_stock_value === null ? "—" : `₹${fmtQty(r.average_stock_value)}` },
                      ], [["Now", aiResult.metrics_before], ["With AI lots", aiResult.metrics_after]]
                        .filter(([, metrics]) => metrics)
                        .map(([label, metrics]) => ({ label, ...metrics })))}
                      className="h-7 w-max border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >Copy table + headers</button>
                    <table>
                      <thead><tr className="text-left text-slate-600"><th className="pr-3" /><th className="pr-3">Shortage days</th><th className="pr-3">Days ≤ Target</th><th className="pr-3">Lowest Max days</th><th className="pr-3">Avg stock ({familyUom})</th><th>Avg stock value</th></tr></thead>
                      <tbody>
                        {[["Now", aiResult.metrics_before], ["With AI lots", aiResult.metrics_after]].filter(([, m]) => m).map(([label, m]) => (
                          <tr key={label}><td className="pr-3 font-semibold">{label}</td><td className="pr-3">{m.shortage_days}</td><td className="pr-3">{m.days_below_target}</td><td className="pr-3">{fmtDays(m.lowest_max_days)}</td><td className="pr-3">{fq(m.average_closing)} {familyUom}</td><td>{m.average_stock_value === null ? "—" : `₹${fmtQty(m.average_stock_value)}`}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {(aiResult.proposed_lots ?? []).length ? (
                      <>
                        <ul className="ml-4 list-disc">{aiResult.proposed_lots.map((l, i) => <li key={i}>{l.material_code}: {fmtQty(l.qty)} on {l.plant_eta}{l.reason ? ` — ${l.reason}` : ""}</li>)}</ul>
                        <button type="button" disabled={saving} onClick={() => void saveLots([...(lotDraft ?? plan.scenario?.manual_lots ?? []), ...aiResult.proposed_lots.map((l) => ({ material_id: l.material_id, plant_eta: l.plant_eta, qty_base: l.qty, vendor_id: null }))], "AI_APPLIED", "AI proposal applied")} className="h-7 w-max border border-violet-600 bg-white px-2 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50">Apply AI lots to my plan</button>
                      </>
                    ) : <p className="text-slate-600">AI proposes no extra lots.</p>}
                    {(aiResult.rejected ?? []).length ? <p className="text-slate-500">Not used: {aiResult.rejected.join("; ")}</p> : null}
                  </div>
                ) : null}
              </section>
              </>
              ) : null}
              {panel === "transfers" ? (
              <>
              <section className="grid gap-1">
                <p className="text-xs text-slate-500">{plan.transfer_note}</p>
                <ErpDenseGrid {...GRID_PROPS} columns={transferColumns} rows={view.transfers ?? []} rowKey={(t, i) => `${t.material_id}|${t.from}|${t.to}|${i}`} emptyMessage="No R ↔ R or P ↔ P transfer needed." maxHeight="20vh" />
              </section>
              </>
              ) : null}
              {panel === "transfers" ? (
              <>
              {(view.alternatives ?? []).length > 0 ? (
                <section className="grid gap-1">
                  <h3 className="text-sm font-semibold text-rose-800">Below Target — options in order</h3>
                  {view.alternatives.map((alt) => (
                    <div key={alt.material_id} className="border border-rose-200 bg-rose-50 p-2 text-xs">
                      <div className="font-semibold text-slate-800">{`${alt.material_code ?? ""} ${alt.material_name}`.trim()} — below Target {alt.first_below_target_day ?? "—"}{alt.first_shortage_day ? `, runs out ${alt.first_shortage_day}` : ""}</div>
                      <ol className="ml-4 list-decimal">
                        {alt.options.map((o) => <li key={o.kind}><span className="font-semibold">{ALT_LABEL[o.kind] ?? o.kind}</span>{o.qty !== null ? ` — ${fmtQty(o.qty)}` : ""}: {o.detail}</li>)}
                      </ol>
                    </div>
                  ))}
                </section>
              ) : null}
              </>
              ) : null}
              {panel === "others" ? (
              <>
              <section className="grid gap-1">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOtherOpen(true)} disabled={otherQ.isFetching} className="h-7 border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {otherQ.isFetching ? "Checking…" : "Check other companies"}
                  </button>
                </div>
                {otherQ.error ? <p className="text-xs text-rose-700">{errorText(otherQ.error)}</p> : null}
                {otherQ.data ? (
                  <div className="text-xs text-slate-700">
                    {(otherQ.data.spare ?? []).length === 0 ? `No spare above their own Target in: ${(otherQ.data.companies_checked ?? []).join(", ") || "no other company in your access"}.` : (
                      <ul className="ml-4 list-disc">{otherQ.data.spare.map((x) => <li key={`${x.company_id}|${x.material_id}`}>{x.company}: {x.material_name} — {fmtQty(x.spare_qty)} spare</li>)}</ul>
                    )}
                    <p className="text-slate-500">{otherQ.data.note}</p>
                  </div>
                ) : null}
              </section>
              </>
              ) : null}
            </div>
            </DrawerBase>
          </div>
        </>
      ) : null}
    </div>
  );
}
