/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsCustomerPlanPage.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: MTS Customer Plan — one Procurement page, exactly three tabs
 *          (owner spec, docs/mts-planning/DECISION-REGISTER.md on agent/chatgpt
 *          31dbfee):
 *            1. Plan Entry     — company × month × SKU Rolling / Final /
 *                                Additional / Urgent (From Existing Plan vs
 *                                Extra Urgent, with a dated period).
 *            2. Stroke & RM Primary — planning-only stroke periods and Use
 *                                Primary Y/N per effective Stroke × RM group.
 *            3. Plan Report    — PLAN per SKU across selected year-months.
 *          Every table is an ErpDenseGrid with Excel-style cell navigation and
 *          per-column filters (owner, 2026-10-14).
 *          Which plan types a user may enter comes from the backend ACL
 *          decision (/mts-plan/access) — never from role codes on this page.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { pushToast } from "../../../../store/uiToast.js";
import {
  getMtsPlanAccess,
  getMtsPlanEntryGrid,
  getMtsPlanHistory,
  getMtsPlanReport,
  getMtsPlanStrokeSettings,
  saveMtsPlanAddonLines,
  saveMtsPlanBaseLines,
  saveMtsPlanStrokeSetting,
} from "../procurementApi.js";

const PLAN_TYPE_OPTIONS = [
  { value: "ROLLING", label: "Rolling" },
  { value: "FINAL", label: "Final" },
  { value: "ADDITIONAL", label: "Additional" },
  { value: "URGENT", label: "Urgent" },
];
const URGENT_MODE_OPTIONS = [
  { value: "FROM_PLAN", label: "From Existing Plan (re-phase, no extra qty)" },
  { value: "EXTRA", label: "Extra Urgent (adds demand)" },
];
const BASE_TYPES = ["ROLLING", "FINAL"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GRID_PROPS = { cellNavigate: true, columnFilter: true, stickyFirstColumn: true, fitColumnWidths: true };
const INPUT_CLASS = "h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500";

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(isoMonthStart) {
  const [year, month] = String(isoMonthStart).split("-");
  return `${MONTH_LABELS[Number(month) - 1] ?? month}-${year}`;
}
function fmtQty(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "";
}
function blankOr(value) {
  return value === null || value === undefined || value === "" ? <span className="text-slate-300">—</span> : value;
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "Request failed");
}

export default function MtsCustomerPlanPage() {
  const { runtimeContext } = useMenu();
  const [companyIdInput, setCompanyId] = useState("");
  const companyId = companyIdInput || resolveDefaultTransactionCompanyId(runtimeContext);
  const [activeTab, setActiveTab] = useState("entry");
  const [planMonth, setPlanMonth] = useState(currentMonthValue());

  const accessQ = useQuery({
    queryKey: ["procurement", "mts-plan", "access", companyId],
    queryFn: () => getMtsPlanAccess({ company_id: companyId }),
    enabled: Boolean(companyId),
  });
  const access = accessQ.data ?? null;

  const tabs = [
    { id: "entry", label: "1. Plan Entry" },
    { id: "stroke", label: "2. Stroke & RM Primary" },
    { id: "report", label: "3. Plan Report" },
  ];

  return (
    <ErpScreenScaffold
      eyebrow="Procurement · MTS Planning"
      title="MTS Customer Plan"
      error={accessQ.error ? errorText(accessQ.error) : ""}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
          </div>
          {activeTab !== "report" ? (
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Plan Month</span>
              <input type="month" value={planMonth} onChange={(event) => setPlanMonth(event.target.value)} className={INPUT_CLASS} />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {tabs.map((tab) => (
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
            <span className="text-xs text-slate-500">
              Access: {access.can_maintain ? "Full (all plan types + stroke setup)" : access.can_enter_addon ? "View + Additional / Urgent entry" : "View only"}
            </span>
          ) : null}
        </div>

        {!companyId ? (
          <p className="text-sm text-slate-500">Select a company.</p>
        ) : activeTab === "entry" ? (
          <PlanEntryTab companyId={companyId} planMonth={planMonth} access={access} />
        ) : activeTab === "stroke" ? (
          <StrokeTab companyId={companyId} planMonth={planMonth} access={access} />
        ) : (
          <ReportTab companyId={companyId} />
        )}
      </div>
    </ErpScreenScaffold>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1 — Plan Entry
// ─────────────────────────────────────────────────────────────────────────────
function PlanEntryTab({ companyId, planMonth, access }) {
  const queryClient = useQueryClient();
  const allowedTypes = useMemo(() => access?.allowed_plan_types ?? [], [access]);
  const [planType, setPlanType] = useState("ROLLING");
  const [entryUom, setEntryUom] = useState("KG");
  const [urgentMode, setUrgentMode] = useState("FROM_PLAN");
  const [urgentFrom, setUrgentFrom] = useState("");
  const [urgentTo, setUrgentTo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [historyRow, setHistoryRow] = useState(null);

  // A user who cannot enter Rolling/Final starts on the first type they can use.
  useEffect(() => {
    if (allowedTypes.length > 0 && !allowedTypes.includes(planType)) setPlanType(allowedTypes[0]);
  }, [allowedTypes, planType]);

  const gridKey = ["procurement", "mts-plan", "entry-grid", companyId, planMonth, planType];
  const gridQ = useQuery({
    queryKey: gridKey,
    queryFn: () => getMtsPlanEntryGrid({ company_id: companyId, plan_month: planMonth, plan_type: planType }),
    enabled: Boolean(companyId && planMonth),
  });
  const rows = useMemo(() => gridQ.data?.rows ?? [], [gridQ.data]);
  const canWriteType = allowedTypes.includes(planType);
  const isBaseType = BASE_TYPES.includes(planType);

  useEffect(() => { setDrafts({}); }, [companyId, planMonth, planType]);

  const uomChoices = useMemo(() => {
    const units = new Set();
    rows.forEach((row) => (row.entry_uom_options ?? []).forEach((option) => units.add(option.uom_code)));
    return [...units];
  }, [rows]);

  function rowAllowsUom(row) {
    return (row.entry_uom_options ?? []).some((option) => option.uom_code === entryUom);
  }

  // Excel-style paste: a multi-line clipboard fills this row and the rows below it.
  function handlePaste(event, startIndex) {
    const text = event.clipboardData?.getData("text") ?? "";
    if (!text.includes("\n")) return;
    event.preventDefault();
    const values = text.replace(/\r/g, "").split("\n").filter((line, index, all) => index < all.length - 1 || line !== "");
    setDrafts((current) => {
      const next = { ...current };
      values.forEach((value, offset) => {
        const row = rows[startIndex + offset];
        if (row) next[row.sku_material_id] = value.split("\t")[0].trim().replace(/,/g, "");
      });
      return next;
    });
  }

  function qtyInput(row, index) {
    const disabled = !canWriteType || !rowAllowsUom(row);
    return (
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        title={!rowAllowsUom(row) ? `No verified ${entryUom} conversion for this SKU` : undefined}
        className={`h-7 w-28 border px-1.5 text-right font-mono text-xs outline-none ${disabled ? "border-slate-200 bg-slate-100 text-slate-400" : "border-sky-300 bg-sky-50 text-sky-900 focus:border-sky-600"}`}
        value={drafts[row.sku_material_id] ?? ""}
        onPaste={(event) => handlePaste(event, index)}
        onChange={(event) => setDrafts((current) => ({ ...current, [row.sku_material_id]: event.target.value }))}
      />
    );
  }

  const indexBySku = useMemo(() => new Map(rows.map((row, index) => [row.sku_material_id, index])), [rows]);
  const entrySum = (row) => (row.entries ?? []).reduce((sum, entry) => sum + Number(entry.base_qty ?? 0), 0);
  const currentBaseEntry = (row) => (row.entries ?? [])[0] ?? null;

  const columns = [
    { key: "sku_label", label: "SKU", width: "300px" },
    { key: "sku_external_code", label: "External Code", width: "130px", render: (r) => blankOr(r.sku_external_code) },
    { key: "prodshade_label", label: "Prodshade", width: "240px" },
    { key: "pack_code", label: "Pack", width: "70px", render: (r) => blankOr(r.pack_code) },
    { key: "base_uom_code", label: "Base UoM", width: "80px" },
    { key: "rolling", label: "Rolling", width: "100px", align: "right", render: (r) => fmtQty(r.effective?.rolling_qty), copyValue: (r) => r.effective?.rolling_qty ?? "", filterValue: (r) => fmtQty(r.effective?.rolling_qty) },
    { key: "final", label: "Final", width: "100px", align: "right", render: (r) => fmtQty(r.effective?.final_qty), copyValue: (r) => r.effective?.final_qty ?? "", filterValue: (r) => fmtQty(r.effective?.final_qty) },
    { key: "additional", label: "Additional", width: "100px", align: "right", render: (r) => fmtQty(r.effective?.additional_qty), copyValue: (r) => r.effective?.additional_qty ?? "", filterValue: (r) => fmtQty(r.effective?.additional_qty) },
    { key: "urgent_extra", label: "Urgent Extra", width: "100px", align: "right", render: (r) => fmtQty(r.effective?.urgent_extra_qty), copyValue: (r) => r.effective?.urgent_extra_qty ?? "", filterValue: (r) => fmtQty(r.effective?.urgent_extra_qty) },
    { key: "urgent_from_plan", label: "Urgent From Plan", width: "120px", align: "right", render: (r) => fmtQty(r.effective?.urgent_from_plan_qty), copyValue: (r) => r.effective?.urgent_from_plan_qty ?? "", filterValue: (r) => fmtQty(r.effective?.urgent_from_plan_qty) },
    {
      key: "effective", label: "Effective Plan", width: "120px", align: "right",
      render: (r) => <span className="font-semibold text-slate-900">{fmtQty(r.effective?.effective_qty)}</span>,
      copyValue: (r) => r.effective?.effective_qty ?? "", filterValue: (r) => fmtQty(r.effective?.effective_qty),
    },
    isBaseType
      ? {
          key: "current_type", label: `Current ${planType === "FINAL" ? "Final" : "Rolling"}`, width: "150px", align: "right",
          render: (r) => {
            const entry = currentBaseEntry(r);
            return entry ? `${fmtQty(entry.entered_qty)} ${entry.entered_uom_code}` : "";
          },
          copyValue: (r) => currentBaseEntry(r)?.entered_qty ?? "",
          filterValue: (r) => fmtQty(currentBaseEntry(r)?.entered_qty),
        }
      : {
          key: "current_type", label: `${planType === "URGENT" ? "Urgent" : "Additional"} Entries`, width: "150px", align: "right",
          render: (r) => ((r.entries ?? []).length ? `${(r.entries ?? []).length} · ${fmtQty(entrySum(r))} ${r.base_uom_code}` : ""),
          copyValue: (r) => entrySum(r),
          filterValue: (r) => String((r.entries ?? []).length),
        },
    {
      key: "new_qty", label: isBaseType ? `New ${planType === "FINAL" ? "Final" : "Rolling"} (${entryUom})` : `New Entry (${entryUom})`,
      width: "150px", align: "right", filterable: false,
      render: (r) => qtyInput(r, indexBySku.get(r.sku_material_id) ?? 0),
      copyValue: (r) => drafts[r.sku_material_id] ?? "",
    },
    {
      key: "history", label: "History", width: "90px", filterable: false,
      render: (r) => (
        <button type="button" onClick={() => setHistoryRow(r)} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">
          History
        </button>
      ),
    },
  ];

  async function handleSave() {
    const lines = [];
    for (const row of rows) {
      const raw = String(drafts[row.sku_material_id] ?? "").trim();
      if (!raw) continue;
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty < 0) {
        pushToast({ message: `Invalid quantity "${raw}" for ${row.sku_label}`, tone: "error" });
        return;
      }
      const line = { sku_material_id: row.sku_material_id, entered_qty: qty, remarks: remarks || null };
      if (planType === "URGENT") {
        line.urgent_mode = urgentMode;
        line.urgent_from_date = urgentFrom;
        line.urgent_to_date = urgentTo;
      }
      lines.push(line);
    }
    if (lines.length === 0) {
      pushToast({ message: "Enter at least one quantity.", tone: "error" });
      return;
    }
    if (planType === "URGENT" && (!urgentFrom || !urgentTo || urgentFrom > urgentTo)) {
      pushToast({ message: "Urgent needs a From and To date (From ≤ To).", tone: "error" });
      return;
    }
    setSaving(true);
    try {
      const payload = { company_id: companyId, plan_month: planMonth, plan_type: planType, entry_uom_code: entryUom, lines };
      const result = isBaseType ? await saveMtsPlanBaseLines(payload) : await saveMtsPlanAddonLines(payload);
      const saved = result?.result?.saved ?? 0;
      const unchanged = result?.result?.unchanged ?? 0;
      pushToast({ message: `Saved ${saved} line(s)${unchanged ? `, ${unchanged} unchanged` : ""}.`, tone: "success" });
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-plan"] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const draftCount = Object.values(drafts).filter((value) => String(value ?? "").trim() !== "").length;

  return (
    <ErpSectionCard eyebrow="Tab 1" title="Plan Entry — Rolling / Final / Additional / Urgent">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Plan Type</span>
          <select value={planType} onChange={(event) => setPlanType(event.target.value)} className={INPUT_CLASS}>
            {PLAN_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} disabled={!allowedTypes.includes(option.value)}>
                {option.label}{allowedTypes.includes(option.value) ? "" : " (no access)"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Input UoM</span>
          <select value={entryUom} onChange={(event) => setEntryUom(event.target.value)} className={INPUT_CLASS}>
            {(uomChoices.length ? uomChoices : ["KG"]).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </label>
        {planType === "URGENT" ? (
          <>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Urgent Type</span>
              <select value={urgentMode} onChange={(event) => setUrgentMode(event.target.value)} className={INPUT_CLASS}>
                {URGENT_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Required From</span>
              <input type="date" value={urgentFrom} onChange={(event) => setUrgentFrom(event.target.value)} className={INPUT_CLASS} />
            </label>
            <label className="grid gap-1 text-sm text-slate-700">
              <span className="font-medium text-slate-800">Required To</span>
              <input type="date" value={urgentTo} onChange={(event) => setUrgentTo(event.target.value)} className={INPUT_CLASS} />
            </label>
          </>
        ) : null}
        <label className="grid min-w-[220px] flex-1 gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Remarks (optional)</span>
          <input value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={500} className={INPUT_CLASS} />
        </label>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canWriteType || saving || draftCount === 0}
          className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : `Save ${draftCount || ""}`.trim()}
        </button>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Effective Plan = Final if entered, else Rolling, plus Additional and Urgent Extra. Urgent From Plan only re-phases existing plan
        quantity and never adds to it. Every save is versioned; nothing is overwritten. Paste a column from Excel into the first
        input to fill the rows below it.
        {!canWriteType ? " You can view this plan type but not enter it." : ""}
      </p>
      {(gridQ.data?.ambiguous_skus ?? []).length > 0 ? (
        <p className="mb-2 text-xs text-amber-700">
          {(gridQ.data?.ambiguous_skus ?? []).length} Prodshade/pack combination(s) match more than one SKU by name and are not listed — fix the material names in master data.
        </p>
      ) : null}
      <ErpDenseGrid
        {...GRID_PROPS}
        virtualize
        columns={columns}
        rows={rows}
        rowKey={(row) => row.sku_material_id}
        emptyMessage={gridQ.isLoading ? "Loading..." : gridQ.error ? errorText(gridQ.error) : "No MTS SKUs found for this company."}
        maxHeight="calc(100vh - 360px)"
      />
      <HistoryDrawer
        row={historyRow}
        companyId={companyId}
        planMonth={planMonth}
        allowedTypes={allowedTypes}
        onClose={() => setHistoryRow(null)}
      />
    </ErpSectionCard>
  );
}

function HistoryDrawer({ row, companyId, planMonth, allowedTypes, onClose }) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState("");
  const historyQ = useQuery({
    queryKey: ["procurement", "mts-plan", "history", companyId, planMonth, row?.sku_material_id ?? ""],
    queryFn: () => getMtsPlanHistory({ company_id: companyId, plan_month: planMonth, sku_material_id: row.sku_material_id }),
    enabled: Boolean(row),
  });
  const historyRows = historyQ.data?.rows ?? [];

  async function cancelEntry(entry) {
    setCancelling(entry.entry_id);
    try {
      const payload = {
        company_id: companyId,
        plan_month: planMonth,
        plan_type: entry.plan_type,
        entry_uom_code: entry.entered_uom_code,
        lines: [{ entry_id: entry.entry_id, sku_material_id: row.sku_material_id, cancel: true }],
      };
      if (BASE_TYPES.includes(entry.plan_type)) await saveMtsPlanBaseLines(payload);
      else await saveMtsPlanAddonLines(payload);
      pushToast({ message: "Entry cancelled (kept in history).", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-plan"] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setCancelling("");
    }
  }

  const columns = [
    { key: "entered_at", label: "Entered At", width: "160px", render: (r) => new Date(r.entered_at).toLocaleString(), filterValue: (r) => String(r.entered_at).slice(0, 10) },
    { key: "entered_by", label: "Entered By", width: "180px" },
    { key: "plan_type", label: "Type", width: "100px" },
    { key: "urgent", label: "Urgent", width: "220px", render: (r) => (r.urgent_mode ? `${r.urgent_mode === "FROM_PLAN" ? "From Plan" : "Extra"} · ${r.urgent_from_date} → ${r.urgent_to_date}` : "") },
    { key: "version_no", label: "Ver", width: "50px", align: "right" },
    { key: "entered", label: "Entered", width: "120px", align: "right", render: (r) => `${fmtQty(r.entered_qty)} ${r.entered_uom_code}`, copyValue: (r) => r.entered_qty },
    { key: "base", label: "Base Qty", width: "120px", align: "right", render: (r) => `${fmtQty(r.base_qty)} ${r.base_uom_code}`, copyValue: (r) => r.base_qty },
    { key: "status", label: "Status", width: "110px", render: (r) => (r.is_cancelled ? "Cancelled" : r.is_current ? "Current" : "Superseded") },
    { key: "source_system", label: "Source", width: "130px" },
    { key: "remarks", label: "Remarks", width: "200px", render: (r) => blankOr(r.remarks) },
    {
      key: "action", label: "", width: "90px", filterable: false,
      render: (r) => (r.is_current && !r.is_cancelled && allowedTypes.includes(r.plan_type) ? (
        <button
          type="button"
          disabled={cancelling === r.entry_id}
          onClick={() => void cancelEntry(r)}
          className="h-6 border border-rose-300 bg-rose-50 px-2 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          Cancel
        </button>
      ) : null),
    },
  ];

  return (
    <DrawerBase
      visible={Boolean(row)}
      title={row ? `History — ${row.sku_label} — ${monthLabel(`${planMonth}-01`)}` : ""}
      onClose={onClose}
      side="center"
      width="min(1300px, calc(100vw - 24px))"
    >
      <ErpDenseGrid
        {...GRID_PROPS}
        columns={columns}
        rows={historyRows}
        rowKey={(r) => r.id}
        emptyMessage={historyQ.isLoading ? "Loading..." : "No entries for this SKU and month."}
        maxHeight="60vh"
      />
    </DrawerBase>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2 — Stroke & RM Primary
// ─────────────────────────────────────────────────────────────────────────────
function StrokeTab({ companyId, planMonth, access }) {
  const [editing, setEditing] = useState(null);
  const strokeQ = useQuery({
    queryKey: ["procurement", "mts-plan", "stroke-settings", companyId, planMonth],
    queryFn: () => getMtsPlanStrokeSettings({ company_id: companyId, plan_month: planMonth }),
    enabled: Boolean(companyId && planMonth),
  });
  const prodshades = strokeQ.data?.prodshades ?? [];
  const strokeNumberById = (prodshade, id) => prodshade.strokes.find((s) => s.stroke_master_id === id)?.stroke_number ?? "—";

  function periodSummary(prodshade) {
    if (!prodshade.setting) return `Default: ${prodshade.current_stroke_number ?? "no current stroke"} (whole month)`;
    return (prodshade.setting.periods ?? [])
      .map((p) => `${strokeNumberById(prodshade, p.stroke_master_id)}: ${p.period_from.slice(8)}–${p.period_to.slice(8)}${p.planned_base_qty != null ? ` (${fmtQty(p.planned_base_qty)})` : ""}`)
      .join(" | ");
  }
  function primarySummary(prodshade) {
    const groups = prodshade.strokes.flatMap((s) => s.rm_groups);
    const off = groups.filter((g) => g.use_primary === false).length;
    return groups.length === 0 ? "No RM groups" : `${groups.length} group(s), ${off} with Use Primary = No`;
  }

  const columns = [
    { key: "prodshade_label", label: "Prodshade", width: "300px" },
    { key: "current_stroke_number", label: "Current Stroke", width: "120px", render: (r) => blankOr(r.current_stroke_number) },
    { key: "strokes", label: "Approved Strokes", width: "160px", render: (r) => r.strokes.map((s) => s.stroke_number).join(", "), filterValue: (r) => r.strokes.map((s) => s.stroke_number).join(", ") },
    { key: "periods", label: "Planning Stroke Periods", width: "360px", render: periodSummary, copyValue: periodSummary, filterValue: periodSummary },
    { key: "primary", label: "RM Use Primary", width: "220px", render: primarySummary, copyValue: primarySummary, filterValue: primarySummary },
    { key: "version", label: "Version", width: "80px", align: "right", render: (r) => (r.setting ? r.setting.version_no : "Default"), filterValue: (r) => (r.setting ? String(r.setting.version_no) : "Default") },
    { key: "saved_by", label: "Saved By", width: "180px", render: (r) => blankOr(r.setting?.saved_by) },
    {
      key: "edit", label: "", width: "80px", filterable: false,
      render: (r) => (
        <button type="button" onClick={() => setEditing(r)} className="h-6 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">
          {access?.can_maintain ? "Edit" : "View"}
        </button>
      ),
    },
  ];

  return (
    <ErpSectionCard eyebrow="Tab 2" title="Stroke Periods & RM Group Use Primary (planning assumption only)">
      <p className="mb-2 text-xs text-slate-500">
        Default is each Prodshade&apos;s current MTS stroke for the whole month with Use Primary = Yes for every RM group. Changes here are
        planning assumptions only — Stroke Master and production are not changed. PM groups have no Use Primary setting.
      </p>
      <ErpDenseGrid
        {...GRID_PROPS}
        columns={columns}
        rows={prodshades}
        rowKey={(r) => r.prodshade_material_id}
        onRowActivate={setEditing}
        emptyMessage={strokeQ.isLoading ? "Loading..." : strokeQ.error ? errorText(strokeQ.error) : "No MTS Prodshades for this company."}
        maxHeight="calc(100vh - 340px)"
      />
      {editing ? (
        <StrokeEditor
          key={`${editing.prodshade_material_id}-${planMonth}`}
          prodshade={editing}
          companyId={companyId}
          planMonth={planMonth}
          canEdit={Boolean(access?.can_maintain)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </ErpSectionCard>
  );
}

function monthBounds(planMonth) {
  const [year, month] = planMonth.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return { first: `${planMonth}-01`, last: `${planMonth}-${String(last).padStart(2, "0")}` };
}

function StrokeEditor({ prodshade, companyId, planMonth, canEdit, onClose }) {
  const queryClient = useQueryClient();
  const bounds = monthBounds(planMonth);
  const initialPeriods = prodshade.setting?.periods?.length
    ? prodshade.setting.periods.map((p, index) => ({ id: index, ...p, planned_base_qty: p.planned_base_qty ?? "" }))
    : [{ id: 0, stroke_master_id: prodshade.current_stroke_master_id ?? "", period_from: bounds.first, period_to: bounds.last, planned_base_qty: "" }];
  const [periods, setPeriods] = useState(initialPeriods);
  const [primaryDraft, setPrimaryDraft] = useState(() => {
    const map = {};
    prodshade.strokes.forEach((s) => s.rm_groups.forEach((g) => { map[`${s.stroke_master_id}|${g.material_group_id}`] = g.use_primary !== false; }));
    return map;
  });
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const usedStrokeIds = [...new Set(periods.map((p) => p.stroke_master_id).filter(Boolean))];
  const groupRows = prodshade.strokes
    .filter((s) => usedStrokeIds.includes(s.stroke_master_id))
    .flatMap((s) => s.rm_groups.map((g) => ({ ...g, stroke_master_id: s.stroke_master_id, stroke_number: s.stroke_number, key: `${s.stroke_master_id}|${g.material_group_id}` })));

  function updatePeriod(id, field, value) {
    setPeriods((current) => current.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  const periodColumns = [
    {
      key: "stroke", label: "Stroke", width: "200px", filterable: false,
      render: (p) => (
        <select disabled={!canEdit} value={p.stroke_master_id} onChange={(e) => updatePeriod(p.id, "stroke_master_id", e.target.value)} className="h-7 w-full border border-slate-300 px-1 text-xs">
          <option value="">Select stroke</option>
          {prodshade.strokes.map((s) => <option key={s.stroke_master_id} value={s.stroke_master_id}>{s.stroke_number}{s.stroke_master_id === prodshade.current_stroke_master_id ? " (current)" : ""}</option>)}
        </select>
      ),
    },
    { key: "from", label: "From", width: "150px", filterable: false, render: (p) => <input type="date" disabled={!canEdit} min={bounds.first} max={bounds.last} value={p.period_from} onChange={(e) => updatePeriod(p.id, "period_from", e.target.value)} className="h-7 border border-slate-300 px-1 text-xs" /> },
    { key: "to", label: "To", width: "150px", filterable: false, render: (p) => <input type="date" disabled={!canEdit} min={bounds.first} max={bounds.last} value={p.period_to} onChange={(e) => updatePeriod(p.id, "period_to", e.target.value)} className="h-7 border border-slate-300 px-1 text-xs" /> },
    { key: "qty", label: "Qty Override (blank = pro-rata)", width: "200px", filterable: false, render: (p) => <input type="text" inputMode="decimal" disabled={!canEdit} value={p.planned_base_qty} onChange={(e) => updatePeriod(p.id, "planned_base_qty", e.target.value)} className="h-7 w-32 border border-slate-300 px-1 text-right text-xs" /> },
    {
      key: "remove", label: "", width: "80px", filterable: false,
      render: (p) => (canEdit && periods.length > 1 ? (
        <button type="button" onClick={() => setPeriods((current) => current.filter((x) => x.id !== p.id))} className="h-6 border border-rose-300 bg-rose-50 px-2 text-xs text-rose-700">Remove</button>
      ) : null),
    },
  ];

  const groupColumns = [
    { key: "stroke_number", label: "Stroke", width: "100px" },
    { key: "group_label", label: "RM Group", width: "220px" },
    { key: "primary_material_label", label: "Primary (Stroke line material)", width: "260px" },
    { key: "member_labels", label: "Other Group Members", width: "320px", render: (g) => g.member_labels.join("; ") || "—", filterValue: (g) => g.member_labels.join("; ") },
    {
      key: "use_primary", label: "Use Primary", width: "110px", filterable: false,
      render: (g) => (
        <select disabled={!canEdit} value={primaryDraft[g.key] === false ? "NO" : "YES"} onChange={(e) => setPrimaryDraft((current) => ({ ...current, [g.key]: e.target.value === "YES" }))} className="h-7 border border-slate-300 px-1 text-xs">
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </select>
      ),
      copyValue: (g) => (primaryDraft[g.key] === false ? "No" : "Yes"),
    },
  ];

  async function handleSave() {
    if (periods.some((p) => !p.stroke_master_id || !p.period_from || !p.period_to || p.period_from > p.period_to)) {
      pushToast({ message: "Every period needs a stroke and a From ≤ To date.", tone: "error" });
      return;
    }
    setSaving(true);
    try {
      await saveMtsPlanStrokeSetting({
        company_id: companyId,
        plan_month: planMonth,
        prodshade_material_id: prodshade.prodshade_material_id,
        periods: periods.map((p) => ({
          stroke_master_id: p.stroke_master_id,
          period_from: p.period_from,
          period_to: p.period_to,
          planned_base_qty: String(p.planned_base_qty ?? "").trim() === "" ? null : Number(p.planned_base_qty),
        })),
        primaries: groupRows.map((g) => ({ stroke_master_id: g.stroke_master_id, material_group_id: g.material_group_id, use_primary: primaryDraft[g.key] !== false })),
        remarks: remarks || null,
      });
      pushToast({ message: "Stroke setting saved as a new version.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-plan", "stroke-settings"] });
      onClose();
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DrawerBase
      visible
      title={`${prodshade.prodshade_label} — ${monthLabel(`${planMonth}-01`)}`}
      onClose={onClose}
      side="center"
      width="min(1200px, calc(100vw - 24px))"
      actions={canEdit ? (
        <>
          <button type="button" onClick={() => setPeriods((current) => [...current, { id: Date.now(), stroke_master_id: "", period_from: bounds.first, period_to: bounds.last, planned_base_qty: "" }])} className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700">
            Add Period
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving} className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </>
      ) : null}
    >
      <div className="grid gap-3">
        <p className="text-xs text-slate-500">Periods may not overlap and must stay inside the month. Days not covered by a period have no planning stroke.</p>
        <ErpDenseGrid {...GRID_PROPS} columns={periodColumns} rows={periods} rowKey={(p) => String(p.id)} emptyMessage="Add a period." maxHeight="30vh" />
        <ErpDenseGrid {...GRID_PROPS} columns={groupColumns} rows={groupRows} rowKey={(g) => g.key} emptyMessage="The selected stroke(s) have no RM material groups." maxHeight="35vh" />
        {canEdit ? (
          <label className="grid gap-1 text-sm text-slate-700">
            <span className="font-medium text-slate-800">Remarks (optional)</span>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} className={INPUT_CLASS} />
          </label>
        ) : null}
      </div>
    </DrawerBase>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3 — Plan Report
// ─────────────────────────────────────────────────────────────────────────────
function ReportTab({ companyId }) {
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => {
    const list = [];
    for (let y = 2024; y <= thisYear + 1; y += 1) list.push(y);
    return list;
  }, [thisYear]);
  const [monthsByYear, setMonthsByYear] = useState(() => ({ [thisYear]: [new Date().getMonth() + 1] }));
  const [executed, setExecuted] = useState("");
  const [showProduction, setShowProduction] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);

  const selectedMonths = useMemo(() => Object.entries(monthsByYear)
    .flatMap(([year, months]) => months.map((m) => `${year}-${String(m).padStart(2, "0")}`))
    .sort(), [monthsByYear]);

  function toggleYear(year) {
    setMonthsByYear((current) => {
      const next = { ...current };
      if (next[year]) delete next[year];
      else next[year] = [];
      return next;
    });
  }
  function toggleMonth(year, month) {
    setMonthsByYear((current) => {
      const list = current[year] ?? [];
      return { ...current, [year]: list.includes(month) ? list.filter((m) => m !== month) : [...list, month] };
    });
  }

  const reportQ = useQuery({
    queryKey: ["procurement", "mts-plan", "report", companyId, executed],
    queryFn: () => getMtsPlanReport({ company_id: companyId, months: executed }),
    enabled: Boolean(companyId && executed),
  });
  const report = reportQ.data;
  const months = report?.months ?? [];
  const productionAvailable = report?.production?.available === true;
  const dispatchAvailable = report?.dispatch?.available === true;

  // One PLAN row per SKU. Production / Dispatch rows would be inserted under
  // each PLAN row once their sources exist; today both are unavailable.
  const gridRows = useMemo(() => {
    const result = [];
    for (const row of report?.rows ?? []) {
      result.push({ ...row, row_type: "PLAN", row_key: `${row.sku_material_id}|PLAN` });
    }
    return result;
  }, [report]);

  const fixedColumns = [
    { key: "sku_label", label: "SKU", width: "300px" },
    { key: "sku_external_code", label: "External Code", width: "130px", render: (r) => blankOr(r.sku_external_code) },
    { key: "prodshade_label", label: "Prodshade", width: "240px" },
    { key: "pack_code", label: "Pack", width: "70px", render: (r) => blankOr(r.pack_code) },
    { key: "base_uom_code", label: "UoM", width: "70px" },
    { key: "row_type", label: "Type", width: "80px" },
  ];
  const monthColumns = months.map((month) => ({
    key: `m_${month}`,
    label: monthLabel(month),
    width: "110px",
    align: "right",
    render: (r) => {
      const cell = r.plan?.[month];
      if (!cell || cell.qty === null) return "";
      return (
        <span title={`${cell.base_source ?? "No Rolling/Final"}${cell.legacy ? " · historical Google Sheet source" : ""}`} className={cell.legacy ? "text-indigo-700" : ""}>
          {fmtQty(cell.qty)}
        </span>
      );
    },
    copyValue: (r) => r.plan?.[month]?.qty ?? "",
    filterValue: (r) => fmtQty(r.plan?.[month]?.qty),
  }));
  const columns = [...fixedColumns, ...monthColumns];

  async function exportExcel() {
    try {
      const { downloadColoredExcelFile } = await import("../../../../shared/downloadColoredExcelFile.js");
      await downloadColoredExcelFile({
        fileName: `mts_customer_plan_${months[0] ?? ""}_${months[months.length - 1] ?? ""}.xlsx`,
        sheetName: "Plan Report",
        columns: columns.map((c) => ({ key: c.key, label: c.label, width: c.width, align: c.align, numFmt: c.key.startsWith("m_") ? "#,##0.###" : undefined })),
        rows: gridRows,
        getCellValue: (row, column) => {
          if (column.key.startsWith("m_")) {
            const qty = row.plan?.[column.key.slice(2)]?.qty;
            return qty === null || qty === undefined ? "" : Number(qty);
          }
          return row[column.key] ?? "";
        },
      });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    }
  }

  return (
    <ErpSectionCard eyebrow="Tab 3" title="Plan Report">
      <div className="mb-3 grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-800">Years:</span>
          {years.map((year) => (
            <label key={year} className="flex items-center gap-1">
              <input type="checkbox" checked={Boolean(monthsByYear[year])} onChange={() => toggleYear(year)} />
              {year}
            </label>
          ))}
        </div>
        {Object.keys(monthsByYear).sort().map((year) => (
          <div key={year} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-12 font-medium text-slate-700">{year}</span>
            {MONTH_LABELS.map((label, index) => (
              <label key={label} className="flex items-center gap-1">
                <input type="checkbox" checked={(monthsByYear[year] ?? []).includes(index + 1)} onChange={() => toggleMonth(year, index + 1)} />
                {label}
              </label>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            disabled={selectedMonths.length === 0}
            onClick={() => setExecuted(selectedMonths.join(","))}
            className="h-8 border border-sky-600 bg-sky-600 px-4 font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            Show Report ({selectedMonths.length} month{selectedMonths.length === 1 ? "" : "s"})
          </button>
          <label className="flex items-center gap-1" title={report?.production?.reason ?? "Production source not yet designed"}>
            <input type="checkbox" disabled={!productionAvailable} checked={showProduction && productionAvailable} onChange={(e) => setShowProduction(e.target.checked)} />
            Show Production {productionAvailable ? "" : "(not available yet)"}
          </label>
          <label className="flex items-center gap-1" title={report?.dispatch?.reason ?? "Dispatch source not yet designed"}>
            <input type="checkbox" disabled={!dispatchAvailable} checked={showDispatch && dispatchAvailable} onChange={(e) => setShowDispatch(e.target.checked)} />
            Show Dispatch {dispatchAvailable ? "" : "(not available yet)"}
          </label>
          <button
            type="button"
            disabled={gridRows.length === 0}
            onClick={() => void exportExcel()}
            className="h-8 border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Export Excel
          </button>
        </div>
        <p className="text-xs text-slate-500">
          PLAN = effective plan (Final, else Rolling, plus Additional and Urgent Extra). Blank = no plan entered. Blue figures come from the
          historical Google Sheet import (not loaded yet). Production and Dispatch rows will appear once their sources are designed.
        </p>
      </div>
      <ErpDenseGrid
        {...GRID_PROPS}
        rangeSelect
        virtualize
        columns={columns}
        rows={gridRows}
        rowKey={(r) => r.row_key}
        emptyMessage={!executed ? "Select months and press Show Report." : reportQ.isLoading ? "Loading..." : reportQ.error ? errorText(reportQ.error) : "No SKUs."}
        maxHeight="calc(100vh - 420px)"
      />
    </ErpSectionCard>
  );
}
