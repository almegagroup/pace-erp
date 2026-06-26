import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpColumnVisibilityDrawer from "../../../../components/ErpColumnVisibilityDrawer.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ModalBase from "../../../../components/layer/ModalBase.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  confirmCSNDispatchQty,
  createCSNTrackerLayout,
  deleteCSNTrackerLayout,
  getAllAlertCounts,
  getCSNFieldHistory,
  getCSNTracker,
  listCSNTrackerLayouts,
  listPorts,
  listTransporters,
  previewCSNDispatchQty,
  updateCSN,
} from "../procurementApi.js";

const LIMIT = 50;
const STATUS_OPTIONS = ["ORD", "TRN", "GED", "GRD", "CAN", "KOF"];
const STATUS_LABELS = {
  ORD: "Ordered",
  TRN: "In Transit",
  GED: "GE Done",
  GRD: "GRN Done",
  CAN: "Cancelled",
  KOF: "Knocked Off",
};
const YES_NO_OPTIONS = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
];
const TRACKER_FIELDS = [
  "dispatch_qty",
  "material_category_id",
  "indent_required",
  "vendor_indent_number",
  "scheduled_eta_to_port",
  "etd",
  "etd_is_manual_override",
  "bl_number",
  "bl_date",
  "invoice_number",
  "invoice_date",
  "boe_number",
  "boe_date",
  "eta_at_port",
  "eta_at_port_is_manual_override",
  "ata_at_port",
  "transporter_id",
  "transporter_name_freetext",
  "lr_date",
  "lr_number",
  "gate_entry_id",
  "gate_entry_date",
  "grn_id",
  "grn_date",
  "lc_number",
  "lc_opened_date",
  "soft_copy_received",
  "hard_copy_received",
  "hard_copy_courier_number",
  "courier_dispatch_date",
  "courier_received_date",
  "courier_date_to_cha",
  "courier_cha_receive_date",
  "cha_docket_number",
  "consignee_company_id",
  "port_of_discharge_id",
  "vessel_name",
  "voyage_number",
  "post_clearance_lr_date",
  "lr_number_port_to_plant",
  "vehicle_number_port_to_plant",
  "vehicle_number",
  "domestic_transporter_id",
  "domestic_transporter_freetext",
  "remarks",
  "received_qty",
  "transit_days_snapshot",
];

function toText(value) {
  return String(value ?? "").trim();
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function diffDays(left, right) {
  if (!left || !right) {
    return null;
  }
  const leftDate = new Date(`${left}T00:00:00.000Z`);
  const rightDate = new Date(`${right}T00:00:00.000Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000);
}

function formatDiff(diff) {
  if (diff == null) {
    return "—";
  }
  return diff > 0 ? `+${diff}` : String(diff);
}

function formatBool(value) {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return "—";
}

function getStatusLabel(value) {
  return STATUS_LABELS[String(value || "").toUpperCase()] || value || "—";
}

function getBadgeTone(value) {
  switch (String(value || "").toUpperCase()) {
    case "IMPORT":
      return "bg-sky-100 text-sky-800";
    case "DOMESTIC":
      return "bg-emerald-100 text-emerald-800";
    case "BULK":
      return "bg-violet-100 text-violet-800";
    case "GED":
      return "bg-[#FAC775] text-[#412402]";
    case "GRD":
      return "bg-[#97C459] text-[#173404]";
    case "CAN":
      return "bg-[#E24B4A] text-[#FCEBEB]";
    case "KOF":
      return "bg-[#5F5E5A] text-[#F1EFE8]";
    case "TRN":
      return "bg-[#B5D4F4] text-[#042C53]";
    case "ORD":
      return "bg-[#F1EFE8] text-[#2C2C2A]";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function toneForDiff(diff) {
  if (diff == null || diff === 0) {
    return "text-slate-600";
  }
  return diff > 0 ? "text-rose-700" : "text-sky-700";
}

function buildDraft(row) {
  return TRACKER_FIELDS.reduce((acc, field) => {
    acc[field] = row?.[field] ?? (field.endsWith("_received") || field.endsWith("_override") ? false : "");
    return acc;
  }, {});
}

function normalizePayload(draft) {
  const payload = {};
  for (const [key, value] of Object.entries(draft)) {
    if (typeof value === "boolean") {
      payload[key] = value;
    } else if (value === "") {
      payload[key] = null;
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

function buildColumnDefs() {
  return [
    { key: "expand", label: "", width: "48px" },
    { key: "csn_display_number", label: "CSN", width: "140px" },
    { key: "display_reference_number", label: "Reference", width: "120px" },
    { key: "status", label: "Status", width: "110px" },
    { key: "csn_type", label: "Type", width: "100px" },
    { key: "company_label", label: "Company", width: "180px" },
    { key: "consignee_company_label", label: "Allotted Company", width: "180px" },
    { key: "vendor_name", label: "Vendor", width: "180px" },
    { key: "material_name", label: "Material", width: "180px" },
    { key: "material_group_name", label: "Material Group", width: "150px" },
    { key: "po_qty", label: "Order Qty", width: "110px" },
    { key: "dispatch_qty", label: "Dispatch Qty", width: "110px" },
    { key: "po_uom_code", label: "UOM", width: "80px" },
    { key: "indent_required", label: "Indent?", width: "90px" },
    { key: "vendor_indent_number", label: "Indent Number", width: "140px" },
    { key: "scheduled_eta_to_port", label: "Scheduled ETA Port", width: "140px" },
    { key: "etd", label: "ETD", width: "120px" },
    { key: "atd", label: "ATD", width: "120px" },
    { key: "bl_number", label: "BL Number", width: "130px" },
    { key: "bl_date", label: "BL Date", width: "120px" },
    { key: "invoice_number", label: "Invoice Number", width: "140px" },
    { key: "invoice_date", label: "Invoice Date", width: "120px" },
    { key: "boe_number", label: "BOE Number", width: "130px" },
    { key: "boe_date", label: "BOE Date", width: "120px" },
    { key: "eta_at_port", label: "ETA Port", width: "120px" },
    { key: "ata_at_port", label: "ATA Port", width: "120px" },
    { key: "transporter_name", label: "Transporter", width: "160px" },
    { key: "lr_date", label: "LR Date", width: "120px" },
    { key: "lr_number", label: "LR Number", width: "130px" },
    { key: "eta_to_plant_calculated", label: "ETA Plant", width: "120px" },
    { key: "gate_entry_number", label: "GE Number", width: "120px" },
    { key: "gate_entry_date", label: "GE Date", width: "120px" },
    { key: "grn_number", label: "GRN Number", width: "130px" },
    { key: "grn_date", label: "GRN Date", width: "120px" },
    { key: "lc_number", label: "LC Number", width: "120px" },
    { key: "lc_opened_date", label: "LC Opened", width: "120px" },
    { key: "actual_payment_date", label: "Actual Payment Date", width: "150px" },
    { key: "soft_copy_received", label: "Soft Copy", width: "110px" },
    { key: "hard_copy_received", label: "Hard Copy", width: "110px" },
    { key: "etd_vs_atd_days", label: "ETD vs ATD", width: "110px" },
    { key: "eta_vs_ata_days", label: "ETA vs ATA", width: "110px" },
    { key: "baseline_vs_actual_days", label: "Baseline vs Actual", width: "130px" },
    { key: "lr_vs_ge_days", label: "LR vs GE", width: "100px" },
    { key: "created_by_display", label: "Created By", width: "170px" },
    { key: "created_at", label: "Created At", width: "160px" },
    { key: "remarks", label: "Remarks", width: "220px" },
  ];
}

function computeDerived(row) {
  const atd = row.csn_type === "IMPORT" ? row.bl_date : row.lr_date;
  const etdVsAtd = diffDays(atd, row.etd);
  const etaVsAta = diffDays(row.ata_at_port, row.eta_at_port);
  const baselineVsActual = row.csn_type === "DOMESTIC"
    ? diffDays(row.lr_date, row.expected_delivery_date)
    : diffDays(row.ata_at_port, row.scheduled_eta_to_port);
  const lrVsGe = diffDays(row.gate_entry_date, row.lr_date);
  return {
    atd,
    etd_vs_atd_days: etdVsAtd,
    eta_vs_ata_days: etaVsAta,
    baseline_vs_actual_days: baselineVsActual,
    lr_vs_ge_days: lrVsGe,
    gate_entry_number: row.ge_number || row.gate_entry_id || "—",
    grn_number: row.grn_number || row.grn_id || "—",
  };
}

function evaluateRedFields(row) {
  const today = todayIso();
  const derived = computeDerived(row);
  const red = new Set();
  const etd = toText(row.etd);
  const atd = toText(derived.atd);
  const eta = toText(row.eta_at_port);
  const ata = toText(row.ata_at_port);
  const geMissing = !toText(row.gate_entry_date) && !toText(row.ge_number) && !toText(row.gate_entry_id);
  const importClearanceAnchor = row.import_clearance_days != null && ata
    ? addDays(ata, Number(row.import_clearance_days))
    : "";

  const mark = (fields, condition) => {
    if (condition) {
      fields.forEach((field) => red.add(field));
    }
  };

  mark(["etd", "atd"], etd && today > etd && !atd);
  mark(["bl_number"], row.csn_type === "IMPORT" && toText(row.bl_date) && !toText(row.bl_number));
  mark(["bl_date"], row.csn_type === "IMPORT" && toText(row.bl_number) && !toText(row.bl_date));
  mark(
    ["invoice_number", "invoice_date"],
    row.csn_type === "IMPORT"
      ? ((toText(row.bl_number) && toText(row.bl_date)) || toText(row.bl_date)) &&
          (!toText(row.invoice_number) || !toText(row.invoice_date))
      : toText(row.lr_date) && (!toText(row.invoice_number) || !toText(row.invoice_date))
  );
  mark(["eta_at_port", "ata_at_port"], row.csn_type === "IMPORT" && eta && today > eta && !ata);
  mark(["boe_number", "boe_date"], row.csn_type === "IMPORT" && ata && (!toText(row.boe_number) || !toText(row.boe_date)));
  mark(
    ["transporter_id", "lr_number", "lr_date"],
    row.csn_type === "IMPORT" && importClearanceAnchor && today > importClearanceAnchor &&
      (!toText(row.transporter_id || row.transporter_name_freetext) || !toText(row.lr_number) || !toText(row.lr_date))
  );
  mark(["soft_copy_received"], atd && today >= addDays(atd, 3) && row.soft_copy_received !== true);
  mark(["hard_copy_received"], atd && today >= addDays(atd, 7) && row.hard_copy_received !== true);
  mark(["eta_to_plant_calculated"], toText(row.eta_to_plant_calculated) && today > toText(row.eta_to_plant_calculated) && geMissing);
  return red;
}

function FieldHistoryButton({ rowId, fieldName, activeKey, histories, loadingHistoryKey, onToggle }) {
  const key = `${rowId}:${fieldName}`;
  const isOpen = activeKey === key;
  const history = histories[key] || [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onToggle(key, rowId, fieldName)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold text-slate-500"
      >
        i
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-20 mt-2 w-80 border border-slate-300 bg-white p-3 text-[11px] shadow-xl">
          <div className="mb-2 font-semibold text-slate-700">Field History</div>
          {loadingHistoryKey === key ? (
            <div className="text-slate-500">Loading…</div>
          ) : history.length > 0 ? (
            <div className="grid gap-2">
              {history.map((entry) => (
                <div key={entry.id} className="border border-slate-200 bg-slate-50 px-2 py-1">
                  <div className="text-slate-800">
                    {(entry.old_value || "—")} → {(entry.new_value || "—")}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {entry.changed_by_display || entry.changed_by || "—"} · {entry.changed_at || "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500">No history yet.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EditField({ label, children, rowId, fieldName, activeHistoryKey, histories, loadingHistoryKey, onToggleHistory }) {
  return (
    <label className="grid gap-1 text-[11px] font-medium text-slate-600">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <FieldHistoryButton
          rowId={rowId}
          fieldName={fieldName}
          activeKey={activeHistoryKey}
          histories={histories}
          loadingHistoryKey={loadingHistoryKey}
          onToggle={onToggleHistory}
        />
      </span>
      {children}
    </label>
  );
}

export default function CSNTrackerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [csnType, setCsnType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [expandedRowId, setExpandedRowId] = useState("");
  const [draft, setDraft] = useState(null);
  const [savingRowId, setSavingRowId] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => buildColumnDefs().map((column) => column.key));
  const [layoutDraft, setLayoutDraft] = useState({ name: "", scope: "USER" });
  const [showSaveLayout, setShowSaveLayout] = useState(false);
  const [selectedLayoutId, setSelectedLayoutId] = useState("");
  const [dispatchDialog, setDispatchDialog] = useState(null);
  const [activeHistoryKey, setActiveHistoryKey] = useState("");
  const [histories, setHistories] = useState({});
  const [loadingHistoryKey, setLoadingHistoryKey] = useState("");

  const columns = useMemo(() => buildColumnDefs(), []);
  const companyOptions = useMemo(
    () =>
      (runtimeContext?.availableCompanies ?? []).map((entry) => ({
        value: entry.id,
        label: entry.company_name || entry.company_code || entry.id,
      })),
    [runtimeContext?.availableCompanies]
  );

  useEffect(() => {
    if (!companyId) {
      setCompanyId(runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "");
    }
  }, [companyId, companyOptions, runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const trackerQuery = useQuery({
    queryKey: ["csn-tracker", companyId, status, csnType, dateFrom, dateTo, page],
    enabled: Boolean(companyId),
    queryFn: () =>
      getCSNTracker({
        company_id: companyId,
        status: status || undefined,
        csn_type: csnType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: LIMIT,
        offset: (page - 1) * LIMIT,
      }),
  });

  const alertsQuery = useQuery({
    queryKey: ["csn-alert-counts", companyId],
    enabled: Boolean(companyId),
    queryFn: () => getAllAlertCounts({ company_id: companyId }),
  });

  const layoutsQuery = useQuery({
    queryKey: ["csn-tracker-layouts"],
    queryFn: () => listCSNTrackerLayouts(),
  });

  const transportersQuery = useQuery({
    queryKey: ["csn-transporters"],
    queryFn: () => listTransporters({ is_active: "true", limit: 500 }),
  });

  const dischargePortsQuery = useQuery({
    queryKey: ["csn-discharge-ports"],
    queryFn: () => listPorts({ is_active: "true", port_role: "DISCHARGE" }),
  });

  const companiesQuery = useQuery({
    queryKey: ["csn-procurement-companies"],
    queryFn: async () => {
      const result = await fetch(`${import.meta.env.VITE_API_BASE}/api/procurement/companies`, { credentials: "include" });
      const json = await result.json();
      return json?.data?.data || [];
    },
  });

  const rows = useMemo(() => {
    const baseRows = Array.isArray(trackerQuery.data?.data) ? trackerQuery.data.data : [];
    return baseRows.map((row) => ({ ...row, ...computeDerived(row) }));
  }, [trackerQuery.data]);

  const filteredRows = useMemo(() => {
    if (!debouncedSearch) {
      return rows;
    }
    return rows.filter((row) =>
      [
        row.csn_display_number,
        row.display_reference_number,
        row.vendor_name,
        row.material_name,
        row.material_group_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(debouncedSearch)
    );
  }, [debouncedSearch, rows]);

  const total = Number(trackerQuery.data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);
  const visibleColumns = useMemo(
    () => columns.filter((column) => visibleColumnKeys.includes(column.key)),
    [columns, visibleColumnKeys]
  );

  const transporterOptions = useMemo(() => {
    const raw = Array.isArray(transportersQuery.data) ? transportersQuery.data : [];
    return raw.map((row) => ({
      value: row.id,
      label: row.transporter_name || row.name || row.id,
    }));
  }, [transportersQuery.data]);

  const portOptions = useMemo(() => {
    const raw = Array.isArray(dischargePortsQuery.data) ? dischargePortsQuery.data : [];
    return raw.map((row) => ({
      value: row.id,
      label: `${row.port_code || ""}${row.port_name ? ` | ${row.port_name}` : ""}` || row.id,
    }));
  }, [dischargePortsQuery.data]);

  const allottedCompanyOptions = useMemo(() => {
    const raw = Array.isArray(companiesQuery.data) ? companiesQuery.data : [];
    return raw.map((row) => ({
      value: row.id,
      label: `${row.company_code || ""}${row.company_name ? ` | ${row.company_name}` : ""}` || row.id,
    }));
  }, [companiesQuery.data]);

  const savedLayouts = Array.isArray(layoutsQuery.data) ? layoutsQuery.data : [];

  function openAlerts(tab) {
    openScreen(OPERATION_SCREENS.PROC_CSN_ALERTS.screen_code);
    navigate(`/dashboard/procurement/csn-alerts?tab=${encodeURIComponent(tab)}`);
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_CSN_DETAIL.screen_code);
    navigate(`/dashboard/procurement/csns/${encodeURIComponent(row.id)}`);
  }

  function resetDraft(row) {
    setExpandedRowId(row?.id || "");
    setDraft(row ? buildDraft(row) : null);
    setActiveHistoryKey("");
  }

  async function toggleHistory(key, rowId, fieldName) {
    if (activeHistoryKey === key) {
      setActiveHistoryKey("");
      return;
    }
    setActiveHistoryKey(key);
    if (histories[key]) {
      return;
    }
    try {
      setLoadingHistoryKey(key);
      const data = await getCSNFieldHistory(rowId, { field_name: fieldName });
      setHistories((current) => ({ ...current, [key]: Array.isArray(data) ? data : [] }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CSN_HISTORY_LIST_FAILED");
    } finally {
      setLoadingHistoryKey("");
    }
  }

  function patchDraft(field, value) {
    setDraft((current) => ({ ...(current || {}), [field]: value }));
  }

  async function invalidateTracker() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["csn-tracker"] }),
      queryClient.invalidateQueries({ queryKey: ["csn-alert-counts"] }),
    ]);
  }

  async function saveExpandedRow(row, dispatchAction = null) {
    if (!companyId || !draft) {
      return;
    }
    setSavingRowId(row.id);
    setError("");
    setNotice("");
    try {
      const payload = normalizePayload(draft);
      const nextDispatchQty = parseNumber(payload.dispatch_qty);
      const currentDispatchQty = parseNumber(row.dispatch_qty);
      const dispatchChanged = nextDispatchQty !== currentDispatchQty;

      if (!dispatchAction && dispatchChanged && nextDispatchQty != null) {
        const preview = await previewCSNDispatchQty(row.id, {
          company_id: companyId,
          dispatch_qty: nextDispatchQty,
        });
        if (Number(preview?.remainder ?? 0) > 0) {
          setDispatchDialog({
            row,
            payload,
            preview,
            allocations: (preview.csns || []).map((entry) => ({
              id: entry.id,
              qty: entry.suggested_qty,
              label: entry.csn_number ? `${entry.csn_number}` : entry.id,
            })),
            knock_off_qty: preview.remainder || 0,
            reason: "",
          });
          return;
        }
      }

      if (dispatchAction) {
        await confirmCSNDispatchQty(row.id, {
          company_id: companyId,
          dispatch_qty: payload.dispatch_qty,
          ...dispatchAction,
        });
      }

      await updateCSN(row.id, {
        company_id: companyId,
        ...payload,
      });

      await invalidateTracker();
      setNotice("CSN row updated.");
      resetDraft(null);
      setDispatchDialog(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CSN_UPDATE_FAILED");
    } finally {
      setSavingRowId("");
    }
  }

  async function saveLayout() {
    try {
      setError("");
      await createCSNTrackerLayout({
        name: layoutDraft.name,
        scope: layoutDraft.scope,
        visible_columns: visibleColumnKeys,
      });
      await queryClient.invalidateQueries({ queryKey: ["csn-tracker-layouts"] });
      setNotice("Layout saved.");
      setShowSaveLayout(false);
      setLayoutDraft({ name: "", scope: "USER" });
    } catch (layoutError) {
      setError(layoutError instanceof Error ? layoutError.message : "PROCUREMENT_CSN_LAYOUT_CREATE_FAILED");
    }
  }

  async function removeSelectedLayout() {
    if (!selectedLayoutId) {
      return;
    }
    try {
      setError("");
      await deleteCSNTrackerLayout(selectedLayoutId);
      await queryClient.invalidateQueries({ queryKey: ["csn-tracker-layouts"] });
      setSelectedLayoutId("");
      setVisibleColumnKeys(columns.map((column) => column.key));
      setNotice("Layout deleted.");
    } catch (layoutError) {
      setError(layoutError instanceof Error ? layoutError.message : "PROCUREMENT_CSN_LAYOUT_DELETE_FAILED");
    }
  }

  function applyLayout(layoutId) {
    setSelectedLayoutId(layoutId);
    if (!layoutId) {
      setVisibleColumnKeys(columns.map((column) => column.key));
      return;
    }
    const layout = savedLayouts.find((entry) => entry.id === layoutId);
    const next = Array.isArray(layout?.visible_columns)
      ? layout.visible_columns.filter((key) => columns.some((column) => column.key === key))
      : [];
    if (next.length > 0) {
      setVisibleColumnKeys(next);
    }
  }

  function renderCell(row, column) {
    const redFields = evaluateRedFields(row);
    const textClass = redFields.has(column.key) ? "text-rose-700 font-semibold" : "text-slate-700";
    switch (column.key) {
      case "expand":
        return (
          <button
            type="button"
            onClick={() => (expandedRowId === row.id ? resetDraft(null) : resetDraft(row))}
            className="inline-flex h-7 w-7 items-center justify-center border border-slate-300 bg-white text-slate-700"
          >
            {expandedRowId === row.id ? "▾" : "▸"}
          </button>
        );
      case "status":
        return (
          <span
            title={getStatusLabel(row.status)}
            className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getBadgeTone(row.status)}`}
          >
            {row.status || "—"}
          </span>
        );
      case "csn_type":
        return (
          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getBadgeTone(row.csn_type)}`}>
            {row.csn_type || "—"}
          </span>
        );
      case "soft_copy_received":
      case "hard_copy_received":
      case "indent_required":
        return <span className={textClass}>{formatBool(row[column.key])}</span>;
      case "etd_vs_atd_days":
      case "eta_vs_ata_days":
      case "baseline_vs_actual_days":
        return <span className={toneForDiff(row[column.key])}>{formatDiff(row[column.key])}</span>;
      case "lr_vs_ge_days":
        return <span className="text-slate-700">{formatDiff(row[column.key])}</span>;
      case "remarks":
        return <span className="line-clamp-2">{row.remarks || "—"}</span>;
      default:
        return <span className={textClass}>{row[column.key] || "—"}</span>;
    }
  }

  const currentRow = rows.find((row) => row.id === expandedRowId) || null;
  const currentGroupOptions = currentRow?.material_group_options || [];

  return (
    <>
      <ErpMasterListTemplate
        eyebrow="Procurement"
        title="Consignment Tracker"
        actions={[
          {
            key: "columns",
            label: "Columns",
            tone: "neutral",
            onClick: () => setShowColumns(true),
          },
          {
            key: "layouts",
            label: "Save Layout",
            tone: "neutral",
            onClick: () => setShowSaveLayout(true),
          },
          {
            key: "refresh",
            label: trackerQuery.isFetching ? "Refreshing..." : "Refresh",
            tone: "neutral",
            onClick: () => void invalidateTracker(),
          },
        ]}
        notices={[
          ...(error ? [{ key: "csn-tracker-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "csn-tracker-notice", tone: "success", message: notice }] : []),
        ]}
        filterSection={{
          eyebrow: "Tracker Alerts",
          title: "Arrival, LC, and vessel readiness",
          children: (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openAlerts("lc")}
                  className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
                >
                  LC Alerts: {Number(alertsQuery.data?.lc_alert ?? 0)}
                </button>
                <button
                  type="button"
                  onClick={() => openAlerts("vessel")}
                  className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
                >
                  Vessel Booking: {Number(alertsQuery.data?.vessel_booking_alert ?? 0)}
                </button>
              </div>

              <div className="grid gap-3 xl:grid-cols-[220px_180px_180px_170px_170px_220px_minmax(0,1fr)]">
                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Company
                  <select
                    value={companyId}
                    onChange={(event) => {
                      setCompanyId(event.target.value);
                      setPage(1);
                    }}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select company</option>
                    {companyOptions.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Status
                  <select
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value);
                      setPage(1);
                    }}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">ALL</option>
                    {STATUS_OPTIONS.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry} — {getStatusLabel(entry)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  CSN Type
                  <select
                    value={csnType}
                    onChange={(event) => {
                      setCsnType(event.target.value);
                      setPage(1);
                    }}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">ALL</option>
                    {["IMPORT", "DOMESTIC", "BULK"].map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Date From
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => {
                      setDateFrom(event.target.value);
                      setPage(1);
                    }}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Date To
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(event) => {
                      setDateTo(event.target.value);
                      setPage(1);
                    }}
                    className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  Layout
                  <div className="flex gap-2">
                    <select
                      value={selectedLayoutId}
                      onChange={(event) => applyLayout(event.target.value)}
                      className="h-10 min-w-0 flex-1 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Default (All Columns)</option>
                      {savedLayouts.map((layout) => (
                        <option key={layout.id} value={layout.id}>
                          {layout.name} [{layout.scope}]
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void removeSelectedLayout()}
                      disabled={!selectedLayoutId}
                      className="border border-rose-300 bg-rose-50 px-3 text-xs font-semibold text-rose-900 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </label>

                <QuickFilterInput
                  label="Search"
                  value={search}
                  onChange={setSearch}
                  placeholder="CSN, vendor, material, PO"
                />
              </div>
            </div>
          ),
        }}
        listSection={{
          eyebrow: "Tracker Grid",
          title: trackerQuery.isLoading ? "Loading consignment tracker" : `${total} CSN row${total === 1 ? "" : "s"}`,
          children: (
            <div className="grid gap-3">
              <ErpPaginationStrip
                page={page}
                setPage={setPage}
                totalPages={totalPages}
                startIndex={startIndex}
                endIndex={endIndex}
                totalItems={total}
              />
              <div className="overflow-auto border border-slate-300 bg-white">
                <table className="min-w-full border-collapse text-[11px]">
                  <thead className="bg-slate-100 text-left text-[10px] uppercase tracking-[0.08em] text-slate-600">
                    <tr>
                      {visibleColumns.map((column) => (
                        <th key={column.key} className="border-b border-r border-slate-200 px-2 py-2 font-semibold" style={{ minWidth: column.width }}>
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length > 0 ? filteredRows.map((row) => (
                      <FragmentRow
                        key={row.id}
                        row={row}
                        visibleColumns={visibleColumns}
                        expanded={expandedRowId === row.id}
                        onOpenDetail={openDetail}
                        renderCell={renderCell}
                      >
                        {expandedRowId === row.id && currentRow && draft ? (
                          <tr className="bg-slate-50">
                            <td colSpan={visibleColumns.length} className="border-t border-slate-300 px-4 py-4">
                              <div className="grid gap-4">
                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField
                                    label="Dispatch Qty"
                                    rowId={row.id}
                                    fieldName="dispatch_qty"
                                    activeHistoryKey={activeHistoryKey}
                                    histories={histories}
                                    loadingHistoryKey={loadingHistoryKey}
                                    onToggleHistory={toggleHistory}
                                  >
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      value={draft.dispatch_qty ?? ""}
                                      onChange={(event) => patchDraft("dispatch_qty", event.target.value)}
                                      className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                                    />
                                  </EditField>
                                  <EditField
                                    label="Material Group"
                                    rowId={row.id}
                                    fieldName="material_category_id"
                                    activeHistoryKey={activeHistoryKey}
                                    histories={histories}
                                    loadingHistoryKey={loadingHistoryKey}
                                    onToggleHistory={toggleHistory}
                                  >
                                    {currentGroupOptions.length > 0 ? (
                                      <select
                                        value={draft.material_category_id ?? ""}
                                        onChange={(event) => patchDraft("material_category_id", event.target.value)}
                                        className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                                      >
                                        <option value="">Select group</option>
                                        {currentGroupOptions.map((option) => (
                                          <option key={option.id} value={option.id}>
                                            {option.group_name}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <div className="h-9 border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600">
                                        {row.material_name || "—"}
                                      </div>
                                    )}
                                  </EditField>
                                  <EditField
                                    label="Indent Required"
                                    rowId={row.id}
                                    fieldName="indent_required"
                                    activeHistoryKey={activeHistoryKey}
                                    histories={histories}
                                    loadingHistoryKey={loadingHistoryKey}
                                    onToggleHistory={toggleHistory}
                                  >
                                    <select
                                      value={draft.indent_required ? "YES" : "NO"}
                                      onChange={(event) => patchDraft("indent_required", event.target.value === "YES")}
                                      className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                                    >
                                      {YES_NO_OPTIONS.map((option) => (
                                        <option key={option.label} value={option.value ? "YES" : "NO"}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </EditField>
                                  <EditField
                                    label="Indent Number"
                                    rowId={row.id}
                                    fieldName="vendor_indent_number"
                                    activeHistoryKey={activeHistoryKey}
                                    histories={histories}
                                    loadingHistoryKey={loadingHistoryKey}
                                    onToggleHistory={toggleHistory}
                                  >
                                    <input
                                      value={draft.vendor_indent_number ?? ""}
                                      onChange={(event) => patchDraft("vendor_indent_number", event.target.value)}
                                      className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                                    />
                                  </EditField>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField label="Scheduled ETA Port" rowId={row.id} fieldName="scheduled_eta_to_port" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.scheduled_eta_to_port ?? ""} onChange={(event) => patchDraft("scheduled_eta_to_port", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="ETD" rowId={row.id} fieldName="etd" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.etd ?? ""} onChange={(event) => patchDraft("etd", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Current ETA" rowId={row.id} fieldName="eta_at_port" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.eta_at_port ?? ""} onChange={(event) => patchDraft("eta_at_port", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="ATA" rowId={row.id} fieldName="ata_at_port" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.ata_at_port ?? ""} onChange={(event) => patchDraft("ata_at_port", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField label="BL Number" rowId={row.id} fieldName="bl_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.bl_number ?? ""} onChange={(event) => patchDraft("bl_number", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="BL Date" rowId={row.id} fieldName="bl_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.bl_date ?? ""} onChange={(event) => patchDraft("bl_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Invoice Number" rowId={row.id} fieldName="invoice_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.invoice_number ?? ""} onChange={(event) => patchDraft("invoice_number", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Invoice Date" rowId={row.id} fieldName="invoice_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.invoice_date ?? ""} onChange={(event) => patchDraft("invoice_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField label="BOE Number" rowId={row.id} fieldName="boe_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.boe_number ?? ""} onChange={(event) => patchDraft("boe_number", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="BOE Date" rowId={row.id} fieldName="boe_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.boe_date ?? ""} onChange={(event) => patchDraft("boe_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Destination Port" rowId={row.id} fieldName="port_of_discharge_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <select value={draft.port_of_discharge_id ?? ""} onChange={(event) => patchDraft("port_of_discharge_id", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
                                      <option value="">Select port</option>
                                      {portOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </EditField>
                                  <EditField label="Allotted Company" rowId={row.id} fieldName="consignee_company_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <select value={draft.consignee_company_id ?? ""} onChange={(event) => patchDraft("consignee_company_id", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
                                      <option value="">Select company</option>
                                      {allottedCompanyOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </EditField>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField label="Transporter" rowId={row.id} fieldName="transporter_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <select value={draft.transporter_id ?? ""} onChange={(event) => patchDraft("transporter_id", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
                                      <option value="">Select transporter</option>
                                      {transporterOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </EditField>
                                  <EditField label="LR Date" rowId={row.id} fieldName="lr_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.lr_date ?? ""} onChange={(event) => patchDraft("lr_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="LR Number" rowId={row.id} fieldName="lr_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.lr_number ?? ""} onChange={(event) => patchDraft("lr_number", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Post-clearance LR Date" rowId={row.id} fieldName="post_clearance_lr_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.post_clearance_lr_date ?? ""} onChange={(event) => patchDraft("post_clearance_lr_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField label="GE Number" rowId={row.id} fieldName="gate_entry_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.gate_entry_id ?? ""} onChange={(event) => patchDraft("gate_entry_id", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="GE Date" rowId={row.id} fieldName="gate_entry_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.gate_entry_date ?? ""} onChange={(event) => patchDraft("gate_entry_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="GRN Number" rowId={row.id} fieldName="grn_id" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.grn_id ?? ""} onChange={(event) => patchDraft("grn_id", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="GRN Date" rowId={row.id} fieldName="grn_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.grn_date ?? ""} onChange={(event) => patchDraft("grn_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField label="LC Number" rowId={row.id} fieldName="lc_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.lc_number ?? ""} onChange={(event) => patchDraft("lc_number", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="LC Opened Date" rowId={row.id} fieldName="lc_opened_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.lc_opened_date ?? ""} onChange={(event) => patchDraft("lc_opened_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Soft Copy Received" rowId={row.id} fieldName="soft_copy_received" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <select value={draft.soft_copy_received ? "YES" : "NO"} onChange={(event) => patchDraft("soft_copy_received", event.target.value === "YES")} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
                                      {YES_NO_OPTIONS.map((option) => <option key={option.label} value={option.value ? "YES" : "NO"}>{option.label}</option>)}
                                    </select>
                                  </EditField>
                                  <EditField label="Hard Copy Received" rowId={row.id} fieldName="hard_copy_received" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <select value={draft.hard_copy_received ? "YES" : "NO"} onChange={(event) => patchDraft("hard_copy_received", event.target.value === "YES")} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
                                      {YES_NO_OPTIONS.map((option) => <option key={option.label} value={option.value ? "YES" : "NO"}>{option.label}</option>)}
                                    </select>
                                  </EditField>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                  <EditField label="Courier Number" rowId={row.id} fieldName="hard_copy_courier_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.hard_copy_courier_number ?? ""} onChange={(event) => patchDraft("hard_copy_courier_number", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Courier Dispatch Date" rowId={row.id} fieldName="courier_dispatch_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.courier_dispatch_date ?? ""} onChange={(event) => patchDraft("courier_dispatch_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="Courier Received Date" rowId={row.id} fieldName="courier_received_date" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input type="date" value={draft.courier_received_date ?? ""} onChange={(event) => patchDraft("courier_received_date", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                  <EditField label="CHA Docket Number" rowId={row.id} fieldName="cha_docket_number" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                    <input value={draft.cha_docket_number ?? ""} onChange={(event) => patchDraft("cha_docket_number", event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
                                  </EditField>
                                </div>

                                <EditField label="Remarks" rowId={row.id} fieldName="remarks" activeHistoryKey={activeHistoryKey} histories={histories} loadingHistoryKey={loadingHistoryKey} onToggleHistory={toggleHistory}>
                                  <textarea value={draft.remarks ?? ""} onChange={(event) => patchDraft("remarks", event.target.value)} rows={3} className="border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500" />
                                </EditField>

                                <div className="flex flex-wrap justify-end gap-2">
                                  <button type="button" onClick={() => resetDraft(null)} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                                    Cancel
                                  </button>
                                  <button type="button" onClick={() => void saveExpandedRow(row)} disabled={savingRowId === row.id} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
                                    {savingRowId === row.id ? "Saving..." : "Save & Collapse"}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </FragmentRow>
                    )) : (
                      <tr>
                        <td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                          {trackerQuery.isLoading ? "Loading consignment tracker..." : "No CSNs matched the current filter."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ),
        }}
      />

      <ErpColumnVisibilityDrawer
        visible={showColumns}
        columns={columns.filter((column) => column.key !== "expand")}
        visibleColumnKeys={visibleColumnKeys.filter((key) => key !== "expand")}
        onToggleColumn={(columnKey) => {
          setVisibleColumnKeys((current) => {
            if (current.includes(columnKey)) {
              const next = current.filter((key) => key !== columnKey);
              return next.length > 1 ? next : current;
            }
            return [...current, columnKey];
          });
        }}
        onResetColumns={() => setVisibleColumnKeys(columns.map((column) => column.key))}
        onClose={() => setShowColumns(false)}
      />

      <ModalBase
        visible={showSaveLayout}
        eyebrow="CSN Tracker"
        title="Save Layout"
        onEscape={() => setShowSaveLayout(false)}
        actions={
          <>
            <button type="button" onClick={() => setShowSaveLayout(false)} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => void saveLayout()} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
              Save Layout
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Layout Name
            <input value={layoutDraft.name} onChange={(event) => setLayoutDraft((current) => ({ ...current, name: event.target.value }))} className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Scope
            <select value={layoutDraft.scope} onChange={(event) => setLayoutDraft((current) => ({ ...current, scope: event.target.value }))} className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500">
              <option value="USER">User-specific</option>
              <option value="GLOBAL">Global</option>
            </select>
          </label>
        </div>
      </ModalBase>

      <ModalBase
        visible={Boolean(dispatchDialog)}
        eyebrow="CSN Dispatch Balance"
        title={dispatchDialog?.preview?.requires_reconciliation ? "Reconcile CSN Quantities" : "Balance Requires Action"}
        onEscape={() => setDispatchDialog(null)}
        width="min(760px, calc(100vw - 32px))"
        actions={
          <>
            <button type="button" onClick={() => setDispatchDialog(null)} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            {dispatchDialog?.preview?.requires_reconciliation ? (
              <button
                type="button"
                onClick={() =>
                  void saveExpandedRow(dispatchDialog.row, {
                    action: "RECONCILE",
                    allocations: dispatchDialog.allocations,
                    knock_off_qty: dispatchDialog.knock_off_qty,
                    reason: dispatchDialog.reason,
                  })
                }
                className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950"
              >
                Save Reconciliation
              </button>
            ) : null}
          </>
        }
      >
        {dispatchDialog?.preview?.requires_prompt ? (
          <div className="grid gap-3">
            <div className="text-sm text-slate-700">
              Balance remaining: <strong>{dispatchDialog.preview.remainder}</strong>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveExpandedRow(dispatchDialog.row, { action: "CREATE_CSN" })}
                className="border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900"
              >
                Create CSN for Balance
              </button>
              <button
                type="button"
                onClick={() => void saveExpandedRow(dispatchDialog.row, { action: "KNOCK_OFF", reason: dispatchDialog.reason })}
                className="border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900"
              >
                Knock Off Balance
              </button>
            </div>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Knock-off Reason
              <input value={dispatchDialog.reason} onChange={(event) => setDispatchDialog((current) => ({ ...current, reason: event.target.value }))} className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500" />
            </label>
          </div>
        ) : dispatchDialog?.preview?.requires_reconciliation ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              {dispatchDialog.allocations.map((entry, index) => (
                <div key={entry.id} className="grid gap-2 border border-slate-200 bg-slate-50 px-3 py-3 md:grid-cols-[minmax(0,1fr)_180px] md:items-center">
                  <div className="text-sm font-medium text-slate-700">{entry.label}</div>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={entry.qty}
                    onChange={(event) =>
                      setDispatchDialog((current) => ({
                        ...current,
                        allocations: current.allocations.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, qty: event.target.value } : row
                        ),
                      }))
                    }
                    className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Knock Off Qty
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={dispatchDialog.knock_off_qty}
                  onChange={(event) => setDispatchDialog((current) => ({ ...current, knock_off_qty: event.target.value }))}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Knock-off Reason
                <input
                  value={dispatchDialog.reason}
                  onChange={(event) => setDispatchDialog((current) => ({ ...current, reason: event.target.value }))}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                />
              </label>
            </div>
          </div>
        ) : null}
      </ModalBase>
    </>
  );
}

function FragmentRow({ row, visibleColumns, expanded, onOpenDetail, renderCell, children }) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-slate-200 align-top hover:bg-sky-50"
        onDoubleClick={() => onOpenDetail(row)}
      >
        {visibleColumns.map((column) => (
          <td key={column.key} className="border-r border-slate-200 px-2 py-2 text-xs text-slate-700">
            {renderCell(row, column)}
          </td>
        ))}
      </tr>
      {expanded ? children : null}
    </>
  );
}
